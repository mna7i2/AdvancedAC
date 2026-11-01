-- Framework detection + integration hooks (ESX, QBCore, Qbox, vRP, standalone).
-- Used for: handshake info, spawn grace windows, optional admin permission bridge.
Framework = { name = 'standalone', obj = nil }

local function started(res) return GetResourceState(res) == 'started' end

function Framework.detect()
    if started('qbx_core') then
        Framework.name = 'qbox'
    elseif started('qb-core') then
        Framework.name = 'qbcore'
        local ok, obj = pcall(function() return exports['qb-core']:GetCoreObject() end)
        if ok then Framework.obj = obj end
    elseif started('es_extended') then
        Framework.name = 'esx'
        local ok, obj = pcall(function() return exports['es_extended']:getSharedObject() end)
        if ok then Framework.obj = obj end
    elseif started('vrp') then
        Framework.name = 'vrp'
    else
        Framework.name = 'standalone'
    end
    return Framework.name
end

--- Framework-level admin check (bridge). ACE / dashboard staff are checked first in Admin.can.
function Framework.isAdmin(src)
    if Framework.name == 'qbcore' and Framework.obj then
        local ok, res = pcall(function() return Framework.obj.Functions.HasPermission(src, 'admin') or Framework.obj.Functions.HasPermission(src, 'god') end)
        return ok and res or false
    elseif Framework.name == 'qbox' then
        local ok, res = pcall(function() return exports.qbx_core:HasPermission(src, 'admin') end)
        return ok and res or false
    elseif Framework.name == 'esx' and Framework.obj then
        local ok, res = pcall(function()
            local xPlayer = Framework.obj.GetPlayerFromId(src)
            local g = xPlayer and xPlayer.getGroup() or 'user'
            return g == 'admin' or g == 'superadmin'
        end)
        return ok and res or false
    end
    return false
end

-- Character load / spawn: give a grace window (teleport to last position, health set by framework).
local function onLoaded(src)
    src = tonumber(src)
    if src and Grace then Grace.set(src, 'all', Config.Grace.spawn) end
end

AddEventHandler('QBCore:Server:PlayerLoaded', function(Player)
    local src = Player and Player.PlayerData and Player.PlayerData.source
    onLoaded(src or source)
end)
AddEventHandler('QBCore:Server:OnPlayerLoaded', function() onLoaded(source) end)
AddEventHandler('esx:playerLoaded', function(playerId) onLoaded(playerId) end)
AddEventHandler('vRP:playerSpawn', function(_, src) onLoaded(src) end)
