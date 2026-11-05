'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const orgs = require('./orgs');
const license = require('./license');
const { setSetting } = require('../lib/settings');
const { serverProblems, worstLevel } = require('../lib/health');
const { clearLicenseCache } = require('../middleware/agentAuth');

/**
 * Vendor ("platform") operations: every customer is an organization with its own license, servers,
 * staff accounts and settings. Only platform admins reach these functions.
 */

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

/** Readable strong password, e.g. "Kp7d-Xq3m-9TzR" (letters + digits, no look-alike characters). */
function generatePassword() {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += pick(i === (g + 1) % 4 ? DIGITS : ALPHA + DIGITS);
    groups.push(s);
  }
  let pw = groups.join('-');
  if (!/[A-Za-z]/.test(pw)) pw = 'K' + pw.slice(1);
  if (!/[0-9]/.test(pw)) pw = pw.slice(0, -1) + '7';
  return pw;
}

function emailDomain() {
  try {
    const host = new URL(config.publicUrl).hostname;
    return host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : 'sentinel-ac.local';
  } catch { return 'sentinel-ac.local'; }
}

function slugify(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 24);
  return s.length >= 3 ? s : 'server' + crypto.randomInt(1000, 9999);
}

/** Login email derived from the server name, unique across the installation. */
async function suggestEmail(name) {
  const base = slugify(name);
  const domain = emailDomain();
  for (let i = 0; i < 50; i++) {
    const candidate = `${i ? `${base}${i + 1}` : base}@${domain}`;
    const taken = await db.one('SELECT 1 FROM admin_users WHERE lower(email) = lower($1)', [candidate]);
    if (!taken) return candidate;
  }
  return `${base}${crypto.randomInt(10000, 99999)}@${domain}`;
}

function serverCfgSnippet(apiKey) {
  return [
    '# Sentinel AC',
    'add_ace resource.AdvancedAC command allow',
    'add_ace group.admin sentinel.admin allow',
    'add_ace group.admin sentinel.bypass allow',
    `set sentinel_backend "${config.publicUrl}"`,
    `set sentinel_api_key "${apiKey}"`,
    'ensure screenshot-basic',
    'ensure AdvancedAC',
  ].join('\n');
}

/** Pick the license that currently governs an org (same rule as license.activeLicense). */
function governing(list) {
  const now = Date.now();
  const valid = list.filter((l) => l.status === 'active' && (!l.expires_at || new Date(l.expires_at) > now));
  valid.sort((a, b) => b.max_servers - a.max_servers || (a.expires_at ? 1 : 0) - (b.expires_at ? 1 : 0) || new Date(b.expires_at) - new Date(a.expires_at));
  return valid[0] || null;
}

function licenseView(list) {
  const g = governing(list);
  const latest = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  const l = g || latest;
  if (!l) return { status: 'none', plan: null, maxServers: 0, expiresAt: null, keyPrefix: null };
  let status = l.status;
  if (status === 'active' && l.expires_at && new Date(l.expires_at) <= Date.now()) status = 'expired';
  return { id: l.id, status, plan: l.plan, maxServers: l.max_servers, expiresAt: l.expires_at, keyPrefix: l.key_prefix, createdAt: l.created_at };
}

