Utils = {}

function Utils.log(level, msg, ...)
    if level == 'debug' and not Config.Debug then return end
    local text = select('#', ...) > 0 and string.format(msg, ...) or msg
    print(('^5[Sentinel AC]^7 [%s] %s'):format(level, text))
end

function Utils.dist(a, b)
    local dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

function Utils.dist2d(a, b)
    local dx, dy = a.x - b.x, a.y - b.y
    return math.sqrt(dx * dx + dy * dy)
end

function Utils.round(n, d)
    local m = 10 ^ (d or 0)
    return math.floor(n * m + 0.5) / m
end

function Utils.toSet(list)
    local s = {}
    if list then for _, v in ipairs(list) do s[v] = true end end
    return s
end

-- Random token for per-session client validation
function Utils.randomToken(len)
    local chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    local t = {}
    for i = 1, (len or 32) do
        local r = math.random(1, #chars)
        t[i] = chars:sub(r, r)
    end
    return table.concat(t)
end

-- Sliding-window counter: returns count of events within windowMs after adding one at `now`.
function Utils.windowHit(store, key, now, windowMs)
    local list = store[key]
    if not list then list = {}; store[key] = list end
    list[#list + 1] = now
    local cut = now - windowMs
    local first = 1
    while list[first] and list[first] < cut do first = first + 1 end
    if first > 1 then
        table.move(list, first, #list, 1)
        for i = #list - first + 2, #list do list[i] = nil end
    end
    return #list
end

-- Unsigned/signed hash normalisation (GetHashKey returns signed 32-bit)
function Utils.hash(v)
    if type(v) == 'number' then return v end
    return GetHashKey(v)
end

function Utils.tableCount(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end
