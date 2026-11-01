import { api } from '../api.js';
import { html, icon, fmt, empty, modal, toast, confirmDialog, busy } from '../ui.js';
import { refreshServers } from '../app.js';

function keyDialog(title, key) {
  const backend = location.origin;
  modal({ title, wide: true, hideSubmit: true, cancelLabel: 'Done', body: html`
    <div class="notice warn">${icon('alert')}<span>Copy this API key now — it is shown <b>only once</b>. Only a hash is stored.</span></div>
    <div class="code" id="key">${key}</div>
    <div class="muted small">Add to your <b>server.cfg</b> (use <code>set</code>, never <code>sets</code> — sets is public):</div>
    <div class="code">set sentinel_backend "${backend}"
set sentinel_api_key "${key}"
add_ace resource.AdvancedAC command allow
ensure screenshot-basic
ensure AdvancedAC</div>
    <button type="button" class="btn sm" id="copy">${icon('file')}Copy key</button>` });
  document.getElementById('copy').onclick = () => navigator.clipboard.writeText(key).then(() => toast({ type: 'success', text: 'Copied' }));
}

export default async function servers(el, ctx) {
  const can = ctx.store.can('servers.manage');
  async function load() {
    const [list, lic] = await Promise.all([api.get('/servers'), can ? api.get('/license').catch(() => null) : null]);
    el.innerHTML = String(html`<div class="row sp" style="margin-bottom:14px">
        <div class="muted small">${lic && lic.active ? html`License <b>${lic.active.prefix}…</b> · ${lic.active.plan} · ${lic.serversUsed}/${lic.active.maxServers} servers · ${lic.active.expiresAt ? 'expires ' + fmt.date(lic.active.expiresAt) : 'no expiry'}` : can ? html`<span class="bad">No active license</span>` : ''}</div>
        ${can ? html`<button class="btn primary" id="new">${icon('plus')}Add server</button>` : ''}</div>
      ${list.length ? html`<div class="col">${list.map((s) => html`<div class="card"><div class="card-b">
        <div class="row sp wrap" style="gap:12px"><div class="row" style="gap:14px"><div class="ico ${s.status === 'online' ? 'green' : 'red'}">${icon('server')}</div>
          <div><div class="row"><b style="font-size:15px">${s.name}</b><span class="badge ${s.status === 'online' ? 'green' : 'red'}">${s.status}</span>
            ${s.acVersion && s.acVersion !== s.latestVersion ? html`<span class="badge orange">update available ${s.latestVersion}</span>` : ''}${!s.bound ? html`<span class="badge">awaiting first connection</span>` : ''}</div>
            <div class="muted small">${s.description || s.hostname || '—'}</div></div></div>
          ${can ? html`<div class="row"><button class="btn sm" data-a="edit" data-id="${s.id}">${icon('settings')}Edit</button><button class="btn sm" data-a="rotate" data-id="${s.id}">${icon('key')}Rotate key</button>
            ${s.bound ? html`<button class="btn sm" data-a="unbind" data-id="${s.id}">${icon('link')}Reset binding</button>` : ''}<button class="btn sm danger" data-a="delete" data-id="${s.id}">${icon('x')}</button></div>` : ''}</div>
        <div class="kv" style="margin-top:14px">
          <div><span>Players</span><b>${s.status === 'online' ? s.playerCount : 0}/${s.maxPlayers}</b></div><div><span>Uptime</span><b>${s.startedAt ? fmt.dur((Date.now() - new Date(s.startedAt)) / 1000) : '—'}</b></div>
          <div><span>AC version</span><b>${s.acVersion || '—'}</b></div><div><span>Framework</span><b>${s.framework || '—'}</b></div>
          <div><span>OneSync</span><b class="${s.onesync === false ? 'bad' : ''}">${s.onesync === null ? '—' : s.onesync ? 'Enabled' : 'DISABLED'}</b></div>
          <div><span>Last heartbeat</span><b>${fmt.ago(s.lastHeartbeat)}</b></div><div><span>Server ID</span><b class="mono" style="font-size:11.5px">${s.id}</b></div>
          ${can ? html`<div><span>Server IP</span><b class="mono" style="font-size:12px">${s.ip || '—'}</b></div><div><span>API key</span><b class="mono" style="font-size:12px">${s.keyPrefix}…</b></div>
            <div style="grid-column:span 2"><span>Bound to</span><b class="mono" style="font-size:12px">${s.fingerprint || 'not bound yet'}</b></div>` : ''}
        </div></div></div>`)}</div>`
      : html`<div class="card">${empty('No servers', can ? 'Add your first server to get an API key.' : '', 'server')}</div>`}
      <div class="card" style="margin-top:16px"><div class="card-h"><h3>Installation</h3></div><div class="card-b col small">
        <div>1. Copy the <b>AdvancedAC</b> folder into your server's <code>resources</code> directory (and install <b>screenshot-basic</b> for evidence).</div>
        <div>2. Add the lines shown when you create a server (or rotate its key) to <b>server.cfg</b>, after <code>set onesync on</code>.</div>
        <div>3. Give staff the bypass/admin ACEs: <code>add_ace group.admin sentinel.admin allow</code> and <code>add_ace group.admin sentinel.bypass allow</code>.</div>
        <div>4. Restart the server. It appears here as <span class="badge green">online</span> within a few seconds; the first connection binds the key to that server.</div>
      </div></div>`);
  }

  el.addEventListener('click', async (e) => {
    if (e.target.closest('#new')) {
      return modal({ title: 'Add server', submitLabel: 'Create', body: html`<label class="field">Name<input class="input" name="name" required maxlength="64" placeholder="e.g. Main RP"/></label><label class="field">Description<input class="input" name="d" maxlength="200"/></label>`,
        async onSubmit(f) { const r = await api.post('/servers', { name: f.name.value.trim(), description: f.d.value.trim() }); await refreshServers(); await load(); setTimeout(() => keyDialog('Server created', r.apiKey), 50); } });
    }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.dataset.id; const list = await api.get('/servers'); const s = list.find((x) => x.id === id);
    if (b.dataset.a === 'rotate') {
      if (!(await confirmDialog('Rotate API key?', 'The current key stops working immediately. Update server.cfg and restart AdvancedAC with the new key.', 'Rotate'))) return;
      const r = await busy(b, () => api.post(`/servers/${id}/rotate-key`)); keyDialog('New API key', r.apiKey);
    } else if (b.dataset.a === 'unbind') {
      if (!(await confirmDialog('Reset server binding?', 'The key will bind to the next server that connects with it. Use this when moving to a new host.', 'Reset', false))) return;
      await busy(b, () => api.post(`/servers/${id}/reset-binding`)); toast({ type: 'success', text: 'Binding reset' }); load();
    } else if (b.dataset.a === 'edit') {
      modal({ title: 'Edit server', body: html`<label class="field">Name<input class="input" name="name" value="${s.name}" maxlength="64"/></label><label class="field">Description<input class="input" name="d" value="${s.description}" maxlength="200"/></label>`,
        async onSubmit(f) { await api.patch('/servers/' + id, { name: f.name.value.trim(), description: f.d.value.trim() }); await refreshServers(); load(); } });
    } else if (b.dataset.a === 'delete') {
      modal({ title: 'Delete server', danger: true, submitLabel: 'Delete permanently', body: html`<div class="notice danger">${icon('alert')}<span>Deletes the server with its sessions, telemetry and detections. Bans are kept. This cannot be undone.</span></div>
        <label class="field">Type <b>${s.name}</b> to confirm<input class="input" name="c"/></label>`,
        async onSubmit(f) { await api.del('/servers/' + id, { confirm: f.c.value }); await refreshServers(); load(); } });
    }
  });
  await load();
  ctx.on('server:status', load);
}