/** Everything the customer list needs, in a handful of queries. */
async function loadAll() {
  const [orgRows, lic, servers, det, bans, hb, disabled, owners, reviews] = await Promise.all([
    db.many('SELECT id, name, status, contact, notes, created_at FROM organizations ORDER BY created_at'),
    db.many('SELECT * FROM licenses ORDER BY created_at'),
    db.many(`SELECT id, org_id, name, status, last_heartbeat, player_count, max_players, ac_version, framework, onesync,
                    health, fingerprint IS NOT NULL AS bound, hostname, maintenance, created_at FROM servers ORDER BY created_at`),
    db.many(`SELECT org_id, count(*)::int AS n FROM detections WHERE created_at > now() - interval '24 hours' GROUP BY org_id`),
    db.many(`SELECT org_id, count(*)::int AS n FROM bans WHERE created_at > now() - interval '24 hours' GROUP BY org_id`),
    db.many(`SELECT server_id, count(*)::int AS n FROM detections WHERE detection_key = 'ac_heartbeat' AND action_taken IN ('kick','ban')
             AND created_at > now() - interval '24 hours' GROUP BY server_id`),
    db.many(`SELECT org_id, count(*)::int AS n FROM detection_overrides WHERE config->>'enabled' = 'false' GROUP BY org_id`),
    db.many(`SELECT DISTINCT ON (a.org_id) a.org_id, a.id, a.email, a.display_name, a.last_login
             FROM admin_users a JOIN roles r ON r.id = a.role_id WHERE r.name = 'Owner' ORDER BY a.org_id, a.created_at`),
    db.many(`SELECT org_id, count(*)::int AS n FROM ban_reviews WHERE status = 'open' GROUP BY org_id`),
  ]);
  const by = (rows, key = 'org_id') => Object.fromEntries(rows.map((r) => [r[key], r]));
  const detBy = by(det); const banBy = by(bans); const hbBy = by(hb, 'server_id'); const disBy = by(disabled);
  const ownerBy = by(owners); const revBy = by(reviews);
  const licBy = {}; for (const l of lic) (licBy[l.org_id] = licBy[l.org_id] || []).push(l);
  const srvBy = {}; for (const s of servers) (srvBy[s.org_id] = srvBy[s.org_id] || []).push(s);

  return orgRows.map((o) => {
    const licenses = licBy[o.id] || [];
    const gov = governing(licenses);
    const srv = (srvBy[o.id] || []).map((s) => {
      const problems = serverProblems(s, gov, { heartbeatKicks24h: hbBy[s.id] ? hbBy[s.id].n : 0, disabledDetections: disBy[o.id] ? disBy[o.id].n : 0 });
      return {
        id: s.id, name: s.name, status: s.status, lastHeartbeat: s.last_heartbeat, players: s.player_count, maxPlayers: s.max_players,
        acVersion: s.ac_version, framework: s.framework, onesync: s.onesync, bound: s.bound, hostname: s.hostname,
        maintenance: s.maintenance, health: s.health || {}, problems, level: worstLevel(problems), createdAt: s.created_at,
      };
    });
    const orgProblems = [];
    if (!srv.length) orgProblems.push({ level: 'warn', code: 'no_server', text: 'No server created yet' });
    if (o.status === 'suspended') orgProblems.push({ level: 'error', code: 'suspended', text: 'Customer is suspended' });
    const all = [...orgProblems, ...srv.flatMap((s) => s.problems.map((p) => ({ ...p, server: s.name })))];
    return {
      id: o.id, name: o.name, status: o.status, contact: o.contact, notes: o.notes, createdAt: o.created_at,
      license: licenseView(licenses), owner: ownerBy[o.id] ? { id: ownerBy[o.id].id, email: ownerBy[o.id].email, name: ownerBy[o.id].display_name, lastLogin: ownerBy[o.id].last_login } : null,
      servers: srv,
      serversOnline: srv.filter((s) => s.status === 'online').length,
      playersOnline: srv.reduce((n, s) => n + (s.status === 'online' ? s.players : 0), 0),
      detections24h: detBy[o.id] ? detBy[o.id].n : 0,
      bans24h: banBy[o.id] ? banBy[o.id].n : 0,
      reviewsOpen: revBy[o.id] ? revBy[o.id].n : 0,
      problems: all, level: worstLevel(all),
    };
  });
}

