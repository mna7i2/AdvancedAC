'use strict';
const express = require('express');
const db = require('../../db');
const { can } = require('../../middleware/auth');
const { getSettings } = require('../../lib/settings');
const { CATALOG } = require('../../detections/catalog');
const { h, parse, uuid } = require('./_util');

const router = express.Router();
// Bucket sizes (seconds): player-count series is finer than event series.
const RANGES = {
  '24h': { interval: '24 hours', playerBucket: 600, eventBucket: 3600 },
  '7d': { interval: '7 days', playerBucket: 3600, eventBucket: 6 * 3600 },
  '30d': { interval: '30 days', playerBucket: 6 * 3600, eventBucket: 86400 },
};
const bucket = (col, sec) => `to_timestamp(floor(extract(epoch from ${col}) / ${sec}) * ${sec})`;
const NAMES = Object.fromEntries(CATALOG.map((d) => [d.key, d.name]));

/** Decayed risk in SQL (same formula as services/players.decayedRisk). */
const RISK_SQL = `p.risk_score * power(0.5, extract(epoch from (now() - p.risk_updated_at)) / 3600.0 / $HL)`;

router.get('/overview', can('dashboard.view'), h(async (req, res) => {
  const org = req.user.orgId;
  const range = RANGES[req.query.range] || RANGES['24h'];
  const serverId = req.query.serverId ? parse(uuid, req.query.serverId) : null;
  const settings = await getSettings(org);
  const risk = RISK_SQL.replace('$HL', String(Number(settings.risk.halfLifeHours)));
  const sf = serverId ? 'AND server_id = $2' : '';
  const args = serverId ? [org, serverId] : [org];

  const [totals, playerSeries, detSeries, banSeries, cats, top, activity, servers, suspicious] = await Promise.all([
    db.one(`SELECT
        (SELECT count(*) FROM players WHERE org_id=$1) AS players_total,
        (SELECT count(*) FROM player_sessions WHERE org_id=$1 AND ended_at IS NULL AND net_id IS NOT NULL ${sf}) AS players_online,
        (SELECT count(*) FROM bans WHERE org_id=$1 ${sf}) AS bans_total,
        (SELECT count(*) FROM bans WHERE org_id=$1 ${sf} AND created_at > date_trunc('day', now())) AS bans_today,
        (SELECT count(*) FROM bans WHERE org_id=$1 ${sf} AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS bans_active,
        (SELECT count(*) FROM detections WHERE org_id=$1 ${sf} AND action_taken <> 'suppressed') AS detections_total,
        (SELECT count(*) FROM detections WHERE org_id=$1 ${sf} AND action_taken <> 'suppressed' AND created_at > date_trunc('day', now())) AS detections_today,
        (SELECT count(*) FROM monitor_sessions WHERE org_id=$1 ${sf} AND stopped_at IS NULL) AS monitoring_active,
        (SELECT count(*) FROM ban_appeals a JOIN bans b ON b.id=a.ban_id WHERE b.org_id=$1 AND a.status='open') AS appeals_open`, args),
    db.many(`SELECT ${bucket('ts', range.playerBucket)} AS t, max(players) AS v
             FROM server_stats st JOIN servers s ON s.id = st.server_id
             WHERE s.org_id=$1 ${serverId ? 'AND st.server_id=$2' : ''} AND ts > now() - interval '${range.interval}'
             GROUP BY 1 ORDER BY 1`, args),
    db.many(`SELECT ${bucket('created_at', range.eventBucket)} AS t, count(*) AS v FROM detections
             WHERE org_id=$1 ${sf} AND action_taken <> 'suppressed' AND created_at > now() - interval '${range.interval}' GROUP BY 1 ORDER BY 1`, args),
    db.many(`SELECT ${bucket('created_at', range.eventBucket)} AS t, count(*) AS v FROM bans
             WHERE org_id=$1 ${sf} AND created_at > now() - interval '${range.interval}' GROUP BY 1 ORDER BY 1`, args),
    db.many(`SELECT category, count(*) AS v FROM detections WHERE org_id=$1 ${sf} AND action_taken <> 'suppressed'
             AND created_at > now() - interval '${range.interval}' GROUP BY 1 ORDER BY 2 DESC`, args),
    db.many(`SELECT detection_key AS key, count(*) AS v FROM detections WHERE org_id=$1 ${sf} AND action_taken <> 'suppressed'
             AND created_at > now() - interval '${range.interval}' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, args),
    db.many(`SELECT id, server_id, kind, message, data, created_at FROM activity WHERE org_id=$1 ${sf} ORDER BY id DESC LIMIT 40`, args),
    db.many(`SELECT id, name, status, player_count, max_players, ac_version, framework, onesync, started_at, last_heartbeat FROM servers WHERE org_id=$1 ORDER BY created_at`, [org]),
    db.one(`SELECT count(*) AS n FROM players p WHERE p.org_id=$1 AND ${risk} >= $2`, [org, settings.risk.thresholds.medium]),
  ]);

  const enabled = await db.many('SELECT detection_key, config FROM detection_overrides WHERE org_id=$1', [org]);
  const disabled = enabled.filter((o) => o.config.enabled === false).length;
  res.json({
    range: { key: RANGES[req.query.range] ? req.query.range : '24h', playerBucket: range.playerBucket, eventBucket: range.eventBucket },
    totals: { ...totals, suspicious_players: suspicious.n },
    protection: { modulesActive: CATALOG.length - disabled, modulesTotal: CATALOG.length },
    series: { players: playerSeries, detections: detSeries, bans: banSeries },
    categories: cats,
    topDetections: top.map((t) => ({ ...t, name: NAMES[t.key] || t.key })),
    activity,
    servers,
  });
}));

module.exports = router;
