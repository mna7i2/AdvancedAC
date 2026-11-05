'use strict';
const express = require('express');
const db = require('../../db');
const config = require('../../config');
const { audit } = require('../../lib/audit');
const { requirePlatform } = require('../../middleware/auth');
const platform = require('../../services/platform');
const orgs = require('../../services/orgs');
const { h, parse, uuid, notFound, z } = require('./_util');

/**
 * Vendor console: customers (organizations), their licenses, servers and problems.
 * Every action is written to the customer's audit log (actor 'platform') and to the vendor's own.
 */
const router = express.Router();
router.use('/platform', requirePlatform);

const who = (req) => `${req.user.name} (Sentinel support)`;
async function auditBoth(req, orgId, action, details = {}) {
  const base = { actorType: 'platform', actorId: req.user.id, actorName: who(req), action, targetType: 'customer', targetId: orgId, details, ip: req.ip };
  await audit({ ...base, orgId });
  const home = req.user.platform.homeOrgId;
  if (home && home !== orgId) await audit({ ...base, orgId: home, actorType: 'admin', actorName: req.user.name });
}
async function customer(id) {
  parse(uuid, id);
  const o = await db.one('SELECT * FROM organizations WHERE id=$1', [id]);
  if (!o) throw notFound('customer not found');
  return o;
}

router.get('/platform/overview', h(async (req, res) => {
  const all = await platform.loadAll();
  const servers = all.flatMap((c) => c.servers);
  const soon = all.filter((c) => c.license.expiresAt && new Date(c.license.expiresAt) - Date.now() < 7 * 86400000 && c.license.status === 'active');
  res.json({
    customers: all.length,
    activeCustomers: all.filter((c) => c.status === 'active' && c.license.status === 'active').length,
    suspended: all.filter((c) => c.status === 'suspended').length,
    servers: servers.length,
    serversOnline: servers.filter((s) => s.status === 'online').length,
    playersOnline: all.reduce((n, c) => n + c.playersOnline, 0),
    detections24h: all.reduce((n, c) => n + c.detections24h, 0),
    bans24h: all.reduce((n, c) => n + c.bans24h, 0),
    withProblems: all.filter((c) => c.level === 'error' || c.level === 'warn').length,
    expiringSoon: soon.map((c) => ({ id: c.id, name: c.name, expiresAt: c.license.expiresAt })),
    latestVersion: config.acLatestVersion,
  });
}));

router.get('/platform/customers', h(async (req, res) => {
  const all = await platform.loadAll();
  res.json(all.map((c) => ({ ...c, home: c.id === req.user.platform.homeOrgId })));
}));

router.get('/platform/suggest-email', h(async (req, res) => {
  const name = parse(z.string().trim().min(1).max(64), req.query.name);
  res.json({ email: await platform.suggestEmail(name) });
}));

const NewCustomer = z.object({
  serverName: z.string().trim().min(2).max(64),
  ownerName: z.string().trim().max(64).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  password: z.string().max(200).optional().or(z.literal('')),
  plan: z.string().trim().min(1).max(32).default('standard'),
  maxServers: z.number().int().min(1).max(100).default(1),
  days: z.number().int().min(1).max(3650).nullable().default(30),
  contact: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(2000).default(''),
});

router.post('/platform/customers', h(async (req, res) => {
  const b = parse(NewCustomer, req.body);
  const out = await platform.createCustomer({ ...b, email: b.email || null, password: b.password || null, createdBy: req.user.id });
  await auditBoth(req, out.customer.id, 'platform.customer_create',
    { name: out.customer.name, email: out.login.email, plan: out.license.plan, maxServers: out.license.maxServers, expiresAt: out.license.expiresAt });
  res.status(201).json(out);
}));

router.get('/platform/customers/:id', h(async (req, res) => {
  const o = await customer(req.params.id);
  const all = await platform.loadAll();
  const c = all.find((x) => x.id === o.id);
  const [users, licenses, activity, auditRows] = await Promise.all([
    db.many(`SELECT a.id, a.email, a.display_name, a.active, a.last_login, a.created_at, r.name AS role
             FROM admin_users a JOIN roles r ON r.id = a.role_id WHERE a.org_id=$1 ORDER BY r.rank DESC, a.created_at`, [o.id]),
    db.many('SELECT id, key_prefix, plan, max_servers, status, expires_at, created_at FROM licenses WHERE org_id=$1 ORDER BY created_at DESC', [o.id]),
    db.many('SELECT kind, message, created_at FROM activity WHERE org_id=$1 ORDER BY id DESC LIMIT 25', [o.id]),
    db.many(`SELECT actor_type, actor_name, action, created_at, details FROM audit_log WHERE org_id=$1 ORDER BY id DESC LIMIT 25`, [o.id]),
  ]);
  res.json({ ...c, home: o.id === req.user.platform.homeOrgId, users, licenses, activity, audit: auditRows });
}));

