'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createZip } = require('../lib/zip');

const TEMPLATE = path.join(__dirname, '..', 'assets', 'resource-template.json');

/** Lua string literal with escaping (names may contain quotes or Arabic). */
const lua = (v) => (v === null || v === undefined ? 'nil'
  : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'");

function templateInfo() {
  if (!fs.existsSync(TEMPLATE)) return null;
  const t = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  return { version: t.version, builtAt: t.builtAt, files: t.files.length };
}

/**
 * Ready-to-install AdvancedAC for one customer server: the resource + server/license.lua with the
 * backend URL and this server's API key baked in (server-side only, never sent to players) +
 * install instructions. The key is locked to the server's IP when IP lock is on.
 */
function buildPackage({ customerName, server, apiKey, licenseKey, ip }) {
  if (!fs.existsSync(TEMPLATE)) throw Object.assign(new Error('Resource template missing on the backend (run npm run build:template and redeploy)'), { status: 503 });
  const t = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  const files = t.files.map((f) => {
    let data = Buffer.from(f.b64, 'base64');
    // Customer copies require a valid license: no "local only" mode without the backend.
    if (f.path === 'shared/settings.lua') data = Buffer.from(data.toString('utf8').replace('AC.RequireLicense = false', 'AC.RequireLicense = true'), 'utf8');
    return { name: 'AdvancedAC/' + f.path, data };
  });
  const issued = new Date().toISOString();
  files.push({ name: 'AdvancedAC/server/license.lua', data: [
    `-- Sentinel AC license — ${customerName} / ${server.name}`,
    `-- Issued ${issued}. This file is your server's private key: never share it or upload it publicly.`,
    '-- It only works on the server it was issued for' + (ip ? ` (IP ${ip}).` : ' (locked to the first server IP that connects).'),
    'SentinelLicense = {',
    `    customer = ${lua(customerName)},`,
    `    server = ${lua(server.name)},`,
    `    serverId = ${lua(server.id)},`,
    `    license = ${lua(licenseKey || null)},`,
    `    backend = ${lua(config.publicUrl)},`,
    `    apiKey = ${lua(apiKey)},`,
    `    ip = ${lua(ip || null)},`,
    `    issued = ${lua(issued)},`,
    '}',
    '',
  ].join('\n') });
  files.push({ name: 'INSTALL.txt', data: [
    `Sentinel AC ${t.version} — ${customerName} / ${server.name}`,
    '',
    '1) Copy the AdvancedAC folder into your server "resources" folder.',
    '2) Add these lines to server.cfg (no API key needed — it is inside the files):',
    '',
    '   add_ace resource.AdvancedAC command allow',
    '   add_ace group.admin sentinel.admin allow',
    '   add_ace group.admin sentinel.bypass allow',
    '   set onesync on',
    '   ensure screenshot-basic',
    '   ensure AdvancedAC',
    '',
    `3) Restart the server. Dashboard: ${config.publicUrl}`,
    ip ? `   This license only works from the server IP ${ip}.` : '   This license locks itself to the first server IP that connects.',
    '',
    '----------------------------------------------------------------',
    '١) انسخ مجلد AdvancedAC داخل مجلد resources في سيرفرك.',
    '٢) أضف الأسطر اللي فوق في server.cfg (ما تحتاج مفتاح، المفتاح داخل الملفات).',
    '٣) أعد تشغيل السيرفر. لوحة التحكم: ' + config.publicUrl,
    ip ? `   الترخيص يشتغل بس على آيبي السيرفر ${ip}.` : '   الترخيص ينقفل على أول آيبي سيرفر يتصل.',
    '',
  ].join('\r\n') });
  return createZip(files);
}

module.exports = { buildPackage, templateInfo };
