'use strict';
const express = require('express');
const db = require('../../db');
const config = require('../../config');
const { audit } = require('../../lib/audit');
const { can } = require('../../middleware/auth');
const orgs = require('../../services/orgs');
const commands = require('../../services/commands');
const { clearLicenseCache } = require('../../middleware/agentAuth');
const { activeLicense } = require('../../services/license');
const { h, parse, uuid, notFound, actor, z } = require('./_util');

const router = express.Router();

async function ownServer(req, id) {
  parse(uuid, id);
  const s = await db.one('SELECT * FROM servers WHERE id=$1 AND org_id=$2', [id, req.user.orgId]);
  if (!s) throw notFound('server not found');
  return s;
}

function view(s, full = false) {
  const out = {
    id: s.id, name: s.name, description: s.description, status: s.status, playerCount: s.player_count,
    maxPlayers: s.max_players, acVersion: s.ac_version, latestVersion: config.acLatestVersion, framework: s.framework,
    onesync: s.onesync, hostname: s.hostname, startedAt: s.status === 'online' ? s.started_at : null,
    lastHeartbeat: s.last_heartbeat, bound: !!s.fingerprint, keyPrefix: s.api_key_prefix, createdAt: s.created_at,
    resources: s.resources, maintenance: s.maintenance || null, health: s.health || {},
  };
  if (full) { out.fingerprint = s.fingerprint; out.ip = s.last_ip; }
  return out;
}

router.get('/servers', can('dashboard.view'), h(async (req, res) => {
  const rows = await db.many('SELECT * FROM servers WHERE org_id=$1 ORDER BY created_at', [req.user.orgId]);
  res.json(rows.map((s) => view(s, req.perms.has('servers.manage'))));
}));

router.get('/servers/:id', can('dashboard.view'), h(async (req, res) => {
  res.json(view(await ownServer(req, req.params.id), req.perms.has('servers.manage')));
}));

router.post('/servers', can('servers.manage'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(64), description: z.string().max(200).default('') }), req.body);
  const lic = await activeLicense(req.user.orgId);
  const count = await db.one('SELECT count(*)::int n FROM servers WHERE org_id=$1', [req.user.orgId]);
  if (!lic) return res.status(402).json({ error: 'No active license' });
  if (count.n >= lic.max_servers) return res.status(402).json({ error: `Your license allows ${lic.max_servers} server(s)` });
  const s = await orgs.createServer(req.user.orgId, b.name, b.description);
  await audit({ ...actor(req), action: 'server.create', targetType: 'server', targetId: s.id, details: { name: b.name } });
  res.json({ id: s.id, apiKey: s.apiKey });
}));

router.patch('/servers/:id', can('servers.manage'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(64).optional(), description: z.string().max(200).optional() }), req.body);
  await db.query('UPDATE servers SET name=COALESCE($2,name), description=COALESCE($3,description) WHERE id=$1', [s.id, b.name, b.description]);
  await audit({ ...actor(req), action: 'server.update', targetType: 'server', targetId: s.id, details: b });
  res.json({ ok: true });
}));

router.post('/servers/:id/rotate-key', can('servers.manage'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const key = await orgs.rotateServerKey(req.user.orgId, s.id);
  clearLicenseCache();
  await audit({ ...actor(req), action: 'server.rotate_key', targetType: 'server', targetId: s.id });
  res.json({ apiKey: key });
}));

router.post('/servers/:id/reset-binding', can('servers.manage'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  await db.query('UPDATE servers SET fingerprint=NULL WHERE id=$1', [s.id]);
  clearLicenseCache();
  await audit({ ...actor(req), action: 'server.reset_binding', targetType: 'server', targetId: s.id });
  res.json({ ok: true });
}));

router.delete('/servers/:id', can('servers.manage'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  parse(z.object({ confirm: z.literal(s.name) }), req.body);
  await db.query('DELETE FROM servers WHERE id=$1', [s.id]);
  await audit({ ...actor(req), action: 'server.delete', targetType: 'server', targetId: s.id, details: { name: s.name } });
  res.json({ ok: true });
}));

