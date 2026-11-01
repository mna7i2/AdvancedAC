'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { can } = require('../../middleware/auth');
const { audit, verifyChain } = require('../../lib/audit');
const { PERMISSIONS } = require('../../lib/permissions');
const { DEFAULTS, getSettings, setSetting } = require('../../lib/settings');
const { merge } = require('../../detections/catalog');
const discord = require('../../lib/discord');
const { validatePassword } = require('../../services/orgs');
const { activeLicense } = require('../../services/license');
const { publishConfig } = require('./detections');
const { h, parse, page, uuid, notFound, forbidden, actor, z } = require('./_util');

const router = express.Router();
const IDENT = z.string().regex(/^(license2?|steam|discord|fivem|xbl|live):[\w.-]{2,64}$/);
const PERM = z.enum(Object.keys(PERMISSIONS));

// ─── Roles ───
router.get('/roles', can('admins.manage', 'dashboard.view'), h(async (req, res) => {
  res.json(await db.many('SELECT id, name, rank, permissions FROM roles WHERE org_id=$1 ORDER BY rank DESC', [req.user.orgId]));
}));

router.put('/roles/:id', can('admins.manage'), h(async (req, res) => {
  const id = parse(z.coerce.number().int(), req.params.id);
  const b = parse(z.object({ permissions: z.array(PERM).max(100) }), req.body);
  const role = await db.one('SELECT * FROM roles WHERE id=$1 AND org_id=$2', [id, req.user.orgId]);
  if (!role) throw notFound();
  if (role.name === 'Owner') throw forbidden('The Owner role always has every permission');
  if (role.rank >= req.user.rank) throw forbidden('You can only edit roles below your own');
  const escalation = b.permissions.filter((p) => !req.perms.has(p));
  if (escalation.length) throw forbidden('You cannot grant permissions you do not have: ' + escalation.join(', '));
  await db.query('UPDATE roles SET permissions=$2 WHERE id=$1', [id, b.permissions]);
  await audit({ ...actor(req), action: 'role.update', targetType: 'role', targetId: id, details: { before: role.permissions, after: b.permissions } });
  await publishConfig(req.user.orgId);   // in-game staff permissions
  res.json({ ok: true });
}));

// ─── Administrators ───
router.get('/admins', can('admins.manage'), h(async (req, res) => {
  res.json(await db.many(
    `SELECT a.id, a.email, a.display_name, a.role_id, r.name AS role, r.rank, a.extra_permissions, a.denied_permissions,
            a.linked_identifiers, a.active, a.last_login, a.created_at, a.locked_until
     FROM admin_users a JOIN roles r ON r.id=a.role_id WHERE a.org_id=$1 ORDER BY r.rank DESC, a.created_at`, [req.user.orgId]));
}));

async function assertManageable(req, targetRoleId, targetUserId = null) {
  const role = await db.one('SELECT * FROM roles WHERE id=$1 AND org_id=$2', [targetRoleId, req.user.orgId]);
  if (!role) throw notFound('role not found');
  if (req.user.role !== 'Owner' && role.rank >= req.user.rank) throw forbidden('You can only assign roles below your own');
  if (targetUserId) {
    const t = await db.one('SELECT r.rank FROM admin_users a JOIN roles r ON r.id=a.role_id WHERE a.id=$1 AND a.org_id=$2', [targetUserId, req.user.orgId]);
    if (!t) throw notFound('administrator not found');
    if (req.user.role !== 'Owner' && t.rank >= req.user.rank) throw forbidden('You can only manage administrators below your rank');
  }
  return role;
}
function assertGrantable(req, perms) {
  const bad = (perms || []).filter((p) => !req.perms.has(p));
  if (bad.length) throw forbidden('You cannot grant permissions you do not have: ' + bad.join(', '));
}

