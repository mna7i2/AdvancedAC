import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, busy, debounce, modal } from '../ui.js';

export default async function audit(el, ctx) {
  let offset = 0;
  const f = { action: '', actor: '' };
  el.innerHTML = String(html`<div class="row sp wrap" style="margin-bottom:14px">
      <div class="row"><div class="search" style="width:220px">${icon('search')}<input class="input" id="actor" placeholder="Actor…"/></div>
        <select class="input" id="action" style="width:200px"><option value="">All actions</option>${['ban.', 'ingame.', 'player.', 'detection.', 'settings.', 'admin.', 'role.', 'server.', 'console.', 'monitor.', 'auth.', 'appeal.', 'discord.'].map((a) => html`<option value="${a}">${a}*</option>`)}</select></div>
      <div class="row"><span id="chain" class="small"></span><button class="btn sm" id="verify">${icon('shieldCheck')}Verify integrity</button></div></div>
    <div class="card"><div class="table-wrap" id="table"></div><div class="pager"><button class="btn sm" id="prev">Previous</button><button class="btn sm" id="next">Next</button></div></div>`);
  let rows = [];
  async function load() {
    rows = await api.get('/audit' + qs({ ...f, limit: 50, offset }));
    $('#table', el).innerHTML = String(rows.length ? html`<table class="t"><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => html`<tr class="click" data-i="${i}"><td class="num muted">${r.id}</td><td class="muted nowrap">${fmt.date(r.created_at)}</td>
        <td><b>${r.actor_name}</b><div class="muted tiny">${r.actor_type}</div></td><td class="mono">${r.action}</td>
        <td class="muted">${r.target_type ? `${r.target_type} ${r.target_id || ''}` : '—'}</td><td class="mono muted small">${r.ip || '—'}</td><td class="mono faint tiny">${r.hash.slice(0, 10)}</td></tr>`)}</tbody></table>`
      : empty('No entries', '', 'scroll'));
    $('#prev', el).disabled = offset === 0; $('#next', el).disabled = rows.length < 50;
  }
  el.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    const r = rows[+tr.dataset.i];
    modal({ title: `Audit #${r.id} · ${r.action}`, hideSubmit: true, cancelLabel: 'Close', wide: true,
      body: html`<div class="kv"><div><span>Actor</span><b>${r.actor_name}</b></div><div><span>Type</span><b>${r.actor_type}</b></div><div><span>Time</span><b>${fmt.date(r.created_at)}</b></div></div>
        <div class="code">${JSON.stringify(r.details, null, 2)}</div><div class="muted tiny mono">hash ${r.hash}</div>` });
  });
  $('#verify', el).onclick = async () => {
    const r = await busy($('#verify', el), () => api.get('/audit/verify'));
    $('#chain', el).innerHTML = String(r.ok ? html`<span class="ok">✔ Hash chain intact (${r.checked} entries)</span>` : html`<span class="bad">✘ Chain broken at entry #${r.brokenAt}</span>`);
  };
  $('#actor', el).addEventListener('input', debounce((e) => { f.actor = e.target.value.trim(); offset = 0; load(); }, 250));
  $('#action', el).addEventListener('change', (e) => { f.action = e.target.value; offset = 0; load(); });
  $('#prev', el).onclick = () => { offset = Math.max(0, offset - 50); load(); };
  $('#next', el).onclick = () => { offset += 50; load(); };
  await load();
  ctx.on('audit', debounce(() => { if (offset === 0) load(); }, 500));
}
