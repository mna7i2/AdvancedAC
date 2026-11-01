'use strict';
const db = require('../db');
const realtime = require('../lib/realtime');

/**
 * Command queue: dashboard / backend → game server. The resource pulls pending commands on every
 * heartbeat and acknowledges them with a result, so commands survive brief disconnects.
 */
const KINDS = new Set([
  'kick', 'ban_kick', 'screenshot', 'freeze', 'unfreeze', 'heal', 'teleport_to', 'bring', 'set_bucket',
  'announce', 'delete_vehicles', 'delete_peds', 'delete_objects', 'monitor_start', 'monitor_stop',
  'console_exec', 'resource_action', 'config_reload', 'bans_sync', 'warn', 'inventory',
]);
const TTL_SEC = 120;

async function enqueue(serverId, kind, payload, byName) {
  if (!KINDS.has(kind)) throw new Error('unknown command ' + kind);
  const row = await db.one(
    'INSERT INTO commands(server_id, kind, payload, created_by_name) VALUES ($1,$2,$3,$4) RETURNING id, created_at',
    [serverId, kind, payload || {}, byName]);
  return row.id;
}

/** Called by heartbeat: expire stale, mark pending as sent, return them. Re-sends 'sent' commands not acked in 15s. */
async function takePending(serverId) {
  await db.query(
    `UPDATE commands SET status='expired', completed_at=now()
     WHERE server_id=$1 AND status IN ('pending','sent') AND created_at < now() - ($2 || ' seconds')::interval`,
    [serverId, TTL_SEC]);
  return db.many(
    `UPDATE commands SET status='sent', sent_at=now()
     WHERE id IN (SELECT id FROM commands WHERE server_id=$1 AND
                  (status='pending' OR (status='sent' AND sent_at < now() - interval '15 seconds'))
                  ORDER BY id LIMIT 50)
     RETURNING id, kind, payload`, [serverId]);
}

async function ack(serverId, acks) {
  for (const a of acks || []) {
    if (!Number.isInteger(a.id)) continue;
    const row = await db.one(
      `UPDATE commands SET status=$3, result=$4, completed_at=now()
       WHERE id=$1 AND server_id=$2 AND status IN ('pending','sent') RETURNING id, kind`,
      [a.id, serverId, a.ok ? 'done' : 'failed', a.result || {}]);
    if (row) realtime.toServer(serverId, 'command:result', { id: row.id, kind: row.kind, ok: !!a.ok, result: a.result || {} });
  }
}

/** Wait (bounded) for a command result — used by dashboard endpoints that want synchronous feedback. */
async function waitFor(id, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await db.one('SELECT status, result FROM commands WHERE id=$1', [id]);
    if (r && ['done', 'failed', 'expired'].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 300));
  }
  return { status: 'pending', result: null };
}

module.exports = { enqueue, takePending, ack, waitFor, KINDS };
