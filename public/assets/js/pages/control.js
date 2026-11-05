// Protection Control: every detection on one screen — on/off, punishment, ban length, punishment plan
// (1st offense → 2nd → 3rd…), screenshot evidence — plus the fair-ban rules. Every change applies live.
import { api } from '../api.js';
import { html, icon, fmt, $, modal, toast, verifiedBadge } from '../ui.js';

const ACTIONS = [['log', 'Log only'], ['warn', 'Warn staff'], ['kick', 'Kick'], ['review', 'Kick + review'], ['ban', 'Ban']];
const ACTION_LABEL = Object.fromEntries(ACTIONS);
const DURATIONS = [[1, '1 hour'], [6, '6 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days'], [0, 'Permanent']];
const durLabel = (h) => (DURATIONS.find((d) => d[0] === h) || [h, `${h} h`])[1];
const PLANS = {
  fair: { label: 'Fair', desc: 'Kick → kick → staff review', steps: [{ action: 'kick' }, { action: 'kick' }, { action: 'review' }] },
  gentle: { label: 'Gentle', desc: 'Warn → kick → staff review', steps: [{ action: 'warn' }, { action: 'kick' }, { action: 'review' }] },
  strict: { label: 'Strict', desc: 'Kick → ban 3 days → permanent ban', steps: [{ action: 'kick' }, { action: 'ban', hours: 72 }, { action: 'ban', hours: 0 }] },
};
const stepText = (st) => (st.action === 'ban' ? `Ban ${durLabel(st.hours ?? 0).toLowerCase()}` : ACTION_LABEL[st.action]);

