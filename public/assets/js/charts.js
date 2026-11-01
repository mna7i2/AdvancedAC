// Lightweight SVG charts with hover tooltips. Data is always real backend data; empty data renders an empty state.
import { esc } from './ui.js';

let tip;
function tooltip() {
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip hidden'; document.body.appendChild(tip); }
  return tip;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return v;
}

/**
 * Time series (line/area/step). series: [{ name, color, points: [{t: ms, v}] }]
 * opts: { height, from, to, step (ms bucket, fills gaps with 0), stepped, area, xFormat, yMax }
 */
export function timeChart(el, series, opts = {}) {
  const W = el.clientWidth || 600;
  const H = opts.height || 220;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const from = opts.from ?? Math.min(...series.flatMap((s) => s.points.map((p) => p.t)), Date.now() - 3600e3);
  const to = opts.to ?? Date.now();
  // Fill gaps with zeros for event counts so bars/lines are honest.
  const prepared = series.map((s) => {
    let pts = s.points.map((p) => ({ t: +p.t, v: +p.v })).sort((a, b) => a.t - b.t);
    if (opts.step && opts.fillZero) {
      const map = new Map(pts.map((p) => [Math.floor(p.t / opts.step) * opts.step, p.v]));
      pts = [];
      for (let t = Math.floor(from / opts.step) * opts.step; t <= to; t += opts.step) pts.push({ t, v: map.get(t) || 0 });
    }
    // Step series (e.g. online players): the last known value still holds now — extend it to the right edge.
    if (opts.extend && pts.length && pts[pts.length - 1].t < to) pts.push({ t: to, v: pts[pts.length - 1].v });
    return { ...s, pts };
  });
  const maxV = opts.yMax || niceMax(Math.max(1, ...prepared.flatMap((s) => s.pts.map((p) => p.v))));
  const x = (t) => pad.l + ((t - from) / Math.max(1, to - from)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxV) * (H - pad.t - pad.b);
  const ticks = [0, maxV / 2, maxV].map((v) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" />
    <text class="axis" x="${pad.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const xf = opts.xFormat || ((t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  const xt = [];
  const n = Math.max(2, Math.min(8, Math.floor(W / 110)));
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    xt.push(`<text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${esc(xf(t))}</text>`);
  }
  const paths = prepared.map((s, i) => {
    if (!s.pts.length) return '';
    let d = '';
    s.pts.forEach((p, j) => {
      if (j === 0) d += `M${x(p.t)},${y(p.v)}`;
      else if (opts.stepped) d += `H${x(p.t)}V${y(p.v)}`;
      else d += `L${x(p.t)},${y(p.v)}`;
    });
    const gid = `g${Math.random().toString(36).slice(2, 8)}`;
    const area = opts.area !== false ? `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d}V${y(0)}H${x(s.pts[0].t)}Z" fill="url(#${gid})" />` : '';
    return `${area}<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${i === 0 ? 1.8 : 1.5}" stroke-linejoin="round" />`;
  }).join('');
  const hasData = prepared.some((s) => s.pts.some((p) => p.v > 0));
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" height="${H}">${ticks}${xt.join('')}${paths}
    <line class="cursor" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--line3)" stroke-dasharray="3 3" visibility="hidden"/>
    ${hasData ? '' : `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="axis" style="font-size:12px">No data in this period</text>`}</svg>`;
  const svg = el.querySelector('svg');
  const cursor = svg.querySelector('.cursor');
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = from + ((px - pad.l) / (W - pad.l - pad.r)) * (to - from);
    const rows = prepared.map((s) => {
      let best = null;
      for (const p of s.pts) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      return best ? { s, p: best } : null;
    }).filter(Boolean);
    if (!rows.length) return;
    cursor.setAttribute('x1', x(rows[0].p.t)); cursor.setAttribute('x2', x(rows[0].p.t)); cursor.setAttribute('visibility', 'visible');
    const tt = tooltip();
    tt.innerHTML = `<div class="muted small">${esc(new Date(rows[0].p.t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>` +
      rows.map((r) => `<div><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.s.color};margin-right:6px"></i>${esc(r.s.name)}: <b>${r.p.v}</b></div>`).join('');
    tt.classList.remove('hidden');
    tt.style.left = e.clientX + 14 + 'px'; tt.style.top = e.clientY + 14 + 'px';
  });
  svg.addEventListener('mouseleave', () => { cursor.setAttribute('visibility', 'hidden'); tooltip().classList.add('hidden'); });
}

/** Donut chart: items [{ label, value, color }] */
export function donut(el, items, { size = 170, center } = {}) {
  const total = items.reduce((a, b) => a + b.value, 0);
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  let off = 0;
  const segs = total ? items.map((it) => {
    const len = (it.value / total) * c;
    const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${it.color}" stroke-width="16" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(it.label)}: ${it.value}</title></circle>`;
    off += len;
    return s;
  }).join('') : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line2)" stroke-width="16"/>`;
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}
    <text x="50%" y="48%" text-anchor="middle" fill="var(--text)" font-size="22" font-weight="700">${esc(center ?? total)}</text>
    <text x="50%" y="62%" text-anchor="middle" fill="var(--muted)" font-size="11">total</text></svg>`;
}

/** Tiny sparkline for stat cards. */
export function sparkline(el, values, color = 'var(--accent)') {
  if (!values.length) { el.innerHTML = ''; return; }
  const W = 160, H = 52, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - 4 - (v / max) * (H - 10)}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="100%"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" opacity=".8"/></svg>`;
}

export const PALETTE = ['#3b8fd9', '#ef4f55', '#f2a33a', '#2fb36d', '#9b7cf0', '#3fc1c9', '#e5c33b', '#d96bb0'];
