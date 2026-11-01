-- Network-event detections. These run on OneSync game events that the SERVER receives from a
-- client, so the signal is authoritative: the sender really did try to create that explosion,
-- entity, damage event, etc. Malicious events are cancelled before they reach other players.

local windows = {}          -- sliding windows: [category .. src] = { timestamps }
local function hits(cat, src, windowMs)
    return Utils.windowHit(windows, cat .. ':' .. src, GetGameTimer(), windowMs)
end

local function isPlayer(src) return src and Sessions[src] ~= nil end

---------------------------------------------------------------------------------------------------
-- Explosions
---------------------------------------------------------------------------------------------------
AddEventHandler('explosionEvent', function(sender, ev)
    local src = tonumber(sender)
    if not isPlayer(src) then return end
    local etype = ev.explosionType
    local cancel = false

    if ev.isInvisible and Detect.enabled('explosion_invisible') then
        cancel = true
        Detect.report(src, 'explosion_invisible', { type = etype, audible = ev.isAudible, scale = ev.damageScale })
    end

    local maxScale = Detect.threshold('explosion_damage_scale', 'maxScale', 1.0)
    if Detect.enabled('explosion_damage_scale') and (ev.damageScale or 0) > maxScale + 0.001 then
        cancel = true
        Detect.report(src, 'explosion_damage_scale', { type = etype, scale = ev.damageScale, limit = maxScale })
    end

    if Detect.enabled('explosion_blocked_type') then
        for _, t in ipairs(Detect.threshold('explosion_blocked_type', 'types', {})) do
            if t == etype then
                cancel = true
                Detect.report(src, 'explosion_blocked_type', { type = etype })
                break
            end
        end
    end

    if Detect.enabled('explosion_spam') then
        local n = hits('expl', src, Detect.threshold('explosion_spam', 'windowSec', 5) * 1000)
        if n > Detect.threshold('explosion_spam', 'count', 6) then
            cancel = true
            Detect.report(src, 'explosion_spam', { count = n, windowSec = Detect.threshold('explosion_spam', 'windowSec', 5), type = etype })
        end
    end

    if Detect.enabled('explosion_distance') and ev.posX then
        local st = Telemetry.get(src)
        if st then
            local d = Utils.dist(st, { x = ev.posX, y = ev.posY, z = ev.posZ })
            local max = Detect.threshold('explosion_distance', 'maxDistance', 400)
            if d > max then
                cancel = true
                Detect.report(src, 'explosion_distance', { type = etype, distance = Utils.round(d, 1), limit = max })
            end
        end
    end

    Telemetry.event(src, 'explosion', { type = etype, x = ev.posX, y = ev.posY, z = ev.posZ, cancelled = cancel })
    if cancel then CancelEvent() end
end)

---------------------------------------------------------------------------------------------------
-- Entity creation (client-created networked entities)
---------------------------------------------------------------------------------------------------
local ENTITY_KIND = { [1] = 'peds', [2] = 'vehicles', [3] = 'objects' }

AddEventHandler('entityCreating', function(entity)
    local owner = NetworkGetEntityOwner(entity)
    if not isPlayer(owner) then return end
    local model = GetEntityModel(entity)

    if Detect.enabled('blocked_model') then
        local blocked = Weapons.modelSet(Detect.threshold('blocked_model', 'models', {}))
        local name = blocked[Weapons.u32(model)]
        if name and not Detect.bypassed(owner, 'blocked_model') then
            CancelEvent()
            Detect.report(owner, 'blocked_model', { model = name, entityType = ENTITY_KIND[GetEntityType(entity)] or 'unknown' })
            return
        end
    end

    -- Only script/mission entities (population type 7) count toward spam; ambient traffic is excluded.
    if Detect.enabled('entity_spam') and GetEntityPopulationType(entity) == 7 then
        local kind = ENTITY_KIND[GetEntityType(entity)]
        if kind then
            local window = Detect.threshold('entity_spam', 'windowSec', 10) * 1000
            local limit = Detect.threshold('entity_spam', kind, 20)
            local n = hits('ent_' .. kind, owner, window)
            if n > limit and not Detect.bypassed(owner, 'entity_spam') then
                CancelEvent()
                Detect.report(owner, 'entity_spam', { kind = kind, count = n, limit = limit, model = model })
            end
        end
    end
end)

