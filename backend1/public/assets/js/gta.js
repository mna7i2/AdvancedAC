// GTA V name lookups. Telemetry carries hashes; we resolve common ones by computing joaat locally.
export function joaat(s) {
  s = s.toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h + s.charCodeAt(i)) >>> 0;
    h = (h + (h << 10)) >>> 0;
    h = (h ^ (h >>> 6)) >>> 0;
  }
  h = (h + (h << 3)) >>> 0;
  h = (h ^ (h >>> 11)) >>> 0;
  h = (h + (h << 15)) >>> 0;
  return h;
}

const WEAPONS = ['UNARMED', 'KNIFE', 'NIGHTSTICK', 'HAMMER', 'BAT', 'GOLFCLUB', 'CROWBAR', 'BOTTLE', 'DAGGER', 'HATCHET', 'KNUCKLE', 'MACHETE',
  'FLASHLIGHT', 'SWITCHBLADE', 'POOLCUE', 'WRENCH', 'BATTLEAXE', 'STONE_HATCHET', 'PISTOL', 'PISTOL_MK2', 'COMBATPISTOL', 'APPISTOL', 'STUNGUN',
  'PISTOL50', 'SNSPISTOL', 'SNSPISTOL_MK2', 'HEAVYPISTOL', 'VINTAGEPISTOL', 'FLAREGUN', 'MARKSMANPISTOL', 'REVOLVER', 'REVOLVER_MK2',
  'DOUBLEACTION', 'RAYPISTOL', 'CERAMICPISTOL', 'NAVYREVOLVER', 'GADGETPISTOL', 'MICROSMG', 'SMG', 'SMG_MK2', 'ASSAULTSMG', 'COMBATPDW',
  'MACHINEPISTOL', 'MINISMG', 'RAYCARBINE', 'PUMPSHOTGUN', 'PUMPSHOTGUN_MK2', 'SAWNOFFSHOTGUN', 'ASSAULTSHOTGUN', 'BULLPUPSHOTGUN', 'MUSKET',
  'HEAVYSHOTGUN', 'DBSHOTGUN', 'AUTOSHOTGUN', 'COMBATSHOTGUN', 'ASSAULTRIFLE', 'ASSAULTRIFLE_MK2', 'CARBINERIFLE', 'CARBINERIFLE_MK2',
  'ADVANCEDRIFLE', 'SPECIALCARBINE', 'SPECIALCARBINE_MK2', 'BULLPUPRIFLE', 'BULLPUPRIFLE_MK2', 'COMPACTRIFLE', 'MILITARYRIFLE', 'HEAVYRIFLE',
  'TACTICALRIFLE', 'MG', 'COMBATMG', 'COMBATMG_MK2', 'GUSENBERG', 'SNIPERRIFLE', 'HEAVYSNIPER', 'HEAVYSNIPER_MK2', 'MARKSMANRIFLE',
  'MARKSMANRIFLE_MK2', 'PRECISIONRIFLE', 'RPG', 'GRENADELAUNCHER', 'MINIGUN', 'FIREWORK', 'RAILGUN', 'HOMINGLAUNCHER', 'COMPACTLAUNCHER',
  'RAYMINIGUN', 'EMPLAUNCHER', 'GRENADE', 'BZGAS', 'MOLOTOV', 'STICKYBOMB', 'PROXMINE', 'SNOWBALL', 'PIPEBOMB', 'BALL', 'SMOKEGRENADE',
  'FLARE', 'PETROLCAN', 'FIREEXTINGUISHER', 'HAZARDCAN', 'PARACHUTE'];

const VEHICLES = ['adder', 'akuma', 'alpha', 'asea', 'asterope', 'baller', 'banshee', 'bati', 'bison', 'bjxl', 'blista', 'bmx', 'bobcatxl',
  'buccaneer', 'buffalo', 'buffalo2', 'bullet', 'burrito', 'buzzard', 'carbonizzare', 'cargobob', 'cavalcade', 'cheetah', 'cog55', 'cogcabrio',
  'comet2', 'coquette', 'cruiser', 'dilettante', 'dominator', 'double', 'dubsta', 'elegy2', 'emperor', 'entityxf', 'exemplar', 'f620', 'faggio',
  'felon', 'feltzer2', 'fq2', 'fugitive', 'futo', 'granger', 'gresley', 'habanero', 'hakuchou', 'hexer', 'infernus', 'ingot', 'intruder',
  'issi2', 'jackal', 'jester', 'journey', 'kuruma', 'landstalker', 'mesa', 'minivan', 'monroe', 'mule', 'ninef', 'oracle', 'panto', 'patriot',
  'pcj', 'penumbra', 'peyote', 'phoenix', 'picador', 'police', 'police2', 'police3', 'police4', 'policeb', 'polmav', 'pony', 'prairie', 'premier',
  'primo', 'radi', 'rancherxl', 'rapidgt', 'ratloader', 'rebel', 'regina', 'rhapsody', 'rocoto', 'romero', 'rumpo', 'sabregt', 'sadler',
  'sanchez', 'sandking', 'schafter2', 'schwarzer', 'sentinel', 'seminole', 'serrano', 'sultan', 'sultanrs', 'superd', 'surano', 'surfer',
  'surge', 't20', 'tailgater', 'taxi', 'tornado', 'tourbus', 'towtruck', 'tractor', 'trash', 'turismor', 'tyrus', 'vacca', 'vader', 'vigero',
  'voltic', 'voodoo', 'washington', 'windsor', 'xls', 'youga', 'zentorno', 'zion', 'ztype', 'ambulance', 'firetruk', 'fbi', 'fbi2', 'riot',
  'sheriff', 'sheriff2', 'maverick', 'frogger', 'swift', 'luxor', 'shamal', 'velum', 'dodo', 'seashark', 'jetmax', 'dinghy', 'speeder',
  'rhino', 'hydra', 'lazer', 'jet', 'cargoplane', 'blimp', 'titan', 'khanjali', 'oppressor', 'oppressor2', 'deluxo', 'thruster', 'kosatka',
  'toros', 'italigto', 'krieger', 'emerus', 'nero', 'tezeract', 'vagner', 'visione', 'xa21', 'pfister811', 'osiris', 'tempesta', 'reaper',
  'fmj', 'prototipo', 'sc1', 'sultan2', 'sultan3', 'elegy', 'comet3', 'comet6', 'jester4', 'zr350', 'calico', 'futo2', 'remus', 'euros', 'growler'];

const WEAPON_NAMES = new Map(WEAPONS.map((w) => [joaat('WEAPON_' + w), w.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())]));
const VEHICLE_NAMES = new Map(VEHICLES.map((v) => [joaat(v), v.toUpperCase()]));

const u32 = (h) => (Number(h) >>> 0);
export const weaponName = (h) => (!h ? '—' : WEAPON_NAMES.get(u32(h)) || '#' + u32(h).toString(16).toUpperCase());
export const vehicleName = (h) => (!h ? '—' : VEHICLE_NAMES.get(u32(h)) || '#' + u32(h).toString(16).toUpperCase());

export const FLAGS = { Invisible: 1, Invincible: 2, Frozen: 4, Dead: 8 };
export const hasFlag = (f, k) => (Number(f || 0) & FLAGS[k]) !== 0;
