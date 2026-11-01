-- Staff spectate. The server authorises it, moves the admin into the target's scope (OneSync
-- culling) and grants a grace window; the client hides the admin ped and attaches the camera.
local saved = nil

local function stopSpectate()
    if not ACClient.spectating then return end
    local ped = PlayerPedId()
    NetworkSetInSpectatorMode(false, ped)
    if saved then
        SetEntityCoords(ped, saved.x, saved.y, saved.z, false, false, false, false)
        SetEntityHeading(ped, saved.h)
    end
    FreezeEntityPosition(ped, false)
    SetEntityCollision(ped, true, true)
    SetEntityVisible(ped, true, false)
    SetEntityInvincible(ped, false)
    ACClient.spectating = false
    saved = nil
    SendNUIMessage({ type = 'spectate', active = false })
end

RegisterNetEvent(AC.Events.Spectate, function(data)
    if not data or not data.on then
        stopSpectate()
        TriggerServerEvent(AC.Events.MenuAction, ACClient.token, { action = 'spectate_stopped' })
        return
    end
    local ped = PlayerPedId()
    if not ACClient.spectating then
        local c = GetEntityCoords(ped)
        saved = { x = c.x, y = c.y, z = c.z, h = GetEntityHeading(ped) }
    end
    ACClient.spectating = true
    SetEntityVisible(ped, false, false)
    SetEntityCollision(ped, false, false)
    SetEntityInvincible(ped, true)
    FreezeEntityPosition(ped, true)
    SetEntityCoords(ped, data.coords.x, data.coords.y, data.coords.z - 25.0, false, false, false, false)

    CreateThread(function()
        local player = -1
        local t0 = GetGameTimer()
        while GetGameTimer() - t0 < 6000 do
            player = GetPlayerFromServerId(data.target)
            if player ~= -1 and NetworkIsPlayerActive(player) then break end
            Wait(200)
        end
        if player == -1 then
            stopSpectate()
            SendNUIMessage({ type = 'toast', toast = { type = 'error', text = 'Target not in range / not streamed' } })
            return
        end
        local target = GetPlayerPed(player)
        NetworkSetInSpectatorMode(true, target)
        SendNUIMessage({ type = 'spectate', active = true, name = data.name, id = data.target })
        -- Follow the target so it stays within our scope.
        while ACClient.spectating do
            if not NetworkIsPlayerActive(player) then break end
            local tc = GetEntityCoords(GetPlayerPed(player))
            SetEntityCoords(PlayerPedId(), tc.x, tc.y, tc.z - 25.0, false, false, false, false)
            Wait(1000)
        end
        if ACClient.spectating then
            stopSpectate()
            TriggerServerEvent(AC.Events.MenuAction, ACClient.token, { action = 'spectate_stopped' })
        end
    end)
end)

-- Backspace leaves spectate
CreateThread(function()
    while true do
        if ACClient.spectating then
            Wait(0)
            if IsControlJustPressed(0, 177) then
                stopSpectate()
                TriggerServerEvent(AC.Events.MenuAction, ACClient.token, { action = 'spectate_stopped' })
            end
        else
            Wait(500)
        end
    end
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() then stopSpectate() end
end)
