'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const log = require('./lib/logger');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'img-src': ["'self'", 'data:', 'blob:', 'https://cdn.discordapp.com'], 'script-src': ["'self'"], 'connect-src': ["'self'"] },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cookieParser());

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api/v1/agent', require('./routes/agent').router);

  const dashboardApi = path.join(__dirname, 'routes', 'api.js');
  if (require('fs').existsSync(dashboardApi)) app.use('/api/v1', require('./routes/api'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) log.error('request failed', { path: req.path, err: err.message, stack: err.stack });
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
  });
  return app;
}

module.exports = { createApp };
