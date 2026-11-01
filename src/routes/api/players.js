'use strict';
const express = require('express');
const db = require('../../db');
const { can } = require('../../middleware/auth');
const { audit } = require('../../lib/audit');
const { getSettings } = require('../../lib/settings');
const { decayedRisk } = require('../../services/players');
const commands = require('../../services/commands');
const bans = require('../../services/bans');
const { h, parse, page, uuid, notFound, forbidden, actor, z } = require('./_util');

const router = express.Router();

async function ownPlayer(req, id) {
  const pid = parse(z.coerce.number().int().positive(), id);
  const p = await db.one('SELECT * FROM players WHERE id=$1 AND org_id=$2', [pid, req.user.orgId]);
  if (!p) throw notFound('player not found');
  return p;
}

// ─── Online players of a server (initial load; live updates come over Socket.IO) ───
router.get('/servers/:id/players', can('players.view', 'map.view'), h(async (req, res) => {
  const sid = parse(uuid, req.params.id);
  const settings = await getSettings(req.user.orgId);
  const rows = await db.many(
    `SELECT ps.id AS session_id, ps.net_id, ps.name, ps.started_at, ps.last_state, p.id AS player_id, p.license,
            p.risk_score, p.risk_updated_at, p.playtime_sec,
            (SELECT count(*) FROM detections d WHERE d.player_id = p.id AND d.action_taken <> 'suppressed') AS detections,
            (SELECT count(*) FROM detections d WHERE d.session_id = ps.id AND d.action_taken <> 'suppressed') AS session_detections,
            (SELECT array_agg(kind || ':' || value) FROM player_identifiers pi WHERE pi.player_id = p.id AND pi.kind IN ('steam','discord','license','fivem')) AS ids
     FROM player_sessions ps JOIN players p ON p.id = ps.player_id JOIN servers s ON s.id = ps.server_id
     WHERE ps.server_id = $1 AND s.org_id = $2 AND ps.ended_at IS NULL AND ps.net_id IS NOT NULL ORDER BY ps.net_id`,
    [sid, req.user.orgId]);
  res.json(rows.map((r) => ({
    sessionId: r.session_id, netId: r.net_id, name: r.name, playerId: r.player_id, joinedAt: r.started_at,
    state: r.last_state, identifiers: r.ids || [], detections: r.detections, sessionDetections: r.session_detections,
    playtimeSec: r.playtime_sec, risk: Math.round(decayedRisk(r.risk_score, r.risk_updated_at, settings.risk.halfLifeHours)),
  })));
}));

