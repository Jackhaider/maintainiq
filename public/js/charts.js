// Small dependency-free SVG charts with hover tooltips.
// Marks follow one system: 2px lines, bars with 4px rounded data-ends on a shared baseline,
// a 2px gap between adjacent bars, recessive grid, and a legend whenever there are 2+ series.

import { esc } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => {
    // CSS variables are applied through the style object so theme colours resolve reliably in every browser.
    if (typeof v === 'string' && v.startsWith('var(') && ['fill', 'stroke', 'stop-color'].includes(k)) el.style.setProperty(k, v);
    else el.setAttribute(k, v);
  });
  return el;
};

// One shared tooltip element for the whole page.
let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  return tip;
}
function showTip(evt, title, rows) {
  const t = tooltip();
  t.innerHTML = `<div class="t-title">${esc(title)}</div>${rows
    .map((r) => `<div class="t-row"><span>${r.color ? '<i></i>' : ''}${esc(r.label)}</span><b>${esc(r.value)}</b></div>`)
    .join('')}`;
  // Swatch colours are set through the CSSOM (allowed by the CSP, unlike inline style attributes).
  t.querySelectorAll('i').forEach((i, idx) => { i.style.background = rows.filter((r) => r.color)[idx].color; });
  t.classList.add('show');
  const pad = 14;
  const { innerWidth: W, innerHeight: H } = window;
  const r = t.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + r.width > W - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > H - 8) y = evt.clientY - r.height - pad;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
const hideTip = () => tip?.classList.remove('show');

/** Round a max value up to a "nice" axis maximum and return tick values. */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/**
 * Each draw gets a brand-new plot element, so a redraw (new period, theme switch) never leaves an
 * old ResizeObserver redrawing stale data into the same node.
 */
function freshPlot(target) {
  target.innerHTML = '';
  const plot = document.createElement('div');
  plot.className = 'chart';
  target.append(plot);
  return plot;
}

/** Re-render when the container width changes (responsive charts). */
function responsive(container, draw) {
  let lastW = 0;
  const run = () => {
    const w = Math.round(container.clientWidth);
    // Skip while the element is hidden or still being laid out (avoids negative SVG sizes).
    if (w < 160 || Math.abs(w - lastW) < 4) return;
    lastW = w;
    draw(w);
  };
  const ro = new ResizeObserver(run);
  ro.observe(container);
  run();
}

function legend(container, series) {
  if (series.length < 2) return;
  const lg = document.createElement('div');
  lg.className = 'legend';
  series.forEach((s) => {
    const span = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = s.color;
    span.append(i, document.createTextNode(s.name));
    lg.append(span);
  });
  container.before(lg);
}

