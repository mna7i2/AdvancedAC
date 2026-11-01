'use strict';
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const realtime = require('./realtime');

// jsonb does not preserve key order, so hash a canonical (sorted-key) serialization.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

function chainHash(prev, row) {
  const payload = canonical([prev, row.org_id, row.actor_type, row.actor_id, row.actor_name, row.action,
    row.target_type, row.target_id, row.details, row.created_at]);
  return crypto.createHmac('sha256', config.appSecret).update(payload).digest('hex');
}

/**
 * Append an immutable, hash-chained audit entry. The table has a trigger that rejects UPDATE/DELETE,
 * and verifyChain() detects any out-of-band tampering (e.g. via TRUNCATE or superuser edits).
 */
async function audit({ orgId, actorType, actorId = null, actorName, action, targetType = null, targetId = null, details = {}, ip = null }) {
  // Normalise exactly like JSONB will store it (drops undefined, Dates → ISO strings), so the hash we
  // compute now matches what verifyChain() reads back later.
  details = JSON.parse(JSON.stringify(details ?? {}));
  return db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['audit:' + orgId]);
    const last = await t.one('SELECT hash FROM audit_log WHERE org_id = $1 ORDER BY id DESC LIMIT 1', [orgId]);
    const row = {
      org_id: orgId, actor_type: actorType, actor_id: actorId ? String(actorId) : null, actor_name: actorName,
      action, target_type: targetType, target_id: targetId != null ? String(targetId) : null,
      details, created_at: new Date().toISOString(),
    };
    const prev = last ? last.hash : 'GENESIS';
    const hash = chainHash(prev, row);
    const ins = await t.one(
      `INSERT INTO audit_log(org_id, actor_type, actor_id, actor_name, action, target_type, target_id, details, ip, created_at, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [orgId, row.actor_type, row.actor_id, actorName, action, row.target_type, row.target_id, details, ip, row.created_at, prev, hash]);
    realtime.toOrg(orgId, 'audit', { id: ins.id, actorName, action, targetType, targetId: row.target_id, createdAt: row.created_at });
    return ins.id;
  });
}

/** Recomputes the chain; returns { ok, checked, brokenAt }. */
async function verifyChain(orgId) {
  const rows = await db.many(
    `SELECT id, org_id, actor_type, actor_id, actor_name, action, target_type, target_id, details,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, prev_hash, hash
     FROM audit_log WHERE org_id = $1 ORDER BY id`, [orgId]);
  let prev = 'GENESIS';
  for (const r of rows) {
    if (r.prev_hash !== prev || chainHash(prev, r) !== r.hash) return { ok: false, checked: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}

module.exports = { audit, verifyChain };
