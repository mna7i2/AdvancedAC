-- Local persistence (resource KVP). The resource never talks to SQL directly: the backend owns the
-- database. KVP keeps the last ban list + config so enforcement survives backend outages and restarts.
Store = {}

local BAN_KEY = 'sentinel:bans:v1'
local CFG_KEY = 'sentinel:config:v1'

local banIndex = {}   -- "kind:value" -> ban
local banCount = 0

local function rebuild(list)
    banIndex = {}
    banCount = 0
    local now = os.time()
    for _, ban in ipairs(list or {}) do
        if (ban.expiresAt or 0) == 0 or ban.expiresAt > now then
            banCount = banCount + 1
            for _, id in ipairs(ban.ids or {}) do banIndex[id] = ban end
        end
    end
end

function Store.setBans(list)
    rebuild(list)
    SetResourceKvp(BAN_KEY, json.encode(list or {}))
end

--- Add a single ban locally (offline enforcement before the backend confirms).
function Store.addLocalBan(ban)
    local list = {}
    local raw = GetResourceKvpString(BAN_KEY)
    if raw then list = json.decode(raw) or {} end
    list[#list + 1] = ban
    Store.setBans(list)
end

--- Returns the ban matching any of the player's raw identifiers ("license:abc"), or nil.
function Store.findBan(identifiers)
    local now = os.time()
    for _, id in ipairs(identifiers) do
        local ban = banIndex[id]
        if ban and ((ban.expiresAt or 0) == 0 or ban.expiresAt > now) then return ban end
    end
    return nil
end

function Store.banCount() return banCount end

function Store.saveConfig(cfg) SetResourceKvp(CFG_KEY, json.encode(cfg)) end

function Store.loadConfig()
    local raw = GetResourceKvpString(CFG_KEY)
    if not raw then return nil end
    local ok, cfg = pcall(json.decode, raw)
    return ok and cfg or nil
end

-- Load cached bans on start
do
    local raw = GetResourceKvpString(BAN_KEY)
    if raw then
        local ok, list = pcall(json.decode, raw)
        if ok then rebuild(list) end
    end
end
