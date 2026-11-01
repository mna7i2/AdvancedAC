-- Stage 3+4: detection engine + enforcement, end-to-end against the backend
dofile(HELPERS)
local S = TEST.serverId
print('\n== Stage 3/4: detections & enforcement (server ' .. S .. ') ==')

SIM.resources['qb-ambulancejob'] = 'started'   -- its trap event must NOT be armed
SIM.run(3000)
check(AC.State.handshaken, 'handshake completed')

local nextId = 10
local function player(name)
    nextId = nextId + 1
    local r = H.connect(nextId, name, H.ids(nextId))
    assert(r.done and not r.msg, 'connect failed for ' .. name)
    local src = nextId
    H.ped(src).coords = { x = 100.0 + nextId, y = 100.0, z = 30.0 }
    Grace.clear(src)                    -- skip spawn grace for tests
    SIM.run(4500)                       -- two telemetry samples
    return src, Sessions[src].sessionId
end
local function det(sid, key)
    return __sql("SELECT action_taken || '|' || verified || '|' || coalesce(action_note,'') FROM detections WHERE session_id=" .. sid ..
        " AND detection_key='" .. key .. "' ORDER BY id DESC LIMIT 1")
end
local function banned(sid, key)
    return H.sqlNum("SELECT count(*) FROM bans b JOIN player_sessions ps ON ps.player_id=b.player_id WHERE ps.id=" .. sid ..
        " AND b.detection_key='" .. key .. "' AND b.automatic") > 0
end
local function gone(src) return SIM.players[src] == nil end

-- ── Explosions ──────────────────────────────────────────────────────────
do
    local src, sid = player('Exploder')
    local c = H.ped(src).coords
    local canceled = SIM.fireSync('explosionEvent', src, src, { explosionType = 2, damageScale = 1.0, isInvisible = true, isAudible = true, posX = c.x, posY = c.y, posZ = c.z })
    check(canceled, 'invisible explosion cancelled before reaching other players')
    SIM.run(1500)
    check(det(sid, 'explosion_invisible'):find('^ban|t') ~= nil, 'invisible explosion → verified detection → BAN')
    check(banned(sid, 'explosion_invisible'), 'automatic ban stored with detection reference')
    check(gone(src), 'cheater dropped from server')
end
do
    local src, sid = player('Spammer')
    local c = H.ped(src).coords
    local lastCanceled
    for i = 1, 7 do
        lastCanceled = SIM.fireSync('explosionEvent', src, src, { explosionType = 7, damageScale = 1.0, isInvisible = false, isAudible = true, posX = c.x, posY = c.y, posZ = c.z })
    end
    check(lastCanceled, 'explosions over the rate limit are cancelled')
    SIM.run(1500)
    check(det(sid, 'explosion_spam'):find('^kick') ~= nil, 'explosion spam → KICK (configured action)')
    check(gone(src), 'spammer kicked')
end
do
    local src, sid = player('LegitBoom')
    local c = H.ped(src).coords
    local canceled = SIM.fireSync('explosionEvent', src, src, { explosionType = 2, damageScale = 1.0, isInvisible = false, isAudible = true, posX = c.x + 5, posY = c.y, posZ = c.z })
    SIM.run(1000)
    check(not canceled and det(sid, 'explosion_invisible') == '' and det(sid, 'explosion_spam') == '', 'normal sticky bomb explosion allowed, no detection')
end

-- ── Entities ────────────────────────────────────────────────────────────
do
    local src, sid = player('TankSpawner')
    local tank = SIM.newEntity('vehicle', { model = GetHashKey('rhino'), owner = src, popType = 7 })
    check(SIM.fireSync('entityCreating', src, tank.id), 'blocked model (rhino) creation cancelled')
    SIM.run(1500)
    check(det(sid, 'blocked_model'):find('^ban|t') ~= nil and gone(src), 'blocked model → BAN')
end
do
    local src, sid = player('CarSpammer')
    for i = 1, 5 do SIM.fireSync('entityCreating', src, SIM.newEntity('vehicle', { model = GetHashKey('adder'), owner = src, popType = 2 }).id) end
    SIM.run(300)
    check(det(sid, 'entity_spam') == '', 'ambient traffic (population type 2) is not counted')
    local c
    for i = 1, 9 do c = SIM.fireSync('entityCreating', src, SIM.newEntity('vehicle', { model = GetHashKey('adder'), owner = src, popType = 7 }).id) end
    check(c, 'script-spawned vehicles beyond limit cancelled')
    SIM.run(1500)
    check(det(sid, 'entity_spam'):find('^kick') ~= nil and gone(src), 'vehicle spam → KICK')
end

