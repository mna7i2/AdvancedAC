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
test('critical risk sends the player to staff review by default (fair bans), never an automatic ban', () => {
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: true, riskAfter: 85 }).action, 'review');
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: false, riskAfter: 85 }).action, 'warn');
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: false, riskAfter: 85, hasRecentVerifiedSevere: true }).action, 'review');
});
test('escalationMode=ban escalates to an automatic ban only with verified strong evidence', () => {
  const s = JSON.parse(JSON.stringify(settings)); s.risk.escalationMode = 'ban';
  assert.equal(decide({ ...base, settings: s, cfg: { action: 'warn' }, verified: true, riskAfter: 85 }).action, 'ban');
  assert.equal(decide({ ...base, settings: s, cfg: { action: 'warn' }, verified: true, riskAfter: 85, strongEvidence: false }).action, 'warn');
});
test('weak-evidence detection configured to BAN becomes a staff review', () => {
  const r = decide({ ...base, cfg: { action: 'ban' }, verified: true, strongEvidence: false });
  assert.equal(r.action, 'review');
  assert.match(r.note, /not proof/);
});
test('progressive punishments: step follows the offense number, last step repeats', () => {
  const cfg = { action: 'kick', banDuration: 0, ladder: { enabled: true, windowHours: 72, steps: [{ action: 'warn' }, { action: 'kick' }, { action: 'ban', hours: 24 }, { action: 'ban', hours: 0 }] } };
  assert.equal(decide({ ...base, cfg, verified: true, offenses: 0 }).action, 'warn');
  assert.equal(decide({ ...base, cfg, verified: true, offenses: 1 }).action, 'kick');
  const third = decide({ ...base, cfg, verified: true, offenses: 2 });
  assert.equal(third.action, 'ban'); assert.equal(third.banHours, 24); assert.match(third.note, /offense #3/);
  assert.equal(decide({ ...base, cfg, verified: true, offenses: 9 }).banHours, 0);
  assert.equal(decide({ ...base, cfg, verified: false, offenses: 2 }).action, 'kick', 'client signals still never ban');
});
test('ladder sanitizer keeps only valid steps', () => {
  const ov = sanitizeOverride('speed_onfoot', { ladder: { enabled: true, windowHours: 99999, steps: [{ action: 'warn' }, { action: 'nuke' }, { action: 'ban', hours: 48 }] } });
  assert.deepEqual(ov.ladder, { enabled: true, windowHours: 72, steps: [{ action: 'warn' }, { action: 'ban', hours: 48 }] });
});
test('evidence explanations are concrete in English and Arabic', () => {
  const { explain } = require('../src/lib/evidence');
  assert.equal(explain('speed_onfoot', { speed: 38.24, limit: 14, samples: 3 }), 'Ran at 38.2 m/s — limit 14 m/s, 3 samples in a row');
  assert.match(explain('weapon_blacklist', { weapon: 'WEAPON_RAILGUN' }, 'ar'), /WEAPON_RAILGUN/);
  assert.match(explain('unknown_key', { a: 1 }), /a: 1/);
  for (const d of CATALOG) assert.ok(explain(d.key, {}).length > 3, 'explanation for ' + d.key);
});
test('low-severity verified detection at critical risk does not escalate by itself', () => {
  assert.equal(decide({ ...base, severity: 'low', cfg: { action: 'log' }, verified: true, riskAfter: 90 }).action, 'log');
});
test('reputation bypass blocks escalation, whitelist logs only', () => {
  assert.equal(decide({ ...base, cfg: { action: 'warn' }, verified: true, riskAfter: 95, reputationBypass: true }).action, 'warn');
  assert.equal(decide({ ...base, cfg: { action: 'ban' }, verified: true, whitelisted: true }).action, 'log');
});
test('autoBanOnCritical=false disables escalation (legacy switch)', () => {
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
