import { api } from '../api.js';
import { html, icon, toast, busy, confirmDialog, empty } from '../ui.js';

const LEVELS = [
  { key: 'relaxed', name: 'Relaxed', color: 'var(--green)', desc: 'Monitor first. Only unambiguous cheats (invisible explosions, blocked models, trap events…) are banned; everything else warns staff.' },
  { key: 'balanced', name: 'Balanced', color: 'var(--accent2)', desc: 'Recommended defaults. Strong server-verified signals ban, behavioural ones kick, weak ones warn.' },
  { key: 'strict', name: 'Strict', color: 'var(--orange)', desc: 'Every server-verified detection that would kick now bans. Client signals that are high severity kick.' },
  { key: 'maximum', name: 'Maximum', color: 'var(--red)', desc: 'Zero tolerance: all server-verified detections ban, all client signals kick, all detections enabled. Expect more false positives.' },
];

const EXPLOSIONS = ['Grenade', 'Grenade launcher', 'Sticky bomb', 'Molotov', 'Rocket', 'Tank shell', 'Hi-octane', 'Car', 'Plane', 'Petrol pump', 'Bike', 'Steam', 'Flame', 'Water hydrant', 'Gas canister', 'Boat', 'Ship destroy', 'Truck', 'Bullet', 'Smoke launcher', 'Smoke grenade', 'BZ gas', 'Flare', 'Gas canister 2', 'Extinguisher', 'Programmable AR', 'Train', 'Barrel', 'Propane', 'Blimp', 'Flame explode', 'Tanker', 'Plane rocket', 'Vehicle bullet', 'Gas tank', 'Bird crap', 'Railgun', 'Blimp 2', 'Firework', 'Snowball', 'Proximity mine', 'Valkyrie cannon', 'Air defence', 'Pipe bomb', 'Vehicle mine', 'Explosive ammo', 'APC shell', 'Cluster bomb', 'Gas bomb', 'Incendiary bomb', 'Standard bomb', 'Torpedo', 'Torpedo (underwater)', 'Bombushka cannon', 'Cluster bomb 2', 'Hunter barrage', 'Hunter cannon', 'Rogue cannon', 'Mine (underwater)', 'Orbital cannon', 'Standard bomb (wide)', 'Explosive ammo (shotgun)', 'Oppressor 2 cannon', 'Kinetic mortar', 'Kinetic mine', 'EMP mine', 'Spike mine', 'Slick mine', 'Tar mine', 'Script drone', 'Raygun', 'Buried mine', 'Script missile'];

const PRESETS = {
  weapons: { 'Futuristic & heavy': ['WEAPON_RAILGUN', 'WEAPON_RAILGUNXM3', 'WEAPON_RAYMINIGUN', 'WEAPON_RAYCARBINE', 'WEAPON_RAYPISTOL', 'WEAPON_MINIGUN', 'WEAPON_HOMINGLAUNCHER', 'WEAPON_EMPLAUNCHER'],
    'Explosive launchers': ['WEAPON_RPG', 'WEAPON_GRENADELAUNCHER', 'WEAPON_COMPACTLAUNCHER', 'WEAPON_FIREWORK'] },
  models: { 'Military vehicles': ['rhino', 'khanjali', 'hydra', 'lazer', 'jet', 'titan', 'cargoplane', 'blimp', 'savage', 'hunter', 'akula', 'oppressor', 'oppressor2', 'deluxo', 'apc', 'halftrack', 'insurgent', 'insurgent3', 'chernobog', 'thruster'],
    'Troll props': ['p_spinning_anus_s', 'prop_windmill_01', 'stt_prop_stunt_track_dwslope30', 'prop_beach_fire', 'xs_prop_hamburgher_wl', 'prop_cs_dildo_01', 'stt_prop_ramp_jump_xxl', 'prop_container_01a', 'p_crahsed_heli_s', 'prop_rock_4_big2', 'dt1_05_build1_damage', 'prop_gold_cont_01', 'prop_med_jet_01', 'prop_fnclink_05crnr1', 'sr_prop_spec_tube_xxs_01a'] },
};

