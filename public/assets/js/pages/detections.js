import { api, qs } from '../api.js';
import { html, icon, $, fmt, empty, actionBadge, sevBadge, verifiedBadge, modal, toast, busy, confirmDialog, lightbox, debounce } from '../ui.js';

export default async function detections(el, ctx) {
  let tab = ctx.query.tab === 'config' ? 'config' : 'history';
  el.innerHTML = String(html`<div class="tabs"><button data-tab="history">${icon('activity')}History</button><button data-tab="config">${icon('settings')}Configuration</button></div><div id="body"></div>`);
  const body = $('#body', el);
  const meta = await api.get('/meta');
  let cleanupTab = null;

  async function show() {
    if (cleanupTab) cleanupTab();
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    cleanupTab = tab === 'history' ? await history(body, ctx, meta) : await config(body, ctx, meta);
  }
  el.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; show(); } });
  await show();
  return () => cleanupTab && cleanupTab();
}

// ─── History ───
async function history(body, ctx, meta) {
  const f = { category: '', action: '', verified: '', q: '', serverId: '' };
  let offset = 0;
  body.innerHTML = String(html`<div class="row wrap" style="margin-bottom:14px">
      <div class="search" style="width:240px">${icon('search')}<input class="input" id="q" placeholder="Player name…"/></div>
      <select class="input" id="category" style="width:180px"><option value="">All categories</option>${Object.entries(meta.categories).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
      <select class="input" id="action" style="width:140px"><option value="">All actions</option>${['ban', 'kick', 'warn', 'log', 'suppressed'].map((a) => html`<option value="${a}">${a}</option>`)}</select>
      <select class="input" id="verified" style="width:170px"><option value="">All signals</option><option value="true">Server-verified</option><option value="false">Client signals</option></select>
      <select class="input" id="serverId" style="width:170px"><option value="">All servers</option>${ctx.store.servers.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
    </div><div class="card"><div class="table-wrap" id="table"></div><div class="pager"><button class="btn sm" id="prev">Previous</button><button class="btn sm" id="next">Next</button></div></div>`);

  let rows = [];
  async function load() {
    rows = await api.get('/detections' + qs({ ...f, limit: 50, offset }));
    render();
  }
  function render() {
    $('#table', body).innerHTML = String(rows.length ? html`<table class="t"><thead><tr><th>Time</th><th>Player</th><th>Detection</th><th>Severity</th><th>Signal</th><th>Action</th><th>Risk</th><th>Server</th><th></th></tr></thead><tbody>
      ${rows.map((d, i) => html`<tr class="click" data-i="${i}"><td class="muted nowrap">${fmt.date(d.created_at)}</td><td><b>${d.player_name || '—'}</b></td>
        <td><b>${d.name}</b><div class="muted tiny">${meta.categories[d.category] || d.category}</div></td><td>${sevBadge(d.severity)}</td><td>${verifiedBadge(d.verified)}</td>
        <td>${actionBadge(d.action_taken)}${d.action_note ? html`<div class="muted tiny" style="max-width:200px">${d.action_note}</div>` : ''}</td><td class="num">${Math.round(d.risk_after)}</td>
        <td class="muted">${d.server_name}</td><td class="nowrap">${d.evidence_count ? html`<span class="badge violet">${icon('camera')}${d.evidence_count}</span>` : ''} ${d.ban_id ? html`<span class="badge red">${d.ban_id}</span>` : ''}</td></tr>`)}</tbody></table>`
      : empty('No detections', 'Nothing matches these filters.', 'shieldCheck'));
    $('#prev', body).disabled = offset === 0; $('#next', body).disabled = rows.length < 50;
  }

  body.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const d = rows[+tr.dataset.i];
    const ev = d.evidence_count && ctx.store.can('evidence.view') ? await api.get('/evidence' + qs({ playerId: d.player_id, limit: 200 })) : [];
    const shots = ev.filter((x) => x.detection_id === d.id);
    modal({ title: `${d.name} · #${d.id}`, wide: true, hideSubmit: true, cancelLabel: 'Close', body: html`
      <div class="row wrap">${sevBadge(d.severity)}${verifiedBadge(d.verified)}${actionBadge(d.action_taken)}<span class="muted small">configured: ${d.configured_action}</span></div>
      ${d.action_note ? html`<div class="notice ${d.action_note.includes('downgraded') ? 'warn' : ''}">${icon('info')}<span>${d.action_note}</span></div>` : ''}
      <div class="kv"><div><span>Player</span><b>${d.player_name}</b></div><div><span>Time</span><b>${fmt.date(d.created_at)}</b></div><div><span>Risk after</span><b>${Math.round(d.risk_after)}/100</b></div>
        <div><span>Risk added</span><b>+${Math.round(d.score_delta)}</b></div><div><span>Server</span><b>${d.server_name}</b></div><div><span>Source</span><b>${d.source}</b></div></div>
      <div><div class="muted small" style="margin-bottom:6px">Observed details</div><div class="code">${JSON.stringify(d.details, null, 2)}</div></div>
      ${shots.length ? html`<div class="ev-grid">${shots.map((s) => html`<img class="img-thumb" src="/api/v1/evidence/${s.id}/file" data-img="1" alt=""/>`)}</div>` : ''}
      <div class="row"><a class="btn sm" href="#/players/${d.player_id}">${icon('users')}Player profile</a>
        ${ctx.store.can('replay.view') && d.session_id ? html`<a class="btn sm" href="#/replay?session=${d.session_id}">${icon('play')}Replay session</a>` : ''}
        ${d.ban_id ? html`<a class="btn sm danger" href="#/bans/${d.ban_id}">${icon('ban')}${d.ban_id}</a>` : ''}</div>` });
    document.querySelectorAll('.modal img[data-img]').forEach((img) => img.addEventListener('click', () => lightbox(img.src)));
    document.querySelectorAll('.modal a').forEach((a) => a.addEventListener('click', () => document.querySelector('.modal-back')?.remove()));
  });
  for (const k of ['category', 'action', 'verified', 'serverId']) $('#' + k, body).addEventListener('change', (e) => { f[k] = e.target.value; offset = 0; load(); });
  $('#q', body).addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); offset = 0; load(); }, 250));
  $('#prev', body).onclick = () => { offset = Math.max(0, offset - 50); load(); };
  $('#next', body).onclick = () => { offset += 50; load(); };
  await load();
  const onDet = debounce(() => { if (offset === 0) load(); }, 500);
  ctx.on('detection', onDet);
  return () => ctx.store.socket.off('detection', onDet);
}

