import { api } from '../api.js';
import { html, icon, toast, busy } from '../ui.js';

export default async function settings(el, ctx) {
  const { store } = ctx;
  const can = store.can('settings.manage');
  let s = await api.get('/settings');
  const dis = can ? '' : 'disabled';

  const num = (sec, path, label, help = '', step = 1) => {
    const v = path.split('.').reduce((o, k) => o[k], s[sec]);
    return html`<label class="field">${label}<input class="input" type="number" min="0" step="${step}" data-sec="${sec}" data-path="${path}" value="${v}" ${dis}/>${help ? html`<span class="help">${help}</span>` : ''}</label>`;
  };
  const text = (sec, path, label, help = '', area = false) => {
    const v = path.split('.').reduce((o, k) => o[k], s[sec]);
    return html`<label class="field" style="${area ? 'grid-column:1/-1' : ''}">${label}${area ? html`<textarea class="input" data-sec="${sec}" data-path="${path}" data-type="str" ${dis}>${v}</textarea>` : html`<input class="input" data-sec="${sec}" data-path="${path}" data-type="str" value="${v}" ${dis}/>`}${help ? html`<span class="help">${help}</span>` : ''}</label>`;
  };
  const bool = (sec, path, label, help = '') => {
    const v = path.split('.').reduce((o, k) => o[k], s[sec]);
    return html`<label class="row sp" style="grid-column:1/-1;padding:4px 0"><span><b class="small">${label}</b>${help ? html`<div class="help">${help}</div>` : ''}</span><label class="switch"><input type="checkbox" data-sec="${sec}" data-path="${path}" data-type="bool" ${v ? 'checked' : ''} ${dis}/><span></span></label></label>`;
  };
  const select = (sec, path, label, opts, help = '') => {
    const v = path.split('.').reduce((o, k) => o[k], s[sec]);
    return html`<label class="field">${label}<select class="input" data-sec="${sec}" data-path="${path}" data-type="str" ${dis}>${opts.map(([k, l]) => html`<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`)}</select>${help ? html`<span class="help">${help}</span>` : ''}</label>`;
  };
  const section = (sec, title, desc, inner) => html`<div class="card" data-section="${sec}"><div class="card-h"><div><h3>${title}</h3><div class="muted small">${desc}</div></div>${can ? html`<button class="btn sm primary" data-save="${sec}">${icon('check')}Save</button>` : ''}</div><div class="card-b form-grid">${inner}</div></div>`;

  async function render() {
    const lic = can ? await api.get('/license').catch(() => null) : null;
    el.innerHTML = String(html`<div class="col" style="gap:16px;max-width:1100px">
      ${can ? '' : html`<div class="notice">${icon('lock')}<span>Read-only — the settings.manage permission is required to change settings.</span></div>`}
      ${section('risk', 'Risk scoring & escalation', 'How detections add up to a 0–100 risk score, and when critical risk escalates to an automatic ban.', html`
        ${num('risk', 'weights.low', 'Weight · low')}${num('risk', 'weights.medium', 'Weight · medium')}${num('risk', 'weights.high', 'Weight · high')}${num('risk', 'weights.critical', 'Weight · critical')}
        ${num('risk', 'unverifiedMultiplier', 'Client-signal multiplier', 'Client signals count this fraction (0–1)', 0.05)}${num('risk', 'halfLifeHours', 'Risk half-life (hours)', 'Risk halves every N hours without detections')}
        ${num('risk', 'thresholds.medium', 'Medium risk threshold')}${num('risk', 'thresholds.high', 'High risk threshold')}${num('risk', 'thresholds.critical', 'Critical risk threshold')}
        ${num('risk', 'criticalRequiresVerifiedWithinHours', 'Verified evidence window (h)', 'Escalation needs a verified high/critical detection within this window')}
        ${num('risk', 'escalationBanDuration', 'Escalation ban duration (h)', '0 = permanent')}
        ${bool('risk', 'autoBanOnCritical', 'Automatic ban on critical risk', 'Only with verified evidence; players with reputation bypass are excluded')}`)}
      ${section('enforcement', 'Enforcement & messages', 'Safety rules and what players see.', html`
        ${select('enforcement', 'unverifiedBanFallback', 'BAN from a client signal becomes', [['kick', 'Kick'], ['warn', 'Warn'], ['log', 'Log only']], 'Client signals never ban on their own')}
        ${select('enforcement', 'tokenOnlyMatch', 'Hardware-token-only ban match', [['review', 'Allow + alert staff (recommended)'], ['block', 'Block the connection']], 'When only hardware tokens match a banned account')}
        ${text('enforcement', 'kickMessage', 'Kick message', '{reason}')}
        ${text('enforcement', 'banMessage', 'Ban message', 'Placeholders: {banId} {reason} {expires} {appealUrl}', true)}`)}
      ${section('general', 'General', 'Appeals and display.', html`${text('general', 'appealUrl', 'Appeal URL', 'Shown in ban messages. Default: this panel\'s public appeal page')}${text('general', 'serverDisplayName', 'Display name')}`)}
      ${section('telemetry', 'Telemetry & replay', 'Server-side sampling of every player. Lower intervals = finer replay, slightly more load.', html`
        ${num('telemetry', 'intervalMs', 'Sampling interval (ms)', 'Min 1000. Movement detections use these samples')}${num('telemetry', 'heartbeatMs', 'Heartbeat / command poll (ms)', 'Min 1000. Dashboard command latency')}
        ${bool('telemetry', 'storeReplay', 'Store telemetry for session replay', 'Retention is set by TELEMETRY_RETENTION_DAYS on the backend')}`)}
      ${section('monitoring', 'Monitoring', 'Live screenshot monitoring limits.', html`${num('monitoring', 'defaultIntervalMs', 'Default interval (ms)')}${num('monitoring', 'minIntervalMs', 'Minimum interval (ms)')}${num('monitoring', 'maxFramesPerSession', 'Max frames per session')}`)}
      ${section('map', 'Map', 'The GTA V map image is not bundled (Rockstar asset). Put your image in backend/public/assets/map/ and calibrate the world bounds it covers.', html`
        ${text('map', 'image', 'Image path', 'e.g. /assets/map/gtav.jpg')}<div></div>
        ${num('map', 'minX', 'World X at left edge', '', 0.1)}${num('map', 'maxX', 'World X at right edge', '', 0.1)}${num('map', 'minY', 'World Y at bottom edge', '', 0.1)}${num('map', 'maxY', 'World Y at top edge', '', 0.1)}`)}
      ${lic ? html`<div class="card"><div class="card-h"><h3>License</h3></div><div class="card-b">${lic.active ? html`<div class="kv"><div><span>Key</span><b class="mono">${lic.active.prefix}…</b></div><div><span>Plan</span><b>${lic.active.plan}</b></div>
        <div><span>Servers</span><b>${lic.serversUsed}/${lic.active.maxServers}</b></div><div><span>Expires</span><b>${lic.active.expiresAt ? new Date(lic.active.expiresAt).toLocaleDateString() : 'Never'}</b></div></div>` : html`<div class="notice danger">${icon('alert')}<span>No active license — servers are rejected by the backend.</span></div>`}</div></div>` : ''}
      <div class="card"><div class="card-h"><h3>Your account</h3></div><div class="card-b"><form id="pw" class="form-grid">
        <label class="field">Current password<input class="input" type="password" name="cur" autocomplete="current-password" required/></label><div></div>
        <label class="field">New password<input class="input" type="password" name="next" autocomplete="new-password" required minlength="10"/><span class="help">At least 10 characters with letters and numbers. Other sessions are signed out.</span></label>
        <div class="row" style="align-items:flex-end"><button class="btn">${icon('lock')}Change password</button></div></form></div></div>
    </div>`);
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-save]'); if (!b) return;
    const sec = b.dataset.save;
    const out = {};
    el.querySelectorAll(`[data-sec="${sec}"]`).forEach((i) => {
      const v = i.dataset.type === 'bool' ? i.checked : i.dataset.type === 'str' ? i.value : Number(i.value);
      const keys = i.dataset.path.split('.');
      let o = out; keys.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; });
      o[keys[keys.length - 1]] = v;
    });
    s[sec] = await busy(b, () => api.put('/settings/' + sec, out));
    store.settings = await api.get('/settings');
    toast({ type: 'success', text: 'Saved — pushed to servers on their next heartbeat' });
  });
  el.addEventListener('submit', async (e) => {
    if (e.target.id !== 'pw') return;
    e.preventDefault();
    await busy(e.target.querySelector('button'), () => api.post('/auth/password', { current: e.target.cur.value, next: e.target.next.value }));
    e.target.reset(); toast({ type: 'success', text: 'Password changed' });
  });
  await render();
}
