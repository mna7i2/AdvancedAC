'use strict';
const db = require('../db');
const realtime = require('./realtime');

/**
 * Recent-activity feed (joins, leaves, detections, bans, admin actions, resource alerts).
 * Separate from the audit log: this is a UI feed and may be pruned; the audit log never is.
 */
async function activity(orgId, serverId, kind, message, data = {}) {
  const row = await db.one(
    'INSERT INTO activity(org_id, server_id, kind, message, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
    [orgId, serverId, kind, message, data]);
  realtime.toOrg(orgId, 'activity', { id: row.id, serverId, kind, message, data, createdAt: row.created_at });
}

module.exports = { activity };
