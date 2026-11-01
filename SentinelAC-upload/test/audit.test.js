'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://sentinel:sentinel_dev@127.0.0.1:5432/sentinel';
require('../src/config');
const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const { audit, verifyChain } = require('../src/lib/audit');

test('audit chain survives undefined fields, Dates and key reordering by JSONB', async (t) => {
  const org = await db.one("INSERT INTO organizations(name) VALUES ('audit-test') RETURNING id");
  t.after(async () => { await db.pool.end(); });
  await audit({ orgId: org.id, actorType: 'admin', actorName: 'A', action: 'x.one', details: { reason: undefined, z: 1, a: { y: 2, b: 3 } } });
  await audit({ orgId: org.id, actorType: 'system', actorName: 'B', action: 'x.two', details: { when: new Date(), list: [3, 1, 2] } });
  await audit({ orgId: org.id, actorType: 'admin', actorName: 'C', action: 'x.three' });
  const r = await verifyChain(org.id);
  assert.deepEqual(r, { ok: true, checked: 3, brokenAt: null });
  await assert.rejects(db.query('UPDATE audit_log SET actor_name=$2 WHERE org_id=$1', [org.id, 'tampered']), /append-only/);
  await assert.rejects(db.query('DELETE FROM audit_log WHERE org_id=$1', [org.id]), /append-only/);
});
