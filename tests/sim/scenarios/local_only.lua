-- Resource installed without any backend (fresh server, no KVP config): protection must still work.
dofile(HELPERS)
print('\n== Local-only mode (no backend configured, first start) ==')
SIM.convars.sentinel_backend = nil
SIM.convars.sentinel_api_key = nil
SIM.kvp = {}
SIM.run(3000)
check(AC.State.config == Defaults, 'built-in defaults active on first start')
check(Detect.enabled('explosion_invisible') and Detect.enabled('speed_onfoot'), 'detections enabled without backend')
local r = H.connect(1, 'Cheater', H.ids(1))
check(r.done and r.msg == nil, 'players can join without backend')
Grace.clear(1)
local c = H.ped(1).coords
check(SIM.fireSync('explosionEvent', 1, 1, { explosionType = 2, damageScale = 1.0, isInvisible = true, isAudible = true, posX = c.x, posY = c.y, posZ = c.z }), 'invisible explosion cancelled')
SIM.run(1500)
check(H.dropped(1) ~= nil and H.dropped(1).reason:find('banned', 1, true) ~= nil, 'cheater banned locally')
local r2 = H.connect(1, 'Cheater', H.ids(1))
check(r2.msg ~= nil, 'local ban enforced on reconnect')
local r3 = H.connect(2, 'Runner', H.ids(2)); Grace.clear(2)
SIM.run(2500)
local ped = H.ped(2)
for i = 1, 4 do ped.coords = { x = ped.coords.x + 60, y = ped.coords.y, z = ped.coords.z }; SIM.run(2000) end
SIM.run(1000)
check(H.dropped(2) ~= nil, 'speed hack kicked locally')
local staff = 3
H.connect(staff, 'Admin', H.ids(3)); SIM.players[staff].aces['sentinel.admin'] = true
SIM.clientEvent(staff, AC.Events.MenuAction, Sessions[staff].token, { action = 'open' })
SIM.run(500)
check(H.clientEventsFor(staff, AC.Events.MenuOpen) == 1, '/adv menu works without backend')
