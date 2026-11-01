import { api } from '../api.js';
import { html, icon, $, riskColor, fmt, debounce } from '../ui.js';
import { MapView } from '../mapview.js';
import { weaponName, vehicleName, hasFlag } from '../gta.js';

export default async function mapPage(el, ctx) {
  const { store } = ctx;
  const t = store.settings.risk.thresholds;
  el.innerHTML = String(html`
    <div class="map-wrap"><canvas id="cv"></canvas>
      <div class="map-panel"><div style="padding:12px;border-bottom:1px solid var(--line)"><div class="row sp" style="margin-bottom:8px"><b id="cnt">Players</b><span class="live"><span class="dot on pulse"></span>Live</span></div>
        <div class="search">${icon('search')}<input class="input sm" id="q" placeholder="Search players…"/></div></div><div class="list" id="plist"></div></div>
      <div class="map-ctl"><button class="btn" id="zi" title="Zoom in">${icon('zoomIn')}</button><button class="btn" id="zo" title="Zoom out">${icon('zoomOut')}</button><button class="btn" id="fit" title="Fit">${icon('map')}</button></div>
      <div class="map-card hidden" id="card"></div>
      <div class="map-note hidden" id="note"></div>
    </div>`);

  const mv = new MapView($('#cv', el), store.settings.map);
  let players = [];
  let q = '';
  const alerts = new Map();   // sessionId -> until ms (flash ring after detection)

  function color(p) { return p.risk >= t.high ? '#ef4f55' : p.risk >= t.medium ? '#f2a33a' : '#62aaea'; }

  function sync() {
    const now = Date.now();
    const vis = players.filter((p) => p.state && (!q || p.name.toLowerCase().includes(q) || String(p.netId) === q));
    mv.setMarkers(vis.map((p) => ({
      id: p.sessionId, x: p.state.x, y: p.state.y, heading: p.state.h, label: `[${p.netId}] ${p.name}`, color: color(p),
      ring: (alerts.get(p.sessionId) || 0) > now ? '#ef4f55' : p.sessionDetections ? 'rgba(242,163,58,.8)' : null,
    })));
    $('#cnt', el).textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
    $('#plist', el).innerHTML = String(html`${vis.map((p) => html`<div class="list-item ${mv.selected === p.sessionId ? 'sel' : ''}" data-s="${p.sessionId}">
      <span class="dot" style="background:${color(p)}"></span><span class="muted small">[${p.netId}]</span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
      ${p.sessionDetections ? html`<span class="badge orange">${p.sessionDetections}</span>` : ''}${p.state.vm ? icon('car') : ''}</div>`)}`
      || '<div class="empty small">No players online</div>');
    renderCard();
    if (!mv.imgOk && store.can('settings.manage')) {
      const n = $('#note', el);
      n.classList.remove('hidden');
      n.innerHTML = String(html`<div class="notice warn">${icon('info')}<span>No map image found at <code>${store.settings.map.image}</code> — showing a calibrated coordinate grid. Add your GTA V map image (see Settings → Map).</span></div>`);
    }
  }

  function renderCard() {
    const p = players.find((x) => x.sessionId === mv.selected);
    const c = $('#card', el);
    if (!p || !p.state) { c.classList.add('hidden'); return; }
    const s = p.state;
    c.classList.remove('hidden');
    c.innerHTML = String(html`<div class="row sp"><b style="font-size:14.5px">${p.name}</b><span class="muted">[${p.netId}]</span></div>
      <div class="kv" style="grid-template-columns:repeat(2,1fr);margin:12px 0">
        <div><span>Health / Armor</span><b>${s.hp} / ${s.ar}</b></div><div><span>Risk</span><b style="color:${riskColor(p.risk, t)}">${p.risk}/100</b></div>
        <div><span>Weapon</span><b>${weaponName(s.w)}</b></div><div><span>Vehicle</span><b>${s.vm ? vehicleName(s.vm) : 'On foot'}</b></div>
        <div><span>Speed</span><b>${Math.round(s.s * 3.6)} km/h</b></div><div><span>Ping</span><b>${s.ping} ms</b></div>
      </div>
      <div class="mono muted small" style="margin-bottom:10px">${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)} · bucket ${s.b}${hasFlag(s.f, 'Frozen') ? ' · frozen' : ''}</div>
      <div class="row"><a class="btn sm primary grow" href="#/players/${p.playerId}">${icon('users')}Open profile</a>${store.can('players.monitor') ? html`<a class="btn sm" href="#/monitoring?player=${p.playerId}">${icon('monitor')}</a>` : ''}</div>
      <div class="muted tiny" style="margin-top:8px">Session ${fmt.dur((Date.now() - new Date(p.joinedAt)) / 1000)} · ${p.sessionDetections} detection(s) this session</div>`);
  }

  async function load() {
    players = store.serverId ? await api.get(`/servers/${store.serverId}/players`) : [];
    sync();
  }

  mv.onSelect = (sid) => { mv.selected = sid; sync(); };
  el.addEventListener('click', (e) => {
    const it = e.target.closest('[data-s]');
    if (it) { const p = players.find((x) => x.sessionId === +it.dataset.s); mv.selected = p.sessionId; mv.centerOn(p.state.x, p.state.y); sync(); }
  });
  $('#zi', el).onclick = () => mv.zoom(1.4); $('#zo', el).onclick = () => mv.zoom(1 / 1.4); $('#fit', el).onclick = () => mv.fit();
  $('#q', el).addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); sync(); }, 120));

  await load();
  setTimeout(sync, 800);   // re-render once the map image has loaded (or failed)
  ctx.on('players:update', (u) => {
    if (u.serverId !== store.serverId) return;
    const by = new Map(u.players.map((p) => [p.sessionId, p]));
    for (const p of players) { const s = by.get(p.sessionId); if (s) p.state = s; }
    sync();
  });
  const refetch = debounce(load, 700);
  ctx.on('player:join', refetch); ctx.on('player:leave', refetch);
  ctx.on('detection', (d) => {
    const p = players.find((x) => x.sessionId === d.session_id);
    if (p) { p.sessionDetections++; p.risk = Math.round(d.risk_after); alerts.set(p.sessionId, Date.now() + 15000); sync(); }
  });
  const tick = setInterval(sync, 5000);   // expire alert rings
  return () => { clearInterval(tick); mv.unbind(); };
}
