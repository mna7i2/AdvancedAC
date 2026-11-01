'use strict';
// Public ban appeal form (no authentication). The API responds identically for valid and invalid IDs.
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = document.getElementById('err');
  err.textContent = '';
  const btn = f.querySelector('button');
  btn.classList.add('loading');
  try {
    const res = await fetch('/api/v1/public/appeal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banId: f.banId.value.trim(), message: f.message.value.trim(), contact: f.contact.value.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = data.error || 'Could not submit the appeal. Please try again later.'; return; }
    f.classList.add('hidden');
    const done = document.getElementById('done');
    done.textContent = data.message;
    done.classList.remove('hidden');
  } finally { btn.classList.remove('loading'); }
});