// ─── Player profile ───
router.get('/players/:id', can('players.view'), h(async (req, res) => {
  const p = await ownPlayer(req, req.params.id);
  const settings = await getSettings(req.user.orgId);
  const canEvidence = req.perms.has('evidence.view');
  const [ids, names, sessions, dets, banRows, evidence, notes, online, related] = await Promise.all([
    db.many(`SELECT kind, value, first_seen, last_seen FROM player_identifiers WHERE player_id=$1 ORDER BY kind, last_seen DESC`, [p.id]),
    db.many(`SELECT name, first_seen, last_seen FROM player_names WHERE player_id=$1 ORDER BY last_seen DESC`, [p.id]),
    db.many(`SELECT ps.id, ps.server_id, s.name AS server_name, ps.net_id, ps.started_at, ps.ended_at, ps.end_reason
             FROM player_sessions ps JOIN servers s ON s.id = ps.server_id WHERE ps.player_id=$1 ORDER BY ps.started_at DESC LIMIT 50`, [p.id]),
    db.many(`SELECT id, server_id, session_id, detection_key, category, severity, verified, action_taken, action_note, risk_after, details, created_at
             FROM detections WHERE player_id=$1 ORDER BY id DESC LIMIT 100`, [p.id]),
    db.many(`SELECT id, reason, detection_key, automatic, issued_by_name, created_at, expires_at, revoked_at, revoked_by_name FROM bans WHERE player_id=$1 ORDER BY created_at DESC`, [p.id]),
    canEvidence ? db.many(`SELECT id, kind, detection_id, requested_by_name, created_at FROM evidence WHERE player_id=$1 AND kind='screenshot' ORDER BY created_at DESC LIMIT 50`, [p.id]) : [],
    db.many(`SELECT id, author_name, body, created_at FROM admin_notes WHERE player_id=$1 ORDER BY created_at DESC`, [p.id]),
    db.one(`SELECT ps.id AS session_id, ps.net_id, ps.server_id, s.name AS server_name, ps.last_state, ps.started_at
            FROM player_sessions ps JOIN servers s ON s.id=ps.server_id WHERE ps.player_id=$1 AND ps.ended_at IS NULL AND ps.net_id IS NOT NULL
            ORDER BY ps.started_at DESC LIMIT 1`, [p.id]),
    relatedAccounts(req.user.orgId, p.id),
  ]);
  res.json({
    id: p.id, license: p.license, name: p.last_name, firstSeen: p.first_seen, lastSeen: p.last_seen,
    playtimeSec: Number(p.playtime_sec), reputationBypass: p.reputation_bypass,
    risk: Math.round(decayedRisk(p.risk_score, p.risk_updated_at, settings.risk.halfLifeHours)),
    riskThresholds: settings.risk.thresholds,
    identifiers: ids.map((i) => (['ip', 'token'].includes(i.kind) ? { ...i, value: i.value.slice(0, 10) + '…' } : i)),
    names, sessions, detections: dets, bans: banRows, evidence, notes, online, related,
  });
}));

/**
 * Accounts linked by shared identifiers. Hardware tokens / IP hashes are shown as evidence of a
 * possible link only — they never cause automatic action.
 */
async function relatedAccounts(orgId, playerId) {
  return db.many(
    `SELECT p2.id, p2.last_name, array_agg(DISTINCT a.kind) AS shared,
            EXISTS(SELECT 1 FROM bans b WHERE b.player_id=p2.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())) AS banned
     FROM player_identifiers a
     JOIN player_identifiers b ON b.org_id = a.org_id AND b.kind = a.kind AND b.value = a.value AND b.player_id <> a.player_id
     JOIN players p2 ON p2.id = b.player_id
     WHERE a.player_id = $1 AND a.org_id = $2 AND a.kind IN ('token','ip','steam','discord','license2','xbl','live','fivem')
     GROUP BY p2.id, p2.last_name ORDER BY count(*) DESC LIMIT 20`, [playerId, orgId]);
}

router.post('/players/:id/notes', can('players.notes'), h(async (req, res) => {
  const p = await ownPlayer(req, req.params.id);
  const b = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
  const n = await db.one('INSERT INTO admin_notes(player_id, author_id, author_name, body) VALUES ($1,$2,$3,$4) RETURNING *',
    [p.id, req.user.id, req.user.name, b.body]);
  await audit({ ...actor(req), action: 'player.note', targetType: 'player', targetId: p.id });
  res.json(n);
}));

router.post('/players/:id/reputation-bypass', can('players.ban'), h(async (req, res) => {
  const p = await ownPlayer(req, req.params.id);
  const b = parse(z.object({ enabled: z.boolean() }), req.body);
  await db.query('UPDATE players SET reputation_bypass=$2 WHERE id=$1', [p.id, b.enabled]);
  await audit({ ...actor(req), action: 'player.reputation_bypass', targetType: 'player', targetId: p.id, details: b });
  res.json({ ok: true });
}));

// ─── Live actions (command queue → resource) ───
const ACTION_PERM = {
  kick: 'players.kick', warn: 'players.kick', screenshot: 'players.screenshot', freeze: 'players.actions', unfreeze: 'players.actions',
  heal: 'players.actions', teleport_to: 'players.actions', bring: 'players.actions', set_bucket: 'players.actions',
};