export default async function rules(el, ctx) {
  const { store } = ctx;
  const canEdit = store.can('detections.configure');
  const dis = canEdit ? '' : 'disabled';
  let cfg, settings, library, servers, zones, online = [];

  async function load() {
    [cfg, settings, library, servers, zones] = await Promise.all([api.get('/detections/config'), api.get('/settings'), api.get('/detections/exploit-library'), api.get('/servers'), api.get('/zones')]);
    online = store.serverId && store.can('players.view') ? await api.get(`/servers/${store.serverId}/players`).catch(() => []) : [];
    render();
  }
  const det = (key) => cfg.detections.find((d) => d.key === key);
  const list = (key, field) => [...(det(key).config.threshold[field] || [])];
  const runningResources = () => new Set(servers.filter((s) => s.status === 'online').flatMap((s) => (s.resources || []).filter((r) => r.state === 'started').map((r) => r.name)));

  async function saveList(key, field, value, btn) {
    const r = await busy(btn || document.createElement('button'), () => api.put('/detections/config/' + key, { threshold: { [field]: value } }));
    det(key).config.threshold[field] = r.config.threshold[field];
    toast({ type: 'success', text: 'Saved — active on every server within seconds' });
    render();
  }

  function chips(key, field, upper) {
    const items = list(key, field);
    return html`<div class="row wrap" style="gap:6px">${items.length ? items.map((v) => html`<span class="badge" style="padding:4px 6px 4px 10px">${v}${canEdit ? html`<button class="btn ghost xs" style="height:18px;padding:0 4px" data-rm="${key}|${field}|${v}">${icon('x')}</button>` : ''}</span>`) : html`<span class="muted small">Nothing blocked</span>`}</div>
      ${canEdit ? html`<form class="row" style="margin-top:12px" data-add="${key}|${field}|${upper ? 'U' : 'L'}"><input class="input sm" style="max-width:320px" name="v" placeholder="${upper ? 'WEAPON_NAME' : 'model_name'}" maxlength="64"/><button class="btn sm primary">${icon('plus')}Block</button></form>` : ''}`;
  }

  function render() {
    const level = settings.general.protectionLevel || 'balanced';
    const events = list('honeypot_event', 'events');
    const names = new Set(events.map((e) => e.name));
    const running = runningResources();
    const types = new Set(list('explosion_blocked_type', 'types'));
    el.innerHTML = String(html`<div class="col" style="gap:16px;max-width:1200px">
      <div class="card"><div class="card-h"><div><h3>Protection strength</h3><div class="muted small">One click sets the action of all ${cfg.detections.length} detections. Fine-tune any single detection in <a href="#/detections?tab=config">Detections → Configuration</a>.</div></div></div>
        <div class="card-b grid g4">${LEVELS.map((l) => html`<button class="card" data-level="${l.key}" ${dis} style="text-align:left;padding:16px;cursor:${canEdit ? 'pointer' : 'default'};border-color:${level === l.key ? l.color : 'var(--line)'};background:${level === l.key ? 'var(--panel2)' : 'var(--panel)'}">
          <div class="row sp"><b style="font-size:15px;color:${l.color}">${l.name}</b>${level === l.key ? html`<span class="badge green">${icon('check')}Active</span>` : ''}</div>
          <div class="muted small" style="margin-top:8px;line-height:1.5">${l.desc}</div></button>`)}</div>
        <div class="card-b" style="padding-top:0"><div class="notice">${icon('shieldCheck')}<span>At every level, client-side signals can never ban on their own and evidence is captured before enforcement.</span></div></div></div>


      <div class="card"><div class="card-h"><div><h3>Exempt zones</h3><div class="muted small">Areas where the chosen detections never fire — e.g. a military training ground where a script hands out heavy weapons. Optionally only for some jobs.</div></div><span class="badge">${zones.length}</span></div>
        <div class="card-b">
          ${zones.length ? html`<table class="t" style="margin-bottom:14px"><thead><tr><th>Zone</th><th>Position</th><th>Radius</th><th>Skipped detections</th><th>Jobs</th><th>Active</th><th></th></tr></thead><tbody>
            ${zones.map((zn, i) => html`<tr><td><b>${zn.name}</b></td><td class="mono muted small">${Math.round(zn.x)}, ${Math.round(zn.y)}, ${Math.round(zn.z)}</td><td>${zn.radius} m</td>
              <td class="small">${zn.detections.includes('all') ? html`<span class="badge orange">All detections</span>` : zn.detections.map((k) => (det(k) ? det(k).name : k)).join(', ')}</td>
              <td class="small">${zn.jobs.length ? zn.jobs.join(', ') : html`<span class="muted">Everyone</span>`}</td>
              <td><label class="switch"><input type="checkbox" data-zon="${i}" ${zn.enabled !== false ? 'checked' : ''} ${dis}/><span></span></label></td>
              <td>${canEdit ? html`<button class="btn xs" data-zrm="${i}">${icon('x')}</button>` : ''}</td></tr>`)}</tbody></table>` : html`<div class="muted small" style="margin-bottom:14px">No exempt zones.</div>`}
          ${canEdit ? html`<form id="zone-add" class="col" style="gap:10px">
            <div class="row wrap" style="gap:8px">
              <input class="input" name="name" placeholder="Zone name, e.g. Military training" maxlength="48" style="max-width:240px" required/>
              <input class="input" name="x" placeholder="X" style="max-width:110px" inputmode="decimal" required/>
              <input class="input" name="y" placeholder="Y" style="max-width:110px" inputmode="decimal" required/>
              <input class="input" name="z" placeholder="Z" style="max-width:110px" inputmode="decimal" required/>
              <input class="input" name="radius" placeholder="Radius (m)" style="max-width:120px" inputmode="decimal" value="100" required/>
              ${online.length ? html`<select class="input" id="zone-pos" style="max-width:240px"><option value="">Use position of player…</option>${online.filter((o) => o.state).map((o) => html`<option value="${o.netId}">[${o.netId}] ${o.name}</option>`)}</select>` : ''}
            </div>
            <div class="row wrap" style="gap:8px">
              <select class="input" name="mode" id="zone-mode" style="max-width:240px"><option value="all">Skip all detections</option><option value="pick">Skip only chosen detections</option></select>
              <input class="input" name="jobs" placeholder="Jobs (optional, comma separated) e.g. army, police" maxlength="300" style="max-width:360px"/>
              <button class="btn primary">${icon('plus')}Add zone</button>
            </div>
            <div id="zone-pick" style="display:none;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 14px">
              ${cfg.detections.map((d) => html`<label class="row small" style="gap:8px"><input type="checkbox" value="${d.key}" ${['weapon_blacklist', 'blocked_model', 'explosion_blocked_type', 'weapon_mismatch'].includes(d.key) ? 'checked' : ''}/>${d.name}</label>`)}
            </div></form>` : ''}
          <div class="notice" style="margin-top:14px">${icon('info')}<span>In-game, open this page through <code>/adv</code> and pick yourself in “Use position of player” to drop the zone where you stand.</span></div>
        </div></div>
      <div class="card"><div class="card-h"><div><h3>Blocked events (exploits)</h3><div class="muted small">A cheat menu that triggers one of these events is caught and handled by the <b>${det('honeypot_event').config.action.toUpperCase()}</b> action. Paste the name of any exploited event.</div></div><span class="badge">${events.length}</span></div>
        <div class="card-b">
          ${canEdit ? html`<form class="row wrap" id="ev-add" style="gap:8px;margin-bottom:14px"><input class="input" name="name" placeholder="event name, e.g. esx_garbagejob:pay" style="max-width:340px" maxlength="128"/>
            <input class="input" name="owner" placeholder="owner resource (optional)" style="max-width:220px" maxlength="64"/><input class="input" name="note" placeholder="note (optional)" style="max-width:240px" maxlength="120"/>
            <button class="btn primary">${icon('plus')}Block event</button></form>` : ''}
          ${events.length ? html`<table class="t"><thead><tr><th>Event</th><th>Owner resource</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>
            ${events.map((e) => { const prefix = e.name.split(':')[0]; const live = (e.unlessResource && running.has(e.unlessResource)) || running.has(prefix);
              return html`<tr><td class="mono">${e.name}</td><td class="muted">${e.unlessResource || '—'}</td><td class="muted small">${e.note || ''}</td>
              <td>${live ? html`<span class="badge orange" title="A resource that may use this event is running — the trap stays off to protect legit players. Protect that resource with EventGuard.">Paused (resource running)</span>` : html`<span class="badge green">Armed</span>`}</td>
              <td>${canEdit ? html`<button class="btn xs" data-rmev="${e.name}">${icon('x')}</button>` : ''}</td></tr>`; })}</tbody></table>` : empty('No blocked events', '', 'shield')}
          <details style="margin-top:16px"><summary class="small" style="cursor:pointer;color:var(--text2)">Known exploit library (${library.length})</summary>
            <table class="t" style="margin-top:8px"><tbody>${library.map((e) => html`<tr><td class="mono">${e.name}</td><td class="muted small">${e.note}</td>
              <td style="text-align:right">${names.has(e.name) ? html`<span class="badge green">Added</span>` : canEdit ? html`<button class="btn xs" data-lib="${e.name}">${icon('plus')}Add</button>` : ''}</td></tr>`)}</tbody></table>
            ${canEdit ? html`<button class="btn sm" id="lib-all" style="margin-top:10px">Add all</button>` : ''}</details>
          <div class="notice warn" style="margin-top:14px">${icon('info')}<span>Traps only work for events <b>no running script uses</b>. If an exploit is inside a script you run, add <code>@AdvancedAC/shared/eventguard.lua</code> to that script and mark the event with <code>Guard.serverOnly('event')</code> — see docs/INSTALL.md.</span></div>
        </div></div>

      <div class="grid g2">
        <div class="card"><div class="card-h"><div><h3>Blocked weapons</h3><div class="muted small">Holding one → ${det('weapon_blacklist').config.action.toUpperCase()}</div></div></div><div class="card-b">${chips('weapon_blacklist', 'weapons', true)}
          ${canEdit ? html`<div class="row wrap" style="margin-top:10px;gap:6px">${Object.keys(PRESETS.weapons).map((k) => html`<button class="btn xs" data-preset="weapon_blacklist|weapons|${k}">+ ${k}</button>`)}</div>` : ''}</div></div>
        <div class="card"><div class="card-h"><div><h3>Blocked models</h3><div class="muted small">Spawning one is cancelled → ${det('blocked_model').config.action.toUpperCase()}</div></div></div><div class="card-b">${chips('blocked_model', 'models', false)}
          ${canEdit ? html`<div class="row wrap" style="margin-top:10px;gap:6px">${Object.keys(PRESETS.models).map((k) => html`<button class="btn xs" data-preset="blocked_model|models|${k}">+ ${k}</button>`)}</div>` : ''}</div></div>
      </div>

      <div class="card"><div class="card-h"><div><h3>Blocked explosion types</h3><div class="muted small">Cancelled before other players see them → ${det('explosion_blocked_type').config.action.toUpperCase()}</div></div>
        ${canEdit ? html`<button class="btn sm primary" id="save-expl">${icon('check')}Save</button>` : ''}</div>
        <div class="card-b" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px 14px">
          ${EXPLOSIONS.map((n, i) => html`<label class="row small" style="gap:8px"><input type="checkbox" data-expl="${i}" ${types.has(i) ? 'checked' : ''} ${dis}/><span class="muted mono" style="width:22px">${i}</span>${n}</label>`)}</div></div>
    </div>`);
  }

  async function saveZones(list, btn) {
    zones = await busy(btn || document.createElement('button'), () => api.put('/zones', list));
    toast({ type: 'success', text: 'Zones saved — active on every server within seconds' });
    render();
  }
  el.addEventListener('change', (e) => {
    if (e.target.id === 'zone-mode') { $id('zone-pick').style.display = e.target.value === 'pick' ? 'grid' : 'none'; return; }
    if (e.target.id === 'zone-pos') {
      const o = online.find((x) => String(x.netId) === e.target.value); if (!o || !o.state) return;
      const f = $id('zone-add'); f.x.value = o.state.x.toFixed(1); f.y.value = o.state.y.toFixed(1); f.z.value = o.state.z.toFixed(1);
      return;
    }
    const zon = e.target.closest('[data-zon]');
    if (zon && canEdit) { const list = zones.map((x) => ({ ...x })); list[+zon.dataset.zon].enabled = zon.checked; saveZones(list); }
  });
  const $id = (id) => el.querySelector('#' + id);

  el.addEventListener('click', async (e) => {
    const zrm = e.target.closest('[data-zrm]');
    if (zrm) { if (!(await confirmDialog('Delete zone?', zones[+zrm.dataset.zrm].name, 'Delete', true))) return; return saveZones(zones.filter((_, i) => i !== +zrm.dataset.zrm), zrm); }
    const lv = e.target.closest('[data-level]');
    if (lv && canEdit) {
      const l = LEVELS.find((x) => x.key === lv.dataset.level);
      if (!(await confirmDialog(`Switch to ${l.name}?`, l.desc + ' This changes the action of every detection on all servers immediately.', 'Apply', l.key === 'maximum'))) return;
      await api.post('/detections/config/preset', { level: l.key });
      toast({ type: 'success', text: `${l.name} protection active` });
      return load();
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { const [key, field, v] = rm.dataset.rm.split('|'); return saveList(key, field, list(key, field).filter((x) => String(x) !== v), rm); }
    const rmev = e.target.closest('[data-rmev]');
    if (rmev) return saveList('honeypot_event', 'events', list('honeypot_event', 'events').filter((x) => x.name !== rmev.dataset.rmev), rmev);
    const lib = e.target.closest('[data-lib]');
    if (lib) { const item = library.find((x) => x.name === lib.dataset.lib); return saveList('honeypot_event', 'events', [...list('honeypot_event', 'events'), item], lib); }
    if (e.target.closest('#lib-all')) {
      const cur = list('honeypot_event', 'events'); const have = new Set(cur.map((x) => x.name));
      return saveList('honeypot_event', 'events', [...cur, ...library.filter((x) => !have.has(x.name))], e.target.closest('#lib-all'));
    }
    const pr = e.target.closest('[data-preset]');
    if (pr) { const [key, field, name] = pr.dataset.preset.split('|'); return saveList(key, field, [...new Set([...list(key, field), ...PRESETS[field][name]])], pr); }
    if (e.target.closest('#save-expl')) {
      return saveList('explosion_blocked_type', 'types', [...el.querySelectorAll('[data-expl]:checked')].map((c) => +c.dataset.expl), e.target.closest('#save-expl'));
    }
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'zone-add') {
      const n = (v) => Number(String(v).replace(',', '.'));
      const zn = { name: f.name.value.trim(), x: n(f.x.value), y: n(f.y.value), z: n(f.z.value), radius: n(f.radius.value), enabled: true,
        detections: f.mode.value === 'all' ? ['all'] : [...el.querySelectorAll('#zone-pick input:checked')].map((c) => c.value),
        jobs: f.jobs.value.split(',').map((j) => j.trim()).filter(Boolean) };
      if (![zn.x, zn.y, zn.z, zn.radius].every(Number.isFinite) || !zn.name) return toast({ type: 'error', text: 'Fill in name, X, Y, Z and radius' });
      if (f.mode.value === 'pick' && !zn.detections.length) return toast({ type: 'error', text: 'Choose at least one detection' });
      return saveZones([...zones, zn], f.querySelector('button.primary'));
    }
    if (f.id === 'ev-add') {
      const name = f.name.value.trim();
      if (!/^[\w:.\-@/]{1,128}$/.test(name)) return toast({ type: 'error', text: 'Invalid event name' });
      return saveList('honeypot_event', 'events', [...list('honeypot_event', 'events').filter((x) => x.name !== name), { name, ...(f.owner.value.trim() ? { unlessResource: f.owner.value.trim() } : {}), ...(f.note.value.trim() ? { note: f.note.value.trim() } : {}) }], f.querySelector('button'));
    }
    if (f.dataset.add) {
      const [key, field, mode] = f.dataset.add.split('|');
      let v = f.v.value.trim(); if (!v) return;
      v = mode === 'U' ? v.toUpperCase() : v.toLowerCase();
      if (mode === 'U' && !v.startsWith('WEAPON_')) v = 'WEAPON_' + v;
      return saveList(key, field, [...new Set([...list(key, field), v])], f.querySelector('button'));
    }
  });
  await load();
}
