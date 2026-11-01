-- Bootstrap: configuration, backend handshake, heartbeat loop, client AC handshake,
-- console streaming and resource-state monitoring.
AC.State = {
    -- last config received from the backend, else the built-in defaults (first start / no backend)
    config = Store.loadConfig() or Defaults,
    configVersion = -1,
    handshaken = false,
    serverTimeOffset = nil,        -- unix ms − GetGameTimer()
    stopping = false,
}

--- Unix time in ms (synchronised with the backend clock on handshake).
function AC.now()
    if AC.State.serverTimeOffset then return math.floor(AC.State.serverTimeOffset + GetGameTimer()) end
    return os.time() * 1000
end

---------------------------------------------------------------------------------------------------
-- Config application
---------------------------------------------------------------------------------------------------
local function clientConfig()
    local cfg = AC.State.config
    local out = { detections = {}, resources = {}, ignored = Config.IgnoredClientResources, beatMs = Config.ClientHeartbeat }
    if cfg and cfg.detections then
        for key in pairs(AC.ClientDetections) do
            local d = cfg.detections[key]
            if d then out.detections[key] = { enabled = d.enabled, threshold = d.threshold or {} } end
        end
    end
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name and GetResourceState(name) == 'started' then out.resources[#out.resources + 1] = name end
    end
    return out
end

local function sendClientInit(src)
    local s = Sessions[src]
    if not s then return end
    TriggerClientEvent(AC.Events.Init, src, { token = s.token, config = clientConfig() })
end

function AC.applyConfig(cfg, version)
    if not cfg then return end
    AC.State.config = cfg
    AC.State.configVersion = version or AC.State.configVersion
    Admin.loadStaff(cfg.staff)
    Store.saveConfig(cfg)
    Honeypots.arm()
    for src, s in pairs(Sessions) do
        if s.clientReady then sendClientInit(src) end
    end
    Utils.log('info', 'Configuration applied (version %s)', tostring(version))
end

if AC.State.config then
    Admin.loadStaff(AC.State.config.staff)
    Honeypots.arm()
end

---------------------------------------------------------------------------------------------------
-- Client AC handshake + heartbeat (token per session)
---------------------------------------------------------------------------------------------------
RegisterNetEvent(AC.Events.ClientReady, function()
    local src = source
    local s = Sessions[src]
    if not s then return end
    s.clientReady = true
    s.lastBeat = GetGameTimer()
    sendClientInit(src)
end)

RegisterNetEvent(AC.Events.ClientBeat, function(token)
    local src = source
    local s = Sessions[src]
    if not s then return end
    if token ~= s.token then
        s.badBeats = (s.badBeats or 0) + 1   -- forged / replayed beat: ignored, heartbeat check will fire
        return
    end
    s.lastBeat = GetGameTimer()
end)

---------------------------------------------------------------------------------------------------
-- Console + resource monitoring
---------------------------------------------------------------------------------------------------
local consoleBuf = {}
local resourcesDirty = true

RegisterConsoleListener(function(channel, message)
    if #consoleBuf >= 500 then return end
    local line = tostring(message or ''):gsub('%^%d', ''):gsub('[\r\n]+$', '')
    if line ~= '' then consoleBuf[#consoleBuf + 1] = { t = AC.now(), ch = tostring(channel or ''), line = line:sub(1, 2000) } end
end)

local function resourceList()
    local out = {}
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name then out[#out + 1] = { name = name, state = GetResourceState(name) } end
    end
    return out
end

AddEventHandler('onResourceStop', function(name)
    resourcesDirty = true
    if name == GetCurrentResourceName() then
        AC.State.stopping = true
        if AC.State.handshaken then Api.request('POST', '/shutdown', {}) end
        return
    end
    if AC.State.handshaken and not AC.State.stopping then
        Api.post('/alert', { kind = 'resource_stop', message = ('Resource stopped: %s'):format(name), data = { resource = name } })
    end
end)

AddEventHandler('onResourceStart', function(name)
    resourcesDirty = true
    if name ~= GetCurrentResourceName() and AC.State.handshaken then
        Api.post('/alert', { kind = 'resource_start', message = ('Resource started: %s'):format(name), data = { resource = name } })
    end
end)

---------------------------------------------------------------------------------------------------
-- Backend handshake + heartbeat
---------------------------------------------------------------------------------------------------
local function fingerprint()
    local fp = GetConvar('web_baseUrl', '')
    if fp ~= '' then return fp end
    fp = GetConvar('sentinel_fingerprint', '')
    if fp ~= '' then return 'manual:' .. fp end
    return nil
end

local function handshake()
    local players = {}
    for _, id in ipairs(GetPlayers()) do
        local src = tonumber(id)
        local ids, tokens, ep = Bans.collectIdentity(src)
        players[#players + 1] = { netId = src, name = GetPlayerName(src) or '?', identifiers = ids, tokens = tokens, endpoint = ep }
        if not Sessions[src] then
            Sessions[src] = { name = GetPlayerName(src), joinedAt = GetGameTimer(), token = Utils.randomToken(32), lastBeat = GetGameTimer(), clientReady = false }
        end
    end
    local status, data = Api.await('POST', '/handshake', {
        acVersion = AC.Version, hostname = GetConvar('sv_hostname', ''), fingerprint = Api.fingerprint,
        maxPlayers = GetConvarInt('sv_maxclients', 32), framework = Framework.detect(),
        onesync = GetConvar('onesync', 'off') ~= 'off', resources = (function()
            local r = {}
            for _, x in ipairs(resourceList()) do if x.state == 'started' then r[#r + 1] = x.name end end
            return r
        end)(), players = players,
    }, 15000)
    if status ~= 200 or not data then return false, status end

    AC.State.serverTimeOffset = data.serverTime - GetGameTimer()
    for _, m in ipairs(data.sessions or {}) do
        local s = Sessions[m.netId]
        if s then s.sessionId, s.playerId = m.sessionId, m.playerId end
    end
    Store.setBans(data.bans or {})
    AC.applyConfig(data.config, data.configVersion)
    AC.State.handshaken = true
    resourcesDirty = false
    Utils.log('info', '^2Connected^7 to backend as "%s" | %d players | %d bans cached | latest AC %s',
        data.serverName, #players, Store.banCount(), data.latestVersion)
    if data.latestVersion and data.latestVersion ~= AC.Version then
        Utils.log('warn', 'A newer version is available: %s (running %s)', data.latestVersion, AC.Version)
    end
    return true
end

local function heartbeat()
    local samples, events = Telemetry.drain()
    local acks = Commands.drainAcks()
    local console = consoleBuf
    consoleBuf = {}
    local body = {
        uptime = math.floor(GetGameTimer() / 1000), configVersion = AC.State.configVersion,
        players = Telemetry.snapshot(), samples = samples, events = events, console = console, acks = acks,
    }
    if resourcesDirty then body.resources = resourceList() end
    local status, data = Api.await('POST', '/heartbeat', body, 10000)
    if status == 200 and data then
        if body.resources then resourcesDirty = false end
        if data.serverTime then AC.State.serverTimeOffset = data.serverTime - GetGameTimer() end
        if data.config then AC.applyConfig(data.config, data.configVersion) end
        Commands.run(data.commands)
        Api.flushQueue()
        Bans.registerOfflineSessions()
        return true
    end
    -- Failed: keep acks so commands are not lost; drop telemetry beyond the buffer limits.
    for _, a in ipairs(acks) do Commands.requeueAck(a) end
    return false
end

CreateThread(function()
    Api.base = (GetConvar('sentinel_backend', '')):gsub('/+$', '')
    Api.key = GetConvar('sentinel_api_key', '')
    if Api.base == '' or Api.key == '' then
        Utils.log('warn', 'No backend configured (sentinel_backend / sentinel_api_key): LOCAL protection only - detections, kicks, local bans and /adv work; dashboard features are off.')
        Api.base = nil
        return
    end
    if GetConvar('onesync', 'off') == 'off' then
        Utils.log('error', 'OneSync is disabled: server-side detections will not work. Set `set onesync on`.')
    end
    -- web_baseUrl is set a few seconds after the server registers with Cfx.re
    local waited = 0
    while not fingerprint() and waited < 60000 do Wait(1000); waited = waited + 1000 end
    Api.fingerprint = fingerprint()
    if not Api.fingerprint then
        Utils.log('error', 'Could not determine server fingerprint. Set `set sentinel_fingerprint "your-server-name"`.')
        return
    end

    local backoff = 5000
    while not AC.State.handshaken and not AC.State.stopping do
        local ok, status = handshake()
        if ok then break end
        if status == 401 or status == 402 or status == 403 then
            Utils.log('error', 'Handshake rejected (%s). Check the API key / license in the dashboard. Retrying in 60s.', tostring(status))
            backoff = 60000
        else
            Utils.log('warn', 'Backend unreachable (status %s). Retrying in %ds - local protection is active.', tostring(status), backoff // 1000)
        end
        Wait(backoff)
        backoff = math.min(backoff * 2, 60000)
    end

    while not AC.State.stopping do
        local interval = (AC.State.config and AC.State.config.telemetry and AC.State.config.telemetry.heartbeatMs) or 3000
        Wait(math.max(1000, interval))
        local ok, err = pcall(heartbeat)
        if not ok then Utils.log('error', 'heartbeat: %s', tostring(err)) end
    end
end)