---------------------------------------------------------------------------------------------------
-- Weapon damage validation
---------------------------------------------------------------------------------------------------
local mismatch = {}
local semiGod = {}   -- [victimSrc] = { timestamps of unabsorbed hits }

local function playerOfPed(ped)
    for src in pairs(Sessions) do
        if GetPlayerPed(src) == ped then return src end
    end
    return nil
end

--- Semi-godmode: a confirmed hit that should hurt, but the victim's health+armour never drops.
local function trackVictim(victimSrc, damage, attackerSrc)
    if not Detect.enabled('semi_godmode') then return end
    if damage < Detect.threshold('semi_godmode', 'minDamage', 10) then return end
    local before = Telemetry.get(victimSrc)
    local ped = GetPlayerPed(victimSrc)
    local hp0, ar0 = GetEntityHealth(ped), GetPedArmour(ped)
    if before and StateChecks.inSafeZone(before) then return end
    SetTimeout(1200, function()
        if not Sessions[victimSrc] or Grace.active(victimSrc, 'health') or Grace.active(victimSrc, 'godmode') then return end
        local p = GetPlayerPed(victimSrc)
        if not DoesEntityExist(p) then return end
        local hp1, ar1 = GetEntityHealth(p), GetPedArmour(p)
        if hp1 <= 100 then return end                      -- went down: damage applied
        if hp1 + ar1 < hp0 + ar0 then return end           -- took damage
        local window = Detect.threshold('semi_godmode', 'windowSec', 20) * 1000
        local n = Utils.windowHit(semiGod, victimSrc, GetGameTimer(), window)
        if n >= Detect.threshold('semi_godmode', 'hits', 5) then
            semiGod[victimSrc] = nil
            Detect.report(victimSrc, 'semi_godmode', { unabsorbedHits = n, health = hp1, armor = ar1, lastAttacker = attackerSrc })
        end
    end)
end

AddEventHandler('weaponDamageEvent', function(sender, data)
    local src = tonumber(sender)
    if not isPlayer(src) then return end
    local weapon = Weapons.u32(data.weaponType)
    local damage = data.weaponDamage or 0
    local env = Weapons.isEnvironmental(weapon)
    local attackerSt = Telemetry.get(src)
    local victimEntity = data.hitGlobalId and NetworkGetEntityFromNetworkId(data.hitGlobalId) or 0
    local victimSrc = (victimEntity ~= 0 and IsPedAPlayer(victimEntity)) and playerOfPed(victimEntity) or nil
    local cancel = false

    if not env then
        -- Damage modifier
        if Detect.enabled('damage_modifier') then
            local caps = Weapons.hashMap(Detect.threshold('damage_modifier', 'perWeapon', {}))
            local cap = caps[weapon] or Detect.threshold('damage_modifier', 'defaultMax', 250)
            if damage > cap then
                cancel = true
                Detect.report(src, 'damage_modifier', { damage = damage, cap = cap, weapon = weapon, victim = victimSrc })
            end
        end

        -- Rapid fire (pellet weapons excluded)
        if Detect.enabled('rapid_fire') and not Weapons.multiHit[weapon] then
            local n = hits('dmg', src, 1000)
            local max = Detect.threshold('rapid_fire', 'maxPerSecond', 16)
            if n > max then
                cancel = true
                Detect.report(src, 'rapid_fire', { perSecond = n, limit = max, weapon = weapon })
            end
        end

        -- Range: shooter → victim distance
        if Detect.enabled('impossible_range') and attackerSt and victimEntity ~= 0 and DoesEntityExist(victimEntity) then
            local vc = GetEntityCoords(victimEntity)
            local d = Utils.dist(attackerSt, vc)
            local max = Weapons.snipers[weapon] and Detect.threshold('impossible_range', 'sniperMaxDistance', 1200)
                or Detect.threshold('impossible_range', 'maxDistance', 350)
            if d > max then
                cancel = true
                Detect.report(src, 'impossible_range', { distance = Utils.round(d, 1), limit = max, weapon = weapon, victim = victimSrc })
            end
        end

        -- Weapon mismatch: damage with a weapon the attacker is not holding (on foot only).
        if Detect.enabled('weapon_mismatch') and attackerSt and attackerSt.vm == 0 then
            local held = Weapons.u32(GetSelectedPedWeapon(GetPlayerPed(src)))
            if held ~= weapon and weapon ~= Weapons.UNARMED and held ~= 0 then
                local window = Detect.threshold('weapon_mismatch', 'windowSec', 30) * 1000
                local n = Utils.windowHit(mismatch, src, GetGameTimer(), window)
                if n >= Detect.threshold('weapon_mismatch', 'count', 3) then
                    mismatch[src] = nil
                    Detect.report(src, 'weapon_mismatch', { reported = weapon, held = held, count = n })
                end
            end
        end
    end

    Telemetry.event(src, 'damage', { victim = victimSrc, weapon = weapon, damage = damage, kill = data.willKill or false, cancelled = cancel })
    if cancel then
        CancelEvent()
    elseif victimSrc and victimSrc ~= src then
        trackVictim(victimSrc, damage, src)
    end
end)

