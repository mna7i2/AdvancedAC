import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, banStatus, modal, toast, debounce } from '../ui.js';

export default async function bans(el, ctx) {
  const { store } = ctx;
  const f = { status: 'active', q: '', automatic: '' };
  let offset = 0;
  let tab = ['appeals', 'reviews'].includes(ctx.query.tab) ? ctx.query.tab : 'bans';

  el.innerHTML = String(html`<div class="tabs"><button data-tab="bans">${icon('ban')}Bans</button><button data-tab="reviews">${icon('gavel')}Ban review <span class="n" id="n-rev">0</span></button><button data-tab="appeals">${icon('file')}Appeals <span class="n" id="n-app">0</span></button></div><div id="body"></div>`);
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

  // Fair bans: players removed for a strong-but-not-certain reason wait here for a human decision.
  async function showReviews() {
    let status = 'open';
    body.innerHTML = String(html`<div class="notice" style="margin-bottom:14px">${icon('gavel')}<span>These players were <b>removed, not banned</b>. Sentinel AC found strong evidence but leaves the ban decision to staff. Approve only when the evidence convinces you.</span></div>
      <div class="btn-group" id="rst" style="margin-bottom:14px">${['open', 'approved', 'dismissed', 'all'].map((s) => html`<button data-v="${s}" class="${s === status ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`)}</div><div id="rlist" class="col"></div>`);
    const load = async () => {
      const rows = await api.get('/reviews' + qs({ status }));
      if (status === 'open') $('#n-rev', el).textContent = rows.length;
      $('#rlist', body).innerHTML = String(rows.length ? html`${rows.map((r) => html`<div class="card"><div class="card-b">
        <div class="row sp wrap"><div class="row wrap" style="gap:8px"><a href="#/players/${r.player_id}"><b>${r.player_name}</b></a><span class="badge orange">${r.reason}</span>
            ${r.previous_bans ? html`<span class="badge red">${r.previous_bans} previous ban(s)</span>` : html`<span class="badge">first offence</span>`}<span class="muted small">${r.server_name || ''} · ${fmt.ago(r.updated_at)}</span></div>
          <span class="badge ${r.status === 'open' ? 'blue' : r.status === 'approved' ? 'red' : 'green'}">${r.status}</span></div>
        <div class="col" style="gap:6px;margin-top:12px">${(r.evidence || []).map((e) => html`<div class="row small" style="gap:8px;align-items:flex-start"><span class="dot ${e.verified ? 'off' : 'warn'}" style="margin-top:5px"></span>
          <span class="grow"><b>${e.name}</b> — ${e.text}</span><span class="muted tiny nowrap">${fmt.date(e.at)}${e.verified ? ' · server-verified' : ' · client signal'}</span></div>`)}</div>
        ${r.status === 'open' && store.can('players.ban') ? html`<div class="row" style="margin-top:14px;justify-content:flex-end;gap:8px">
            <a class="btn sm" href="#/players/${r.player_id}">${icon('users')}Full profile</a>
            <button class="btn sm" data-rdis="${r.id}">${icon('check')}Not guilty — dismiss</button>
            <button class="btn sm danger" data-rban="${r.id}">${icon('ban')}Approve ban</button></div>`
          : r.decided_by ? html`<div class="muted small" style="margin-top:10px">Decided by ${r.decided_by} ${fmt.ago(r.decided_at)}${r.ban_id ? html` · <a class="mono" href="#/bans/${r.ban_id}">${r.ban_id}</a>` : ''}${r.note ? ` · “${r.note}”` : ''}</div>` : ''}
      </div></div>`)}` : html`<div class="card">${empty(status === 'open' ? 'Nothing to review' : 'No reviews', status === 'open' ? 'No player is waiting for a ban decision.' : '', 'gavel')}</div>`);
    };
    body.querySelectorAll('#rst button').forEach((b) => b.addEventListener('click', () => { status = b.dataset.v; body.querySelectorAll('#rst button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    body.onclick = (e) => {
      const ban = e.target.closest('[data-rban]');
      if (ban) {
        modal({ title: 'Approve ban', submitLabel: 'Ban player', danger: true,
          body: html`<label class="field">Duration<select class="input" name="d"><option value="24">24 hours</option><option value="72">3 days</option><option value="168" selected>7 days</option><option value="720">30 days</option><option value="0">Permanent</option></select></label>
            <label class="field">Reason shown to the player (optional)<input class="input" name="r" maxlength="500" placeholder="keeps the detected reason when empty"/></label>`,
          async onSubmit(f) { const r = await api.post(`/reviews/${ban.dataset.rban}/approve`, { durationHours: +f.d.value, ...(f.r.value.trim() ? { reason: f.r.value.trim() } : {}) }); toast({ type: 'success', text: `Banned · ${r.banId}` }); load(); } });
        return;
      }
      const dis = e.target.closest('[data-rdis]');
      if (dis) {
        modal({ title: 'Dismiss — no ban', submitLabel: 'Dismiss',
          body: html`<label class="field">Note (optional)<input class="input" name="n" maxlength="500" placeholder="e.g. lag, admin tool, false positive"/></label>`,
          async onSubmit(f) { await api.post(`/reviews/${dis.dataset.rdis}/dismiss`, { note: f.n.value.trim() }); toast({ type: 'success', text: 'Dismissed — no ban' }); load(); } });
      }
    };
    await load();
  }

  async function show() {
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    body.onclick = null;
    if (tab === 'bans') await showBans(); else if (tab === 'reviews') await showReviews(); else await showAppeals();
  }
  el.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; show(); return; }
    const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate('/bans/' + tr.dataset.id);
  });
  api.get('/appeals?status=open', { quiet: true }).then((a) => { $('#n-app', el).textContent = a.length; }).catch(() => {});
  api.get('/reviews/count', { quiet: true }).then((r) => { $('#n-rev', el).textContent = r.open; }).catch(() => {});
  await show();
  ctx.on('ban', debounce(() => { if (tab === 'bans') show(); }, 600));
}
