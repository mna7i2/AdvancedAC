import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, riskBar } from '../ui.js';

export default async function lookup(el, ctx) {
  const t = ctx.store.settings.risk.thresholds;
  el.innerHTML = String(html`
    <div class="card" style="margin-bottom:16px"><div class="card-b">
      <form id="f" class="row"><div class="search grow">${icon('search')}<input class="input" id="q" style="height:42px;font-size:14px" placeholder="Name, license:…, steam:…, discord:…, fivem:…, or ban ID (SB-XXXXXXXX)" value="${ctx.query.q || ''}"/></div>
        <button class="btn primary" style="height:42px">Search</button></form>
      <div class="muted small" style="margin-top:10px">Searches every server in your organization. Accounts linked only by hardware tokens or IP are shown as <i>possible</i> links on the profile — never acted on automatically.</div>
    </div></div>
    <div id="res"></div>`);

  async function search(q) {
    if (q.length < 2) return;
    $('#res', el).innerHTML = '<div class="skeleton" style="height:120px"></div>';
    const r = await api.get('/lookup' + qs({ q }));
    $('#res', el).innerHTML = String(r.results.length ? html`<div class="muted small" style="margin-bottom:10px">${r.results.length} result(s) · matched by ${r.matchedBy}</div>
      <div class="card"><table class="t"><thead><tr><th>Player</th><th>Known names</th><th>License</th><th>First seen</th><th>Last seen</th><th>Playtime</th><th>Detections</th><th>Bans</th><th>Risk</th><th>Status</th></tr></thead><tbody>
      ${r.results.map((p) => html`<tr class="click" data-id="${p.id}"><td><b>${p.last_name}</b></td><td class="muted small" style="max-width:220px">${(p.names || []).join(', ')}</td>
        <td class="mono muted">${p.license.slice(0, 20)}…</td><td class="muted">${fmt.dateShort(p.first_seen)}</td><td class="muted">${fmt.ago(p.last_seen)}</td><td>${fmt.dur(p.playtime_sec)}</td>
        <td class="num">${p.detections}</td><td class="num">${p.bans}</td><td>${riskBar(p.risk, t)}</td>
        <td>${p.banned ? html`<span class="badge red">Banned</span>` : p.online ? html`<span class="badge green">Online</span>` : html`<span class="badge">Offline</span>`}</td></tr>`)}</tbody></table></div>`
      : html`<div class="card">${empty('No players found', 'Try a full identifier such as license:abc123… or a ban ID.', 'search')}</div>`);
  }
  $('#f', el).addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q', el).value.trim(); history.replaceState(null, '', '#/lookup?q=' + encodeURIComponent(q)); search(q); });
  el.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate('/players/' + tr.dataset.id); });
  if (ctx.query.q) search(ctx.query.q);
  $('#q', el).focus();
}
