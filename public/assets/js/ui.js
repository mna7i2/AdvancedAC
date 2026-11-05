// UI helpers: escaping templating, icons, formatting, toasts, modals.

/** Escape any value for HTML. All user/game-controlled strings MUST go through this. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tagged template that escapes interpolations unless wrapped with raw(). Arrays are joined. */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return raw(out);
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ─── Icons (24px stroke icons) ───
const P = {
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/>',
  shieldCheck: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  userCog: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9"/><circle cx="18" cy="17" r="2.5"/><path d="M18 13v1.5M18 19.5V21M14 17h1.5M20.5 17H22"/>',
  discord: '<path d="M8 6.5c-1.5.3-3 .9-4 1.6C2.6 11 2.2 14 2.4 17c1.4 1 2.8 1.6 4.2 2l1-1.7M16 6.5c1.5.3 3 .9 4 1.6 1.4 2.9 1.8 5.9 1.6 8.9-1.4 1-2.8 1.6-4.2 2l-1-1.7M7 17c3.2 1.4 6.8 1.4 10 0M8.5 7.5c2.3-.7 4.7-.7 7 0"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  scroll: '<path d="M8 21h11a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 0 0-2-2h12a2 2 0 0 1 2 2v12"/><path d="M10 7h6M10 11h6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  snow: '<path d="M12 2v20M4 6.5l16 11M20 6.5l-16 11"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7 4 4 7.2 4c2 0 3.6 1.2 4.8 3 1.2-1.8 2.8-3 4.8-3C20 4 22.4 7 21.2 10.6 19.5 15.4 12 20 12 20z"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  door: '<path d="M14 4H6v16h8M14 4l5 2v12l-5 2zM11 12h.01"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4M3 16h18v3h-3v-1H6v1H3z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  person: '<circle cx="12" cy="5" r="2"/><path d="M12 7v7M8 10h8M9 22l3-8 3 8"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  rec: '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  gavel: '<path d="m14 13-8.5 8.5a2.1 2.1 0 0 1-3-3L11 10M16 16l6-6M8 8l6-6M9 7l8 8"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || P.info}</svg>`);

// ─── Formatting ───
export const fmt = {
  num: (n) => Number(n || 0).toLocaleString('en-US'),
  date: (d) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'),
  dateShort: (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'),
  time: (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'),
  ago(d) {
    if (!d) return '—';
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  },
  dur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${sec % 60}s`;
  },
  bytes: (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB'),
};

export function riskColor(r, t = { medium: 25, high: 50, critical: 80 }) {
  return r >= t.critical ? 'var(--red)' : r >= t.high ? 'var(--orange)' : r >= t.medium ? '#e5c33b' : 'var(--green)';
}
export const riskBar = (r, t) => html`<span class="risk"><span class="bar"><i style="width:${Math.min(100, r)}%;background:${riskColor(r, t)}"></i></span>${r}</span>`;

const ACTION_BADGE = { ban: 'red', kick: 'orange', warn: 'blue', log: '', suppressed: '', review: 'violet', ignored: '' };
export const actionBadge = (a) => html`<span class="badge ${ACTION_BADGE[a] || ''}">${String(a || '').toUpperCase()}</span>`;
const SEV = { critical: 'red', high: 'orange', medium: 'blue', low: '' };
export const sevBadge = (s) => html`<span class="badge ${SEV[s] || ''}">${s}</span>`;
export const verifiedBadge = (v) => (v ? html`<span class="badge green" title="Observed by the server (authoritative)">${icon('check')}Server-verified</span>`
  : html`<span class="badge violet" title="Client signal — never bans on its own">Client signal</span>`);

export function banStatus(b) {
  if (b.revoked_at) return html`<span class="badge">Revoked</span>`;
  if (b.expires_at && new Date(b.expires_at) <= new Date()) return html`<span class="badge">Expired</span>`;
  return b.expires_at ? html`<span class="badge orange">Temporary</span>` : html`<span class="badge red">Permanent</span>`;
}

export const empty = (title, text = '', ic = 'info') => html`<div class="empty">${icon(ic)}<b>${title}</b>${text}</div>`;

// ─── Toasts ───
export function toast({ type = 'info', title, text, ms = 4500 }) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (title ? `<b>${esc(title)}</b>` : '') + esc(text || '');
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}

// ─── Modal ───
/** Opens a modal. `body` is html``. Returns { el, close }. onSubmit(form) may return false / throw to keep open. */
export function modal({ title, body, submitLabel = 'Save', danger = false, wide = false, onSubmit, cancelLabel = 'Cancel', hideSubmit = false }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" novalidate>
    <div class="modal-h"><h3>${esc(title)}</h3><button type="button" class="btn ghost sm" data-x>${icon('x')}</button></div>
    <div class="modal-b">${body}</div>
    <div class="modal-f"><button type="button" class="btn" data-x>${esc(cancelLabel)}</button>
      ${hideSubmit ? '' : `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>`}</div></form>`;
  document.body.appendChild(back);
  const form = back.querySelector('form');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = form.querySelector('[type=submit]');
    btn.classList.add('loading');
    try { if ((await onSubmit(form)) !== false) close(); } catch { /* error toast already shown */ } finally { btn.classList.remove('loading'); }
  });
  const first = form.querySelector('input:not([type=hidden]), textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: back, form, close };
}

export const confirmDialog = (title, text, label = 'Confirm', danger = true) => new Promise((resolve) => {
  let done = false;
  const m = modal({ title, body: html`<p class="muted">${text}</p>`, submitLabel: label, danger, onSubmit: () => { done = true; resolve(true); } });
  const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
  obs.observe(document.body, { childList: true });
});

/** Show an image in a lightbox. */
export function lightbox(src, caption = '') {
  modal({ title: caption || 'Evidence', wide: true, hideSubmit: true, cancelLabel: 'Close',
    body: html`<div class="lightbox"><img src="${src}" alt="evidence" /></div>
      <div class="row nui-hide"><a class="btn sm" href="${src}" target="_blank" rel="noopener">${icon('download')}Open original</a></div>` });
}

/** Button helper: runs async fn with a loading state. */
export async function busy(btn, fn) {
  btn.classList.add('loading');
  try { return await fn(); } finally { btn.classList.remove('loading'); }
}

export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
