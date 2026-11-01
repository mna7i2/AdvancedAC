'use strict';
// Structured JSON logger (one line per event) — easy to ship to any log collector.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[process.env.LOG_LEVEL || 'info'] || 20;

function write(level, msg, fields) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  debug: (m, f) => write('debug', m, f),
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
};
