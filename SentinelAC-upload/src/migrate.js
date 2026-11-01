'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const log = require('./lib/logger');

const DIR = path.join(__dirname, '..', 'migrations');

/** Applies pending *.sql migrations in filename order, each in its own transaction. */
async function migrate() {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.many('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    await db.tx(async (t) => {
      await t.query(sql);
      await t.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
    log.info('migration applied', { file: f });
    applied++;
  }
  return applied;
}

module.exports = { migrate };
