-- Sentinel AC core schema (PostgreSQL 13+)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Tenancy & licensing ─────────────
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE licenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_hash      text NOT NULL UNIQUE,
  key_prefix    text NOT NULL,
  plan          text NOT NULL DEFAULT 'standard',
  max_servers   int  NOT NULL DEFAULT 1 CHECK (max_servers > 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX licenses_org_idx ON licenses(org_id);

CREATE TABLE servers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  api_key_hash    text NOT NULL UNIQUE,
  api_key_prefix  text NOT NULL,
  fingerprint     text,                       -- bound on first handshake (cfx.re join url)
  status          text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
  last_heartbeat  timestamptz,
  last_ip         inet,
  ac_version      text,
  framework       text,
  hostname        text,
  max_players     int NOT NULL DEFAULT 0,
  player_count    int NOT NULL DEFAULT 0,
  started_at      timestamptz,
  onesync         boolean,
  resources       jsonb NOT NULL DEFAULT '[]',
  config_version  int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX servers_org_idx ON servers(org_id);

-- ───────────── Dashboard accounts & RBAC ─────────────
CREATE TABLE roles (
  id            serial PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  rank          int  NOT NULL,                -- higher = more privileged
  permissions   text[] NOT NULL DEFAULT '{}',
  UNIQUE (org_id, name)
);

CREATE TABLE admin_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email               text NOT NULL,
  display_name        text NOT NULL,
  password_hash       text NOT NULL,
  role_id             int NOT NULL REFERENCES roles(id),
  extra_permissions   text[] NOT NULL DEFAULT '{}',
  denied_permissions  text[] NOT NULL DEFAULT '{}',
  linked_identifiers  text[] NOT NULL DEFAULT '{}',   -- e.g. license:xxxx, discord:123
  active              boolean NOT NULL DEFAULT true,
  failed_logins       int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_users_email_idx ON admin_users(lower(email));

CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ───────────── Players ─────────────
CREATE TABLE players (
  id                bigserial PRIMARY KEY,
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  license           text NOT NULL,                -- primary Rockstar license
  last_name         text NOT NULL,
  first_seen        timestamptz NOT NULL DEFAULT now(),
  last_seen         timestamptz NOT NULL DEFAULT now(),
  playtime_sec      bigint NOT NULL DEFAULT 0,
  risk_score        real NOT NULL DEFAULT 0,
  risk_updated_at   timestamptz NOT NULL DEFAULT now(),
  reputation_bypass boolean NOT NULL DEFAULT false,
  UNIQUE (org_id, license)
);
CREATE INDEX players_name_trgm_idx ON players (org_id, lower(last_name));

CREATE TABLE player_identifiers (
  org_id      uuid NOT NULL,
  player_id   bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind        text NOT NULL,       -- license, license2, steam, discord, fivem, xbl, live, ip, token
  value       text NOT NULL,       -- ip/token stored as sha256 hex
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, kind, value)
);
CREATE INDEX player_identifiers_lookup_idx ON player_identifiers(org_id, kind, value);

CREATE TABLE player_names (
  player_id   bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name        text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, name)
);

CREATE TABLE player_sessions (
  id            bigserial PRIMARY KEY,
  org_id        uuid NOT NULL,
  server_id     uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  net_id        int,                       -- in-game server id, assigned after join
  name          text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  end_reason    text,
  -- latest live state (updated from heartbeat)
  last_state    jsonb
);
CREATE INDEX player_sessions_open_idx ON player_sessions(server_id) WHERE ended_at IS NULL;
CREATE INDEX player_sessions_player_idx ON player_sessions(player_id, started_at DESC);

CREATE TABLE admin_notes (
  id          bigserial PRIMARY KEY,
  player_id   bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Detection configuration ─────────────
CREATE TABLE detection_overrides (
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  detection_key text NOT NULL,
  config        jsonb NOT NULL,               -- partial override merged over catalog defaults
  updated_by    uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, detection_key)
);

