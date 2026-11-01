-- Sentinel AC — local configuration.
-- Secrets are NOT stored here (this file is also sent to clients). Put them in server.cfg:
--   set sentinel_backend "https://ac.example.com"
--   set sentinel_api_key "sac_srv_..."        <-- use `set`, never `sets` (sets is public)
-- Detection settings come from the dashboard; values below are only the offline fallback / local tuning.

Config = {}

Config.Debug = false

-- Command / keybind for the in-game admin menu
Config.MenuCommand = 'adv'
Config.MenuKey = 'F10'

-- Players with this ACE are never flagged (give it to staff using noclip/godmode tools, e.g. txAdmin admins):
--   add_ace group.admin sentinel.bypass allow
Config.BypassAce = 'sentinel.bypass'

-- In-game admin permissions can come from dashboard-linked staff accounts OR ACE:
--   add_ace group.admin sentinel.admin allow          (all in-game admin permissions)
--   add_ace group.mod   sentinel.perm.players.kick allow
Config.AdminAce = 'sentinel.admin'
Config.PermAcePrefix = 'sentinel.perm.'

-- Grace windows (ms) during which movement/health detections are skipped
Config.Grace = {
    spawn = 20000,        -- after joining / framework spawn
    respawn = 8000,       -- after death / revive
    bucketChange = 5000,  -- after routing bucket change
}

-- Safe zones: godmode / semi-godmode / invisible checks are skipped inside these spheres
-- (for green-zone scripts that make players invincible client-side).
--   { coords = vector3(-1037.0, -2737.0, 20.0), radius = 120.0 },
Config.SafeZones = {}

-- Heartbeat from the AC client (ms). Missing beats are handled by the `ac_heartbeat` detection.
Config.ClientHeartbeat = 15000

-- Resources whose client-side stop must never be reported (e.g. loading screens)
Config.IgnoredClientResources = { 'loadingscreen', 'spawnmanager' }

-- Delete-entity commands skip vehicles that have a player driver
Config.KeepOccupiedVehicles = true