function axes(svg, { W, H, m, ticks, yMax, fmt }) {
  const g = svgEl('g', { class: 'axis' });
  ticks.forEach((t) => {
    const y = m.t + (H - m.t - m.b) * (1 - t / yMax);
    g.append(svgEl('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y, y2: y }));
    const txt = svgEl('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' });
    txt.textContent = fmt(t);
    g.append(txt);
  });
  g.append(svgEl('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
  svg.append(g);
}

/**
 * Area/line chart for a single time series.
 * points: [{ label, value }], options: { color, height, format, name }
 */
export function lineChart(target, points, { color = 'var(--s1)', height = 240, format = String, name = 'Value' } = {}) {
  const container = freshPlot(target);
  responsive(container, (W) => {
    container.innerHTML = '';
    const H = height;
    const m = { t: 12, r: 12, b: 26, l: 52 };
    const yMax = Math.max(...niceTicks(Math.max(...points.map((p) => p.value), 0)));
    const ticks = niceTicks(Math.max(...points.map((p) => p.value), 0));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${name} line chart` });
    axes(svg, { W, H, m, ticks, yMax, fmt: format });

    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const x = (i) => m.l + (points.length === 1 ? iw / 2 : (iw * i) / (points.length - 1));
    const y = (v) => m.t + ih * (1 - v / yMax);

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1)},${H - m.b}L${x(0)},${H - m.b}Z`;
    const gradId = `g${Math.random().toString(36).slice(2, 8)}`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: 0, x2: 0, y1: 0, y2: 1 });
    grad.append(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': 0.22 }));
    grad.append(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.append(grad);
    svg.append(defs);
    svg.append(svgEl('path', { d: area, fill: `url(#${gradId})` }));
    svg.append(svgEl('path', { d: line, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // x labels: as many as fit (~70px each), always including the last point, never overlapping it
    const fit = Math.max(2, Math.floor(iw / 70));
    const step = Math.max(1, Math.ceil(points.length / fit));
    const last = points.length - 1;
    const xg = svgEl('g', { class: 'axis' });
    points.forEach((p, i) => {
      if (i !== last && (i % step || last - i < step * 0.75)) return;
      const t = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle' });
      t.textContent = p.label;
      xg.append(t);
    });
    svg.append(xg);

    // crosshair + marker + hit area
    const cross = svgEl('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' });
    const dot = svgEl('circle', { r: 5, fill: color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
    const hit = svgEl('rect', { class: 'hit', x: m.l, y: m.t, width: iw, height: ih });
    svg.append(cross, dot, hit);
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.l) / iw) * (points.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(points[i].value)); dot.setAttribute('visibility', 'visible');
      showTip(e, points[i].title || points[i].label, [{ label: name, value: format(points[i].value), color }]);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
    container.append(svg);
  });
}

/** Rounded-top bar path anchored on the baseline. */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Grouped vertical bar chart.
 * categories: ['Jun 26', ...]; series: [{ name, color, values: [..] }]
 */
export function barChart(target, categories, series, { height = 260, format = String } = {}) {
  target.innerHTML = '';
  const container = freshPlot(target);
  legend(container, series);
  responsive(container, (W) => {
    container.innerHTML = '';
    const H = height;
    const m = { t: 12, r: 8, b: 26, l: 52 };
    const max = Math.max(0, ...series.flatMap((s) => s.values));
    const ticks = niceTicks(max);
    const yMax = ticks[ticks.length - 1];
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bar chart' });
    axes(svg, { W, H, m, ticks, yMax, fmt: format });

    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const groupW = iw / categories.length;
    const inner = Math.min(groupW * 0.7, series.length * 28);
    const gap = 2;
    const barW = (inner - gap * (series.length - 1)) / series.length;

    categories.forEach((cat, ci) => {
      const gx = m.l + groupW * ci + (groupW - inner) / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] || 0;
        const bh = (ih * v) / yMax;
        const bx = gx + si * (barW + gap);
        const path = svgEl('path', { class: 'mark', d: barPath(bx, m.t + ih - bh, barW, bh), fill: s.color });
        svg.append(path);
      });
      // A hit area covering the whole category column is easier to hover than a thin bar.
      const hit = svgEl('rect', { class: 'hit', x: m.l + groupW * ci, y: m.t, width: groupW, height: ih });
      hit.addEventListener('mousemove', (e) =>
        showTip(e, cat, series.map((s) => ({ label: s.name, value: format(s.values[ci] || 0), color: s.color })))
      );
      hit.addEventListener('mouseleave', hideTip);
      svg.append(hit);
      const t = svgEl('text', { class: 'label', x: m.l + groupW * ci + groupW / 2, y: H - 8, 'text-anchor': 'middle' });
      t.textContent = cat;
      svg.append(t);
    });
    container.append(svg);
  });
}

/** Donut for part-to-whole with few segments: segments [{ label, value, color }] */
export function donut(container, segments, { centerLabel = 'Total' } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 150;
  const r = 60;
  const stroke = 18;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': 'Donut chart' });
  const c = 2 * Math.PI * r;
  let offset = 0;
  svg.append(svgEl('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'var(--grid)', 'stroke-width': stroke }));
  segments.forEach((s) => {
    if (!s.value) return;
    const len = (s.value / total) * c;
    const seg = svgEl('circle', {
      class: 'mark', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: s.color, 'stroke-width': stroke,
      'stroke-dasharray': `${Math.max(len - 2, 0)} ${c - Math.max(len - 2, 0)}`, // 2px surface gap between segments
      'stroke-dashoffset': -offset, transform: `rotate(-90 ${size / 2} ${size / 2})`,
    });
    seg.addEventListener('mousemove', (e) => showTip(e, s.label, [{ label: 'Machines', value: `${s.value} (${Math.round((s.value / total) * 100)}%)`, color: s.color }]));
    seg.addEventListener('mouseleave', hideTip);
    svg.append(seg);
    offset += len;
  });
  const t1 = svgEl('text', { x: size / 2, y: size / 2 + 2, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 650, fill: 'var(--text)' });
  t1.textContent = total;
  const t2 = svgEl('text', { x: size / 2, y: size / 2 + 20, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-3)' });
  t2.textContent = centerLabel;
  svg.append(t1, t2);
  container.innerHTML = '';
  container.append(svg);
}

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
