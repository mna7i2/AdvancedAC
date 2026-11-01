'use strict';
// Sentinel AC — in-game menu. Player names are attacker-controlled: everything is escaped.
const RES = typeof GetParentResourceName === 'function' ? GetParentResourceName() : 'AdvancedAC';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { data: null, view: 'players', selected: null, lookup: {}, unseenAlerts: 0 };

function post(endpoint, body = {}) {
  return fetch(`https://${RES}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
const act = (action, extra = {}) => post('action', { action, ...extra });
const can = (perm) => !!(state.data && state.data.me && state.data.me.perms[perm]);

// ─── Toasts / announcements ───
function toast(t) {
  const el = document.createElement('div');
  el.className = 'toast ' + (t.type || 'info');
  el.innerHTML = (t.title ? `<div class="tt">${esc(t.title)}</div>` : '') + `<div>${esc(t.text)}</div>`;
  $('#toasts').prepend(el);
  setTimeout(() => el.remove(), t.duration || 5000);
  while ($('#toasts').children.length > 5) $('#toasts').lastChild.remove();
}
let annTimer;
function announce(title, text) {
  $('.announce-title').textContent = title;
  $('.announce-text').textContent = text;
  $('#announce').classList.remove('hidden');
  clearTimeout(annTimer);
  annTimer = setTimeout(() => $('#announce').classList.add('hidden'), 10000);
}

// ─── Views ───
const TITLES = { players: 'Players', alerts: 'Alerts', tools: 'Server Tools', status: 'Protection Status' };
function setView(v) {
  state.view = v;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('hidden', s.id !== 'view-' + v));
  $('#view-title').textContent = TITLES[v];
  $('#search').classList.toggle('hidden', v !== 'players');
  if (v === 'alerts') { state.unseenAlerts = 0; renderAlertCount(); }
}

function bars(ping) {
  const n = ping < 60 ? 4 : ping < 120 ? 3 : ping < 200 ? 2 : 1;
  return `<span class="bars">${[1, 2, 3, 4].map((i) => `<span class="${i <= n ? 'on' : ''}" style="height:${i * 3}px"></span>`).join('')}</span>`;
}

function renderPlayers() {
  const d = state.data;
  if (!d) return;
  const q = $('#search').value.trim().toLowerCase();
  const list = d.players.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.id) === q);
  $('#player-list').innerHTML = list.map((p) => `
    <div class="row ${state.selected === p.id ? 'sel' : ''}" data-id="${p.id}">
      <span class="id">[${p.id}]</span><span class="name">${esc(p.name)}</span>
      ${p.staff ? '<span class="tag blue">STAFF</span>' : ''}
      ${p.detections ? `<span class="tag ${p.detections > 2 ? 'red' : 'orange'}">${p.detections} det</span>` : ''}
      ${bars(p.ping)}
    </div>`).join('') || '<div class="empty">No players</div>';
  renderDetail();
}

function renderDetail() {
  const d = state.data;
  const p = d && d.players.find((x) => x.id === state.selected);
  const el = $('#player-detail');
  if (!p) { el.innerHTML = '<div class="empty">Select a player</div>'; return; }
  const lk = state.lookup[p.id];
  const prof = lk && lk.profile;
  const btn = (a, label, perm, cls = '') => `<button class="btn ${cls}" data-act="${a}" ${can(perm) && !(a === 'spectate' && p.id === d.me.id) ? '' : 'disabled'}>${label}</button>`;
  el.innerHTML = `
    <div class="d-head"><h2>${esc(p.name)} <span class="muted">[${p.id}]</span></h2>${p.synced ? '' : '<span class="tag orange">not synced</span>'}</div>
    <div class="kv">
      <div><span class="muted small">Health</span><b>${p.health}</b></div>
      <div><span class="muted small">Armor</span><b>${p.armor}</b></div>
      <div><span class="muted small">Ping</span><b>${p.ping} ms</b></div>
      <div><span class="muted small">Risk</span><b class="${prof ? (prof.risk >= 80 ? 'bad' : prof.risk >= 50 ? 'warnc' : 'ok') : ''}">${prof ? prof.risk + '/100' : '—'}</b></div>
      <div><span class="muted small">Detections (session)</span><b>${p.detections}</b></div>
      <div><span class="muted small">Playtime</span><b>${prof ? Math.round(prof.playtimeSec / 3600) + ' h' : '—'}</b></div>
    </div>
    <div class="section-title">Actions</div>
    <div class="actions">
      ${btn('spectate', '👁 Spectate', 'players.spectate')}
      ${btn('screenshot', '📸 Screenshot', 'players.screenshot')}
      ${btn('goto', '➡ Go to', 'players.actions')}
      ${btn('bring', '⬅ Bring', 'players.actions')}
      ${btn('freeze', '❄ Freeze', 'players.actions')}
      ${btn('unfreeze', '☀ Unfreeze', 'players.actions')}
      ${btn('heal', '✚ Heal / Revive', 'players.actions')}
      ${btn('kick', '⏏ Kick', 'players.kick', 'warn')}
      ${btn('ban', '⛔ Ban', 'players.ban', 'danger')}
    </div>
    <div class="section-title">Identifiers</div>
    <div class="ids">${lk ? lk.identifiers.map((i) => `<span>${esc(i)}</span>`).join('') : '<span>Loading…</span>'}</div>
    ${prof ? `
      ${prof.names.length > 1 ? `<div class="section-title">Previous names</div><div class="muted">${prof.names.map(esc).join(', ')}</div>` : ''}
      <div class="section-title">Recent detections</div>
      <table class="mini-table">${prof.detections.length ? prof.detections.map((x) => `<tr><td>${esc(x.detection_key)}</td><td>${esc(x.severity)}</td><td>${esc(x.action_taken)}</td><td class="muted">${new Date(x.created_at).toLocaleString()}</td></tr>`).join('') : '<tr><td class="muted">None</td></tr>'}</table>
      <div class="section-title">Ban history</div>
      <table class="mini-table">${prof.bans.length ? prof.bans.map((b) => `<tr><td>${esc(b.id)}</td><td>${esc(b.reason)}</td><td class="muted">${b.revoked_at ? 'revoked' : b.expires_at ? 'until ' + new Date(b.expires_at).toLocaleDateString() : 'permanent'}</td></tr>`).join('') : '<tr><td class="muted">None</td></tr>'}</table>
    ` : (lk ? '<div class="section-title">History</div><div class="muted small">Backend offline — history unavailable.</div>' : '')}
  `;
}

function renderAlerts() {
  const a = (state.data && state.data.alerts) || [];
  $('#alert-list').innerHTML = a.map((x) => `
    <div class="alert-row ${esc(x.action)}"><span class="t">${new Date(x.t * 1000).toLocaleTimeString()}</span><span>${esc(x.text)}</span>
    ${x.src ? `<button class="btn" style="margin-left:auto" data-goto="${x.src}">Open</button>` : ''}</div>`).join('')
    || '<div class="empty" style="height:200px">No alerts</div>';
}
function renderAlertCount() {
  const el = $('#alert-count');
  el.textContent = state.unseenAlerts;
  el.classList.toggle('hidden', !state.unseenAlerts);
}

function renderStatus() {
  const s = state.data && state.data.status;
  if (!s) return;
  const st = (label, value, cls = '') => `<div class="stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
  $('#status-grid').innerHTML = [
    st('Backend', s.backend ? 'Connected' : 'Offline', s.backend ? 'ok' : 'bad'),
    st('License', s.licensed ? 'Valid' : 'Rejected', s.licensed ? 'ok' : 'bad'),
    st('Detections active', `${s.detectionsOn}/${s.detectionsTotal}`),
    st('OneSync', s.onesync ? 'Enabled' : 'Disabled', s.onesync ? 'ok' : 'bad'),
    st('Bans cached', s.bansCached),
    st('Players', `${s.players}/${s.maxPlayers}`),
    st('Framework', esc(s.framework)),
    st('Screenshots', s.screenshots ? 'Ready' : 'Not installed', s.screenshots ? 'ok' : 'warnc'),
    st('Queued (offline)', s.queued, s.queued ? 'warnc' : ''),
    st('Version', esc(s.version)),
  ].join('');
  const c = $('#conn');
  c.style.setProperty('--c', s.backend && s.licensed ? 'var(--green)' : 'var(--red)');
  c.textContent = s.backend && s.licensed ? 'Protected · online' : 'Local protection only';
  $('#me').textContent = state.data.me.name;
  document.querySelectorAll('[data-perm]').forEach((b) => { b.disabled = !can(b.dataset.perm); });
}

function renderAll() { renderPlayers(); renderAlerts(); renderStatus(); }

// ─── Modal ───
function modal(title, bodyHtml, onOk, okLabel = 'Confirm') {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  $('#modal-ok').textContent = okLabel;
  $('#modal').classList.remove('hidden');
  const first = $('#modal-body input'); if (first) first.focus();
  $('#modal-ok').onclick = () => { if (onOk() !== false) $('#modal').classList.add('hidden'); };
}
$('#modal-cancel').onclick = () => $('#modal').classList.add('hidden');

function playerAction(a) {
  const p = state.data.players.find((x) => x.id === state.selected);
  if (!p) return;
  if (a === 'kick') {
    modal(`Kick ${p.name}`, '<label>Reason</label><input id="m-reason" maxlength="200" />', () => act('kick', { target: p.id, reason: $('#m-reason').value }), 'Kick');
  } else if (a === 'ban') {
    modal(`Ban ${p.name}`, `<label>Reason</label><input id="m-reason" maxlength="300" />
      <label>Duration</label><select id="m-hours"><option value="0">Permanent</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option><option value="720">30 days</option></select>`,
    () => { const r = $('#m-reason').value.trim(); if (!r) { toast({ type: 'error', text: 'Reason is required' }); return false; } act('ban', { target: p.id, reason: r, hours: +$('#m-hours').value }); return true; }, 'Ban');
  } else {
    act(a, { target: p.id });
  }
}

// ─── Events ───
document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav'); if (nav) return setView(nav.dataset.view);
  const row = e.target.closest('.row');
  if (row) { state.selected = +row.dataset.id; renderPlayers(); act('lookup', { target: state.selected }); return; }
  const g = e.target.closest('[data-goto]');
  if (g) { state.selected = +g.dataset.goto; setView('players'); renderPlayers(); act('lookup', { target: state.selected }); return; }
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) {
    if (b.closest('#player-detail')) playerAction(b.dataset.act);
    else modal('Confirm', `<div>${esc(b.textContent.trim())} on the whole server?</div>`, () => act(b.dataset.act));
  }
});
$('#search').addEventListener('input', renderPlayers);
$('#refresh').onclick = () => act('refresh');
$('#close').onclick = () => post('close');
$('#ann-send').onclick = () => { const t = $('#ann-text').value.trim(); if (!t) return; act('announce', { title: $('#ann-title').value || 'Announcement', text: t }); $('#ann-text').value = ''; };
$('#unban-send').onclick = () => { const id = $('#unban-id').value.trim(); if (!id) return; act('unban', { banId: id, reason: $('#unban-reason').value }); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!$('#modal').classList.contains('hidden')) $('#modal').classList.add('hidden'); else post('close'); }
});

let refreshTimer = null;
window.addEventListener('message', (e) => {
  const m = e.data || {};
  switch (m.type) {
    case 'open':
      $('#app').classList.remove('hidden');
      clearInterval(refreshTimer);
      refreshTimer = setInterval(() => act('refresh'), 5000);
      break;
    case 'close':
      $('#app').classList.add('hidden'); $('#modal').classList.add('hidden');
      clearInterval(refreshTimer);
      break;
    case 'data':
      if (m.data.lookup) { state.lookup[m.data.lookup.target] = m.data.lookup; renderDetail(); }
      else { state.data = m.data; renderAll(); }
      break;
    case 'toast': toast(m.toast); break;
    case 'alert':
      toast({ type: 'alert', title: 'Sentinel AC', text: m.text });
      if (state.view !== 'alerts') { state.unseenAlerts++; renderAlertCount(); }
      break;
    case 'announce': announce(m.title, m.text); break;
    case 'spectate':
      $('#spectate-bar').classList.toggle('hidden', !m.active);
      if (m.active) $('#spec-name').textContent = `${m.name} [${m.id}]`;
      break;
  }
});
