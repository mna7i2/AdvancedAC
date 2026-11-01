import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, toast, modal, busy, debounce } from '../ui.js';

export default async function monitoring(el, ctx) {
  const { store } = ctx;
  const t = store.settings.risk.thresholds;
  let players = [];
  let monitors = [];
  const filters = { suspicious: false, recent: false, lowPlaytime: false };
  let q = '';
  let interval = store.settings.monitoring.defaultIntervalMs;

  el.innerHTML = String(html`
    <div class="notice" style="margin-bottom:14px">${icon('info')}<span>FiveM resources cannot stream video. Monitoring captures a live screenshot every few seconds via <b>screenshot-basic</b>. Every start/stop is written to the audit log.</span></div>
    <div class="mon-layout">
      <div class="col" style="min-height:0">
        <div class="row sp"><div class="tabs" style="margin:0;border:0"><button class="on" data-tab="live">${icon('activity')}Live <span class="n" id="n-live">0</span></button><button data-tab="rec">${icon('folder')}Recordings</button></div>
          <div class="row"><span class="muted small">Interval</span><select class="input sm" id="interval" style="width:110px">
            ${[1000, 2000, 3000, 5000, 10000].filter((v) => v >= store.settings.monitoring.minIntervalMs).map((v) => html`<option value="${v}" ${v === interval ? 'selected' : ''}>${v / 1000}s</option>`)}</select></div></div>
        <div class="mon-grid" id="grid"></div>
      </div>
      <div class="card col" style="min-height:0;gap:0">
        <div style="padding:12px;border-bottom:1px solid var(--line)"><div class="search">${icon('search')}<input class="input sm" id="q" placeholder="Search…"/></div></div>
        <div class="list" id="plist" style="overflow:auto;flex:1"></div>
        <div style="padding:12px;border-top:1px solid var(--line)" class="col">
          <label class="row sp small"><span>Suspicious only</span><label class="switch"><input type="checkbox" data-f="suspicious"/><span></span></label></label>
          <label class="row sp small"><span>Recently connected (15 min)</span><label class="switch"><input type="checkbox" data-f="recent"/><span></span></label></label>
          <label class="row sp small"><span>Low playtime (&lt; 2 h)</span><label class="switch"><input type="checkbox" data-f="lowPlaytime"/><span></span></label></label>
        </div>
      </div>
    </div>`);

  let view = 'live';
  const frameAt = new Map();   // monitorId -> ms of last frame

  function renderList() {
    const active = new Set(monitors.filter((m) => !m.stopped_at).map((m) => m.player_id));
    const list = players.filter((p) => {
      if (filters.suspicious && p.risk < t.medium) return false;
      if (filters.recent && Date.now() - new Date(p.joinedAt) > 15 * 60e3) return false;
      if (filters.lowPlaytime && p.playtimeSec > 7200) return false;
      return !q || p.name.toLowerCase().includes(q) || String(p.netId) === q;
    });
    $('#plist', el).innerHTML = String(list.length ? html`${list.map((p) => html`<div class="list-item" style="padding:9px 12px">
      <span class="muted small">[${p.netId}]</span><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
      ${p.risk >= t.medium ? html`<span class="badge ${p.risk >= t.high ? 'red' : 'orange'}">${p.risk}</span>` : ''}
      ${active.has(p.playerId) ? html`<span class="badge green">Live</span>` : html`<button class="btn xs" data-start="${p.playerId}" title="Watch">${icon('eye')}</button><button class="btn xs" data-rec="${p.playerId}" title="Watch & record">${icon('rec')}</button>`}</div>`)}`
      : empty('No players', store.server() ? '' : 'Select a server'));
  }

  function renderLive() {
    const live = monitors.filter((m) => !m.stopped_at);
    $('#n-live', el).textContent = live.length;
    if (view !== 'live') return;
    $('#grid', el).innerHTML = String(live.length ? html`${live.map((m) => html`<div class="tile" data-m="${m.id}">
      ${m.last_frame ? html`<img src="/api/v1/evidence/${m.last_frame}/file" alt=""/>` : html`<div class="wait"><div class="col" style="align-items:center"><div class="skeleton" style="width:28px;height:28px;border-radius:50%"></div><span class="small">Waiting for first frame…</span></div></div>`}
      <div class="tag">${m.record ? html`<span class="rec"></span>` : html`<span class="dot on"></span>`}[${m.net_id}] ${m.player_name}</div>
      <div class="acts"><a class="btn xs" href="#/players/${m.player_id}" title="Profile">${icon('users')}</a><button class="btn xs" data-stop="${m.id}" title="Stop">${icon('stop')}</button></div>
      <div class="age" data-age="${m.id}">${m.frames} frames</div></div>`)}`
      : html`<div class="card" style="grid-column:1/-1">${empty('No active monitors', 'Pick players on the right to watch them live.', 'monitor')}</div>`);
  }

  async function renderRecordings() {
    const rec = monitors.filter((m) => m.record && m.stopped_at);
    $('#grid', el).innerHTML = String(rec.length ? html`<div class="card" style="grid-column:1/-1"><table class="t"><thead><tr><th>Player</th><th>Server</th><th>Started</th><th>Duration</th><th>Frames</th><th>By</th><th></th></tr></thead><tbody>
      ${rec.map((m) => html`<tr><td><a href="#/players/${m.player_id}">${m.player_name}</a></td><td class="muted">${m.server_name}</td><td class="muted">${fmt.date(m.started_at)}</td>
        <td>${fmt.dur((new Date(m.stopped_at) - new Date(m.started_at)) / 1000)}</td><td class="num">${m.frames}</td><td class="muted">${m.started_by_name}</td>
        <td><button class="btn xs" data-view="${m.id}">${icon('play')}View</button></td></tr>`)}</tbody></table></div>`
      : html`<div class="card" style="grid-column:1/-1">${empty('No recordings', 'Use the record button to keep every frame of a monitoring session.', 'folder')}</div>`);
  }

  async function load() {
    [players, monitors] = await Promise.all([store.serverId ? api.get(`/servers/${store.serverId}/players`) : [], api.get('/monitor')]);
    renderList();
    view === 'live' ? renderLive() : renderRecordings();
  }

  async function start(playerId, record, btn) {
    const r = await busy(btn || document.createElement('button'), () => api.post('/monitor/start', { playerId: +playerId, record, intervalMs: interval }));
    toast({ type: 'success', text: r.existing ? 'Already monitoring this player' : `Monitoring started${record ? ' (recording)' : ''}` });
    await load();
  }

  function viewRecording(id) {
    const m = monitors.find((x) => x.id === +id);
    api.get('/evidence' + qs({ kind: 'monitor_frame', monitorId: id })).then((frames) => {
      if (!frames.length) return toast({ type: 'warn', text: 'No frames in this recording' });
      let i = 0; let timer = null;
      const dlg = modal({ title: `Recording · ${m.player_name}`, wide: true, hideSubmit: true, cancelLabel: 'Close',
        body: html`<div class="lightbox"><img id="rf" src="/api/v1/evidence/${frames[0].id}/file" alt=""/></div>
          <div class="row"><button type="button" class="btn sm" id="rp">${icon('play')}Play</button><input type="range" id="rs" min="0" max="${frames.length - 1}" value="0" class="grow"/><span class="muted small mono" id="rt"></span></div>` });
      const show = () => { $('#rf', dlg.el).src = `/api/v1/evidence/${frames[i].id}/file`; $('#rs', dlg.el).value = i; $('#rt', dlg.el).textContent = `${i + 1}/${frames.length} · ${fmt.time(frames[i].created_at)}`; };
      show();
      $('#rs', dlg.el).addEventListener('input', (e) => { i = +e.target.value; show(); });
      $('#rp', dlg.el).addEventListener('click', () => {
        if (timer) { clearInterval(timer); timer = null; return; }
        timer = setInterval(() => { if (i >= frames.length - 1) { clearInterval(timer); timer = null; return; } i++; show(); }, 600);
      });
      new MutationObserver((_, o) => { if (!document.body.contains(dlg.el)) { clearInterval(timer); o.disconnect(); } }).observe(document.body, { childList: true });
    });
  }

  el.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-start]'); if (s) return start(s.dataset.start, false, s);
    const r = e.target.closest('[data-rec]'); if (r) return start(r.dataset.rec, true, r);
    const st = e.target.closest('[data-stop]');
    if (st) { await busy(st, () => api.post(`/monitor/${st.dataset.stop}/stop`)); return load(); }
    const v = e.target.closest('[data-view]'); if (v) return viewRecording(v.dataset.view);
    const tb = e.target.closest('[data-tab]');
    if (tb) { view = tb.dataset.tab; el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === tb)); return view === 'live' ? renderLive() : renderRecordings(); }
  });
  el.querySelectorAll('[data-f]').forEach((c) => c.addEventListener('change', () => { filters[c.dataset.f] = c.checked; renderList(); }));
  $('#q', el).addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); renderList(); }, 120));
  $('#interval', el).addEventListener('change', (e) => { interval = +e.target.value; });

  await load();
  if (ctx.query.player && store.can('players.monitor')) {
    const p = players.find((x) => x.playerId === +ctx.query.player);
    if (p && !monitors.some((m) => !m.stopped_at && m.player_id === p.playerId)) await start(p.playerId, false);
  }

  ctx.on('monitor:frame', (f) => {
    const m = monitors.find((x) => x.id === f.monitorId);
    if (!m) return load();
    m.last_frame = f.evidenceId; m.frames++;
    frameAt.set(m.id, Date.now());
    const tile = el.querySelector(`.tile[data-m="${m.id}"]`);
    if (!tile || view !== 'live') return;
    let img = tile.querySelector('img');
    if (!img) { tile.querySelector('.wait')?.remove(); img = document.createElement('img'); tile.prepend(img); }
    if (window.sacImageUrl) { window.sacImageUrl(`/api/v1/evidence/${f.evidenceId}/file`).then((u) => { img.src = u; }).catch(() => {}); return; }
    const next = new Image();
    next.onload = () => { img.src = next.src; };
    next.src = `/api/v1/evidence/${f.evidenceId}/file`;
  });
  ctx.on('monitor:stopped', load);
  const refetch = debounce(load, 700);
  ctx.on('player:join', refetch); ctx.on('player:leave', refetch);
  const ages = setInterval(() => {
    for (const [id, at] of frameAt) { const a = el.querySelector(`[data-age="${id}"]`); if (a) a.textContent = `${Math.round((Date.now() - at) / 1000)}s ago · ${monitors.find((m) => m.id === id)?.frames || 0} frames`; }
  }, 1000);
  return () => clearInterval(ages);
}
