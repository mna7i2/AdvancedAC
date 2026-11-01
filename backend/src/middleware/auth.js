'use strict';
const db = require('../db');
const config = require('../config');
const { sha256, randomToken } = require('../lib/crypto');
const { effectivePermissions } = require('../lib/permissions');

const COOKIE = 'sac_session';

async function createSession(userId, ip, userAgent) {
  const token = randomToken('sac_sess');
  await db.query(
    `INSERT INTO sessions(token_hash, user_id, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)`,
    [sha256(token), userId, ip, (userAgent || '').slice(0, 256), config.sessionTtlHours]);
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: config.isProd, path: '/', maxAge: config.sessionTtlHours * 3600000,
  });
}

/** Resolve a session token to { user, perms } or null. Sliding expiry is refreshed at most every 5 min. */
async function resolveSession(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('sac_sess_')) return null;
  const row = await db.one(
    `SELECT s.token_hash, s.last_seen, u.id, u.org_id, u.email, u.display_name, u.active, u.extra_permissions,
            u.denied_permissions, u.linked_identifiers, r.name AS role_name, r.rank AS role_rank, r.permissions AS role_permissions,
            o.name AS org_name
     FROM sessions s JOIN admin_users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id JOIN organizations o ON o.id = u.org_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
  if (!row || !row.active) return null;
  if (Date.now() - new Date(row.last_seen).getTime() > 300000) {
    await db.query(`UPDATE sessions SET last_seen = now(), expires_at = now() + ($2 || ' hours')::interval WHERE token_hash = $1`,
      [row.token_hash, config.sessionTtlHours]);
  }
  const perms = effectivePermissions(row.role_permissions, row.extra_permissions, row.denied_permissions);
  return {
    user: { id: row.id, orgId: row.org_id, orgName: row.org_name, email: row.email, name: row.display_name,
      role: row.role_name, rank: row.role_rank, linkedIdentifiers: row.linked_identifiers },
    perms: new Set(perms), tokenHash: row.token_hash,
  };
}

/**
 * Dashboard API auth. CSRF defence: cookie is SameSite=strict AND every state-changing request must
 * carry the custom header X-SAC-Request (cannot be set cross-origin without CORS, which we never allow).
 */
async function requireAuth(req, res, next) {
  try {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-sac-request') !== '1') {
      return res.status(403).json({ error: 'missing request header' });
    }
    const s = await resolveSession(req.cookies[COOKIE]);
    if (!s) return res.status(401).json({ error: 'unauthenticated' });
    req.user = s.user;
    req.perms = s.perms;
    req.sessionHash = s.tokenHash;
    next();
  } catch (e) { next(e); }
}

const can = (...perms) => (req, res, next) =>
  (perms.some((p) => req.perms.has(p)) ? next() : res.status(403).json({ error: 'forbidden', required: perms }));

module.exports = { COOKIE, createSession, setSessionCookie, resolveSession, requireAuth, can };
