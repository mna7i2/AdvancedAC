-- GENERATED from backend/src/detections/catalog.js — do not edit by hand.
-- Built-in defaults used until the backend sends its config (first start / no backend configured).
-- Regenerate: cd backend && npm run gen:defaults
Defaults = {
    detections = {
        godmode_flag = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                samples = 3
            },
            name = "Anti Godmode"
        },
        semi_godmode = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                hits = 5,
                windowSec = 20,
                minDamage = 10
            },
            name = "Anti Semi-Godmode"
        },
        health_limit = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxHealth = 200,
                samples = 2
            },
            name = "Anti Infinite Health"
        },
        armor_limit = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxArmor = 100,
                samples = 2
            },
            name = "Anti Infinite Armor"
        },
        invisible = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                samples = 3
            },
            name = "Anti Invisible"
        },
        no_ragdoll = {
            enabled = true,
            action = "warn",
            severity = "medium",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                checks = 3
            },
            name = "Anti No Ragdoll"
        },
        super_jump = {
            enabled = true,
            action = "warn",
            severity = "medium",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                height = 3.5
            },
            name = "Anti Super Jump"
        },
        freecam = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                distance = 40,
                checks = 3
            },
            name = "Anti Freecam"
        },
        spectate = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                checks = 2
            },
            name = "Anti Spectate Abuse"
        },
        speed_onfoot = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxSpeed = 14,
                samples = 3
            },
            name = "Anti Speed Hack / Fast Run"
        },
        fly_noclip = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                riseSpeed = 3.5,
                samples = 2
            },
            name = "Anti Noclip / Fly"
        },
        teleport = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                onFootSpeed = 150,
                vehicleSpeed = 260,
                minDistance = 120
            },
            name = "Anti Teleport"
        },
        vehicle_speed = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                landMax = 110,
                airMax = 170,
                samples = 2
            },
            name = "Anti Vehicle Speed Hack"
        },
        weapon_blacklist = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                weapons = {
                    "WEAPON_RAILGUN",
                    "WEAPON_RAILGUNXM3",
                    "WEAPON_RAYMINIGUN",
                    "WEAPON_RAYCARBINE",
                    "WEAPON_RAYPISTOL",
                    "WEAPON_MINIGUN",
                    "WEAPON_HOMINGLAUNCHER",
                    "WEAPON_EMPLAUNCHER"
                }
            },
            name = "Anti Illegal Weapon"
        },
        weapon_give_event = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            name = "Anti Weapon Give (network)"
        },
        damage_modifier = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = true
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                defaultMax = 250,
                perWeapon = {
                    WEAPON_HEAVYSNIPER = 400,
                    WEAPON_HEAVYSNIPER_MK2 = 450,
                    WEAPON_MARKSMANRIFLE_MK2 = 300
                }
            },
            name = "Anti Weapon Damage Modifier"
        },
        rapid_fire = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxPerSecond = 20
            },
            name = "Anti Rapid Fire"
        },
        impossible_range = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxDistance = 350,
                sniperMaxDistance = 1200
            },
            name = "Anti Magic Bullet (range)"
        },
        weapon_mismatch = {
            enabled = true,
            action = "log",
            severity = "medium",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                count = 3,
                windowSec = 30
            },
            name = "Weapon Mismatch"
        },
        clear_ped_tasks = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                cancel = true
            },
            name = "Anti Clear Ped Tasks"
        },
        client_damage_modifier = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                max = 1
            },
            name = "Client Damage Multiplier"
        },
        blocked_model = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 10,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                models = {
                    "p_spinning_anus_s",
                    "prop_windmill_01",
                    "stt_prop_stunt_track_dwslope30",
                    "prop_beach_fire",
                    "xs_prop_hamburgher_wl",
                    "prop_cs_dildo_01",
                    "stt_prop_ramp_jump_xxl",
                    "prop_container_01a",
                    "p_crahsed_heli_s",
                    "prop_rock_4_big2",
                    "dt1_05_build1_damage",
                    "cargoplane",
                    "jet",
                    "blimp",
                    "khanjali",
                    "rhino",
                    "hydra",
                    "lazer",
                    "titan"
                }
            },
            name = "Blocked Entity Models"
        },
        entity_spam = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                windowSec = 10,
                vehicles = 8,
                peds = 10,
                objects = 40
            },
            name = "Anti Entity Spam"
        },
        explosion_invisible = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            name = "Invisible / Silent Explosion"
        },
        explosion_damage_scale = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxScale = 1
            },
            name = "Explosion Damage Limit"
        },
        explosion_blocked_type = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                types = {
                    59
                }
            },
            name = "Blocked Explosion Types"
        },
        explosion_spam = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                count = 6,
                windowSec = 5
            },
            name = "Anti Explosion Spam"
        },
        explosion_distance = {
            enabled = true,
            action = "warn",
            severity = "medium",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                maxDistance = 400
            },
            name = "Explosion Radius Validation"
        },
        ptfx_spam = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                count = 12,
                windowSec = 5
            },
            name = "Anti Particle Spam"
        },
        projectile_spam = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                count = 25,
                windowSec = 5
            },
            name = "Anti Projectile Spam"
        },
        honeypot_event = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                events = {
                    {
                        name = "esx_ambulancejob:revive",
                        unlessResource = "esx_ambulancejob"
                    },
                    {
                        name = "esx-qalle-jail:jailPlayer",
                        unlessResource = "esx-qalle-jail"
                    },
                    {
                        name = "esx_policejob:handcuff",
                        unlessResource = "esx_policejob"
                    },
                    {
                        name = "esx_truckerjob:pay",
                        unlessResource = "esx_truckerjob"
                    },
                    {
                        name = "esx_garbagejob:pay",
                        unlessResource = "esx_garbagejob"
                    },
                    {
                        name = "esx_billing:sendBill",
                        unlessResource = "esx_billing"
                    },
                    {
                        name = "qb-ambulancejob:server:RevivePlayer",
                        unlessResource = "qb-ambulancejob"
                    },
                    {
                        name = "police:server:JailPlayer",
                        unlessResource = "qb-policejob"
                    },
                    {
                        name = "qb-bankrobbery:server:setBankState",
                        unlessResource = "qb-bankrobbery"
                    },
                    {
                        name = "sentinel:honeypot:giveMoney"
                    },
                    {
                        name = "sentinel:honeypot:adminMenu"
                    }
                }
            },
            name = "Unauthorized Event Execution (trap)"
        },
        event_spam = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                perSecond = 40,
                perEventPerSecond = 15
            },
            name = "Event Spam"
        },
        event_serveronly = {
            enabled = true,
            action = "ban",
            severity = "critical",
            cooldown = 5,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            name = "Server-only Event From Client"
        },
        event_invalid_args = {
            enabled = true,
            action = "warn",
            severity = "medium",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            name = "Invalid Event Arguments"
        },
        ac_heartbeat = {
            enabled = true,
            action = "kick",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                timeoutSec = 60
            },
            name = "Anti-Cheat Heartbeat Lost"
        },
        client_resource_stop = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {},
                resources = {}
            },
            name = "Client Resource Stopped"
        },
        unknown_client_resource = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {},
                resources = {}
            },
            name = "Unknown Client Resource"
        },
        client_invincible = {
            enabled = true,
            action = "warn",
            severity = "high",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                checks = 3
            },
            name = "Client Invincibility Flag"
        },
        vision_modes = {
            enabled = true,
            action = "log",
            severity = "low",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                checks = 3
            },
            name = "Night / Thermal Vision"
        },
        vehicle_power = {
            enabled = true,
            action = "warn",
            severity = "medium",
            cooldown = 30,
            banDuration = 0,
            evidence = {
                screenshot = false
            },
            whitelist = {
                aces = {},
                identifiers = {}
            },
            threshold = {
                max = 1
            },
            name = "Vehicle Power / Torque Modifier"
        }
    },
    telemetry = {
        intervalMs = 2000,
        heartbeatMs = 3000,
        storeReplay = true
    },
    monitoring = {
        defaultIntervalMs = 3000,
        minIntervalMs = 1000,
        maxFramesPerSession = 600
    },
    enforcement = {
        kickMessage = "You were removed by Sentinel AC: {reason}",
        banMessage = "You are banned from this server.\nBan ID: {banId}\nReason: {reason}\nExpires: {expires}\nAppeal: {appealUrl}",
        appealUrl = ""
    },
    staff = {}
}
