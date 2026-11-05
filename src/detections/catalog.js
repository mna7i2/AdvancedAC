'use strict';
/**
 * Detection catalog — single source of truth.
 * The FiveM resource receives the merged (catalog + org overrides) config on handshake/sync.
 *
 * verified = the signal is observed by the server itself (authoritative). Unverified (client)
 *            signals can never trigger an automatic ban on their own — see lib/enforcement.js.
 *
 * Only detections that are actually implemented in the resource are listed here.
 * Requested-but-unreliable ones are documented in docs/DETECTIONS.md with the reason.
 */

const CATEGORIES = {
  player: 'Player Protection',
  combat: 'Combat Protection',
  movement: 'Movement Protection',
  entity: 'Entity Protection',
  explosion: 'Explosion Protection',
  event: 'Event Protection',
  resource: 'Resource Protection',
  client: 'Client Integrity',
};

const ACTIONS = ['log', 'warn', 'kick', 'review', 'ban'];
const LADDER_ACTIONS = ['log', 'warn', 'kick', 'review', 'ban'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const d = (key, category, name, source, verified, description, defaults) => ({
  key, category, name, source, verified, description,
  defaults: {
    enabled: true,
    action: 'warn',
    severity: 'medium',
    cooldown: 30,
    banDuration: 0, // hours, 0 = permanent
    evidence: { screenshot: false },
    whitelist: { aces: [], identifiers: [] },
    ...defaults,
  },
});

const CATALOG = [
  // ── Player ────────────────────────────────────────────────────────────
  d('godmode_flag', 'player', 'Anti Godmode', 'server', true,
    'Server reads GetPlayerInvincible() on consecutive telemetry samples outside of grace windows.',
    { action: 'kick', severity: 'high', threshold: { samples: 3 }, evidence: { screenshot: true } }),
  d('semi_godmode', 'player', 'Anti Semi-Godmode', 'server', true,
    'Player receives confirmed weapon damage repeatedly while server-side health never decreases.',
    { action: 'kick', severity: 'high', threshold: { hits: 5, windowSec: 20, minDamage: 10 }, evidence: { screenshot: true } }),
  d('health_limit', 'player', 'Anti Infinite Health', 'server', true,
    'Ped health or max health above the configured limit (server-side read).',
    { action: 'kick', severity: 'high', threshold: { maxHealth: 200, samples: 2 } }),
  d('armor_limit', 'player', 'Anti Infinite Armor', 'server', true,
    'Ped armour above the configured limit (server-side read).',
    { action: 'kick', severity: 'high', threshold: { maxArmor: 100, samples: 2 } }),
  d('invisible', 'player', 'Anti Invisible', 'server', true,
    'Ped is not visible (IsEntityVisible) on consecutive samples while not in a grace window.',
    { action: 'kick', severity: 'high', threshold: { samples: 3 }, evidence: { screenshot: true } }),
  d('no_ragdoll', 'player', 'Anti No Ragdoll', 'client', false,
    'Client reports CanPedRagdoll() = false on foot for consecutive checks.',
    { action: 'warn', severity: 'medium', threshold: { checks: 3 } }),
  d('super_jump', 'player', 'Anti Super Jump', 'client', false,
    'Client measures jump apex height above take-off point.',
    { action: 'warn', severity: 'medium', threshold: { height: 3.5 } }),
  d('freecam', 'player', 'Anti Freecam', 'client', false,
    'Rendered camera far from the ped with no script camera active.',
    { action: 'warn', severity: 'high', threshold: { distance: 40, checks: 3 }, evidence: { screenshot: true } }),
  d('spectate', 'player', 'Anti Spectate Abuse', 'client', false,
    'NetworkIsInSpectatorMode() true for a player without spectate permission.',
    { action: 'warn', severity: 'high', threshold: { checks: 2 } }),

  // ── Movement ──────────────────────────────────────────────────────────
  d('speed_onfoot', 'movement', 'Anti Speed Hack / Fast Run', 'server', true,
    'Horizontal on-foot speed above the limit on consecutive samples (falling excluded).',
    { action: 'kick', severity: 'high', threshold: { maxSpeed: 14, samples: 3 } }),
  d('fly_noclip', 'movement', 'Anti Noclip / Fly', 'server', true,
    'On-foot ped rises faster than physically possible without a vehicle, on consecutive samples.',
    { action: 'kick', severity: 'high', threshold: { riseSpeed: 3.5, samples: 2 }, evidence: { screenshot: true } }),
  d('teleport', 'movement', 'Anti Teleport', 'server', true,
    'Position jump implying an impossible speed. Use exports.AdvancedAC:AllowTeleport(src) in your scripts.',
    { action: 'warn', severity: 'high', threshold: { onFootSpeed: 150, vehicleSpeed: 260, minDistance: 120 } }),
  d('vehicle_speed', 'movement', 'Anti Vehicle Speed Hack', 'server', true,
    'Land/sea vehicle speed above the configured limit (aircraft have their own limit).',
    { action: 'kick', severity: 'high', threshold: { landMax: 110, airMax: 170, samples: 2 } }),

  // ── Combat ────────────────────────────────────────────────────────────
  d('weapon_blacklist', 'combat', 'Anti Illegal Weapon', 'server', true,
    'Server-side selected weapon is on the blacklist.',
    { action: 'ban', severity: 'critical', cooldown: 5,
      threshold: { weapons: ['WEAPON_RAILGUN', 'WEAPON_RAILGUNXM3', 'WEAPON_RAYMINIGUN', 'WEAPON_RAYCARBINE', 'WEAPON_RAYPISTOL', 'WEAPON_MINIGUN', 'WEAPON_HOMINGLAUNCHER', 'WEAPON_EMPLAUNCHER'] },
      evidence: { screenshot: true } }),
  d('weapon_give_event', 'combat', 'Anti Weapon Give (network)', 'server', true,
    'Client tried to give/remove weapons on another player via giveWeaponEvent/removeWeaponEvent. Event is cancelled.',
    { action: 'ban', severity: 'critical', cooldown: 5 }),
  d('damage_modifier', 'combat', 'Anti Weapon Damage Modifier', 'server', true,
    'Network weapon damage above the per-weapon cap.',
    { action: 'kick', severity: 'high', threshold: { defaultMax: 250, perWeapon: { WEAPON_HEAVYSNIPER: 400, WEAPON_HEAVYSNIPER_MK2: 450, WEAPON_MARKSMANRIFLE_MK2: 300 } }, evidence: { screenshot: true } }),
  d('rapid_fire', 'combat', 'Anti Rapid Fire', 'server', true,
    'Damage events per second from one attacker exceed the limit (automatic weapons accounted for).',
    { action: 'kick', severity: 'high', threshold: { maxPerSecond: 20 } }),
  d('impossible_range', 'combat', 'Anti Magic Bullet (range)', 'server', true,
    'Damage dealt from a distance beyond the weapon range limit.',
    { action: 'kick', severity: 'high', threshold: { maxDistance: 350, sniperMaxDistance: 1200 } }),
  d('weapon_mismatch', 'combat', 'Weapon Mismatch', 'server', true,
    'Damage reported with a weapon the attacker is not holding (spawned weapon / silent aim indicator). Heuristic.',
    { action: 'log', severity: 'medium', threshold: { count: 3, windowSec: 30 } }),
  d('clear_ped_tasks', 'combat', 'Anti Clear Ped Tasks', 'server', true,
    'Client cleared another player\'s tasks (vehicle kick / freeze trolling). Event is cancelled.',
    { action: 'warn', severity: 'high', threshold: { cancel: true } }),
  d('client_damage_modifier', 'combat', 'Client Damage Multiplier', 'client', false,
    'Client reports weapon/melee damage modifier above 1.0.',
    { action: 'warn', severity: 'high', threshold: { max: 1.0 } }),

  // ── Entity ────────────────────────────────────────────────────────────
  d('blocked_model', 'entity', 'Blocked Entity Models', 'server', true,
    'Player-owned entity creation with a blacklisted model. Creation is cancelled.',
    { action: 'ban', severity: 'critical', cooldown: 10,
      threshold: { models: ['p_spinning_anus_s', 'prop_windmill_01', 'stt_prop_stunt_track_dwslope30', 'prop_beach_fire', 'xs_prop_hamburgher_wl', 'prop_cs_dildo_01', 'stt_prop_ramp_jump_xxl', 'prop_container_01a', 'p_crahsed_heli_s', 'prop_rock_4_big2', 'dt1_05_build1_damage', 'cargoplane', 'jet', 'blimp', 'khanjali', 'rhino', 'hydra', 'lazer', 'titan'] } }),
  d('entity_spam', 'entity', 'Anti Entity Spam', 'server', true,
    'Script-created entities per player above the limit within the window. Excess creations are cancelled.',
    { action: 'kick', severity: 'high', threshold: { windowSec: 10, vehicles: 8, peds: 10, objects: 40 } }),

  // ── Explosion ─────────────────────────────────────────────────────────
  d('explosion_invisible', 'explosion', 'Invisible / Silent Explosion', 'server', true,
    'Explosion flagged invisible by the sender (AddExplosion isInvisible) — produced by cheat menus, not by gameplay. Cancelled.',
    { action: 'ban', severity: 'critical', cooldown: 5 }),
  d('explosion_damage_scale', 'explosion', 'Explosion Damage Limit', 'server', true,
    'Explosion damage scale above the limit.',
    { action: 'ban', severity: 'critical', cooldown: 5, threshold: { maxScale: 1.0 } }),
  d('explosion_blocked_type', 'explosion', 'Blocked Explosion Types', 'server', true,
    'Explosion type is on the blocklist. Explosion is cancelled.',
    { action: 'ban', severity: 'critical', cooldown: 5, threshold: { types: [59] } }),
  d('explosion_spam', 'explosion', 'Anti Explosion Spam', 'server', true,
    'Explosions per player above the rate limit. Excess explosions are cancelled.',
    { action: 'kick', severity: 'high', threshold: { count: 6, windowSec: 5 } }),
  d('explosion_distance', 'explosion', 'Explosion Radius Validation', 'server', true,
    'Explosion created far away from the sender\'s ped.',
    { action: 'warn', severity: 'medium', threshold: { maxDistance: 400 } }),
  d('ptfx_spam', 'explosion', 'Anti Particle Spam', 'server', true,
    'Networked particle effects above the rate limit. Excess are cancelled.',
    { action: 'kick', severity: 'high', threshold: { count: 12, windowSec: 5 } }),
  d('projectile_spam', 'explosion', 'Anti Projectile Spam', 'server', true,
    'Networked projectiles above the rate limit. Excess are cancelled.',
    { action: 'kick', severity: 'high', threshold: { count: 25, windowSec: 5 } }),

  // ── Event ─────────────────────────────────────────────────────────────
  d('honeypot_event', 'event', 'Unauthorized Event Execution (trap)', 'server', true,
    'Client triggered a trap event that no legitimate resource on this server uses.',
    { action: 'ban', severity: 'critical', cooldown: 5,
      threshold: { events: [
        { name: 'esx_ambulancejob:revive', unlessResource: 'esx_ambulancejob' },
        { name: 'esx-qalle-jail:jailPlayer', unlessResource: 'esx-qalle-jail' },
        { name: 'esx_policejob:handcuff', unlessResource: 'esx_policejob' },
        { name: 'esx_truckerjob:pay', unlessResource: 'esx_truckerjob' },
        { name: 'esx_garbagejob:pay', unlessResource: 'esx_garbagejob' },
        { name: 'esx_billing:sendBill', unlessResource: 'esx_billing' },
        { name: 'qb-ambulancejob:server:RevivePlayer', unlessResource: 'qb-ambulancejob' },
        { name: 'police:server:JailPlayer', unlessResource: 'qb-policejob' },
        { name: 'qb-bankrobbery:server:setBankState', unlessResource: 'qb-bankrobbery' },
        { name: 'sentinel:honeypot:giveMoney' },
        { name: 'sentinel:honeypot:adminMenu' },
      ] } }),
  d('event_spam', 'event', 'Event Spam', 'eventguard', true,
    'Net events per second from one player above the limit (resources that include @AdvancedAC/shared/eventguard.lua).',
    { action: 'kick', severity: 'high', threshold: { perSecond: 40, perEventPerSecond: 15 } }),
  d('event_serveronly', 'event', 'Server-only Event From Client', 'eventguard', true,
    'Client triggered an event its resource marked server-only via Guard.serverOnly().',
    { action: 'ban', severity: 'critical', cooldown: 5 }),
  d('event_invalid_args', 'event', 'Invalid Event Arguments', 'eventguard', true,
    'Event arguments failed the validator registered via Guard.validate().',
    { action: 'warn', severity: 'medium' }),

  // ── Resource ──────────────────────────────────────────────────────────
  d('ac_heartbeat', 'resource', 'Anti-Cheat Heartbeat Lost', 'server', true,
    'Client AC heartbeat not received in time (client AC stopped or blocked).',
    { action: 'kick', severity: 'high', threshold: { timeoutSec: 60 } }),
  d('client_resource_stop', 'resource', 'Client Resource Stopped', 'client', false,
    'A resource that the server runs was stopped on the client.',
    { action: 'warn', severity: 'high', whitelist: { aces: [], identifiers: [], resources: [] } }),
  d('unknown_client_resource', 'resource', 'Unknown Client Resource', 'client', false,
    'A started resource exists on the client that the server never started (injection indicator).',
    { action: 'warn', severity: 'high', whitelist: { aces: [], identifiers: [], resources: [] } }),

  // ── Client integrity ──────────────────────────────────────────────────
  d('client_invincible', 'client', 'Client Invincibility Flag', 'client', false,
    'Client reports GetEntityCanBeDamaged = false or player invincible.',
    { action: 'warn', severity: 'high', threshold: { checks: 3 } }),
  d('vision_modes', 'client', 'Night / Thermal Vision', 'client', false,
    'Night or thermal vision active without an allowed helmet/script.',
    { action: 'log', severity: 'low', threshold: { checks: 3 } }),
  d('vehicle_power', 'client', 'Vehicle Power / Torque Modifier', 'client', false,
    'Vehicle cheat power increase above 1.0.',
    { action: 'warn', severity: 'medium', threshold: { max: 1.0 } }),
];

const BY_KEY = Object.fromEntries(CATALOG.map((x) => [x.key, x]));

/**
 * Well-known exploited server events (cheat menus trigger them to give money, revive, jail, etc.).
 * Each is only armed as a trap when its owning resource is NOT running, so legit players are never hit.
 */
const EXPLOIT_LIBRARY = [
  { name: 'esx_ambulancejob:revive', unlessResource: 'esx_ambulancejob', note: 'Revive anyone / self' },
  { name: 'esx_ambulancejob:setDeathStatus', unlessResource: 'esx_ambulancejob', note: 'Death status manipulation' },
  { name: 'esx_policejob:handcuff', unlessResource: 'esx_policejob', note: 'Cuff any player' },
  { name: 'esx_policejob:drag', unlessResource: 'esx_policejob', note: 'Drag any player' },
  { name: 'esx_policejob:putInVehicle', unlessResource: 'esx_policejob', note: 'Force players into vehicles' },
  { name: 'esx-qalle-jail:jailPlayer', unlessResource: 'esx-qalle-jail', note: 'Jail any player' },
  { name: 'esx_jailer:sendToJail', unlessResource: 'esx_jailer', note: 'Jail any player' },
  { name: 'esx_billing:sendBill', unlessResource: 'esx_billing', note: 'Spam bills to players' },
  { name: 'esx_truckerjob:pay', unlessResource: 'esx_truckerjob', note: 'Money exploit' },
  { name: 'esx_garbagejob:pay', unlessResource: 'esx_garbagejob', note: 'Money exploit' },
  { name: 'esx_pizza:pay', unlessResource: 'esx_pizza', note: 'Money exploit' },
  { name: 'esx_godirtyjob:pay', unlessResource: 'esx_godirtyjob', note: 'Money exploit' },
  { name: 'esx_banksecurity:pay', unlessResource: 'esx_banksecurity', note: 'Money exploit' },
  { name: 'esx_carthief:pay', unlessResource: 'esx_carthief', note: 'Money exploit' },
  { name: 'esx_fueldelivery:pay', unlessResource: 'esx_fueldelivery', note: 'Money exploit' },
  { name: 'esx_blanchisseur:washMoney', unlessResource: 'esx_blanchisseur', note: 'Money laundering exploit' },
  { name: 'esx_vehicleshop:setVehicleOwned', unlessResource: 'esx_vehicleshop', note: 'Free vehicles' },
  { name: 'esx_dmvschool:addLicense', unlessResource: 'esx_dmvschool', note: 'Free licenses' },
  { name: 'esx_slotmachine:sv:2', unlessResource: 'esx_slotmachine', note: 'Casino money exploit' },
  { name: 'lscustoms:payGarage', unlessResource: 'esx_lscustom', note: 'Negative payment exploit' },
  { name: 'qb-ambulancejob:server:RevivePlayer', unlessResource: 'qb-ambulancejob', note: 'Revive anyone' },
  { name: 'hospital:server:SetLaststandStatus', unlessResource: 'qb-ambulancejob', note: 'Last-stand manipulation' },
  { name: 'police:server:JailPlayer', unlessResource: 'qb-policejob', note: 'Jail any player' },
  { name: 'police:server:CuffPlayer', unlessResource: 'qb-policejob', note: 'Cuff any player' },
  { name: 'qb-bankrobbery:server:setBankState', unlessResource: 'qb-bankrobbery', note: 'Bank state exploit' },
  { name: 'sentinel:honeypot:giveMoney', note: 'Generic trap (never used by any script)' },
  { name: 'sentinel:honeypot:adminMenu', note: 'Generic trap (never used by any script)' },
];

// Shape validation for editable block lists (Protection Rules page).
const EVENT_RE = /^[\w:.\-@/]{1,128}$/;
const NAME_RE = /^[\w-]{1,64}$/;
const LIST_SANITIZERS = {
  'honeypot_event.events': (v) => {
    const out = [];
    for (const e of v) {
      const o = typeof e === 'string' ? { name: e } : e;
      if (!o || typeof o.name !== 'string' || !EVENT_RE.test(o.name.trim())) continue;
      const item = { name: o.name.trim() };
      if (typeof o.unlessResource === 'string' && NAME_RE.test(o.unlessResource.trim())) item.unlessResource = o.unlessResource.trim();
      if (typeof o.note === 'string' && o.note.trim()) item.note = o.note.trim().slice(0, 120);
      if (!out.some((x) => x.name === item.name)) out.push(item);
    }
    return out.slice(0, 500);
  },
  'weapon_blacklist.weapons': (v) => [...new Set(v.filter((x) => typeof x === 'string' && NAME_RE.test(x.trim())).map((x) => x.trim().toUpperCase()))].slice(0, 500),
  'blocked_model.models': (v) => [...new Set(v.filter((x) => (typeof x === 'string' && NAME_RE.test(x.trim())) || Number.isInteger(x)).map((x) => (typeof x === 'string' ? x.trim().toLowerCase() : x)))].slice(0, 1000),
  'explosion_blocked_type.types': (v) => [...new Set(v.filter((x) => Number.isInteger(x) && x >= 0 && x <= 100))].sort((a, b) => a - b),
};

/** Protection strength presets: the action each detection gets at a given level. */
const LEVELS = ['relaxed', 'balanced', 'strict', 'maximum'];
const NEVER_BAN = new Set(['teleport', 'ac_heartbeat', 'explosion_distance', 'weapon_mismatch']);
function presetAction(def, level) {
  const d = def.defaults.action;
  if (level === 'balanced') return d;
  if (level === 'relaxed') {
    if (!def.verified) return 'log';
    return def.defaults.severity === 'critical' ? d : (d === 'log' ? 'log' : 'warn');
  }
  if (level === 'strict') {
    if (!def.verified) return def.defaults.severity === 'high' ? 'kick' : d;
    if (NEVER_BAN.has(def.key)) return d === 'log' ? 'warn' : 'kick';
    return d === 'kick' ? 'ban' : d;
  }
  // maximum
  if (!def.verified) return 'kick';
  if (NEVER_BAN.has(def.key)) return 'kick';
  return 'ban';
}

/** Deep-merge plain objects; arrays are replaced, not concatenated. */
function merge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || typeof over !== 'object' || !base || !over) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

