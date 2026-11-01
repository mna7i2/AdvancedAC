'use strict';

/** Every permission the system checks. Keep in sync with dashboard (served via /api/v1/meta). */
const PERMISSIONS = {
  'dashboard.view': 'View overview dashboard',
  'players.view': 'View players and profiles',
  'players.notes': 'Add admin notes',
  'players.monitor': 'Live monitoring and recording',
  'players.screenshot': 'Request screenshots',
  'players.inventory': 'View player inventory',
  'players.actions': 'Freeze / heal / teleport / bring',
  'players.spectate': 'Spectate (in-game)',
  'players.kick': 'Kick players',
  'players.ban': 'Ban players',
  'players.unban': 'Unban players',
  'map.view': 'Live map',
  'replay.view': 'Session replay',
  'detections.view': 'View detections',
  'detections.configure': 'Change detection settings',
  'bans.view': 'View bans',
  'bans.appeals': 'Review ban appeals',
  'evidence.view': 'View evidence',
  'lookup.view': 'Global player lookup',
  'entities.cleanup': 'Delete vehicles / peds / objects',
  'announce.send': 'Send announcements',
  'console.view': 'View server console',
  'console.execute': 'Execute console commands and control resources',
  'servers.manage': 'Create servers, rotate keys',
  'admins.manage': 'Manage administrators and roles',
  'discord.manage': 'Manage Discord webhooks',
  'settings.manage': 'Organization settings',
  'audit.view': 'View audit log',
};

const ALL = Object.keys(PERMISSIONS);
const without = (...ex) => ALL.filter((p) => !ex.includes(p));

const DEFAULT_ROLES = [
  { name: 'Owner', rank: 100, permissions: ALL },
  { name: 'Super Administrator', rank: 80, permissions: without('admins.manage') },
  {
    name: 'Administrator', rank: 60,
    permissions: without('admins.manage', 'servers.manage', 'settings.manage', 'console.execute', 'discord.manage'),
  },
  {
    name: 'Moderator', rank: 40,
    permissions: ['dashboard.view', 'players.view', 'players.notes', 'players.screenshot', 'players.inventory', 'players.actions',
      'players.spectate', 'players.kick', 'players.ban', 'map.view', 'replay.view', 'detections.view',
      'bans.view', 'evidence.view', 'lookup.view', 'entities.cleanup', 'announce.send'],
  },
  {
    name: 'Support', rank: 20,
    permissions: ['dashboard.view', 'players.view', 'players.notes', 'map.view', 'detections.view',
      'bans.view', 'bans.appeals', 'lookup.view'],
  },
];

/** Effective permissions = role perms + extra − denied. */
function effectivePermissions(rolePerms, extra = [], denied = []) {
  const set = new Set([...(rolePerms || []), ...(extra || [])]);
  for (const d of denied || []) set.delete(d);
  return [...set].filter((p) => PERMISSIONS[p]);
}

module.exports = { PERMISSIONS, ALL, DEFAULT_ROLES, effectivePermissions };
