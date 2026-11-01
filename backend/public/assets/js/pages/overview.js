import { api, qs } from '../api.js';
import { html, icon, fmt, $, empty, toast, confirmDialog, busy } from '../ui.js';
import { timeChart, donut, PALETTE } from '../charts.js';

const ACT_ICON = { join: ['green', 'door'], leave: ['', 'logout'], detection: ['orange', 'radar'], ban_auto: ['red', 'ban'], ban_manual: ['red', 'gavel'],
  ban_blocked: ['red', 'lock'], unban: ['green', 'check'], admin: ['blue', 'userCog'], resource: ['orange', 'box'], server: ['blue', 'server'],
  ban_evasion_suspect: ['red', 'alert'], appeal: ['blue', 'file'] };

export default async function overview(el, ctx) {
  const { store } = ctx;
  let range = '24h';
  let scope = 'all';   // all servers | selected server

  el.innerHTML = String(html`
    <div class="row sp" style="margin-bottom:16px">
      <div class="row">
        <div class="btn-group" id="scope"><button data-v="all" class="on">All servers</button><button data-v="server">This server</button></div>
      </div>
      <div class="btn-group" id="range"><button data-v="24h" class="on">24H</button><button data-v="7d">7D</button><button data-v="30d">30D</button></div>
    </div>
    <div id="server-cards" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr));margin-bottom:16px"></div>
    <div id="stats" class="grid g4" style="margin-bottom:16px"></div>
    <div class="grid g-main" style="margin-bottom:16px">
      <div class="card"><div class="card-h"><h3>Player activity</h3><span class="legend"><span><i style="background:${PALETTE[0]}"></i>Online players</span></span></div><div class="card-b"><div id="ch-players"></div></div></div>
      <div class="card"><div class="card-h"><h3>Detection categories</h3></div><div class="card-b row" style="gap:18px;align-items:center"><div id="ch-cats"></div><div class="legend grow" id="cat-legend" style="flex-direction:column;gap:8px"></div></div></div>
    </div>
    <div class="grid g-main" style="margin-bottom:16px">
      <div class="card"><div class="card-h"><h3>Detections & bans</h3><span class="legend"><span><i style="background:${PALETTE[2]}"></i>Detections</span><span><i style="background:${PALETTE[1]}"></i>Bans</span></span></div><div class="card-b"><div id="ch-events"></div></div></div>
      <div class="card"><div class="card-h"><h3>Most frequent violations</h3></div><div class="card-b"><div class="hbar" id="top"></div></div></div>
    </div>
    <div class="grid g-main">
      <div class="card"><div class="card-h"><h3>Recent activity</h3><span class="live"><span class="dot on pulse"></span>Live</span></div><div class="card-b flush"><div class="list" id="activity" style="max-height:440px;overflow:auto"></div></div></div>
      <div class="card" id="quick"></div>
    </div>`);

  const stat = (label, ic, value, sub = '', color = '') => html`<div class="card stat"><div class="label">${icon(ic)}${label}</div>
    <div class="value" style="${color ? `color:${color}` : ''}">${value}</div><div class="sub">${sub}</div></div>`;

  function renderServers(d) {
    const servers = scope === 'server' ? d.servers.filter((s) => s.id === store.serverId) : d.servers;
    const online = servers.filter((s) => s.status === 'online');
    // Online servers first; offline ones are kept compact.
    const sorted = [...online, ...servers.filter((s) => s.status !== 'online')];
    $('#server-cards', el).innerHTML = String(servers.length ? html`${sorted.map((s) => html`
      <div class="card"><div class="card-b row sp" style="padding:14px 16px">
        <div class="row" style="gap:12px;min-width:0"><div class="ico ${s.status === 'online' ? 'green' : 'red'}">${icon('server')}</div>
          <div style="min-width:0"><div class="row" style="gap:8px"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.name}</b><span class="badge ${s.status === 'online' ? 'green' : 'red'}">${s.status === 'online' ? 'Online' : 'Offline'}</span></div>
          <div class="muted tiny" style="margin-top:2px">AC ${s.ac_version || '—'} · ${s.framework || '—'} · OneSync ${s.onesync ? 'on' : s.onesync === false ? 'OFF' : '—'}${s.status === 'online' && s.started_at ? ' · up ' + fmt.dur((Date.now() - new Date(s.started_at)) / 1000) : ''}</div></div></div>
        <div style="text-align:right;flex:none"><div style="font-size:20px;font-weight:700">${s.status === 'online' ? s.player_count : 0}<span class="muted" style="font-size:13px">/${s.max_players}</span></div><div class="muted tiny">PLAYERS</div></div>
      </div></div>`)}` : html`<div class="card">${empty('No servers yet', html`<div>Create one in <a href="#/servers">Server Management</a> and install the resource.</div>`, 'server')}</div>`);
  }

  async function load() {
    const d = await api.get('/overview' + qs({ range, serverId: scope === 'server' ? store.serverId : '' }));
    const t = d.totals;
    renderServers(d);
    $('#stats', el).innerHTML = String(html`
      ${stat('Players online', 'users', fmt.num(t.players_online), `${fmt.num(t.players_total)} unique players total`)}
      ${stat('Detections today', 'radar', fmt.num(t.detections_today), `${fmt.num(t.detections_total)} total`, t.detections_today ? 'var(--orange)' : '')}
      ${stat('Bans today', 'ban', fmt.num(t.bans_today), `${fmt.num(t.bans_active)} active · ${fmt.num(t.bans_total)} total`, t.bans_today ? 'var(--red)' : '')}
      ${stat('Suspicious players', 'alert', fmt.num(t.suspicious_players), `${d.protection.modulesActive}/${d.protection.modulesTotal} protection modules active · ${t.monitoring_active} monitoring`)}`);

    const now = Date.now();
    const span = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6 }[d.range.key];
    timeChart($('#ch-players', el), [{ name: 'Players', color: PALETTE[0], points: d.series.players.map((p) => ({ t: new Date(p.t).getTime(), v: p.v })) }],
      { from: now - span, to: now, stepped: true, extend: true, height: 230, xFormat: d.range.key === '24h' ? undefined : (x) => new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) });
    timeChart($('#ch-events', el), [
      { name: 'Detections', color: PALETTE[2], points: d.series.detections.map((p) => ({ t: new Date(p.t).getTime(), v: p.v })) },
      { name: 'Bans', color: PALETTE[1], points: d.series.bans.map((p) => ({ t: new Date(p.t).getTime(), v: p.v })) },
    ], { from: now - span, to: now, step: d.range.eventBucket * 1000, fillZero: true, height: 210,
      xFormat: d.range.key === '24h' ? undefined : (x) => new Date(x).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) });

    const meta = await getMeta();
    const items = d.categories.map((c, i) => ({ label: meta.categories[c.category] || c.category, value: c.v, color: PALETTE[i % PALETTE.length] }));
    donut($('#ch-cats', el), items);
    $('#cat-legend', el).innerHTML = String(items.length ? html`${items.map((i) => html`<span><i style="background:${i.color}"></i>${i.label} <b>${i.value}</b></span>`)}` : html`<span class="muted">No detections in this period</span>`);
    const max = Math.max(1, ...d.topDetections.map((x) => x.v));
    $('#top', el).innerHTML = String(d.topDetections.length ? html`${d.topDetections.map((x) => html`<div class="r"><span>${x.name}</span><b>${x.v}</b>
      <div class="track"><i style="width:${(x.v / max) * 100}%"></i></div></div>`)}` : html`<div class="muted">No detections in this period</div>`);
    $('#activity', el).innerHTML = '';
    d.activity.slice().reverse().forEach(addActivity);
    if (!d.activity.length) $('#activity', el).innerHTML = String(empty('No activity yet', 'Events appear here live as they happen.', 'activity'));
  }

  let metaCache;
  async function getMeta() { return metaCache || (metaCache = await api.get('/meta')); }

  function addActivity(a) {
    const list = $('#activity', el);
    if (!list) return;
    const e = list.querySelector('.empty'); if (e) e.remove();
    const [c, ic] = ACT_ICON[a.kind] || ['', 'info'];
    const link = a.data && a.data.banId ? `#/bans/${a.data.banId}` : a.data && a.data.playerId ? `#/players/${a.data.playerId}` : null;
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = String(html`<div class="ico ${c}">${icon(ic)}</div><div class="grow">${link ? html`<a href="${link}" style="color:inherit">${a.message}</a>` : a.message}</div>
      <span class="muted tiny nowrap" title="${fmt.date(a.created_at || a.createdAt)}">${fmt.ago(a.created_at || a.createdAt)}</span>`);
    list.prepend(div);
    while (list.children.length > 60) list.lastChild.remove();
  }

  // Quick actions: only rendered for permitted users; all wired to real commands.
  function renderQuick() {
    const q = $('#quick', el);
    const s = store.server();
    const canClean = store.can('entities.cleanup'); const canAnn = store.can('announce.send');
    if (!s || (!canClean && !canAnn)) { q.classList.add('hidden'); return; }
    q.innerHTML = String(html`<div class="card-h"><h3>Server actions</h3><span class="muted small">${s.name}</span></div><div class="card-b col">
      ${canClean ? html`<button class="btn" data-clean="vehicles">${icon('car')}Delete vehicles</button><button class="btn" data-clean="peds">${icon('person')}Delete peds</button>
      <button class="btn" data-clean="objects">${icon('box')}Delete objects</button>` : ''}
      ${canAnn ? html`<div class="col" style="margin-top:6px;gap:8px"><input class="input" id="ann-title" placeholder="Announcement title" maxlength="80"/>
      <textarea class="input" id="ann-text" placeholder="Message to all players" maxlength="500" style="min-height:70px"></textarea>
      <button class="btn primary" id="ann">${icon('bell')}Send announcement</button></div>` : ''}</div>`);
    q.querySelectorAll('[data-clean]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete all ${b.dataset.clean}?`, `This removes every networked ${b.dataset.clean.slice(0, -1)} on ${s.name}${b.dataset.clean === 'vehicles' ? ' (vehicles with a player driver are kept)' : ''}.`, 'Delete'))) return;
      const r = await busy(b, () => api.post(`/servers/${s.id}/cleanup`, { kind: b.dataset.clean }));
      toast(r.status === 'done' ? { type: 'success', text: `${r.result.deleted} ${b.dataset.clean} deleted` } : { type: 'error', text: r.status === 'pending' ? 'Server did not respond (offline?)' : (r.result && r.result.error) || 'Failed' });
    }));
    const ann = q.querySelector('#ann');
    if (ann) ann.addEventListener('click', async () => {
      const text = q.querySelector('#ann-text').value.trim();
      if (!text) return;
      const r = await busy(ann, () => api.post(`/servers/${s.id}/announce`, { title: q.querySelector('#ann-title').value || 'Announcement', text }));
      if (r.status === 'done') { toast({ type: 'success', text: 'Announcement sent' }); q.querySelector('#ann-text').value = ''; } else toast({ type: 'error', text: 'Server did not respond' });
    });
  }

  el.querySelectorAll('#range button').forEach((b) => b.addEventListener('click', () => { el.querySelectorAll('#range button').forEach((x) => x.classList.toggle('on', x === b)); range = b.dataset.v; load(); }));
  el.querySelectorAll('#scope button').forEach((b) => b.addEventListener('click', () => { el.querySelectorAll('#scope button').forEach((x) => x.classList.toggle('on', x === b)); scope = b.dataset.v; load(); }));

  await load();
  renderQuick();
  ctx.on('activity', addActivity);
  let pending = null;
  const soon = () => { clearTimeout(pending); pending = setTimeout(load, 1500); };
  ctx.on('detection', soon); ctx.on('ban', soon); ctx.on('server:status', soon);
  const timer = setInterval(load, 60000);
  return () => { clearInterval(timer); clearTimeout(pending); };
}
