'use strict';
const path = require('path');
const fs = require('fs');

// Minimal .env loader (avoids a dependency). Real env vars take precedence.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  port: parseInt(process.env.PORT || '8080', 10),
  host: process.env.HOST || '0.0.0.0',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  // 32+ byte secret used for webhook URL encryption and audit chain. Never rotate without re-encrypting.
  appSecret: required('APP_SECRET'),
  trustProxy: process.env.TRUST_PROXY === '1',
  evidenceDir: path.resolve(process.env.EVIDENCE_DIR || path.join(__dirname, '..', 'storage', 'evidence')),
  sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS || '12', 10),
  telemetryRetentionDays: parseInt(process.env.TELEMETRY_RETENTION_DAYS || '7', 10),
  serverOfflineAfterSec: 30,
  acLatestVersion: '1.0.0',
  // Origins allowed to call the dashboard API with a bearer session (the in-game /adv panel runs on
  // https://cfx-nui-<resource>). Extra origins (comma separated) can be added for testing.
  nuiOriginRegex: new RegExp(process.env.NUI_ORIGIN_REGEX || '^https://cfx-nui-[a-z0-9_.-]+$', 'i'),
  extraOrigins: (process.env.NUI_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

if (config.appSecret.length < 32) throw new Error('APP_SECRET must be at least 32 characters');

module.exports = config;
