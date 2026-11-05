-- Platform (vendor) layer: sell Sentinel AC to customers and manage every customer from one console.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS platform_admin boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS acting_org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_status_check CHECK (status IN ('active', 'suspended'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_by uuid;

-- Health report sent by the resource (pure level, screenshot-basic, API errors…)
ALTER TABLE servers ADD COLUMN IF NOT EXISTS health jsonb NOT NULL DEFAULT '{}';

-- Platform staff acting inside a customer's dashboard are audited as 'platform'.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('admin', 'ingame_admin', 'system', 'server', 'platform'));

-- Fair bans: every ban carries the evidence that justified it.
ALTER TABLE bans ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]';
ALTER TABLE detections ADD COLUMN IF NOT EXISTS explanation text NOT NULL DEFAULT '';

-- Ban review queue: suspicious players are kicked and wait for a human decision instead of being banned.
CREATE TABLE IF NOT EXISTS ban_reviews (
  id             bigserial PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  server_id      uuid REFERENCES servers(id) ON DELETE SET NULL,
  player_id      bigint NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_name    text NOT NULL,
  reason         text NOT NULL,
  detection_key  text,
  detection_ids  bigint[] NOT NULL DEFAULT '{}',
  evidence       jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'dismissed')),
  decided_by     text,
  decided_at     timestamptz,
  ban_id         text,
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ban_reviews_org_idx ON ban_reviews(org_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ban_reviews_open_uniq ON ban_reviews(org_id, player_id) WHERE status = 'open';

-- Bootstrap: on an existing installation the very first account (the vendor) becomes platform admin.
UPDATE admin_users SET platform_admin = true
WHERE id = (SELECT id FROM admin_users ORDER BY created_at, id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM admin_users WHERE platform_admin);

-- Maintenance lock per server (NULL = open). Only staff can join while set.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS maintenance text;

-- New permission: server-wide controls (maintenance lock, kick all, heal/revive all).
UPDATE roles SET permissions = array_append(permissions, 'server.control')
WHERE name IN ('Owner', 'Super Administrator', 'Administrator') AND NOT ('server.control' = ANY(permissions));
UPDATE roles SET permissions = array_append(permissions, 'players.control')
WHERE name IN ('Owner', 'Super Administrator', 'Administrator') AND NOT ('players.control' = ANY(permissions));
