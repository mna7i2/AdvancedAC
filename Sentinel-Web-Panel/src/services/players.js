'use strict';
const db = require('../db');
const { hashIdentifier } = require('../lib/crypto');

const CLEAR_KINDS = ['license', 'license2', 'steam', 'discord', 'fivem', 'xbl', 'live'];
const PRIMARY_ORDER = ['license', 'license2', 'fivem', 'steam', 'discord'];

/**
 * Normalize raw FiveM identifiers ("license:abc", ...), hardware tokens and IP into
 * [{kind, value}]. IP and tokens are HMAC-hashed: we only ever need equality, never the raw value.
 */
function normalizeIdentifiers(raw = [], tokens = [], ip = null) {
  const out = [];
  const seen = new Set();
  const push = (kind, value) => {
    const k = kind + ':' + value;
    if (!seen.has(k)) { seen.add(k); out.push({ kind, value }); }
  };
  for (const id of raw) {
    if (typeof id !== 'string') continue;
    const i = id.indexOf(':');
    if (i < 1) continue;
    const kind = id.slice(0, i).toLowerCase();
    const value = id.slice(i + 1).trim().slice(0, 128);
    if (!value) continue;
    if (CLEAR_KINDS.includes(kind)) push(kind, value);
    else if (kind === 'ip') push('ip', hashIdentifier(value));
  }
  for (const t of tokens) if (typeof t === 'string' && t.length > 4) push('token', hashIdentifier(t));
  if (ip && !out.some((x) => x.kind === 'ip')) push('ip', hashIdentifier(ip));
  return out;
}

function primaryOf(identifiers) {
  for (const k of PRIMARY_ORDER) {
    const f = identifiers.find((i) => i.kind === k);
    if (f) return `${k}:${f.value}`;
  }
  return null;
}

/** Find-or-create the org player record and refresh identifiers + name history. */
async function upsertPlayer(orgId, name, identifiers) {
  const primary = primaryOf(identifiers);
  if (!primary) throw Object.assign(new Error('player has no stable identifier'), { status: 400 });
  return db.tx(async (t) => {
    const p = await t.one(
      `INSERT INTO players(org_id, license, last_name) VALUES ($1,$2,$3)
       ON CONFLICT (org_id, license) DO UPDATE SET last_name = EXCLUDED.last_name, last_seen = now()
       RETURNING *`, [orgId, primary, name]);
    await t.query(
      `INSERT INTO player_identifiers(org_id, player_id, kind, value)
       SELECT $1, $2, k, v FROM unnest($3::text[], $4::text[]) AS u(k, v)
       ON CONFLICT (player_id, kind, value) DO UPDATE SET last_seen = now()`,
      [orgId, p.id, identifiers.map((i) => i.kind), identifiers.map((i) => i.value)]);
    await t.query(
      `INSERT INTO player_names(player_id, name) VALUES ($1,$2)
       ON CONFLICT (player_id, name) DO UPDATE SET last_seen = now()`, [p.id, name]);
    return p;
  });
}

/** Risk with exponential time decay applied (not persisted). */
function decayedRisk(score, updatedAt, halfLifeHours) {
  const hours = (Date.now() - new Date(updatedAt).getTime()) / 3600000;
  return Math.max(0, score * Math.pow(0.5, hours / Math.max(0.1, halfLifeHours)));
}

async function identifiersOf(playerId) {
  return db.many('SELECT kind, value FROM player_identifiers WHERE player_id = $1 ORDER BY kind', [playerId]);
}

module.exports = { normalizeIdentifiers, upsertPlayer, decayedRisk, identifiersOf, CLEAR_KINDS };
