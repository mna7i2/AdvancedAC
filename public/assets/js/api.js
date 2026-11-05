// Dashboard API client. Every mutating call carries X-SAC-Request (CSRF defence, see middleware/auth.js).
import { toast } from './ui.js';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// In-game panel (/adv): the dashboard runs inside FiveM NUI and talks to the backend with a bearer
// session issued by the game server. In the browser, the httpOnly cookie is used instead.
export const NUI = window.SAC_NUI || null;
export const API_BASE = NUI ? NUI.apiBase.replace(/\/$/, '') : '';

async function request(method, path, body, { quiet = false } = {}) {
  const res = await fetch(API_BASE + '/api/v1' + path, {
    method,
    credentials: NUI ? 'omit' : 'same-origin',
    headers: { 'X-SAC-Request': '1', ...(NUI ? { Authorization: 'Bearer ' + NUI.token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('sac:unauthenticated'));
    throw new ApiError(401, 'Session expired');
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    if (!quiet) toast({ type: 'error', title: 'Error', text: msg });
    throw new ApiError(res.status, msg, data && data.error);
  }
  return data;
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b = {}, o) => request('POST', p, b, o),
  put: (p, b = {}, o) => request('PUT', p, b, o),
  patch: (p, b = {}, o) => request('PATCH', p, b, o),
  del: (p, b = {}, o) => request('DELETE', p, b, o),
};

export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

/**
 * NUI mode: <img src="/api/v1/..."> cannot carry the bearer header, so authenticated images are
 * fetched as blobs and swapped in. One observer covers every page (evidence, monitoring, lightbox).
 */
if (NUI) {
  const swap = async (img) => {
    const src = img.getAttribute('src');
    if (!src || !src.startsWith('/api/v1/') || img.dataset.nuiSrc === src) return;
    img.dataset.nuiSrc = src;
    img.removeAttribute('src');
    try {
      const r = await fetch(API_BASE + src, { headers: { Authorization: 'Bearer ' + NUI.token } });
      if (r.ok) img.src = URL.createObjectURL(await r.blob());
    } catch { /* offline */ }
  };
  const scan = (root) => root.querySelectorAll && root.querySelectorAll('img[src^="/api/v1/"]').forEach(swap);
  new MutationObserver((muts) => muts.forEach((m) => {
    if (m.type === 'attributes' && m.target.tagName === 'IMG') swap(m.target);
    m.addedNodes.forEach((n) => { if (n.tagName === 'IMG') swap(n); else scan(n); });
  })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  // Preload pattern used by the monitoring page (new Image()) is handled via this helper.
  window.sacImageUrl = async (path) => {
    const r = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + NUI.token } });
    return URL.createObjectURL(await r.blob());
  };
}
