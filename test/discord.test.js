'use strict';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://sentinel:sentinel_dev@127.0.0.1:5432/sentinel';
require('../src/config');
const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const discord = require('../src/lib/discord');

test('webhook URLs are encrypted, never listed, delivered with retry on 429', async (t) => {
  const org = await db.one("INSERT INTO organizations(name) VALUES ('discord-test') RETURNING id");
  const url = 'https://discord.com/api/webhooks/123456789/abcDEF-token';
  await discord.setWebhook(org.id, 'ban_auto', url, true);
  const raw = await db.one('SELECT url_enc FROM webhooks WHERE org_id=$1', [org.id]);
  assert.ok(!raw.url_enc.includes('discord.com'), 'stored encrypted');
  const list = await discord.listWebhooks(org.id);
  assert.ok(!JSON.stringify(list).includes('abcDEF-token'), 'token never returned');
  assert.equal(list.find((x) => x.category === 'ban_auto').configured, true);
  await assert.rejects(discord.setWebhook(org.id, 'ban_auto', 'https://evil.example.com/x', true));

  const calls = [];
  const orig = global.fetch;
  global.fetch = async (u, opts) => {
    calls.push({ u, body: JSON.parse(opts.body) });
    if (calls.length === 1) return { status: 429, ok: false, json: async () => ({ retry_after: 0.05 }) };
    return { status: 204, ok: true };
  };
  t.after(async () => { global.fetch = orig; await db.query('DELETE FROM organizations WHERE id=$1', [org.id]); await db.pool.end(); });
  discord.notify(org.id, 'ban_auto', discord.banEmbed({ id: 'SB-TEST', player_name: 'Cheater', reason: 'Invisible explosion', automatic: true, issued_by_name: 'Sentinel AC', identifiers: [{ kind: 'license', value: 'abc' }, { kind: 'ip', value: 'hash' }] }, 'Srv'));
  discord.notify(org.id, 'detection', { title: 'not configured' });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(calls.length, 2, 'retried once after 429; unconfigured category not sent');
  assert.equal(calls[1].u, url + '?wait=false');
  const embed = calls[1].body.embeds[0];
  assert.match(embed.title, /Automatic Ban/);
  assert.ok(!JSON.stringify(embed).includes('ip:'), 'IP identifiers never sent to Discord');
});
