import { api, qs } from '../api.js';
import { html, icon, fmt, $, empty, riskBar, debounce } from '../ui.js';
import { weaponName, vehicleName, hasFlag } from '../gta.js';

export default async function players(el, ctx) {
  const { store } = ctx;
  const t = store.settings.risk.thresholds;
  let tab = 'online';
  let online = [];
  let sort = { key: 'netId', dir: 1 };
  let filter = 'all';
  let q = '';
  let allOffset = 0;

  el.innerHTML = String(html`
    <div class="tabs"><button class="on" data-tab="online">${icon('activity')}Online <span class="n" id="n-online">0</span></button><button data-tab="all">${icon('users')}All players</button></div>
    <div class="row sp" style="margin-bottom:14px">
      <div class="row"><div class="search" style="width:300px">${icon('search')}<input class="input" id="q" placeholder="Search name, ID or identifier…" /></div>
        <select class="input" id="filter" style="width:190px"><option value="all">All players</option><option value="suspicious">Suspicious (risk ≥ ${t.medium})</option><option value="flagged">Detected this session</option></select></div>
      <span class="muted small" id="srv-note"></span>
    </div>
    <div class="card"><div class="table-wrap" id="table"></div></div>`);

  const cols = [
    ['netId', 'ID'], ['name', 'Player'], [null, 'Identifiers'], ['ping', 'Ping'], ['hp', 'Health'], ['ar', 'Armor'], [null, 'Weapon'],
    [null, 'Vehicle'], [null, 'Coordinates'], ['joinedAt', 'Session'], ['detections', 'Detections'], ['risk', 'Risk'], [null, 'Status'],
  ];
  const val = (p, k) => ({ hp: p.state && p.state.hp, ar: p.state && p.state.ar, ping: p.state && p.state.ping })[k] ?? p[k];

  function renderOnline() {
    const s = store.server();
    $('#srv-note', el).textContent = s ? `${s.name} · ${s.status === 'online' ? 'live' : 'offline'}` : 'No server selected';
    $('#n-online', el).textContent = online.length;
    let rows = online.filter((p) => {
      if (filter === 'suspicious' && p.risk < t.medium) return false;
      if (filter === 'flagged' && !p.sessionDetections) return false;
      if (!q) return true;
      const s2 = q.toLowerCase();
      return p.name.toLowerCase().includes(s2) || String(p.netId) === s2 || p.identifiers.some((i) => i.toLowerCase().includes(s2));
    });
    rows = rows.sort((a, b) => {
      const x = val(a, sort.key), y = val(b, sort.key);
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
    });
    if (!online.length) { $('#table', el).innerHTML = String(empty('No players online', s ? `${s.name} has no connected players right now.` : 'Select a server.', 'users')); return; }
    $('#table', el).innerHTML = String(html`<table class="t"><thead><tr>${cols.map(([k, l]) => html`<th class="${k ? 'sortable' : ''}" data-k="${k || ''}">${l}${sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`)}</tr></thead><tbody>
      ${rows.map((p) => {
        const st = p.state || {};
        const ids = p.identifiers.filter((i) => /^(steam|discord|license):/.test(i));
        const flags = [hasFlag(st.f, 'Frozen') && html`<span class="badge blue">Frozen</span>`, hasFlag(st.f, 'Dead') && html`<span class="badge">Dead</span>`,
          hasFlag(st.f, 'Invisible') && html`<span class="badge orange">Invisible</span>`, hasFlag(st.f, 'Invincible') && html`<span class="badge red">Invincible</span>`].filter(Boolean);
        return html`<tr class="click" data-id="${p.playerId}">
          <td class="num muted">${p.netId}</td><td><b>${p.name}</b></td>
          <td class="mono muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${ids.join('\n')}">${ids.map((i) => i.split(':')[0] + ':' + i.split(':')[1].slice(0, 10)).join(' · ')}</td>
          <td class="num ${st.ping > 200 ? 'warnc' : ''}">${st.ping ?? '—'}</td>
          <td class="num">${st.hp ?? '—'}</td><td class="num">${st.ar ?? '—'}</td>
          <td class="nowrap">${weaponName(st.w)}</td><td class="nowrap">${st.vm ? vehicleName(st.vm) : '—'}</td>
          <td class="mono muted nowrap">${st.x !== undefined ? `${Math.round(st.x)}, ${Math.round(st.y)}, ${Math.round(st.z)}` : '—'}</td>
          <td class="nowrap muted">${fmt.dur((Date.now() - new Date(p.joinedAt)) / 1000)}</td>
          <td class="num">${p.sessionDetections ? html`<span class="badge orange">${p.sessionDetections}</span>` : html`<span class="muted">0</span>`} <span class="muted tiny">/ ${p.detections}</span></td>
          <td>${riskBar(p.risk, t)}</td>
          <td>${flags.length ? flags : html`<span class="badge green">Connected</span>`}</td></tr>`;
      })}</tbody></table>`);
  }

  async function loadOnline() {
    if (!store.serverId) { online = []; renderOnline(); return; }
    online = await api.get(`/servers/${store.serverId}/players`);
    renderOnline();
  }

  async function loadAll() {
    const rows = await api.get('/players' + qs({ limit: 50, offset: allOffset, sort: sort.key === 'risk' ? 'risk' : 'recent' }));
    $('#table', el).innerHTML = String(rows.length || allOffset ? html`<table class="t"><thead><tr><th>Player</th><th>License</th><th>First seen</th><th>Last seen</th><th>Playtime</th><th>Detections</th><th class="sortable" data-k="risk">Risk</th></tr></thead><tbody>
      ${rows.map((p) => html`<tr class="click" data-id="${p.id}"><td><b>${p.last_name}</b></td><td class="mono muted">${p.license.slice(0, 22)}…</td>
        <td class="muted">${fmt.date(p.first_seen)}</td><td class="muted">${fmt.ago(p.last_seen)}</td><td>${fmt.dur(p.playtime_sec)}</td>
        <td class="num">${p.detections}</td><td>${riskBar(p.risk, t)}</td></tr>`)}</tbody></table>
      <div class="pager"><button class="btn sm" id="prev" ${allOffset ? '' : 'disabled'}>Previous</button><button class="btn sm" id="next" ${rows.length === 50 ? '' : 'disabled'}>Next</button></div>`
      : empty('No players yet', 'Players appear once they join a protected server.', 'users'));
    const pv = $('#prev', el), nx = $('#next', el);
    if (pv) pv.onclick = () => { allOffset = Math.max(0, allOffset - 50); loadAll(); };
    if (nx) nx.onclick = () => { allOffset += 50; loadAll(); };
  }

  el.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (th) {
      const k = th.dataset.k;
      sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: ['risk', 'detections', 'ping'].includes(k) ? -1 : 1 };
      return tab === 'online' ? renderOnline() : loadAll();
    }
    const tr = e.target.closest('tr[data-id]');
    if (tr) ctx.navigate('/players/' + tr.dataset.id);
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab;
      el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === tb));
      $('#filter', el).classList.toggle('hidden', tab !== 'online');
      tab === 'online' ? renderOnline() : loadAll();
    }
  });
  $('#q', el).addEventListener('input', debounce((e) => { q = e.target.value.trim(); if (tab === 'online') renderOnline(); }, 150));
  $('#filter', el).addEventListener('change', (e) => { filter = e.target.value; renderOnline(); });

  await loadOnline();
  // Live state from heartbeats (every few seconds); joins/leaves trigger a refetch for identifiers/risk.
  ctx.on('players:update', (u) => {
    if (u.serverId !== store.serverId || tab !== 'online') return;
    const bySession = new Map(u.players.map((p) => [p.sessionId, p]));
    let changed = false;
    for (const p of online) { const s = bySession.get(p.sessionId); if (s) { p.state = s; changed = true; } }
    if (changed) renderOnline();
  });
  const refetch = debounce(() => { if (tab === 'online') loadOnline(); }, 800);
  ctx.on('player:join', refetch); ctx.on('player:leave', refetch); ctx.on('detection', refetch);
}