CREATE TABLE org_settings (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

-- ───────────── Detections, bans, evidence ─────────────
CREATE TABLE detections (
  id              bigserial PRIMARY KEY,
  org_id          uuid NOT NULL,
  server_id       uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  player_id       bigint REFERENCES players(id) ON DELETE CASCADE,
  session_id      bigint REFERENCES player_sessions(id) ON DELETE SET NULL,
  detection_key   text NOT NULL,
  category        text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  verified        boolean NOT NULL,             -- server-authoritative signal
  source          text NOT NULL,                -- server | client | eventguard
  score_delta     real NOT NULL DEFAULT 0,
  risk_after      real NOT NULL DEFAULT 0,
  configured_action text NOT NULL,
  action_taken    text NOT NULL,                -- log|warn|kick|ban|suppressed|review
  action_note     text,
  details         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX detections_org_time_idx ON detections(org_id, created_at DESC);
CREATE INDEX detections_player_idx ON detections(player_id, created_at DESC);
CREATE INDEX detections_key_idx ON detections(org_id, detection_key, created_at DESC);

CREATE TABLE bans (
  id              text PRIMARY KEY,               -- SB-XXXXXXXX
  org_id          uuid NOT NULL,
  server_id       uuid REFERENCES servers(id) ON DELETE SET NULL,  -- origin server
  scope           text NOT NULL DEFAULT 'org' CHECK (scope IN ('org','server')),
  player_id       bigint REFERENCES players(id) ON DELETE SET NULL,
  player_name     text NOT NULL,
  identifiers     jsonb NOT NULL,                 -- [{kind,value}]
  reason          text NOT NULL,
  detection_key   text,
  category        text,
  detection_id    bigint REFERENCES detections(id) ON DELETE SET NULL,
  automatic       boolean NOT NULL,
  issued_by       uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  issued_by_name  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,                    -- NULL = permanent
  revoked_at      timestamptz,
  revoked_by_name text,
  revoke_reason   text
);
CREATE INDEX bans_org_time_idx ON bans(org_id, created_at DESC);
CREATE INDEX bans_player_idx ON bans(player_id);
CREATE INDEX bans_active_idx ON bans(org_id) WHERE revoked_at IS NULL;

CREATE TABLE ban_identifiers (
  ban_id  text NOT NULL REFERENCES bans(id) ON DELETE CASCADE,
  org_id  uuid NOT NULL,
  kind    text NOT NULL,
  value   text NOT NULL,
  PRIMARY KEY (ban_id, kind, value)
);
CREATE INDEX ban_identifiers_lookup_idx ON ban_identifiers(org_id, kind, value);

CREATE TABLE ban_appeals (
  id            bigserial PRIMARY KEY,
  ban_id        text NOT NULL REFERENCES bans(id) ON DELETE CASCADE,
  message       text NOT NULL,
  contact       text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  response      text,
  reviewed_by_name text,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  server_id     uuid REFERENCES servers(id) ON DELETE SET NULL,
  player_id     bigint REFERENCES players(id) ON DELETE CASCADE,
  detection_id  bigint REFERENCES detections(id) ON DELETE SET NULL,
  monitor_id    bigint,
  kind          text NOT NULL CHECK (kind IN ('screenshot','monitor_frame')),
  storage_path  text NOT NULL,
  mime          text NOT NULL,
  size_bytes    int  NOT NULL,
  sha256        text NOT NULL,
  requested_by_name text NOT NULL,
  meta          jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_player_idx ON evidence(player_id, created_at DESC);
CREATE INDEX evidence_org_idx ON evidence(org_id, created_at DESC);
CREATE INDEX evidence_monitor_idx ON evidence(monitor_id, created_at);

CREATE TABLE monitor_sessions (
  id            bigserial PRIMARY KEY,
  org_id        uuid NOT NULL,
  server_id     uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  player_id     bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  net_id        int NOT NULL,
  interval_ms   int NOT NULL,
  record        boolean NOT NULL DEFAULT false,
  started_by_name text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  stopped_at    timestamptz,
  frames        int NOT NULL DEFAULT 0
);
ALTER TABLE evidence ADD CONSTRAINT evidence_monitor_fk FOREIGN KEY (monitor_id) REFERENCES monitor_sessions(id) ON DELETE SET NULL;

-- ───────────── Telemetry (replay + map history) ─────────────
CREATE TABLE telemetry (
  session_id    bigint NOT NULL REFERENCES player_sessions(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL,
  x real NOT NULL, y real NOT NULL, z real NOT NULL,
  heading       real NOT NULL,
  health        smallint NOT NULL,
  armor         smallint NOT NULL,
  weapon        bigint NOT NULL,
  vehicle_model bigint NOT NULL DEFAULT 0,
  speed         real NOT NULL,
  bucket        int NOT NULL DEFAULT 0,
  flags         smallint NOT NULL DEFAULT 0     -- bit0 invisible, bit1 invincible, bit2 frozen
);
CREATE INDEX telemetry_session_ts_idx ON telemetry(session_id, ts);
CREATE INDEX telemetry_ts_brin ON telemetry USING brin(ts);

CREATE TABLE game_events (
  id            bigserial PRIMARY KEY,
  session_id    bigint REFERENCES player_sessions(id) ON DELETE CASCADE,
  server_id     uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts            timestamptz NOT NULL,
  kind          text NOT NULL,                 -- damage, death, explosion, entity, teleport, ...
  data          jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX game_events_session_ts_idx ON game_events(session_id, ts);

CREATE TABLE server_stats (
  server_id   uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,           -- minute bucket
  players     int NOT NULL,
  PRIMARY KEY (server_id, ts)
);

-- ───────────── Command queue (dashboard → game) ─────────────
CREATE TABLE commands (
  id            bigserial PRIMARY KEY,
  server_id     uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','done','failed','expired')),
  result        jsonb,
  created_by_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  completed_at  timestamptz
);
CREATE INDEX commands_pending_idx ON commands(server_id, id) WHERE status IN ('pending','sent');

CREATE TABLE console_lines (
  id          bigserial PRIMARY KEY,
  server_id   uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  channel     text NOT NULL,
  line        text NOT NULL
);
CREATE INDEX console_lines_server_idx ON console_lines(server_id, id DESC);

-- ───────────── Discord ─────────────
CREATE TABLE webhooks (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category    text NOT NULL,
  url_enc     text NOT NULL,                  -- AES-256-GCM, never returned to browser
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, category)
);

-- ───────────── Activity feed + immutable audit log ─────────────
CREATE TABLE activity (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL,
  server_id   uuid,
  kind        text NOT NULL,
  message     text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_org_idx ON activity(org_id, id DESC);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('admin','ingame_admin','system','server')),
  actor_id    text,
  actor_name  text NOT NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  details     jsonb NOT NULL DEFAULT '{}',
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  prev_hash   text NOT NULL,
  hash        text NOT NULL
);
CREATE INDEX audit_org_idx ON audit_log(org_id, id DESC);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
