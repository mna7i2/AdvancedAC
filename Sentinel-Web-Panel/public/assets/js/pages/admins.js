import { api } from '../api.js';
import { html, icon, $, fmt, modal, toast } from '../ui.js';

export default async function admins(el, ctx) {
  const { store } = ctx;
  const meta = await api.get('/meta');
  const PERMS = meta.permissions;
  let tab = 'admins';
  let roles = [];

  const identHelp = 'In-game identity used for in-game staff permissions and dashboard teleport/bring. One per line: license:…, discord:…, steam:…, fivem:…';
  const permBoxes = (name, selected, disabledFn = () => false) => html`<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;max-height:260px;overflow:auto">
    ${Object.entries(PERMS).map(([k, label]) => html`<label class="row small" style="gap:8px" title="${k}"><input type="checkbox" name="${name}" value="${k}" ${selected.includes(k) ? 'checked' : ''} ${disabledFn(k) ? 'disabled' : ''}/>${label}</label>`)}</div>`;
  const checked = (f, name) => [...f.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const idents = (txt) => txt.split('\n').map((s) => s.trim()).filter(Boolean);

  async function load() {
    roles = await api.get('/roles');
    el.innerHTML = String(html`<div class="row sp"><div class="tabs" style="flex:1"><button data-tab="admins" class="${tab === 'admins' ? 'on' : ''}">${icon('users')}Administrators</button><button data-tab="roles" class="${tab === 'roles' ? 'on' : ''}">${icon('lock')}Roles & permissions</button></div>
      ${tab === 'admins' ? html`<button class="btn primary" id="new" style="margin-bottom:16px">${icon('plus')}Add administrator</button>` : ''}</div><div id="body"></div>`);
    if (tab === 'admins') {
      const list = await api.get('/admins');
      $('#body', el).innerHTML = String(html`<div class="card"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>In-game identity</th><th>Last login</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((a) => html`<tr><td><b>${a.display_name}</b>${a.id === store.user.id ? html` <span class="badge blue">you</span>` : ''}</td><td class="muted">${a.email}</td>
          <td><span class="badge ${a.role === 'Owner' ? 'violet' : ''}">${a.role}</span>${a.extra_permissions.length || a.denied_permissions.length ? html` <span class="muted tiny">custom</span>` : ''}</td>
          <td class="mono muted small">${a.linked_identifiers.join(', ') || '—'}</td><td class="muted">${fmt.ago(a.last_login)}</td>
          <td>${!a.active ? html`<span class="badge">Disabled</span>` : a.locked_until && new Date(a.locked_until) > new Date() ? html`<span class="badge red">Locked</span>` : html`<span class="badge green">Active</span>`}</td>
          <td><button class="btn xs" data-edit="${a.id}">${icon('settings')}Edit</button></td></tr>`)}</tbody></table></div>`);
      $('#body', el).onclick = (e) => { const b = e.target.closest('[data-edit]'); if (b) edit(list.find((a) => a.id === b.dataset.edit)); };
    } else {
      $('#body', el).innerHTML = String(html`<div class="notice" style="margin-bottom:14px">${icon('info')}<span>You can only edit roles ranked below yours and grant permissions you have. The Owner role always has every permission.</span></div>
        <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Permission</th>${roles.map((r) => html`<th style="text-align:center">${r.name}</th>`)}</tr></thead><tbody>
        ${Object.entries(PERMS).map(([k, label]) => html`<tr><td>${label}<div class="faint tiny mono">${k}</div></td>${roles.map((r) => html`<td style="text-align:center"><input type="checkbox" data-role="${r.id}" value="${k}" ${r.permissions.includes(k) ? 'checked' : ''}
          ${r.name === 'Owner' || r.rank >= store.user.rank || !store.can(k) ? 'disabled' : ''}/></td>`)}</tr>`)}</tbody></table></div>
        <div class="pager"><button class="btn primary" id="save-roles">${icon('check')}Save roles</button></div></div>`);
      $('#save-roles', el).onclick = async () => {
        for (const r of roles) {
          if (r.name === 'Owner' || r.rank >= store.user.rank) continue;
          const perms = [...el.querySelectorAll(`input[data-role="${r.id}"]:checked`)].map((i) => i.value);
          await api.put('/roles/' + r.id, { permissions: perms });
        }
        toast({ type: 'success', text: 'Roles saved — in-game staff permissions sync automatically' }); load();
      };
    }
  }

  const roleOptions = (sel) => roles.filter((r) => store.user.role === 'Owner' || r.rank < store.user.rank).map((r) => html`<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${r.name}</option>`);

  function create() {
    modal({ title: 'Add administrator', submitLabel: 'Create', wide: true, body: html`<div class="form-grid">
      <label class="field">Name<input class="input" name="name" required maxlength="64"/></label><label class="field">Email<input class="input" name="email" type="email" required/></label>
      <label class="field">Password<input class="input" name="pw" type="password" required minlength="10" autocomplete="new-password"/><span class="help">At least 10 characters with letters and numbers</span></label>
      <label class="field">Role<select class="input" name="role">${roleOptions()}</select></label></div>
      <label class="field">Linked in-game identifiers<textarea class="input mono" name="ids" placeholder="license:…"></textarea><span class="help">${identHelp}</span></label>`,
      async onSubmit(f) { await api.post('/admins', { name: f.name.value.trim(), email: f.email.value.trim(), password: f.pw.value, roleId: +f.role.value, linkedIdentifiers: idents(f.ids.value) }); toast({ type: 'success', text: 'Administrator created' }); load(); } });
  }

  function edit(a) {
    const self = a.id === store.user.id;
    const role = roles.find((r) => r.id === a.role_id);
    modal({ title: `Edit ${a.display_name}`, wide: true, body: html`<div class="form-grid">
      <label class="field">Name<input class="input" name="name" value="${a.display_name}" maxlength="64"/></label>
      <label class="field">Role<select class="input" name="role" ${self ? 'disabled' : ''}>${self ? html`<option>${a.role}</option>` : roleOptions(a.role_id)}</select></label>
      <label class="field">New password<input class="input" name="pw" type="password" autocomplete="new-password" placeholder="Leave empty to keep"/></label>
      <label class="field">Status<select class="input" name="active" ${self ? 'disabled' : ''}><option value="true" ${a.active ? 'selected' : ''}>Active</option><option value="false" ${!a.active ? 'selected' : ''}>Disabled (signs out everywhere)</option></select></label></div>
      <label class="field">Linked in-game identifiers<textarea class="input mono" name="ids">${a.linked_identifiers.join('\n')}</textarea><span class="help">${identHelp}</span></label>
      <details><summary class="small" style="cursor:pointer;color:var(--text2)">Per-user permission overrides (role: ${a.role})</summary><div class="col" style="margin-top:10px">
        <div class="small muted">Extra permissions (in addition to the role)</div>${permBoxes('extra', a.extra_permissions, (k) => !store.can(k) || (role && role.permissions.includes(k)))}
        <div class="small muted" style="margin-top:8px">Denied permissions (removed from the role)</div>${permBoxes('deny', a.denied_permissions)}</div></details>
      ${a.locked_until && new Date(a.locked_until) > new Date() ? html`<label class="row small"><input type="checkbox" name="unlock" checked/> Unlock account (locked after failed logins)</label>` : ''}`,
      async onSubmit(f) {
        const body = { name: f.name.value.trim(), linkedIdentifiers: idents(f.ids.value), extraPermissions: checked(f, 'extra'), deniedPermissions: checked(f, 'deny') };
        if (!self) { body.roleId = +f.role.value; body.active = f.active.value === 'true'; }
        if (f.pw.value) body.password = f.pw.value;
        if (f.unlock && f.unlock.checked) body.unlock = true;
        await api.patch('/admins/' + a.id, body); toast({ type: 'success', text: 'Saved' }); load();
      } });
  }

  el.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; load(); return; }
    if (e.target.closest('#new')) create();
  });
  await load();
}