---------------------------------------------------------------------------------------------------
-- Weapon give/remove on other players, task clearing, particle & projectile spam
---------------------------------------------------------------------------------------------------
local function targetIsOtherPlayer(src, netId)
    if not netId then return false end
    local ent = NetworkGetEntityFromNetworkId(netId)
    return ent ~= 0 and IsPedAPlayer(ent) and ent ~= GetPlayerPed(src), ent
end

local function weaponAbuse(eventName)
    return function(sender, data)
        local src = tonumber(sender)
        if not isPlayer(src) then return end
        local other = targetIsOtherPlayer(src, data.pedId)
        if other then
            CancelEvent()
            Detect.report(src, 'weapon_give_event', { event = eventName, weapon = data.weaponType, target = playerOfPed(NetworkGetEntityFromNetworkId(data.pedId)) })
        end
    end
end
AddEventHandler('giveWeaponEvent', weaponAbuse('giveWeaponEvent'))
AddEventHandler('removeWeaponEvent', weaponAbuse('removeWeaponEvent'))
AddEventHandler('removeAllWeaponsEvent', weaponAbuse('removeAllWeaponsEvent'))

AddEventHandler('clearPedTasksEvent', function(sender, data)
    local src = tonumber(sender)
    if not isPlayer(src) or not Detect.enabled('clear_ped_tasks') then return end
    local other, ent = targetIsOtherPlayer(src, data.pedId)
    if other then
        if Detect.threshold('clear_ped_tasks', 'cancel', true) then CancelEvent() end
        Detect.report(src, 'clear_ped_tasks', { target = playerOfPed(ent), immediately = data.immediately or false })
    end
end)

