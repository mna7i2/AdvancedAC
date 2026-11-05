'use strict';
/**
 * npm run build:template — snapshots resource/AdvancedAC into src/assets/resource-template.json so the
 * backend can generate a ready-to-install, licensed .zip per customer server (Customers → Download files).
 * Run after every resource change (after build:nui), then upload the JSON with the backend.
 */
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, '..', '..', 'resource', 'AdvancedAC');
const OUT = path.join(__dirname, 'assets', 'resource-template.json');
const files = [];
(function walk(dir) {
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    const rel = path.relative(RES, p).split(path.sep).join('/');
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (/^server\/license.*\.lua$/.test(rel)) continue;   // never ship a license inside the template
    files.push({ path: rel, b64: fs.readFileSync(p).toString('base64') });
  }
}(RES));
const version = (fs.readFileSync(path.join(RES, 'shared', 'settings.lua'), 'utf8').match(/AC\.Version = '([^']+)'/) || [])[1] || '?';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ version, builtAt: new Date().toISOString(), files }));
console.log(`resource template: ${files.length} files, v${version} -> ${OUT}`);
