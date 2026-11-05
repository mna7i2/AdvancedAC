// Vendor console: every customer (organization) that bought Sentinel AC, their servers and problems.
import { api, NUI, API_BASE } from '../api.js';
import { html, icon, fmt, $, empty, modal, toast, busy, debounce, esc } from '../ui.js';

export const LEVEL = { error: ['red', 'Problem'], warn: ['orange', 'Warning'], info: ['blue', 'Info'], ok: ['green', 'Healthy'] };
export const levelBadge = (l) => html`<span class="badge ${LEVEL[l][0]}">${l === 'ok' ? icon('check') : icon('alert')}${LEVEL[l][1]}</span>`;

export function licenseBadge(l) {
  if (!l || l.status === 'none') return html`<span class="badge red">No license</span>`;
  if (l.status !== 'active') return html`<span class="badge red">${l.status}</span>`;
  if (!l.expiresAt) return html`<span class="badge green">Lifetime</span>`;
  const days = Math.ceil((new Date(l.expiresAt) - Date.now()) / 86400000);
  return html`<span class="badge ${days < 7 ? 'orange' : 'green'}" title="${fmt.date(l.expiresAt)}">${days}d left</span>`;
}

const copy = async (text) => {
  try { await navigator.clipboard.writeText(text); toast({ type: 'success', text: 'Copied' }); } catch { toast({ type: 'error', text: 'Copy failed — select the text manually' }); }
};

/** Downloads the ready-to-install AdvancedAC .zip for one customer server (license.lua inside). */
export async function downloadPackage(customerId, serverId, body = {}) {
  const res = await fetch(`${API_BASE}/api/v1/platform/customers/${customerId}/servers/${serverId}/package`, {
    method: 'POST', credentials: NUI ? 'omit' : 'same-origin', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-SAC-Request': '1', ...(NUI ? { Authorization: 'Bearer ' + NUI.token } : {}) },
  });
  if (!res.ok) { let m = ''; try { m = (await res.json()).error; } catch { /* not json */ } throw new Error(m || 'Download failed'); }
  const blob = await res.blob();
  const name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'AdvancedAC.zip';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return res.headers.get('X-SAC-Rotated') === '1';
}

/** Shows freshly created credentials once (passwords are never stored in clear). */
export function credentialsModal(title, out) {
  const lines = [];
  if (out.login) lines.push(`Dashboard: ${out.login.url}`, `Email: ${out.login.email}`, `Password: ${out.login.password}`);
  if (out.server && out.server.cfg) lines.push('', '--- server.cfg ---', out.server.cfg);
  const all = lines.join('\n');
  const m = modal({
    title, wide: true, hideSubmit: true, cancelLabel: 'Done',
    body: String(html`
      <div class="notice warn" style="margin-bottom:14px">${icon('lock')}<span>Save these now — the password and the server key are shown <b>only once</b>. You can generate new ones later from the customer page.</span></div>
      ${out.login ? html`<div class="kv" style="margin-bottom:14px">
        <div><span>Dashboard</span><b class="mono" style="font-size:12.5px">${out.login.url}</b></div>
        <div><span>Email</span><b class="mono" style="font-size:12.5px">${out.login.email}</b></div>
        <div><span>Password</span><b class="mono" style="font-size:12.5px">${out.login.password}</b></div>
        ${out.license ? html`<div><span>License</span><b style="font-size:12.5px">${out.license.plan} · ${out.license.maxServers} server(s) · ${out.license.expiresAt ? fmt.dateShort(out.license.expiresAt) : 'lifetime'}</b></div>` : ''}</div>` : ''}
      ${out.server && out.server.cfg ? html`<div class="muted small" style="margin-bottom:6px">Give the customer these lines for <b>server.cfg</b> (server: ${out.server.name}):</div>
        <textarea class="input mono" readonly style="width:100%;min-height:150px;font-size:11.5px">${out.server.cfg}</textarea>` : ''}
      ${out.customerId && out.server && out.server.id ? html`<div class="notice" style="margin-top:12px">${icon('download')}<span><b>Easiest for the customer:</b> download the ready files — the license and key are already inside, and they work only on ${out.server.ipLocked ? (out.server.ip ? `the IP ${out.server.ip}` : 'the first server IP that connects') : 'this server'}. The customer just copies the folder and adds <code>ensure AdvancedAC</code>.</span></div>` : ''}
      <div class="row" style="margin-top:12px;gap:8px">${out.customerId && out.server && out.server.id ? html`<button type="button" class="btn primary" data-zip>${icon('download')}Download server files (.zip)</button>` : ''}
        <button type="button" class="btn ${out.customerId ? '' : 'primary'}" data-copy-all>${icon('file')}Copy everything</button>
        ${out.login ? html`<button type="button" class="btn" data-copy-pw>${icon('key')}Copy password</button>` : ''}</div>`),
  });
  m.el.querySelector('[data-copy-all]').addEventListener('click', () => copy(all));
  const zipBtn = m.el.querySelector('[data-zip]');
  if (zipBtn) zipBtn.addEventListener('click', async () => {
    zipBtn.classList.add('loading');
    try { await downloadPackage(out.customerId, out.server.id, { apiKey: out.server.apiKey, licenseKey: out.license ? out.license.key : undefined }); toast({ type: 'success', text: 'Files downloaded — send the .zip to the customer' }); }
    catch (e) { toast({ type: 'error', text: e.message }); } finally { zipBtn.classList.remove('loading'); }
  });
  const pw = m.el.querySelector('[data-copy-pw]'); if (pw) pw.addEventListener('click', () => copy(out.login.password));
  return m;
}

