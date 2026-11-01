'use strict';
const express = require('express');
const db = require('../../db');
const { can } = require('../../middleware/auth');
const { audit } = require('../../lib/audit');
const realtime = require('../../lib/realtime');
const { CATALOG, BY_KEY, CATEGORIES, resolveConfig, sanitizeOverride, LEVELS, presetAction, EXPLOIT_LIBRARY } = require('../../detections/catalog');
const { getSettings, setSetting } = require('../../lib/settings');
const enforcement = require('../../services/enforcement');
const { h, parse, page, uuid, actor, z } = require('./_util');

const router = express.Router();

/** Push config to every server of the org (resource picks it up on its next heartbeat). */
async function publishConfig(orgId) {
  enforcement.invalidateConfig(orgId);
  await db.query('UPDATE servers SET config_version = config_version + 1 WHERE org_id=$1', [orgId]);
  realtime.toOrg(orgId, 'config:updated', {});
}

router.get('/detections', can('detections.view'), h(async (req, res) => {
  const { limit, offset } = page(req.query);
  const f = parse(z.object({
    serverId: uuid.optional(), key: z.string().max(64).optional(), category: z.string().max(32).optional(),
    action: z.enum(['log', 'warn', 'kick', 'ban', 'suppressed', 'ignored']).optional(), verified: z.enum(['true', 'false']).optional(),
    playerId: z.coerce.number().int().optional(), q: z.string().max(64).optional(),
  }), req.query);
  const where = ['d.org_id = $1']; const args = [req.user.orgId];
  const add = (sql, v) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (f.serverId) add('d.server_id = ?', f.serverId);
  if (f.key) add('d.detection_key = ?', f.key);
  if (f.category) add('d.category = ?', f.category);
  if (f.action) add('d.action_taken = ?', f.action); else where.push("d.action_taken <> 'suppressed'");
  if (f.verified) add('d.verified = ?', f.verified === 'true');
  if (f.playerId) add('d.player_id = ?', f.playerId);
  if (f.q) add('p.last_name ILIKE ?', '%' + f.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
  args.push(limit, offset);
  const rows = await db.many(
    `SELECT d.*, p.last_name AS player_name, s.name AS server_name,
            (SELECT count(*) FROM evidence e WHERE e.detection_id = d.id) AS evidence_count,
            (SELECT b.id FROM bans b WHERE b.detection_id = d.id LIMIT 1) AS ban_id
     FROM detections d LEFT JOIN players p ON p.id = d.player_id JOIN servers s ON s.id = d.server_id
     WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  res.json(rows.map((r) => ({ ...r, name: BY_KEY[r.detection_key] ? BY_KEY[r.detection_key].name : r.detection_key })));
}));

// ─── Configuration ───
router.get('/detections/config', can('detections.view'), h(async (req, res) => {
  const org = req.user.orgId;
  const [overrides, stats] = await Promise.all([
    db.many('SELECT detection_key, config, updated_at FROM detection_overrides WHERE org_id=$1', [org]),
    db.many(`SELECT detection_key, count(*) AS total, max(created_at) AS last FROM detections
             WHERE org_id=$1 AND action_taken <> 'suppressed' GROUP BY 1`, [org]),
  ]);
  const cfg = resolveConfig(overrides);
  const st = Object.fromEntries(stats.map((s) => [s.detection_key, s]));
  res.json({
    categories: CATEGORIES,
    detections: CATALOG.map((d) => ({
      key: d.key, name: d.name, category: d.category, description: d.description, source: d.source, verified: d.verified,
      defaults: d.defaults, config: cfg[d.key], customized: overrides.some((o) => o.detection_key === d.key),
      totalTriggers: st[d.key] ? st[d.key].total : 0, lastTriggered: st[d.key] ? st[d.key].last : null,
    })),
  });
}));

router.put('/detections/config/:key', can('detections.configure'), h(async (req, res) => {
  const def = BY_KEY[req.params.key];
  if (!def) return res.status(404).json({ error: 'unknown detection' });
  const ov = sanitizeOverride(def.key, req.body);
  if (!ov) return res.status(400).json({ error: 'invalid configuration' });
  if (ov.action === 'ban' && !def.verified) {
    // Allowed (admins may want it), but the backend will still downgrade: tell the user explicitly.
    res.set('X-SAC-Warning', 'client-signal-ban-downgraded');
  }
  const prev = await db.one('SELECT config FROM detection_overrides WHERE org_id=$1 AND detection_key=$2', [req.user.orgId, def.key]);
  const merged = { ...(prev ? prev.config : {}), ...ov };
  await db.query(
    `INSERT INTO detection_overrides(org_id, detection_key, config, updated_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, detection_key) DO UPDATE SET config=EXCLUDED.config, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [req.user.orgId, def.key, merged, req.user.id]);
  await publishConfig(req.user.orgId);
  await audit({ ...actor(req), action: 'detection.configure', targetType: 'detection', targetId: def.key, details: { before: prev ? prev.config : null, after: merged } });
  res.json({ ok: true, config: resolveConfig([{ detection_key: def.key, config: merged }])[def.key] });
}));

router.post('/detections/config/bulk', can('detections.configure'), h(async (req, res) => {
  const b = parse(z.object({ op: z.enum(['enable_all', 'disable_all', 'reset_defaults']), category: z.string().max(32).optional() }), req.body);
  const keys = CATALOG.filter((d) => !b.category || d.category === b.category).map((d) => d.key);
  await db.tx(async (t) => {
    if (b.op === 'reset_defaults') {
      await t.query('DELETE FROM detection_overrides WHERE org_id=$1 AND detection_key = ANY($2)', [req.user.orgId, keys]);
    } else {
      for (const k of keys) {
        await t.query(
          `INSERT INTO detection_overrides(org_id, detection_key, config, updated_by) VALUES ($1,$2,$3,$4)
           ON CONFLICT (org_id, detection_key) DO UPDATE SET config = detection_overrides.config || EXCLUDED.config, updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [req.user.orgId, k, { enabled: b.op === 'enable_all' }, req.user.id]);
      }
    }
  });
  await publishConfig(req.user.orgId);
  await audit({ ...actor(req), action: 'detection.bulk', details: b });
  res.json({ ok: true, affected: keys.length });
}));

// ─── Protection strength (one click: sets the action of every detection) ───
router.post('/detections/config/preset', can('detections.configure'), h(async (req, res) => {
  const { level } = parse(z.object({ level: z.enum(LEVELS) }), req.body);
  await db.tx(async (t) => {
    for (const def of CATALOG) {
      const cur = await t.one('SELECT config FROM detection_overrides WHERE org_id=$1 AND detection_key=$2', [req.user.orgId, def.key]);
      const cfg = { ...(cur ? cur.config : {}) };
      const action = presetAction(def, level);
      if (action === def.defaults.action) delete cfg.action; else cfg.action = action;
      cfg.enabled = cfg.enabled === false && level !== 'maximum' ? false : true;
      if (cfg.enabled === true) delete cfg.enabled;
      if (Object.keys(cfg).length) {
        await t.query(`INSERT INTO detection_overrides(org_id, detection_key, config, updated_by) VALUES ($1,$2,$3,$4)
          ON CONFLICT (org_id, detection_key) DO UPDATE SET config=EXCLUDED.config, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [req.user.orgId, def.key, cfg, req.user.id]);
      } else {
        await t.query('DELETE FROM detection_overrides WHERE org_id=$1 AND detection_key=$2', [req.user.orgId, def.key]);
      }
    }
  });
  const general = (await getSettings(req.user.orgId)).general;
  await setSetting(req.user.orgId, 'general', { ...general, protectionLevel: level });
  await publishConfig(req.user.orgId);
  await audit({ ...actor(req), action: 'detection.preset', details: { level } });
  res.json({ ok: true, level });
}));

// ─── Exempt zones: areas where chosen detections never fire (training grounds, events…) ───
const ZoneSchema = z.object({
  name: z.string().trim().min(1).max(48),
  x: z.number().finite().min(-20000).max(20000), y: z.number().finite().min(-20000).max(20000), z: z.number().finite().min(-2000).max(5000),
  radius: z.number().finite().min(1).max(3000),
  detections: z.array(z.string().max(64)).max(80).default(['all']),
  jobs: z.array(z.string().trim().min(1).max(48)).max(20).default([]),
  enabled: z.boolean().default(true),
});
router.get('/zones', can('detections.view'), h(async (req, res) => res.json((await getSettings(req.user.orgId)).zones.list)));
router.put('/zones', can('detections.configure'), h(async (req, res) => {
  const list = parse(z.array(ZoneSchema).max(50), req.body);
  for (const zn of list) {
    zn.detections = [...new Set(zn.detections.filter((k) => k === 'all' || BY_KEY[k]))];
    if (!zn.detections.length) zn.detections = ['all'];
    zn.jobs = [...new Set(zn.jobs.map((j) => j.toLowerCase()))];
  }
  const before = (await getSettings(req.user.orgId)).zones.list;
  await setSetting(req.user.orgId, 'zones', { list });
  await publishConfig(req.user.orgId);
  await audit({ ...actor(req), action: 'zones.update', targetType: 'settings', targetId: 'zones', details: { before: before.length, after: list.length, names: list.map((x) => x.name) } });
  res.json(list);
}));

router.get('/detections/exploit-library', can('detections.view'), (req, res) => res.json(EXPLOIT_LIBRARY));

router.get('/detections/config/export', can('detections.view'), h(async (req, res) => {
  const rows = await db.many('SELECT detection_key, config FROM detection_overrides WHERE org_id=$1 ORDER BY detection_key', [req.user.orgId]);
  res.set('Content-Disposition', 'attachment; filename="sentinel-detections.json"');
  res.json({ format: 'sentinel-ac/detections', version: 1, exportedAt: new Date().toISOString(),
    overrides: Object.fromEntries(rows.map((r) => [r.detection_key, r.config])) });
}));

router.post('/detections/config/import', can('detections.configure'), h(async (req, res) => {
  const b = parse(z.object({ format: z.literal('sentinel-ac/detections'), overrides: z.record(z.any()) }), req.body);
  const applied = []; const skipped = [];
  await db.tx(async (t) => {
    for (const [key, raw] of Object.entries(b.overrides)) {
      const ov = sanitizeOverride(key, raw);
      if (!ov) { skipped.push(key); continue; }
      await t.query(
        `INSERT INTO detection_overrides(org_id, detection_key, config, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (org_id, detection_key) DO UPDATE SET config=EXCLUDED.config, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [req.user.orgId, key, ov, req.user.id]);
      applied.push(key);
    }
  });
  await publishConfig(req.user.orgId);
  await audit({ ...actor(req), action: 'detection.import', details: { applied, skipped } });
  res.json({ ok: true, applied, skipped });
}));

module.exports = { router, publishConfig };