router.post('/players/:id/action', h(async (req, res) => {
  const b = parse(z.object({
    action: z.enum(Object.keys(ACTION_PERM)), reason: z.string().max(300).optional(), message: z.string().max(300).optional(),
    bucket: z.number().int().min(0).max(65535).optional(),
  }), req.body);
  if (!req.perms.has(ACTION_PERM[b.action])) throw forbidden('missing permission ' + ACTION_PERM[b.action]);
  const p = await ownPlayer(req, req.params.id);
  const s = await db.one(`SELECT ps.id, ps.net_id, ps.server_id FROM player_sessions ps JOIN servers sv ON sv.id = ps.server_id
                          WHERE ps.player_id=$1 AND ps.ended_at IS NULL AND ps.net_id IS NOT NULL AND sv.status='online' ORDER BY ps.started_at DESC LIMIT 1`, [p.id]);
  if (!s) return res.status(409).json({ error: 'Player is not online' });
  const payload = { netId: s.net_id, sessionId: s.id, reason: b.reason, message: b.message, bucket: b.bucket, requestedBy: req.user.name };
  if (b.action === 'teleport_to' || b.action === 'bring') {
    // The admin must be in-game on the same server (linked identifier).
    const me = await db.one(
      `SELECT ps.net_id FROM player_sessions ps JOIN player_identifiers pi ON pi.player_id = ps.player_id
       WHERE ps.server_id=$1 AND ps.ended_at IS NULL AND ps.net_id IS NOT NULL AND (pi.kind || ':' || pi.value) = ANY($2) LIMIT 1`,
      [s.server_id, req.user.linkedIdentifiers || []]);
    if (!me) return res.status(409).json({ error: 'You must be in-game on this server (link your identifiers in Administrators)' });
    payload.adminNetId = me.net_id;
  }
  const id = await commands.enqueue(s.server_id, b.action, payload, req.user.name);
  await audit({ ...actor(req), action: 'player.' + b.action, targetType: 'player', targetId: p.id, details: { reason: b.reason, serverId: s.server_id } });
  const r = await commands.waitFor(id, b.action === 'screenshot' ? 15000 : 8000);
  res.json({ commandId: id, status: r.status, result: r.result });
}));

router.post('/players/:id/ban', can('players.ban'), h(async (req, res) => {
  const p = await ownPlayer(req, req.params.id);
  const b = parse(z.object({ reason: z.string().trim().min(3).max(500), durationHours: z.number().int().min(0).max(87600),
    scope: z.enum(['org', 'server']).default('org'), serverId: uuid.optional() }), req.body);
  const identifiers = await db.many('SELECT kind, value FROM player_identifiers WHERE player_id=$1', [p.id]);
  const last = await db.one('SELECT server_id FROM player_sessions WHERE player_id=$1 ORDER BY started_at DESC LIMIT 1', [p.id]);
  const serverId = b.serverId || (last && last.server_id) || null;
  if (b.scope === 'server' && !serverId) return res.status(400).json({ error: 'serverId required for server-scoped ban' });
  if (serverId) { const own = await db.one('SELECT 1 FROM servers WHERE id=$1 AND org_id=$2', [serverId, req.user.orgId]); if (!own) throw notFound(); }
  const ban = await bans.createBan({ orgId: req.user.orgId, serverId, scope: b.scope, playerId: p.id, playerName: p.last_name, identifiers,
    reason: b.reason, automatic: false, issuedBy: req.user.id, issuedByName: req.user.name, durationHours: b.durationHours, ip: req.ip });
  res.json({ ok: true, banId: ban.id });
}));

