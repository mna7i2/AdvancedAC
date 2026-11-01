'use strict';
const db = require('../db');
const { sha256, randomToken } = require('../lib/crypto');

/** License keys look like SAC-XXXX-XXXX-XXXX-XXXX; only the hash is stored. */
function generateLicenseKey() {
  const raw = randomToken('x', 15).slice(2).replace(/[-_]/g, '').toUpperCase().slice(0, 16).padEnd(16, 'Z');
  return 'SAC-' + raw.match(/.{4}/g).join('-');
}

async function createLicense(orgId, { plan = 'standard', maxServers = 1, days = null } = {}) {
  const key = generateLicenseKey();
  const expires = days ? new Date(Date.now() + days * 86400000) : null;
  const row = await db.one(
    `INSERT INTO licenses(org_id, key_hash, key_prefix, plan, max_servers, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, plan, max_servers, expires_at`,
    [orgId, sha256(key), key.slice(0, 8), plan, maxServers, expires]);
  return { key, ...row };
}

/** The org's best currently-valid license, or null. */
async function activeLicense(orgId) {
  return db.one(
    `SELECT * FROM licenses WHERE org_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > now())
     ORDER BY max_servers DESC, expires_at DESC NULLS FIRST LIMIT 1`, [orgId]);
}

/**
 * Validate that a server may run under its org license:
 *  - an active, unexpired license exists
 *  - number of fingerprint-bound servers ≤ max_servers (the server asking counts if already bound)
 */
async function validateServerLicense(server) {
  const lic = await activeLicense(server.org_id);
  if (!lic) return { ok: false, code: 'license_invalid', message: 'No active license for this organization' };
  const bound = await db.one(
    'SELECT count(*)::int AS n FROM servers WHERE org_id=$1 AND fingerprint IS NOT NULL AND id <> $2', [server.org_id, server.id]);
  if (bound.n + 1 > lic.max_servers) {
    return { ok: false, code: 'license_server_limit', message: `License allows ${lic.max_servers} server(s)` };
  }
  return { ok: true, license: lic };
}

module.exports = { createLicense, activeLicense, validateServerLicense, generateLicenseKey };
