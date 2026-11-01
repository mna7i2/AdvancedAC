-- Dashboard → game command execution. Commands arrive with each heartbeat response and are
-- acknowledged (with a result) on the next heartbeat. Permissions were enforced by the backend.
Commands = {}
local acks = {}
local monitors = {}   -- [monitorId] = { src, intervalMs, active }

local function ack(id, ok, result) acks[#acks + 1] = { id = id, ok = ok, result = result or {} } end

function Commands.requeueAck(a) acks[#acks + 1] = a end

function Commands.drainAcks()
    local a = acks
    acks = {}
    return a
end

--- Resolve the target player. If a sessionId is given it must match (protects against id reuse).
local function target(p)
    local src = tonumber(p.netId)
    if not src then return nil, 'missing netId' end
    local s = Sessions[src]
    if not s then return nil, 'player not online' end
    if p.sessionId and s.sessionId ~= p.sessionId then return nil, 'player changed (session mismatch)' end
    return src
end

local function deleteAll(list, keep)
    local n = 0
    for _, ent in ipairs(list) do
        if DoesEntityExist(ent) and not (keep and keep(ent)) then
            DeleteEntity(ent)
            n = n + 1
        end
    end
    return n
end

local function hasPlayerDriver(veh)
    local d = GetPedInVehicleSeat(veh, -1)
    return d ~= 0 and IsPedAPlayer(d)
end

local handlers = {}

handlers.kick = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    DropPlayer(src, ('[%s] Kicked: %s'):format(AC.Name, p.reason or 'No reason'))
    return true
end

handlers.ban_kick = function(p)
    local src = tonumber(p.netId)
    if src and Sessions[src] then
        local ids = {}
        for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do if not id:find('^ip:') then ids[#ids + 1] = id end end
        Store.addLocalBan({ id = p.banId, reason = p.reason, expiresAt = 0, ids = ids })
        DropPlayer(src, Bans.formatLocal({ id = p.banId, reason = p.reason, expiresAt = 0 }))
    end
    return true
end

handlers.warn = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    TriggerClientEvent(AC.Events.Notify, src, { type = 'warning', title = 'Staff warning', text = tostring(p.message or ''):sub(1, 300), duration = 15000 })
    return true
end

handlers.screenshot = function(p, cmdId)
    local src, err = target(p)
    if not src then return false, { error = err } end
    if not Evidence.available() then return false, { error = 'screenshot-basic is not started on this server' } end
    Evidence.capture(src, { requestedBy = p.requestedBy or 'Dashboard', meta = { manual = true } }, function(ok, evidenceId)
        ack(cmdId, ok, ok and { evidenceId = evidenceId } or { error = 'screenshot failed or timed out' })
    end)
    return nil   -- async ack
end

handlers.freeze = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    local ped = GetPlayerPed(src)
    FreezeEntityPosition(ped, true)
    Telemetry.setFrozen(src, true)
    TriggerClientEvent(AC.Events.Freeze, src, true)
    return true
end

handlers.unfreeze = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    FreezeEntityPosition(GetPlayerPed(src), false)
    Telemetry.setFrozen(src, false)
    TriggerClientEvent(AC.Events.Freeze, src, false)
    return true
end

handlers.heal = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    Grace.set(src, 'health', 5000)
    TriggerClientEvent(AC.Events.Heal, src)
    return true
end

-- Teleport staff (adminNetId) to target, or bring target to staff.
local function move(fromSrc, toSrc)
    local to = GetEntityCoords(GetPlayerPed(toSrc))
    Grace.set(fromSrc, 'teleport', 6000)
    SetEntityCoords(GetPlayerPed(fromSrc), to.x + 1.0, to.y + 1.0, to.z, false, false, false, false)
end

handlers.teleport_to = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    local admin = tonumber(p.adminNetId)
    if not admin or not Sessions[admin] then return false, { error = 'you are not in-game' } end
    move(admin, src)
    return true
end

handlers.bring = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    local admin = tonumber(p.adminNetId)
    if not admin or not Sessions[admin] then return false, { error = 'you are not in-game' } end
    move(src, admin)
    return true
end

handlers.set_bucket = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    local b = math.floor(tonumber(p.bucket) or 0)
    Grace.set(src, 'all', Config.Grace.bucketChange)
    SetPlayerRoutingBucket(src, b)
    return true, { bucket = b }
end

handlers.announce = function(p)
    TriggerClientEvent(AC.Events.Announce, -1, { title = tostring(p.title or 'Announcement'):sub(1, 80), text = tostring(p.text or ''):sub(1, 500) })
    return true
end

handlers.delete_vehicles = function()
    local keep = Config.KeepOccupiedVehicles and hasPlayerDriver or nil
    return true, { deleted = deleteAll(GetAllVehicles(), keep) }
end

handlers.delete_peds = function()
    return true, { deleted = deleteAll(GetAllPeds(), function(ped) return IsPedAPlayer(ped) end) }
end

handlers.delete_objects = function()
    return true, { deleted = deleteAll(GetAllObjects()) }
end

handlers.bans_sync = function() Bans.sync() return true end
handlers.config_reload = function() AC.State.configVersion = -1 return true end

handlers.console_exec = function(p)
    local cmd = tostring(p.command or '')
    if cmd == '' or #cmd > 512 then return false, { error = 'invalid command' } end
    -- Requires: add_ace resource.AdvancedAC command allow
    ExecuteCommand(cmd)
    return true
end

handlers.resource_action = function(p)
    local name, action = tostring(p.resource or ''), p.action
    if name == GetCurrentResourceName() then return false, { error = 'cannot control the anti-cheat itself' } end
    if GetResourceState(name) == 'missing' then return false, { error = 'resource not found' } end
    if action == 'start' then StartResource(name)
    elseif action == 'stop' then StopResource(name)
    elseif action == 'restart' then StopResource(name); StartResource(name)
    else return false, { error = 'invalid action' } end
    return true, { state = GetResourceState(name) }
end

-- Live monitoring: periodic screenshots streamed to the dashboard (FiveM cannot stream video).
handlers.monitor_start = function(p)
    local src, err = target(p)
    if not src then return false, { error = err } end
    if not Evidence.available() then return false, { error = 'screenshot-basic is not started on this server' } end
    local id = tonumber(p.monitorId)
    local interval = math.max(1000, tonumber(p.intervalMs) or 3000)
    local maxFrames = tonumber(p.maxFrames) or 600
    monitors[id] = { src = src, active = true }
    CreateThread(function()
        local frames = 0
        while monitors[id] and monitors[id].active and Sessions[src] and frames < maxFrames do
            local done = promise.new()
            Evidence.capture(src, { monitorId = id, requestedBy = p.requestedBy or 'Monitoring' }, function() done:resolve(true) end)
            Citizen.Await(done)
            frames = frames + 1
            Wait(interval)
        end
        monitors[id] = nil
    end)
    return true
end

handlers.monitor_stop = function(p)
    local id = tonumber(p.monitorId)
    if monitors[id] then monitors[id].active = false end
    return true
end

-- Commands not acked within 15s are re-sent by the backend; never execute the same id twice.
local executed = {}
local executedOrder = {}

--- Direct execution for the in-game menu (same handlers as dashboard commands). Returns ok, result.
function Commands.exec(kind, payload)
    local h = handlers[kind]
    if not h then return false, { error = 'unknown' } end
    return h(payload or {}, 0)
end

function Commands.run(list)
    for _, c in ipairs(list or {}) do
        local h = handlers[c.kind]
        if executed[c.id] then
            -- already executed; its ack is either queued or will be re-sent by the async handler
        elseif not h then
            ack(c.id, false, { error = 'unsupported command' })
        else
            executed[c.id] = true
            executedOrder[#executedOrder + 1] = c.id
            if #executedOrder > 500 then executed[table.remove(executedOrder, 1)] = nil end
            local ok, okv, result = pcall(h, c.payload or {}, c.id)
            if not ok then
                ack(c.id, false, { error = tostring(okv) })
            elseif okv ~= nil then
                ack(c.id, okv, result)
            end
        end
    end
end
