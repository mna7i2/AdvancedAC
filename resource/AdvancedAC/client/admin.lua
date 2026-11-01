-- In-game admin menu (NUI). The client only relays clicks: every action is authorised and
-- executed by the server (server/admin.lua). Opening the menu without permission does nothing.
local open = false

local function setOpen(v)
    open = v
    SetNuiFocus(v, v)
    SendNUIMessage({ type = v and 'open' or 'close' })
end

RegisterCommand(Config.MenuCommand, function()
    if not ACClient.token then return end
    TriggerServerEvent(AC.Events.MenuAction, ACClient.token, { action = 'open' })
end, false)
RegisterKeyMapping(Config.MenuCommand, 'Sentinel AC admin menu', 'keyboard', Config.MenuKey)

RegisterNetEvent(AC.Events.MenuOpen, function(data)
    SendNUIMessage({ type = 'data', data = data })
    if not open then setOpen(true) end
end)

RegisterNetEvent(AC.Events.MenuData, function(data)
    SendNUIMessage({ type = 'data', data = data })
end)

RegisterNUICallback('close', function(_, cb)
    setOpen(false)
    cb({ ok = true })
end)

-- Generic action relay: { action, target, reason, hours, banId, ... }
RegisterNUICallback('action', function(body, cb)
    if type(body) == 'table' and type(body.action) == 'string' then
        if body.action == 'spectate' then setOpen(false) end
        TriggerServerEvent(AC.Events.MenuAction, ACClient.token, body)
    end
    cb({ ok = true })
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and open then SetNuiFocus(false, false) end
end)
