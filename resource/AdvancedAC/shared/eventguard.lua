--[[
  Sentinel AC — EventGuard
  Protects the net events of ANY resource. Add it as the FIRST server script of that resource:

      server_scripts {
          '@AdvancedAC/shared/eventguard.lua',
          'server/main.lua',
      }

  What it does automatically (no code changes):
    • Rate-limits every net event per player (total and per event) → `event_spam` detection.
  Optional, in your own server code:
    Guard.serverOnly('myjob:server:pay')            -- must never come from a client → `event_serveronly` (ban)
    Guard.validate('shop:buy', function(item, amount)  -- reject bad arguments → `event_invalid_args`
        return type(item) == 'string' and math.type(amount) == 'integer' and amount > 0 and amount <= 100
    end)
]]

if not IsDuplicityVersion() then return end   -- server only

Guard = Guard or {}
local AC_RES = 'AdvancedAC'
local resName = GetCurrentResourceName()
local netNames = {}
local validators = {}
local serverOnly = {}
local counters = {}            -- [src] = { second, total, perEvent = {} }
local cfg = { enabled = false, perSecond = 40, perEventPerSecond = 15 }
local reported = {}            -- [src .. key] = ms   (local throttle; the AC also has cooldowns)

local function refreshConfig()
    if GetResourceState(AC_RES) ~= 'started' then return end
    local ok, c = pcall(function() return exports[AC_RES]:GuardConfig() end)
    if ok and c then cfg = c end
end
CreateThread(function()
    while true do
        refreshConfig()
        Wait(30000)
    end
end)

local function report(src, key, details)
    local now = GetGameTimer()
    local k = src .. key
    if reported[k] and now - reported[k] < 10000 then return end
    reported[k] = now
    details.resource = resName
    pcall(function() exports[AC_RES]:GuardReport(src, key, details) end)
end

local function playerSource(src)
    src = tonumber(src)
    if src and src > 0 and GetPlayerName(src) then return src end
    return nil
end

--- Returns false if the call must be dropped.
local function admit(name, src, ...)
    if serverOnly[name] then
        report(src, 'event_serveronly', { event = name })
        return false
    end
    if cfg.enabled then
        local sec = GetGameTimer() // 1000
        local c = counters[src]
        if not c or c.second ~= sec then
            c = { second = sec, total = 0, perEvent = {} }
            counters[src] = c
        end
        c.total = c.total + 1
        c.perEvent[name] = (c.perEvent[name] or 0) + 1
        if c.total > cfg.perSecond or c.perEvent[name] > cfg.perEventPerSecond then
            report(src, 'event_spam', { event = name, total = c.total, thisEvent = c.perEvent[name] })
            return false
        end
    end
    local v = validators[name]
    if v then
        local ok, valid = pcall(v, ...)
        if not ok or not valid then
            report(src, 'event_invalid_args', { event = name })
            return false
        end
    end
    return true
end

local function wrap(name, fn)
    return function(...)
        local src = playerSource(source)
        if src and not admit(name, src, ...) then return end
        return fn(...)
    end
end

local _RegisterNetEvent = RegisterNetEvent
local _AddEventHandler = AddEventHandler

RegisterNetEvent = function(name, fn)
    netNames[name] = true
    if fn then return _RegisterNetEvent(name, wrap(name, fn)) end
    return _RegisterNetEvent(name)
end
RegisterServerEvent = RegisterNetEvent

AddEventHandler = function(name, fn)
    if netNames[name] then return _AddEventHandler(name, wrap(name, fn)) end
    return _AddEventHandler(name, fn)
end

--- Mark an event as server-only: any client trigger is reported (and dropped).
function Guard.serverOnly(name)
    serverOnly[name] = true
    if not netNames[name] then
        -- register it as a net event so the client trigger reaches us and can be reported
        netNames[name] = true
        _RegisterNetEvent(name, wrap(name, function() end))
    end
end

--- Validate arguments of a net event: fn(...) must return true.
function Guard.validate(name, fn) validators[name] = fn end

_AddEventHandler('playerDropped', function()
    local src = tonumber(source)
    counters[src] = nil
end)
