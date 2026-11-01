-- State-based detections. Run once per telemetry sample per player (no extra loops / natives):
-- telemetry.lua reads the ped once and passes the current + previous state here.
StateChecks = {}

local streak = {}   -- [src][key] = consecutive positive samples

local function bump(src, key, positive)
    streak[src] = streak[src] or {}
    if positive then
        streak[src][key] = (streak[src][key] or 0) + 1
    else
        streak[src][key] = 0
    end
    return streak[src][key]
end

local function inSafeZone(st)
    for _, z in ipairs(Config.SafeZones or {}) do
        local dx, dy, dz = st.x - z.coords.x, st.y - z.coords.y, st.z - z.coords.z
        if dx * dx + dy * dy + dz * dz <= z.radius * z.radius then return true end
    end
    return false
end
StateChecks.inSafeZone = inSafeZone

local AIR = { heli = true, plane = true, blimp = true }
local IGNORE_VEH = { train = true }

local function pos(st) return { x = Utils.round(st.x, 1), y = Utils.round(st.y, 1), z = Utils.round(st.z, 1) } end

function StateChecks.run(src, st, prev)
    local dt = (st.t - prev.t) / 1000.0
    if dt <= 0.2 then return end
    local frozen = (st.f & AC.Flags.Frozen) ~= 0
    local dead = (st.f & AC.Flags.Dead) ~= 0
    local inVeh = st.vm ~= 0
    local safe = inSafeZone(st)

    -- ── Player protection ──────────────────────────────────────────────
    if Detect.enabled('godmode_flag') then
        local n = bump(src, 'godmode_flag', (st.f & AC.Flags.Invincible) ~= 0 and not safe and not frozen and not Grace.active(src, 'godmode'))
        if n >= Detect.threshold('godmode_flag', 'samples', 3) then
            Detect.report(src, 'godmode_flag', { samples = n, pos = pos(st) })
            streak[src].godmode_flag = 0
        end
    end

    if Detect.enabled('invisible') then
        local n = bump(src, 'invisible', (st.f & AC.Flags.Invisible) ~= 0 and not safe and not Grace.active(src, 'invisible'))
        if n >= Detect.threshold('invisible', 'samples', 3) then
            Detect.report(src, 'invisible', { samples = n, pos = pos(st) })
            streak[src].invisible = 0
        end
    end

    if Detect.enabled('health_limit') then
        local max = Detect.threshold('health_limit', 'maxHealth', 200)
        local n = bump(src, 'health_limit', (st.hp > max or st.mhp > max) and not Grace.active(src, 'health'))
        if n >= Detect.threshold('health_limit', 'samples', 2) then
            Detect.report(src, 'health_limit', { health = st.hp, maxHealth = st.mhp, limit = max })
            streak[src].health_limit = 0
        end
    end

    if Detect.enabled('armor_limit') then
        local max = Detect.threshold('armor_limit', 'maxArmor', 100)
        local n = bump(src, 'armor_limit', st.ar > max and not Grace.active(src, 'health'))
        if n >= Detect.threshold('armor_limit', 'samples', 2) then
            Detect.report(src, 'armor_limit', { armor = st.ar, limit = max })
            streak[src].armor_limit = 0
        end
    end

    -- ── Combat: held weapon ────────────────────────────────────────────
    if Detect.enabled('weapon_blacklist') and st.w ~= 0 then
        local bl = Weapons.hashSet(Detect.threshold('weapon_blacklist', 'weapons', {}))
        local name = bl[Weapons.u32(st.w)]
        if name then Detect.report(src, 'weapon_blacklist', { weapon = name }) end
    end

    -- ── Movement ───────────────────────────────────────────────────────
    if frozen or dead then return end
    local dist = Utils.dist(st, prev)
    local horiz = Utils.dist2d(st, prev) / dt
    local rise = (st.z - prev.z) / dt
    local teleportGrace = Grace.active(src, 'teleport')

    -- Teleport: single sample, implied speed impossible for the movement mode.
    local teleported = false
    if Detect.enabled('teleport') and not teleportGrace then
        local minD = Detect.threshold('teleport', 'minDistance', 120)
        local limit = (inVeh or prev.vm ~= 0) and Detect.threshold('teleport', 'vehicleSpeed', 260) or Detect.threshold('teleport', 'onFootSpeed', 150)
        if dist > minD and dist / dt > limit then
            teleported = true
            Detect.report(src, 'teleport', { from = pos(prev), to = pos(st), distance = Utils.round(dist, 1),
                seconds = Utils.round(dt, 2), inVehicle = inVeh })
        end
    end
    if teleported or teleportGrace then
        bump(src, 'speed_onfoot', false); bump(src, 'fly_noclip', false); bump(src, 'vehicle_speed', false)
        return
    end

    if not inVeh and prev.vm == 0 then
        -- Speed hack / fast run: horizontal displacement, falling excluded.
        if Detect.enabled('speed_onfoot') and not Grace.active(src, 'speed') then
            local max = Detect.threshold('speed_onfoot', 'maxSpeed', 14)
            local falling = rise < -6.0
            local n = bump(src, 'speed_onfoot', horiz > max and not falling)
            if n >= Detect.threshold('speed_onfoot', 'samples', 3) then
                Detect.report(src, 'speed_onfoot', { speed = Utils.round(horiz, 1), limit = max, samples = n, pos = pos(st) })
                streak[src].speed_onfoot = 0
            end
        end
        -- Noclip / fly: sustained upward movement without a vehicle.
        if Detect.enabled('fly_noclip') then
            local max = Detect.threshold('fly_noclip', 'riseSpeed', 3.5)
            local n = bump(src, 'fly_noclip', rise > max)
            if n >= Detect.threshold('fly_noclip', 'samples', 2) then
                Detect.report(src, 'fly_noclip', { riseSpeed = Utils.round(rise, 1), limit = max, from = pos(prev), to = pos(st) })
                streak[src].fly_noclip = 0
            end
        end
    else
        bump(src, 'speed_onfoot', false); bump(src, 'fly_noclip', false)
    end

    if Detect.enabled('vehicle_speed') and inVeh and st.vtype and not IGNORE_VEH[st.vtype] then
        local air = AIR[st.vtype]
        local max = air and Detect.threshold('vehicle_speed', 'airMax', 170) or Detect.threshold('vehicle_speed', 'landMax', 110)
        local n = bump(src, 'vehicle_speed', st.driver and st.s > max)
        if n >= Detect.threshold('vehicle_speed', 'samples', 2) then
            Detect.report(src, 'vehicle_speed', { speed = Utils.round(st.s, 1), kmh = math.floor(st.s * 3.6), limit = max,
                vehicleType = st.vtype, model = st.vm })
            streak[src].vehicle_speed = 0
        end
    end
end

function StateChecks.forget(src) streak[src] = nil end

---------------------------------------------------------------------------------------------------
-- Client AC heartbeat watchdog (one cheap loop for all players)
---------------------------------------------------------------------------------------------------
CreateThread(function()
    while true do
        Wait(5000)
        if Detect.enabled('ac_heartbeat') then
            local timeout = Detect.threshold('ac_heartbeat', 'timeoutSec', 60) * 1000
            local now = GetGameTimer()
            for src, s in pairs(Sessions) do
                if s.clientReady then
                    if now - s.lastBeat > timeout then
                        Detect.report(src, 'ac_heartbeat', { silentSec = math.floor((now - s.lastBeat) / 1000), badBeats = s.badBeats or 0 })
                        s.lastBeat = now   -- avoid re-reporting every 5s while the action is pending
                    end
                elseif now - s.joinedAt > 300000 and not s.neverReadyReported then
                    -- Fully loaded clients send `ready` within seconds; 5 minutes means the AC client never ran.
                    s.neverReadyReported = true
                    Detect.report(src, 'ac_heartbeat', { reason = 'client never initialised', sinceJoinSec = math.floor((now - s.joinedAt) / 1000) })
                end
            end
        end
    end
end)
