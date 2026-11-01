'use strict';
// Unit tests for the pure enforcement decision and Discord delivery (no DB needed for decide()).
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x@127.0.0.1/none';
process.env.APP_SECRET = process.env.APP_SECRET || 'x'.repeat(40);
const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('../src/services/enforcement');
const { DEFAULTS } = require('../src/lib/settings');
const { CATALOG, resolveConfig, sanitizeOverride } = require('../src/detections/catalog');

const settings = JSON.parse(JSON.stringify(DEFAULTS));
const base = { severity: 'high', riskAfter: 10, hasRecentVerifiedSevere: false, whitelisted: false, reputationBypass: false, settings };

test('verified ban stays a ban', () => {
  assert.equal(decide({ ...base, cfg: { action: 'ban' }, verified: true }).action, 'ban');
});
test('unverified ban is downgraded (never ban on a client signal)', () => {
  const r = decide({ ...base, cfg: { action: 'ban' }, verified: false });
  assert.equal(r.action, 'kick');
  assert.match(r.note, /downgraded/);
});
test('critical risk escalates to ban only with verified severe evidence', () => {
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: true, riskAfter: 85 }).action, 'ban');
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: false, riskAfter: 85 }).action, 'warn');
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: false, riskAfter: 85, hasRecentVerifiedSevere: true }).action, 'ban');
});
test('low-severity verified detection at critical risk does not escalate by itself', () => {
  assert.equal(decide({ ...base, severity: 'low', cfg: { action: 'log' }, verified: true, riskAfter: 90 }).action, 'log');
});
test('reputation bypass blocks escalation, whitelist logs only', () => {
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: true, riskAfter: 95, reputationBypass: true }).action, 'warn');
  assert.equal(decide({ ...base, cfg: { action: 'ban' }, verified: true, whitelisted: true }).action, 'log');
});
test('autoBanOnCritical=false disables escalation', () => {
  const s = JSON.parse(JSON.stringify(settings)); s.risk.autoBanOnCritical = false;
  assert.equal(decide({ ...base, settings: s, cfg: { action: 'kick' }, verified: true, riskAfter: 99 }).action, 'kick');
});
test('catalog: every detection has valid defaults', () => {
  const keys = new Set();
  for (const d of CATALOG) {
    assert.ok(!keys.has(d.key), 'duplicate ' + d.key); keys.add(d.key);
    assert.ok(['log', 'warn', 'kick', 'ban'].includes(d.defaults.action), d.key);
    if (!d.verified) assert.notEqual(d.defaults.action, 'ban', 'client detection must not default to ban: ' + d.key);
  }
});
test('override sanitiser keeps only known fields and types', () => {
  const o = sanitizeOverride('speed_onfoot', { action: 'ban', enabled: false, threshold: { maxSpeed: 20, evil: 1, samples: 'x' }, extra: true, cooldown: -5 });
  assert.deepEqual(o, { action: 'ban', enabled: false, threshold: { maxSpeed: 20 } });
  assert.equal(sanitizeOverride('nope', { action: 'ban' }), null);
  assert.equal(sanitizeOverride('speed_onfoot', { action: 'nuke' }).action, undefined);
});
test('resolveConfig merges overrides over defaults', () => {
  const cfg = resolveConfig([{ detection_key: 'speed_onfoot', config: { threshold: { maxSpeed: 20 } } }]);
  assert.equal(cfg.speed_onfoot.threshold.maxSpeed, 20);
  assert.equal(cfg.speed_onfoot.threshold.samples, 3);
  assert.equal(cfg.godmode_flag.action, 'kick');
});