router.patch('/platform/customers/:id', h(async (req, res) => {
  const o = await customer(req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(64).optional(), contact: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional() }), req.body);
  await db.query('UPDATE organizations SET name=COALESCE($2,name), contact=COALESCE($3,contact), notes=COALESCE($4,notes) WHERE id=$1',
    [o.id, b.name ?? null, b.contact ?? null, b.notes ?? null]);
  await auditBoth(req, o.id, 'platform.customer_update', b);
  res.json({ ok: true });
}));

router.post('/platform/customers/:id/license', h(async (req, res) => {
  const o = await customer(req.params.id);
  const b = parse(z.object({ days: z.number().int().min(1).max(3650).optional(), lifetime: z.boolean().optional(),
    maxServers: z.number().int().min(1).max(100).optional(), plan: z.string().trim().min(1).max(32).optional() }), req.body);
  const row = await platform.updateLicense(o.id, b);
  await auditBoth(req, o.id, 'platform.license_update', { ...b, expiresAt: row.expires_at, maxServers: row.max_servers });
  res.json({ ok: true, expiresAt: row.expires_at, maxServers: row.max_servers, plan: row.plan });
}));

router.post('/platform/customers/:id/suspend', h(async (req, res) => {
  const o = await customer(req.params.id);
  if (o.id === req.user.platform.homeOrgId) return res.status(400).json({ error: 'You cannot suspend your own organization' });
  const b = parse(z.object({ reason: z.string().trim().max(300).default('') }), req.body || {});
  await platform.setSuspended(o.id, true);
  await auditBoth(req, o.id, 'platform.customer_suspend', { reason: b.reason });
  res.json({ ok: true });
}));

router.post('/platform/customers/:id/activate', h(async (req, res) => {
  const o = await customer(req.params.id);
  await platform.setSuspended(o.id, false);
  await auditBoth(req, o.id, 'platform.customer_activate');
  res.json({ ok: true });
}));

router.post('/platform/customers/:id/reset-password', h(async (req, res) => {
  const o = await customer(req.params.id);
  const b = parse(z.object({ userId: uuid.optional() }), req.body || {});
  const r = await platform.resetPassword(o.id, b.userId);
  if (!r) throw notFound('account not found');
  await auditBoth(req, o.id, 'platform.password_reset', { email: r.email });
  res.json(r);
}));

router.post('/platform/customers/:id/servers', h(async (req, res) => {
  const o = await customer(req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(64) }), req.body);
  const s = await orgs.createServer(o.id, b.name, 'Created by your Sentinel AC provider');
  await auditBoth(req, o.id, 'platform.server_create', { serverId: s.id, name: s.name });
  res.status(201).json({ id: s.id, name: s.name, apiKey: s.apiKey, cfg: platform.serverCfgSnippet(s.apiKey) });
}));

router.post('/platform/customers/:id/servers/:sid/rotate', h(async (req, res) => {
  const o = await customer(req.params.id);
  parse(uuid, req.params.sid);
  const key = await orgs.rotateServerKey(o.id, req.params.sid);
  if (!key) throw notFound('server not found');
  await db.query('UPDATE servers SET fingerprint=NULL WHERE id=$1', [req.params.sid]);
  await auditBoth(req, o.id, 'platform.server_key_rotate', { serverId: req.params.sid });
  res.json({ apiKey: key, cfg: platform.serverCfgSnippet(key) });
}));

router.delete('/platform/customers/:id', h(async (req, res) => {
  const o = await customer(req.params.id);
  if (o.id === req.user.platform.homeOrgId) return res.status(400).json({ error: 'You cannot delete your own organization' });
  const b = parse(z.object({ confirm: z.string() }), req.body || {});
  if (b.confirm.trim() !== o.name) return res.status(400).json({ error: 'Type the exact customer name to confirm' });
  await platform.deleteCustomer(o.id);
  if (req.user.platform.homeOrgId) {
    await audit({ orgId: req.user.platform.homeOrgId, actorType: 'admin', actorId: req.user.id, actorName: req.user.name,
      action: 'platform.customer_delete', targetType: 'customer', targetId: o.id, details: { name: o.name }, ip: req.ip });
  }
  res.json({ ok: true });
}));

// ─── Enter a customer's dashboard (full control) and come back ───
router.post('/platform/customers/:id/enter', h(async (req, res) => {
  const o = await customer(req.params.id);
  const target = o.id === req.user.platform.homeOrgId ? null : o.id;
  await db.query('UPDATE sessions SET acting_org_id=$2 WHERE token_hash=$1', [req.sessionHash, target]);
  if (target) await audit({ orgId: o.id, actorType: 'platform', actorId: req.user.id, actorName: who(req), action: 'platform.enter', ip: req.ip });
  res.json({ ok: true });
}));

router.post('/platform/exit', h(async (req, res) => {
  await db.query('UPDATE sessions SET acting_org_id=NULL WHERE token_hash=$1', [req.sessionHash]);
  res.json({ ok: true });
}));

module.exports = router;
