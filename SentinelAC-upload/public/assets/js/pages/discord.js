import { api } from '../api.js';
import { html, icon, fmt, toast, busy } from '../ui.js';

export default async function discord(el) {
  async function load() {
    const hooks = await api.get('/discord');
    el.innerHTML = String(html`<div class="notice" style="margin-bottom:16px">${icon('lock')}<span>Webhook URLs are encrypted (AES-256-GCM) on the backend and never sent back to the browser. Each event category can post to a different channel. IP addresses and hardware tokens are never included in embeds.</span></div>
      <div class="col">${hooks.map((h) => html`<div class="card" data-cat="${h.category}"><div class="card-b row wrap" style="gap:14px">
        <div style="width:220px"><b>${h.label}</b><div class="muted tiny mono">${h.category}</div></div>
        <input class="input grow" style="min-width:280px" name="url" placeholder="${h.configured ? 'Configured: ' + h.hint + ' — paste a new URL to replace' : 'https://discord.com/api/webhooks/…'}"/>
        <label class="row small"><label class="switch"><input type="checkbox" name="en" ${h.enabled || !h.configured ? 'checked' : ''}/><span></span></label>Enabled</label>
        <button class="btn sm primary" data-act="save">Save</button>
        ${h.configured ? html`<button class="btn sm" data-act="test">${icon('zap')}Test</button><button class="btn sm danger" data-act="remove">${icon('x')}</button>` : ''}
        ${h.configured ? html`<span class="badge green">${icon('check')}configured ${fmt.ago(h.updatedAt)}</span>` : html`<span class="badge">not configured</span>`}
      </div></div>`)}</div>`);
  }
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const card = b.closest('[data-cat]'); const cat = card.dataset.cat;
    const url = card.querySelector('[name=url]').value.trim(); const enabled = card.querySelector('[name=en]').checked;
    if (b.dataset.act === 'save') { await busy(b, () => api.put('/discord/' + cat, url ? { url, enabled } : { enabled })); toast({ type: 'success', text: 'Saved' }); }
    if (b.dataset.act === 'remove') { await busy(b, () => api.put('/discord/' + cat, { url: null })); toast({ type: 'success', text: 'Removed' }); }
    if (b.dataset.act === 'test') { await busy(b, () => api.post(`/discord/${cat}/test`)); toast({ type: 'success', text: 'Test message queued — check the channel' }); }
    load();
  });
  await load();
}
