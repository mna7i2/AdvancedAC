'use strict';
const http = require('http');
const config = require('./config');
const log = require('./lib/logger');
const { migrate } = require('./migrate');
const { createApp } = require('./app');
const { attachSockets } = require('./sockets');
const jobs = require('./jobs');
const db = require('./db');

async function main() {
  await migrate();
  const app = createApp();
  const server = http.createServer(app);
  attachSockets(server);
  const stopJobs = jobs.start();
  server.listen(config.port, config.host, () => log.info('sentinel backend listening', { port: config.port, env: config.env }));

  const shutdown = () => {
    log.info('shutting down');
    stopJobs();
    server.close(() => db.pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { log.error('fatal', { err: e.message, stack: e.stack }); process.exit(1); });