/** Validate an override against catalog shape: only known keys/types are kept. */
function sanitizeOverride(key, ov) {
  const def = BY_KEY[key];
  if (!def || !ov || typeof ov !== 'object') return null;
  const out = {};
  if (typeof ov.enabled === 'boolean') out.enabled = ov.enabled;
  if (ACTIONS.includes(ov.action)) out.action = ov.action;
  if (SEVERITIES.includes(ov.severity)) out.severity = ov.severity;
  if (Number.isFinite(ov.cooldown) && ov.cooldown >= 0 && ov.cooldown <= 86400) out.cooldown = Math.round(ov.cooldown);
  if (Number.isFinite(ov.banDuration) && ov.banDuration >= 0 && ov.banDuration <= 24 * 3650) out.banDuration = Math.round(ov.banDuration);
  if (ov.evidence && typeof ov.evidence.screenshot === 'boolean') out.evidence = { screenshot: ov.evidence.screenshot };
  if (ov.ladder && typeof ov.ladder === 'object') {
    // Progressive punishments: step N applies to the Nth offense within windowHours.
    const steps = (Array.isArray(ov.ladder.steps) ? ov.ladder.steps : []).slice(0, 6)
      .filter((st) => st && LADDER_ACTIONS.includes(st.action))
      .map((st) => (st.action === 'ban' && Number.isFinite(st.hours) && st.hours >= 0 && st.hours <= 24 * 3650
        ? { action: 'ban', hours: Math.round(st.hours) } : { action: st.action }));
    const wh = Number(ov.ladder.windowHours);
    out.ladder = { enabled: ov.ladder.enabled === true && steps.length > 0, windowHours: Number.isFinite(wh) && wh >= 1 && wh <= 24 * 90 ? Math.round(wh) : 72, steps };
  }
  if (ov.whitelist && typeof ov.whitelist === 'object') {
    const wl = {};
    for (const k of Object.keys(def.defaults.whitelist)) {
      if (Array.isArray(ov.whitelist[k])) wl[k] = ov.whitelist[k].filter((s) => typeof s === 'string' && s.length < 128).slice(0, 500);
    }
    out.whitelist = wl;
  }
  if (def.defaults.threshold && ov.threshold && typeof ov.threshold === 'object') {
    const th = {};
    for (const [k, dv] of Object.entries(def.defaults.threshold)) {
      const v = ov.threshold[k];
      if (v === undefined) continue;
      if (typeof dv === 'number' && Number.isFinite(v) && v >= 0) th[k] = v;
      else if (typeof dv === 'boolean' && typeof v === 'boolean') th[k] = v;
      else if (Array.isArray(dv) && Array.isArray(v) && v.length <= 1000) th[k] = LIST_SANITIZERS[`${key}.${k}`] ? LIST_SANITIZERS[`${key}.${k}`](v) : v;
      else if (dv && typeof dv === 'object' && !Array.isArray(dv) && v && typeof v === 'object') th[k] = v;
    }
    out.threshold = th;
  }
  return out;
}

/** Returns { key: mergedConfig } for an org given its override rows. */
function resolveConfig(overrides) {
  const map = {};
  const ovByKey = Object.fromEntries((overrides || []).map((o) => [o.detection_key, o.config]));
  for (const def of CATALOG) map[def.key] = merge(def.defaults, ovByKey[def.key] || {});
  return map;
}

module.exports = { CATALOG, BY_KEY, CATEGORIES, ACTIONS, SEVERITIES, resolveConfig, sanitizeOverride, merge, EXPLOIT_LIBRARY, LEVELS, presetAction };