// ─── Global lookup (org-wide) ───
router.get('/lookup', can('lookup.view'), h(async (req, res) => {
  const q = parse(z.string().trim().min(2).max(128), req.query.q || '');
  const org = req.user.orgId;
  const settings = await getSettings(org);
  let ids = [];
  let matchedBy = 'name';
  if (/^SB-[A-Z0-9]{8}$/i.test(q)) {
    matchedBy = 'ban';
    ids = (await db.many('SELECT player_id FROM bans WHERE org_id=$1 AND id=$2 AND player_id IS NOT NULL', [org, q.toUpperCase()])).map((r) => r.player_id);
  } else if (/^(license2?|steam|discord|fivem|xbl|live):/i.test(q)) {
    matchedBy = 'identifier';
    const i = q.indexOf(':');
    ids = (await db.many('SELECT DISTINCT player_id FROM player_identifiers WHERE org_id=$1 AND kind=$2 AND value=$3',
      [org, q.slice(0, i).toLowerCase(), q.slice(i + 1)])).map((r) => r.player_id);
  } else if (/^[0-9a-f]{40}$/i.test(q) || /^\d{15,20}$/.test(q) || /^1100001[0-9a-f]{8}$/i.test(q)) {
    matchedBy = 'identifier';
    ids = (await db.many('SELECT DISTINCT player_id FROM player_identifiers WHERE org_id=$1 AND value=$2', [org, q.toLowerCase()])).map((r) => r.player_id);
  }
  if (matchedBy === 'name' || !ids.length) {
    const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const r = await db.many('SELECT DISTINCT n.player_id FROM player_names n JOIN players p ON p.id=n.player_id WHERE p.org_id=$1 AND n.name ILIKE $2 LIMIT 50', [org, like]);
    if (!ids.length) { ids = r.map((x) => x.player_id); matchedBy = ids.length ? 'name' : matchedBy; }
  }
  const rows = ids.length ? await db.many(
    `SELECT p.id, p.last_name, p.license, p.first_seen, p.last_seen, p.risk_score, p.risk_updated_at, p.playtime_sec,
            (SELECT count(*) FROM detections d WHERE d.player_id=p.id AND d.action_taken <> 'suppressed') AS detections,
            (SELECT count(*) FROM bans b WHERE b.player_id=p.id) AS bans,
            EXISTS(SELECT 1 FROM bans b WHERE b.player_id=p.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())) AS banned,
            EXISTS(SELECT 1 FROM player_sessions ps WHERE ps.player_id=p.id AND ps.ended_at IS NULL AND ps.net_id IS NOT NULL) AS online,
            (SELECT array_agg(DISTINCT name) FROM player_names WHERE player_id=p.id) AS names
     FROM players p WHERE p.org_id=$1 AND p.id = ANY($2) ORDER BY p.last_seen DESC LIMIT 50`, [org, ids]) : [];
  res.json({ matchedBy, results: rows.map((r) => ({ ...r, risk: Math.round(decayedRisk(r.risk_score, r.risk_updated_at, settings.risk.halfLifeHours)), risk_score: undefined })) });
}));

// ─── All players (paged) ───
router.get('/players', can('players.view'), h(async (req, res) => {
  const { limit, offset } = page(req.query);
  const sort = { risk: 'p.risk_score DESC', recent: 'p.last_seen DESC', playtime: 'p.playtime_sec DESC' }[req.query.sort] || 'p.last_seen DESC';
  const rows = await db.many(
    `SELECT p.id, p.last_name, p.license, p.last_seen, p.first_seen, p.risk_score, p.risk_updated_at, p.playtime_sec,
            (SELECT count(*) FROM detections d WHERE d.player_id=p.id AND d.action_taken <> 'suppressed') AS detections
     FROM players p WHERE p.org_id=$1 ORDER BY ${sort} LIMIT $2 OFFSET $3`, [req.user.orgId, limit, offset]);
  const settings = await getSettings(req.user.orgId);
  res.json(rows.map((r) => ({ ...r, risk: Math.round(decayedRisk(r.risk_score, r.risk_updated_at, settings.risk.halfLifeHours)), risk_score: undefined })));
}));

module.exports = { router, ownPlayer };
