// GTA V world map on a canvas: pan/zoom, player markers, paths. The map image itself is NOT shipped
// (Rockstar asset) — put your own at the configured path; calibration bounds are in Settings → Map.
// Without an image, an honest coordinate grid is drawn so positions are still accurate.

import { NUI, API_BASE } from './api.js';

export class MapView {
  constructor(canvas, cfg) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = cfg;                // { image, minX, maxX, minY, maxY }
    this.view = { scale: 1, ox: 0, oy: 0 };
    this.markers = [];             // { id, x, y, label, color, ring, heading }
    this.paths = [];               // { points: [{x,y}], color, width, dashed }
    this.selected = null;
    this.onSelect = null;
    this.img = null;
    this.imgOk = false;
    this.W = 8192; this.H = 8192;  // logical map size (image size when loaded)
    this.load();
    this.bind();
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement);
  }

  load() {
    const img = new Image();
    img.onload = () => { this.img = img; this.imgOk = true; this.W = img.naturalWidth; this.H = img.naturalHeight; this.fit(); };
    img.onerror = () => { this.imgOk = false; this.fit(); };
    // In-game the panel runs on the cfx-nui origin: load the map image from the backend.
    img.crossOrigin = 'anonymous';
    img.src = NUI && this.cfg.image.startsWith('/') ? API_BASE + this.cfg.image : this.cfg.image;
  }

  destroy() { this._ro.disconnect(); this.dead = true; }

  // world → map pixels
  toMap(x, y) {
    const { minX, maxX, minY, maxY } = this.cfg;
    return { x: ((x - minX) / (maxX - minX)) * this.W, y: ((maxY - y) / (maxY - minY)) * this.H };
  }
  toScreen(x, y) { const m = this.toMap(x, y); return { x: m.x * this.view.scale + this.view.ox, y: m.y * this.view.scale + this.view.oy }; }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cw = r.width; this.ch = r.height;
    if (!this._fitted) this.fit();
    this.draw();
  }

  fit() {
    if (!this.cw) return;
    const s = Math.min(this.cw / this.W, this.ch / this.H) * 0.98;
    this.view = { scale: s, ox: (this.cw - this.W * s) / 2, oy: (this.ch - this.H * s) / 2 };
    this._fitted = true;
    this.draw();
  }

  zoom(f, cx = this.cw / 2, cy = this.ch / 2) {
    const ns = Math.min(Math.max(this.view.scale * f, 0.02), 6);
    const k = ns / this.view.scale;
    this.view.ox = cx - (cx - this.view.ox) * k;
    this.view.oy = cy - (cy - this.view.oy) * k;
    this.view.scale = ns;
    this.draw();
  }

  centerOn(x, y, minScale = 0.35) {
    if (this.view.scale < minScale) this.view.scale = minScale;
    const m = this.toMap(x, y);
    this.view.ox = this.cw / 2 - m.x * this.view.scale;
    this.view.oy = this.ch / 2 - m.y * this.view.scale;
    this.draw();
  }

  bind() {
    let drag = null;
    this.c.addEventListener('wheel', (e) => { e.preventDefault(); const r = this.c.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    this.c.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, moved: false }; this.c.classList.add('drag'); });
    window.addEventListener('mousemove', (this._mm = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.view.ox = drag.ox + dx; this.view.oy = drag.oy + dy; this.draw();
    }));
    window.addEventListener('mouseup', (this._mu = (e) => {
      if (!drag) return;
      this.c.classList.remove('drag');
      if (!drag.moved) {
        const r = this.c.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        let best = null, bd = 14;
        for (const m of this.markers) {
          const s = this.toScreen(m.x, m.y);
          const d = Math.hypot(s.x - px, s.y - py);
          if (d < bd) { bd = d; best = m; }
        }
        if (this.onSelect) this.onSelect(best ? best.id : null);
      }
      drag = null;
    }));
  }

  setMarkers(m) { this.markers = m; this.draw(); }
  setPaths(p) { this.paths = p; this.draw(); }

  drawGrid(ctx) {
    const { minX, maxX, minY, maxY } = this.cfg;
    ctx.fillStyle = '#0b1622';
    const tl = this.toScreen(minX, maxY), br = this.toScreen(maxX, minY);
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = 'rgba(98,170,234,.10)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(124,135,157,.55)'; ctx.font = '10px Inter, sans-serif';
    const step = 1000;
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      const a = this.toScreen(x, minY), b = this.toScreen(x, maxY);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillText(String(x), a.x + 3, a.y - 4);
    }
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const a = this.toScreen(minX, y), b = this.toScreen(maxX, y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillText(String(y), a.x + 3, a.y - 3);
    }
    const o = this.toScreen(0, 0);
    ctx.strokeStyle = 'rgba(98,170,234,.3)';
    ctx.beginPath(); ctx.arc(o.x, o.y, 4, 0, Math.PI * 2); ctx.stroke();
  }

  draw() {
    if (this.dead || !this.cw) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (this.imgOk) ctx.drawImage(this.img, this.view.ox, this.view.oy, this.W * this.view.scale, this.H * this.view.scale);
    else this.drawGrid(ctx);

    for (const p of this.paths) {
      if (p.points.length < 2) continue;
      ctx.strokeStyle = p.color; ctx.lineWidth = p.width || 2; ctx.setLineDash(p.dashed ? [5, 4] : []);
      ctx.beginPath();
      p.points.forEach((pt, i) => { const s = this.toScreen(pt.x, pt.y); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of this.paths) for (const d of p.dots || []) {
      const s = this.toScreen(d.x, d.y);
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#04070d'; ctx.lineWidth = 2; ctx.stroke();
    }

    const showLabels = this.view.scale > 0.12 || this.markers.length < 25;
    for (const m of this.markers) {
      const s = this.toScreen(m.x, m.y);
      if (s.x < -20 || s.y < -20 || s.x > this.cw + 20 || s.y > this.ch + 20) continue;
      const sel = m.id === this.selected;
      if (m.ring) { ctx.strokeStyle = m.ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, sel ? 13 : 10, 0, Math.PI * 2); ctx.stroke(); }
      if (m.heading !== undefined) {
        // GTA heading: 0° = north, increasing counter-clockwise. World dir (−sin h, cos h) → screen (−sin h, −cos h).
        const hr = m.heading * Math.PI / 180;
        const a = Math.atan2(-Math.cos(hr), -Math.sin(hr));
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * 11, s.y + Math.sin(a) * 11);
        ctx.lineTo(s.x + Math.cos(a + 2.5) * 5, s.y + Math.sin(a + 2.5) * 5);
        ctx.lineTo(s.x + Math.cos(a - 2.5) * 5, s.y + Math.sin(a - 2.5) * 5);
        ctx.fill();
      }
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, sel ? 7 : 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#04070d'; ctx.lineWidth = 2; ctx.stroke();
      if (showLabels || sel) {
        ctx.font = `${sel ? 600 : 500} 11.5px Inter, sans-serif`;
        const text = m.label;
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = 'rgba(4,7,13,.82)';
        ctx.beginPath(); ctx.roundRect(s.x - w / 2, s.y - 28, w, 17, 5); ctx.fill();
        ctx.fillStyle = sel ? '#fff' : '#cfd6e4';
        ctx.textAlign = 'center'; ctx.fillText(text, s.x, s.y - 16); ctx.textAlign = 'left';
      }
    }
  }

  unbind() { window.removeEventListener('mousemove', this._mm); window.removeEventListener('mouseup', this._mu); this.destroy(); }
}
