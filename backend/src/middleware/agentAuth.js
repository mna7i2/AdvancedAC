'use strict';
const db = require('../db');
const { sha256 } = require('../lib/crypto');
const { validateServerLicense } = require('../services/license');

const licenseCache = new Map(); // serverId -> { at, result }

/**
 * Authenticates the FiveM resource. Every request carries `Authorization: Bearer <server api key>`
 * (only its SHA-256 is stored). The org license is re-validated at most every 60s, so revoking a
 * license or key takes effect within a minute without a restart.
 */
async function agentAuth(req, res, next) {
  try {
    const h = req.get('authorization') || '';
    const m = h.match(/^Bearer (sac_srv_[\w-]{20,})$/);
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    const server = await db.one('SELECT * FROM servers WHERE api_key_hash = $1', [sha256(m[1])]);
    if (!server) return res.status(401).json({ error: 'unauthorized' });

    // Fingerprint binding (cfx.re join URL / sv_licenseKey-derived). Prevents key reuse on another server.
    const fp = req.get('x-sac-fingerprint');
    if (server.fingerprint && fp && fp !== server.fingerprint) {
      return res.status(403).json({ error: 'fingerprint_mismatch', message: 'This API key is bound to another server. Reset the binding in the dashboard.' });
    }

    let lc = licenseCache.get(server.id);
    if (!lc || Date.now() - lc.at > 60000) {
      lc = { at: Date.now(), result: await validateServerLicense(server) };
      licenseCache.set(server.id, lc);
    }
    if (!lc.result.ok) return res.status(402).json({ error: lc.result.code, message: lc.result.message });

    req.server = server;
    req.license = lc.result.license;
    next();
  } catch (e) { next(e); }
}

function clearLicenseCache() { licenseCache.clear(); }

module.exports = { agentAuth, clearLicenseCache };
