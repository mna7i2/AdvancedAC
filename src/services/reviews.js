'use strict';
const db = require('../db');
const { activity } = require('../lib/activity');
const realtime = require('../lib/realtime');
const discord = require('../lib/discord');
const config = require('../config');

/**
 * Ban review queue. When the evidence is strong but not certain enough for an automatic ban, the
 * player is removed and a review is opened: staff look at the evidence and approve or dismiss.
 * One open review per player; new detections are appended to it.
 */
async function openOrAppend({ orgId, serverId, playerId, playerName, reason, detectionKey, detectionId, evidence, serverName }) {
  const open = await db.one("SELECT * FROM ban_reviews WHERE org_id=$1 AND player_id=$2 AND status='open'", [orgId, playerId]);
  if (open) {
    const seen = new Set((open.evidence || []).map((e) => e.detectionId));
    const merged = [...(open.evidence || []), ...evidence.filter((e) => !seen.has(e.detectionId))].slice(-20);
    await db.query(
      `UPDATE ban_reviews SET evidence=$2, detection_ids = array_append(detection_ids, $3::bigint), updated_at=now(), player_name=$4
       WHERE id=$1`, [open.id, JSON.stringify(merged), detectionId, playerName]);
    realtime.toOrg(orgId, 'review', { id: open.id, playerName, reason, updated: true });
    return { id: open.id, created: false };
  }
  const row = await db.one(
    `INSERT INTO ban_reviews(org_id, server_id, player_id, player_name, reason, detection_key, detection_ids, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,ARRAY[$7::bigint],$8) RETURNING id`,
    [orgId, serverId, playerId, playerName, reason, detectionKey, detectionId, JSON.stringify(evidence)]);
  await activity(orgId, serverId, 'review', `${playerName} was removed and sent to ban review: ${reason}`, { reviewId: row.id, playerId });
  realtime.toOrg(orgId, 'review', { id: row.id, playerName, reason, created: true });
  discord.notify(orgId, 'critical', discord.simpleEmbed('⚖️ Ban review needed',
    `**${playerName}** was removed — ${reason}\n${evidence.slice(0, 3).map((e) => `• ${e.text}`).join('\n')}\n${config.publicUrl}/#/bans?tab=reviews`, 'orange', serverName));
  return { id: row.id, created: true };
}

async function list(orgId, status = 'open') {
  return db.many(
    `SELECT r.*, s.name AS server_name, p.license, p.risk_score,
            (SELECT count(*)::int FROM bans b WHERE b.player_id = r.player_id) AS previous_bans
     FROM ban_reviews r LEFT JOIN servers s ON s.id = r.server_id JOIN players p ON p.id = r.player_id
     WHERE r.org_id=$1 AND ($2 = 'all' OR r.status=$2) ORDER BY r.updated_at DESC LIMIT 200`, [orgId, status]);
}

async function get(orgId, id) {
  return db.one('SELECT * FROM ban_reviews WHERE id=$1 AND org_id=$2', [id, orgId]);
}

async function countOpen(orgId) {
  const r = await db.one("SELECT count(*)::int AS n FROM ban_reviews WHERE org_id=$1 AND status='open'", [orgId]);
  return r.n;
}

async function close(id, status, by, { banId = null, note = '' } = {}) {
  await db.query('UPDATE ban_reviews SET status=$2, decided_by=$3, decided_at=now(), ban_id=$4, note=$5, updated_at=now() WHERE id=$1',
    [id, status, by, banId, note]);
}

module.exports = { openOrAppend, list, get, countOpen, close };
