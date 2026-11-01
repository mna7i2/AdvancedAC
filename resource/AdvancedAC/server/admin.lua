-- In-game staff: permission resolution (dashboard-linked staff accounts → ACE → framework bridge),
-- staff alerts, and audit logging of every in-game admin action.
Admin = {}

local staffByIdentifier = {}   -- "license:xxx" -> { name, permissions(set) }

function Admin.loadStaff(list)
    staffByIdentifier = {}
    for _, s in ipairs(list or {}) do
        local entry = { name = s.name, permissions = Utils.toSet(s.permissions) }
        for _, id in ipairs(s.identifiers or {}) do staffByIdentifier[id] = entry end
    end
end

local function staffOf(src)
    for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
        local s = staffByIdentifier[id]
        if s then return s end
    end
    return nil
end

--- Returns allowed, via ('staff' | 'ace').
function Admin.can(src, perm)
    if src == 0 then return true, 'ace' end   -- server console
    local s = staffOf(src)
    if s and s.permissions[perm] then return true, 'staff' end
    if IsPlayerAceAllowed(src, Config.AdminAce) or IsPlayerAceAllowed(src, Config.PermAcePrefix .. perm) then return true, 'ace' end
    if Framework.isAdmin(src) then return true, 'ace' end
    return false, nil
end

function Admin.isStaff(src)
    return staffOf(src) ~= nil or IsPlayerAceAllowed(src, Config.AdminAce) or Framework.isAdmin(src)
end

