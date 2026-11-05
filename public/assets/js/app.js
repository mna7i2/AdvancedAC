// Sentinel AC dashboard — bootstrap, auth, router, realtime.
import { api, NUI, API_BASE } from './api.js';
import { html, icon, esc, toast, $ } from './ui.js';

const PAGES = [
  { group: 'Monitor' },
  { path: '/', title: 'Overview', icon: 'home', perm: 'dashboard.view', mod: 'overview' },
  { path: '/players', title: 'Players', icon: 'users', perm: 'players.view', mod: 'players' },
  { path: '/map', title: 'Live Map', icon: 'map', perm: 'map.view', mod: 'map' },
  { path: '/monitoring', title: 'Monitoring', icon: 'monitor', perm: 'players.monitor', mod: 'monitoring' },
  { path: '/replay', title: 'Session Replay', icon: 'play', perm: 'replay.view', mod: 'replay' },
  { group: 'Protection' },
  { path: '/detections', title: 'Detections', icon: 'radar', perm: 'detections.view', mod: 'detections', badge: 'detections' },
  { path: '/control', title: 'Protection Control', icon: 'target', perm: 'detections.view', mod: 'control' },
  { path: '/rules', title: 'Protection Rules', icon: 'shieldCheck', perm: 'detections.view', mod: 'rules' },
  { path: '/bans', title: 'Bans', icon: 'ban', perm: 'bans.view', mod: 'bans', badge: 'appeals' },
  { path: '/lookup', title: 'Player Lookup', icon: 'search', perm: 'lookup.view', mod: 'lookup' },
  { path: '/evidence', title: 'Evidence Center', icon: 'folder', perm: 'evidence.view', mod: 'evidence' },
  { group: 'Server' },
  { path: '/console', title: 'Server Console', icon: 'terminal', perm: 'console.view', mod: 'console' },
  { path: '/servers', title: 'Server Management', icon: 'server', perm: 'dashboard.view', mod: 'servers' },
  { group: 'Organization' },
  { path: '/admins', title: 'Administrators', icon: 'userCog', perm: 'admins.manage', mod: 'admins' },
  { path: '/discord', title: 'Discord Integration', icon: 'discord', perm: 'discord.manage', mod: 'discord' },
  { path: '/settings', title: 'Settings', icon: 'settings', perm: 'dashboard.view', mod: 'settings' },
  { path: '/audit', title: 'Audit Logs', icon: 'scroll', perm: 'audit.view', mod: 'audit' },
  { group: 'Sentinel Business', perm: 'platform' },
  { path: '/customers', title: 'Customers', icon: 'key', perm: 'platform', mod: 'customers' },
];
const ROUTES = [
  ...PAGES.filter((p) => p.path),
  { path: '/players/:id', title: 'Player Profile', perm: 'players.view', mod: 'player', parent: '/players' },
  { path: '/bans/:id', title: 'Ban Details', perm: 'bans.view', mod: 'ban', parent: '/bans' },
  { path: '/customers/:id', title: 'Customer', perm: 'platform', mod: 'customer', parent: '/customers' },
];

// ─── Store ───
export const store = {
  user: null, perms: new Set(), servers: [], settings: null, serverId: null, socket: null, badges: { detections: 0, appeals: 0 },
  can: (p) => store.perms.has(p),
  server: () => store.servers.find((s) => s.id === store.serverId) || null,
};

function navigate(path) { location.hash = '#' + path; }

// ─── Login ───
function renderLogin(message = '') {
  document.getElementById('root').innerHTML = String(html`
  <div class="auth-page"><div class="auth-card">
    <div class="brand">${icon('shieldCheck')}<span>Sentinel <em>AC</em></span></div>
    <h2>Sign in</h2><p class="lead">Anti-cheat control panel</p>
    <form id="login">
      <label class="field">Email<input class="input" name="email" type="email" autocomplete="username" required /></label>
      <label class="field">Password<input class="input" name="password" type="password" autocomplete="current-password" required /></label>
      <div class="err" id="login-err">${message}</div>
      <button class="btn primary" type="submit" style="height:40px">Sign in</button>
    </form>
  </div></div>`);
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const btn = f.querySelector('button');
    btn.classList.add('loading');
    try {
      await api.post('/auth/login', { email: f.email.value, password: f.password.value }, { quiet: true });
      await boot();
    } catch (err) { $('#login-err').textContent = err.message; } finally { btn.classList.remove('loading'); }
  });
}

