import { api, NUI } from '../api.js';
import { html, icon, fmt, $, empty, riskBar, riskColor, actionBadge, sevBadge, verifiedBadge, banStatus, modal, toast, busy, lightbox, confirmDialog } from '../ui.js';
import { weaponName, vehicleName } from '../gta.js';

export function banModal(player, onDone) {
  modal({
    title: `Ban ${player.name}`, submitLabel: 'Ban player', danger: true,
    body: html`<label class="field">Reason<input class="input" name="reason" required minlength="3" maxlength="500" placeholder="Shown to the player and in the ban list" /></label>
      <div class="form-grid"><label class="field">Duration<select class="input" name="hours"><option value="0">Permanent</option><option value="24">1 day</option><option value="72">3 days</option>
        <option value="168">7 days</option><option value="720">30 days</option><option value="2160">90 days</option></select></label>
      <label class="field">Scope<select class="input" name="scope"><option value="org">All servers of the organization</option><option value="server">Only the player's last server</option></select></label></div>
      <div class="notice">${icon('info')}<span>The player is kicked immediately on every server where they are online, and all identifiers + hardware tokens are banned.</span></div>`,
    async onSubmit(f) {
      const reason = f.reason.value.trim();
      if (reason.length < 3) { toast({ type: 'error', text: 'Reason must be at least 3 characters' }); return false; }
      const r = await api.post(`/players/${player.id}/ban`, { reason, durationHours: +f.hours.value, scope: f.scope.value });
      toast({ type: 'success', title: 'Player banned', text: r.banId });
      onDone && onDone();
    },
  });
}

