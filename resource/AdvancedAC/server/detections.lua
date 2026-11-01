-- Detection core: grace windows, bypass, cooldowns, reporting to the backend, applying the decided
-- action, evidence capture, and an offline fallback that follows the same safety rules as the backend.
-- The individual checks live in telemetry.lua (state-based) and events.lua (network-event based).

---------------------------------------------------------------------------------------------------
-- Grace windows: legitimate moments where movement/health anomalies are expected.
---------------------------------------------------------------------------------------------------
Grace = {}
local grace = {}   -- [src] = { [kind] = untilMs }

function Grace.set(src, kind, ms)
    src = tonumber(src)
    if not src then return end
    grace[src] = grace[src] or {}
    local untilMs = GetGameTimer() + (ms or 5000)
    if (grace[src][kind] or 0) < untilMs then grace[src][kind] = untilMs end
end

function Grace.active(src, kind)
    local g = grace[src]
    if not g then return false end
    local now = GetGameTimer()
    return (g.all or 0) > now or (kind and (g[kind] or 0) > now) or false
end

function Grace.clear(src) grace[src] = nil end

-- Public API for other resources (teleports, revives, admin tools):
--   exports.AdvancedAC:AllowTeleport(src)            -- 5s teleport grace
--   exports.AdvancedAC:SetGrace(src, 'health', 3000)  -- kinds: teleport, health, godmode, invisible, speed, all
exports('AllowTeleport', function(src, ms) Grace.set(src, 'teleport', ms or 5000) end)
exports('SetGrace', function(src, kind, ms) Grace.set(src, kind or 'all', ms or 5000) end)

---------------------------------------------------------------------------------------------------
-- Evidence (screenshot-basic)
---------------------------------------------------------------------------------------------------
Evidence = {}

function Evidence.available()
    return GetResourceState('screenshot-basic') == 'started'
end

--- Capture a screenshot of `src` and upload it. opts = { detectionId, monitorId, requestedBy, meta }.
--- cb(ok, evidenceId) is always called (within ~8s).
function Evidence.capture(src, opts, cb)
    cb = cb or function() end
    local s = Sessions[src]
    if not s or not s.sessionId or not Evidence.available() or not Api.online then cb(false) return end
    local done = false
    local function finish(ok, id) if not done then done = true cb(ok, id) end end
    SetTimeout(8000, function() finish(false) end)
    exports['screenshot-basic']:requestClientScreenshot(src, { encoding = 'jpg', quality = 0.6 }, function(err, data)
        if err or type(data) ~= 'string' then finish(false) return end
        Api.request('POST', '/evidence', {
            sessionId = s.sessionId, detectionId = opts.detectionId, monitorId = opts.monitorId,
            requestedBy = opts.requestedBy or AC.Name, data = data, meta = opts.meta or {},
        }, function(status, res)
            finish(status == 200, res and res.evidenceId)
        end)
    end)
end

---------------------------------------------------------------------------------------------------
-- Reporting
---------------------------------------------------------------------------------------------------
Detect = {}
local lastAt = {}      -- [src][key] = ms
local enforcing = {}   -- [src] = true while a kick/ban is in progress

function Detect.config(key)
    local d = AC.State.config and AC.State.config.detections
    return d and d[key] or nil
end

function Detect.enabled(key)
    local c = Detect.config(key)
    return c ~= nil and c.enabled == true
end

function Detect.threshold(key, field, default)
    local c = Detect.config(key)
    local v = c and c.threshold and c.threshold[field]
    if v == nil then return default end
    return v
end

--- Staff bypass: global ACE, per-detection ACEs and per-detection identifier whitelist.
function Detect.bypassed(src, key)
    if IsPlayerAceAllowed(src, Config.BypassAce) then return true end
    local c = Detect.config(key)
    if not c or not c.whitelist then return false end
    for _, ace in ipairs(c.whitelist.aces or {}) do
        if IsPlayerAceAllowed(src, ace) then return true end
    end
    local wl = c.whitelist.identifiers
    if wl and #wl > 0 then
        local set = Utils.toSet(wl)
        for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
            if set[id] then return true end
        end
    end
    return false
