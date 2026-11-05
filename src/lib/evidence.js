'use strict';
/**
 * Plain-language explanation of what the server observed for a detection, so every warn / kick /
 * ban states a concrete, checkable reason ("Speed 38.2 m/s — limit 14 m/s, 3 samples in a row").
 * English and Arabic (enforcement.language). Unknown keys fall back to the raw measured values.
 */

const n = (v, d = 1) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : '?');
const explosionName = (t) => `type ${t}`;

const T = {
  en: {
    godmode_flag: (d) => `Server saw the player invincible for ${d.samples || '?'} checks in a row`,
    semi_godmode: (d) => `${d.unabsorbedHits || '?'} confirmed hits did no damage (health ${d.health ?? '?'}, armour ${d.armor ?? '?'})`,
    health_limit: (d) => `Health ${d.health ?? '?'} — limit ${d.limit ?? '?'}`,
    armor_limit: (d) => `Armour ${d.armor ?? '?'} — limit ${d.limit ?? '?'}`,
    invisible: (d) => `Player was invisible for ${d.samples || '?'} checks in a row`,
    no_ragdoll: () => 'Ragdoll stayed disabled after hits (client signal)',
    super_jump: (d) => `Jumped ${n(d.height, 2)} m high (client signal)`,
    freecam: (d) => `Camera ${n(d.distance)} m away from the player (client signal)`,
    spectate: () => 'Spectating another player without permission (client signal)',
    speed_onfoot: (d) => `Ran at ${n(d.speed)} m/s — limit ${d.limit ?? '?'} m/s, ${d.samples || '?'} samples in a row`,
    fly_noclip: (d) => `Rose ${n(d.riseSpeed)} m/s without a vehicle — limit ${d.limit ?? '?'} m/s`,
    teleport: (d) => `Moved ${n(d.distance, 0)} m in ${n(d.seconds, 1)} s${d.inVehicle ? ' (in a vehicle)' : ''}`,
    vehicle_speed: (d) => `Vehicle at ${d.kmh ?? '?'} km/h — limit ${d.limit !== undefined ? Math.round(d.limit * 3.6) : '?'} km/h`,
    weapon_blacklist: (d) => `Held the blocked weapon ${d.weapon || '?'}`,
    weapon_give_event: (d) => `Tried to ${String(d.event || '').startsWith('remove') ? 'remove weapons from' : 'give a weapon to'} another player`,
    damage_modifier: (d) => `Dealt ${d.damage ?? '?'} damage in one hit — maximum ${d.cap ?? '?'} for this weapon`,
    rapid_fire: (d) => `${d.perSecond ?? '?'} shots per second — limit ${d.limit ?? '?'}`,
    impossible_range: (d) => `Hit a player from ${n(d.distance, 0)} m — limit ${d.limit ?? '?'} m`,
    weapon_mismatch: (d) => `Damage reported with a weapon the player was not holding (${d.count || '?'}×)`,
    clear_ped_tasks: () => 'Forced another player out of their animation / vehicle',
    client_damage_modifier: (d) => `Weapon damage multiplier ×${n(d.weapon, 2)} (client signal)`,
    blocked_model: (d) => `Spawned the blocked model ${d.model || '?'}`,
    entity_spam: (d) => `Spawned ${d.count ?? '?'} ${d.kind || 'entities'} in a few seconds — limit ${d.limit ?? '?'}`,
    explosion_invisible: (d) => `Created an invisible, silent explosion (${explosionName(d.type)})`,
    explosion_damage_scale: (d) => `Explosion with damage ×${n(d.scale, 2)} — limit ×${d.limit ?? 1}`,
    explosion_blocked_type: (d) => `Created a blocked explosion (${explosionName(d.type)})`,
    explosion_spam: (d) => `${d.count ?? '?'} explosions in ${d.windowSec ?? '?'} s`,
    explosion_distance: (d) => `Explosion ${n(d.distance, 0)} m away from the player — limit ${d.limit ?? '?'} m`,
    ptfx_spam: (d) => `${d.count ?? '?'} particle effects in ${d.windowSec ?? '?'} s`,
    projectile_spam: (d) => `${d.count ?? '?'} projectiles in ${d.windowSec ?? '?'} s`,
    honeypot_event: (d) => `Triggered the trap event "${d.event || '?'}" that no real script uses`,
    event_spam: (d) => `Sent ${d.count ?? d.perSecond ?? '?'} server events per second`,
    event_serveronly: (d) => `Triggered the server-only event "${d.event || '?'}" from the client`,
    event_invalid_args: (d) => `Sent invalid data to "${d.event || '?'}"`,
    ac_heartbeat: (d) => (d.reason ? 'The anti-cheat client never started' : `The anti-cheat client went silent for ${d.silentSec ?? '?'} s`),
    client_resource_stop: (d) => `Stopped the server script "${d.resource || '?'}" on their game (client signal)`,
    unknown_client_resource: (d) => `Ran the unknown resource "${d.resource || '?'}" that the server never started (client signal)`,
    client_invincible: () => 'Invincibility detected in the game (client signal)',
    vision_modes: () => 'Night / thermal vision without equipment (client signal)',
    vehicle_power: (d) => `Vehicle engine power ×${n(d.power, 2)} (client signal)`,
  },
  ar: {
    godmode_flag: (d) => `السيرفر شاف اللاعب ما ينضرب (غود مود) ${d.samples || '?'} مرات ورا بعض`,
    semi_godmode: (d) => `${d.unabsorbedHits || '?'} ضربات مؤكدة ما نقصت دمه`,
    health_limit: (d) => `الدم ${d.health ?? '?'} والحد ${d.limit ?? '?'}`,
    armor_limit: (d) => `الدرع ${d.armor ?? '?'} والحد ${d.limit ?? '?'}`,
    invisible: (d) => `كان مخفي ${d.samples || '?'} فحوصات ورا بعض`,
    no_ragdoll: () => 'ما يطيح لما ينضرب (إشارة من جهاز اللاعب)',
    super_jump: (d) => `نط ${n(d.height, 2)} متر (إشارة من جهاز اللاعب)`,
    freecam: (d) => `الكاميرا بعيدة ${n(d.distance)} متر عن اللاعب (إشارة من جهاز اللاعب)`,
    spectate: () => 'يراقب لاعب ثاني بدون صلاحية (إشارة من جهاز اللاعب)',
    speed_onfoot: (d) => `ركض بسرعة ${n(d.speed)} م/ث والحد ${d.limit ?? '?'} م/ث، ${d.samples || '?'} قراءات ورا بعض`,
    fly_noclip: (d) => `طار لفوق بسرعة ${n(d.riseSpeed)} م/ث بدون مركبة والحد ${d.limit ?? '?'}`,
    teleport: (d) => `انتقل ${n(d.distance, 0)} متر في ${n(d.seconds, 1)} ثانية`,
    vehicle_speed: (d) => `سرعة المركبة ${d.kmh ?? '?'} كم/س والحد ${d.limit !== undefined ? Math.round(d.limit * 3.6) : '?'}`,
    weapon_blacklist: (d) => `ماسك السلاح الممنوع ${d.weapon || '?'}`,
    weapon_give_event: () => 'حاول يعطي أو يسحب سلاح من لاعب ثاني',
    damage_modifier: (d) => `ضرر ${d.damage ?? '?'} بضربة وحدة والحد ${d.cap ?? '?'} لهذا السلاح`,
    rapid_fire: (d) => `${d.perSecond ?? '?'} طلقة بالثانية والحد ${d.limit ?? '?'}`,
    impossible_range: (d) => `ضرب لاعب من ${n(d.distance, 0)} متر والحد ${d.limit ?? '?'}`,
    weapon_mismatch: (d) => `ضرر بسلاح مو ماسكه (${d.count || '?'} مرات)`,
    clear_ped_tasks: () => 'طلّع لاعب ثاني من حركته أو سيارته بالقوة',
    client_damage_modifier: (d) => `مضاعف ضرر السلاح ×${n(d.weapon, 2)} (إشارة من جهاز اللاعب)`,
    blocked_model: (d) => `رسبن الموديل الممنوع ${d.model || '?'}`,
    entity_spam: (d) => `رسبن ${d.count ?? '?'} ${d.kind || 'أشياء'} بثواني والحد ${d.limit ?? '?'}`,
    explosion_invisible: () => 'سوّى انفجار مخفي بدون صوت',
    explosion_damage_scale: (d) => `انفجار بضرر ×${n(d.scale, 2)} والحد ×${d.limit ?? 1}`,
    explosion_blocked_type: (d) => `سوّى انفجار ممنوع (نوع ${d.type ?? '?'})`,
    explosion_spam: (d) => `${d.count ?? '?'} انفجارات في ${d.windowSec ?? '?'} ثواني`,
    explosion_distance: (d) => `انفجار بعيد ${n(d.distance, 0)} متر عن اللاعب والحد ${d.limit ?? '?'}`,
    ptfx_spam: (d) => `${d.count ?? '?'} مؤثرات في ${d.windowSec ?? '?'} ثواني`,
    projectile_spam: (d) => `${d.count ?? '?'} مقذوفات في ${d.windowSec ?? '?'} ثواني`,
    honeypot_event: (d) => `شغّل إيفنت فخ "${d.event || '?'}" ما يستخدمه أي سكربت حقيقي`,
    event_spam: (d) => `أرسل ${d.count ?? d.perSecond ?? '?'} إيفنت بالثانية`,
    event_serveronly: (d) => `شغّل إيفنت خاص بالسيرفر "${d.event || '?'}" من جهازه`,
    event_invalid_args: (d) => `أرسل بيانات غلط لـ "${d.event || '?'}"`,
    ac_heartbeat: (d) => (d.reason ? 'برنامج الحماية ما اشتغل عند اللاعب' : `برنامج الحماية عند اللاعب سكت ${d.silentSec ?? '?'} ثانية`),
    client_resource_stop: (d) => `طفّى سكربت السيرفر "${d.resource || '?'}" عنده (إشارة من جهاز اللاعب)`,
    unknown_client_resource: (d) => `شغّل سكربت غريب "${d.resource || '?'}" ما شغّله السيرفر (إشارة من جهاز اللاعب)`,
    client_invincible: () => 'غود مود داخل اللعبة (إشارة من جهاز اللاعب)',
    vision_modes: () => 'رؤية ليلية أو حرارية بدون معدات (إشارة من جهاز اللاعب)',
    vehicle_power: (d) => `قوة محرك المركبة ×${n(d.power, 2)} (إشارة من جهاز اللاعب)`,
  },
};

function raw(details) {
  const parts = Object.entries(details || {}).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, 5).map(([k, v]) => `${k}: ${v}`);
  return parts.join(', ');
}

function explain(key, details = {}, lang = 'en') {
  const tbl = T[lang] || T.en;
  const f = tbl[key] || T.en[key];
  try { return String(f ? f(details || {}) : raw(details)).slice(0, 200); } catch { return raw(details).slice(0, 200); }
}

module.exports = { explain, KEYS: Object.keys(T.en) };
