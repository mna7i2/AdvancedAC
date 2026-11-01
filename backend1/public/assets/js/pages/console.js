import { api } from '../api.js';
import { html, icon, $, fmt, empty, toast, busy, confirmDialog, esc } from '../ui.js';

export default async function consolePage(el, ctx) {
  const { store } = ctx;
  const s = store.server();
  if (!s) { el.innerHTML = String(html`<div class="card">${empty('No server selected', '', 'server')}</div>`); return; }
  const canExec = store.can('console.execute');
  el.innerHTML = String(html`
    <div class="row sp" style="margin-bottom:12px"><div class="row"><b>${s.name}</b><span class="badge ${s.status === 'online' ? 'green' : 'red'}">${s.status}</span></div>
      <div class="row"><label class="row small muted"><input type="checkbox" id="auto" checked/> Auto-scroll</label><button class="btn sm" id="older">Load older</button></div></div>
    <div class="console" id="out"></div>
    ${canExec ? html`<form id="f" class="row" style="margin-top:10px"><div class="search grow">${icon('terminal')}<input class="input mono" id="cmd" placeholder="Server command, e.g. status · ensure my-resource" autocomplete="off"/></div><button class="btn primary">Execute</button></form>
      <div class="help" style="margin-top:6px">Requires <code>add_ace resource.AdvancedAC command allow</code> in server.cfg. Every command is written to the audit log.</div>`
      : html`<div class="muted small" style="margin-top:10px">Read-only (console.execute permission required to run commands).</div>`}
    ${canExec ? html`<div class="card" style="margin-top:16px"><div class="card-h"><h3>Resources</h3><div class="search" style="width:220px">${icon('search')}<input class="input sm" id="rq" placeholder="Filter…"/></div></div><div class="card-b flush" style="max-height:340px;overflow:auto" id="res"></div></div>` : ''}`);

  const out = $('#out', el);
  let oldest = null;
  const line = (l) => `<div class="l"><span class="ts">${esc(fmt.time(l.ts || l.t))}</span><span class="ch">${esc(l.channel || l.ch)}</span>${esc(l.line)}</div>`;
  function append(lines, prepend = false) {
    const htmlStr = lines.map(line).join('');
    if (prepend) out.insertAdjacentHTML('afterbegin', htmlStr); else out.insertAdjacentHTML('beforeend', htmlStr);
    while (out.children.length > 3000) out.firstChild.remove();
    if (!prepend && $('#auto', el).checked) out.scrollTop = out.scrollHeight;
  }
  const first = await api.get(`/servers/${s.id}/console`);
  if (first.length) oldest = first[0].id;
  append(first);
  if (!first.length) out.innerHTML = '<div class="l" style="color:var(--muted)">No console output received yet. Lines stream here live while the server is online.</div>';
  $('#older', el).onclick = async () => {
    if (!oldest) return;
    const r = await api.get(`/servers/${s.id}/console?before=${oldest}`);
    if (r.length) { oldest = r[0].id; append(r, true); } else toast({ text: 'No older lines' });
  };
  ctx.on('console', (m) => { if (m.serverId === s.id) append(m.lines); });

  if (canExec) {
    $('#f', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const cmd = $('#cmd', el).value.trim(); if (!cmd) return;
      const btn = e.target.querySelector('button');
      const r = await busy(btn, () => api.post(`/servers/${s.id}/console`, { command: cmd }));
      if (r.status === 'done') { $('#cmd', el).value = ''; } else toast({ type: 'error', text: r.status === 'pending' ? 'Server did not acknowledge (offline?)' : (r.result && r.result.error) || 'Failed' });
    });
    const srv = await api.get('/servers/' + s.id);
    const res = (srv.resources || []).sort((a, b) => a.name.localeCompare(b.name));
    const draw = (q = '') => {
      $('#res', el).innerHTML = String(res.length ? html`<table class="t"><tbody>${res.filter((r) => r.name.includes(q)).map((r) => html`<tr><td class="mono">${r.name}</td>
        <td><span class="badge ${r.state === 'started' ? 'green' : ''}">${r.state}</span></td><td style="text-align:right">${r.name === 'AdvancedAC' ? html`<span class="muted tiny">protected</span>` : html`
          <button class="btn xs" data-r="${r.name}" data-a="restart">${icon('refresh')}</button>
          ${r.state === 'started' ? html`<button class="btn xs danger" data-r="${r.name}" data-a="stop">Stop</button>` : html`<button class="btn xs success" data-r="${r.name}" data-a="start">Start</button>`}`}</td></tr>`)}</tbody></table>`
        : empty('No resource list yet', 'Reported by the server on connect.', 'box'));
    };
    draw();
    $('#rq', el).addEventListener('input', (e) => draw(e.target.value.trim()));
    $('#res', el).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      if (b.dataset.a === 'stop' && !(await confirmDialog(`Stop ${b.dataset.r}?`, 'Players may be affected immediately.', 'Stop'))) return;
      const r = await busy(b, () => api.post(`/servers/${s.id}/resources`, { resource: b.dataset.r, action: b.dataset.a }));
      if (r.status === 'done') { toast({ type: 'success', text: `${b.dataset.r}: ${r.result.state}` }); const x = res.find((y) => y.name === b.dataset.r); if (x) x.state = r.result.state; draw($('#rq', el).value.trim()); }
      else toast({ type: 'error', text: (r.result && r.result.error) || 'Server did not respond' });
    });
  }
}
