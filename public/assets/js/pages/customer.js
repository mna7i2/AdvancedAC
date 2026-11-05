// Vendor console: one customer — license, servers + problems, accounts, history and every control.
import { api } from '../api.js';
import { html, icon, fmt, $, empty, modal, toast, busy, confirmDialog } from '../ui.js';
import { levelBadge, licenseBadge, credentialsModal, downloadPackage, LEVEL } from './customers.js';

export default async function customer(el, ctx) {
  const id = ctx.params.id;
  let c;

  async function load() {
    c = await api.get('/platform/customers/' + id);
    ctx.setTitle(html`<a class="crumb" href="#/customers">Customers</a> <span class="faint">/</span> ${c.name}`);
    render();
  }

  const problemList = (ps) => (ps.length ? html`<div class="col" style="gap:6px">${ps.map((p) => html`<div class="row small" style="gap:8px;align-items:flex-start">
      <span class="dot ${p.level === 'error' ? 'off' : p.level === 'warn' ? 'warn' : ''}" style="margin-top:5px"></span><span>${p.text}</span></div>`)}</div>`
    : html`<div class="row small" style="gap:8px"><span class="dot on"></span><span class="muted">No problems</span></div>`);

  function render() {
    const l = c.license;
    el.innerHTML = String(html`
      <div class="card" style="margin-bottom:16px"><div class="card-b row sp wrap" style="gap:14px">
        <div><div class="row wrap" style="gap:8px"><h2 style="font-size:20px">${c.name}</h2>
            ${c.status === 'suspended' ? html`<span class="badge red">Suspended</span>` : levelBadge(c.level)}${licenseBadge(l)}${c.home ? html`<span class="badge blue">Your organization</span>` : ''}</div>
          <div class="muted small" style="margin-top:4px">Customer since ${fmt.date(c.createdAt)}${c.contact ? ` · ${c.contact}` : ''}</div></div>
        <div class="row wrap" style="gap:8px">
          ${c.home ? '' : html`<button class="btn primary" data-act="enter">${icon('door')}Manage dashboard</button>`}
          <button class="btn" data-act="extend">${icon('clock')}Extend / change license</button>
          <button class="btn" data-act="reset">${icon('key')}Reset password</button>
          <button class="btn" data-act="server">${icon('plus')}Add server</button>
          ${c.home ? '' : (c.status === 'suspended'
            ? html`<button class="btn" data-act="activate">${icon('check')}Re-activate</button>`
            : html`<button class="btn danger" data-act="suspend">${icon('lock')}Suspend</button>`)}
        </div></div></div>

      <div class="grid g4" style="margin-bottom:16px">
        <div class="card stat"><div class="label">${icon('key')}License</div><div class="value" style="font-size:20px">${l.status === 'none' ? 'None' : (l.expiresAt ? fmt.dateShort(l.expiresAt) : 'Lifetime')}</div><div class="sub">${l.plan || '—'} · ${l.maxServers || 0} server(s) · ${l.status}</div></div>
        <div class="card stat"><div class="label">${icon('server')}Servers online</div><div class="value">${c.serversOnline}/${c.servers.length}</div><div class="sub">${fmt.num(c.playersOnline)} players now</div></div>
        <div class="card stat"><div class="label">${icon('radar')}Detections 24h</div><div class="value">${fmt.num(c.detections24h)}</div><div class="sub">${fmt.num(c.bans24h)} bans · ${c.reviewsOpen} waiting for review</div></div>
        <div class="card stat"><div class="label">${icon('userCog')}Owner</div><div class="value" style="font-size:15px;overflow-wrap:anywhere">${c.owner ? c.owner.email : '—'}</div><div class="sub">last login ${c.owner && c.owner.lastLogin ? fmt.ago(c.owner.lastLogin) : 'never'}</div></div>
      </div>

      <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Servers</h3><span class="muted small">Health is reported by the anti-cheat every ~30 s</span></div>
        <div class="card-b flush table-wrap">${c.servers.length ? html`<table class="t"><thead><tr><th>Server</th><th>Status</th><th>Players</th><th>Version</th><th>IP lock</th><th>Setup</th><th>Problems</th><th></th></tr></thead><tbody>
          ${c.servers.map((s) => html`<tr style="vertical-align:top"><td><b>${s.name}</b><div class="muted tiny">${s.hostname || ''}</div></td>
            <td><span class="badge ${s.status === 'online' ? 'green' : 'red'}">${s.status}</span><div class="muted tiny">${s.lastHeartbeat ? fmt.ago(s.lastHeartbeat) : 'never connected'}</div>${s.maintenance ? html`<div><span class="badge orange">${icon('lock')}locked</span></div>` : ''}</td>
            <td class="num">${s.players}/${s.maxPlayers || '—'}</td>
            <td>${s.acVersion || '—'}<div class="muted tiny">${s.framework || ''}</div></td>
            <td class="small nowrap">${s.ipLocked ? html`<span class="badge green">${icon('lock')}${s.allowedIp || 'first connect'}</span>` : html`<span class="badge">off</span>`}${s.lastIp ? html`<div class="muted tiny">last: ${s.lastIp}</div>` : ''}</td>
            <td class="small">${s.lastHeartbeat ? html`OneSync ${s.onesync ? '✔' : '✖'} · Screenshots ${s.health.screenshot === false ? '✖' : s.health.screenshot ? '✔' : '?'} · Pure ${s.health.pureLevel ?? '?'}` : html`<span class="muted">—</span>`}</td>
            <td style="min-width:240px">${problemList(s.problems)}</td>
            <td class="nowrap"><div class="col" style="gap:4px"><button class="btn xs primary" data-zip="${s.id}" title="Ready-to-install files with the license inside">${icon('download')}Download files</button>
              <button class="btn xs" data-ip="${s.id}">${icon('lock')}IP lock</button>
              <button class="btn xs" data-rotate="${s.id}" title="New API key (the old one stops working)">${icon('refresh')}New key</button></div></td></tr>`)}</tbody></table>` : empty('No servers', 'Add a server to get its API key.', 'server')}</div></div>

      <div class="grid g2" style="margin-bottom:16px">
        <div class="card"><div class="card-h"><h3>Accounts</h3></div><div class="card-b flush"><table class="t"><tbody>
          ${c.users.map((u) => html`<tr><td><b>${u.display_name}</b><div class="muted tiny mono">${u.email}</div></td><td><span class="badge">${u.role}</span>${u.active ? '' : html` <span class="badge red">disabled</span>`}</td>
            <td class="muted small">${u.last_login ? fmt.ago(u.last_login) : 'never'}</td><td><button class="btn xs" data-reset-user="${u.id}">${icon('key')}New password</button></td></tr>`)}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h3>Details</h3><button class="btn sm" data-act="edit">${icon('settings')}Edit</button></div><div class="card-b">
          <div class="kv"><div><span>Contact</span><b>${c.contact || '—'}</b></div><div><span>Licenses</span><b>${c.licenses.length}</b></div></div>
          <div class="muted small" style="margin-top:12px;white-space:pre-wrap">${c.notes || 'No notes.'}</div>
          ${c.home ? '' : html`<div style="margin-top:16px"><button class="btn sm danger" data-act="delete">${icon('trash')}Delete customer</button></div>`}</div></div>
      </div>

      <div class="grid g2">
        <div class="card"><div class="card-h"><h3>Recent activity</h3></div><div class="list">${c.activity.length ? c.activity.map((a) => html`<div class="list-item small"><span class="grow">${a.message}</span><span class="muted tiny nowrap">${fmt.ago(a.created_at)}</span></div>`) : empty('No activity yet', '', 'activity')}</div></div>
        <div class="card"><div class="card-h"><h3>Audit trail</h3></div><div class="list">${c.audit.length ? c.audit.map((a) => html`<div class="list-item small"><span class="grow"><b>${a.actor_name}</b> <span class="mono muted">${a.action}</span></span><span class="muted tiny nowrap">${fmt.ago(a.created_at)}</span></div>`) : empty('Nothing yet', '', 'scroll')}</div></div>
      </div>`);
  }

  function extend() {
    const l = c.license;
    modal({
      title: 'License', submitLabel: 'Save',
      body: String(html`<div class="grid g2" style="gap:12px">
        <label class="field">Add time<select class="input" name="days"><option value="">No change</option><option value="7">+7 days</option><option value="30" selected>+30 days</option><option value="90">+90 days</option><option value="180">+180 days</option><option value="365">+1 year</option><option value="life">Make lifetime</option></select>
          <span class="help">Current: ${l.expiresAt ? fmt.date(l.expiresAt) : (l.status === 'none' ? 'no license' : 'lifetime')}</span></label>
        <label class="field">Servers allowed<input class="input" name="maxServers" type="number" min="1" max="100" value="${l.maxServers || 1}"/></label>
        <label class="field">Plan<select class="input" name="plan">${['standard', 'pro', 'enterprise'].map((p) => html`<option value="${p}" ${l.plan === p ? 'selected' : ''}>${p}</option>`)}</select></label></div>`),
      onSubmit: async (f) => {
        const body = { maxServers: Math.max(1, +f.maxServers.value || 1), plan: f.plan.value };
        if (f.days.value === 'life') body.lifetime = true; else if (f.days.value) body.days = +f.days.value;
        await api.post(`/platform/customers/${id}/license`, body);
        toast({ type: 'success', text: 'License updated — servers pick it up within a minute' });
        await load();
      },
    });
  }

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    const act = a && a.dataset.act;
    if (act === 'enter') { await busy(a, () => api.post(`/platform/customers/${id}/enter`)); location.hash = '#/'; location.reload(); return; }
    if (act === 'extend') return extend();
    if (act === 'reset' || e.target.closest('[data-reset-user]')) {
      const uid = e.target.closest('[data-reset-user]') ? e.target.closest('[data-reset-user]').dataset.resetUser : undefined;
      if (!(await confirmDialog('Generate a new password?', 'The old password stops working and the account is signed out everywhere.', 'Generate', false))) return;
      const r = await api.post(`/platform/customers/${id}/reset-password`, uid ? { userId: uid } : {});
      credentialsModal('New password', { login: { url: location.origin, email: r.email, password: r.password } });
      return;
    }
    if (act === 'server') {
      modal({ title: 'Add server', submitLabel: 'Create', body: String(html`<label class="field">Server name<input class="input" name="name" maxlength="64" required/></label>
          <label class="field">Server IP (optional)<input class="input" name="ip" maxlength="64" placeholder="empty = lock to the first IP that connects"/></label>
          <label class="field">IP lock<select class="input" name="lock"><option value="1" selected>On</option><option value="0">Off</option></select></label>`),
        onSubmit: async (f) => {
          const s = await api.post(`/platform/customers/${id}/servers`, { name: f.name.value.trim(), ipLock: f.lock.value === '1', ...(f.ip.value.trim() ? { ip: f.ip.value.trim() } : {}) });
          await load();
          credentialsModal(`${s.name} — server key`, { server: s, customerId: id });
        } });
      return;
    }
    const zb = e.target.closest('[data-zip]');
    if (zb) {
      if (!(await confirmDialog('Download server files?', 'A new key is created for these files: files you sent before stop working, so send the new .zip to the customer.', 'Download', false))) return;
      zb.classList.add('loading');
      try { await downloadPackage(id, zb.dataset.zip, {}); toast({ type: 'success', text: 'Downloaded — send the .zip to the customer' }); await load(); }
      catch (err) { toast({ type: 'error', text: err.message }); } finally { zb.classList.remove('loading'); }
      return;
    }
    const ipb = e.target.closest('[data-ip]');
    if (ipb) {
      const s = c.servers.find((x) => x.id === ipb.dataset.ip);
      modal({ title: `IP lock — ${s.name}`, submitLabel: 'Save',
        body: String(html`<label class="field">IP lock<select class="input" name="on"><option value="1" ${s.ipLocked ? 'selected' : ''}>On — the license works only from this IP</option><option value="0" ${s.ipLocked ? '' : 'selected'}>Off</option></select></label>
          <label class="field">Allowed IP<input class="input" name="ip" value="${s.allowedIp || ''}" placeholder="empty = lock to the next IP that connects"/>${s.lastIp ? html`<span class="help">Last seen from ${s.lastIp}</span>` : ''}</label>`),
        onSubmit: async (f) => { await api.patch(`/platform/customers/${id}/servers/${s.id}`, { ipLocked: f.on.value === '1', allowedIp: f.ip.value.trim() || null }); toast({ type: 'success', text: 'IP lock saved' }); await load(); } });
      return;
    }
    const rot = e.target.closest('[data-rotate]');
    if (rot) {
      if (!(await confirmDialog('Generate a new API key?', 'The current key stops working immediately; the server must be updated with the new key.', 'Generate'))) return;
      const r = await api.post(`/platform/customers/${id}/servers/${rot.dataset.rotate}/rotate`);
      const s = c.servers.find((x) => x.id === rot.dataset.rotate);
      credentialsModal('New server key', { server: { id: rot.dataset.rotate, name: s ? s.name : '', ipLocked: s && s.ipLocked, ip: s && s.allowedIp, ...r }, customerId: id });
      return load();
    }
    if (act === 'suspend') {
      if (!(await confirmDialog(`Suspend ${c.name}?`, 'Their dashboard logins stop and the anti-cheat on their servers switches off within a minute. You can re-activate at any time.', 'Suspend'))) return;
      await api.post(`/platform/customers/${id}/suspend`, { reason: '' }); toast({ type: 'success', text: 'Customer suspended' }); return load();
    }
    if (act === 'activate') { await api.post(`/platform/customers/${id}/activate`); toast({ type: 'success', text: 'Customer re-activated' }); return load(); }
    if (act === 'edit') {
      modal({ title: 'Edit customer', body: String(html`<label class="field">Name<input class="input" name="name" maxlength="64" value="${c.name}"/></label>
          <label class="field">Contact<input class="input" name="contact" maxlength="200" value="${c.contact}"/></label>
          <label class="field">Notes<textarea class="input" name="notes" maxlength="2000" style="min-height:90px">${c.notes}</textarea></label>`),
        onSubmit: async (f) => { await api.patch(`/platform/customers/${id}`, { name: f.name.value.trim(), contact: f.contact.value.trim(), notes: f.notes.value.trim() }); await load(); } });
      return;
    }
    if (act === 'delete') {
      modal({ title: `Delete ${c.name}`, danger: true, submitLabel: 'Delete forever',
        body: String(html`<p class="muted">This deletes the customer, their servers, players, bans and accounts. It cannot be undone. Type <b>${c.name}</b> to confirm.</p><input class="input" name="confirm" style="margin-top:10px"/>`),
        onSubmit: async (f) => { await api.del(`/platform/customers/${id}`, { confirm: f.confirm.value }); toast({ type: 'success', text: 'Customer deleted' }); ctx.navigate('/customers'); } });
    }
  });
  await load();
  void LEVEL;
}
