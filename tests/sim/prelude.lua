-- FiveM server runtime emulator (test harness only — never shipped in the resource).
-- Provides a cooperative scheduler with virtual time, the event system, KVP, convars,
-- and a scriptable world (players / peds / vehicles / entities) behind the server natives
-- the resource uses. HTTP is bridged to the real backend by the Python runner (__http).

SIM = { now = 0, threads = {}, handlers = {}, netEvents = {}, kvp = {}, convars = {}, resources = {},
        players = {}, entities = {}, nextEntity = 1000, clientEvents = {}, dropped = {}, consoleListeners = {},
        aces = {}, exports = {}, executed = {}, log = {}, canceled = false }

---------------------------------------------------------------- scheduler
local function spawn(fn, ...)
    local args = table.pack(...)
    local co = coroutine.create(function() return fn(table.unpack(args, 1, args.n)) end)
    SIM.threads[#SIM.threads + 1] = { co = co, wake = SIM.now, src = rawget(_G, 'source') }
end
SIM.spawn = spawn

function CreateThread(fn) spawn(fn) end
Citizen = { CreateThread = CreateThread }
function SetTimeout(ms, fn) spawn(function() Wait(ms) fn() end) end
function Wait(ms) coroutine.yield(ms or 0) end
Citizen.Wait = Wait
function GetGameTimer() return SIM.now end

promise = {}
promise.__index = promise
function promise.new() return setmetatable({ state = 0 }, promise) end
function promise:resolve(v) if self.state == 0 then self.state = 1; self.value = v end end
function promise:reject(e) if self.state == 0 then self.state = 2; self.value = e end end
function Citizen.Await(p)
    while p.state == 0 do coroutine.yield(0) end
    if p.state == 2 then error(p.value) end
    return p.value
end

--- Run all threads until virtual time `untilMs` (advancing in 50ms ticks).
function SIM.run(ms)
    local target = SIM.now + ms
    repeat
        local i = 1
        while i <= #SIM.threads do
            local t = SIM.threads[i]
            if t.wake <= SIM.now then
                source = t.src
                local ok, res = coroutine.resume(t.co)
                if not ok then
                    print('[SIM] thread error: ' .. tostring(res) .. '\n' .. debug.traceback(t.co))
                    SIM.errors = (SIM.errors or 0) + 1
                end
                if coroutine.status(t.co) == 'dead' then
                    table.remove(SIM.threads, i)
                else
                    t.wake = SIM.now + (type(res) == 'number' and res or 0)
                    i = i + 1
                end
            else
                i = i + 1
            end
        end
        SIM.now = SIM.now + 50
    until SIM.now >= target
end

---------------------------------------------------------------- events
function AddEventHandler(name, fn)
    SIM.handlers[name] = SIM.handlers[name] or {}
    table.insert(SIM.handlers[name], fn)
    return { name = name, fn = fn }
end
function RegisterNetEvent(name, fn)
    SIM.netEvents[name] = true
    if fn then return AddEventHandler(name, fn) end
end
RegisterServerEvent = RegisterNetEvent

--- Trigger event; each handler runs in its own coroutine (like FiveM). Returns canceled flag after run.
function TriggerEvent(name, ...)
    SIM.canceled = false
    for _, fn in ipairs(SIM.handlers[name] or {}) do spawn(fn, ...) end
end
--- Synchronous variant used for engine events that support CancelEvent (entityCreating, explosionEvent...).
function SIM.fireSync(name, src, ...)
    SIM.canceled = false
    for _, fn in ipairs(SIM.handlers[name] or {}) do
        source = src
        local co = coroutine.create(fn)
        local ok, err = coroutine.resume(co, ...)
        if not ok then print('[SIM] handler error ' .. name .. ': ' .. tostring(err)); SIM.errors = (SIM.errors or 0) + 1 end
        if coroutine.status(co) ~= 'dead' then SIM.threads[#SIM.threads + 1] = { co = co, wake = SIM.now, src = src } end
    end
    return SIM.canceled
end
--- Simulate a client → server net event from player `src`.
function SIM.clientEvent(src, name, ...)
    if not SIM.netEvents[name] then return false end
    source = src
    for _, fn in ipairs(SIM.handlers[name] or {}) do
        local s = src
        local args = table.pack(...)
        SIM.threads[#SIM.threads + 1] = { co = coroutine.create(function() return fn(table.unpack(args, 1, args.n)) end), wake = SIM.now, src = s }
    end
    return true
end
function CancelEvent() SIM.canceled = true end
function WasEventCanceled() return SIM.canceled end
function TriggerClientEvent(name, target, ...)
    table.insert(SIM.clientEvents, { name = name, target = target, args = table.pack(...) })
end
function RegisterConsoleListener(fn) table.insert(SIM.consoleListeners, fn) end
local rawprint = print
function print(...)
    local parts = {}
    for i = 1, select('#', ...) do parts[#parts + 1] = tostring(select(i, ...)) end
    local line = table.concat(parts, ' ')
    table.insert(SIM.log, line)
    for _, l in ipairs(SIM.consoleListeners) do pcall(l, 'script:AdvancedAC', line) end
    rawprint(line)
end

---------------------------------------------------------------- exports
exports = setmetatable({}, {
    __call = function(_, name, fn) SIM.exports[name] = fn end,
    __index = function(_, res)
        return setmetatable({}, { __index = function(_, fname)
            return function(_, ...)
                local f = SIM.resourceExports[res] and SIM.resourceExports[res][fname]
                if not f then error('no such export ' .. res .. '.' .. fname) end
                return f(...)
            end
        end })
    end,
})
SIM.resourceExports = {
    ['screenshot-basic'] = {
        requestClientScreenshot = function(src, opts, cb)
            SIM.screenshots = (SIM.screenshots or 0) + 1
            local p = SIM.players[tonumber(src)]
            local e = p and SIM.entities[p.ped]
            local label = p and (('[%d] %s  @ %.0f, %.0f, %.0f  t=%ds'):format(src, p.name, e.coords.x, e.coords.y, e.coords.z, SIM.now // 1000)) or '?'
            local data = __jpeg(label)
            SetTimeout(300, function() cb(false, data) end)
        end,
    },
}

---------------------------------------------------------------- convars, resources, kvp
function GetConvar(k, d) local v = SIM.convars[k]; if v == nil then return d end return v end
function GetConvarInt(k, d) return tonumber(SIM.convars[k]) or d end
function GetCurrentResourceName() return 'AdvancedAC' end
function GetResourceState(n) return SIM.resources[n] or 'missing' end
function GetNumResources() local c = 0 for _ in pairs(SIM.resources) do c = c + 1 end return c end
function GetResourceByFindIndex(i)
    local names = {} for n in pairs(SIM.resources) do names[#names + 1] = n end
    table.sort(names)
    return names[i + 1]
end
function StartResource(n) SIM.resources[n] = 'started' return true end
function StopResource(n) SIM.resources[n] = 'stopped' return true end
function SetResourceKvp(k, v) SIM.kvp[k] = v end
function GetResourceKvpString(k) return SIM.kvp[k] end
function ExecuteCommand(c) table.insert(SIM.executed, c) end
function GetHashKey(s)
    -- Jenkins one-at-a-time (joaat), signed 32-bit like FiveM
    s = string.lower(s)
    local h = 0
    for i = 1, #s do
        h = (h + s:byte(i)) & 0xFFFFFFFF
        h = (h + (h << 10)) & 0xFFFFFFFF
        h = h ~ (h >> 6)
    end
    h = (h + (h << 3)) & 0xFFFFFFFF
    h = h ~ (h >> 11)
    h = (h + (h << 15)) & 0xFFFFFFFF
    if h >= 0x80000000 then h = h - 0x100000000 end
    return h
end
joaat = GetHashKey

---------------------------------------------------------------- world: players & entities
local function vec(x, y, z) return { x = x, y = y, z = z } end
vector3 = vec

function SIM.newEntity(kind, props)
    SIM.nextEntity = SIM.nextEntity + 1
    local e = { id = SIM.nextEntity, kind = kind, coords = vec(0, 0, 0), heading = 0, model = 0, velocity = vec(0, 0, 0),
                visible = true, health = 200, maxHealth = 200, armor = 0, weapon = GetHashKey('WEAPON_UNARMED'),
                vehicle = 0, popType = 7, owner = nil, frozen = false, seats = {} }
    for k, v in pairs(props or {}) do e[k] = v end
    SIM.entities[e.id] = e
    return e
end

function SIM.addPlayer(src, name, identifiers, tokens)
    local ped = SIM.newEntity('ped', { isPlayer = true, owner = src })
    SIM.players[src] = { src = src, name = name, identifiers = identifiers, tokens = tokens or {}, endpoint = '10.0.0.' .. src,
                         ped = ped.id, ping = 40, invincible = false, bucket = 0, aces = {} }
    return SIM.players[src]
end

local function P(src) return SIM.players[tonumber(src)] end
local function E(id) return SIM.entities[id] end

function GetPlayers() local t = {} for s in pairs(SIM.players) do if s < 60000 then t[#t + 1] = tostring(s) end end return t end
function GetPlayerName(s) local p = P(s) return p and p.name or nil end
function GetPlayerIdentifiers(s) local p = P(s) return p and p.identifiers or {} end
function GetNumPlayerTokens(s) local p = P(s) return p and #p.tokens or 0 end
function GetPlayerToken(s, i) local p = P(s) return p and p.tokens[i + 1] end
function GetPlayerEndpoint(s) local p = P(s) return p and p.endpoint or nil end
function GetPlayerPing(s) local p = P(s) return p and p.ping or 0 end
function GetPlayerPed(s) local p = P(s) return p and p.ped or 0 end
function GetPlayerInvincible(s) local p = P(s) return p and p.invincible or false end
function GetPlayerRoutingBucket(s) local p = P(s) return p and p.bucket or 0 end
function SetPlayerRoutingBucket(s, b) local p = P(s) if p then p.bucket = b end end
function IsPlayerAceAllowed(s, ace) local p = P(s) return p and p.aces[ace] == true or false end
function DropPlayer(s, reason)
    s = tonumber(s)
    local p = P(s)
    if not p then return end
    table.insert(SIM.dropped, { src = s, name = p.name, reason = reason })
    SIM.players[s] = nil
    source = s
    TriggerEvent('playerDropped', reason)
end

function DoesEntityExist(id) return E(id) ~= nil end
function GetEntityCoords(id) local e = E(id) return e and vec(e.coords.x, e.coords.y, e.coords.z) or vec(0, 0, 0) end
function GetEntityHeading(id) local e = E(id) return e and e.heading or 0.0 end
function GetEntityHealth(id) local e = E(id) return e and e.health or 0 end
function GetEntityMaxHealth(id) local e = E(id) return e and e.maxHealth or 0 end
function GetPedArmour(id) local e = E(id) return e and e.armor or 0 end
function GetSelectedPedWeapon(id) local e = E(id) return e and e.weapon or 0 end
function GetVehiclePedIsIn(id) local e = E(id) return e and e.vehicle or 0 end
function GetEntityModel(id) local e = E(id) return e and e.model or 0 end
function GetVehicleType(id) local e = E(id) return e and e.vtype or 'automobile' end
function GetPedInVehicleSeat(veh, seat) local e = E(veh) return e and e.seats[seat] or 0 end
function GetEntityVelocity(id) local e = E(id) return e and vec(e.velocity.x, e.velocity.y, e.velocity.z) or vec(0, 0, 0) end
function IsEntityVisible(id) local e = E(id) return e and e.visible or false end
function FreezeEntityPosition(id, v) local e = E(id) if e then e.frozen = v end end
function SetEntityCoords(id, x, y, z) local e = E(id) if e then e.coords = vec(x, y, z) end end
function DeleteEntity(id) SIM.entities[id] = nil end
function IsPedAPlayer(id) local e = E(id) return e and e.isPlayer or false end
function GetEntityPopulationType(id) local e = E(id) return e and e.popType or 0 end
function NetworkGetEntityOwner(id) local e = E(id) return e and e.owner or -1 end
function NetworkGetEntityFromNetworkId(n) return n end
function NetworkGetNetworkIdFromEntity(id) return id end
function GetEntityType(id)
    local e = E(id)
    if not e then return 0 end
    return ({ ped = 1, vehicle = 2, object = 3 })[e.kind] or 0
end
local function all(kind) local t = {} for id, e in pairs(SIM.entities) do if e.kind == kind then t[#t + 1] = id end end return t end
function GetAllVehicles() return all('vehicle') end
function GetAllPeds() return all('ped') end
function GetAllObjects() return all('object') end

---------------------------------------------------------------- HTTP bridge
function PerformHttpRequest(url, cb, method, data, headers)
    local status, body = __http(method or 'GET', url, data or '', json.encode(headers or {}))
    SetTimeout(30, function() cb(status, body, {}) end)   -- async, like FiveM
end
