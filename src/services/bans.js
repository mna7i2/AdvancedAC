'use strict';
const db = require('../db');
const { banId } = require('../lib/crypto');
const { audit } = require('../lib/audit');
const { activity } = require('../lib/activity');
const discord = require('../lib/discord');
const realtime = require('../lib/realtime');
const commands = require('./commands');
const { CLEAR_KINDS } = require('./players');

const STRONG_KINDS = ['license', 'license2', 'steam', 'discord', 'fivem', 'xbl', 'live'];

/**
 * Find an active ban matching any identifier. Returns { ban, match } where match is
 * 'identifier' (strong: account identifiers) or 'token' (hardware token / ip only — weaker).
 */
async function findActiveBan(orgId, serverId, identifiers) {
  if (!identifiers.length) return null;
  const rows = await db.many(
    `SELECT b.*, bi.kind AS match_kind
     FROM ban_identifiers bi JOIN bans b ON b.id = bi.ban_id
     WHERE bi.org_id = $1
       AND (bi.kind, bi.value) IN (SELECT * FROM unnest($2::text[], $3::text[]))
       AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())
       AND (b.scope = 'org' OR b.server_id = $4)
     ORDER BY b.created_at DESC`,
    [orgId, identifiers.map((i) => i.kind), identifiers.map((i) => i.value), serverId]);
  if (!rows.length) return null;
  const strong = rows.find((r) => STRONG_KINDS.includes(r.match_kind));
  return strong ? { ban: strong, match: 'identifier' } : { ban: rows[0], match: 'token' };
}

/**
 * Create a ban, persist its identifiers, kick the player on every server of the org where
 * they are online, notify dashboard + Discord, and write the audit log.
 */
async function createBan({ orgId, serverId, scope = 'org', playerId, playerName, identifiers, reason,
  detectionKey = null, category = null, detectionId = null, automatic, issuedBy = null, issuedByName,
  durationHours = 0, ip = null, serverName = null, evidence = [], actorType = null }) {
  const id = banId();
  const expires = durationHours > 0 ? new Date(Date.now() + durationHours * 3600000) : null;
  const ban = await db.tx(async (t) => {
    const b = await t.one(
      `INSERT INTO bans(id, org_id, server_id, scope, player_id, player_name, identifiers, reason, detection_key,
                        category, detection_id, automatic, issued_by, issued_by_name, expires_at, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [id, orgId, serverId, scope, playerId, playerName, JSON.stringify(identifiers), reason, detectionKey,
        category, detectionId, automatic, issuedBy, issuedByName, expires, JSON.stringify(evidence || [])]);
    await t.query(
      `INSERT INTO ban_identifiers(ban_id, org_id, kind, value)
       SELECT $1, $2, k, v FROM unnest($3::text[], $4::text[]) AS u(k, v) ON CONFLICT DO NOTHING`,
      [id, orgId, identifiers.map((i) => i.kind), identifiers.map((i) => i.value)]);
    return b;
  });

  // Enforce immediately wherever the player is online in this org.
  if (playerId) {
    const sessions = await db.many(
      `SELECT ps.server_id, ps.net_id FROM player_sessions ps JOIN servers s ON s.id = ps.server_id
       WHERE ps.player_id = $1 AND ps.ended_at IS NULL AND s.org_id = $2 AND ps.net_id IS NOT NULL
         AND ($3 = 'org' OR ps.server_id = $4)`, [playerId, orgId, scope, serverId]);
    for (const s of sessions) {
      await commands.enqueue(s.server_id, 'ban_kick', { netId: s.net_id, banId: id, reason, expiresAt: expires }, issuedByName);
    }
  }
  // All org servers refresh their local ban cache.
  const servers = await db.many("SELECT id FROM servers WHERE org_id=$1 AND status='online'", [orgId]);
  for (const s of servers) await commands.enqueue(s.id, 'bans_sync', {}, 'system');

  await audit({
    orgId, actorType: actorType || (automatic ? 'system' : (issuedBy ? 'admin' : 'ingame_admin')), actorId: issuedBy,
    actorName: issuedByName, action: 'ban.create', targetType: 'player', targetId: playerId,
    details: { banId: id, reason, durationHours, detectionKey, scope }, ip,
  });
  await activity(orgId, serverId, automatic ? 'ban_auto' : 'ban_manual',
    `${playerName} was ${automatic ? 'automatically ' : ''}banned: ${reason}`, { banId: id, playerId });
  realtime.toOrg(orgId, 'ban', { ...ban, identifiers: undefined });
  discord.notify(orgId, automatic ? 'ban_auto' : 'ban_manual', discord.banEmbed({ ...ban, identifiers }, serverName));
  return ban;
}

async function revokeBan(orgId, id, { byId = null, byName, reason, ip = null, actorType = 'admin' }) {
  const ban = await db.one(
    `UPDATE bans SET revoked_at = now(), revoked_by_name = $3, revoke_reason = $4
     WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL RETURNING *`, [id, orgId, byName, reason]);
  if (!ban) return null;
  const servers = await db.many("SELECT id FROM servers WHERE org_id=$1 AND status='online'", [orgId]);
  for (const s of servers) await commands.enqueue(s.id, 'bans_sync', {}, 'system');
  await audit({ orgId, actorType, actorId: byId, actorName: byName, action: 'ban.revoke', targetType: 'ban', targetId: id, details: { reason }, ip });
  await activity(orgId, ban.server_id, 'unban', `${ban.player_name} was unbanned by ${byName}`, { banId: id });
  realtime.toOrg(orgId, 'ban:revoked', { id });
  discord.notify(orgId, 'unban', discord.simpleEmbed('✅ Unban', `**${ban.player_name}** (\`${id}\`) unbanned by ${byName}\nReason: ${reason || '—'}`, 'green'));
  return ban;
}

/** Ban cache for the resource (offline fallback). Only clear account identifiers are sent. */
async function syncList(orgId, serverId) {
  const rows = await db.many(
    `SELECT b.id, b.reason, b.expires_at, array_agg(bi.kind || ':' || bi.value) AS ids
     FROM bans b JOIN ban_identifiers bi ON bi.ban_id = b.id
     WHERE b.org_id = $1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())
       AND (b.scope = 'org' OR b.server_id = $2) AND bi.kind = ANY($3)
     GROUP BY b.id`, [orgId, serverId, CLEAR_KINDS]);
  return rows.map((r) => ({ id: r.id, reason: r.reason, expiresAt: r.expires_at ? Math.floor(new Date(r.expires_at) / 1000) : 0, ids: r.ids }));
}

function formatBanMessage(template, ban, appealUrl) {
  const ev = Array.isArray(ban.evidence) && ban.evidence[0] ? ban.evidence[0].text : '';
  return template
    .replace('{banId}', ban.id)
    .replace('{reason}', ban.reason)
    .replace('{evidence}', ev || ban.reason)
    .replace('{expires}', ban.expires_at ? new Date(ban.expires_at).toUTCString() : 'Never')
    .replace('{appealUrl}', appealUrl || '');
}

module.exports = { findActiveBan, createBan, revokeBan, syncList, formatBanMessage };
