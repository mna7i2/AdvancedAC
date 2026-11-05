'use strict';
const db = require('../db');
const { BY_KEY, resolveConfig } = require('../detections/catalog');
const { getSettings } = require('../lib/settings');
const { activity } = require('../lib/activity');
const realtime = require('../lib/realtime');
const discord = require('../lib/discord');
const { decayedRisk, identifiersOf } = require('./players');
const bans = require('./bans');
const reviews = require('./reviews');
const { explain } = require('../lib/evidence');

const RANK = { log: 0, warn: 1, kick: 2, review: 2.5, ban: 3 };

// Detections that can be caused by lag, scripts or game physics: they never count as ban evidence.
const WEAK_EVIDENCE = new Set(['teleport', 'ac_heartbeat', 'explosion_distance', 'weapon_mismatch', 'event_invalid_args']);

/** Per-org resolved detection config cache (invalidated on config change). */
const cfgCache = new Map();
async function orgDetectionConfig(orgId, { fresh = false } = {}) {
  const c = cfgCache.get(orgId);
  if (!fresh && c && Date.now() - c.at < 15000) return c.cfg;
  const rows = await db.many('SELECT detection_key, config FROM detection_overrides WHERE org_id=$1', [orgId]);
  const cfg = resolveConfig(rows);
  cfgCache.set(orgId, { at: Date.now(), cfg });
  return cfg;
}
function invalidateConfig(orgId) { cfgCache.delete(orgId); }

const join = (a, b) => (a ? `${a}; ${b}` : b);

/**
 * Pure decision function (unit-tested). Given the detection config, verification status and risk
 * state, decide the enforcement action.
 *
 * Fair-ban rules:
 *  1. Configured action is the starting point; with progressive punishments (ladder) the step for
 *     this offense number is used instead (e.g. 1st warn → 2nd kick → 3rd ban 24h → 4th permanent).
 *  2. A 'ban' from an unverified (client) signal is downgraded — never ban on a weak single signal.
 *  3. At critical risk, with verified strong evidence and no reputation bypass, the player is sent to
 *     staff review (kick + review queue) by default; automatic escalation bans only if the org chose
 *     escalationMode 'ban'. Weak-evidence detections (teleport, heartbeat…) never justify a ban.
 *  4. Whitelisted identifiers are logged only.
 */
function decide({ cfg, verified, severity, riskAfter, hasRecentVerifiedSevere, whitelisted, reputationBypass, settings,
  offenses = 0, strongEvidence = true }) {
  if (whitelisted) return { action: 'log', note: 'whitelisted identifier', escalated: false, banHours: 0 };
  let action = cfg.action;
  let banHours = cfg.banDuration || 0;
  let note = null;
  let escalated = false;
  let step = null;
  const lad = cfg.ladder;
  if (lad && lad.enabled && Array.isArray(lad.steps) && lad.steps.length) {
    const i = Math.min(offenses, lad.steps.length - 1);
    action = lad.steps[i].action;
    if (lad.steps[i].hours !== undefined) banHours = lad.steps[i].hours;
    step = i + 1;
    note = `offense #${offenses + 1} → punishment step ${step}/${lad.steps.length}`;
  }
  if (action === 'ban' && !verified) {
    action = settings.enforcement.unverifiedBanFallback;
    note = join(note, 'ban downgraded: unverified client signal');
  }
  if (action === 'ban' && !strongEvidence) {
    action = 'review';
    note = join(note, 'ban changed to staff review: this detection alone is not proof');
  }
  const r = settings.risk;
  const mode = r.autoBanOnCritical === false ? 'off' : (r.escalationMode || 'review');
  if (riskAfter >= r.thresholds.critical && RANK[action] < RANK.review) {
    const severeNow = verified && strongEvidence && (severity === 'high' || severity === 'critical');
    if (mode !== 'off' && !reputationBypass && (severeNow || hasRecentVerifiedSevere)) {
      escalated = true;
      if (mode === 'ban') { action = 'ban'; banHours = r.escalationBanDuration; note = join(note, 'risk escalation: critical risk with verified evidence'); }
      else { action = 'review'; note = join(note, 'critical risk with verified evidence: removed and sent to staff review'); }
    } else {
      note = join(note, 'critical risk: staff review required');
    }
  }
  return { action, note, escalated, banHours, step };
}

