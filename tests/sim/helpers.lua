-- Scenario helpers: player connect/join/drop flows as FXServer performs them.
H = {}

math.randomseed(os.time())
H.run = math.random(1, 2^40)   -- unique identities per test run (bans are org-wide and persistent)

function H.ids(n)
    n = n + H.run
    return { 'license:' .. string.format('%040x', n), 'license2:' .. string.format('%040x', n + 7),
             'discord:' .. (100000000000000000 + n), 'fivem:' .. (500000 + n), 'ip:10.0.0.' .. (n % 250) }
end

--- Full connect: deferrals on temp id, then playerJoining on the real id. Returns deferral result.
function H.connect(src, name, ids, tokens)
    local temp = 65535 + src
    local p = SIM.addPlayer(temp, name, ids, tokens or { '3:' .. string.rep('ab', 32) .. (src + H.run) })
    local res = { done = false }
    local deferrals = {
        defer = function() end, update = function(m) res.update = m end,
        done = function(m) res.done = true; res.msg = m end, presentCard = function() end,
    }
    source = temp
    TriggerEvent('playerConnecting', name, function() end, deferrals)
    SIM.run(1500)
    if res.done and res.msg == nil then
        SIM.players[temp] = nil
        p.src = src
        SIM.players[src] = p
        local ped = SIM.entities[p.ped]
        ped.owner = src
        source = src
        TriggerEvent('playerJoining', tostring(temp))
        SIM.run(500)
    else
        SIM.players[temp] = nil
    end
    return res
end

function H.drop(src, reason)
    DropPlayer(src, reason or 'Exiting')
    SIM.run(500)
end

function H.ped(src) return SIM.entities[SIM.players[src].ped] end

function H.dropped(src)
    for _, d in ipairs(SIM.dropped) do if d.src == src then return d end end
    return nil
end

function H.sqlNum(q) return tonumber(__sql(q)) or 0 end

function H.clientEventsFor(src, name)
    local n = 0
    for _, e in ipairs(SIM.clientEvents) do if e.target == src and e.name == name then n = n + 1 end end
    return n
end
