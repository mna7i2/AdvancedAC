'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const log = require('../lib/logger');
const realtime = require('../lib/realtime');
const discord = require('../lib/discord');
const { audit } = require('../lib/audit');
const { activity } = require('../lib/activity');
const { getSettings } = require('../lib/settings');
const { effectivePermissions } = require('../lib/permissions');
const { agentAuth } = require('../middleware/agentAuth');
const players = require('../services/players');
const bans = require('../services/bans');
const commands = require('../services/commands');
const enforcement = require('../services/enforcement');
const { createSession } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '4mb' }));
router.use(rateLimit({ windowMs: 10000, limit: 400, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.get('authorization') || req.ip).slice(-24) }));
router.use(agentAuth);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const parse = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw Object.assign(new Error('invalid payload: ' + r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')), { status: 400 });
  return r.data;
};

const num = z.number().finite();
// Lua's json.encode turns an empty table into [] — accept that as an empty object.
const obj = () => z.preprocess((v) => (Array.isArray(v) && v.length === 0 ? {} : v), z.record(z.any()));
const ident = z.array(z.string().max(160)).max(40);

// ─── Config sent to the resource ───
async function buildAgentConfig(server) {
  const [detections, settings, staffRows] = await Promise.all([
    enforcement.orgDetectionConfig(server.org_id, { fresh: true }),
    getSettings(server.org_id),
    db.many(`SELECT a.display_name, a.linked_identifiers, a.extra_permissions, a.denied_permissions, r.permissions
             FROM admin_users a JOIN roles r ON r.id = a.role_id
             WHERE a.org_id = $1 AND a.active AND cardinality(a.linked_identifiers) > 0`, [server.org_id]),
  ]);
  return {
    detections,
    telemetry: settings.telemetry,
    monitoring: settings.monitoring,
    zones: (settings.zones.list || []).filter((zn) => zn.enabled !== false),
    enforcement: { kickMessage: settings.enforcement.kickMessage, banMessage: settings.enforcement.banMessage, appealUrl: settings.general.appealUrl },
    staff: staffRows.map((s) => ({
      name: s.display_name,
      identifiers: s.linked_identifiers,
      permissions: effectivePermissions(s.permissions, s.extra_permissions, s.denied_permissions),
    })),
  };
}

async function openSession(server, playerRow, name) {
  return db.one(
    'INSERT INTO player_sessions(org_id, server_id, player_id, name) VALUES ($1,$2,$3,$4) RETURNING id',
    [server.org_id, server.id, playerRow.id, name]);
}

async function closeSession(sessionId, serverId, reason) {
  const s = await db.one(
    `UPDATE player_sessions SET ended_at = now(), end_reason = $3
     WHERE id = $1 AND server_id = $2 AND ended_at IS NULL RETURNING *`, [sessionId, serverId, reason]);
  if (s) {
    await db.query('UPDATE players SET playtime_sec = playtime_sec + $2, last_seen = now() WHERE id = $1',
      [s.player_id, Math.max(0, Math.round((new Date(s.ended_at) - new Date(s.started_at)) / 1000))]);
  }
  return s;
}

// ─── Handshake ───
const HandshakeSchema = z.object({
  acVersion: z.string().max(32),
  hostname: z.string().max(256).default(''),
  fingerprint: z.string().max(256).min(3),
  maxPlayers: z.number().int().min(0).max(4096),
  framework: z.string().max(32).default('standalone'),
  onesync: z.boolean(),
  resources: z.array(z.string().max(128)).max(2000).default([]),
  players: z.array(z.object({
    netId: z.number().int(), name: z.string().max(128), identifiers: ident,
    tokens: z.array(z.string().max(200)).max(40).default([]), endpoint: z.string().max(64).optional(),
  })).max(2048).default([]),
});

router.post('/handshake', wrap(async (req, res) => {
  const b = parse(HandshakeSchema, req.body);
  let server = req.server;
  if (!server.fingerprint) {
    server = await db.one('UPDATE servers SET fingerprint=$2 WHERE id=$1 RETURNING *', [server.id, b.fingerprint]);
    await audit({ orgId: server.org_id, actorType: 'server', actorId: server.id, actorName: server.name, action: 'server.bind', details: { fingerprint: b.fingerprint } });
  } else if (server.fingerprint !== b.fingerprint) {
    return res.status(403).json({ error: 'fingerprint_mismatch' });
  }
  server = await db.one(
    `UPDATE servers SET status='online', last_heartbeat=now(), last_ip=$2, ac_version=$3, hostname=$4,
       max_players=$5, framework=$6, onesync=$7, resources=$8, player_count=$9
     WHERE id=$1 RETURNING *`,
    [server.id, req.ip, b.acVersion, b.hostname, b.maxPlayers, b.framework, b.onesync,
      JSON.stringify(b.resources.map((name) => ({ name, state: 'started' }))), b.players.length]);

  // Resync sessions after a resource restart: close stale, open for current players.
  await db.query(`UPDATE player_sessions SET ended_at=now(), end_reason='resync'
                  WHERE server_id=$1 AND ended_at IS NULL`, [server.id]);
  const sessions = [];
  for (const p of b.players) {
    const ids = players.normalizeIdentifiers(p.identifiers, p.tokens, p.endpoint);
    try {
      const pl = await players.upsertPlayer(server.org_id, p.name, ids);
      const s = await openSession(server, pl, p.name);
      await db.query('UPDATE player_sessions SET net_id=$2 WHERE id=$1', [s.id, p.netId]);
      sessions.push({ netId: p.netId, sessionId: s.id, playerId: pl.id });
    } catch (e) { log.warn('resync player failed', { err: e.message }); }
  }

  realtime.toOrg(server.org_id, 'server:status', publicServer(server));
  await activity(server.org_id, server.id, 'server', `${server.name} connected (AC ${b.acVersion}, ${b.framework})`);
  if (!b.onesync) {
    discord.notify(server.org_id, 'resource', discord.simpleEmbed('⚠️ OneSync disabled', `${server.name}: most server-side detections require OneSync.`, 'orange'));
  }
  res.json({
    serverId: server.id, serverName: server.name, configVersion: server.config_version,
    latestVersion: config.acLatestVersion, config: await buildAgentConfig(server), sessions,
    bans: await bans.syncList(server.org_id, server.id), serverTime: Date.now(),
  });
}));

// ─── Heartbeat (state + telemetry + command poll) ───
const StateSchema = z.object({
  sessionId: z.number().int(), netId: z.number().int(), ping: z.number().int().min(0).max(100000),
  x: num, y: num, z: num, h: num, hp: z.number().int(), mhp: z.number().int(), ar: z.number().int(),
  w: z.number().int(), vm: z.number().int(), s: num, b: z.number().int(), f: z.number().int().min(0).max(255),
});
const SampleSchema = z.object({
  sessionId: z.number().int(), t: z.number().int(), x: num, y: num, z: num, h: num,
  hp: z.number().int(), ar: z.number().int(), w: z.number().int(), vm: z.number().int(), s: num, b: z.number().int(), f: z.number().int(),
});
const HeartbeatSchema = z.object({
  uptime: z.number().int().min(0),
  configVersion: z.number().int(),
  players: z.array(StateSchema).max(2048),
  samples: z.array(SampleSchema).max(20000).default([]),
  events: z.array(z.object({ sessionId: z.number().int().nullable(), t: z.number().int(), kind: z.string().max(32), data: obj().default({}) })).max(5000).default([]),
  console: z.array(z.object({ t: z.number().int(), ch: z.string().max(64), line: z.string().max(2000) })).max(2000).default([]),
  acks: z.array(z.object({ id: z.number().int(), ok: z.boolean(), result: obj().optional() })).max(200).default([]),
  resources: z.array(z.object({ name: z.string().max(128), state: z.string().max(16) })).max(2000).optional(),
});

router.post('/heartbeat', wrap(async (req, res) => {
  const b = parse(HeartbeatSchema, req.body);
  const server = req.server;
  const wasOffline = server.status !== 'online';
  await db.query(
    `UPDATE servers SET status='online', last_heartbeat=now(), player_count=$2, last_ip=$3,
       resources = COALESCE($4::jsonb, resources), started_at = now() - ($5 || ' seconds')::interval
     WHERE id=$1`,
    [server.id, b.players.length, req.ip, b.resources ? JSON.stringify(b.resources) : null, b.uptime]);
  if (wasOffline) realtime.toOrg(server.org_id, 'server:status', { id: server.id, status: 'online' });

  await db.query(
    `INSERT INTO server_stats(server_id, ts, players) VALUES ($1, date_trunc('minute', now()), $2)
     ON CONFLICT (server_id, ts) DO UPDATE SET players = GREATEST(server_stats.players, EXCLUDED.players)`,
    [server.id, b.players.length]);

  if (b.players.length) {
    await db.query(
      `UPDATE player_sessions ps SET last_state = x.st
       FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, st jsonb)
       WHERE ps.id = x.id AND ps.server_id = $2 AND ps.ended_at IS NULL`,
      [JSON.stringify(b.players.map((p) => ({ id: p.sessionId, st: p }))), server.id]);
  }
  if (b.samples.length) {
    await db.query(
      `INSERT INTO telemetry(session_id, ts, x, y, z, heading, health, armor, weapon, vehicle_model, speed, bucket, flags)
       SELECT x."sessionId", to_timestamp(x.t / 1000.0), x.x, x.y, x.z, x.h, x.hp, x.ar, x.w, x.vm, x.s, x.b, x.f
       FROM jsonb_to_recordset($1::jsonb) AS x("sessionId" bigint, t bigint, x real, y real, z real, h real,
            hp int, ar int, w bigint, vm bigint, s real, b int, f int)
       JOIN player_sessions ps ON ps.id = x."sessionId" AND ps.server_id = $2`,
      [JSON.stringify(b.samples), server.id]);
  }
  if (b.events.length) {
    await db.query(
      `INSERT INTO game_events(session_id, server_id, ts, kind, data)
       SELECT CASE WHEN ps.id IS NULL THEN NULL ELSE x."sessionId" END, $2, to_timestamp(x.t / 1000.0), x.kind, x.data
       FROM jsonb_to_recordset($1::jsonb) AS x("sessionId" bigint, t bigint, kind text, data jsonb)
       LEFT JOIN player_sessions ps ON ps.id = x."sessionId" AND ps.server_id = $2`,
      [JSON.stringify(b.events), server.id]);
  }
  if (b.console.length) {
    await db.query(
      `INSERT INTO console_lines(server_id, ts, channel, line)
       SELECT $2, to_timestamp(x.t / 1000.0), x.ch, x.line FROM jsonb_to_recordset($1::jsonb) AS x(t bigint, ch text, line text)`,
      [JSON.stringify(b.console), server.id]);
    realtime.toConsole(server.id, b.console);
  }
  await commands.ack(server.id, b.acks);

  realtime.toServer(server.id, 'players:update', { serverId: server.id, players: b.players, t: Date.now() });
  realtime.toOrg(server.org_id, 'server:tick', { id: server.id, playerCount: b.players.length, uptime: b.uptime });

  const cur = await db.one('SELECT config_version FROM servers WHERE id=$1', [server.id]);
  const out = { commands: await commands.takePending(server.id), configVersion: cur.config_version, serverTime: Date.now() };
  if (cur.config_version !== b.configVersion) out.config = await buildAgentConfig(server);
  res.json(out);
}));

// ─── Player lifecycle ───
const ConnectingSchema = z.object({
  name: z.string().min(1).max(128), identifiers: ident,
  tokens: z.array(z.string().max(200)).max(40).default([]), endpoint: z.string().max(64).optional(),
});

router.post('/player/connecting', wrap(async (req, res) => {
  const b = parse(ConnectingSchema, req.body);
  const server = req.server;
  const ids = players.normalizeIdentifiers(b.identifiers, b.tokens, b.endpoint);
  if (!ids.some((i) => i.kind === 'license' || i.kind === 'license2')) {
    return res.json({ allow: false, message: 'Sentinel AC: a Rockstar license identifier is required.' });
  }
  const settings = await getSettings(server.org_id);
  const pl = await players.upsertPlayer(server.org_id, b.name, ids);
  const hit = await bans.findActiveBan(server.org_id, server.id, ids);
  if (hit) {
    if (hit.match === 'identifier' || settings.enforcement.tokenOnlyMatch === 'block') {
      await activity(server.org_id, server.id, 'ban_blocked', `${b.name} tried to join while banned (${hit.ban.id})`, { banId: hit.ban.id, playerId: pl.id });
      return res.json({ allow: false, banId: hit.ban.id, message: bans.formatBanMessage(settings.enforcement.banMessage, hit.ban, settings.general.appealUrl) });
    }
    // Token-only match: never auto-ban on uncertain identity — allow, alert staff.
    await activity(server.org_id, server.id, 'ban_evasion_suspect',
      `${b.name} shares hardware tokens with banned player ${hit.ban.player_name} (${hit.ban.id}) — review`, { banId: hit.ban.id, playerId: pl.id });
    discord.notify(server.org_id, 'critical', discord.simpleEmbed('🔎 Possible ban evasion',
      `**${b.name}** shares hardware tokens with banned **${hit.ban.player_name}** (\`${hit.ban.id}\`). Allowed in — please review.`, 'orange', server.name));
  }
  const s = await openSession(server, pl, b.name);
  res.json({ allow: true, sessionId: s.id, playerId: pl.id });
}));

router.post('/player/joined', wrap(async (req, res) => {
  const b = parse(z.object({ sessionId: z.number().int(), netId: z.number().int() }), req.body);
  const s = await db.one(
    'UPDATE player_sessions SET net_id=$3 WHERE id=$1 AND server_id=$2 AND ended_at IS NULL RETURNING *',
    [b.sessionId, req.server.id, b.netId]);
  if (!s) return res.status(404).json({ error: 'unknown session' });
  await activity(req.server.org_id, req.server.id, 'join', `${s.name} joined [${b.netId}]`, { playerId: s.player_id, sessionId: s.id });
  realtime.toServer(req.server.id, 'player:join', { sessionId: s.id, playerId: s.player_id, netId: b.netId, name: s.name });
  discord.notify(req.server.org_id, 'connect', discord.simpleEmbed('➡️ Player joined', `**${s.name}** [${b.netId}]`, 'green', req.server.name));
  res.json({ ok: true });
}));

router.post('/player/dropped', wrap(async (req, res) => {
  const b = parse(z.object({ sessionId: z.number().int(), reason: z.string().max(512).default('') }), req.body);
  const s = await closeSession(b.sessionId, req.server.id, b.reason);
  if (s) {
    const mons = await db.many('UPDATE monitor_sessions SET stopped_at=now() WHERE server_id=$1 AND player_id=$2 AND stopped_at IS NULL RETURNING id',
      [req.server.id, s.player_id]);
    for (const m of mons) realtime.toServer(req.server.id, 'monitor:stopped', { monitorId: m.id, reason: 'player left' });
  }
  if (s && s.net_id != null) {
    await activity(req.server.org_id, req.server.id, 'leave', `${s.name} left (${b.reason || 'disconnected'})`, { playerId: s.player_id, sessionId: s.id });
    realtime.toServer(req.server.id, 'player:leave', { sessionId: s.id, playerId: s.player_id, netId: s.net_id, reason: b.reason });
    discord.notify(req.server.org_id, 'disconnect', discord.simpleEmbed('⬅️ Player left', `**${s.name}** — ${b.reason || 'disconnected'}`, 'gray', req.server.name));
  }
  res.json({ ok: true });
}));

// ─── Detections ───
router.post('/detection', wrap(async (req, res) => {
  const b = parse(z.object({
    sessionId: z.number().int(), key: z.string().max(64), details: obj().default({}),
  }), req.body);
  res.json(await enforcement.processDetection(req.server, b));
}));

// ─── Evidence upload (screenshots / monitor frames) ───
const MAGIC = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
router.post('/evidence', wrap(async (req, res) => {
  const b = parse(z.object({
    sessionId: z.number().int(), detectionId: z.number().int().nullable().optional(), monitorId: z.number().int().nullable().optional(),
    requestedBy: z.string().max(128).default('Sentinel AC'), data: z.string().max(4_000_000), meta: obj().default({}),
  }), req.body);
  const m = b.data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'expected image data URI' });
  const buf = Buffer.from(m[2], 'base64');
  const magic = MAGIC[m[1]];
  if (buf.length < 100 || buf.length > 3_000_000 || !magic.every((x, i) => buf[i] === x)) return res.status(400).json({ error: 'invalid image' });
  const session = await db.one('SELECT * FROM player_sessions WHERE id=$1 AND server_id=$2', [b.sessionId, req.server.id]);
  if (!session) return res.status(404).json({ error: 'unknown session' });
  if (b.detectionId) {
    const ok = await db.one('SELECT 1 FROM detections WHERE id=$1 AND server_id=$2', [b.detectionId, req.server.id]);
    if (!ok) return res.status(400).json({ error: 'unknown detection' });
  }
  let monitor = null;
  if (b.monitorId) {
    monitor = await db.one('SELECT * FROM monitor_sessions WHERE id=$1 AND server_id=$2', [b.monitorId, req.server.id]);
    if (!monitor) return res.status(400).json({ error: 'unknown monitor session' });
  }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[m[1]];
  const id = crypto.randomUUID();
  const rel = path.join(req.server.org_id, new Date().toISOString().slice(0, 7), `${id}.${ext}`);
  const abs = path.join(config.evidenceDir, rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf, { mode: 0o600 });
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const kind = monitor ? 'monitor_frame' : 'screenshot';
  const ev = await db.one(
    `INSERT INTO evidence(id, org_id, server_id, player_id, detection_id, monitor_id, kind, storage_path, mime, size_bytes, sha256, requested_by_name, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, kind, created_at`,
    [id, req.server.org_id, req.server.id, session.player_id, b.detectionId || null, monitor ? monitor.id : null, kind, rel, m[1], buf.length, sha, b.requestedBy, b.meta]);
  if (monitor) {
    await db.query('UPDATE monitor_sessions SET frames = frames + 1 WHERE id=$1', [monitor.id]);
    realtime.toServer(req.server.id, 'monitor:frame', { monitorId: monitor.id, evidenceId: id, sessionId: session.id, netId: session.net_id, t: Date.now() });
    // Live-only (non-recording) monitors keep just the latest few frames.
    if (!monitor.record) {
      const old = await db.many(
        `DELETE FROM evidence WHERE monitor_id=$1 AND id NOT IN (SELECT id FROM evidence WHERE monitor_id=$1 ORDER BY created_at DESC LIMIT 3)
         RETURNING storage_path`, [monitor.id]);
      for (const o of old) fs.promises.unlink(path.join(config.evidenceDir, o.storage_path)).catch(() => {});
    }
  } else {
    realtime.toOrg(req.server.org_id, 'evidence', { id, kind, playerId: session.player_id, detectionId: b.detectionId || null, createdAt: ev.created_at, requestedBy: b.requestedBy });
  }
  res.json({ ok: true, evidenceId: id });
}));

