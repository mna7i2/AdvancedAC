-- Client core: session token handshake, heartbeat, and server → client effect events.
ACClient = { token = nil, config = nil, spectating = false }

function ACClient.report(key, details)
    if not ACClient.token then return end
    TriggerServerEvent(AC.Events.ClientReport, ACClient.token, key, details or {})
end

function ACClient.cfg(key)
    local d = ACClient.config and ACClient.config.detections and ACClient.config.detections[key]
    if not d or not d.enabled then return nil end
    return d.threshold or {}
end

RegisterNetEvent(AC.Events.Init, function(data)
    ACClient.token = data.token
    ACClient.config = data.config
end)

-- Handshake: retry until the server answers (it may still be registering the session).
CreateThread(function()
    while not NetworkIsPlayerActive(PlayerId()) do Wait(500) end
    while not ACClient.token do
        TriggerServerEvent(AC.Events.ClientReady)
        Wait(5000)
    end
end)

-- Heartbeat
CreateThread(function()
    while true do
        local ms = (ACClient.config and ACClient.config.beatMs) or 15000
        Wait(ms)
        if ACClient.token then TriggerServerEvent(AC.Events.ClientBeat, ACClient.token) end
    end
end)

---------------------------------------------------------------------------------------------------
-- Effects requested by the server (staff actions)
---------------------------------------------------------------------------------------------------
RegisterNetEvent(AC.Events.Heal, function()
    local ped = PlayerPedId()
    if IsEntityDead(ped) then
        local c = GetEntityCoords(ped)
        NetworkResurrectLocalPlayer(c.x, c.y, c.z, GetEntityHeading(ped), true, false)
        ped = PlayerPedId()
    end
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
end)

RegisterNetEvent(AC.Events.Freeze, function(state)
    local ped = PlayerPedId()
    FreezeEntityPosition(ped, state == true)
    local veh = GetVehiclePedIsIn(ped, false)
    if veh ~= 0 then FreezeEntityPosition(veh, state == true) end
end)

RegisterNetEvent(AC.Events.Notify, function(n)
    SendNUIMessage({ type = 'toast', toast = n })
end)

RegisterNetEvent(AC.Events.Announce, function(a)
    SendNUIMessage({ type = 'announce', title = a.title, text = a.text })
    PlaySoundFrontend(-1, 'CHECKPOINT_PERFECT', 'HUD_MINI_GAME_SOUNDSET', true)
end)

RegisterNetEvent(AC.Events.AdminAlert, function(a)
    SendNUIMessage({ type = 'alert', text = a.text, data = a.data })
end)
