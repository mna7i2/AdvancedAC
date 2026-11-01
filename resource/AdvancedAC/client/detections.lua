-- Client-side signals. These are NOT trusted by the server: they are reported as unverified and
-- can never cause an automatic ban on their own. Each check needs several consecutive positives.
-- Cost: one 1s loop (plus a 100ms sampler that only runs while the player is mid-jump).

local streak = {}
local function bump(key, positive)
    streak[key] = positive and (streak[key] or 0) + 1 or 0
    return streak[key]
end

local reportedResources = {}

local function serverResources()
    return Utils.toSet(ACClient.config and ACClient.config.resources)
end

-- Super jump: sample the apex of each jump.
local jumping = false
local function trackJump(ped, th)
    if jumping then return end
    jumping = true
    CreateThread(function()
        local start = GetEntityCoords(ped).z
        local apex = start
        local t0 = GetGameTimer()
        while IsPedJumping(ped) and GetGameTimer() - t0 < 4000 do
            local z = GetEntityCoords(ped).z
            if z > apex then apex = z end
            Wait(100)
        end
        local height = apex - start
        if height > (th.height or 3.5) and not IsPedInParachuteFreeFall(ped) then
            ACClient.report('super_jump', { height = Utils.round(height, 2) })
        end
        jumping = false
    end)
end

CreateThread(function()
    while not ACClient.token do Wait(1000) end
    while true do
        Wait(1000)
        local ped = PlayerPedId()
        local pid = PlayerId()
        local onFoot = not IsPedInAnyVehicle(ped, false)
        local alive = not IsEntityDead(ped)
        local th

        th = ACClient.cfg('no_ragdoll')
        if th and alive and onFoot then
            if bump('no_ragdoll', not CanPedRagdoll(ped)) >= (th.checks or 3) then
                ACClient.report('no_ragdoll', { checks = streak.no_ragdoll }); streak.no_ragdoll = 0
            end
        end

        th = ACClient.cfg('super_jump')
        if th and onFoot and IsPedJumping(ped) then trackJump(ped, th) end

        th = ACClient.cfg('freecam')
        if th and alive and not ACClient.spectating then
            local cam = GetFinalRenderedCamCoord()
            local far = #(cam - GetEntityCoords(ped)) > (th.distance or 40)
            local scripted = GetRenderingCam() ~= -1 or IsPlayerSwitchInProgress() or IsScreenFadedOut() or IsCinematicCamRendering()
            if bump('freecam', far and not scripted) >= (th.checks or 3) then
                ACClient.report('freecam', { distance = Utils.round(#(cam - GetEntityCoords(ped)), 1) }); streak.freecam = 0
            end
        end

        th = ACClient.cfg('spectate')
        if th and not ACClient.spectating then
            if bump('spectate', NetworkIsInSpectatorMode()) >= (th.checks or 2) then
                ACClient.report('spectate', {}); streak.spectate = 0
            end
        end

        th = ACClient.cfg('client_damage_modifier')
        if th then
            local w = GetPlayerWeaponDamageModifier(pid)
            local m = GetPlayerMeleeWeaponDamageModifier(pid)
            local max = (th.max or 1.0) + 0.01
            if w > max or m > max then
                ACClient.report('client_damage_modifier', { weapon = Utils.round(w, 2), melee = Utils.round(m, 2) })
            end
        end

        th = ACClient.cfg('client_invincible')
        if th and alive then
            if bump('client_invincible', GetPlayerInvincible(pid) or not GetEntityCanBeDamaged(ped)) >= (th.checks or 3) then
                ACClient.report('client_invincible', {}); streak.client_invincible = 0
            end
        end

        th = ACClient.cfg('vision_modes')
        if th then
            if bump('vision_modes', GetUsingnightvision() or GetUsingseethrough()) >= (th.checks or 3) then
                ACClient.report('vision_modes', { night = GetUsingnightvision(), thermal = GetUsingseethrough() }); streak.vision_modes = 0
            end
        end

        th = ACClient.cfg('vehicle_power')
        if th and not onFoot then
            local veh = GetVehiclePedIsIn(ped, false)
            if GetPedInVehicleSeat(veh, -1) == ped then
                local p = GetVehicleCheatPowerIncrease(veh)
                if p > (th.max or 1.0) + 0.01 then ACClient.report('vehicle_power', { power = Utils.round(p, 2), model = GetEntityModel(veh) }) end
            end
        end
    end
end)

-- Unknown client resources (started on this client, never started by the server). Every 30s.
CreateThread(function()
    while not ACClient.token do Wait(1000) end
    while true do
        Wait(30000)
        if ACClient.cfg('unknown_client_resource') then
            local known = serverResources()
            local ignored = Utils.toSet(ACClient.config.ignored)
            for i = 0, GetNumResources() - 1 do
                local name = GetResourceByFindIndex(i)
                if name and not known[name] and not ignored[name] and not reportedResources[name]
                    and GetResourceState(name) == 'started' then
                    reportedResources[name] = true
                    ACClient.report('unknown_client_resource', { resource = name })
                end
            end
        end
    end
end)

-- A server resource stopped on this client (e.g. a cheat stopping a protection script).
AddEventHandler('onClientResourceStop', function(name)
    if name == GetCurrentResourceName() or not ACClient.cfg('client_resource_stop') then return end
    local ignored = Utils.toSet(ACClient.config.ignored)
    if serverResources()[name] and not ignored[name] then
        -- Give the server a moment: if the resource is stopping server-side too, it is legitimate.
        SetTimeout(2000, function() ACClient.report('client_resource_stop', { resource = name }) end)
    end
end)