// ─── Shell ───
function renderShell() {
  const nav = PAGES.map((p) => {
    if (p.group) return p.perm && !store.can(p.perm) ? '' : html`<div class="nav-group">${p.group}</div>`;
    if (!store.can(p.perm)) return '';
    return html`<a href="#${p.path}" data-path="${p.path}">${icon(p.icon)}<span>${p.title}</span>${p.badge ? html`<b class="count hidden" data-badge="${p.badge}"></b>` : ''}</a>`;
  });
  const initials = store.user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('root').innerHTML = String(html`
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">${icon('shieldCheck')}<span>Sentinel <em>AC</em></span></div>
      <div class="server-pick"><span class="dot" id="srv-dot"></span><select id="srv"></select></div>
      <nav class="nav">${nav}</nav>
      <div class="side-foot">
        <div class="me"><div class="avatar">${initials}</div><div class="who grow"><b>${store.user.name}</b><span>${store.user.role} · ${store.user.orgName}</span></div>
          <button class="btn ghost sm" id="logout" title="Sign out">${icon('logout')}</button></div>
      </div>
    </aside>
    <div class="main">
      ${store.user.platform && store.user.platform.acting ? html`<div class="acting-bar">${icon('door')}<span>You are managing <b>${store.user.orgName}</b> with full control as Sentinel support. Everything you do is recorded in their audit log.</span>
        <button class="btn sm" id="exit-acting">${icon('logout')}Back to my console</button></div>` : ''}
      <div class="topbar"><h1 id="title"></h1><div class="grow"></div><span class="live" id="live"><span class="dot"></span>Connecting…</span></div>
      <div class="content" id="content"></div>
    </div>
  </div>`);
  renderServerPicker();
  const exitBtn = $('#exit-acting');
  if (exitBtn) exitBtn.addEventListener('click', async () => { await api.post('/platform/exit'); location.hash = '#/customers'; location.reload(); });
  $('#srv').addEventListener('change', (e) => { setServer(e.target.value); route(); });
  $('#logout').addEventListener('click', async () => {
    if (NUI) { window.parent.postMessage({ type: 'sac:close' }, '*'); return; }
    await api.post('/auth/logout').catch(() => {}); location.hash = ''; location.reload();
  });
}