// ─── Ban cache sync ───
router.get('/bans', wrap(async (req, res) => {
  res.json({ bans: await bans.syncList(req.server.org_id, req.server.id) });
}));

// ─── In-game admin actions (resource is trusted: it already checked ACE/staff permission) ───
const AdminSchema = z.object({ name: z.string().max(128), identifiers: ident, via: z.enum(['staff', 'ace']) });

async function resolveIngameAdmin(orgId, admin) {
  const row = await db.one(
    `SELECT id, display_name FROM admin_users WHERE org_id=$1 AND active AND linked_identifiers && $2::text[] LIMIT 1`,
    [orgId, admin.identifiers]);
  const lic = admin.identifiers.find((i) => i.startsWith('license:')) || admin.identifiers[0] || '';
  return row ? { id: row.id, name: `${row.display_name} (in-game)` } : { id: null, name: `${admin.name} [${lic}] (ACE)` };
}

router.post('/admin/ban', wrap(async (req, res) => {
  const b = parse(z.object({ admin: AdminSchema, sessionId: z.number().int(), reason: z.string().min(1).max(500), durationHours: z.number().int().min(0).max(87600) }), req.body);
  const s = await db.one('SELECT * FROM player_sessions WHERE id=$1 AND server_id=$2', [b.sessionId, req.server.id]);
  if (!s) return res.status(404).json({ error: 'unknown session' });
  const who = await resolveIngameAdmin(req.server.org_id, b.admin);
  const settings = await getSettings(req.server.org_id);
  const ban = await bans.createBan({
    orgId: req.server.org_id, serverId: req.server.id, playerId: s.player_id, playerName: s.name,
    identifiers: await players.identifiersOf(s.player_id), reason: b.reason, automatic: false,
    issuedBy: who.id, issuedByName: who.name, durationHours: b.durationHours, serverName: req.server.name,
  });
  res.json({ ok: true, banId: ban.id, message: bans.formatBanMessage(settings.enforcement.banMessage, ban, settings.general.appealUrl) });
}));

