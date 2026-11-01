import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, banStatus, modal, toast, debounce } from '../ui.js';

export default async function bans(el, ctx) {
  const { store } = ctx;
  const f = { status: 'active', q: '', automatic: '' };
  let offset = 0;
  let tab = ctx.query.tab === 'appeals' ? 'appeals' : 'bans';

  el.innerHTML = String(html`<div class="tabs"><button data-tab="bans">${icon('ban')}Bans</button><button data-tab="appeals">${icon('file')}Appeals <span class="n" id="n-app">0</span></button></div><div id="body"></div>`);
  const body = $('#body', el);

  async function showBans() {
    body.innerHTML = String(html`<div class="row wrap" style="margin-bottom:14px">
      <div class="search" style="width:300px">${icon('search')}<input class="input" id="q" placeholder="Player, ban ID or reason…" value="${f.q}"/></div>
      <div class="btn-group" id="status">${['active', 'expired', 'revoked', 'all'].map((s) => html`<button data-v="${s}" class="${f.status === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`)}</div>
      <select class="input" id="auto" style="width:170px"><option value="">Manual + automatic</option><option value="true">Automatic only</option><option value="false">Manual only</option></select>
      <div class="grow"></div><span class="muted small nui-hide">Public appeal page: <a href="/appeal.html" target="_blank">/appeal.html</a></span></div>
      <div class="card"><div class="table-wrap" id="table"></div><div class="pager"><button class="btn sm" id="prev">Previous</button><button class="btn sm" id="next">Next</button></div></div>`);
    $('#auto', body).value = f.automatic;
    const load = async () => {
      const rows = await api.get('/bans' + qs({ ...f, limit: 50, offset }));
      $('#table', body).innerHTML = String(rows.length ? html`<table class="t"><thead><tr><th>Ban ID</th><th>Player</th><th>Reason</th><th>Issued by</th><th>Server</th><th>Date</th><th>Expires</th><th>Status</th></tr></thead><tbody>
        ${rows.map((b) => html`<tr class="click" data-id="${b.id}"><td class="mono">${b.id}</td>
          <td><b>${b.player_name}</b>${b.player_ban_count > 1 ? html` <span class="badge red" title="Repeat offender">×${b.player_ban_count}</span>` : ''}</td>
          <td style="max-width:280px">${b.reason}${b.open_appeals ? html` <span class="badge blue">appeal</span>` : ''}</td>
          <td>${b.automatic ? html`<span class="badge violet">${icon('shield')}Sentinel AC</span>` : b.issued_by_name}</td><td class="muted">${b.scope === 'org' ? 'All servers' : b.server_name}</td>
          <td class="muted nowrap">${fmt.date(b.created_at)}</td><td class="muted nowrap">${b.expires_at ? fmt.date(b.expires_at) : 'Never'}</td><td>${banStatus(b)}</td></tr>`)}</tbody></table>`
        : empty('No bans', 'Nothing matches these filters.', 'ban'));
      $('#prev', body).disabled = offset === 0; $('#next', body).disabled = rows.length < 50;
    };
    $('#q', body).addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); offset = 0; load(); }, 250));
    $('#auto', body).addEventListener('change', (e) => { f.automatic = e.target.value; offset = 0; load(); });
    body.querySelectorAll('#status button').forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.v; offset = 0; body.querySelectorAll('#status button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    $('#prev', body).onclick = () => { offset = Math.max(0, offset - 50); load(); };
    $('#next', body).onclick = () => { offset += 50; load(); };
    await load();
    return load;
  }

  async function showAppeals() {
    let status = 'open';
    body.innerHTML = String(html`<div class="btn-group" id="ast" style="margin-bottom:14px">${['open', 'accepted', 'rejected', 'all'].map((s) => html`<button data-v="${s}" class="${s === status ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`)}</div><div id="alist" class="col"></div>`);
    const load = async () => {
      const rows = await api.get('/appeals' + qs({ status }));
      if (status === 'open') $('#n-app', el).textContent = rows.length;
      $('#alist', body).innerHTML = String(rows.length ? html`${rows.map((a) => html`<div class="card"><div class="card-b">
        <div class="row sp"><div class="row"><b>${a.player_name}</b><a class="mono small" href="#/bans/${a.ban_id}">${a.ban_id}</a>${a.automatic ? html`<span class="badge violet">automatic ban</span>` : ''}</div>
          <span class="badge ${a.status === 'open' ? 'blue' : a.status === 'accepted' ? 'green' : 'red'}">${a.status}</span></div>
        <div class="muted small" style="margin:4px 0 10px">Ban: ${a.ban_reason} · appealed ${fmt.ago(a.created_at)}${a.contact ? html` · contact: <b>${a.contact}</b>` : ''}</div>
        <div class="code" style="white-space:pre-wrap">${a.message}</div>
        ${a.status === 'open' && store.can('bans.appeals') ? html`<div class="row" style="margin-top:12px;justify-content:flex-end">
          <button class="btn sm danger" data-dec="rejected" data-a="${a.id}">${icon('x')}Reject</button>
          ${store.can('players.unban') ? html`<button class="btn sm success" data-dec="accepted" data-a="${a.id}">${icon('check')}Accept & unban</button>` : ''}</div>`
          : a.reviewed_by_name ? html`<div class="muted small" style="margin-top:10px">Reviewed by ${a.reviewed_by_name} ${fmt.ago(a.reviewed_at)}${a.response ? html`: “${a.response}”` : ''}</div>` : ''}
      </div></div>`)}` : html`<div class="card">${empty('No appeals', '', 'file')}</div>`);
    };
    body.querySelectorAll('#ast button').forEach((b) => b.addEventListener('click', () => { status = b.dataset.v; body.querySelectorAll('#ast button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    body.onclick = (e) => {
      const d = e.target.closest('[data-dec]'); if (!d) return;
      modal({ title: d.dataset.dec === 'accepted' ? 'Accept appeal & unban' : 'Reject appeal', submitLabel: d.dataset.dec === 'accepted' ? 'Accept & unban' : 'Reject', danger: d.dataset.dec === 'rejected',
        body: html`<label class="field">Response (internal record)<textarea class="input" name="resp" maxlength="1000"></textarea></label>`,
        async onSubmit(form) { await api.post(`/appeals/${d.dataset.a}`, { decision: d.dataset.dec, response: form.resp.value }); toast({ type: 'success', text: 'Appeal ' + d.dataset.dec }); load(); } });
    };
    await load();
  }

  async function show() {
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    body.onclick = null;
    if (tab === 'bans') await showBans(); else await showAppeals();
  }
  el.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; show(); return; }
    const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate('/bans/' + tr.dataset.id);
  });
  api.get('/appeals?status=open', { quiet: true }).then((a) => { $('#n-app', el).textContent = a.length; }).catch(() => {});
  await show();
  ctx.on('ban', debounce(() => { if (tab === 'bans') show(); }, 600));
}