export default async function control(el, ctx) {
  const canEdit = ctx.store.can('detections.configure');
  const canSettings = ctx.store.can('settings.manage');
  const dis = canEdit ? '' : 'disabled';
  let data, settings, meta, q = '';

  async function load() {
    [data, settings, meta] = await Promise.all([api.get('/detections/config'), api.get('/settings'), api.get('/meta')]);
    render();
  }
  const det = (k) => data.detections.find((d) => d.key === k);

  function planCell(d) {
    const lad = d.config.ladder;
    if (lad && lad.enabled && lad.steps.length) {
      return html`<button class="btn xs" data-plan="${d.key}" ${dis} title="Within ${lad.windowHours} h">${lad.steps.map((st, i) => html`${i ? html`<span class="faint">→</span>` : ''}<span>${stepText(st)}</span>`)}</button>`;
    }
    return html`<button class="btn xs ghost" data-plan="${d.key}" ${dis}>${icon('plus')}Plan</button>`;
  }

  function row(d) {
    const c = d.config;
    const durs = DURATIONS.some((x) => x[0] === c.banDuration) ? DURATIONS : [...DURATIONS, [c.banDuration, `${c.banDuration} h`]];
    const ladderOn = c.ladder && c.ladder.enabled && c.ladder.steps.length;
    return html`<tr data-key="${d.key}" class="${c.enabled ? '' : 'off-row'}">
      <td style="width:46px"><label class="switch"><input type="checkbox" data-f="enabled" ${c.enabled ? 'checked' : ''} ${dis}/><span></span></label></td>
      <td><b>${d.name}</b> ${verifiedBadge(d.verified)}<div class="muted tiny" style="max-width:420px">${d.description}</div></td>
      <td><select class="input sm" data-f="action" ${dis} title="${ladderOn ? 'A punishment plan is active — it decides the punishment per offense' : 'Punishment for every offense'}">${ACTIONS.map(([v, l]) => html`<option value="${v}" ${c.action === v ? 'selected' : ''}>${l}</option>`)}</select>
        ${c.action === 'ban' && !d.verified ? html`<div class="tiny" style="color:var(--orange)">client signal: never bans alone</div>` : ''}</td>
      <td><select class="input sm ${c.action === 'ban' ? '' : 'dim'}" data-f="banDuration" ${dis}>${durs.map(([v, l]) => html`<option value="${v}" ${c.banDuration === v ? 'selected' : ''}>${l}</option>`)}</select></td>
      <td>${planCell(d)}</td>
      <td style="width:60px"><label class="switch" title="Screenshot before warn / kick / ban"><input type="checkbox" data-f="screenshot" ${c.evidence && c.evidence.screenshot ? 'checked' : ''} ${dis}/><span></span></label></td>
      <td class="muted tiny nowrap">${d.totalTriggers ? html`${fmt.num(d.totalTriggers)}× · ${fmt.ago(d.lastTriggered)}` : 'never'}</td>
    </tr>`;
  }

  function render() {
    const r = settings.risk; const en = settings.enforcement;
    const mode = r.autoBanOnCritical === false ? 'off' : (r.escalationMode || 'review');
    const groups = {};
    for (const d of data.detections) {
      if (q && !`${d.name} ${d.key} ${d.description}`.toLowerCase().includes(q)) continue;
      (groups[d.category] = groups[d.category] || []).push(d);
    }
    const on = data.detections.filter((d) => d.config.enabled).length;
    const instant = data.detections.filter((d) => d.config.enabled && d.config.action === 'ban' && !(d.config.ladder && d.config.ladder.enabled)).map((d) => d.name);
    el.innerHTML = String(html`
      <div class="grid g2" style="margin-bottom:16px">
        <div class="card"><div class="card-h"><div><h3>${icon('gavel')} Fair bans</h3><div class="muted small">Nobody is banned without a concrete, measured reason</div></div></div>
          <div class="card-b col" style="gap:12px">
            <label class="field">When a player reaches critical risk
              <select class="input" id="esc" ${canSettings ? '' : 'disabled'}>
                <option value="review" ${mode === 'review' ? 'selected' : ''}>Remove the player + staff decide (recommended)</option>
                <option value="ban" ${mode === 'ban' ? 'selected' : ''}>Ban automatically</option>
                <option value="off" ${mode === 'off' ? 'selected' : ''}>Do nothing extra</option></select>
              <span class="help">Lag-prone detections (teleport, heartbeat, explosion distance) never count as ban proof.</span></label>
            <div class="grid g2" style="gap:12px">
              <label class="field">Client signal set to BAN becomes
                <select class="input" id="fallback" ${canSettings ? '' : 'disabled'}>${['log', 'warn', 'kick'].map((a) => html`<option value="${a}" ${en.unverifiedBanFallback === a ? 'selected' : ''}>${ACTION_LABEL[a]}</option>`)}</select></label>
              <label class="field">Evidence language
                <select class="input" id="lang" ${canSettings ? '' : 'disabled'}><option value="en" ${en.language !== 'ar' ? 'selected' : ''}>English</option><option value="ar" ${en.language === 'ar' ? 'selected' : ''}>العربية</option></select></label>
            </div>
            <div class="notice">${icon('shieldCheck')}<span>Every warn, kick and ban now carries the measured proof, e.g. <i>“Ran at 38.2 m/s — limit 14 m/s, 3 samples in a row”</i>. Players see it, staff see it, Discord gets it.</span></div>
          </div></div>
        <div class="card"><div class="card-h"><div><h3>${icon('zap')} Punishment plans</h3><div class="muted small">Different punishment for the 1st, 2nd, 3rd offense (within 72 h)</div></div></div>
          <div class="card-b col" style="gap:10px">
            ${Object.entries(PLANS).map(([k, p]) => html`<div class="row sp"><div><b>${p.label}</b> <span class="muted small">${p.desc}</span></div>
              <button class="btn sm" data-bulkplan="${k}" ${dis}>Apply to all kick detections</button></div>`)}
            <div class="row sp"><div><b>No plans</b> <span class="muted small">every offense gets the same punishment</span></div><button class="btn sm" data-bulkplan="none" ${dis}>Remove all plans</button></div>
            <div class="muted tiny">Instant bans (no plan): ${instant.length ? instant.join(', ') : 'none'} — only for cheats that are impossible without a hack.</div>
          </div></div>
      </div>
      <div class="card">
        <div class="card-h"><div class="row wrap" style="gap:10px"><div class="search" style="width:260px">${icon('search')}<input class="input" id="q" placeholder="Search detections…" value="${q}"/></div>
          <span class="muted small">${on}/${data.detections.length} enabled · changes apply to every server within seconds</span></div>
          <a class="btn sm" href="#/detections?tab=config">${icon('settings')}Fine-tune limits</a></div>
        <div class="card-b flush table-wrap"><table class="t control"><thead><tr><th>On</th><th>Detection</th><th>Punishment</th><th>Ban length</th><th>Plan (1st → 2nd → 3rd)</th><th>Screenshot</th><th>Triggered</th></tr></thead>
          ${Object.entries(groups).map(([cat, list]) => html`<tbody><tr class="group-row"><td colspan="7">${meta.categories[cat] || cat} <span class="muted">· ${list.length}</span></td></tr>${list.map(row)}</tbody>`)}
        </table></div></div>`);
    $('#q', el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; render(); const i = $('#q', el); i.focus(); i.setSelectionRange(pos, pos); });
  }

  async function save(key, patch) {
    const r = await api.put('/detections/config/' + key, patch);
    det(key).config = r.config;
    det(key).customized = true;
    toast({ type: 'success', text: `${det(key).name}: saved` });
    const tr = el.querySelector(`tr[data-key="${key}"]`);
    if (tr) tr.outerHTML = String(row(det(key)));
  }

  function editPlan(key) {
    const d = det(key);
    const lad = d.config.ladder && d.config.ladder.steps.length ? d.config.ladder : { enabled: true, windowHours: 72, steps: PLANS.fair.steps };
    const stepRow = (st, i) => html`<div class="row" style="gap:8px;margin-bottom:8px" data-step>
      <b style="width:92px" class="small">${i + 1}${['st', 'nd', 'rd'][i] || 'th'} offense</b>
      <select class="input sm" name="a" style="width:160px">${ACTIONS.map(([v, l]) => html`<option value="${v}" ${st.action === v ? 'selected' : ''}>${l}</option>`)}</select>
      <select class="input sm" name="h" style="width:130px;visibility:${st.action === 'ban' ? 'visible' : 'hidden'}">${DURATIONS.map(([v, l]) => html`<option value="${v}" ${(st.hours ?? 0) === v ? 'selected' : ''}>${l}</option>`)}</select>
      <button type="button" class="btn xs ghost" data-rm>${icon('x')}</button></div>`;
    const m = modal({
      title: `Punishment plan — ${d.name}`, submitLabel: 'Save plan', wide: true,
      body: String(html`<p class="muted small" style="margin-bottom:12px">Counts this player's offenses for this detection inside the time window. The last step repeats. Ban length only applies to “Ban” steps.</p>
        <div id="steps">${lad.steps.map(stepRow)}</div>
        <div class="row" style="gap:8px;margin:6px 0 14px"><button type="button" class="btn sm" id="add-step">${icon('plus')}Add step</button></div>
        <div class="grid g2" style="gap:12px"><label class="field">Count offenses within
          <select class="input" name="win">${[[24, '24 hours'], [72, '3 days'], [168, '7 days'], [720, '30 days']].map(([v, l]) => html`<option value="${v}" ${lad.windowHours === v ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="field">Plan<select class="input" name="en"><option value="1" selected>Active</option><option value="0">Off (use the single punishment)</option></select></label></div>
        ${d.verified ? '' : html`<div class="notice warn" style="margin-top:12px">${icon('info')}<span>Client signal: a “Ban” step is turned into the fallback action — client signals never ban on their own.</span></div>`}`),
      onSubmit: async (f) => {
        const steps = [...m.el.querySelectorAll('[data-step]')].map((r) => {
          const a = r.querySelector('[name=a]').value;
          return a === 'ban' ? { action: 'ban', hours: +r.querySelector('[name=h]').value } : { action: a };
        });
        if (!steps.length && f.en.value === '1') { toast({ type: 'error', text: 'Add at least one step' }); return false; }
        await save(key, { ladder: { enabled: f.en.value === '1', windowHours: +f.win.value, steps } });
      },
    });
    const box = $('#steps', m.el);
    const renum = () => box.querySelectorAll('[data-step] b').forEach((b, i) => { b.textContent = `${i + 1}${['st', 'nd', 'rd'][i] || 'th'} offense`; });
    $('#add-step', m.el).addEventListener('click', () => {
      if (box.children.length >= 6) return;
      box.insertAdjacentHTML('beforeend', String(stepRow({ action: 'ban', hours: 72 }, box.children.length)));
    });
    box.addEventListener('click', (e) => { const x = e.target.closest('[data-rm]'); if (x) { x.closest('[data-step]').remove(); renum(); } });
    box.addEventListener('change', (e) => {
      if (e.target.name !== 'a') return;
      e.target.closest('[data-step]').querySelector('[name=h]').style.visibility = e.target.value === 'ban' ? 'visible' : 'hidden';
    });
  }

  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'esc') { settings.risk = await api.put('/settings/risk', { escalationMode: t.value, autoBanOnCritical: t.value !== 'off' }); toast({ type: 'success', text: 'Saved' }); return render(); }
    if (t.id === 'fallback') { settings.enforcement = await api.put('/settings/enforcement', { unverifiedBanFallback: t.value }); toast({ type: 'success', text: 'Saved' }); return; }
    if (t.id === 'lang') { settings.enforcement = await api.put('/settings/enforcement', { language: t.value }); toast({ type: 'success', text: 'Saved' }); return; }
    const tr = t.closest('tr[data-key]'); if (!tr || !t.dataset.f) return;
    const key = tr.dataset.key; const f = t.dataset.f;
    if (f === 'enabled') return save(key, { enabled: t.checked });
    if (f === 'action') return save(key, { action: t.value });
    if (f === 'banDuration') return save(key, { banDuration: +t.value });
    if (f === 'screenshot') return save(key, { evidence: { screenshot: t.checked } });
  });
  el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-plan]'); if (p && canEdit) return editPlan(p.dataset.plan);
    const b = e.target.closest('[data-bulkplan]');
    if (b && canEdit) {
      const plan = b.dataset.bulkplan;
      const keys = plan === 'none'
        ? data.detections.filter((d) => d.config.ladder && d.config.ladder.enabled).map((d) => d.key)
        : data.detections.filter((d) => d.verified && d.config.action === 'kick').map((d) => d.key);
      if (!keys.length) return toast({ type: 'info', text: 'Nothing to change' });
      await api.post('/detections/config/ladder', { keys, ladder: plan === 'none' ? { enabled: false, windowHours: 72, steps: [] } : { enabled: true, windowHours: 72, steps: PLANS[plan].steps } });
      toast({ type: 'success', text: plan === 'none' ? `Plans removed from ${keys.length} detections` : `${PLANS[plan].label} plan applied to ${keys.length} detections` });
      await load();
    }
  });
  await load();
}