router.post('/admin/unban', wrap(async (req, res) => {
  const b = parse(z.object({ admin: AdminSchema, banId: z.string().max(16), reason: z.string().max(500).default('') }), req.body);
  const who = await resolveIngameAdmin(req.server.org_id, b.admin);
  const ban = await bans.revokeBan(req.server.org_id, b.banId.toUpperCase(), { byId: who.id, byName: who.name, reason: b.reason, actorType: 'ingame_admin' });
  res.json(ban ? { ok: true } : { ok: false, error: 'ban not found or already revoked' });
}));

router.post('/admin/lookup', wrap(async (req, res) => {
  const b = parse(z.object({ sessionId: z.number().int() }), req.body);
  const s = await db.one(
    `SELECT ps.player_id, p.risk_score, p.risk_updated_at, p.first_seen, p.playtime_sec, p.license
     FROM player_sessions ps JOIN players p ON p.id = ps.player_id WHERE ps.id=$1 AND ps.server_id=$2`, [b.sessionId, req.server.id]);
  if (!s) return res.status(404).json({ error: 'unknown session' });
  const settings = await getSettings(req.server.org_id);
  const [dets, bansRows, names] = await Promise.all([
    db.many(`SELECT detection_key, severity, action_taken, created_at FROM detections WHERE player_id=$1 ORDER BY id DESC LIMIT 15`, [s.player_id]),
    db.many(`SELECT id, reason, created_at, expires_at, revoked_at FROM bans WHERE player_id=$1 ORDER BY created_at DESC LIMIT 10`, [s.player_id]),
    db.many(`SELECT name FROM player_names WHERE player_id=$1 ORDER BY last_seen DESC LIMIT 10`, [s.player_id]),
  ]);
  res.json({
    playerId: s.player_id, license: s.license, firstSeen: s.first_seen, playtimeSec: Number(s.playtime_sec),
    risk: Math.round(players.decayedRisk(s.risk_score, s.risk_updated_at, settings.risk.halfLifeHours)),
    detections: dets, bans: bansRows, names: names.map((n) => n.name),
  });
}));

