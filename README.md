# Sentinel AC

FiveM anti-cheat platform: server-authoritative detection engine, automatic enforcement, and a real-time web dashboard.

```
sentinel-ac/
├── resource/AdvancedAC/        FiveM resource (Lua 5.4, OneSync)
│   ├── fxmanifest.lua
│   ├── config/config.lua       local options (no secrets)
│   ├── shared/                 settings, utils, eventguard.lua (include in your own resources)
│   ├── server/                 api, bans, detections, checks, events, telemetry, commands, admin, main
│   ├── client/                 heartbeat, client signals, spectate, /adv menu bridge
│   └── html/                   in-game admin menu (NUI)
├── backend/                    Node.js 20 · Express · Socket.IO · PostgreSQL
│   ├── migrations/             database schema
│   ├── src/                    agent API, dashboard API, enforcement, risk engine, Discord, audit
│   ├── public/                 dashboard (vanilla JS SPA) + public appeal page
│   └── test/                   unit tests
├── tests/                      FiveM emulator + integration, security and E2E tests
└── docs/                       ARCHITECTURE · INSTALL · DETECTIONS · TESTING  (Arabic)
```

## Quick start

1. Install Node.js 20+ and PostgreSQL 16, create a database.
2. `cd backend && npm install --omit=dev && cp .env.example .env` → fill in `DATABASE_URL`, `APP_SECRET`.
3. `node src/cli.js org:create --name "My Server" --email me@x.com --owner Me --password "..." --servers 1`
4. `npm start` → open http://localhost:8080 → **Server Management → Add server** → copy the server.cfg lines.
5. Copy `resource/AdvancedAC` + `screenshot-basic` into your server's `resources`, add the lines, restart.

Full guide: [docs/INSTALL.md](docs/INSTALL.md). Detection reference: [docs/DETECTIONS.md](docs/DETECTIONS.md).

## Key design rules

- **Server is the authority.** 30 of the 40 detections are observed by the server via OneSync. Client signals are never trusted on their own: a ban from a client signal is always downgraded.
- **Evidence before enforcement.** A screenshot is captured before the kick or ban and linked to the detection.
- **Works offline.** If the backend is down, the resource enforces locally with the cached config and ban list, then syncs everything when it reconnects.
- **Everything is audited.** Audit log entries are append-only, enforced by a DB trigger and an HMAC hash chain with a verifiable integrity check.
