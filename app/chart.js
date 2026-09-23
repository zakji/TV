// Neon SVG price chart: one line per model (new price), dashed line for best 2nd-chance.
// Touch/mouse scrubbing shows a crosshair + tooltip. No dependencies.
const NS = 'http://www.w3.org/2000/svg';
const COLORS = { G4: '#00f0ff', G5: '#ff2bd6', G6: '#b6ff3b' };
const eur = (n) => '€' + Math.round(n).toLocaleString('nl-NL');
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
};
const dayMs = 86400e3;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const parseD = (d) => new Date(d + 'T12:00:00');

export function renderChart(container, legendEl, history, { models = ['G4', 'G5', 'G6'], rangeDays = 30, showSecond = true } = {}) {
  container.innerHTML = '';
  legendEl.innerHTML = '';
  const series = [];
  for (const m of models) {
    const h = (history?.[m] || []).filter((p) => p.d);
    const pts = h.filter((p) => p.new != null).map((p) => ({ t: parseD(p.d).getTime(), v: p.new, d: p.d, shop: p.shop }));
    const sec = h
      .map((p) => ({ t: parseD(p.d).getTime(), v: Math.min(p.refurbished ?? Infinity, p.used ?? Infinity), d: p.d }))
      .filter((p) => Number.isFinite(p.v));
    if (pts.length) series.push({ m, kind: 'new', pts });
    if (showSecond && sec.length) series.push({ m, kind: 'second', pts: sec });
  }
  const now = Date.now();
  const minT = rangeDays ? now - rangeDays * dayMs : Math.min(...series.flatMap((s) => s.pts.map((p) => p.t)), now - 7 * dayMs);
  for (const s of series) s.pts = s.pts.filter((p) => p.t >= minT - dayMs);
  const visible = series.filter((s) => s.pts.length);

  // Legend (always, identity never by color alone)
  for (const m of models) {
    const s = document.createElement('span');
    s.innerHTML = `<i style="--c:${COLORS[m]}"></i>${m} new`;
    legendEl.appendChild(s);
  }
  if (showSecond && visible.some((s) => s.kind === 'second')) {
    const s = document.createElement('span');
    s.innerHTML = `<i class="dash" style="--c:#cfd6ff"></i>2nd chance / used`;
    legendEl.appendChild(s);
  }

  const allPts = visible.flatMap((s) => s.pts);
  if (!allPts.length) {
    container.innerHTML = '<div class="chart-empty">No price history yet.<br>A new point is added after every daily scan at 12:00.</div>';
    return;
  }

  const W = container.clientWidth || 340;
  const H = container.clientHeight || 220;
  const pad = { l: 44, r: 40, t: 12, b: 24 };
  const tMin = Math.min(minT, ...allPts.map((p) => p.t));
  const tMax = Math.max(now, ...allPts.map((p) => p.t));
  let vMin = Math.min(...allPts.map((p) => p.v));
  let vMax = Math.max(...allPts.map((p) => p.v));
  const span = Math.max(vMax - vMin, 400);
  vMin = Math.floor((vMin - span * 0.12) / 100) * 100;
  vMax = Math.ceil((vMax + span * 0.12) / 100) * 100;
  const x = (t) => pad.l + ((t - tMin) / Math.max(tMax - tMin, dayMs)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - vMin) / (vMax - vMin)) * (H - pad.t - pad.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Price history chart' }, container);
  const defs = el('defs', {}, svg);
  const f = el('filter', { id: 'glow', x: '-20%', y: '-50%', width: '140%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: '3', result: 'b' }, f);
  const mg = el('feMerge', {}, f);
  el('feMergeNode', { in: 'b' }, mg);
  el('feMergeNode', { in: 'SourceGraphic' }, mg);
  for (const m of models) {
    const g = el('linearGradient', { id: 'fill' + m, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': COLORS[m], 'stop-opacity': 0.9 }, g);
    el('stop', { offset: '100%', 'stop-color': COLORS[m], 'stop-opacity': 0 }, g);
  }

  // Grid + axes (recessive)
  const axis = el('g', { class: 'axis' }, svg);
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = vMin + ((vMax - vMin) * i) / ticks;
    el('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, axis);
    const tx = el('text', { x: pad.l - 6, y: y(v) + 3, 'text-anchor': 'end' }, axis);
    tx.textContent = '€' + (v / 1000).toFixed(1) + 'k';
  }
  const days = (tMax - tMin) / dayMs;
  const xt = Math.min(W < 400 ? 3 : 4, Math.max(1, Math.floor(days)));
  for (let i = 0; i <= xt; i++) {
    const t = tMin + ((tMax - tMin) * i) / xt;
    const tx = el('text', { x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === xt ? 'end' : 'middle' }, axis);
    tx.textContent = new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // Lines
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const labels = [];
  for (const s of visible) {
    const c = COLORS[s.m];
    if (s.kind === 'new' && s.pts.length > 1) {
      const a = el('path', { class: 'area', fill: `url(#fill${s.m})`, d: path(s.pts) + `L${x(s.pts.at(-1).t)},${H - pad.b}L${x(s.pts[0].t)},${H - pad.b}Z` }, svg);
      a.style.opacity = 0.12;
    }
    if (s.pts.length > 1) {
      const p = el('path', { class: 'line' + (s.kind === 'second' ? ' second' : ' draw'), stroke: c, d: path(s.pts), filter: s.kind === 'new' ? 'url(#glow)' : '' }, svg);
      if (s.kind === 'new') {
        const len = p.getTotalLength?.() || 1000;
        p.style.setProperty('--len', len);
      }
    }
    const last = s.pts.at(-1);
    el('circle', { class: 'dot', cx: x(last.t), cy: y(last.v), r: s.kind === 'new' ? 4.5 : 3.5, fill: c }, svg);
    if (s.kind === 'new') labels.push({ y: y(last.v), x: x(last.t), m: s.m, c });
  }
  // Direct end-labels, nudged apart to avoid collisions
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 12) labels[i].y = labels[i - 1].y + 12;
  for (const l of labels) {
    const t = el('text', { x: Math.min(l.x + 8, W - 2), y: l.y + 4, fill: '#eef1ff', 'font-size': 11, 'font-weight': 700, 'font-family': 'Orbitron, sans-serif' }, svg);
    t.textContent = l.m;
    const sw = el('rect', { x: Math.min(l.x + 8, W - 2) - 1, y: l.y + 6, width: 18, height: 2, fill: l.c, rx: 1 }, svg);
    sw.setAttribute('opacity', 0.9);
  }

  // Crosshair + tooltip
  const cursor = el('line', { class: 'cursor', y1: pad.t, y2: H - pad.b, x1: 0, x2: 0, visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.appendChild(tip);
  const dates = [...new Set(allPts.map((p) => p.t))].sort((a, b) => a - b);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = dates[0];
    for (const t of dates) if (Math.abs(x(t) - px) < Math.abs(x(best) - px)) best = t;
    cursor.setAttribute('x1', x(best));
    cursor.setAttribute('x2', x(best));
    cursor.setAttribute('visibility', 'visible');
    const rows = visible
      .map((s) => ({ s, p: s.pts.find((p) => p.t === best) }))
      .filter((r) => r.p)
      .map(({ s, p }) => `<div><span style="color:${COLORS[s.m]}">●</span> ${s.m} ${s.kind === 'new' ? 'new' : '2nd'} <b>${eur(p.v)}</b>${p.shop ? ` <span style="color:#8b93b8">${esc(p.shop)}</span>` : ''}</div>`)
      .join('');
    tip.innerHTML = `<div style="color:#8b93b8">${new Date(best).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>${rows}`;
    tip.hidden = false;
    const left = (x(best) / W) * r.width;
    tip.style.left = Math.max(80, Math.min(r.width - 80, left)) + 'px';
  };
  const hide = () => {
    tip.hidden = true;
    cursor.setAttribute('visibility', 'hidden');
  };
  container.onpointerdown = container.onpointermove = (e) => show(e.clientX);
  container.onpointerleave = container.onpointercancel = hide;
  container.onpointerup = (e) => { if (e.pointerType !== 'mouse') setTimeout(hide, 1800); };
}
