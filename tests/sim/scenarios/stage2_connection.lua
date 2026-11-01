-- Stage 2: resource ↔ backend ↔ database connection
dofile(HELPERS)
local S = TEST.serverId
print('\n== Stage 2: connection scenario (server ' .. S .. ') ==')

-- 1. Boot + handshake
SIM.run(3000)
check(AC.State.handshaken, 'handshake completed')
check(__sql("SELECT status FROM servers WHERE id='" .. S .. "'") == 'online', 'server marked online in DB')
check(__sql("SELECT fingerprint FROM servers WHERE id='" .. S .. "'"):find('users.cfx.re') ~= nil, 'server fingerprint bound on first handshake')
check(AC.State.config and AC.State.config.detections and AC.State.config.detections.godmode_flag ~= nil, 'detection config received from backend')
check(SIM.kvp['sentinel:config:v1'] ~= nil, 'config cached in KVP for offline start')

-- 2. Player connects and joins
local r = H.connect(1, 'Hamad', H.ids(1))
check(r.done and r.msg == nil, 'player allowed through deferrals')
check(Sessions[1] and Sessions[1].sessionId ~= nil, 'session id assigned by backend')
local sid = Sessions[1].sessionId
SIM.run(500)
check(__sql('SELECT net_id FROM player_sessions WHERE id=' .. sid) == '1', 'session net_id updated on join')
check(H.sqlNum("SELECT count(*) FROM player_identifiers pi JOIN players p ON p.id=pi.player_id WHERE p.license='license:" .. H.ids(1)[1]:sub(9) .. "'") >= 6,
    'identifiers stored (license, license2, discord, fivem, ip-hash, token-hash)')
check(__sql("SELECT count(*) FROM player_identifiers WHERE kind='ip' AND value LIKE '10.0.0.%'") == '0', 'IP never stored in clear')

-- 3. Telemetry + heartbeat
local ped = H.ped(1)
ped.coords = { x = 200.0, y = -900.0, z = 30.0 }
SIM.run(8000)
check(H.sqlNum('SELECT count(*) FROM telemetry WHERE session_id=' .. sid) >= 2, 'telemetry samples stored for replay')
check(__sql("SELECT player_count FROM servers WHERE id='" .. S .. "'") == '1', 'player count reported by heartbeat')
check(__sql("SELECT (last_state->>'x')::int FROM player_sessions WHERE id=" .. sid) == '200', 'live player state stored (x=200)')
check(H.sqlNum("SELECT count(*) FROM server_stats WHERE server_id='" .. S .. "'") >= 1, 'per-minute player stats recorded')
check(H.sqlNum("SELECT count(*) FROM console_lines WHERE server_id='" .. S .. "'") >= 1, 'server console streamed to backend')

-- 4. Dashboard command → game → ack
__sql("INSERT INTO commands(server_id, kind, payload, created_by_name) VALUES ('" .. S .. "','freeze','{\"netId\":1,\"sessionId\":" .. sid .. "}','test')")
SIM.run(7000)
check(ped.frozen == true, 'freeze command executed in game')
check(__sql("SELECT status FROM commands WHERE server_id='" .. S .. "' AND kind='freeze'") == 'done', 'command acknowledged as done')
__sql("INSERT INTO commands(server_id, kind, payload, created_by_name) VALUES ('" .. S .. "','screenshot','{\"netId\":1,\"sessionId\":" .. sid .. "}','test')")
SIM.run(8000)
check(H.sqlNum("SELECT count(*) FROM evidence WHERE player_id=(SELECT player_id FROM player_sessions WHERE id=" .. sid .. ")") == 1, 'screenshot uploaded as evidence')
check(__sql("SELECT result->>'evidenceId' FROM commands WHERE server_id='" .. S .. "' AND kind='screenshot'") ~= '', 'screenshot command acked with evidence id')
__sql("INSERT INTO commands(server_id, kind, payload, created_by_name) VALUES ('" .. S .. "','kick','{\"netId\":1,\"sessionId\":999999}','test')")
SIM.run(7000)
check(__sql("SELECT status FROM commands WHERE server_id='" .. S .. "' AND kind='kick'") == 'failed', 'command with stale session id refused')
check(SIM.players[1] ~= nil, 'player not kicked by stale command')

-- 5. In-game ban via agent API → ban_kick on next heartbeat → reconnect refused
local st, body = __http('POST', TEST.backend .. '/api/v1/agent/admin/ban',
    json.encode({ admin = { name = 'Admin', identifiers = { 'license:admin' }, via = 'ace' }, sessionId = sid, reason = 'Test ban', durationHours = 0 }),
    json.encode({ ['Content-Type'] = 'application/json', Authorization = 'Bearer ' .. TEST.apiKey, ['X-SAC-Fingerprint'] = SIM.convars.web_baseUrl }))
check(st == 200, 'ban created via agent API')
local banId = json.decode(body).banId
SIM.run(7000)
check(H.dropped(1) ~= nil and H.dropped(1).reason:find(banId, 1, true) ~= nil, 'banned player dropped with ban id in message')
check(__sql('SELECT end_reason IS NOT NULL FROM player_sessions WHERE id=' .. sid) == 't', 'session closed on drop')
check(Store.banCount() >= 1, 'local ban cache updated')
local r2 = H.connect(1, 'Hamad', H.ids(1))
check(r2.done and r2.msg and r2.msg:find(banId, 1, true) ~= nil, 'banned player refused at connect')

-- 6. Hardware-token-only match → allowed (review), never auto-banned
local r3 = H.connect(2, 'AltAccount', H.ids(2), { '3:' .. string.rep('ab', 32) .. (1 + H.run) })
check(r3.done and r3.msg == nil, 'token-only match allowed (flagged for review, not banned)')
check(H.sqlNum("SELECT count(*) FROM activity WHERE kind='ban_evasion_suspect' AND server_id='" .. S .. "'") == 1, 'ban-evasion suspect alert recorded')

-- 7. Backend outage → offline mode: local ban cache still blocks, new players still join
__backend_up(false)
SIM.run(15000)
check(Api.online == false, 'resource detected backend outage')
local r4 = H.connect(1, 'Hamad', H.ids(1))
check(r4.msg and r4.msg:find(banId, 1, true) ~= nil, 'ban enforced from local cache while backend is down')
local r5 = H.connect(3, 'NewGuy', H.ids(3))
check(r5.done and r5.msg == nil and Sessions[3] and Sessions[3].sessionId == nil, 'new player allowed offline without session')

-- 8. Backend back → offline player registered, queued items flushed
__backend_up(true)
SIM.run(12000)
check(Api.online == true, 'resource reconnected to backend')
check(Sessions[3] and Sessions[3].sessionId ~= nil, 'offline-joined player registered after recovery')

-- 9. Revoke license → resource rejected within 60s cache window
__sql("UPDATE licenses SET status='suspended' WHERE org_id='" .. TEST.orgId .. "'")
__sleep(61)          -- backend caches license validity for 60 real seconds
SIM.run(8000)
check(Api.licensed == false, 'suspended license rejected by backend')
__sql("UPDATE licenses SET status='active' WHERE org_id='" .. TEST.orgId .. "'")
__sleep(61)
SIM.run(8000)
check(Api.licensed == true, 'reactivated license accepted again without restart')

-- 10. Resource stop → server offline + sessions closed
H.drop(2)
TriggerEvent('onResourceStop', 'AdvancedAC')
SIM.run(1000)
check(__sql("SELECT status FROM servers WHERE id='" .. S .. "'") == 'offline' or Api.licensed == false, 'shutdown marks server offline')
