'use strict';
/**
 * Generates resource/AdvancedAC/server/defaults.lua from the detection catalog + default settings.
 * The resource uses it until the backend sends its config (first start, or no backend configured),
 * so protection is active from the very first second.   Usage: npm run gen:defaults
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'unused';
process.env.APP_SECRET = process.env.APP_SECRET || 'x'.repeat(40);
const fs = require('fs');
const path = require('path');
const { CATALOG, resolveConfig } = require('./detections/catalog');
const { DEFAULTS } = require('./lib/settings');

function lua(v, ind = '') {
  const n = ind + '    ';
  if (Array.isArray(v)) return v.length ? '{\n' + v.map((x) => n + lua(x, n)).join(',\n') + '\n' + ind + '}' : '{}';
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    return ks.length ? '{\n' + ks.map((k) => n + (/^[A-Za-z_]\w*$/.test(k) ? k : `["${k}"]`) + ' = ' + lua(v[k], n)).join(',\n') + '\n' + ind + '}' : '{}';
  }
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

const detections = resolveConfig([]);
for (const d of CATALOG) detections[d.key].name = d.name;
const cfg = {
  detections, telemetry: DEFAULTS.telemetry, monitoring: DEFAULTS.monitoring,
  enforcement: { kickMessage: DEFAULTS.enforcement.kickMessage, banMessage: DEFAULTS.enforcement.banMessage, appealUrl: '' },
  staff: [],
};
const out = `-- GENERATED from backend/src/detections/catalog.js — do not edit by hand.
-- Built-in defaults used until the backend sends its config (first start / no backend configured).
-- Regenerate: cd backend && npm run gen:defaults
Defaults = ${lua(cfg)}
`;
const target = path.join(__dirname, '..', '..', 'resource', 'AdvancedAC', 'server', 'defaults.lua');
fs.writeFileSync(target, out);
console.log('wrote', target);
