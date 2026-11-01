import { api, qs } from '../api.js';
import { html, $, fmt, empty, lightbox } from '../ui.js';

export default async function evidence(el, ctx) {
  let offset = 0;
  el.innerHTML = String(html`<div class="row sp" style="margin-bottom:14px"><div class="muted small">Screenshots captured by detections (before enforcement) and by staff. Files are stored privately with a SHA-256 checksum and served only to authorised staff.</div>
    <div class="row"><button class="btn sm" id="prev">Previous</button><button class="btn sm" id="next">Next</button></div></div><div id="grid"></div>`);
  let rows = [];
  async function load() {
    rows = await api.get('/evidence' + qs({ kind: 'screenshot', limit: 48, offset }));
    $('#grid', el).innerHTML = String(rows.length ? html`<div class="ev-grid">${rows.map((e, i) => html`<div class="card" style="overflow:hidden">
      <img class="img-thumb" style="border:0;border-radius:0" loading="lazy" src="/api/v1/evidence/${e.id}/file" data-i="${i}" alt=""/>
      <div class="card-b" style="padding:10px 12px"><div class="row sp"><a href="#/players/${e.player_id}"><b>${e.player_name || 'Unknown'}</b></a><span class="muted tiny">${fmt.ago(e.created_at)}</span></div>
        <div class="small" style="margin-top:3px">${e.detection_name ? html`<span class="badge orange">${e.detection_name}</span>` : html`<span class="badge">Manual · ${e.requested_by_name}</span>`}</div>
        <div class="faint tiny mono" style="margin-top:6px" title="SHA-256">${e.sha256.slice(0, 16)}… · ${fmt.bytes(e.size_bytes)} · ${e.server_name || ''}</div></div></div>`)}</div>`
      : html`<div class="card">${empty('No evidence yet', 'Enable “Screenshot evidence” on detections, or request a screenshot from a player profile. Requires screenshot-basic on the server.', 'camera')}</div>`);
    $('#prev', el).disabled = offset === 0; $('#next', el).disabled = rows.length < 48;
  }
  el.addEventListener('click', (e) => {
    const img = e.target.closest('img[data-i]');
    if (img) { const r = rows[+img.dataset.i]; lightbox(img.src, `${r.player_name} · ${fmt.date(r.created_at)}${r.detection_name ? ' · ' + r.detection_name : ''}`); }
  });
  $('#prev', el).onclick = () => { offset = Math.max(0, offset - 48); load(); };
  $('#next', el).onclick = () => { offset += 48; load(); };
  await load();
  ctx.on('evidence', () => { if (offset === 0) load(); });
}
