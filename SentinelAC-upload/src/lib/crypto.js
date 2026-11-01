'use strict';
const crypto = require('crypto');
const config = require('../config');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Random URL-safe token with a readable prefix, e.g. "sac_srv_ab12...". */
function randomToken(prefix, bytes = 32) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
}

/** Hash for identifiers we never want to store in clear (IP, hardware tokens). Keyed so rainbow tables are useless. */
function hashIdentifier(value) {
  return crypto.createHmac('sha256', config.appSecret).update(String(value)).digest('hex').slice(0, 40);
}

const encKey = crypto.createHash('sha256').update('enc:' + config.appSecret).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(blob) {
  const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Ban IDs: SB- + 8 chars from an unambiguous alphabet. */
function banId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return 'SB-' + s;
}

module.exports = { sha256, randomToken, hashIdentifier, encrypt, decrypt, safeEqual, banId };