router.post('/admins', can('admins.manage'), h(async (req, res) => {
  const b = parse(z.object({ email: z.string().email().max(200), name: z.string().trim().min(2).max(64), password: z.string().max(200),
    roleId: z.number().int(), extraPermissions: z.array(PERM).default([]), deniedPermissions: z.array(PERM).default([]),
    linkedIdentifiers: z.array(IDENT).max(10).default([]) }), req.body);
  const pwErr = validatePassword(b.password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  await assertManageable(req, b.roleId);
  assertGrantable(req, b.extraPermissions);
  const exists = await db.one('SELECT 1 FROM admin_users WHERE lower(email)=lower($1)', [b.email]);
  if (exists) return res.status(409).json({ error: 'Email already in use' });
  const u = await db.one(
    `INSERT INTO admin_users(org_id, email, display_name, password_hash, role_id, extra_permissions, denied_permissions, linked_identifiers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.user.orgId, b.email.toLowerCase(), b.name, await bcrypt.hash(b.password, 12), b.roleId, b.extraPermissions, b.deniedPermissions, b.linkedIdentifiers]);
  await audit({ ...actor(req), action: 'admin.create', targetType: 'admin', targetId: u.id, details: { email: b.email, roleId: b.roleId } });
  await publishConfig(req.user.orgId);
  res.json({ id: u.id });
}));

router.patch('/admins/:id', can('admins.manage'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(2).max(64).optional(), roleId: z.number().int().optional(),
    extraPermissions: z.array(PERM).optional(), deniedPermissions: z.array(PERM).optional(),
    linkedIdentifiers: z.array(IDENT).max(10).optional(), active: z.boolean().optional(), password: z.string().max(200).optional(),
    unlock: z.boolean().optional() }), req.body);
  if (id === req.user.id && (b.roleId !== undefined || b.active === false)) throw forbidden('You cannot change your own role or deactivate yourself');
  const cur = await db.one('SELECT role_id FROM admin_users WHERE id=$1 AND org_id=$2', [id, req.user.orgId]);
  if (!cur) throw notFound();
  await assertManageable(req, cur.role_id, id === req.user.id ? null : id);
  if (b.roleId !== undefined) await assertManageable(req, b.roleId);
  if (b.extraPermissions) assertGrantable(req, b.extraPermissions);
  let hash = null;
  if (b.password) { const e = validatePassword(b.password); if (e) return res.status(400).json({ error: e }); hash = await bcrypt.hash(b.password, 12); }
  await db.query(
    `UPDATE admin_users SET display_name=COALESCE($2,display_name), role_id=COALESCE($3,role_id), extra_permissions=COALESCE($4,extra_permissions),
       denied_permissions=COALESCE($5,denied_permissions), linked_identifiers=COALESCE($6,linked_identifiers), active=COALESCE($7,active),
       password_hash=COALESCE($8,password_hash), locked_until=CASE WHEN $9 THEN NULL ELSE locked_until END,
       failed_logins=CASE WHEN $9 THEN 0 ELSE failed_logins END
     WHERE id=$1`,
    [id, b.name, b.roleId, b.extraPermissions, b.deniedPermissions, b.linkedIdentifiers, b.active, hash, !!b.unlock]);
  if (b.active === false || hash) await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
  await audit({ ...actor(req), action: 'admin.update', targetType: 'admin', targetId: id, details: { ...b, password: b.password ? '(changed)' : undefined } });
  await publishConfig(req.user.orgId);
  res.json({ ok: true });
}));

// ─── Discord ───
router.get('/discord', can('discord.manage'), h(async (req, res) => res.json(await discord.listWebhooks(req.user.orgId))));

router.put('/discord/:category', can('discord.manage'), h(async (req, res) => {
  const cat = parse(z.enum(Object.keys(discord.CATEGORIES)), req.params.category);
  const b = parse(z.object({ url: z.string().max(300).nullable().optional(), enabled: z.boolean().default(true) }), req.body);
  try { await discord.setWebhook(req.user.orgId, cat, b.url, b.enabled); } catch (e) { return res.status(400).json({ error: e.message }); }
  await audit({ ...actor(req), action: 'discord.update', targetType: 'webhook', targetId: cat, details: { enabled: b.enabled, removed: b.url === null, changedUrl: !!b.url } });
  res.json({ ok: true });
}));

router.post('/discord/:category/test', can('discord.manage'), h(async (req, res) => {
  const cat = parse(z.enum(Object.keys(discord.CATEGORIES)), req.params.category);
  discord.notify(req.user.orgId, cat, discord.simpleEmbed('✅ Sentinel AC test', `Webhook for **${discord.CATEGORIES[cat]}** is working. Sent by ${req.user.name}.`, 'green'));
  res.json({ ok: true });
}));

// ─── Settings ───
function sanitizeSettings(key, value) {
  // Keep only keys/types that exist in the defaults.
  const walk = (def, v) => {
    if (Array.isArray(def)) return Array.isArray(v) ? v : undefined;
    if (def && typeof def === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      const out = {};
      for (const k of Object.keys(def)) { const r = walk(def[k], v[k]); if (r !== undefined) out[k] = r; }
      return out;
    }
    if (typeof def === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
    if (typeof def === 'boolean') return typeof v === 'boolean' ? v : undefined;
    if (typeof def === 'string') return typeof v === 'string' && v.length <= 1000 ? v : undefined;
    return undefined;
  };
  return walk(DEFAULTS[key], value);
}

router.get('/settings', can('dashboard.view'), h(async (req, res) => res.json(await getSettings(req.user.orgId))));

router.put('/settings/:key', can('settings.manage'), h(async (req, res) => {
  const key = parse(z.enum(Object.keys(DEFAULTS)), req.params.key);
  if (key === 'zones') return res.status(400).json({ error: 'Use PUT /zones' });
  const clean = sanitizeSettings(key, req.body);
  if (!clean) return res.status(400).json({ error: 'invalid settings' });
  const cur = (await getSettings(req.user.orgId))[key];
  const next = merge(cur, clean);
  if (key === 'telemetry') { next.intervalMs = Math.max(1000, next.intervalMs); next.heartbeatMs = Math.max(1000, next.heartbeatMs); }
  if (key === 'risk') {
    const t = next.thresholds;
    if (!(t.medium < t.high && t.high < t.critical && t.critical <= 100)) return res.status(400).json({ error: 'Risk thresholds must be ascending and ≤ 100' });
  }
  if (key === 'enforcement' && !['log', 'warn', 'kick'].includes(next.unverifiedBanFallback)) return res.status(400).json({ error: 'unverifiedBanFallback must be log, warn or kick' });
  if (key === 'enforcement' && !['block', 'review'].includes(next.tokenOnlyMatch)) return res.status(400).json({ error: 'tokenOnlyMatch must be block or review' });
  await setSetting(req.user.orgId, key, next);
  await publishConfig(req.user.orgId);
  await audit({ ...actor(req), action: 'settings.update', targetType: 'settings', targetId: key, details: { before: cur, after: next } });
  res.json(next);
}));

router.get('/license', can('settings.manage'), h(async (req, res) => {
  const lic = await activeLicense(req.user.orgId);
  const all = await db.many('SELECT key_prefix, plan, max_servers, status, expires_at, created_at FROM licenses WHERE org_id=$1 ORDER BY created_at DESC', [req.user.orgId]);
  const used = await db.one('SELECT count(*)::int n FROM servers WHERE org_id=$1', [req.user.orgId]);
  res.json({ active: lic ? { prefix: lic.key_prefix, plan: lic.plan, maxServers: lic.max_servers, expiresAt: lic.expires_at } : null, serversUsed: used.n, licenses: all });
}));

// ─── Audit log ───
router.get('/audit', can('audit.view'), h(async (req, res) => {
  const { limit, offset } = page(req.query);
  const f = parse(z.object({ action: z.string().max(64).optional(), actor: z.string().max(64).optional() }), req.query);
  const rows = await db.many(
    `SELECT id, actor_type, actor_name, action, target_type, target_id, details, ip, created_at, hash FROM audit_log
     WHERE org_id=$1 AND ($2::text IS NULL OR action LIKE $2 || '%') AND ($3::text IS NULL OR actor_name ILIKE '%' || $3 || '%')
     ORDER BY id DESC LIMIT $4 OFFSET $5`, [req.user.orgId, f.action || null, f.actor || null, limit, offset]);
  res.json(rows);
}));

router.get('/audit/verify', can('audit.view'), h(async (req, res) => res.json(await verifyChain(req.user.orgId))));

module.exports = router;
