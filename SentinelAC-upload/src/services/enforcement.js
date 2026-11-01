'use strict';
const db = require('../db');
const { BY_KEY, resolveConfig } = require('../detections/catalog');
const { getSettings } = require('../lib/settings');
const { activity } = require('../lib/activity');
const realtime = require('../lib/realtime');
const discord = require('../lib/discord');
const { decayedRisk, identifiersOf } = require('./players');
const bans = require('./bans');

const RANK = { log: 0, warn: 1, kick: 2, ban: 3 };

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

/**
 * Pure decision function (unit-tested). Given the detection config, verification status and risk
 * state, decide the enforcement action.
 *
 * Rules:
 *  1. Configured action is the starting point.
 *  2. A 'ban' from an unverified (client) signal is downgraded — never ban on a weak single signal.
 *  3. Risk escalation to 'ban' happens only at critical risk AND when a verified high/critical
 *     detection exists in the recent window AND the player has no reputation bypass.
 *  4. Whitelisted identifiers are logged only.
 */
function decide({ cfg, verified, severity, riskAfter, hasRecentVerifiedSevere, whitelisted, reputationBypass, settings }) {
  if (whitelisted) return { action: 'log', note: 'whitelisted identifier' };
  let action = cfg.action;
  let note = null;
  let escalated = false;
  if (action === 'ban' && !verified) {
    action = settings.enforcement.unverifiedBanFallback;
    note = 'ban downgraded: unverified client signal';
  }
  const r = settings.risk;
  if (riskAfter >= r.thresholds.critical && RANK[action] < RANK.ban) {
    const severeNow = verified && (severity === 'high' || severity === 'critical');
    if (r.autoBanOnCritical && !reputationBypass && (severeNow || hasRecentVerifiedSevere)) {
      action = 'ban'; escalated = true; note = 'risk escalation: critical risk with verified evidence';
    } else {
      note = (note ? note + '; ' : '') + 'critical risk: staff review required';
    }
  }
  return { action, note, escalated };
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

  // Verification comes from the catalog, never from the request.
  const verified = def.verified;
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
    const sev = await db.one(
      `SELECT 1 FROM detections WHERE player_id=$1 AND verified AND severity IN ('high','critical')
         AND created_at > now() - ($2 || ' hours')::interval LIMIT 1`,
      [session.player_id, settings.risk.criticalRequiresVerifiedWithinHours]);
    decision = decide({ cfg, verified, severity: cfg.severity, riskAfter, hasRecentVerifiedSevere: !!sev,
      whitelisted, reputationBypass: session.reputation_bypass, settings });
  }

  const details = sanitizeDetails(p.details);
  const det = await db.one(
    `INSERT INTO detections(org_id, server_id, player_id, session_id, detection_key, category, severity, verified, source,
                            score_delta, risk_after, configured_action, action_taken, action_note, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [orgId, server.id, session.player_id, session.id, p.key, def.category, cfg.severity, verified, def.source,
      riskAfter - riskBefore, riskAfter, cfg.action, decision.action, decision.note, details]);
  await db.query('UPDATE players SET risk_score=$2, risk_updated_at=now() WHERE id=$1', [session.player_id, riskAfter]);

  if (decision.action === 'suppressed') return { detectionId: det.id, action: 'suppressed' };

  const out = { detectionId: det.id, action: decision.action, screenshot: false, message: null, banId: null };
  const enforcing = ['warn', 'kick', 'ban'].includes(decision.action);
  out.screenshot = !!(cfg.evidence && cfg.evidence.screenshot && enforcing);

  const reason = `${def.name}` + (decision.escalated ? ' (risk escalation)' : '');
  if (decision.action === 'ban') {
    const hours = decision.escalated ? settings.risk.escalationBanDuration : cfg.banDuration;
    const ban = await bans.createBan({
      orgId, serverId: server.id, playerId: session.player_id, playerName: session.name, identifiers,
      reason, detectionKey: p.key, category: def.category, detectionId: det.id, automatic: true,
      issuedByName: 'Sentinel AC', durationHours: hours, serverName: server.name,
    });
    out.banId = ban.id;
    out.message = bans.formatBanMessage(settings.enforcement.banMessage, ban, settings.general.appealUrl);
  } else if (decision.action === 'kick') {
    out.message = settings.enforcement.kickMessage.replace('{reason}', reason);
  } else if (decision.action === 'warn') {
    out.message = `Suspicious activity detected (${def.name}). Staff have been notified.`;
  }

  const payload = { ...det, name: def.name, playerName: session.name, serverName: server.name };
  realtime.toOrg(orgId, 'detection', payload);
  await activity(orgId, server.id, 'detection',
    `${session.name}: ${def.name} → ${decision.action}`, { detectionId: det.id, playerId: session.player_id, key: p.key });
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

module.exports = { processDetection, decide, orgDetectionConfig, invalidateConfig, RANK };
