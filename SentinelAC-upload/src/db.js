'use strict';
const { Pool, types } = require('pg');

// bigint (int8) → JS number. All our bigserial ids and counters stay far below 2^53, and the
// FiveM resource expects numeric ids in JSON.
types.setTypeParser(20, (v) => Number(v));
const config = require('./config');
const log = require('./lib/logger');

const pool = new Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 30000 });
pool.on('error', (err) => log.error('pg pool error', { err: err.message }));

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Run fn inside a transaction; fn receives a client with query/one/many helpers. */
async function tx(fn) {
  const client = await pool.connect();
  const t = {
    query: (q, p) => client.query(q, p),
    one: async (q, p) => (await client.query(q, p)).rows[0] || null,
    many: async (q, p) => (await client.query(q, p)).rows,
  };
  try {
    await client.query('BEGIN');
    const res = await fn(t);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, many, tx };
