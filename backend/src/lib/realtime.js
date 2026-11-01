'use strict';
/** Thin wrapper around the Socket.IO server so services can emit without importing the HTTP layer. */
let io = null;

module.exports = {
  attach(server) { io = server; },
  toOrg(orgId, event, payload) { if (io) io.to('org:' + orgId).emit(event, payload); },
  toServer(serverId, event, payload) { if (io) io.to('server:' + serverId).emit(event, payload); },
  toConsole(serverId, lines) { if (io) io.to('console:' + serverId).emit('console', { serverId, lines }); },
};