export default async function player(el, ctx) {
  const id = ctx.params.id;
  const { store } = ctx;
  let p;
  let tab = 'overview';

  async function load() {
    p = await api.get('/players/' + id);
    ctx.setTitle(html`<a class="crumb" href="#/players">Players</a> <span class="faint">/</span> ${p.name}`);
    render();
  }

  function actionsBar() {
    const on = !!p.online;
    const b = (act, ic, label, perm, cls = '') => store.can(perm) ? html`<button class="btn sm ${cls}" data-act="${act}" ${on ? '' : 'disabled'} title="${on ? '' : 'Player is offline'}">${icon(ic)}${label}</button>` : '';
    const activeBans = p.bans.filter((x) => !x.revoked_at && (!x.expires_at || new Date(x.expires_at) > new Date()));
    return html`<div class="row wrap" style="gap:8px">
      ${b('screenshot', 'camera', 'Screenshot', 'players.screenshot')}
      ${store.can('players.monitor') ? html`<a class="btn sm ${on ? '' : 'hidden'}" href="#/monitoring?player=${p.id}">${icon('monitor')}Monitor</a>` : ''}
      ${b('freeze', 'snow', 'Freeze', 'players.actions')}${b('unfreeze', 'zap', 'Unfreeze', 'players.actions')}${b('heal', 'heart', 'Heal', 'players.actions')}
      ${b('teleport_to', 'target', 'Go to', 'players.actions')}${b('bring', 'crosshair', 'Bring', 'players.actions')}
      ${store.can('players.spectate') ? (NUI && on && p.online.server_id === NUI.serverId
        ? html`<button class="btn sm" data-act="spectate">${icon('eye')}Spectate</button>`
        : html`<button class="btn sm" disabled title="Spectating needs a game client: open this panel in-game with /adv">${icon('eye')}Spectate (in-game)</button>`) : ''}
      ${b('warn', 'alert', 'Warn', 'players.kick', 'warn')}${b('kick', 'logout', 'Kick', 'players.kick', 'warn')}
      ${store.can('players.ban') ? html`<button class="btn sm danger" data-act="ban">${icon('ban')}Ban</button>` : ''}
      ${store.can('players.unban') && activeBans.length ? html`<button class="btn sm success" data-act="unban" data-ban="${activeBans[0].id}">${icon('check')}Unban</button>` : ''}
    </div>
    ${store.can('players.control') ? html`<div class="row wrap" style="gap:8px;margin-top:8px">
      ${b('revive', 'heart', 'Revive', 'players.control')}${b('kill', 'x', 'Kill', 'players.control')}
      ${b('teleport_coords', 'map', 'Teleport to…', 'players.control')}${b('set_job', 'userCog', 'Set job…', 'players.control')}
      ${b('give_vehicle', 'car', 'Give vehicle…', 'players.control')}${b('strip_weapons', 'trash', 'Take all weapons', 'players.control', 'warn')}
    </div>` : ''}`;
  }

  function render() {
    const st = p.online && p.online.last_state || {};
    const t = p.riskThresholds;
    const counts = { detections: p.detections.length, sessions: p.sessions.length, bans: p.bans.length, evidence: p.evidence.length, notes: p.notes.length };
    el.innerHTML = String(html`
      <div class="card" style="margin-bottom:16px"><div class="card-b">
        <div class="row sp wrap" style="gap:16px">
          <div class="row" style="gap:16px">
            <div class="avatar" style="width:52px;height:52px;font-size:18px">${p.name.slice(0, 2).toUpperCase()}</div>
            <div><div class="row"><h2 style="font-size:20px">${p.name}</h2>
              ${p.online ? html`<span class="badge green"><span class="dot on"></span>Online · ${p.online.server_name} [${p.online.net_id}]</span>` : html`<span class="badge">Offline</span>`}
              ${p.bans.some((x) => !x.revoked_at && (!x.expires_at || new Date(x.expires_at) > new Date())) ? html`<span class="badge red">Banned</span>` : ''}</div>
              <div class="muted small mono" style="margin-top:3px">${p.license}</div></div>
          </div>
          <div class="row" style="gap:22px">
            <div style="text-align:center"><div style="font-size:28px;font-weight:750;color:${riskColor(p.risk, t)}">${p.risk}</div><div class="muted tiny">RISK SCORE</div></div>
            <div class="muted small" style="line-height:1.7">First seen <b style="color:var(--text)">${fmt.date(p.firstSeen)}</b><br/>Last seen <b style="color:var(--text)">${fmt.ago(p.lastSeen)}</b><br/>Playtime <b style="color:var(--text)">${fmt.dur(p.playtimeSec)}</b></div>
          </div>
        </div>
        <div style="margin-top:16px">${actionsBar()}</div>
        ${p.online ? html`<div class="kv" style="margin-top:16px">
          <div><span>Health</span><b>${st.hp ?? '—'}</b></div><div><span>Armor</span><b>${st.ar ?? '—'}</b></div><div><span>Ping</span><b>${st.ping ?? '—'} ms</b></div>
          <div><span>Weapon</span><b>${weaponName(st.w)}</b></div><div><span>Vehicle</span><b>${st.vm ? vehicleName(st.vm) : 'On foot'}</b></div>
          <div><span>Coordinates</span><b class="mono" style="font-size:12.5px">${st.x !== undefined ? `${Math.round(st.x)}, ${Math.round(st.y)}, ${Math.round(st.z)}` : '—'}</b></div>
          <div><span>Routing bucket</span><b>${st.b ?? 0}</b></div><div><span>Session</span><b>${fmt.dur((Date.now() - new Date(p.online.started_at)) / 1000)}</b></div></div>` : ''}
      </div></div>
      <div class="tabs">${['overview', ...(store.can('players.inventory') ? ['inventory'] : []), ...(store.can('players.mods') ? ['mods'] : []), 'detections', 'sessions', 'bans', 'evidence', 'notes'].map((k) => html`<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)}${counts[k] !== undefined ? html`<span class="n">${counts[k]}</span>` : ''}</button>`)}</div>
      <div id="tab"></div>`);
    renderTab();
  }

  function renderTab() {
    const box = $('#tab', el);
    const t = p.riskThresholds;
    if (tab === 'overview') {
      box.innerHTML = String(html`<div class="grid g2">
        <div class="card"><div class="card-h"><h3>Identifiers</h3></div><div class="card-b flush"><table class="t"><tbody>
          ${p.identifiers.map((i) => html`<tr><td class="muted" style="width:90px">${i.kind}</td><td class="mono">${i.value}</td><td class="muted small nowrap">${fmt.ago(i.last_seen)}</td></tr>`)}</tbody></table></div></div>
        <div class="col" style="gap:16px">
          <div class="card"><div class="card-h"><h3>Previous names</h3></div><div class="card-b row wrap">${p.names.map((n) => html`<span class="badge" title="last used ${fmt.date(n.last_seen)}">${n.name}</span>`)}</div></div>
          <div class="card"><div class="card-h"><h3>Related accounts</h3><span class="muted tiny">shared identifiers — evidence only, never auto-actioned</span></div><div class="card-b flush">
            ${p.related.length ? html`<table class="t"><tbody>${p.related.map((r) => html`<tr class="click" data-player="${r.id}"><td><b>${r.last_name}</b> ${r.banned ? html`<span class="badge red">Banned</span>` : ''}</td>
              <td class="row wrap" style="gap:4px">${r.shared.map((s) => html`<span class="badge ${s === 'token' ? 'orange' : ''}">${s === 'token' ? 'hardware token' : s}</span>`)}</td></tr>`)}</tbody></table>` : empty('No linked accounts', '', 'link')}
          </div></div>
          ${store.can('players.ban') ? html`<div class="card"><div class="card-b row sp"><div><b>Reputation bypass</b><div class="muted small">Prevents automatic risk-escalation bans. Explicit detection bans still apply.</div></div>
            <label class="switch"><input type="checkbox" id="rep" ${p.reputationBypass ? 'checked' : ''}/><span></span></label></div></div>` : ''}
        </div></div>`);
    } else if (tab === 'inventory') {
      if (!p.online) { box.innerHTML = String(html`<div class="card">${empty('Player is offline', 'The inventory is read live from the game server while the player is online.', 'box')}</div>`); return; }
      box.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      api.post(`/players/${p.id}/inventory`, {}, { quiet: true }).then((inv) => { if (tab === 'inventory') renderInventory(box, inv); })
        .catch((e) => { box.innerHTML = String(html`<div class="card">${empty('Could not read the inventory', e.message, 'alert')}</div>`); });
    } else if (tab === 'mods') {
      if (!p.online) { box.innerHTML = String(html`<div class="card">${empty('Player is offline', 'Mods are checked live inside the player\'s game while they are online.', 'box')}</div>`); return; }
      box.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      api.post(`/players/${p.id}/mods`, {}, { quiet: true }).then((m) => { if (tab === 'mods') renderMods(box, m); })
        .catch((e) => { box.innerHTML = String(html`<div class="card">${empty('Could not check mods', e.message, 'alert')}</div>`); });
    } else if (tab === 'detections') {
      box.innerHTML = String(p.detections.length ? html`<div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Time</th><th>Detection</th><th>Severity</th><th>Signal</th><th>Action</th><th>Risk</th><th>Details</th></tr></thead><tbody>
        ${p.detections.map((d) => html`<tr><td class="muted nowrap">${fmt.date(d.created_at)}</td><td><b>${d.detection_key}</b><div class="muted tiny">${d.category}</div></td><td>${sevBadge(d.severity)}</td>
          <td>${verifiedBadge(d.verified)}</td><td>${actionBadge(d.action_taken)}${d.action_note ? html`<div class="muted tiny">${d.action_note}</div>` : ''}</td><td>${riskBar(Math.round(d.risk_after), t)}</td>
          <td class="mono muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${JSON.stringify(d.details)}">${JSON.stringify(d.details)}</td></tr>`)}</tbody></table></div></div>` : html`<div class="card">${empty('No detections', 'This player has a clean record.', 'shieldCheck')}</div>`);
    } else if (tab === 'sessions') {
      box.innerHTML = String(html`<div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Server</th><th>ID</th><th>Started</th><th>Duration</th><th>End reason</th><th></th></tr></thead><tbody>
        ${p.sessions.map((s) => html`<tr><td>${s.server_name}</td><td class="num muted">${s.net_id ?? '—'}</td><td class="muted">${fmt.date(s.started_at)}</td>
          <td>${s.ended_at ? fmt.dur((new Date(s.ended_at) - new Date(s.started_at)) / 1000) : html`<span class="badge green">Active</span>`}</td><td class="muted">${s.end_reason || '—'}</td>
          <td>${store.can('replay.view') ? html`<a class="btn xs" href="#/replay?session=${s.id}">${icon('play')}Replay</a>` : ''}</td></tr>`)}</tbody></table></div></div>`);
    } else if (tab === 'bans') {
      box.innerHTML = String(p.bans.length ? html`<div class="card"><table class="t"><thead><tr><th>Ban ID</th><th>Reason</th><th>Issued by</th><th>Date</th><th>Status</th></tr></thead><tbody>
        ${p.bans.map((b) => html`<tr class="click" data-ban="${b.id}"><td class="mono">${b.id}</td><td>${b.reason}</td><td>${b.automatic ? html`<span class="badge violet">Automatic</span>` : b.issued_by_name}</td>
          <td class="muted">${fmt.date(b.created_at)}</td><td>${banStatus(b)}</td></tr>`)}</tbody></table></div>` : html`<div class="card">${empty('No bans', '', 'shieldCheck')}</div>`);
    } else if (tab === 'evidence') {
      box.innerHTML = String(p.evidence.length ? html`<div class="ev-grid">${p.evidence.map((e) => html`<div class="card" style="overflow:hidden"><img class="img-thumb" style="border:0;border-radius:0" loading="lazy" src="/api/v1/evidence/${e.id}/file" data-img="${e.id}" alt="" />
        <div class="card-b" style="padding:10px 12px"><div class="small">${e.detection_id ? html`Detection #${e.detection_id}` : 'Manual capture'}</div><div class="muted tiny">${fmt.date(e.created_at)} · ${e.requested_by_name}</div></div></div>`)}</div>`
        : html`<div class="card">${empty('No evidence', store.can('evidence.view') ? 'Screenshots captured by detections or staff appear here.' : 'You do not have evidence.view permission.', 'camera')}</div>`);
    } else if (tab === 'notes') {
      box.innerHTML = String(html`<div class="card">${store.can('players.notes') ? html`<div class="card-b row" style="border-bottom:1px solid var(--line)"><input class="input grow" id="note" maxlength="2000" placeholder="Add an internal note visible to staff…"/><button class="btn primary" id="add-note">${icon('plus')}Add</button></div>` : ''}
        <div class="list">${p.notes.length ? p.notes.map((n) => html`<div class="list-item" style="align-items:flex-start"><div class="avatar" style="width:28px;height:28px;font-size:11px">${n.author_name.slice(0, 2).toUpperCase()}</div>
          <div class="grow"><div class="small"><b>${n.author_name}</b> <span class="muted">· ${fmt.date(n.created_at)}</span></div><div style="white-space:pre-wrap">${n.body}</div></div></div>`) : empty('No notes', '', 'file')}</div></div>`);
    }
  }

  function renderInventory(box, inv) {
    let q = '';
    const edit = store.can('players.inventory_edit');
    const ctl = (attrs, ico, title, cls = '') => html`<button class="btn xs ${cls}" ${attrs} title="${title}">${icon(ico)}</button>`;
    const draw = () => {
      const items = inv.items.filter((i) => !q || `${i.label} ${i.name}`.toLowerCase().includes(q));
      $('#inv-items', box).innerHTML = String(items.length ? html`<table class="t"><thead><tr><th>Item</th><th>Name</th><th style="text-align:right">Count</th><th>Slot</th><th>Details</th>${edit ? html`<th></th>` : ''}</tr></thead><tbody>
        ${items.map((i) => html`<tr><td><b>${i.label}</b></td><td class="mono muted">${i.name}</td><td class="num" style="text-align:right"><b>${fmt.num(i.count)}</b></td>
          <td class="muted">${i.slot ?? '—'}</td><td class="mono muted small">${i.meta ? Object.entries(i.meta).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''}</td>
          ${edit ? html`<td class="nowrap" style="text-align:right">${ctl(`data-inv="add|item|${i.name}|1"`, 'plus', 'Add 1')}${ctl(`data-inv="remove|item|${i.name}|1"`, 'minus', 'Remove 1')}${ctl(`data-inv="remove|item|${i.name}|all"`, 'trash', 'Remove all', 'danger')}</td>` : ''}</tr>`)}</tbody></table>`
        : empty(q ? 'No matching items' : 'Inventory is empty', '', 'box'));
    };
    box.innerHTML = String(html`
      <div class="row sp" style="margin-bottom:12px"><div class="muted small">Live snapshot from <b>${inv.source}</b>${inv.job ? html` · Job: <b>${inv.job.label || inv.job.name}</b>${inv.job.grade !== undefined ? ` (${inv.job.grade})` : ''}` : ''}${inv.truncated ? ' · first 300 items' : ''}</div>
        <button class="btn sm" id="inv-refresh">${icon('refresh')}Refresh</button></div>
      ${edit ? html`<div class="card" style="margin-bottom:16px"><div class="card-b"><form id="inv-form" class="row wrap" style="gap:8px">
          <select class="input" name="type" style="max-width:130px"><option value="item">Item</option><option value="weapon">Weapon</option>${inv.accounts.length ? html`<option value="money">Money</option>` : ''}</select>
          <input class="input" name="name" list="inv-names" placeholder="name, e.g. bread / WEAPON_PISTOL / bank" maxlength="64" style="max-width:300px" required/>
          <datalist id="inv-names">${inv.items.map((i) => html`<option value="${i.name}">${i.label}</option>`)}${inv.weapons.map((w) => html`<option value="${w.name}">${w.label}</option>`)}${inv.accounts.map((a) => html`<option value="${a.name}">${a.label}</option>`)}</datalist>
          <input class="input" name="count" type="number" min="1" max="1000000" value="1" style="max-width:120px" title="Amount (ammo for weapons)"/>
          <button class="btn primary" name="act" value="add">${icon('plus')}Give</button>
          <button class="btn" name="act" value="remove">${icon('minus')}Take</button>
        </form><div class="muted tiny" style="margin-top:8px">Every change is logged in Audit Logs. For weapons the amount is the ammo.</div></div></div>` : ''}
      ${inv.accounts.length ? html`<div class="kv" style="margin-bottom:16px">${inv.accounts.map((a) => html`<div><span>${a.label}</span><b>${fmt.num(a.money)}</b></div>`)}</div>` : ''}
      ${inv.weapons.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Weapons</h3><span class="muted small">${inv.weapons.length}</span></div><div class="card-b flush"><table class="t"><tbody>
        ${inv.weapons.map((w) => html`<tr><td><b>${w.label}</b></td><td class="mono muted">${w.name}</td><td class="num" style="text-align:right">${w.ammo} ammo</td>
          ${edit ? html`<td style="text-align:right;width:60px">${ctl(`data-inv="remove|weapon|${w.name}|1"`, 'trash', 'Take weapon', 'danger')}</td>` : ''}</tr>`)}</tbody></table></div></div>` : ''}
      <div class="card"><div class="card-h"><h3>Items</h3><div class="search" style="width:220px">${icon('search')}<input class="input sm" id="inv-q" placeholder="Search items…"/></div></div><div class="card-b flush table-wrap" id="inv-items"></div></div>`);
    draw();
    $('#inv-q', box).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
    $('#inv-refresh', box).addEventListener('click', () => renderTab());
    if (!edit) return;
    const run = async (op, btn) => {
      try {
        const fresh = await busy(btn, () => api.post(`/players/${p.id}/inventory/edit`, op, { quiet: true }));
        toast({ type: 'success', text: `${op.action === 'add' ? 'Gave' : 'Took'} ${op.all ? 'all' : op.count} × ${op.name}` });
        if (tab === 'inventory') renderInventory(box, fresh);
      } catch (e) { toast({ type: 'error', text: e.message }); }
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-inv]'); if (!b) return;
      const [action, type, name, n] = b.dataset.inv.split('|');
      run({ action, type, name, count: n === 'all' ? 1 : +n, all: n === 'all' }, b);
    });
    $('#inv-form', box).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target; const action = (e.submitter && e.submitter.value) || 'add';
      const name = f.name.value.trim(); const count = Math.max(1, Math.floor(+f.count.value || 1));
      if (!/^[\w.-]{1,64}$/.test(name)) return toast({ type: 'error', text: 'Invalid name' });
      run({ action, type: f.type.value, name, count }, e.submitter || f.querySelector('button'));
    });
  }

  function renderMods(box, m) {
    const STATUS = { injected: ['red', 'Injected — not from this server'], stopped: ['orange', 'Stopped on the player'], other: ['', 'Not running'], ok: ['green', 'OK'] };
    let showOk = false;
    const pure = m.pureLevel || 0;
    const draw = () => {
      const rows = m.resources.filter((r) => showOk || r.status !== 'ok');
      $('#mods-list', box).innerHTML = String(rows.length ? html`<table class="t"><thead><tr><th>Resource</th><th>Status</th><th>On player</th><th>On server</th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td class="mono"><b>${r.name}</b></td><td><span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></td>
          <td class="muted">${r.client}</td><td class="muted">${r.server}</td></tr>`)}</tbody></table>`
        : empty('Nothing suspicious', 'Every resource running in this player\'s game comes from your server.', 'shieldCheck'));
    };
    box.innerHTML = String(html`
      <div class="row sp" style="margin-bottom:12px"><div class="muted small">Live check of every resource running in the player's game · ${fmt.date(new Date(m.checkedAt))}</div>
        <button class="btn sm" id="mods-refresh">${icon('refresh')}Check again</button></div>
      <div class="grid g4" style="margin-bottom:16px">
        <div class="card"><div class="card-b"><div class="muted small">Injected resources</div><div style="font-size:26px;font-weight:700;color:${m.counts.injected ? 'var(--red)' : 'var(--green)'}">${m.counts.injected}</div><div class="muted tiny">cheat menus usually show up here</div></div></div>
        <div class="card"><div class="card-b"><div class="muted small">Stopped on the player</div><div style="font-size:26px;font-weight:700;color:${m.counts.stopped ? 'var(--orange)' : 'var(--green)'}">${m.counts.stopped}</div><div class="muted tiny">running on the server, not in their game</div></div></div>
        <div class="card"><div class="card-b"><div class="muted small">Verified resources</div><div style="font-size:26px;font-weight:700">${m.counts.ok}</div><div class="muted tiny">match your server</div></div></div>
        <div class="card"><div class="card-b"><div class="muted small">Modded game files (sv_pureLevel)</div><div style="font-size:26px;font-weight:700;color:${pure ? 'var(--green)' : 'var(--orange)'}">${pure ? 'Blocked · ' + pure : 'Allowed'}</div><div class="muted tiny">${pure ? 'FiveM refuses players with modified files' : 'add sv_pureLevel 1 to server.cfg'}</div></div></div>
      </div>
      ${m.counts.injected ? html`<div class="notice" style="margin-bottom:16px;border-color:var(--red)">${icon('alert')}<span>This player is running <b>${m.counts.injected}</b> resource(s) your server never started. That is how most cheat menus work. Take a screenshot as evidence, then kick or ban.</span></div>` : ''}
      <div class="card"><div class="card-h"><h3>Resources</h3><label class="row small" style="gap:8px"><input type="checkbox" id="mods-ok"/>Show verified</label></div><div class="card-b flush table-wrap" id="mods-list"></div></div>
      <div class="notice warn" style="margin-top:14px">${icon('info')}<span>FiveM sandboxes every script, so no anti-cheat resource can read files on the player's PC. This check shows what actually runs inside their game. To block modified game files completely, use <code>sv_pureLevel 1</code> (audio/graphics mods allowed) or <code>2</code> (nothing allowed).</span></div>`);
    draw();
    $('#mods-ok', box).addEventListener('change', (e) => { showOk = e.target.checked; draw(); });
    $('#mods-refresh', box).addEventListener('click', () => renderTab());
  }

  el.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === tb)); return renderTab(); }
    const rel = e.target.closest('[data-player]'); if (rel) return ctx.navigate('/players/' + rel.dataset.player);
    const bn = e.target.closest('tr[data-ban]'); if (bn) return ctx.navigate('/bans/' + bn.dataset.ban);
    const img = e.target.closest('[data-img]'); if (img) return lightbox(img.src, 'Screenshot · ' + p.name);
    if (e.target.closest('#add-note')) {
      const body = $('#note', el).value.trim(); if (!body) return;
      await api.post(`/players/${p.id}/notes`, { body }); toast({ type: 'success', text: 'Note added' });
      tab = 'notes'; return load();
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'ban') return banModal({ id: p.id, name: p.name }, load);
    if (act === 'spectate') { window.parent.postMessage({ type: 'sac:action', action: 'spectate', target: p.online.net_id }, '*'); return; }
    if (act === 'unban') {
      return modal({ title: `Unban ${p.name}`, submitLabel: 'Revoke ban', body: html`<p class="muted">Revokes ban <b class="mono">${btn.dataset.ban}</b> on all servers.</p><label class="field">Reason<input class="input" name="reason" required minlength="3" maxlength="500"/></label>`,
        async onSubmit(f) { await api.post(`/bans/${btn.dataset.ban}/revoke`, { reason: f.reason.value.trim() }); toast({ type: 'success', text: 'Ban revoked' }); load(); } });
    }
    if (act === 'kick' || act === 'warn') {
      return modal({ title: `${act === 'kick' ? 'Kick' : 'Warn'} ${p.name}`, submitLabel: act === 'kick' ? 'Kick' : 'Send warning', danger: act === 'kick',
        body: html`<label class="field">${act === 'kick' ? 'Reason' : 'Message shown to the player'}<input class="input" name="msg" required maxlength="300"/></label>`,
        async onSubmit(f) { const r = await api.post(`/players/${p.id}/action`, { action: act, reason: f.msg.value, message: f.msg.value }); report(act, r); load(); } });
    }
    if (act === 'teleport_coords') {
      const st = (p.online && p.online.last_state) || {};
      return modal({ title: `Teleport ${p.name}`, submitLabel: 'Teleport',
        body: html`<div class="grid g3" style="gap:10px"><label class="field">X<input class="input" name="x" inputmode="decimal" value="${st.x !== undefined ? Math.round(st.x) : ''}"/></label>
          <label class="field">Y<input class="input" name="y" inputmode="decimal" value="${st.y !== undefined ? Math.round(st.y) : ''}"/></label><label class="field">Z<input class="input" name="z" inputmode="decimal" value="${st.z !== undefined ? Math.round(st.z) : ''}"/></label></div>
          <div class="row wrap" style="gap:6px;margin-top:10px">${[['Legion Square', 195, -934, 30], ['Pillbox Hospital', 298, -584, 43], ['Mission Row PD', 428, -981, 30], ['LS Airport', -1037, -2737, 20], ['Sandy Shores', 1850, 3690, 34], ['Paleto Bay', -448, 6008, 31]]
            .map(([n, x, y, z]) => html`<button type="button" class="btn xs" data-place="${x},${y},${z}">${n}</button>`)}</div>`,
        async onSubmit(f) {
          const v = ['x', 'y', 'z'].map((k) => Number(String(f[k].value).replace(',', '.')));
          if (!v.every(Number.isFinite)) { toast({ type: 'error', text: 'Enter X, Y and Z' }); return false; }
          report('teleport', await api.post(`/players/${p.id}/action`, { action: 'teleport_coords', x: v[0], y: v[1], z: v[2] })); load();
        } }).el.addEventListener('click', (e) => {
        const pl = e.target.closest('[data-place]'); if (!pl) return;
        const [x, y, z] = pl.dataset.place.split(','); const f = pl.closest('form'); f.x.value = x; f.y.value = y; f.z.value = z;
      });
    }
    if (act === 'set_job') {
      return modal({ title: `Set job — ${p.name}`, submitLabel: 'Set job',
        body: html`<div class="grid g2" style="gap:10px"><label class="field">Job name<input class="input" name="job" required maxlength="48" placeholder="police, ambulance, mechanic…"/></label>
          <label class="field">Grade<input class="input" name="grade" type="number" min="0" max="100" value="0"/></label></div>`,
        async onSubmit(f) { report('set job', await api.post(`/players/${p.id}/action`, { action: 'set_job', job: f.job.value.trim(), grade: Math.max(0, +f.grade.value || 0) })); load(); } });
    }
    if (act === 'give_vehicle') {
      return modal({ title: `Give vehicle — ${p.name}`, submitLabel: 'Spawn & seat player',
        body: html`<label class="field">Vehicle model<input class="input" name="m" required maxlength="48" placeholder="adder, police, sultan…"/><span class="help">Spawned next to the player, who is put in the driver seat. Blocked models are refused.</span></label>`,
        async onSubmit(f) { report('give vehicle', await api.post(`/players/${p.id}/action`, { action: 'give_vehicle', model: f.m.value.trim() })); } });
    }
    if (act === 'kill' && !(await confirmDialog(`Kill ${p.name}?`, 'The player dies immediately. Logged in the audit log.', 'Kill'))) return;
    if (act === 'strip_weapons' && !(await confirmDialog(`Take all weapons from ${p.name}?`, 'Removes every weapon from the player (and from their ESX loadout / ox_inventory).', 'Take weapons'))) return;
    if (act === 'freeze' && !(await confirmDialog(`Freeze ${p.name}?`, 'The player will not be able to move until unfrozen.', 'Freeze', false))) return;
    const r = await busy(btn, () => api.post(`/players/${p.id}/action`, { action: act }));
    report(act, r);
    if (act === 'screenshot' && r.status === 'done') { lightbox(`/api/v1/evidence/${r.result.evidenceId}/file`, 'Screenshot · ' + p.name); }
    setTimeout(load, 600);
  });
  el.addEventListener('change', async (e) => {
    if (e.target.id === 'rep') { await api.post(`/players/${p.id}/reputation-bypass`, { enabled: e.target.checked }); toast({ type: 'success', text: 'Reputation bypass ' + (e.target.checked ? 'enabled' : 'disabled') }); }
  });

  function report(act, r) {
    if (r.status === 'done') toast({ type: 'success', text: `${act.replace('_', ' ')}: done` });
    else if (r.status === 'pending') toast({ type: 'warn', text: 'Queued — the server has not confirmed yet' });
    else toast({ type: 'error', text: (r.result && r.result.error) || `${act} ${r.status}` });
  }

  await load();
  ctx.on('detection', (d) => { if (d.player_id === p.id) load(); });
  ctx.on('player:leave', (x) => { if (x.playerId === p.id) load(); });
  ctx.on('player:join', (x) => { if (x.playerId === p.id) load(); });
}