export default async function customers(el, ctx) {
  let list = [], ov = null, q = '', filter = 'all';

  async function load() {
    [ov, list] = await Promise.all([api.get('/platform/overview'), api.get('/platform/customers')]);
    render();
  }

  function rows() {
    return list.filter((c) => {
      if (q && !`${c.name} ${c.contact} ${c.owner ? c.owner.email : ''}`.toLowerCase().includes(q)) return false;
      if (filter === 'problems') return c.level === 'error' || c.level === 'warn';
      if (filter === 'online') return c.serversOnline > 0;
      if (filter === 'suspended') return c.status === 'suspended';
      if (filter === 'expiring') return c.license.expiresAt && new Date(c.license.expiresAt) - Date.now() < 7 * 86400000;
      return true;
    });
  }

  function stat(label, value, sub, ic, color = '') {
    return html`<div class="card stat"><div class="label">${icon(ic)}${label}</div><div class="value" style="${color ? `color:${color}` : ''}">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function render() {
    const r = rows();
    el.innerHTML = String(html`
      <div class="grid g4" style="margin-bottom:16px">
        ${stat('Customers', ov.customers, `${ov.activeCustomers} active · ${ov.suspended} suspended`, 'users')}
        ${stat('Servers online', `${ov.serversOnline}/${ov.servers}`, `${fmt.num(ov.playersOnline)} players protected now`, 'server', ov.serversOnline ? 'var(--green)' : '')}
        ${stat('Last 24 hours', fmt.num(ov.detections24h), `detections · ${fmt.num(ov.bans24h)} bans`, 'radar')}
        ${stat('Need attention', ov.withProblems, `${ov.expiringSoon.length} license(s) expiring in 7 days`, 'alert', ov.withProblems ? 'var(--orange)' : 'var(--green)')}
      </div>
      <div class="card">
        <div class="card-h"><div class="row wrap" style="gap:8px">
            <div class="search" style="width:240px">${icon('search')}<input class="input" id="q" placeholder="Search customers…" value="${q}"/></div>
            ${['all', 'problems', 'online', 'expiring', 'suspended'].map((f) => html`<button class="btn sm ${filter === f ? 'primary' : ''}" data-filter="${f}">${{ all: 'All', problems: 'Problems', online: 'Online', expiring: 'Expiring', suspended: 'Suspended' }[f]}</button>`)}
          </div><button class="btn primary" id="new">${icon('plus')}New customer</button></div>
        <div class="card-b flush table-wrap">${r.length ? html`<table class="t"><thead><tr><th>Customer</th><th>Status</th><th>License</th><th>Servers</th><th style="text-align:right">Players</th><th style="text-align:right">Detections 24h</th><th style="text-align:right">Bans 24h</th><th>Problems</th><th></th></tr></thead><tbody>
          ${r.map((c) => html`<tr class="click" data-open="${c.id}">
            <td><b>${c.name}</b>${c.home ? html` <span class="badge blue">You</span>` : ''}<div class="muted tiny">${c.owner ? c.owner.email : 'no owner'}${c.contact ? ` · ${c.contact}` : ''}</div></td>
            <td>${c.status === 'suspended' ? html`<span class="badge red">Suspended</span>` : levelBadge(c.level)}</td>
            <td>${licenseBadge(c.license)}<div class="muted tiny">${c.license.plan || ''}${c.license.maxServers ? ` · max ${c.license.maxServers}` : ''}</div></td>
            <td><div class="row" style="gap:4px">${c.servers.slice(0, 8).map((s) => html`<span class="dot ${s.status === 'online' ? 'on' : 'off'}" title="${s.name} · ${s.status}"></span>`)}${c.servers.length > 8 ? html`<span class="faint tiny">+${c.servers.length - 8}</span>` : ''}</div><div class="muted tiny">${c.serversOnline}/${c.servers.length} online</div></td>
            <td class="num" style="text-align:right">${fmt.num(c.playersOnline)}</td>
            <td class="num" style="text-align:right">${fmt.num(c.detections24h)}</td>
            <td class="num" style="text-align:right">${fmt.num(c.bans24h)}${c.reviewsOpen ? html` <span class="badge orange" title="Bans waiting for review">${c.reviewsOpen}</span>` : ''}</td>
            <td class="small" style="min-width:200px;max-width:320px">${c.problems.length ? html`<span style="color:${c.problems[0].level === 'error' ? 'var(--red)' : c.problems[0].level === 'warn' ? 'var(--orange)' : 'var(--muted)'}">${c.problems[0].text}</span>${c.problems.length > 1 ? html` <span class="faint">+${c.problems.length - 1}</span>` : ''}` : html`<span class="muted">—</span>`}</td>
            <td class="nowrap" style="text-align:right">${c.home ? '' : html`<button class="btn xs" data-enter="${c.id}" title="Open this customer's dashboard with full control">${icon('door')}Manage</button>`}</td>
          </tr>`)}</tbody></table>` : empty(list.length ? 'No matching customers' : 'No customers yet', list.length ? '' : 'Create your first customer — the login, license and server key are generated automatically.', 'users')}</div>
      </div>`);
    $('#q', el).addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); render(); $('#q', el).focus(); }, 200));
  }

  function newCustomer() {
    const m = modal({
      title: 'New customer', submitLabel: 'Create customer', wide: true,
      body: String(html`
        <div class="grid g2" style="gap:12px">
          <label class="field">Server name<input class="input" name="serverName" maxlength="64" required placeholder="e.g. Gulf RP"/><span class="help">The customer, their first server and the login email are named after it</span></label>
          <label class="field">Login email<input class="input" name="email" type="email" maxlength="200" placeholder="generated automatically"/><span class="help" id="email-help">Leave empty to generate it from the server name</span></label>
          <label class="field">Plan<select class="input" name="plan"><option value="standard">Standard</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></label>
          <label class="field">Servers allowed<input class="input" name="maxServers" type="number" min="1" max="100" value="1"/></label>
          <label class="field">Duration<select class="input" name="days"><option value="7">7 days (trial)</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option><option value="">Lifetime</option></select></label>
          <label class="field">Contact (optional)<input class="input" name="contact" maxlength="200" placeholder="Discord / phone"/></label>
          <label class="field">Server IP (optional)<input class="input" name="ip" maxlength="64" placeholder="empty = lock to the first IP that connects"/></label>
          <label class="field">IP lock<select class="input" name="ipLock"><option value="1" selected>On — the license works only on that IP</option><option value="0">Off</option></select></label>
          <label class="field" style="grid-column:1/-1">Notes (optional)<textarea class="input" name="notes" maxlength="2000" style="min-height:60px" placeholder="Price paid, payment method…"></textarea></label>
        </div>
        <div class="notice" style="margin-top:12px">${icon('key')}<span>A strong password, a license and the server API key are created automatically. You get everything ready to send to the customer.</span></div>`),
      onSubmit: async (f) => {
        const body = { serverName: f.serverName.value.trim(), email: f.email.value.trim(), plan: f.plan.value, maxServers: Math.max(1, +f.maxServers.value || 1),
          days: f.days.value ? +f.days.value : null, contact: f.contact.value.trim(), notes: f.notes.value.trim(),
          ipLock: f.ipLock.value === '1', ...(f.ip.value.trim() ? { ip: f.ip.value.trim() } : {}) };
        if (body.serverName.length < 2) { toast({ type: 'error', text: 'Enter the server name' }); return false; }
        const out = await api.post('/platform/customers', body);
        toast({ type: 'success', text: `${out.customer.name} created` });
        await load();
        credentialsModal(`${out.customer.name} — ready to send`, { ...out, customerId: out.customer.id });
        return true;
      },
    });
    const nameIn = m.form.serverName;
    nameIn.addEventListener('input', debounce(async () => {
      const v = nameIn.value.trim(); if (v.length < 2) return;
      try { const r = await api.get('/platform/suggest-email?name=' + encodeURIComponent(v), { quiet: true }); m.form.email.placeholder = r.email; $('#email-help', m.el).textContent = `Will be: ${r.email}`; } catch { /* ignore */ }
    }, 300));
  }

  el.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; return render(); }
    if (e.target.closest('#new')) return newCustomer();
    const en = e.target.closest('[data-enter]');
    if (en) { e.stopPropagation(); await busy(en, () => api.post(`/platform/customers/${en.dataset.enter}/enter`)); location.hash = '#/'; location.reload(); return; }
    const op = e.target.closest('[data-open]'); if (op) ctx.navigate('/customers/' + op.dataset.open);
  });
  await load();
  const t = setInterval(() => { if (document.body.contains(el) && !document.querySelector('.modal-back')) load().catch(() => {}); }, 30000);
  return () => clearInterval(t);
}

export { esc };
