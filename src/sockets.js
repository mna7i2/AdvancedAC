'use strict';
const { Server } = require('socket.io');
const db = require('./db');
const realtime = require('./lib/realtime');
const { COOKIE, resolveSession } = require('./middleware/auth');

/**
 * Socket.IO for the dashboard. Authenticated from the same httpOnly session cookie.
 * Rooms:  org:<id>      — everyone in the org (activity, detections, bans, server status)
 *         server:<id>   — live player state (requires players.view or map.view)
 *         console:<id>  — console stream (requires console.view)
 */
function attachSockets(httpServer) {
  const config = require('./config');
  const allowed = (o) => !!o && (config.nuiOriginRegex.test(o) || config.extraOrigins.includes(o));
  const io = new Server(httpServer, {
    serveClient: true, maxHttpBufferSize: 1e5,
    cors: { origin: (o, cb) => cb(null, allowed(o)), credentials: false },
  });

  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
      const bearer = socket.handshake.auth && typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : null;
      const token = bearer || (m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null);
      const s = await resolveSession(token);
      if (!s) return next(new Error('unauthenticated'));
      socket.data.user = s.user;
      socket.data.perms = s.perms;
      next();
    } catch (e) { next(e); }
  });

  io.on('connection', (socket) => {
    const { user, perms } = socket.data;
    socket.join('org:' + user.orgId);

    socket.on('subscribe', async ({ serverId, console: wantConsole } = {}, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (typeof serverId !== 'string' || !/^[0-9a-f-]{36}$/.test(serverId)) return reply({ ok: false });
      const s = await db.one('SELECT id FROM servers WHERE id=$1 AND org_id=$2', [serverId, user.orgId]).catch(() => null);
      if (!s) return reply({ ok: false });
      for (const r of socket.rooms) if (r.startsWith('server:') || r.startsWith('console:')) socket.leave(r);
      if (perms.has('players.view') || perms.has('map.view')) socket.join('server:' + serverId);
      if (wantConsole && perms.has('console.view')) socket.join('console:' + serverId);
      reply({ ok: true });
    });
  });

  realtime.attach(io);
  return io;
}

module.exports = { attachSockets };