// ─── Server tools: console, resources, announcements, entity cleanup ───
router.get('/servers/:id/console', can('console.view'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const before = parseInt(req.query.before, 10) || null;
  const rows = await db.many(
    `SELECT id, ts, channel, line FROM console_lines WHERE server_id=$1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT 400`,
    [s.id, before]);
  res.json(rows.reverse());
}));

router.post('/servers/:id/console', can('console.execute'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ command: z.string().trim().min(1).max(512) }), req.body);
  const id = await commands.enqueue(s.id, 'console_exec', { command: b.command }, req.user.name);
  await audit({ ...actor(req), action: 'console.exec', targetType: 'server', targetId: s.id, details: { command: b.command } });
  res.json(await commands.waitFor(id));
}));

router.post('/servers/:id/resources', can('console.execute'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ resource: z.string().regex(/^[\w.\-[\]]{1,128}$/), action: z.enum(['start', 'stop', 'restart']) }), req.body);
  const id = await commands.enqueue(s.id, 'resource_action', b, req.user.name);
  await audit({ ...actor(req), action: 'resource.' + b.action, targetType: 'server', targetId: s.id, details: { resource: b.resource } });
  res.json(await commands.waitFor(id));
}));

router.post('/servers/:id/announce', can('announce.send'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ title: z.string().trim().max(80).default('Announcement'), text: z.string().trim().min(1).max(500) }), req.body);
  const id = await commands.enqueue(s.id, 'announce', b, req.user.name);
  await audit({ ...actor(req), action: 'server.announce', targetType: 'server', targetId: s.id, details: b });
  res.json(await commands.waitFor(id));
}));

router.post('/servers/:id/cleanup', can('entities.cleanup'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ kind: z.enum(['vehicles', 'peds', 'objects']) }), req.body);
  const id = await commands.enqueue(s.id, 'delete_' + b.kind, {}, req.user.name);
  await audit({ ...actor(req), action: 'server.cleanup', targetType: 'server', targetId: s.id, details: b });
  res.json(await commands.waitFor(id));
}));

// ─── Server-wide controls: maintenance lock, kick / heal / revive everyone ───
router.post('/servers/:id/maintenance', can('server.control'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ enabled: z.boolean(), message: z.string().trim().max(200).optional(), kickNow: z.boolean().default(false) }), req.body);
  const msg = b.enabled ? (b.message || 'The server is closed for maintenance. Please come back later.') : null;
  await db.query('UPDATE servers SET maintenance=$2 WHERE id=$1', [s.id, msg]);
  let kicked = null;
  if (b.enabled && b.kickNow) {
    const id = await commands.enqueue(s.id, 'kick_all', { reason: msg, exceptStaff: true }, req.user.name);
    const r = await commands.waitFor(id, 8000);
    kicked = r.result && r.result.kicked;
  }
  await audit({ ...actor(req), action: b.enabled ? 'server.maintenance_on' : 'server.maintenance_off', targetType: 'server', targetId: s.id, details: { message: msg, kicked } });
  res.json({ ok: true, maintenance: msg, kicked });
}));

router.post('/servers/:id/players-action', can('server.control'), h(async (req, res) => {
  const s = await ownServer(req, req.params.id);
  const b = parse(z.object({ action: z.enum(['kick_all', 'heal_all', 'revive_all']), reason: z.string().trim().max(200).optional(),
    exceptStaff: z.boolean().default(true) }), req.body);
  const id = await commands.enqueue(s.id, b.action, { reason: b.reason, exceptStaff: b.exceptStaff }, req.user.name);
  await audit({ ...actor(req), action: 'server.' + b.action, targetType: 'server', targetId: s.id, details: b });
  res.json(await commands.waitFor(id, 8000));
}));

module.exports = { router, ownServer };
