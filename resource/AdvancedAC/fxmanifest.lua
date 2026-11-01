fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'AdvancedAC'
description 'Sentinel AC - server-authoritative anti-cheat'
author 'Sentinel AC'
version '1.0.0'

-- Server-side detections rely on OneSync entity state.
dependencies { '/onesync' }

shared_scripts {
    'config/config.lua',
    'shared/settings.lua',
    'shared/utils.lua',
}

server_scripts {
    'server/defaults.lua',
    'server/api.lua',
    'server/database.lua',
    'server/framework.lua',
    'server/weapons.lua',
    'server/bans.lua',
    'server/detections.lua',
    'server/telemetry.lua',
    'server/checks.lua',
    'server/events.lua',
    'server/commands.lua',
    'server/admin.lua',
    'server/main.lua',
}

client_scripts {
    'client/main.lua',
    'client/detections.lua',
    'client/monitoring.lua',
    'client/admin.lua',
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/app.js',
}