async function createCustomer({ serverName, ownerName, email, password, plan = 'standard', maxServers = 1, days = null,
  contact = '', notes = '', createdBy = null }) {
  const name = serverName.trim();
  const login = (email && email.trim().toLowerCase()) || await suggestEmail(name);
  if (await db.one('SELECT 1 FROM admin_users WHERE lower(email) = lower($1)', [login])) {
    throw Object.assign(new Error('That email is already used by another account'), { status: 409 });
  }
  const pw = password || generatePassword();
  const pwErr = orgs.validatePassword(pw);
  if (pwErr) throw Object.assign(new Error(pwErr), { status: 400 });

  const { org, owner } = await orgs.createOrg(name, { email: login, name: ownerName || `${name} Owner`, password: pw });
  await db.query('UPDATE organizations SET contact=$2, notes=$3, created_by=$4 WHERE id=$1', [org.id, contact, notes, createdBy]);
  await setSetting(org.id, 'general', { appealUrl: '', serverDisplayName: name, protectionLevel: 'balanced' });
  const lic = await license.createLicense(org.id, { plan, maxServers, days });
  const server = await orgs.createServer(org.id, name, 'Created by your Sentinel AC provider');
  return {
    customer: { id: org.id, name },
    login: { url: config.publicUrl, email: owner.email, password: pw },
    license: { key: lic.key, plan: lic.plan, maxServers: lic.max_servers, expiresAt: lic.expires_at },
    server: { id: server.id, name: server.name, apiKey: server.apiKey, cfg: serverCfgSnippet(server.apiKey) },
  };
}

/** Extend / change the governing license (creates one if the customer has none). */
async function updateLicense(orgId, { days, lifetime, maxServers, plan }) {
  const list = await db.many('SELECT * FROM licenses WHERE org_id=$1 ORDER BY created_at DESC', [orgId]);
  let l = governing(list) || list[0];
  if (!l) {
    const created = await license.createLicense(orgId, { plan: plan || 'standard', maxServers: maxServers || 1, days: lifetime ? null : (days || 30) });
    clearLicenseCache();
    return created;
  }
  let expires = l.expires_at;
  if (lifetime) expires = null;
  else if (days) {
    const from = l.expires_at && new Date(l.expires_at) > Date.now() ? new Date(l.expires_at) : new Date();
    expires = new Date(from.getTime() + days * 86400000);
  }
  const row = await db.one(
    `UPDATE licenses SET expires_at=$2, max_servers=$3, plan=$4, status = CASE WHEN status = 'revoked' THEN 'revoked' ELSE 'active' END
     WHERE id=$1 RETURNING *`,
    [l.id, expires, maxServers || l.max_servers, plan || l.plan]);
  clearLicenseCache();
  return row;
}

async function setSuspended(orgId, suspended) {
  await db.tx(async (t) => {
    await t.query('UPDATE organizations SET status=$2 WHERE id=$1', [orgId, suspended ? 'suspended' : 'active']);
    if (suspended) {
      await t.query("UPDATE licenses SET status='suspended' WHERE org_id=$1 AND status='active'", [orgId]);
      await t.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM admin_users WHERE org_id=$1 AND NOT platform_admin)', [orgId]);
    } else {
      await t.query("UPDATE licenses SET status='active' WHERE org_id=$1 AND status='suspended'", [orgId]);
    }
  });
  clearLicenseCache();
}

async function resetPassword(orgId, userId) {
  const u = userId
    ? await db.one('SELECT id, email FROM admin_users WHERE id=$1 AND org_id=$2', [userId, orgId])
    : await db.one(`SELECT a.id, a.email FROM admin_users a JOIN roles r ON r.id = a.role_id
                    WHERE a.org_id=$1 AND r.name='Owner' ORDER BY a.created_at LIMIT 1`, [orgId]);
  if (!u) return null;
  const pw = generatePassword();
  await db.query('UPDATE admin_users SET password_hash=$2, failed_logins=0, locked_until=NULL, active=true WHERE id=$1', [u.id, await bcrypt.hash(pw, 12)]);
  await db.query('DELETE FROM sessions WHERE user_id=$1', [u.id]);
  return { email: u.email, password: pw };
}

async function deleteCustomer(orgId) {
  await db.tx(async (t) => {
    await t.query('DELETE FROM ban_identifiers WHERE org_id=$1', [orgId]);
    await t.query('DELETE FROM bans WHERE org_id=$1', [orgId]);
    await t.query('DELETE FROM activity WHERE org_id=$1', [orgId]);
    await t.query('DELETE FROM organizations WHERE id=$1', [orgId]);   // cascades licenses, servers, staff, players…
  });
  clearLicenseCache();
}

module.exports = { loadAll, createCustomer, updateLicense, setSuspended, resetPassword, deleteCustomer, suggestEmail,
  generatePassword, serverCfgSnippet, licenseView, governing };