-- ── Movement (server telemetry) ─────────────────────────────────────────
do
    local src, sid = player('Speedy')
    local ped = H.ped(src)
    for i = 1, 4 do ped.coords = { x = ped.coords.x + 60, y = ped.coords.y, z = ped.coords.z }; SIM.run(2000) end
    SIM.run(1500)
    check(det(sid, 'speed_onfoot'):find('^kick|t') ~= nil and gone(src), 'on-foot speed hack (30 m/s sustained) → KICK')
end
do
    local src, sid = player('Runner')
    local ped = H.ped(src)
    for i = 1, 4 do ped.coords = { x = ped.coords.x + 14, y = ped.coords.y, z = ped.coords.z }; SIM.run(2000) end
    check(det(sid, 'speed_onfoot') == '', 'normal sprint (7 m/s) not flagged')
    for i = 1, 3 do ped.coords = { x = ped.coords.x, y = ped.coords.y, z = ped.coords.z - 60 }; SIM.run(2000) end
    check(det(sid, 'speed_onfoot') == '' and det(sid, 'fly_noclip') == '', 'falling not flagged')
end
do
    local src, sid = player('Flyer')
    local ped = H.ped(src)
    for i = 1, 3 do ped.coords = { x = ped.coords.x + 4, y = ped.coords.y, z = ped.coords.z + 15 }; SIM.run(2000) end
    SIM.run(1500)
    check(det(sid, 'fly_noclip'):find('^kick') ~= nil, 'noclip / fly (rising 7.5 m/s on foot) → KICK')
end
do
    local src, sid = player('Teleporter')
    local ped = H.ped(src)
    exports_AllowTeleport = SIM.exports.AllowTeleport
    exports_AllowTeleport(src, 5000)
    ped.coords = { x = ped.coords.x + 3000, y = ped.coords.y, z = ped.coords.z }
    SIM.run(2500)
    check(det(sid, 'teleport') == '', 'scripted teleport with exports.AllowTeleport not flagged')
    SIM.run(4000)
    ped.coords = { x = ped.coords.x - 2500, y = ped.coords.y, z = ped.coords.z }
    SIM.run(3500)
    check(det(sid, 'teleport'):find('^warn|t') ~= nil, 'unannounced 2.5km teleport → WARN (configured) ')
    check(not gone(src), 'warn does not remove the player')
end
do
    local src, sid = player('Racer')
    local ped = H.ped(src)
    local car = SIM.newEntity('vehicle', { model = GetHashKey('adder'), vtype = 'automobile', owner = src })
    car.seats[-1] = ped.id
    ped.vehicle = car.id
    car.velocity = { x = 150.0, y = 0.0, z = 0.0 }   -- 540 km/h
    for i = 1, 3 do ped.coords = { x = ped.coords.x + 300, y = ped.coords.y, z = ped.coords.z }; SIM.run(2000) end
    SIM.run(1500)
    check(det(sid, 'vehicle_speed'):find('^kick') ~= nil, 'vehicle speed hack (540 km/h) → KICK')
end

-- ── Player state ────────────────────────────────────────────────────────
do
    local src, sid = player('God')
    SIM.players[src].invincible = true
    SIM.run(8000)
    check(det(sid, 'godmode_flag'):find('^kick') ~= nil, 'server-side invincibility (3 samples) → KICK')
    check(H.sqlNum('SELECT count(*) FROM evidence e JOIN detections d ON d.id=e.detection_id WHERE d.session_id=' .. sid) == 1,
        'screenshot evidence captured BEFORE the kick and linked to the detection')
    check(gone(src), 'godmode player kicked after evidence')
end
do
    Config.SafeZones = { { coords = { x = 0.0, y = 0.0, z = 0.0 }, radius = 50.0 } }
    local src, sid = player('GreenZone')
    H.ped(src).coords = { x = 5.0, y = 5.0, z = 5.0 }
    SIM.run(2500)
    SIM.players[src].invincible = true
    SIM.run(8000)
    check(det(sid, 'godmode_flag') == '', 'invincible inside a configured safe zone not flagged')
    Config.SafeZones = {}
end
do
    local src, sid = player('StaffNoclip')
    SIM.players[src].aces['sentinel.bypass'] = true
    H.ped(src).visible = false
    SIM.run(8000)
    check(det(sid, 'invisible') == '', 'staff with sentinel.bypass ACE never flagged')
end
do
    local src, sid = player('Railgunner')
    H.ped(src).weapon = GetHashKey('WEAPON_RAILGUN')
    SIM.run(4500)
    check(det(sid, 'weapon_blacklist'):find('^ban') ~= nil and gone(src), 'blacklisted weapon (railgun) → BAN')