function Admin.identity(src, via)
    local ids = {}
    for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
        if not id:find('^ip:') then ids[#ids + 1] = id end
    end
    return { name = GetPlayerName(src) or 'console', identifiers = ids, via = via or 'ace' }
end

--- Append an audit entry for an in-game action (retried while the backend is unreachable).
function Admin.audit(src, via, action, targetSrc, details)
    local target = targetSrc and Sessions[targetSrc]
    Api.post('/audit', { entries = { {
        admin = Admin.identity(src, via), action = action,
        targetSessionId = target and target.sessionId or nil, details = details or {},
    } } })
    Telemetry.event(targetSrc, 'admin', { action = action, by = GetPlayerName(src) or 'console' })
end

--- Notify online staff (in-game toast). Only staff who may view detections receive it.
function Admin.alert(text, data)
    for src in pairs(Sessions) do
        if Admin.can(src, 'detections.view') then
            TriggerClientEvent(AC.Events.AdminAlert, src, { text = text, data = data and { src = data.src, key = data.key, action = data.action } or nil })
        end
    end
end

---------------------------------------------------------------------------------------------------
-- In-game menu (/adv). The client only relays clicks; everything is authorised here.
---------------------------------------------------------------------------------------------------
local recentAlerts = {}
local _alert = Admin.alert
function Admin.alert(text, data)
    table.insert(recentAlerts, 1, { text = text, t = os.time(), src = data and data.src, key = data and data.key, action = data and data.action })
    if #recentAlerts > 40 then recentAlerts[#recentAlerts] = nil end
    _alert(text, data)
end

local MENU_PERMS = { 'players.view', 'players.spectate', 'players.screenshot', 'players.actions', 'players.kick',
    'players.ban', 'players.unban', 'entities.cleanup', 'announce.send', 'detections.view' }

local function notify(src, kind, text)
    TriggerClientEvent(AC.Events.Notify, src, { type = kind, text = text })
end

local function enabledDetections()
    local n, total = 0, 0
    for _, d in pairs((AC.State.config and AC.State.config.detections) or {}) do
        total = total + 1
        if d.enabled then n = n + 1 end
    end
    return n, total
end

local function menuData(src)
    local perms = {}
    for _, p in ipairs(MENU_PERMS) do perms[p] = Admin.can(src, p) end
    local players = {}
    for psrc, s in pairs(Sessions) do
        local st = Telemetry.get(psrc)
        players[#players + 1] = {
            id = psrc, name = s.name or GetPlayerName(psrc) or '?', ping = GetPlayerPing(psrc),
            health = st and st.hp or 0, armor = st and st.ar or 0, inVehicle = st and st.vm ~= 0 or false,
            detections = s.detections or 0, staff = Admin.isStaff(psrc), synced = s.sessionId ~= nil,
        }
    end
    table.sort(players, function(a, b) return a.id < b.id end)
    local on, total = enabledDetections()
    return {
        me = { id = src, name = GetPlayerName(src), perms = perms, spectating = Sessions[src] and Sessions[src].spectating or nil },
        players = players,
        alerts = perms['detections.view'] and recentAlerts or {},
        status = {
            version = AC.Version, backend = Api.online, licensed = Api.licensed, handshaken = AC.State.handshaken,
            framework = Framework.name, onesync = GetConvar('onesync', 'off') ~= 'off', bansCached = Store.banCount(),
            detectionsOn = on, detectionsTotal = total, queued = Api.queueSize(), screenshots = Evidence.available(),
            players = Utils.tableCount(Sessions), maxPlayers = GetConvarInt('sv_maxclients', 32),
        },
    }
end

local function validTarget(src, t)
    t = tonumber(t)
    if not t or not Sessions[t] then notify(src, 'error', 'Player is not online') return nil end
    return t
end

local rate = {}
local actions = {}

actions.open = function(src) TriggerClientEvent(AC.Events.MenuOpen, src, menuData(src)) end
actions.refresh = function(src) TriggerClientEvent(AC.Events.MenuData, src, menuData(src)) end

actions.lookup = function(src, b)
    local t = validTarget(src, b.target); if not t then return end
    local s = Sessions[t]
    local res = { target = t, name = s.name, identifiers = {}, local_detections = s.detections or 0 }
    for _, id in ipairs(GetPlayerIdentifiers(t) or {}) do
        if not id:find('^ip:') then res.identifiers[#res.identifiers + 1] = id end
    end
    if s.sessionId and Api.online then
        local status, data = Api.await('POST', '/admin/lookup', { sessionId = s.sessionId }, 8000)
        if status == 200 and data then res.profile = data end
    end
    TriggerClientEvent(AC.Events.MenuData, src, { lookup = res })
end

actions.spectate = function(src, b, via)
    local t = validTarget(src, b.target); if not t then return end
    if t == src then notify(src, 'error', 'You cannot spectate yourself') return end
    local c = GetEntityCoords(GetPlayerPed(t))
    Sessions[src].spectating = t
    Grace.set(src, 'all', 3600000)
    TriggerClientEvent(AC.Events.Spectate, src, { on = true, target = t, name = Sessions[t].name, coords = { x = c.x, y = c.y, z = c.z } })
    Admin.audit(src, via, 'spectate', t, {})
end

actions.spectate_stopped = function(src)
    local s = Sessions[src]
    if not s or not s.spectating then return end
    s.spectating = nil
    Grace.clear(src)
    Grace.set(src, 'all', 6000)
end

actions.screenshot = function(src, b, via)
    local t = validTarget(src, b.target); if not t then return end
    if not Evidence.available() then notify(src, 'error', 'screenshot-basic is not running') return end
    notify(src, 'info', 'Capturing screenshot...')
    Evidence.capture(t, { requestedBy = GetPlayerName(src) .. ' (in-game)', meta = { manual = true } }, function(ok, id)
        notify(src, ok and 'success' or 'error', ok and ('Screenshot saved to Evidence (' .. tostring(id):sub(1, 8) .. ')') or 'Screenshot failed')
    end)
    Admin.audit(src, via, 'screenshot', t, {})
end

actions.kick = function(src, b, via)
    local t = validTarget(src, b.target); if not t then return end
    local reason = tostring(b.reason or ''):sub(1, 200)
    if reason == '' then reason = 'No reason' end
    Admin.audit(src, via, 'kick', t, { reason = reason })
    DropPlayer(t, ('[%s] Kicked by staff: %s'):format(AC.Name, reason))
    notify(src, 'success', 'Player kicked')
end

actions.ban = function(src, b, via)
    local t = validTarget(src, b.target); if not t then return end
    local reason = tostring(b.reason or ''):sub(1, 300)
    if reason == '' then notify(src, 'error', 'A reason is required') return end
    local hours = math.max(0, math.floor(tonumber(b.hours) or 0))
    local s = Sessions[t]
    local admin = Admin.identity(src, via)
    if s.sessionId and Api.online then
        local status, data = Api.await('POST', '/admin/ban', { admin = admin, sessionId = s.sessionId, reason = reason, durationHours = hours }, 8000)
        if status == 200 and data and data.ok then
            DropPlayer(t, data.message)
            notify(src, 'success', 'Banned - ' .. data.banId)
            return
        end
    end
    -- Offline: enforce locally now, persist when the backend is back.
    local ids = {}
    for _, id in ipairs(GetPlayerIdentifiers(t) or {}) do if not id:find('^ip:') then ids[#ids + 1] = id end end
    local localId = 'LOCAL-' .. os.time()
    Store.addLocalBan({ id = localId, reason = reason, expiresAt = hours > 0 and (os.time() + hours * 3600) or 0, ids = ids })
    if s.sessionId then Api.post('/admin/ban', { admin = admin, sessionId = s.sessionId, reason = reason, durationHours = hours }) end
    DropPlayer(t, Bans.formatLocal({ id = localId, reason = reason, expiresAt = hours > 0 and (os.time() + hours * 3600) or 0 }))
    notify(src, 'warning', 'Banned locally (backend offline) - will sync when online')
end

actions.unban = function(src, b, via)
    local id = tostring(b.banId or ''):upper():gsub('%s', '')
    if not id:match('^SB%-[A-Z0-9]+$') then notify(src, 'error', 'Invalid ban ID') return end
    if not Api.online then notify(src, 'error', 'Backend offline - unban needs the backend') return end
    local status, data = Api.await('POST', '/admin/unban', { admin = Admin.identity(src, via), banId = id, reason = tostring(b.reason or ''):sub(1, 300) }, 8000)
    if status == 200 and data and data.ok then
        Bans.sync()
        notify(src, 'success', 'Unbanned ' .. id)
    else
        notify(src, 'error', (data and data.error) or 'Unban failed')
    end
end

local function command(kind)
    return function(src, b, via)
        local t = validTarget(src, b.target); if not t then return end
        local p = { netId = t, adminNetId = src }
        local ok, success, res = pcall(Commands.exec, kind, p)
        local good = ok and success
        if good then Admin.audit(src, via, kind, t, {}) end
        local msg = good and ((kind:gsub('_', ' ')) .. ': done')
            or (not ok and tostring(success)) or (res and res.error) or 'failed'
        notify(src, good and 'success' or 'error', msg)
    end
end
actions.freeze = command('freeze')
actions.unfreeze = command('unfreeze')
actions.heal = command('heal')
actions['goto'] = command('teleport_to')
actions.bring = command('bring')

local function cleanup(kind)
    return function(src, _, via)
        local ok, res = Commands.exec(kind, {})
        Admin.audit(src, via, kind, nil, res or {})
        notify(src, ok and 'success' or 'error', ('%s: %d deleted'):format((kind:gsub('_', ' ')), res and res.deleted or 0))
    end
end
actions.delete_vehicles = cleanup('delete_vehicles')
actions.delete_peds = cleanup('delete_peds')
actions.delete_objects = cleanup('delete_objects')

actions.announce = function(src, b, via)
    local text = tostring(b.text or ''):sub(1, 500)
    if text == '' then return end
    Commands.exec('announce', { title = b.title or 'Announcement', text = text })
    Admin.audit(src, via, 'announce', nil, { text = text })
end

local ACTION_PERM = {
    open = 'players.view', refresh = 'players.view', lookup = 'players.view', spectate = 'players.spectate',
    spectate_stopped = nil, screenshot = 'players.screenshot', kick = 'players.kick', ban = 'players.ban',
    unban = 'players.unban', freeze = 'players.actions', unfreeze = 'players.actions', heal = 'players.actions',
    ['goto'] = 'players.actions', bring = 'players.actions', delete_vehicles = 'entities.cleanup',
    delete_peds = 'entities.cleanup', delete_objects = 'entities.cleanup', announce = 'announce.send',
}

RegisterNetEvent(AC.Events.MenuAction, function(token, body)
    local src = tonumber(source)
    local s = Sessions[src]
    if not s or token ~= s.token or type(body) ~= 'table' then return end
    local fn = actions[body.action]
    if not fn then return end
    if Utils.windowHit(rate, src, GetGameTimer(), 1000) > 8 then return end
    local perm = ACTION_PERM[body.action]
    local via = 'ace'
    if perm then
        local ok, v = Admin.can(src, perm)
        if not ok then
            if body.action ~= 'open' then notify(src, 'error', 'No permission: ' .. perm) end
            return
        end
        via = v
    end
    CreateThread(function()
        local ok, err = pcall(fn, src, body, via)
        if not ok then Utils.log('error', 'menu action %s: %s', body.action, tostring(err)) end
        if body.action ~= 'open' and body.action ~= 'refresh' and body.action ~= 'lookup' and Sessions[src] then
            TriggerClientEvent(AC.Events.MenuData, src, menuData(src))
        end
    end)
end)

AddEventHandler('playerDropped', function() rate[source] = nil end)
