'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../../db');
const { can, requireAuth } = require('../../middleware/auth');
const { audit } = require('../../lib/audit');
const { activity } = require('../../lib/activity');
const discord = require('../../lib/discord');
const commands = require('../../services/commands');
const bans = require('../../services/bans');
const { h, parse, page, notFound, actor, z } = require('./_util');

const router = express.Router();
const BAN_ID = z.string().regex(/^SB-[A-Z0-9]{8}$/);

router.get('/bans', requireAuth, can('bans.view'), h(async (req, res) => {
  const { limit, offset } = page(req.query);
  const f = parse(z.object({ status: z.enum(['active', 'expired', 'revoked', 'all']).default('all'), q: z.string().max(64).optional(),
    automatic: z.enum(['true', 'false']).optional() }), req.query);
  const where = ['b.org_id=$1']; const args = [req.user.orgId];
  if (f.status === 'active') where.push('b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())');
  if (f.status === 'expired') where.push('b.revoked_at IS NULL AND b.expires_at <= now()');
  if (f.status === 'revoked') where.push('b.revoked_at IS NOT NULL');
  if (f.automatic) { args.push(f.automatic === 'true'); where.push(`b.automatic = $${args.length}`); }
  if (f.q) {
    args.push('%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%', f.q.toUpperCase());
    where.push(`(b.player_name ILIKE $${args.length - 1} OR b.id = $${args.length} OR b.reason ILIKE $${args.length - 1})`);
  }
  args.push(limit, offset);
  const rows = await db.many(
    `SELECT b.id, b.player_id, b.player_name, b.reason, b.detection_key, b.category, b.automatic, b.issued_by_name, b.scope,
            b.created_at, b.expires_at, b.revoked_at, b.revoked_by_name, s.name AS server_name,
            (SELECT count(*) FROM ban_appeals a WHERE a.ban_id=b.id AND a.status='open') AS open_appeals,
            (SELECT count(*) FROM bans b2 WHERE b2.player_id=b.player_id) AS player_ban_count
     FROM bans b LEFT JOIN servers s ON s.id=b.server_id WHERE ${where.join(' AND ')}
     ORDER BY b.created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  res.json(rows);
}));

router.get('/bans/:id', requireAuth, can('bans.view'), h(async (req, res) => {
  const id = parse(BAN_ID, req.params.id.toUpperCase());
  const b = await db.one('SELECT b.*, s.name AS server_name FROM bans b LEFT JOIN servers s ON s.id=b.server_id WHERE b.id=$1 AND b.org_id=$2', [id, req.user.orgId]);
  if (!b) throw notFound('ban not found');
  const [detection, evidence, appeals, history] = await Promise.all([
    b.detection_id ? db.one('SELECT * FROM detections WHERE id=$1', [b.detection_id]) : null,
    req.perms.has('evidence.view') && b.detection_id ? db.many('SELECT id, kind, created_at, requested_by_name FROM evidence WHERE detection_id=$1', [b.detection_id]) : [],
    db.many('SELECT * FROM ban_appeals WHERE ban_id=$1 ORDER BY created_at DESC', [id]),
    b.player_id ? db.many('SELECT id, reason, created_at, revoked_at FROM bans WHERE player_id=$1 AND id<>$2 ORDER BY created_at DESC', [b.player_id, id]) : [],
  ]);
  b.identifiers = (b.identifiers || []).map((i) => (['ip', 'token'].includes(i.kind) ? { ...i, value: i.value.slice(0, 10) + '…' } : i));
  res.json({ ...b, detection, evidence, appeals, history });
}));

router.post('/bans/:id/revoke', requireAuth, can('players.unban'), h(async (req, res) => {
  const id = parse(BAN_ID, req.params.id.toUpperCase());
  const b = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  const ban = await bans.revokeBan(req.user.orgId, id, { byId: req.user.id, byName: req.user.name, reason: b.reason, ip: req.ip });
  if (!ban) return res.status(409).json({ error: 'Ban not found or already revoked' });
  res.json({ ok: true });
}));

router.patch('/bans/:id', requireAuth, can('players.ban'), h(async (req, res) => {
  const id = parse(BAN_ID, req.params.id.toUpperCase());
  const b = parse(z.object({ reason: z.string().trim().min(3).max(500).optional(), durationHours: z.number().int().min(0).max(87600).optional() }), req.body);
  const before = await db.one('SELECT reason, expires_at, created_at FROM bans WHERE id=$1 AND org_id=$2 AND revoked_at IS NULL', [id, req.user.orgId]);
  if (!before) throw notFound('active ban not found');
  const expires = b.durationHours === undefined ? before.expires_at
    : b.durationHours === 0 ? null : new Date(new Date(before.created_at).getTime() + b.durationHours * 3600000);
  await db.query('UPDATE bans SET reason=COALESCE($2, reason), expires_at=$3 WHERE id=$1', [id, b.reason, expires]);
  const servers = await db.many("SELECT id FROM servers WHERE org_id=$1 AND status='online'", [req.user.orgId]);
  for (const s of servers) await commands.enqueue(s.id, 'bans_sync', {}, 'system');
  await audit({ ...actor(req), action: 'ban.update', targetType: 'ban', targetId: id, details: { before, after: { reason: b.reason, expires } } });
  res.json({ ok: true });
}));

// ─── Appeals ───
router.get('/appeals', requireAuth, can('bans.appeals', 'bans.view'), h(async (req, res) => {
  const status = parse(z.enum(['open', 'accepted', 'rejected', 'all']).default('open'), req.query.status);
  const rows = await db.many(
    `SELECT a.*, b.player_name, b.reason AS ban_reason, b.automatic, b.created_at AS ban_created_at
     FROM ban_appeals a JOIN bans b ON b.id=a.ban_id WHERE b.org_id=$1 AND ($2 = 'all' OR a.status=$2) ORDER BY a.created_at DESC LIMIT 200`,
    [req.user.orgId, status]);
  res.json(rows);
}));

router.post('/appeals/:id', requireAuth, can('bans.appeals'), h(async (req, res) => {
  const aid = parse(z.coerce.number().int(), req.params.id);
  const b = parse(z.object({ decision: z.enum(['accepted', 'rejected']), response: z.string().trim().max(1000).default('') }), req.body);
  const a = await db.one(`SELECT a.*, b.org_id FROM ban_appeals a JOIN bans b ON b.id=a.ban_id WHERE a.id=$1 AND b.org_id=$2 AND a.status='open'`, [aid, req.user.orgId]);
  if (!a) throw notFound('open appeal not found');
  if (b.decision === 'accepted' && !req.perms.has('players.unban')) return res.status(403).json({ error: 'Accepting an appeal requires players.unban' });
  await db.query('UPDATE ban_appeals SET status=$2, response=$3, reviewed_by_name=$4, reviewed_at=now() WHERE id=$1', [aid, b.decision, b.response, req.user.name]);
  if (b.decision === 'accepted') await bans.revokeBan(req.user.orgId, a.ban_id, { byId: req.user.id, byName: req.user.name, reason: 'Appeal accepted: ' + b.response, ip: req.ip });
  await audit({ ...actor(req), action: 'appeal.' + b.decision, targetType: 'ban', targetId: a.ban_id, details: { appealId: aid } });
  res.json({ ok: true });
}));

// ─── Public appeal submission (no auth, rate limited, minimal disclosure) ───
const appealLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
router.post('/public/appeal', appealLimiter, h(async (req, res) => {
  const b = parse(z.object({ banId: z.string().trim().toUpperCase().pipe(BAN_ID), message: z.string().trim().min(20).max(3000),
    contact: z.string().trim().max(200).default('') }), req.body);
  const ban = await db.one('SELECT id, org_id, server_id, player_name FROM bans WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())', [b.banId]);
  // Same response whether or not the ban exists, to avoid enumeration.
  if (ban) {
    const open = await db.one("SELECT 1 FROM ban_appeals WHERE ban_id=$1 AND status='open'", [ban.id]);
    if (!open) {
      await db.query('INSERT INTO ban_appeals(ban_id, message, contact) VALUES ($1,$2,$3)', [ban.id, b.message, b.contact]);
      await activity(ban.org_id, ban.server_id, 'appeal', `New appeal for ban ${ban.id} (${ban.player_name})`, { banId: ban.id });
      discord.notify(ban.org_id, 'appeal', discord.simpleEmbed('📨 New ban appeal', `Ban \`${ban.id}\` — **${ban.player_name}**`, 'blue'));
    }
  }
  res.json({ ok: true, message: 'If this ban ID is valid and active, your appeal has been submitted to the staff team.' });
}));

module.exports = router;
