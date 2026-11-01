'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const log = require('./lib/logger');
const realtime = require('./lib/realtime');
const discord = require('./lib/discord');
const { activity } = require('./lib/activity');

/** Marks servers offline when heartbeats stop and closes their open sessions. */
async function offlineSweep() {
  const gone = await db.many(
    `UPDATE servers SET status='offline', player_count=0
     WHERE status='online' AND last_heartbeat < now() - ($1 || ' seconds')::interval RETURNING id, org_id, name`,
    [config.serverOfflineAfterSec]);
  for (const s of gone) {
    await db.query(
      `WITH c AS (UPDATE player_sessions SET ended_at=now(), end_reason='server offline'
                  WHERE server_id=$1 AND ended_at IS NULL RETURNING player_id, started_at, ended_at)
       UPDATE players p SET playtime_sec = p.playtime_sec + EXTRACT(EPOCH FROM (c.ended_at - c.started_at))::bigint
       FROM c WHERE p.id = c.player_id`, [s.id]);
    await db.query('UPDATE monitor_sessions SET stopped_at=now() WHERE server_id=$1 AND stopped_at IS NULL', [s.id]);
    realtime.toOrg(s.org_id, 'server:status', { id: s.id, status: 'offline' });
    await activity(s.org_id, s.id, 'server', `${s.name} went offline (no heartbeat)`);
    discord.notify(s.org_id, 'resource', discord.simpleEmbed('🔴 Server offline', `${s.name}: no heartbeat for ${config.serverOfflineAfterSec}s.`, 'red', s.name));
  }
}

/** Retention: telemetry, game events, console and live-only monitor frames. Evidence tied to detections/bans is kept. */
async function retention() {
  const days = config.telemetryRetentionDays;
  await db.query(`DELETE FROM telemetry WHERE ts < now() - ($1 || ' days')::interval`, [days]);
  await db.query(`DELETE FROM game_events WHERE ts < now() - ($1 || ' days')::interval`, [days]);
  await db.query(`DELETE FROM console_lines WHERE ts < now() - interval '3 days'`);
  await db.query(`DELETE FROM commands WHERE created_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await db.query(`DELETE FROM activity WHERE created_at < now() - interval '30 days'`);
  const frames = await db.many(
    `DELETE FROM evidence e USING monitor_sessions m WHERE e.monitor_id = m.id AND NOT m.record
       AND m.stopped_at IS NOT NULL AND e.created_at < now() - interval '1 day' RETURNING e.storage_path`);
  for (const f of frames) fs.promises.unlink(path.join(config.evidenceDir, f.storage_path)).catch(() => {});
}

function start() {
  const safe = (name, fn) => () => fn().catch((e) => log.error('job failed', { job: name, err: e.message }));
  const timers = [setInterval(safe('offlineSweep', offlineSweep), 10000), setInterval(safe('retention', retention), 3600000)];
  setTimeout(safe('retention', retention), 5000);
  return () => timers.forEach(clearInterval);
}

module.exports = { start, offlineSweep, retention };