end

function Detect.forget(src)
    lastAt[src] = nil
    enforcing[src] = nil
    Grace.clear(src)
end

local RANK = { log = 0, warn = 1, kick = 2, ban = 3 }

--- Offline decision: same safety rule as the backend (never ban on an unverified client signal).
local function localDecision(key, cfg, verified)
    local action = cfg.action
    if action == 'ban' and not verified then action = 'kick' end
    return action
end

local function alertStaff(src, key, action, details)
    if Admin and Admin.alert then
        local cfg = Detect.config(key)
        Admin.alert(('%s [%d]: %s -> %s'):format(GetPlayerName(src) or '?', src, cfg and cfg.name or key, action), {
            src = src, key = key, action = action, details = details,
        })
    end
end

--- Apply the action decided by the backend (or the local fallback).
function Detect.apply(src, key, res, details)
    local action = res.action
    if action == 'ignored' or action == 'suppressed' or action == nil then return end
    if action ~= 'log' then alertStaff(src, key, action, details) end
    if RANK[action] == nil or RANK[action] < RANK.kick then return end
    if enforcing[src] then return end
    enforcing[src] = true

    local function enforce()
        if not GetPlayerName(src) then return end   -- already gone
        if action == 'ban' then
            local ids = GetPlayerIdentifiers(src) or {}
            local strong = {}
            for _, id in ipairs(ids) do
                if not id:find('^ip:') then strong[#strong + 1] = id end
            end
            Store.addLocalBan({ id = res.banId or ('LOCAL-' .. os.time()), reason = res.reason or key, expiresAt = res.expiresAt or 0, ids = strong })
        end
        DropPlayer(src, res.message or ('[' .. AC.Name .. '] ' .. key))
    end

    -- Capture evidence first: a screenshot is impossible once the player is dropped.
    if res.screenshot then
        Evidence.capture(src, { detectionId = res.detectionId, requestedBy = AC.Name, meta = { key = key } }, function() enforce() end)
    else
        enforce()
    end
end

--- Main entry point used by all checks. `details` is a small table describing what was observed.
function Detect.report(src, key, details)
    local s = Sessions[src]
    if not s or enforcing[src] then return end
    local cfg = Detect.config(key)
    if not cfg or not cfg.enabled then return end
    if Detect.bypassed(src, key) then return end

    local now = GetGameTimer()
    lastAt[src] = lastAt[src] or {}
    if lastAt[src][key] and now - lastAt[src][key] < (cfg.cooldown or 30) * 1000 then return end
    lastAt[src][key] = now

    details = details or {}
    s.detections = (s.detections or 0) + 1
    Utils.log('debug', 'detection %s on %s: %s', key, src, json.encode(details))
    if Telemetry then Telemetry.event(src, 'detection', { key = key, details = details }) end

    CreateThread(function()
        if Api.online and Api.licensed and s.sessionId then
            local status, res = Api.await('POST', '/detection', { sessionId = s.sessionId, key = key, details = details }, 8000)
            if status == 200 and res then
                Detect.apply(src, key, res, details)
                return
            end
        end
        -- Offline fallback: enforce locally, send the detection when the backend is back.
        local verified = AC.ClientDetections[key] == nil
        local action = localDecision(key, cfg, verified)
        if s.sessionId then Api.post('/detection', { sessionId = s.sessionId, key = key, details = details }) end
        local msgs = AC.State.config and AC.State.config.enforcement or {}
        local reason = cfg.name or key
        local message = action == 'ban'
            and ('[' .. AC.Name .. '] You have been banned: ' .. reason)
            or ((msgs.kickMessage or 'Removed by Sentinel AC: {reason}'):gsub('{reason}', function() return reason end))
        Detect.apply(src, key, { action = action, message = message, reason = reason, screenshot = false }, details)
    end)
end

-- Expose for other resources (e.g. custom server-side checks):
--   exports.AdvancedAC:Report(src, 'honeypot_event', { event = 'x' })
exports('Report', function(src, key, details) Detect.report(tonumber(src), key, details) end)
