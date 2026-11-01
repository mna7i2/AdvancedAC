-- Weapon metadata used by server-side combat validation.
-- Hashes are normalised to unsigned 32-bit: natives may return signed values while network
-- events carry unsigned ones.
Weapons = {}

function Weapons.u32(h)
    h = math.tointeger(h) or 0
    return h & 0xFFFFFFFF
end

local function set(names)
    local s = {}
    for _, n in ipairs(names) do s[Weapons.u32(GetHashKey(n))] = n end
    return s
end

Weapons.UNARMED = Weapons.u32(GetHashKey('WEAPON_UNARMED'))

Weapons.snipers = set({ 'WEAPON_SNIPERRIFLE', 'WEAPON_HEAVYSNIPER', 'WEAPON_HEAVYSNIPER_MK2', 'WEAPON_MARKSMANRIFLE',
    'WEAPON_MARKSMANRIFLE_MK2', 'WEAPON_PRECISIONRIFLE', 'WEAPON_MUSKET' })

-- Many pellets per shot → many damage events per trigger pull.
Weapons.multiHit = set({ 'WEAPON_PUMPSHOTGUN', 'WEAPON_PUMPSHOTGUN_MK2', 'WEAPON_SAWNOFFSHOTGUN', 'WEAPON_ASSAULTSHOTGUN',
    'WEAPON_BULLPUPSHOTGUN', 'WEAPON_HEAVYSHOTGUN', 'WEAPON_DBSHOTGUN', 'WEAPON_AUTOSHOTGUN', 'WEAPON_COMBATSHOTGUN',
    'WEAPON_MINIGUN', 'WEAPON_RAYMINIGUN', 'WEAPON_FLAMETHROWER' })

-- Damage sources that are not "held weapons": no damage cap / mismatch / range validation.
Weapons.environmental = set({ 'WEAPON_RUN_OVER_BY_CAR', 'WEAPON_RAMMED_BY_CAR', 'WEAPON_FALL', 'WEAPON_EXPLOSION',
    'WEAPON_FIRE', 'WEAPON_DROWNING', 'WEAPON_DROWNING_IN_VEHICLE', 'WEAPON_BLEEDING', 'WEAPON_ELECTRIC_FENCE',
    'WEAPON_EXHAUSTION', 'WEAPON_HIT_BY_WATER_CANNON', 'WEAPON_BARBED_WIRE', 'WEAPON_ANIMAL', 'WEAPON_COUGAR',
    'WEAPON_HELI_CRASH', 'VEHICLE_WEAPON_ROTORS', 'WEAPON_VEHICLE_ROCKET', 'WEAPON_AIRSTRIKE_ROCKET',
    -- explosives / thrown (damage depends on blast, may be detonated remotely)
    'WEAPON_GRENADE', 'WEAPON_STICKYBOMB', 'WEAPON_PROXMINE', 'WEAPON_PIPEBOMB', 'WEAPON_MOLOTOV', 'WEAPON_RPG',
    'WEAPON_GRENADELAUNCHER', 'WEAPON_COMPACTLAUNCHER', 'WEAPON_FIREWORK', 'WEAPON_BZGAS', 'WEAPON_SMOKEGRENADE',
    'WEAPON_FLARE', 'WEAPON_PETROLCAN', 'WEAPON_SNOWBALL', 'WEAPON_BALL', 'WEAPON_HAZARDCAN', 'WEAPON_FERTILIZERCAN' })

-- Vehicle-mounted weapons are prefixed VEHICLE_WEAPON_ and have no held-weapon equivalent.
function Weapons.isEnvironmental(h)
    return Weapons.environmental[h] ~= nil
end

--- Resolve a list of names (from dashboard config) to an unsigned-hash set, cached per list instance.
local cache = setmetatable({}, { __mode = 'k' })
function Weapons.hashSet(list)
    if not list then return {} end
    local c = cache[list]
    if c then return c end
    c = {}
    for _, v in ipairs(list) do
        if type(v) == 'number' then c[Weapons.u32(v)] = tostring(v)
        else c[Weapons.u32(GetHashKey(v))] = v end
    end
    cache[list] = c
    return c
end

--- { WEAPON_NAME = value } → { [u32 hash] = value }, cached per table instance.
local mapCache = setmetatable({}, { __mode = 'k' })
function Weapons.hashMap(dict)
    if not dict then return {} end
    local c = mapCache[dict]
    if c then return c end
    c = {}
    for k, v in pairs(dict) do c[Weapons.u32(type(k) == 'number' and k or GetHashKey(k))] = v end
    mapCache[dict] = c
    return c
end

--- Same for model names (entity blocklist).
Weapons.modelSet = Weapons.hashSet
