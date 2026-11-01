-- Server-side telemetry: one loop samples every player's ped through OneSync (authoritative, the
-- client is never asked). Feeds: live map / players table (snapshot), session replay (samples),
-- and the state-based detections (StateChecks in detections_state section of events.lua).
Telemetry = {}

local last = {}        -- [src] = latest state
local samples = {}     -- buffered samples for the next heartbeat
local events = {}      -- buffered game events
local frozen = {}      -- [src] = true when frozen by staff
local MAX_BUFFER = 20000

local function vehicleOf(ped)
    local veh = GetVehiclePedIsIn(ped, false)
    if veh and veh ~= 0 and DoesEntityExist(veh) then return veh end
    return nil
end

local function read(src)
    local ped = GetPlayerPed(src)
    if not ped or ped == 0 or not DoesEntityExist(ped) then return nil end
    local c = GetEntityCoords(ped)
    local veh = vehicleOf(ped)
    local vel = GetEntityVelocity(veh or ped)
    local hp = GetEntityHealth(ped)
    local flags = 0
    if not IsEntityVisible(ped) then flags = flags | AC.Flags.Invisible end
    if GetPlayerInvincible(src) then flags = flags | AC.Flags.Invincible end
    if frozen[src] then flags = flags | AC.Flags.Frozen end
    if hp <= 100 then flags = flags | AC.Flags.Dead end
    return {
        x = c.x, y = c.y, z = c.z, h = GetEntityHeading(ped),
        hp = hp, mhp = GetEntityMaxHealth(ped), ar = GetPedArmour(ped),
        w = GetSelectedPedWeapon(ped), vm = veh and GetEntityModel(veh) or 0,
        vtype = veh and GetVehicleType(veh) or nil,
        driver = veh and GetPedInVehicleSeat(veh, -1) == ped or false,
        vx = vel.x, vy = vel.y, vz = vel.z,
        s = math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z),
        b = GetPlayerRoutingBucket(src), ping = GetPlayerPing(src), f = flags,
        t = GetGameTimer(),
    }
end

function Telemetry.setFrozen(src, v) frozen[src] = v or nil end
function Telemetry.get(src) return last[src] end

function Telemetry.forget(src)
    last[src] = nil
    frozen[src] = nil
end

--- Record a notable game event for replay (damage, death, explosion, detection, admin action...).
function Telemetry.event(src, kind, data)
    if #events >= MAX_BUFFER then return end
    local s = src and Sessions[src]
    events[#events + 1] = { sessionId = s and s.sessionId or nil, t = AC.now(), kind = kind, data = data or {} }
end

local function sampleAll()
    local storeReplay = AC.State.config and AC.State.config.telemetry and AC.State.config.telemetry.storeReplay ~= false
    for src, s in pairs(Sessions) do
        local st = read(src)
        if st then
            local prev = last[src]
            -- Respawn / revive: health from dead to alive → grace for health/teleport checks.
            if prev and (prev.f & AC.Flags.Dead) ~= 0 and (st.f & AC.Flags.Dead) == 0 then
                Grace.set(src, 'all', Config.Grace.respawn)
            end
            if prev and prev.b ~= st.b then Grace.set(src, 'all', Config.Grace.bucketChange) end
            if StateChecks and prev then StateChecks.run(src, st, prev) end
            last[src] = st
            if storeReplay and s.sessionId and #samples < MAX_BUFFER then
                samples[#samples + 1] = {
                    sessionId = s.sessionId, t = AC.now(),
                    x = Utils.round(st.x, 2), y = Utils.round(st.y, 2), z = Utils.round(st.z, 2), h = Utils.round(st.h, 1),
                    hp = st.hp, ar = st.ar, w = st.w, vm = st.vm, s = Utils.round(st.s, 2), b = st.b, f = st.f,
                }
            end
        end
    end
end

--- Latest state of every player with a session (for heartbeat → live map / players table).
function Telemetry.snapshot()
    local out = {}
    for src, s in pairs(Sessions) do
        local st = last[src]
        if st and s.sessionId then
            out[#out + 1] = {
                sessionId = s.sessionId, netId = src, ping = st.ping,
                x = Utils.round(st.x, 2), y = Utils.round(st.y, 2), z = Utils.round(st.z, 2), h = Utils.round(st.h, 1),
                hp = st.hp, mhp = st.mhp, ar = st.ar, w = st.w, vm = st.vm, s = Utils.round(st.s, 2), b = st.b, f = st.f,
            }
        end
    end
    return out
end

function Telemetry.drain()
    local s, e = samples, events
    samples, events = {}, {}
    return s, e
end

CreateThread(function()
    while true do
        local interval = 2000
        local tc = AC.State.config and AC.State.config.telemetry
        if tc and tc.intervalMs then interval = math.max(1000, tc.intervalMs) end
        Wait(interval)
        local ok, err = pcall(sampleAll)
        if not ok then Utils.log('error', 'telemetry: %s', tostring(err)) end
    end
end)
