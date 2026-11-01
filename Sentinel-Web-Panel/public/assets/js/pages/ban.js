import { api } from '../api.js';
import { html, icon, $, fmt, banStatus, actionBadge, sevBadge, verifiedBadge, modal, toast, lightbox, empty } from '../ui.js';

export default async function ban(el, ctx) {
  const { store } = ctx;
  let b;
  async function load() {
    b = await api.get('/bans/' + encodeURIComponent(ctx.params.id));
    ctx.setTitle(html`<a class="crumb" href="#/bans">Bans</a> <span class="faint">/</span> <span class="mono">${b.id}</span>`);
    render();
  }
  function render() {
    const active = !b.revoked_at && (!b.expires_at || new Date(b.expires_at) > new Date());
    el.innerHTML = String(html`<div class="grid g-main">
      <div class="col" style="gap:16px">
        <div class="card"><div class="card-b">
          <div class="row sp"><div><div class="row"><h2 style="font-size:20px" class="mono">${b.id}</h2>${banStatus(b)}${b.automatic ? html`<span class="badge violet">${icon('shield')}Automatic</span>` : ''}</div>
            <div class="muted" style="margin-top:4px">${b.reason}</div></div>
            <div class="row">${active && store.can('players.ban') ? html`<button class="btn sm" id="edit">${icon('settings')}Edit</button>` : ''}
              ${active && store.can('players.unban') ? html`<button class="btn sm success" id="revoke">${icon('check')}Revoke ban</button>` : ''}</div></div>
          <div class="kv" style="margin-top:16px">
            <div><span>Player</span><b>${b.player_id ? html`<a href="#/players/${b.player_id}">${b.player_name}</a>` : b.player_name}</b></div>
            <div><span>Issued by</span><b>${b.issued_by_name}</b></div><div><span>Issued</span><b>${fmt.date(b.created_at)}</b></div>
            <div><span>Expires</span><b>${b.expires_at ? fmt.date(b.expires_at) : 'Never (permanent)'}</b></div>
            <div><span>Scope</span><b>${b.scope === 'org' ? 'All organization servers' : b.server_name}</b></div><div><span>Origin server</span><b>${b.server_name || '—'}</b></div>
            ${b.revoked_at ? html`<div><span>Revoked</span><b>${fmt.date(b.revoked_at)}</b></div><div><span>Revoked by</span><b>${b.revoked_by_name}</b></div>` : ''}
          </div>
          ${b.revoke_reason ? html`<div class="notice" style="margin-top:12px">${icon('info')}<span>Revoke reason: ${b.revoke_reason}</span></div>` : ''}
        </div></div>
        ${b.detection ? html`<div class="card"><div class="card-h"><h3>Detection evidence</h3><span class="row">${sevBadge(b.detection.severity)}${verifiedBadge(b.detection.verified)}${actionBadge(b.detection.action_taken)}</span></div><div class="card-b col">
          <div class="kv"><div><span>Detection</span><b>${b.detection_key}</b></div><div><span>Category</span><b>${b.category}</b></div><div><span>Risk at ban</span><b>${Math.round(b.detection.risk_after)}/100</b></div><div><span>Detected</span><b>${fmt.date(b.detection.created_at)}</b></div></div>
          ${b.detection.action_note ? html`<div class="notice">${icon('info')}<span>${b.detection.action_note}</span></div>` : ''}
          <div class="code">${JSON.stringify(b.detection.details, null, 2)}</div>
          ${b.evidence.length ? html`<div class="ev-grid">${b.evidence.map((e) => html`<img class="img-thumb" src="/api/v1/evidence/${e.id}/file" data-img alt=""/>`)}</div>` : html`<div class="muted small">No screenshot was captured for this detection.</div>`}
          ${store.can('replay.view') && b.detection.session_id ? html`<div><a class="btn sm" href="#/replay?session=${b.detection.session_id}">${icon('play')}Replay the session</a></div>` : ''}
        </div></div>` : ''}
      </div>
      <div class="col" style="gap:16px">
        <div class="card"><div class="card-h"><h3>Banned identifiers</h3><span class="muted small">${b.identifiers.length}</span></div><div class="card-b flush"><table class="t"><tbody>
          ${b.identifiers.map((i) => html`<tr><td class="muted" style="width:80px">${i.kind === 'token' ? 'hw token' : i.kind}</td><td class="mono" style="word-break:break-all">${i.value}</td></tr>`)}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h3>Appeals</h3></div><div class="card-b flush">${b.appeals.length ? html`<div class="list">${b.appeals.map((a) => html`<div class="list-item" style="display:block">
          <div class="row sp"><span class="badge ${a.status === 'open' ? 'blue' : a.status === 'accepted' ? 'green' : 'red'}">${a.status}</span><span class="muted tiny">${fmt.ago(a.created_at)}</span></div>
          <div class="small" style="margin-top:6px;white-space:pre-wrap">${a.message}</div></div>`)}</div>` : empty('No appeals', '', 'file')}
          ${b.appeals.some((a) => a.status === 'open') ? html`<div style="padding:12px"><a class="btn sm" href="#/bans?tab=appeals">Review appeals →</a></div>` : ''}</div></div>
        <div class="card"><div class="card-h"><h3>Previous bans of this player</h3></div><div class="card-b flush">${b.history.length ? html`<div class="list">${b.history.map((h) => html`<a class="list-item" href="#/bans/${h.id}" style="color:inherit;text-decoration:none">
          <span class="mono">${h.id}</span><span class="grow muted small">${h.reason}</span><span class="muted tiny">${fmt.dateShort(h.created_at)}</span></a>`)}</div>` : empty('First offence', '', 'check')}</div></div>
      </div></div>`);
    el.querySelectorAll('[data-img]').forEach((i) => i.addEventListener('click', () => lightbox(i.src, b.id)));
    const rv = $('#revoke', el);
    if (rv) rv.onclick = () => modal({ title: `Revoke ${b.id}`, submitLabel: 'Revoke ban', body: html`<p class="muted">${b.player_name} will be able to join all servers again.</p><label class="field">Reason<input class="input" name="r" required minlength="3" maxlength="500"/></label>`,
      async onSubmit(f) { await api.post(`/bans/${b.id}/revoke`, { reason: f.r.value.trim() }); toast({ type: 'success', text: 'Ban revoked' }); load(); } });
    const ed = $('#edit', el);
    if (ed) ed.onclick = () => modal({ title: `Edit ${b.id}`, body: html`<label class="field">Reason<input class="input" name="reason" value="${b.reason}" maxlength="500"/></label>
      <label class="field">Duration from issue date<select class="input" name="h"><option value="">Keep current (${b.expires_at ? 'until ' + fmt.date(b.expires_at) : 'permanent'})</option><option value="0">Permanent</option>
        <option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option><option value="720">30 days</option><option value="2160">90 days</option></select></label>`,
      async onSubmit(f) { await api.patch(`/bans/${b.id}`, { reason: f.reason.value.trim(), ...(f.h.value !== '' ? { durationHours: +f.h.value } : {}) }); toast({ type: 'success', text: 'Ban updated' }); load(); } });
  }
  await load();
}