end
do
    local src, sid = player('Tank')
    H.ped(src).armor = 300
    SIM.run(6000)
    check(det(sid, 'armor_limit'):find('^kick') ~= nil, 'armour 300 > 100 → KICK')
end

-- ── Combat ──────────────────────────────────────────────────────────────
do
    local att, asid = player('OneTap')
    local vic = player('Victim1')
    H.ped(att).weapon = GetHashKey('WEAPON_PISTOL')
    local c = SIM.fireSync('weaponDamageEvent', att, att, { weaponType = GetHashKey('WEAPON_PISTOL') & 0xFFFFFFFF, weaponDamage = 900, hitGlobalId = H.ped(vic).id })
    check(c, 'damage 900 with a pistol cancelled')
    SIM.run(1500)
    check(det(asid, 'damage_modifier'):find('^kick') ~= nil, 'weapon damage modifier → KICK')
end
do
    local att, asid = player('FarShot')
    local vic = player('Victim2')
    H.ped(att).weapon = GetHashKey('WEAPON_PISTOL')
    H.ped(vic).coords = { x = H.ped(att).coords.x + 1000, y = 100.0, z = 30.0 }
    SIM.run(2500)
    local c = SIM.fireSync('weaponDamageEvent', att, att, { weaponType = GetHashKey('WEAPON_PISTOL') & 0xFFFFFFFF, weaponDamage = 30, hitGlobalId = H.ped(vic).id })
    check(c, 'pistol hit from 1 km cancelled')
    SIM.run(1500)
    check(det(asid, 'impossible_range'):find('^kick') ~= nil, 'impossible range → KICK')
end
do
    local att, asid = player('Sniper')
    local vic = player('Victim3')
    H.ped(att).weapon = GetHashKey('WEAPON_HEAVYSNIPER')
    H.ped(vic).coords = { x = H.ped(att).coords.x + 800, y = 100.0, z = 30.0 }
    SIM.run(2500)
    local c = SIM.fireSync('weaponDamageEvent', att, att, { weaponType = GetHashKey('WEAPON_HEAVYSNIPER') & 0xFFFFFFFF, weaponDamage = 216, hitGlobalId = H.ped(vic).id })
    SIM.run(1500)
    check(not c and det(asid, 'impossible_range') == '' and det(asid, 'damage_modifier') == '', 'legit heavy sniper hit at 800 m allowed')
end
do
    local tank, tsid = player('SemiGod')
    local att = player('Shooter')
    H.ped(att).weapon = GetHashKey('WEAPON_CARBINERIFLE')
    for i = 1, 6 do
        SIM.fireSync('weaponDamageEvent', att, att, { weaponType = GetHashKey('WEAPON_CARBINERIFLE') & 0xFFFFFFFF, weaponDamage = 32, hitGlobalId = H.ped(tank).id })
        SIM.run(1500)    -- health never drops
    end
    SIM.run(1500)
    check(det(tsid, 'semi_godmode'):find('^kick') ~= nil, 'semi-godmode (6 confirmed hits, health unchanged) → KICK victim')
end
do
    local src, sid = player('Giver')
    local other = player('Target')
    local c = SIM.fireSync('giveWeaponEvent', src, src, { pedId = H.ped(other).id, weaponType = GetHashKey('WEAPON_RPG') })
    check(c, 'giveWeaponEvent on another player cancelled')
    SIM.run(1500)
    check(det(sid, 'weapon_give_event'):find('^ban') ~= nil and gone(src), 'weapon give to other player → BAN')
end

-- ── Events ──────────────────────────────────────────────────────────────
do
    local src, sid = player('MenuUser')
    check(SIM.netEvents['qb-ambulancejob:server:RevivePlayer'] == nil, 'trap not armed when its owning resource is running')
    check(SIM.clientEvent(src, 'esx_ambulancejob:revive'), 'trap event armed (esx_ambulancejob not running)')
    SIM.run(1500)
    check(det(sid, 'honeypot_event'):find('^ban') ~= nil and gone(src), 'cheat menu triggering trap event → BAN')
end

