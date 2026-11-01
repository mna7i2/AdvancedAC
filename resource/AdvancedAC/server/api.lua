-- Backend HTTP client. All calls are server → backend over HTTPS with the server API key.
Api = {
    base = nil,
    key = nil,
    fingerprint = nil,
    online = false,       -- last request reached the backend
    licensed = true,      -- false after 401/402/403: protection keeps running locally, backend features off
    failures = 0,
}

local retryQueue = {}     -- { path, body, tries } for idempotent-enough posts (audit, alerts, queued detections)
local MAX_QUEUE = 500

local function headers()
    return {
        ['Content-Type'] = 'application/json',
        ['Authorization'] = 'Bearer ' .. (Api.key or ''),
        ['X-SAC-Fingerprint'] = Api.fingerprint or '',
        ['User-Agent'] = 'SentinelAC/' .. AC.Version,
    }
end

local function handleStatus(status, data)
    if status == 0 or status == nil then
        Api.failures = Api.failures + 1
        if Api.online and Api.failures >= 3 then
            Api.online = false
            Utils.log('warn', 'Backend unreachable - running in offline mode (local enforcement + ban cache)')
        end
        return
    end
    Api.failures = 0
    if not Api.online and status < 500 then
        Api.online = true
        Utils.log('info', 'Backend reachable')
    end
    if status >= 200 and status < 300 then Api.licensed = true end
    if status == 401 or status == 402 or status == 403 then
        if Api.licensed then
            Utils.log('error', 'Backend rejected this server (%s): %s', tostring(status),
                data and (data.message or data.error) or 'unauthorized')
        end
        Api.licensed = false
    end
end

--- Async request. cb(status, data)
function Api.request(method, path, body, cb)
    if not Api.base then if cb then cb(0, nil) end return end
    local payload = body ~= nil and json.encode(body) or ''
    PerformHttpRequest(Api.base .. '/api/v1/agent' .. path, function(status, resBody)
        local data = nil
        if resBody and resBody ~= '' then
            local ok, decoded = pcall(json.decode, resBody)
            if ok then data = decoded end
        end
        handleStatus(status, data)
        if cb then cb(status or 0, data) end
    end, method, payload, headers())
end

--- Blocking request for use inside threads/handlers. Returns status, data. Times out safely.
function Api.await(method, path, body, timeoutMs)
    local p = promise.new()
    local settled = false
    Api.request(method, path, body, function(status, data)
        if settled then return end
        settled = true
        p:resolve({ status, data })
    end)
    SetTimeout(timeoutMs or 10000, function()
        if settled then return end
        settled = true
        handleStatus(0, nil)
        p:resolve({ 0, nil })
    end)
    local r = Citizen.Await(p)
    return r[1], r[2]
end

--- Fire-and-forget POST that is retried while the backend is unreachable.
function Api.post(path, body)
    Api.request('POST', path, body, function(status)
        if status == 0 or status >= 500 then
            if #retryQueue < MAX_QUEUE then
                retryQueue[#retryQueue + 1] = { path = path, body = body, tries = 1 }
            end
        end
    end)
end

--- Called from the heartbeat loop once the backend is reachable again.
function Api.flushQueue()
    if #retryQueue == 0 or not Api.online then return end
    local batch = retryQueue
    retryQueue = {}
    for _, item in ipairs(batch) do
        Api.request('POST', item.path, item.body, function(status)
            if (status == 0 or status >= 500) and item.tries < 20 and #retryQueue < MAX_QUEUE then
                item.tries = item.tries + 1
                retryQueue[#retryQueue + 1] = item
            end
        end)
    end
end

function Api.queueSize() return #retryQueue end
