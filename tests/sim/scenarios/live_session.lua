-- Long-running live session for dashboard E2E tests: the real resource runs in (roughly) real time
-- with players moving around Los Santos, so the dashboard receives genuine heartbeats/telemetry.
dofile(HELPERS)
local MINUTES = tonumber(os.getenv and os.getenv('LIVE_MINUTES') or '') or 6
print('\n== Live session for ' .. MINUTES .. ' minutes (server ' .. TEST.serverId .. ') ==')
SIM.convars.sv_hostname = 'E2E Live Server'
SIM.run(3000)
check(AC.State.handshaken, 'handshake completed')

local names = { 'Hamad', 'Saeed', 'Rashid', 'Khalifa', 'Mansour', 'Omar' }
local route = {}
for i, n in ipairs(names) do
    local r = H.connect(i, n, H.ids(1000 + i))
    check(r.done and not r.msg, n .. ' joined')
    local ped = H.ped(i)
    ped.coords = { x = -800 + i * 260.0, y = -1200 + i * 180.0, z = 30.0 }
    -- angular speed chosen so on-foot players move 1.5–6 m/s (walk/jog/sprint); the driver ~25 m/s
    local r = 120 + i * 30
    route[i] = { a = math.random() * 6.28, r = r, cx = ped.coords.x, cy = ped.coords.y, speed = (i == 5 and 25 or (1.5 + i * 0.7)) / r }
    SIM.players[i].ping = 25 + i * 12
    ped.armor = (i % 2 == 0) and 50 or 0
    ped.weapon = GetHashKey(({ 'WEAPON_PISTOL', 'WEAPON_CARBINERIFLE', 'WEAPON_UNARMED', 'WEAPON_SMG', 'WEAPON_KNIFE', 'WEAPON_PUMPSHOTGUN' })[i])
    Grace.clear(i)
end
-- Mansour drives
local car = SIM.newEntity('vehicle', { model = GetHashKey('sultan'), vtype = 'automobile', owner = 5 })
car.seats[-1] = H.ped(5).id; H.ped(5).vehicle = car.id

local seconds = 0
local total = MINUTES * 60
local evented = false
while seconds < total do
    for i = 1, #names do
        if SIM.players[i] then
            local rt = route[i]
            rt.a = rt.a + rt.speed
            local ped = H.ped(i)
            ped.coords = { x = rt.cx + math.cos(rt.a) * rt.r, y = rt.cy + math.sin(rt.a) * rt.r, z = 30.0 }
            ped.heading = (math.deg(rt.a) + 180) % 360
            if i == 5 then car.velocity = { x = 25.0, y = 0.0, z = 0.0 } end
        end
    end
    -- One genuine cheat event part-way: Omar spawns an invisible explosion (→ ban), Rashid triggers explosion spam (→ kick).
    if not evented and seconds >= 75 then
        evented = true
        if not SIM.players[6] or not SIM.players[4] or not SIM.players[2] then goto continue end
        local c = H.ped(6).coords
        SIM.fireSync('explosionEvent', 6, 6, { explosionType = 2, damageScale = 1.0, isInvisible = true, isAudible = true, posX = c.x, posY = c.y, posZ = c.z })
        H.ped(4).weapon = GetHashKey('WEAPON_PISTOL')
        SIM.fireSync('weaponDamageEvent', 4, 4, { weaponType = GetHashKey('WEAPON_PISTOL') & 0xFFFFFFFF, weaponDamage = 600, hitGlobalId = H.ped(1).id })
        SIM.clientEvent(2, AC.Events.ClientReport, Sessions[2].token, 'freecam', { distance = 85.3 })
    end
    ::continue::
    SIM.run(1000)
    __sleep(1)
    seconds = seconds + 1
end
print('live session finished')