-- ── Client signals (unverified) ─────────────────────────────────────────
do
    local src, sid = player('ClientSide')
    SIM.clientEvent(src, AC.Events.ClientReport, 'forged-token', 'freecam', {})
    SIM.run(1000)
    check(det(sid, 'freecam') == '', 'client report with a forged token ignored')
    SIM.clientEvent(src, AC.Events.ClientReport, Sessions[src].token, 'godmode_flag', {})
    SIM.run(1000)
    check(det(sid, 'godmode_flag') == '', 'client cannot report server-only detection keys')
    SIM.clientEvent(src, AC.Events.ClientReport, Sessions[src].token, 'freecam', { distance = 120 })
    SIM.run(1500)
    check(det(sid, 'freecam'):find('^warn|f') ~= nil, 'client freecam signal stored as UNVERIFIED warn')

    -- Admin misconfigures freecam to BAN → backend downgrades (never ban on client signal alone)
    __sql("INSERT INTO detection_overrides(org_id, detection_key, config) VALUES ('" .. TEST.orgId .. "','spectate','{\"action\":\"ban\"}') ON CONFLICT (org_id, detection_key) DO UPDATE SET config=EXCLUDED.config")
    __sql("UPDATE servers SET config_version=config_version+1 WHERE id='" .. S .. "'")
    __sleep(16)     -- direct SQL edit bypasses the dashboard's cache invalidation: wait out the 15s cache
    SIM.run(8000)
    check(AC.State.config.detections.spectate.action == 'ban', 'config change synced to the server without restart')
    SIM.clientEvent(src, AC.Events.ClientReport, Sessions[src].token, 'spectate', {})
    SIM.run(1500)
    local r = det(sid, 'spectate')
    check(r:find('kick|false|ban downgraded', 1, true) == 1, 'BAN on unverified signal downgraded to KICK (' .. r .. ')')
    check(not banned(sid, 'spectate'), 'no ban created from a client-only signal')
    __sql("DELETE FROM detection_overrides WHERE org_id='" .. TEST.orgId .. "' AND detection_key='spectate'")
end

-- ── Risk escalation ─────────────────────────────────────────────────────
do
    __sql("INSERT INTO detection_overrides(org_id, detection_key, config) VALUES ('" .. TEST.orgId .. "','teleport','{\"cooldown\":0}') ON CONFLICT (org_id, detection_key) DO UPDATE SET config=EXCLUDED.config")
    __sql("UPDATE servers SET config_version=config_version+1 WHERE id='" .. S .. "'")
    __sleep(16)
    SIM.run(8000)
    local src, sid = player('Repeat')
    local ped = H.ped(src)
    for i = 1, 3 do
        ped.coords = { x = ped.coords.x + 2000 * (i % 2 == 1 and 1 or -1), y = ped.coords.y, z = ped.coords.z }
        SIM.run(3500)
    end
    SIM.run(1500)
    local risk = tonumber(__sql('SELECT round(risk_after) FROM detections WHERE session_id=' .. sid .. ' ORDER BY id DESC LIMIT 1')) or 0
    check(risk >= 80, 'three verified teleports push risk to ' .. risk .. '/100')
    check(det(sid, 'teleport'):find('ban|true|risk escalation', 1, true) == 1, 'critical risk + verified evidence → automatic escalation BAN')
    __sql("DELETE FROM detection_overrides WHERE org_id='" .. TEST.orgId .. "' AND detection_key='teleport'")
end

-- ── Heartbeat watchdog ──────────────────────────────────────────────────
do
    local src, sid = player('Silent')
    Sessions[src].clientReady = true
    Sessions[src].lastBeat = GetGameTimer()
    SIM.run(70000)
    check(det(sid, 'ac_heartbeat'):find('^kick') ~= nil and gone(src), 'client AC stopped (no heartbeat 60s) → KICK')
end

-- ── In-game menu authorisation ──────────────────────────────────────────
do
    local nobody = player('NotStaff')
    local victim = player('MenuTarget')
    SIM.clientEvents = {}
    SIM.clientEvent(nobody, AC.Events.MenuAction, Sessions[nobody].token, { action = 'kick', target = victim, reason = 'x' })
    SIM.run(1000)
    check(SIM.players[victim] ~= nil, 'non-staff cannot kick through the menu event')
    local staff = player('Moderator')
    SIM.players[staff].aces['sentinel.admin'] = true
    SIM.clientEvent(staff, AC.Events.MenuAction, Sessions[staff].token, { action = 'open' })
    SIM.run(500)
    check(H.clientEventsFor(staff, AC.Events.MenuOpen) == 1, 'staff (ACE) can open /adv menu')
    SIM.clientEvent(staff, AC.Events.MenuAction, Sessions[staff].token, { action = 'kick', target = victim, reason = 'menu test' })
    SIM.run(4000)
    check(SIM.players[victim] == nil, 'staff kick through menu executed')
    check(H.sqlNum("SELECT count(*) FROM audit_log WHERE action='ingame.kick' AND details->>'reason'='menu test'") >= 1, 'menu kick written to the immutable audit log')
end

local integrity = __sql("SELECT count(*) FROM audit_log WHERE org_id='" .. TEST.orgId .. "'")
print('  (audit entries: ' .. integrity .. ')')
