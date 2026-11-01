-- Connection gate: every joining player is checked against the backend (all identifiers + hardware
-- tokens). If the backend is down, the local ban cache (KVP) is used so bans still hold.
Sessions = {}        -- [src] = { sessionId, playerId, name, joinedAt, token, lastBeat, identifiers }
local pending = {}   -- [tempSrc] = connect result while the player is still loading

local function collectIdentity(src)
    local ids = GetPlayerIdentifiers(src) or {}
    local tokens = {}
    local n = GetNumPlayerTokens(src) or 0
    for i = 0, n - 1 do
        local t = GetPlayerToken(src, i)
        if t then tokens[#tokens + 1] = t end
    end
    local ep = GetPlayerEndpoint(src) or ''
    ep = ep:match('^([^:]+)') or ep
    return ids, tokens, ep
end
Bans = { collectIdentity = collectIdentity }

local function formatLocal(ban)
    local tpl = (AC.State.config and AC.State.config.enforcement and AC.State.config.enforcement.banMessage)
        or 'You are banned.\nBan ID: {banId}\nReason: {reason}'
    local expires = (ban.expiresAt or 0) == 0 and 'Never' or os.date('!%Y-%m-%d %H:%M UTC', ban.expiresAt)
    local appeal = AC.State.config and AC.State.config.enforcement and AC.State.config.enforcement.appealUrl or ''
    local vars = { banId = ban.id, reason = ban.reason or '', expires = expires, appealUrl = appeal }
    -- function replacement so '%' in reasons can't break the pattern engine
    return (tpl:gsub('{(%w+)}', function(k) return vars[k] or ('{' .. k .. '}') end))
end
Bans.formatLocal = formatLocal

AddEventHandler('playerConnecting', function(name, _, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)
    deferrals.update(('[%s] Verifying %s...'):format(AC.Name, name))

    local ids, tokens, ep = collectIdentity(src)
    local hasLicense = false
    for _, id in ipairs(ids) do
        if id:find('^license2?:') then hasLicense = true break end
    end
    if not hasLicense then
        deferrals.done(('[%s] A Rockstar license is required to join.'):format(AC.Name))
        return
    end

    -- 1) Local cache first: instant reject for known bans, works offline.
    local local_ = Store.findBan(ids)
    if local_ then
        deferrals.done(formatLocal(local_))
        return
    end

    -- 2) Backend: full check incl. hardware tokens + session creation.
    if Api.licensed and Api.base then
        local status, data = Api.await('POST', '/player/connecting', {
            name = name, identifiers = ids, tokens = tokens, endpoint = ep,
        }, 8000)
        if status == 200 and data then
            if not data.allow then
                deferrals.done(data.message or 'Banned.')
                return
            end
            pending[src] = { sessionId = data.sessionId, playerId = data.playerId, name = name }
            deferrals.done()
            return
        end
    end

    -- 3) Backend unreachable: allow, register the session later.
    pending[src] = { sessionId = nil, playerId = nil, name = name, offline = true }
    deferrals.done()
end)

local function register(src, info)
    Sessions[src] = {
        sessionId = info.sessionId, playerId = info.playerId, name = info.name or GetPlayerName(src),
        joinedAt = GetGameTimer(), token = Utils.randomToken(32), lastBeat = GetGameTimer(), clientReady = false,
    }
    if Grace then Grace.set(src, 'all', Config.Grace.spawn) end
    if info.sessionId then
        Api.post('/player/joined', { sessionId = info.sessionId, netId = src })
    end
end

-- Temp id → real server id once the player is fully joined.
AddEventHandler('playerJoining', function(oldId)
    local src = source
    local info = pending[tonumber(oldId)]
    pending[tonumber(oldId)] = nil
    register(src, info or { offline = true, name = GetPlayerName(src) })
end)

AddEventHandler('playerDropped', function(reason)
    local src = source
    local s = Sessions[src]
    Sessions[src] = nil
    if Telemetry then Telemetry.forget(src) end
    if Detect then Detect.forget(src) end
    if s and s.sessionId then
        Api.post('/player/dropped', { sessionId = s.sessionId, reason = tostring(reason or ''):sub(1, 500) })
    end
end)

--- Players who joined while the backend was down get a session as soon as it is back.
function Bans.registerOfflineSessions()
    if not Api.online or not Api.licensed then return end
    for src, s in pairs(Sessions) do
        if not s.sessionId and not s.registering then
            s.registering = true
            CreateThread(function()
                local ids, tokens, ep = collectIdentity(src)
                local status, data = Api.await('POST', '/player/connecting', {
                    name = s.name, identifiers = ids, tokens = tokens, endpoint = ep,
                }, 8000)
                s.registering = false
                if not Sessions[src] then return end
                if status == 200 and data then
                    if not data.allow then
                        DropPlayer(src, data.message or 'Banned.')
                        return
                    end
                    s.sessionId, s.playerId = data.sessionId, data.playerId
                    Api.post('/player/joined', { sessionId = s.sessionId, netId = src })
                end
            end)
        end
    end
end

function Bans.sync()
    Api.request('GET', '/bans', nil, function(status, data)
        if status == 200 and data and data.bans then
            Store.setBans(data.bans)
            Utils.log('debug', 'Ban cache synced (%d)', #data.bans)
            -- Kick anyone online who is now banned (e.g. banned on another server of the org).
            for src in pairs(Sessions) do
                local ids = GetPlayerIdentifiers(src) or {}
                local ban = Store.findBan(ids)
                if ban then DropPlayer(src, formatLocal(ban)) end
            end
        end
    end)
end
