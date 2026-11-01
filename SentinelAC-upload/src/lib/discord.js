'use strict';
const db = require('../db');
const { encrypt, decrypt } = require('./crypto');
const log = require('./logger');
const config = require('../config');

const CATEGORIES = {
  ban_auto: 'Automatic bans',
  ban_manual: 'Manual bans',
  unban: 'Unbans',
  detection: 'Detections (warn/kick/log)',
  critical: 'Critical alerts',
  connect: 'Player connections',
  disconnect: 'Player disconnections',
  resource: 'Resource / server alerts',
  appeal: 'Ban appeals',
};

const COLORS = { red: 0xe5484d, orange: 0xf5a524, green: 0x30a46c, blue: 0x3e8ed0, gray: 0x6b7280 };
const URL_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const queue = [];
let running = false;
const cache = new Map(); // orgId -> { at, hooks }

async function hooksFor(orgId) {
  const c = cache.get(orgId);
  if (c && Date.now() - c.at < 30000) return c.hooks;
  const rows = await db.many('SELECT category, url_enc, enabled FROM webhooks WHERE org_id = $1', [orgId]);
  const hooks = {};
  for (const r of rows) if (r.enabled) { try { hooks[r.category] = decrypt(r.url_enc); } catch { /* corrupted */ } }
  cache.set(orgId, { at: Date.now(), hooks });
  return hooks;
}

async function setWebhook(orgId, category, url, enabled) {
  if (!CATEGORIES[category]) throw new Error('unknown category');
  if (url === null) {
    await db.query('DELETE FROM webhooks WHERE org_id=$1 AND category=$2', [orgId, category]);
  } else if (url === undefined) {
    await db.query('UPDATE webhooks SET enabled=$3, updated_at=now() WHERE org_id=$1 AND category=$2', [orgId, category, enabled]);
  } else {
    if (!URL_RE.test(url)) throw new Error('invalid Discord webhook URL');
    await db.query(
      `INSERT INTO webhooks(org_id, category, url_enc, enabled) VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, category) DO UPDATE SET url_enc=EXCLUDED.url_enc, enabled=EXCLUDED.enabled, updated_at=now()`,
      [orgId, category, encrypt(url), enabled !== false]);
  }
  cache.delete(orgId);
}

/** Public listing never returns the URL — only whether one is configured and a masked hint. */
async function listWebhooks(orgId) {
  const rows = await db.many('SELECT category, url_enc, enabled, updated_at FROM webhooks WHERE org_id=$1', [orgId]);
  return Object.entries(CATEGORIES).map(([key, label]) => {
    const r = rows.find((x) => x.category === key);
    let hint = null;
    if (r) { try { const u = decrypt(r.url_enc); hint = '…/webhooks/' + u.split('/').slice(-2, -1)[0].slice(-4) + '/••••'; } catch { hint = 'unreadable'; } }
    return { category: key, label, configured: !!r, enabled: r ? r.enabled : false, hint, updatedAt: r ? r.updated_at : null };
  });
}

/** Fire-and-forget: never blocks the caller (enforcement must not wait on Discord). */
function notify(orgId, category, embed) {
  queue.push({ orgId, category, embed, attempts: 0 });
  if (!running) drain();
}

async function send(url, body) {
  const res = await fetch(url + '?wait=false', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    const e = new Error('rate limited'); e.retryAfter = Math.ceil((j.retry_after || 2) * 1000); throw e;
  }
  if (!res.ok) { const e = new Error('discord ' + res.status); e.fatal = res.status >= 400 && res.status < 500; throw e; }
}

async function drain() {
  running = true;
  while (queue.length) {
    const job = queue[0];
    try {
      const hooks = await hooksFor(job.orgId);
      const url = hooks[job.category];
      if (url) await send(url, { username: 'Sentinel AC', embeds: [job.embed] });
      queue.shift();
    } catch (e) {
      job.attempts++;
      if (e.fatal || job.attempts >= 5) { log.warn('discord webhook dropped', { category: job.category, err: e.message }); queue.shift(); continue; }
      await new Promise((r) => setTimeout(r, e.retryAfter || 1000 * 2 ** job.attempts));
    }
  }
  running = false;
}

// ─── Embed builders ───
function idsField(identifiers) {
  const show = (identifiers || []).filter((i) => !['ip', 'token'].includes(i.kind)).slice(0, 6);
  return show.length ? show.map((i) => `\`${i.kind}:${i.value}\``).join('\n') : '—';
}

function banEmbed(ban, serverName) {
  return {
    title: ban.automatic ? '⛔ Automatic Ban' : '🔨 Manual Ban',
    color: COLORS.red,
    fields: [
      { name: 'Player', value: ban.player_name, inline: true },
      { name: 'Ban ID', value: '`' + ban.id + '`', inline: true },
      { name: 'Expires', value: ban.expires_at ? `<t:${Math.floor(new Date(ban.expires_at) / 1000)}:R>` : 'Permanent', inline: true },
      { name: 'Reason', value: ban.reason.slice(0, 1000) },
      ...(ban.detection_key ? [{ name: 'Detection', value: `${ban.detection_key} (${ban.category})`, inline: true }] : []),
      { name: 'Issued by', value: ban.issued_by_name, inline: true },
      { name: 'Identifiers', value: idsField(ban.identifiers) },
      { name: 'Details', value: `${config.publicUrl}/#/bans/${ban.id}` },
    ],
    footer: { text: serverName || 'Sentinel AC' },
    timestamp: new Date(ban.created_at || Date.now()).toISOString(),
  };
}

function detectionEmbed(det, playerName, identifiers, serverName) {
  const color = det.severity === 'critical' ? COLORS.red : det.severity === 'high' ? COLORS.orange : COLORS.blue;
  return {
    title: `🛡️ Detection: ${det.name || det.detection_key}`,
    color,
    fields: [
      { name: 'Player', value: playerName || 'unknown', inline: true },
      { name: 'Severity', value: det.severity, inline: true },
      { name: 'Action', value: det.action_taken, inline: true },
      { name: 'Verified', value: det.verified ? 'Server-verified' : 'Client signal (unverified)', inline: true },
      { name: 'Risk', value: `${Math.round(det.risk_after)}/100`, inline: true },
      { name: 'Details', value: '```json\n' + JSON.stringify(det.details).slice(0, 900) + '\n```' },
      { name: 'Identifiers', value: idsField(identifiers) },
    ],
    footer: { text: serverName || 'Sentinel AC' },
    timestamp: new Date().toISOString(),
  };
}

function simpleEmbed(title, description, color = 'gray', serverName) {
  return { title, description, color: COLORS[color] || COLORS.gray, footer: { text: serverName || 'Sentinel AC' }, timestamp: new Date().toISOString() };
}

module.exports = { CATEGORIES, notify, setWebhook, listWebhooks, banEmbed, detectionEmbed, simpleEmbed, URL_RE };