router.post('/audit', wrap(async (req, res) => {
  const b = parse(z.object({ entries: z.array(z.object({
    admin: AdminSchema, action: z.string().max(64), targetSessionId: z.number().int().nullable().optional(), details: obj().default({}),
  })).max(100) }), req.body);
  for (const e of b.entries) {
    const who = await resolveIngameAdmin(req.server.org_id, e.admin);
    let target = null;
    if (e.targetSessionId) target = await db.one('SELECT player_id, name FROM player_sessions WHERE id=$1 AND server_id=$2', [e.targetSessionId, req.server.id]);
    await audit({ orgId: req.server.org_id, actorType: 'ingame_admin', actorId: who.id, actorName: who.name, action: 'ingame.' + e.action,
      targetType: target ? 'player' : null, targetId: target ? target.player_id : null, details: { ...e.details, via: e.admin.via, server: req.server.name } });
    await activity(req.server.org_id, req.server.id, 'admin', `${who.name}: ${e.action}${target ? ' → ' + target.name : ''}`);
  }
  res.json({ ok: true });
}));

// ─── In-game panel session: the same dashboard, opened with /adv ───
// Issued only for a player whose identifiers are linked to an active dashboard account of this org.
// The token is a normal (revocable, audited) dashboard session with a short lifetime.
router.post('/staff/session', wrap(async (req, res) => {
  const b = parse(z.object({ name: z.string().max(128), identifiers: ident }), req.body);
  const strong = b.identifiers.filter((i) => /^(license2?|steam|discord|fivem|xbl|live):/.test(i));
  const u = strong.length ? await db.one(
    `SELECT a.id, a.display_name FROM admin_users a
     WHERE a.org_id=$1 AND a.active AND a.linked_identifiers && $2::text[] LIMIT 1`, [req.server.org_id, strong]) : null;
  if (!u) return res.json({ ok: false, reason: 'not_linked' });
  const token = await createSession(u.id, req.ip, `in-game panel (${req.server.name})`, 6);
  await audit({ orgId: req.server.org_id, actorType: 'ingame_admin', actorId: u.id, actorName: `${u.display_name} (in-game)`,
    action: 'auth.ingame_session', details: { server: req.server.name, player: b.name } });
  res.json({ ok: true, token, name: u.display_name, apiBase: config.publicUrl, serverId: req.server.id });
}));

