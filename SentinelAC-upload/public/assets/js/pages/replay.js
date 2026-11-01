import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, actionBadge, lightbox, debounce } from '../ui.js';
import { MapView } from '../mapview.js';
import { weaponName, vehicleName, hasFlag } from '../gta.js';

export default async function replay(el, ctx) {
  const { store } = ctx;
  if (!ctx.query.session) return pickSession(el, ctx);

  const data = await api.get('/replay/' + encodeURIComponent(ctx.query.session));
  const { session, samples, events, detections, evidence } = data;
  ctx.setTitle(html`<a class="crumb" href="#/replay">Session Replay</a> <span class="faint">/</span> ${session.name} <span class="muted">· ${fmt.date(session.startedAt)}</span>`);
  if (!samples.length) {
    el.innerHTML = String(html`<div class="card">${empty('No telemetry recorded for this session', 'Telemetry is kept for the retention period and only while "Store replay" is enabled in Settings.', 'play')}</div>`);
    return;
  }

  const t0 = samples[0].t, t1 = Math.max(samples[samples.length - 1].t, ...detections.map((d) => d.t));
  let cur = t0, playing = false, speed = 5, raf = null, last = 0;
  const timeline = [
    ...detections.map((d) => ({ t: d.t, kind: 'det', d })),
    ...events.filter((e) => e.kind !== 'detection').map((e) => ({ t: e.t, kind: 'ev', e })),
    ...evidence.map((e) => ({ t: e.t, kind: 'shot', e })),
  ].sort((a, b) => a.t - b.t);

  el.innerHTML = String(html`
    <div class="notice" style="margin-bottom:14px">${icon('info')}<span><b>Telemetry replay</b> — reconstructed from server-side position/state samples every ${store.settings.telemetry.intervalMs / 1000}s and logged game events. This is not a video recording; screenshots captured during the session are linked on the timeline.</span></div>
    <div class="replay">
      <div class="col" style="gap:12px">
        <div class="map-wrap"><canvas id="cv"></canvas><div class="map-ctl"><button class="btn" id="zi">${icon('zoomIn')}</button><button class="btn" id="zo">${icon('zoomOut')}</button><button class="btn" id="follow" title="Follow">${icon('crosshair')}</button></div></div>
        <div class="card"><div class="card-b">
          <div class="row sp">
            <div class="row"><button class="btn primary" id="play" style="width:42px;padding:0">${icon('play')}</button>
              <div class="btn-group" id="speed">${[1, 5, 10, 30, 60].map((s) => html`<button data-s="${s}" class="${s === speed ? 'on' : ''}">${s}×</button>`)}</div>
              <button class="btn sm" id="prevdet">${icon('radar')}Previous detection</button><button class="btn sm" id="nextdet">Next detection${icon('radar')}</button></div>
            <span class="mono" id="clock"></span></div>
          <div class="timeline" id="tl"><div class="rail"></div><div class="fill" id="fill"></div>
            ${timeline.map((x) => html`<div class="mark ${x.kind}" style="left:${((x.t - t0) / (t1 - t0)) * 100}%" title="${x.kind === 'det' ? x.d.name : x.kind === 'shot' ? 'Screenshot' : x.e.kind}"></div>`)}
            <div class="knob" id="knob"></div></div>
          <div class="legend tiny"><span><i style="background:var(--red)"></i>Detection</span><span><i style="background:var(--orange)"></i>Game event</span><span><i style="background:var(--violet)"></i>Screenshot</span></div>
        </div></div>
      </div>
      <div class="col" style="gap:12px">
        <div class="card"><div class="card-h"><h3>State</h3><a class="small" href="#/players/${session.playerId}">Profile →</a></div><div class="card-b"><div class="kv" id="state" style="grid-template-columns:repeat(2,1fr)"></div></div></div>
        <div class="card"><div class="card-h"><h3>Events</h3><span class="muted small">${timeline.length}</span></div><div class="list event-list" id="events">
          ${timeline.length ? timeline.map((x, i) => html`<div class="list-item" data-i="${i}">
            <span class="mono muted tiny" style="width:58px">${fmt.time(x.t)}</span>
            ${x.kind === 'det' ? html`<span class="grow"><b class="bad">${x.d.name}</b> ${actionBadge(x.d.action_taken)}</span>`
              : x.kind === 'shot' ? html`<span class="grow" style="color:#c8b6ff">📸 Screenshot</span>`
              : html`<span class="grow">${x.e.kind}${x.e.data && x.e.data.damage ? ` · ${x.e.data.damage} dmg` : ''}${x.e.data && x.e.data.action ? ` · ${x.e.data.action}` : ''}</span>`}</div>`) : html`<div class="empty small">No events in this session</div>`}
        </div></div>
      </div>
    </div>`);

  const mv = new MapView($('#cv', el), store.settings.map);
  let follow = true;

  function sampleAt(t) {
    let lo = 0, hi = samples.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (samples[mid].t <= t) lo = mid; else hi = mid - 1; }
    const a = samples[lo], b = samples[Math.min(lo + 1, samples.length - 1)];
    if (b === a || b.t === a.t) return { s: a, i: lo };
    const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    // Don't interpolate across teleports (> 200 m) — show the jump honestly.
    const jump = Math.hypot(b.x - a.x, b.y - a.y) > 200;
    return { s: jump ? a : { ...a, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }, i: lo };
  }

  function render() {
    const { s, i } = sampleAt(cur);
    const trail = samples.slice(Math.max(0, i - 400), i + 1).map((p) => ({ x: p.x, y: p.y }));
    trail.push({ x: s.x, y: s.y });
    const dots = detections.filter((d) => d.t <= cur).map((d) => { const ds = sampleAt(d.t).s; return { x: ds.x, y: ds.y, color: '#ef4f55' }; });
    mv.setPaths([{ points: samples.map((p) => ({ x: p.x, y: p.y })), color: 'rgba(124,135,157,.35)', width: 1.5, dashed: true },
      { points: trail, color: '#62aaea', width: 2.5, dots }]);
    mv.setMarkers([{ id: 1, x: s.x, y: s.y, heading: s.h, label: session.name, color: hasFlag(s.f, 'Dead') ? '#7c879d' : '#62aaea' }]);
    if (follow) mv.centerOn(s.x, s.y, 0.25);
    const pct = ((cur - t0) / (t1 - t0)) * 100;
    $('#fill', el).style.width = pct + '%'; $('#knob', el).style.left = pct + '%';
    $('#clock', el).textContent = `${fmt.time(cur)}  ·  ${fmt.dur((cur - t0) / 1000)} / ${fmt.dur((t1 - t0) / 1000)}`;
    const flags = ['Invisible', 'Invincible', 'Frozen', 'Dead'].filter((f) => hasFlag(s.f, f));
    $('#state', el).innerHTML = String(html`<div><span>Health</span><b>${s.hp}</b></div><div><span>Armor</span><b>${s.ar}</b></div>
      <div><span>Weapon</span><b>${weaponName(s.w)}</b></div><div><span>Vehicle</span><b>${s.vm ? vehicleName(s.vm) : 'On foot'}</b></div>
      <div><span>Speed</span><b>${Math.round(s.s * 3.6)} km/h</b></div><div><span>Bucket</span><b>${s.b}</b></div>
      <div style="grid-column:1/-1"><span>Position</span><b class="mono" style="font-size:12px">${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)}</b></div>
      <div style="grid-column:1/-1"><span>Flags</span><b>${flags.length ? flags.join(', ') : 'None'}</b></div>`);
    el.querySelectorAll('#events .list-item').forEach((it) => it.classList.toggle('past', timeline[+it.dataset.i].t <= cur));
  }

  function loop(ts) {
    if (!playing) return;
    if (last) cur = Math.min(t1, cur + (ts - last) * speed);
    last = ts;
    render();
    if (cur >= t1) { setPlaying(false); return; }
    raf = requestAnimationFrame(loop);
  }
  function setPlaying(v) {
    playing = v; last = 0;
    $('#play', el).innerHTML = String(icon(v ? 'pause' : 'play'));
    if (v) { if (cur >= t1) cur = t0; raf = requestAnimationFrame(loop); } else cancelAnimationFrame(raf);
  }
  const seek = (t) => { cur = Math.max(t0, Math.min(t1, t)); render(); };

  $('#play', el).onclick = () => setPlaying(!playing);
  $('#zi', el).onclick = () => { follow = false; mv.zoom(1.4); }; $('#zo', el).onclick = () => { follow = false; mv.zoom(1 / 1.4); };
  $('#follow', el).onclick = () => { follow = true; render(); };
  $('#cv', el).addEventListener('mousedown', () => { follow = false; });
  el.querySelectorAll('#speed button').forEach((b) => b.addEventListener('click', () => { speed = +b.dataset.s; el.querySelectorAll('#speed button').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#nextdet', el).onclick = () => { const d = detections.find((x) => x.t > cur + 500); if (d) seek(d.t - 10000); };
  $('#prevdet', el).onclick = () => { const d = [...detections].reverse().find((x) => x.t < cur - 10500); if (d) seek(d.t - 10000); };
  const tl = $('#tl', el);
  let scrub = false;
  const scrubTo = (e) => { const r = tl.getBoundingClientRect(); seek(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0)); };
  tl.addEventListener('mousedown', (e) => { scrub = true; scrubTo(e); });
  const mm = (e) => { if (scrub) scrubTo(e); }; const mu = () => { scrub = false; };
  window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  $('#events', el).addEventListener('click', (e) => {
    const it = e.target.closest('[data-i]'); if (!it) return;
    const x = timeline[+it.dataset.i];
    if (x.kind === 'shot') lightbox(`/api/v1/evidence/${x.e.id}/file`, 'Screenshot · ' + fmt.time(x.t));
    seek(x.kind === 'det' ? x.t - 5000 : x.t); follow = true; render();
  });

  // Start 10 s before the first detection if there is one: that's what investigators want.
  seek(detections.length ? detections[0].t - 10000 : t0);
  return () => { setPlaying(false); mv.unbind(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
}

async function pickSession(el, ctx) {
  el.innerHTML = String(html`<div class="row" style="margin-bottom:14px"><div class="search" style="width:340px">${icon('search')}<input class="input" id="q" placeholder="Find a player (name, license, discord…)"/></div><span class="muted small">or pick a recent session</span></div>
    <div class="card"><div class="table-wrap" id="list"></div></div>`);
  async function show(params) {
    const rows = await api.get('/replay/sessions' + qs(params));
    $('#list', el).innerHTML = String(rows.length ? html`<table class="t"><thead><tr><th>Player</th><th>Server</th><th>Started</th><th>Duration</th><th>Detections</th><th></th></tr></thead><tbody>
      ${rows.map((s) => html`<tr class="click" data-s="${s.id}"><td><b>${s.name}</b> <span class="muted">[${s.net_id}]</span></td><td class="muted">${s.server_name}</td><td class="muted">${fmt.date(s.started_at)}</td>
        <td>${s.ended_at ? fmt.dur((new Date(s.ended_at) - new Date(s.started_at)) / 1000) : html`<span class="badge green">Live</span>`}</td>
        <td>${s.detections ? html`<span class="badge orange">${s.detections}</span>` : html`<span class="muted">0</span>`}</td><td>${s.has_telemetry ? html`<span class="btn xs">${icon('play')}Replay</span>` : html`<span class="muted tiny">no telemetry</span>`}</td></tr>`)}</tbody></table>`
      : empty('No sessions found', '', 'play'));
  }
  await show({ serverId: ctx.store.serverId || '' });
  el.addEventListener('click', (e) => { const tr = e.target.closest('[data-s]'); if (tr) ctx.navigate('/replay?session=' + tr.dataset.s); });
  $('#q', el).addEventListener('input', debounce(async (e) => {
    const v = e.target.value.trim();
    if (v.length < 2) return show({ serverId: ctx.store.serverId || '' });
    const r = await api.get('/lookup' + qs({ q: v }), { quiet: true }).catch(() => ({ results: [] }));
    if (r.results[0]) show({ playerId: r.results[0].id }); else $('#list', el).innerHTML = String(empty('No player found', '', 'search'));
  }, 300));
}