function renderServerPicker() {
  const sel = $('#srv');
  if (!sel) return;
  sel.innerHTML = store.servers.length
    ? store.servers.map((s) => `<option value="${esc(s.id)}" ${s.id === store.serverId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="">No servers yet</option>';
  const s = store.server();
  $('#srv-dot').className = 'dot ' + (s ? (s.status === 'online' ? 'on' : 'off') : '');
}

function setServer(id) {
  store.serverId = id || null;
  try { localStorage.setItem('sac:server', id || ''); } catch { /* storage unavailable */ }
  renderServerPicker();
  subscribe();
}

export async function refreshServers() {
  const me = await api.get('/auth/me');
  store.servers = me.servers;
  if (!store.servers.some((s) => s.id === store.serverId)) store.serverId = store.servers[0] ? store.servers[0].id : null;
  renderServerPicker();
}

function updateBadge(name, n) {
  store.badges[name] = n;
  const el = document.querySelector(`[data-badge="${name}"]`);
  if (el) { el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hidden', !n); }
}

// ─── Realtime ───
let wantConsole = false;
function subscribe() {
  if (store.socket && store.socket.connected && store.serverId) store.socket.emit('subscribe', { serverId: store.serverId, console: wantConsole });
}

function connectSocket() {
  const s = NUI
    ? window.io(API_BASE, { auth: { token: NUI.token }, transports: ['websocket', 'polling'] })
    : window.io({ withCredentials: true, transports: ['websocket', 'polling'] });
  store.socket = s;
  const live = () => $('#live');
  s.on('connect', () => { if (live()) live().innerHTML = '<span class="dot on pulse"></span>Live'; subscribe(); });
  s.on('disconnect', () => { if (live()) live().innerHTML = '<span class="dot off"></span>Reconnecting…'; });
  s.on('connect_error', (e) => { if (e.message === 'unauthenticated') { s.close(); renderLogin('Session expired'); } });
  s.on('server:status', (st) => {
    const srv = store.servers.find((x) => x.id === st.id);
    if (srv) { srv.status = st.status; renderServerPicker(); }
    if (srv && st.status === 'offline') toast({ type: 'warn', title: 'Server offline', text: srv.name });
  });
  s.on('detection', (d) => {
    if (!location.hash.startsWith('#/detections')) updateBadge('detections', store.badges.detections + 1);
    if (d.action_taken === 'ban' || d.severity === 'critical') toast({ type: 'error', title: `${d.name}`, text: `${d.playerName} → ${String(d.action_taken).toUpperCase()}` });
  });
  s.on('ban', (b) => { if (!b.automatic) return; toast({ type: 'error', title: 'Automatic ban', text: `${b.player_name}: ${b.reason}` }); });
  s.on('activity', (a) => { if (a.kind === 'appeal') updateBadge('appeals', store.badges.appeals + 1); });
  s.on('review', (r) => {
    if (!r.created) return;
    updateBadge('appeals', store.badges.appeals + 1);
    toast({ type: 'warn', title: 'Ban review needed', text: `${r.playerName}: ${r.reason}` });
  });
}

// ─── Router ───
let cleanup = null;
const modCache = {};

function match(hash) {
  const [path, query] = (hash.replace(/^#/, '') || '/').split('?');
  for (const r of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + r.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    const m = path.match(re);
    if (m) return { route: r, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])), query: Object.fromEntries(new URLSearchParams(query || '')) };
  }
  return null;
}

async function route() {
  if (!store.user) return;
  const m = match(location.hash) || match('#/');
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const content = $('#content');
  if (!store.can(m.route.perm)) {
    content.innerHTML = String(html`<div class="empty">${icon('lock')}<b>No access</b>You need the <code>${m.route.perm}</code> permission.</div>`);
    $('#title').textContent = m.route.title;
    return;
  }
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === (m.route.parent || m.route.path)));
  $('#title').innerHTML = String(m.route.parent
    ? html`<a class="crumb" href="#${m.route.parent}">${ROUTES.find((r) => r.path === m.route.parent).title}</a> <span class="faint">/</span> ${m.route.title}`
    : html`${m.route.title}`);
  document.title = `${m.route.title} · Sentinel AC`;
  if (m.route.mod === 'detections') updateBadge('detections', 0);
  wantConsole = m.route.mod === 'console';
  subscribe();

  content.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  content.scrollTop = 0;
  const mod = modCache[m.route.mod] || (modCache[m.route.mod] = await import(`./pages/${m.route.mod}.js`));
  const listeners = [];
  const ctx = {
    params: m.params, query: m.query, navigate, store,
    on(event, fn) { store.socket.on(event, fn); listeners.push([event, fn]); },
    setTitle(t) { $('#title').innerHTML = String(t); },
  };
  const page = document.createElement('div');
  page.className = 'page-enter';
  content.innerHTML = '';
  content.appendChild(page);
  let pageCleanup = null;
  try { pageCleanup = await mod.default(page, ctx); } catch (e) {
    if (e.status !== 401) page.innerHTML = String(html`<div class="empty">${icon('alert')}<b>Could not load this page</b>${e.message}</div>`);
  }
  cleanup = () => { listeners.forEach(([ev, fn]) => store.socket.off(ev, fn)); if (typeof pageCleanup === 'function') pageCleanup(); };
}

// ─── Boot ───
let routerBound = false;
async function boot() {
  let me;
  try { me = await api.get('/auth/me', { quiet: true }); } catch (e) { renderLogin(e.code === 'suspended' ? e.message : ''); return; }
  store.user = me.user;
  store.perms = new Set(me.permissions);
  if (me.user.platform && me.user.platform.admin && !me.user.platform.acting) store.perms.add('platform');
  store.servers = me.servers;
  let saved = null;
  try { saved = localStorage.getItem('sac:server'); } catch { /* storage unavailable */ }
  store.serverId = (store.servers.find((s) => s.id === (NUI ? NUI.serverId : saved)) || store.servers[0] || {}).id || null;
  if (NUI) document.body.classList.add('nui');
  store.settings = await api.get('/settings');
  renderShell();
  if (store.socket) store.socket.close();
  connectSocket();
  if (store.can('bans.appeals') || store.can('bans.view')) {
    Promise.all([api.get('/appeals?status=open', { quiet: true }).catch(() => []), api.get('/reviews/count', { quiet: true }).catch(() => ({ open: 0 }))])
      .then(([a, r]) => updateBadge('appeals', a.length + r.open));
  }
  if (!routerBound) { window.addEventListener('hashchange', route); routerBound = true; }
  route();
}

export { NUI };
window.addEventListener('sac:unauthenticated', () => {
  if (NUI) { window.parent.postMessage({ type: 'sac:expired' }, '*'); return; }
  store.user = null; if (store.socket) store.socket.close(); renderLogin('Your session has expired. Please sign in again.');
});
// In-game: ESC closes the panel (unless a modal is open).
if (NUI) document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-back')) window.parent.postMessage({ type: 'sac:close' }, '*'); });
boot();