// ─── Server-side alerts (resource stop/start etc.) ───
router.post('/alert', wrap(async (req, res) => {
  const b = parse(z.object({ kind: z.string().max(48), message: z.string().max(500), data: obj().default({}) }), req.body);
  await activity(req.server.org_id, req.server.id, 'resource', `${req.server.name}: ${b.message}`, { kind: b.kind, ...b.data });
  discord.notify(req.server.org_id, 'resource', discord.simpleEmbed('🧩 ' + b.kind, b.message, 'orange', req.server.name));
  res.json({ ok: true });
}));

router.post('/shutdown', wrap(async (req, res) => {
  const open = await db.many('SELECT id FROM player_sessions WHERE server_id=$1 AND ended_at IS NULL', [req.server.id]);
  for (const s of open) await closeSession(s.id, req.server.id, 'server stopped');
  await db.query("UPDATE servers SET status='offline', player_count=0 WHERE id=$1", [req.server.id]);
  realtime.toOrg(req.server.org_id, 'server:status', { id: req.server.id, status: 'offline' });
  await activity(req.server.org_id, req.server.id, 'server', `${req.server.name} stopped the anti-cheat resource`);
  discord.notify(req.server.org_id, 'resource', discord.simpleEmbed('🛑 Anti-cheat stopped', `${req.server.name}: AdvancedAC resource stopped.`, 'red', req.server.name));
  res.json({ ok: true });
}));

function publicServer(s) {
  return { id: s.id, name: s.name, status: s.status, playerCount: s.player_count, maxPlayers: s.max_players,
    acVersion: s.ac_version, framework: s.framework, onesync: s.onesync, startedAt: s.started_at, lastHeartbeat: s.last_heartbeat };
}

module.exports = { router, closeSession, publicServer };
