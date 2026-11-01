'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const { can } = require('../../middleware/auth');
const { audit } = require('../../lib/audit');
const { CATALOG } = require('../../detections/catalog');
const commands = require('../../services/commands');
const { getSettings } = require('../../lib/settings');
const { h, parse, page, uuid, notFound, actor, z } = require('./_util');

const router = express.Router();
const NAMES = Object.fromEntries(CATALOG.map((d) => [d.key, d.name]));

// ─── Evidence center ───
router.get('/evidence', can('evidence.view'), h(async (req, res) => {
  const { limit, offset } = page(req.query);
  const f = parse(z.object({ playerId: z.coerce.number().int().optional(), kind: z.enum(['screenshot', 'monitor_frame']).default('screenshot'),
    monitorId: z.coerce.number().int().optional() }), req.query);
  const rows = await db.many(
    `SELECT e.id, e.kind, e.player_id, p.last_name AS player_name, e.detection_id, d.detection_key, e.monitor_id, e.size_bytes, e.sha256,
            e.requested_by_name, e.meta, e.created_at, s.name AS server_name
     FROM evidence e LEFT JOIN players p ON p.id=e.player_id LEFT JOIN detections d ON d.id=e.detection_id LEFT JOIN servers s ON s.id=e.server_id
     WHERE e.org_id=$1 AND e.kind=$2 AND ($3::bigint IS NULL OR e.player_id=$3) AND ($4::bigint IS NULL OR e.monitor_id=$4)
     ORDER BY e.created_at ${f.monitorId ? 'ASC' : 'DESC'} LIMIT $5 OFFSET $6`,
    [req.user.orgId, f.kind, f.playerId || null, f.monitorId || null, f.monitorId ? 1000 : limit, offset]);
  res.json(rows.map((r) => ({ ...r, detection_name: r.detection_key ? NAMES[r.detection_key] : null })));
}));

