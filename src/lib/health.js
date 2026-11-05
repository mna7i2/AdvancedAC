'use strict';
const config = require('../config');

/** Compare dotted versions: returns -1, 0, 1. */
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

const LEVEL_RANK = { ok: 0, info: 1, warn: 2, error: 3 };

/**
 * Problems of one customer server, worst first. Each problem: { level, code, text }.
 *  - server: servers row
 *  - license: the org's active license row (or null)
 *  - stats: { heartbeatKicks24h, disabledDetections }
 */
function serverProblems(server, license, stats = {}) {
  const out = [];
  const add = (level, code, text) => out.push({ level, code, text });
  const h = server.health || {};

  if (!license) add('error', 'license', 'No active license — protection is switched off on this server');
  else if (license.expires_at) {
    const days = (new Date(license.expires_at) - Date.now()) / 86400000;
    if (days < 7) add('warn', 'license_expiring', `License expires in ${Math.max(0, Math.ceil(days))} day(s)`);
  }

  if (!server.last_heartbeat) {
    add('warn', 'not_installed', 'Never connected — resource not installed or API key missing in server.cfg');
  } else if (server.status !== 'online') {
    const hrs = (Date.now() - new Date(server.last_heartbeat)) / 3600000;
    add(hrs < 24 * 7 ? 'error' : 'warn', 'offline', `Offline since ${hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs < 48 ? Math.round(hrs) + ' h' : Math.round(hrs / 24) + ' days'}`);
  }

  if (server.last_heartbeat) {
    if (server.onesync === false) add('error', 'onesync', 'OneSync is off — most server-side detections cannot work');
    if (server.ac_version && cmpVersion(server.ac_version, config.acLatestVersion) < 0) {
      add('warn', 'outdated', `Outdated anti-cheat ${server.ac_version} (latest ${config.acLatestVersion})`);
    }
    if (h.screenshot === false) add('warn', 'screenshot', 'screenshot-basic is not running — no screenshot evidence before bans');
    if (h.licenseDenied) add('error', 'denied', 'The server reports that the backend rejects it (license / key)');
    if (Number(h.apiFailures) >= 3) add('warn', 'api', 'Requests from the server to the backend are failing');
    if (h.pureLevel === 0) add('info', 'pure', 'sv_pureLevel is off — players can join with modded game files');
  }
  if ((stats.heartbeatKicks24h || 0) >= 5) {
    add('warn', 'client', `${stats.heartbeatKicks24h} players removed for a missing anti-cheat client in 24h — check for a blocked client or a broken script`);
  }
  if ((stats.disabledDetections || 0) >= 5) add('info', 'disabled', `${stats.disabledDetections} detections are disabled`);

  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}

function worstLevel(problems) {
  return problems.reduce((w, p) => (LEVEL_RANK[p.level] > LEVEL_RANK[w] ? p.level : w), 'ok');
}

module.exports = { serverProblems, worstLevel, cmpVersion, LEVEL_RANK };
