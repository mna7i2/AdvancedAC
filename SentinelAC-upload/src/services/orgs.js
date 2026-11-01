'use strict';
const bcrypt = require('bcryptjs');
const db = require('../db');
const { DEFAULT_ROLES } = require('../lib/permissions');
const { randomToken, sha256 } = require('../lib/crypto');

const PASSWORD_MIN = 10;

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}

async function createOrg(name, owner) {
  const pwErr = validatePassword(owner.password);
  if (pwErr) throw new Error(pwErr);
  return db.tx(async (t) => {
    const org = await t.one('INSERT INTO organizations(name) VALUES ($1) RETURNING *', [name]);
    let ownerRole;
    for (const r of DEFAULT_ROLES) {
      const row = await t.one('INSERT INTO roles(org_id, name, rank, permissions) VALUES ($1,$2,$3,$4) RETURNING id, name',
        [org.id, r.name, r.rank, r.permissions]);
      if (r.name === 'Owner') ownerRole = row;
    }
    const user = await t.one(
      `INSERT INTO admin_users(org_id, email, display_name, password_hash, role_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, email`,
      [org.id, owner.email.toLowerCase(), owner.name, await bcrypt.hash(owner.password, 12), ownerRole.id]);
    return { org, owner: user };
  });
}

/** Creates a server and returns its API key once (only the hash is stored). */
async function createServer(orgId, name, description = '') {
  const key = randomToken('sac_srv');
  const row = await db.one(
    'INSERT INTO servers(org_id, name, description, api_key_hash, api_key_prefix) VALUES ($1,$2,$3,$4,$5) RETURNING id, name',
    [orgId, name, description, sha256(key), key.slice(0, 14)]);
  return { ...row, apiKey: key };
}

async function rotateServerKey(orgId, serverId) {
  const key = randomToken('sac_srv');
  const row = await db.one('UPDATE servers SET api_key_hash=$3, api_key_prefix=$4 WHERE id=$1 AND org_id=$2 RETURNING id',
    [serverId, orgId, sha256(key), key.slice(0, 14)]);
  return row ? key : null;
}

module.exports = { createOrg, createServer, rotateServerKey, validatePassword, PASSWORD_MIN };