local function rateLimited(key, cat)
    return function(sender)
        local src = tonumber(sender)
        if not isPlayer(src) or not Detect.enabled(key) then return end
        local window = Detect.threshold(key, 'windowSec', 5) * 1000
        local n = hits(cat, src, window)
        if n > Detect.threshold(key, 'count', 10) then
            CancelEvent()
            Detect.report(src, key, { count = n, windowSec = window // 1000 })
        end
    end
end
AddEventHandler('ptFxEvent', rateLimited('ptfx_spam', 'ptfx'))
AddEventHandler('startProjectileEvent', rateLimited('projectile_spam', 'proj'))

---------------------------------------------------------------------------------------------------
-- Honeypot (trap) events: names exploited by cheat menus that no resource on THIS server uses.
-- A trap is only armed when the resource that legitimately owns the event is not running.
---------------------------------------------------------------------------------------------------
local armed = {}

Honeypots = {}

function Honeypots.arm()
    if not Detect.enabled('honeypot_event') then return end
    for _, h in ipairs(Detect.threshold('honeypot_event', 'events', {})) do
        local name = type(h) == 'table' and h.name or h
        local owner = type(h) == 'table' and h.unlessResource or nil
        local state = owner and GetResourceState(owner) or 'missing'
        local ownerRunning = state == 'started' or state == 'starting'
        if name and not armed[name] and not ownerRunning then
            armed[name] = true
            RegisterNetEvent(name, function(...)
                local src = tonumber(source)
                if not isPlayer(src) or not armed[name] then return end
                Detect.report(src, 'honeypot_event', { event = name, args = select('#', ...) })
            end)
        end
    end
end

-- A trap is disarmed if its owning resource starts later.
AddEventHandler('onResourceStart', function(res)
    for _, h in ipairs(Detect.threshold('honeypot_event', 'events', {})) do
        if type(h) == 'table' and h.unlessResource == res and armed[h.name] then armed[h.name] = false end
    end
end)

---------------------------------------------------------------------------------------------------
-- Client reports (unverified signals). Token-checked and rate-limited; only whitelisted keys.
---------------------------------------------------------------------------------------------------
local reportWin = {}
RegisterNetEvent(AC.Events.ClientReport, function(token, key, details)
    local src = tonumber(source)
    local s = Sessions[src]
    if not s or token ~= s.token then return end
    if type(key) ~= 'string' or not AC.ClientDetections[key] then return end
    if Utils.windowHit(reportWin, src, GetGameTimer(), 60000) > 20 then return end
    if type(details) ~= 'table' then details = {} end
    -- Never trust spectating staff / scripted states the server knows about
    if key == 'spectate' and (s.spectating or Admin.can(src, 'players.spectate')) then return end
    if key == 'freecam' and s.spectating then return end
    -- A resource that is also stopped/restarting on the server was stopped legitimately.
    if key == 'client_resource_stop' then
        local res = type(details.resource) == 'string' and details.resource or ''
        if GetResourceState(res) ~= 'started' then return end
        local wl = Detect.config(key) and Detect.config(key).whitelist and Detect.config(key).whitelist.resources
        if wl and Utils.toSet(wl)[res] then return end
    end
    if key == 'unknown_client_resource' then
        local wl = Detect.config(key) and Detect.config(key).whitelist and Detect.config(key).whitelist.resources
        if wl and Utils.toSet(wl)[tostring(details.resource)] then return end
    end
    Detect.report(src, key, details)
end)

---------------------------------------------------------------------------------------------------
-- EventGuard bridge: resources that include @AdvancedAC/shared/eventguard.lua report here.
-- Exports are server-local and cannot be called by clients.
---------------------------------------------------------------------------------------------------
exports('GuardConfig', function()
    local c = Detect.config('event_spam')
    return {
        enabled = c and c.enabled or false,
        perSecond = Detect.threshold('event_spam', 'perSecond', 40),
        perEventPerSecond = Detect.threshold('event_spam', 'perEventPerSecond', 15),
    }
end)

local GUARD_KEYS = { event_spam = true, event_serveronly = true, event_invalid_args = true }
exports('GuardReport', function(src, key, details)
    src = tonumber(src)
    if not GUARD_KEYS[key] or not isPlayer(src) then return end
    Detect.report(src, key, details)
end)

-- Clean per-player state
AddEventHandler('playerDropped', function()
    local src = source
    semiGod[src] = nil
    mismatch[src] = nil
    reportWin[src] = nil
    for k in pairs(windows) do
        if k:sub(-(#tostring(src) + 1)) == ':' .. src then windows[k] = nil end
    end
    StateChecks.forget(src)
end)