/** Evidence list for a ban / review: this detection first, then the player's other recent strong detections. */
async function evidenceFor(playerId, current, lang) {
  const recent = await db.many(
    `SELECT id, detection_key, details, explanation, verified, created_at FROM detections
     WHERE player_id=$1 AND id <> $2 AND verified AND action_taken NOT IN ('suppressed','ignored')
       AND created_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 5`, [playerId, current.id]);
  const item = (d) => ({ detectionId: d.id, key: d.detection_key, name: BY_KEY[d.detection_key] ? BY_KEY[d.detection_key].name : d.detection_key,
    text: d.explanation || explain(d.detection_key, d.details, lang), verified: d.verified, at: d.created_at });
  return [item(current), ...recent.map(item)];
}

async function processDetection(server, p) {
  const def = BY_KEY[p.key];
  if (!def) throw Object.assign(new Error('unknown detection'), { status: 400 });
  const session = p.sessionId ? await db.one(
    `SELECT ps.*, pl.risk_score, pl.risk_updated_at, pl.reputation_bypass, pl.last_name
     FROM player_sessions ps JOIN players pl ON pl.id = ps.player_id
     WHERE ps.id = $1 AND ps.server_id = $2`, [p.sessionId, server.id]) : null;
  if (!session) throw Object.assign(new Error('unknown session'), { status: 404 });

  const orgId = server.org_id;
  const [cfgAll, settings] = await Promise.all([orgDetectionConfig(orgId), getSettings(orgId)]);
  const cfg = cfgAll[p.key];
  if (!cfg.enabled) return { action: 'ignored' };
  const lang = settings.enforcement.language === 'ar' ? 'ar' : 'en';

  // Verification comes from the catalog, never from the request.
  const verified = def.verified;
  const strongEvidence = !WEAK_EVIDENCE.has(p.key);
  const identifiers = await identifiersOf(session.player_id);
  const wl = new Set(cfg.whitelist.identifiers || []);
  const whitelisted = identifiers.some((i) => wl.has(`${i.kind}:${i.value}`));

  // Cooldown: same detection on same player within the window → record but don't enforce again.
  const recent = await db.one(
    `SELECT id FROM detections WHERE player_id=$1 AND detection_key=$2 AND action_taken <> 'suppressed'
       AND created_at > now() - ($3 || ' seconds')::interval LIMIT 1`, [session.player_id, p.key, cfg.cooldown]);

  const weight = settings.risk.weights[cfg.severity] * (verified ? 1 : settings.risk.unverifiedMultiplier);
  const riskBefore = decayedRisk(session.risk_score, session.risk_updated_at, settings.risk.halfLifeHours);
  const riskAfter = recent || whitelisted ? riskBefore : Math.min(100, riskBefore + weight);

  let decision;
  if (recent) decision = { action: 'suppressed', note: 'cooldown' };
  else {
    const weak = [...WEAK_EVIDENCE];
    const sev = await db.one(
      `SELECT 1 FROM detections WHERE player_id=$1 AND verified AND severity IN ('high','critical')
         AND detection_key <> ALL($3::text[]) AND action_taken NOT IN ('suppressed','ignored')
         AND created_at > now() - ($2 || ' hours')::interval LIMIT 1`,
      [session.player_id, settings.risk.criticalRequiresVerifiedWithinHours, weak]);
    let offenses = 0;
    if (cfg.ladder && cfg.ladder.enabled) {
      const o = await db.one(
        `SELECT count(*)::int AS n FROM detections WHERE player_id=$1 AND detection_key=$2
           AND action_taken IN ('warn','kick','review','ban') AND created_at > now() - ($3 || ' hours')::interval`,
        [session.player_id, p.key, cfg.ladder.windowHours || 72]);
      offenses = o.n;
    }
    decision = decide({ cfg, verified, severity: cfg.severity, riskAfter, hasRecentVerifiedSevere: !!sev,
      whitelisted, reputationBypass: session.reputation_bypass, settings, offenses, strongEvidence });
  }

  const details = sanitizeDetails(p.details);
  const explanation = explain(p.key, details, lang);
  const det = await db.one(
    `INSERT INTO detections(org_id, server_id, player_id, session_id, detection_key, category, severity, verified, source,
                            score_delta, risk_after, configured_action, action_taken, action_note, details, explanation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [orgId, server.id, session.player_id, session.id, p.key, def.category, cfg.severity, verified, def.source,
      riskAfter - riskBefore, riskAfter, cfg.action, decision.action, decision.note, details, explanation]);
  await db.query('UPDATE players SET risk_score=$2, risk_updated_at=now() WHERE id=$1', [session.player_id, riskAfter]);

  if (decision.action === 'suppressed') return { detectionId: det.id, action: 'suppressed' };

  const out = { detectionId: det.id, action: decision.action, screenshot: false, message: null, banId: null };
  const enforcing = ['warn', 'kick', 'review', 'ban'].includes(decision.action);
  out.screenshot = !!(cfg.evidence && cfg.evidence.screenshot && enforcing);

  const reason = `${def.name}` + (decision.escalated ? ' (risk escalation)' : '');
  const reasonLong = `${reason} — ${explanation}`;
  if (decision.action === 'ban') {
    const evidence = await evidenceFor(session.player_id, det, lang);
    const ban = await bans.createBan({
      orgId, serverId: server.id, playerId: session.player_id, playerName: session.name, identifiers,
      reason, detectionKey: p.key, category: def.category, detectionId: det.id, automatic: true,
      issuedByName: 'Sentinel AC', durationHours: decision.banHours, serverName: server.name, evidence,
    });
    out.banId = ban.id;
    out.message = bans.formatBanMessage(settings.enforcement.banMessage, ban, settings.general.appealUrl);
  } else if (decision.action === 'review') {
    // Kick now, a human decides about the ban (one open review per player collects all evidence).
    const evidence = await evidenceFor(session.player_id, det, lang);
    await reviews.openOrAppend({ orgId, serverId: server.id, playerId: session.player_id, playerName: session.name,
      reason, detectionKey: p.key, detectionId: det.id, evidence, serverName: server.name });
    out.action = 'kick';
    out.message = (settings.enforcement.reviewMessage || settings.enforcement.kickMessage).replace('{reason}', reasonLong);
  } else if (decision.action === 'kick') {
    out.message = settings.enforcement.kickMessage.replace('{reason}', reasonLong);
  } else if (decision.action === 'warn') {
    out.message = `Suspicious activity detected (${def.name}). Staff have been notified.`;
  }

  const payload = { ...det, name: def.name, playerName: session.name, serverName: server.name };
  realtime.toOrg(orgId, 'detection', payload);
  await activity(orgId, server.id, 'detection',
    `${session.name}: ${def.name} → ${decision.action} (${explanation})`, { detectionId: det.id, playerId: session.player_id, key: p.key });
  if (decision.action !== 'ban') { // bans have their own embed
    const embed = discord.detectionEmbed({ ...det, name: def.name }, session.name, identifiers, server.name);
    discord.notify(orgId, 'detection', embed);
    if (cfg.severity === 'critical' || riskAfter >= settings.risk.thresholds.critical) discord.notify(orgId, 'critical', embed);
  }
  return out;
}

/** Bound detail payloads: plain JSON, size-limited, no functions. */
function sanitizeDetails(d) {
  if (!d || typeof d !== 'object') return {};
  const s = JSON.stringify(d);
  return s.length > 4000 ? { truncated: true, preview: s.slice(0, 4000) } : JSON.parse(s);
}

module.exports = { processDetection, decide, orgDetectionConfig, invalidateConfig, RANK, WEAK_EVIDENCE };
