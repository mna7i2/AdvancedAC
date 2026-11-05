'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../../db');
const { audit } = require('../../lib/audit');
const { createSession, setSessionCookie, requireAuth, COOKIE, SUSPENDED } = require('../../middleware/auth');
const { validatePassword } = require('../../services/orgs');
const { PERMISSIONS } = require('../../lib/permissions');
const { CATALOG, CATEGORIES } = require('../../detections/catalog');
const discord = require('../../lib/discord');
const { h, parse, z } = require('./_util');

const router = express.Router();
const MAX_FAILS = 5;
const LOCK_MIN = 15;
// Constant-time-ish: always run bcrypt, even for unknown emails.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' } });

router.post('/auth/login', loginLimiter, h(async (req, res) => {
  if (req.get('x-sac-request') !== '1') return res.status(403).json({ error: 'missing request header' });
  const b = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
  const u = await db.one(`SELECT a.*, o.status AS org_status FROM admin_users a JOIN organizations o ON o.id = a.org_id
                          WHERE lower(a.email) = lower($1)`, [b.email]);
  const ok = await bcrypt.compare(b.password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !u.active) return res.status(401).json({ error: 'Invalid email or password' });
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return res.status(423).json({ error: `Account locked after ${MAX_FAILS} failed attempts. Try again later.` });
  }
  if (!ok) {
    const fails = u.failed_logins + 1;
    const lock = fails >= MAX_FAILS;
    await db.query(
      `UPDATE admin_users SET failed_logins = $2::int,
         locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE NULL END WHERE id = $1`,
      [u.id, lock ? 0 : fails, lock, LOCK_MIN]);
    if (fails >= MAX_FAILS) await audit({ orgId: u.org_id, actorType: 'system', actorName: 'Sentinel AC', action: 'auth.lockout', targetType: 'admin', targetId: u.id, ip: req.ip });
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (u.org_status === 'suspended' && !u.platform_admin) return res.status(403).json(SUSPENDED);
  await db.query('UPDATE admin_users SET failed_logins=0, locked_until=NULL, last_login=now() WHERE id=$1', [u.id]);
  const token = await createSession(u.id, req.ip, req.get('user-agent'));
  setSessionCookie(res, token);
  await audit({ orgId: u.org_id, actorType: 'admin', actorId: u.id, actorName: u.display_name, action: 'auth.login', ip: req.ip });
  res.json({ ok: true });
}));

router.post('/auth/logout', requireAuth, h(async (req, res) => {
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [req.sessionHash]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

router.get('/auth/me', requireAuth, h(async (req, res) => {
  const servers = await db.many('SELECT id, name, status, player_count, max_players FROM servers WHERE org_id=$1 ORDER BY created_at', [req.user.orgId]);
  res.json({ user: req.user, permissions: [...req.perms], servers });
}));

router.post('/auth/password', requireAuth, h(async (req, res) => {
  const b = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
  const err = validatePassword(b.next);
  if (err) return res.status(400).json({ error: err });
  const u = await db.one('SELECT password_hash FROM admin_users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(b.current, u.password_hash))) return res.status(400).json({ error: 'Current password is incorrect' });
  await db.query('UPDATE admin_users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(b.next, 12)]);
  // Invalidate all other sessions.
  await db.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash <> $2', [req.user.id, req.sessionHash]);
  await audit({ orgId: req.user.orgId, actorType: 'admin', actorId: req.user.id, actorName: req.user.name, action: 'auth.password_change', ip: req.ip });
  res.json({ ok: true });
}));

router.get('/meta', requireAuth, (req, res) => {
  res.json({
    permissions: PERMISSIONS,
    categories: CATEGORIES,
    detections: CATALOG.map((d) => ({ key: d.key, name: d.name, category: d.category })),
    discordCategories: discord.CATEGORIES,
  });
});

module.exports = router;