/** Streams the image. Authenticated, org-scoped, never served from a public path. */
router.get('/evidence/:id/file', can('evidence.view', 'players.monitor'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const e = await db.one('SELECT storage_path, mime, kind FROM evidence WHERE id=$1 AND org_id=$2', [id, req.user.orgId]);
  if (!e) throw notFound();
  if (e.kind === 'screenshot' && !req.perms.has('evidence.view')) return res.status(403).json({ error: 'forbidden' });
  const abs = path.resolve(config.evidenceDir, e.storage_path);
  if (!abs.startsWith(config.evidenceDir + path.sep)) throw notFound();
  res.set({ 'Content-Type': e.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  fs.createReadStream(abs).on('error', () => res.status(404).end()).pipe(res);
}));

// ─── Monitoring (periodic screenshots; FiveM cannot stream video) ───
router.post('/monitor/start', can('players.monitor'), h(async (req, res) => {
  const b = parse(z.object({ playerId: z.number().int(), intervalMs: z.number().int().min(1000).max(60000).optional(), record: z.boolean().default(false) }), req.body);
  const settings = await getSettings(req.user.orgId);
  const s = await db.one(`SELECT ps.id, ps.net_id, ps.server_id, ps.name FROM player_sessions ps JOIN servers sv ON sv.id=ps.server_id
                          WHERE ps.player_id=$1 AND sv.org_id=$2 AND ps.ended_at IS NULL AND ps.net_id IS NOT NULL AND sv.status='online'
                          ORDER BY ps.started_at DESC LIMIT 1`, [b.playerId, req.user.orgId]);
  if (!s) return res.status(409).json({ error: 'Player is not online' });
  const existing = await db.one('SELECT id FROM monitor_sessions WHERE player_id=$1 AND server_id=$2 AND stopped_at IS NULL', [b.playerId, s.server_id]);
  if (existing) return res.json({ monitorId: existing.id, existing: true });
  const interval = Math.max(settings.monitoring.minIntervalMs, b.intervalMs || settings.monitoring.defaultIntervalMs);
  const m = await db.one(`INSERT INTO monitor_sessions(org_id, server_id, player_id, net_id, interval_ms, record, started_by_name)
                          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [req.user.orgId, s.server_id, b.playerId, s.net_id, interval, b.record, req.user.name]);
  await commands.enqueue(s.server_id, 'monitor_start', { netId: s.net_id, sessionId: s.id, monitorId: m.id, intervalMs: interval,
    maxFrames: settings.monitoring.maxFramesPerSession, requestedBy: req.user.name + ' (monitor)' }, req.user.name);
  await audit({ ...actor(req), action: 'monitor.start', targetType: 'player', targetId: b.playerId, details: { monitorId: m.id, record: b.record, intervalMs: interval } });
  res.json({ monitorId: m.id, serverId: s.server_id, netId: s.net_id, intervalMs: interval });
}));

router.post('/monitor/:id/stop', can('players.monitor'), h(async (req, res) => {
  const id = parse(z.coerce.number().int(), req.params.id);
  const m = await db.one('UPDATE monitor_sessions SET stopped_at=now() WHERE id=$1 AND org_id=$2 AND stopped_at IS NULL RETURNING *', [id, req.user.orgId]);
  if (!m) throw notFound('active monitor not found');
  await commands.enqueue(m.server_id, 'monitor_stop', { monitorId: m.id }, req.user.name);
  await audit({ ...actor(req), action: 'monitor.stop', targetType: 'player', targetId: m.player_id, details: { monitorId: m.id, frames: m.frames } });
  res.json({ ok: true });
}));

router.get('/monitor', can('players.monitor'), h(async (req, res) => {
  const rows = await db.many(
    `SELECT m.*, p.last_name AS player_name, s.name AS server_name,
            (SELECT e.id FROM evidence e WHERE e.monitor_id=m.id ORDER BY e.created_at DESC LIMIT 1) AS last_frame
     FROM monitor_sessions m JOIN players p ON p.id=m.player_id JOIN servers s ON s.id=m.server_id
     WHERE m.org_id=$1 AND (m.stopped_at IS NULL OR m.record) ORDER BY m.stopped_at IS NULL DESC, m.started_at DESC LIMIT 100`, [req.user.orgId]);
  res.json(rows);
}));

// ─── Session replay (telemetry, not video) ───
router.get('/replay/sessions', can('replay.view'), h(async (req, res) => {
  const f = parse(z.object({ playerId: z.coerce.number().int().optional(), serverId: uuid.optional() }), req.query);
  const rows = await db.many(
    `SELECT ps.id, ps.player_id, ps.name, ps.net_id, ps.started_at, ps.ended_at, ps.end_reason, s.name AS server_name,
            (SELECT count(*) FROM detections d WHERE d.session_id=ps.id AND d.action_taken <> 'suppressed') AS detections,
            EXISTS(SELECT 1 FROM telemetry t WHERE t.session_id=ps.id) AS has_telemetry
     FROM player_sessions ps JOIN servers s ON s.id=ps.server_id
     WHERE s.org_id=$1 AND ($2::bigint IS NULL OR ps.player_id=$2) AND ($3::uuid IS NULL OR ps.server_id=$3) AND ps.net_id IS NOT NULL
     ORDER BY ps.started_at DESC LIMIT 100`, [req.user.orgId, f.playerId || null, f.serverId || null]);
  res.json(rows);
}));

router.get('/replay/:sessionId', can('replay.view'), h(async (req, res) => {
  const sid = parse(z.coerce.number().int(), req.params.sessionId);
  const s = await db.one(`SELECT ps.*, s.name AS server_name FROM player_sessions ps JOIN servers s ON s.id=ps.server_id WHERE ps.id=$1 AND s.org_id=$2`, [sid, req.user.orgId]);
  if (!s) throw notFound('session not found');
  const [samples, events, dets, evidence] = await Promise.all([
    db.many(`SELECT extract(epoch from ts)*1000 AS t, x, y, z, heading AS h, health AS hp, armor AS ar, weapon AS w, vehicle_model AS vm, speed AS s, bucket AS b, flags AS f
             FROM telemetry WHERE session_id=$1 ORDER BY ts LIMIT 50000`, [sid]),
    db.many(`SELECT extract(epoch from ts)*1000 AS t, kind, data FROM game_events WHERE session_id=$1 ORDER BY ts LIMIT 5000`, [sid]),
    db.many(`SELECT id, extract(epoch from created_at)*1000 AS t, detection_key, severity, verified, action_taken, details FROM detections WHERE session_id=$1 ORDER BY created_at`, [sid]),
    req.perms.has('evidence.view') ? db.many(`SELECT e.id, extract(epoch from e.created_at)*1000 AS t, e.kind FROM evidence e
             WHERE e.player_id=$1 AND e.created_at BETWEEN $2 AND COALESCE($3, now()) ORDER BY e.created_at`, [s.player_id, s.started_at, s.ended_at]) : [],
  ]);
  res.json({
    session: { id: s.id, playerId: s.player_id, name: s.name, netId: s.net_id, server: s.server_name, startedAt: s.started_at, endedAt: s.ended_at, endReason: s.end_reason },
    samples: samples.map((r) => ({ ...r, t: Math.round(r.t) })), events: events.map((e) => ({ ...e, t: Math.round(e.t) })),
    detections: dets.map((d) => ({ ...d, t: Math.round(d.t), name: NAMES[d.detection_key] || d.detection_key })),
    evidence: evidence.map((e) => ({ ...e, t: Math.round(e.t) })),
  });
}));

module.exports = router;
