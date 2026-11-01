'use strict';
const db = require('../db');
const { merge } = require('../detections/catalog');

/** Organization-level settings with defaults. Stored per key in org_settings. */
const DEFAULTS = {
  risk: {
    halfLifeHours: 24,               // risk decays by half every N hours
    weights: { low: 5, medium: 15, high: 30, critical: 60 },
    unverifiedMultiplier: 0.5,       // client signals count half
    thresholds: { medium: 25, high: 50, critical: 80 },
    // Escalate to automatic ban at critical risk only if at least one verified
    // high/critical detection exists within this window.
    autoBanOnCritical: true,
    criticalRequiresVerifiedWithinHours: 24,
    escalationBanDuration: 0,       // hours, 0 = permanent
  },
  enforcement: {
    // Ban attempts from unverified signals are downgraded to this action.
    unverifiedBanFallback: 'kick',
    kickMessage: 'You were removed by Sentinel AC: {reason}',
    banMessage: 'You are banned from this server.\nBan ID: {banId}\nReason: {reason}\nExpires: {expires}\nAppeal: {appealUrl}',
    // Hardware-token-only matches against a ban: 'block' or 'review' (allow + alert)
    tokenOnlyMatch: 'review',
  },
  telemetry: {
    intervalMs: 2000,       // server-side sampling of player state (min 1000)
    heartbeatMs: 3000,      // resource → backend heartbeat / command poll
    storeReplay: true,
  },
  monitoring: { defaultIntervalMs: 3000, minIntervalMs: 1000, maxFramesPerSession: 600 },
  map: {
    // World bounds of the map image (configurable calibration, see Settings → Map)
    image: '/assets/map/gtav.jpg',
    minX: -5709.9, maxX: 6734.7, minY: -4123.9, maxY: 8492.1,
  },
  general: { appealUrl: '', serverDisplayName: '', protectionLevel: 'balanced' },
  // Exempt zones (e.g. a military training area): detections listed are skipped inside the sphere.
  zones: { list: [] },
};

async function getSettings(orgId) {
  const rows = await db.many('SELECT key, value FROM org_settings WHERE org_id = $1', [orgId]);
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const row = rows.find((r) => r.key === k);
    out[k] = merge(DEFAULTS[k], row ? row.value : {});
  }
  if (!out.general.appealUrl) out.general.appealUrl = `${require('../config').publicUrl}/appeal`;
  return out;
}

async function setSetting(orgId, key, value) {
  if (!DEFAULTS[key]) throw new Error('unknown settings key');
  await db.query(
    `INSERT INTO org_settings(org_id, key, value, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [orgId, key, value]);
}

module.exports = { DEFAULTS, getSettings, setSetting };
