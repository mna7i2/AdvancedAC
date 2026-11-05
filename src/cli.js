#!/usr/bin/env node
'use strict';
/**
 * Vendor / operator CLI.
 *   node src/cli.js migrate
 *   node src/cli.js org:create --name "My Org" --email owner@x.com --owner "Name" --password "..." [--servers 1] [--days 30]
 *   node src/cli.js license:create --org <orgId> [--servers 3] [--days 30] [--plan pro]
 *   node src/cli.js license:revoke --prefix SAC-ABCD
 *   node src/cli.js server:create --org <orgId> --name "Server"
 *   node src/cli.js audit:verify --org <orgId>
 *   node src/cli.js platform:grant --email you@x.com      (vendor console access)
 */
const db = require('./db');
const { migrate } = require('./migrate');
const orgs = require('./services/orgs');
const license = require('./services/license');
const { verifyChain } = require('./lib/audit');

function args() {
  const a = {}; const argv = process.argv.slice(3);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  return a;
}
const need = (a, ...k) => { for (const x of k) if (!a[x]) throw new Error(`--${x} is required`); };

async function run() {
  const cmd = process.argv[2];
  const a = args();
  switch (cmd) {
    case 'migrate': console.log(`applied ${await migrate()} migration(s)`); break;
    case 'org:create': {
      need(a, 'name', 'email', 'owner', 'password');
      await migrate();
      const { org, owner } = await orgs.createOrg(a.name, { email: a.email, name: a.owner, password: a.password });
      const lic = await license.createLicense(org.id, { maxServers: +a.servers || 1, days: a.days ? +a.days : null });
      console.log(JSON.stringify({ orgId: org.id, ownerEmail: owner.email, licenseKey: lic.key, licenseExpires: lic.expires_at }, null, 2));
      break;
    }
    case 'license:create': {
      need(a, 'org');
      const lic = await license.createLicense(a.org, { maxServers: +a.servers || 1, days: a.days ? +a.days : null, plan: a.plan || 'standard' });
      console.log(JSON.stringify(lic, null, 2));
      break;
    }
    case 'license:revoke': {
      need(a, 'prefix');
      const r = await db.query("UPDATE licenses SET status='revoked' WHERE key_prefix=$1", [a.prefix]);
      console.log(`revoked ${r.rowCount}`);
      break;
    }
    case 'server:create': {
      need(a, 'org', 'name');
      console.log(JSON.stringify(await orgs.createServer(a.org, a.name), null, 2));
      break;
    }
    case 'audit:verify': {
      need(a, 'org');
      console.log(JSON.stringify(await verifyChain(a.org)));
      break;
    }
    case 'platform:grant': {
      need(a, 'email');
      await migrate();
      const r = await db.query('UPDATE admin_users SET platform_admin = true WHERE lower(email) = lower($1)', [a.email]);
      console.log(r.rowCount ? `${a.email} is now a platform admin (Customers console)` : 'no account with that email');
      break;
    }
    default:
      console.log('commands: migrate | org:create | license:create | license:revoke | server:create | audit:verify | platform:grant');
  }
}

run().then(() => db.pool.end()).catch((e) => { console.error('error:', e.message); db.pool.end(); process.exit(1); });
