-- Shared constants (client + server). No secrets.
AC = AC or {}

AC.Version = '1.0.0'
AC.Name = 'Sentinel AC'

-- Net event names. Client → server events are validated with a per-session token.
AC.Events = {
    ClientReady     = 'sentinel:c2s:ready',
    ClientBeat      = 'sentinel:c2s:beat',
    ClientReport    = 'sentinel:c2s:report',
    ScreenshotReady = 'sentinel:c2s:shot',
    MenuAction      = 'sentinel:c2s:menu',

    Init            = 'sentinel:s2c:init',
    Notify          = 'sentinel:s2c:notify',
    Heal            = 'sentinel:s2c:heal',
    Announce        = 'sentinel:s2c:announce',
    Spectate        = 'sentinel:s2c:spectate',
    MenuData        = 'sentinel:s2c:menudata',
    MenuOpen        = 'sentinel:s2c:menuopen',
    AdminAlert      = 'sentinel:s2c:alert',
    Freeze          = 'sentinel:s2c:freeze',
}

-- Flags packed into telemetry samples
AC.Flags = { Invisible = 1, Invincible = 2, Frozen = 4, Dead = 8 }

-- Client-side detection keys the server accepts from clients (anything else is rejected)
AC.ClientDetections = {
    no_ragdoll = true, super_jump = true, freecam = true, spectate = true,
    client_damage_modifier = true, client_resource_stop = true, unknown_client_resource = true,
    client_invincible = true, vision_modes = true, vehicle_power = true,
}