// ─── Configuration ───
async function config(body, ctx, meta) {
  const canEdit = ctx.store.can('detections.configure');
  let data = await api.get('/detections/config');
  let q = '';
  const dirty = new Set();

  function field(d, label, input, help = '') { return html`<label class="field">${label}${input}${help ? html`<span class="help">${help}</span>` : ''}</label>`; }

  function thresholdInputs(d) {
    const th = d.config.threshold || {};
    return Object.entries(d.defaults.threshold || {}).map(([k, def]) => {
      const v = th[k];
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      if (typeof def === 'number') return field(d, label, html`<input class="input sm" type="number" step="any" min="0" data-th="${k}" value="${v}" ${canEdit ? '' : 'disabled'}/>`, `default ${def}`);
      if (typeof def === 'boolean') return field(d, label, html`<select class="input sm" data-th="${k}" data-type="bool" ${canEdit ? '' : 'disabled'}><option value="true" ${v ? 'selected' : ''}>Yes</option><option value="false" ${!v ? 'selected' : ''}>No</option></select>`);
      return html`<label class="field" style="grid-column:1/-1">${label}<textarea class="input mono" style="min-height:70px;font-size:11.5px" data-th="${k}" data-type="json" ${canEdit ? '' : 'disabled'}>${JSON.stringify(v, null, Array.isArray(v) && v.every((x) => typeof x !== 'object') ? 0 : 1)}</textarea><span class="help">JSON</span></label>`;
    });
  }

  function card(d) {
    const c = d.config;
    const wl = c.whitelist || {};
    return html`<div class="det-card ${c.enabled ? '' : 'off'}" data-key="${d.key}">
      <div class="top">
        <label class="switch" style="margin-top:2px"><input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''} ${canEdit ? '' : 'disabled'}/><span></span></label>
        <div class="grow"><div class="row wrap" style="gap:8px"><b>${d.name}</b>${verifiedBadge(d.verified)}${sevBadge(c.severity)}${actionBadge(c.action)}${d.customized ? html`<span class="badge">customized</span>` : ''}<span class="badge hidden dirty orange">unsaved</span></div>
          <div class="muted small" style="margin-top:4px">${d.description}</div>
          <div class="faint tiny" style="margin-top:4px">${d.totalTriggers} trigger(s) · last ${d.lastTriggered ? fmt.ago(d.lastTriggered) : 'never'} · <span class="mono">${d.key}</span></div></div>
        <button class="btn sm" data-toggle>${icon('settings')}Configure</button>
      </div>
      <div class="body hidden">
        ${field(d, 'Action', html`<select class="input sm" data-f="action" ${canEdit ? '' : 'disabled'}>${['log', 'warn', 'kick', 'ban'].map((a) => html`<option value="${a}" ${c.action === a ? 'selected' : ''}>${a.toUpperCase()}</option>`)}</select>`,
          d.verified ? '' : 'Client signal: BAN is downgraded to the fallback action')}
        ${field(d, 'Severity', html`<select class="input sm" data-f="severity" ${canEdit ? '' : 'disabled'}>${['low', 'medium', 'high', 'critical'].map((a) => html`<option value="${a}" ${c.severity === a ? 'selected' : ''}>${a}</option>`)}</select>`, 'Weight in the risk score')}
        ${field(d, 'Cooldown (s)', html`<input class="input sm" type="number" min="0" data-f="cooldown" value="${c.cooldown}" ${canEdit ? '' : 'disabled'}/>`, 'Repeat detections within this window are not re-enforced')}
        ${field(d, 'Ban duration (h)', html`<input class="input sm" type="number" min="0" data-f="banDuration" value="${c.banDuration}" ${canEdit ? '' : 'disabled'}/>`, '0 = permanent')}
        ${field(d, 'Screenshot evidence', html`<select class="input sm" data-f="screenshot" ${canEdit ? '' : 'disabled'}><option value="true" ${c.evidence.screenshot ? 'selected' : ''}>Capture before action</option><option value="false" ${!c.evidence.screenshot ? 'selected' : ''}>Off</option></select>`)}
        ${thresholdInputs(d)}
        ${Object.keys(d.defaults.whitelist).map((k) => html`<label class="field" style="grid-column:span 2">Whitelist · ${k}<textarea class="input mono" style="min-height:60px;font-size:11.5px" data-wl="${k}" placeholder="${k === 'identifiers' ? 'license:abc… (one per line)' : k === 'aces' ? 'my.ace.name' : 'resource-name'}" ${canEdit ? '' : 'disabled'}>${(wl[k] || []).join('\n')}</textarea></label>`)}
        ${canEdit ? html`<div class="row" style="grid-column:1/-1;justify-content:flex-end"><button class="btn sm primary" data-save>${icon('check')}Save</button></div>` : ''}
      </div></div>`;
  }

  function render() {
    const groups = {};
    for (const d of data.detections) {
      if (q && !(`${d.name} ${d.key} ${d.description}`.toLowerCase().includes(q))) continue;
      (groups[d.category] = groups[d.category] || []).push(d);
    }
    const on = data.detections.filter((d) => d.config.enabled).length;
    body.innerHTML = String(html`<div class="row sp wrap" style="margin-bottom:14px;gap:10px">
        <div class="row"><div class="search" style="width:260px">${icon('search')}<input class="input" id="q" placeholder="Search detections…" value="${q}"/></div><span class="muted small">${on}/${data.detections.length} enabled</span></div>
        <div class="row">${canEdit ? html`<button class="btn sm" data-bulk="enable_all">Enable all</button><button class="btn sm" data-bulk="disable_all">Disable all</button><button class="btn sm" data-bulk="reset_defaults">${icon('refresh')}Reset defaults</button>` : ''}
          <a class="btn sm nui-hide" href="/api/v1/detections/config/export" download>${icon('download')}Export</a>${canEdit ? html`<label class="btn sm">${icon('upload')}Import<input type="file" accept="application/json" id="imp" hidden/></label>` : ''}</div></div>
      <div class="notice" style="margin-bottom:16px">${icon('shieldCheck')}<span>Changes are pushed to every server within one heartbeat — no restart needed. <b>Server-verified</b> detections are observed by the server itself; <b>client signals</b> can never ban on their own.</span></div>
      ${Object.entries(groups).map(([cat, list]) => html`<h3 style="font-size:13px;margin:18px 0 10px;color:var(--text2)">${meta.categories[cat] || cat} <span class="muted">· ${list.length}</span></h3><div class="col">${list.map(card)}</div>`)}`);
    $('#q', body).addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); render(); $('#q', body).focus(); }, 250));
    const imp = $('#imp', body);
    if (imp) imp.addEventListener('change', async () => {
      const file = imp.files[0]; if (!file) return;
      let json; try { json = JSON.parse(await file.text()); } catch { return toast({ type: 'error', text: 'Invalid JSON file' }); }
      const r = await api.post('/detections/config/import', json);
      toast({ type: 'success', title: 'Imported', text: `${r.applied.length} applied${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}` });
      data = await api.get('/detections/config'); render();
    });
  }

  function collect(cardEl) {
    const out = { threshold: {}, whitelist: {}, evidence: {} };
    cardEl.querySelectorAll('[data-f]').forEach((i) => {
      const k = i.dataset.f;
      if (k === 'enabled') out.enabled = i.checked;
      else if (k === 'screenshot') out.evidence.screenshot = i.value === 'true';
      else if (k === 'cooldown' || k === 'banDuration') out[k] = Number(i.value);
      else out[k] = i.value;
    });
    for (const i of cardEl.querySelectorAll('[data-th]')) {
      const k = i.dataset.th;
      if (i.dataset.type === 'bool') out.threshold[k] = i.value === 'true';
      else if (i.dataset.type === 'json') { try { out.threshold[k] = JSON.parse(i.value); } catch { throw new Error(`"${k}" is not valid JSON`); } }
      else out.threshold[k] = Number(i.value);
    }
    cardEl.querySelectorAll('[data-wl]').forEach((i) => { out.whitelist[i.dataset.wl] = i.value.split('\n').map((s) => s.trim()).filter(Boolean); });
    return out;
  }

  async function save(cardEl, btn) {
    const key = cardEl.dataset.key;
    let payload;
    try { payload = collect(cardEl); } catch (e) { return toast({ type: 'error', text: e.message }); }
    await busy(btn || document.createElement('button'), () => api.put('/detections/config/' + key, payload));
    dirty.delete(key);
    toast({ type: 'success', text: 'Saved — syncing to servers' });
    data = await api.get('/detections/config');
    const d = data.detections.find((x) => x.key === key);
    const wasOpen = !cardEl.querySelector('.body').classList.contains('hidden');
    cardEl.outerHTML = String(card(d));
    if (wasOpen) body.querySelector(`[data-key="${key}"] .body`).classList.remove('hidden');
    if (payload.action === 'ban' && !d.verified) toast({ type: 'warn', text: 'Note: this is a client signal — a BAN will be downgraded unless risk escalation applies.' });
  }

  body.addEventListener('click', async (e) => {
    const cardEl = e.target.closest('.det-card');
    if (e.target.closest('[data-toggle]')) { cardEl.querySelector('.body').classList.toggle('hidden'); return; }
    const sv = e.target.closest('[data-save]'); if (sv) return save(cardEl, sv);
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const op = bulk.dataset.bulk;
      if (!(await confirmDialog({ enable_all: 'Enable all detections?', disable_all: 'Disable all detections?', reset_defaults: 'Reset all detections to defaults?' }[op],
        op === 'disable_all' ? 'Your servers will run without anti-cheat checks until re-enabled.' : 'This applies to every server immediately.', 'Confirm', op !== 'enable_all'))) return;
      await busy(bulk, () => api.post('/detections/config/bulk', { op }));
      data = await api.get('/detections/config'); render();
    }
  });
  body.addEventListener('change', (e) => {
    const cardEl = e.target.closest('.det-card'); if (!cardEl) return;
    if (e.target.dataset.f === 'enabled') return save(cardEl);   // toggles save instantly
    dirty.add(cardEl.dataset.key); cardEl.querySelector('.dirty').classList.remove('hidden');
  });
  render();
  return () => {};
}
