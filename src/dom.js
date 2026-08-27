'use strict';
/* DOM construction helpers — the only module under src/ (besides view,
   modals, settings-tab) that imports obsidian. No innerHTML anywhere: every
   node is built, which is both the community-review rule and what keeps
   user-authored strings (exercise names, notes) inert. */

const { setIcon } = require('obsidian');

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (k === 'class') n.className = val;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), val);
    else if (val !== null && val !== undefined) n.setAttribute(k, val);
  }
  /* Every plugin button opts OUT of Obsidian's own button chrome by carrying
     .clickable-icon: app.css's `button:not(.clickable-icon)` sets gray
     background/shadow at (0,1,1), and on MOBILE `button:not(.clickable-icon)
     .mobile-tap` repaints a touched button gray at (0,2,1) — which beats our
     (0,2,0) rules and flashes over the design mid-tap. Everything
     .clickable-icon itself brings is (0,1,0/1) and loses to our rules; the
     leftover gaps (radius, svg opacity) are patched in styles.css. */
  if (tag === 'button') n.classList.add('clickable-icon');
  for (const kid of kids.flat()) n.append(kid && kid.nodeType ? kid : document.createTextNode(kid ?? ''));
  return n;
};

/* Lucide icon span. Names must exist in the app's pinned lucide set —
   setIcon() on an unknown name is a SILENT no-op that ships an empty box.
   Every name is checked against the DESKTOP obsidian.asar, but iOS often
   runs an older app with an older lucide, where some of these names didn't
   exist yet (lucide renamed whole families: line-chart→chart-line,
   check-circle→circle-check…). So: try the name, then its older aliases,
   then a neutral dot — never ship a blank box. */
const ICON_FALLBACKS = {
  'chart-line': ['line-chart'],
  'circle-check': ['check-circle'],
  'calendar-days': ['calendar'],
  'clipboard-list': ['clipboard'],
  'heart-pulse': ['heart'],
  'medal': ['award'],
  'timer': ['clock'],
  'repeat-2': ['repeat'],
};
const ico = (name, cls) => {
  const s = el('span', { class: `gv-ico${cls ? ' ' + cls : ''}` });
  for (const candidate of [name, ...(ICON_FALLBACKS[name] || []), 'circle']) {
    setIcon(s, candidate);
    if (s.querySelector('svg')) break;
  }
  return s;
};

const clear = node => { while (node.firstChild) node.removeChild(node.firstChild); };

/* Display formatting for numbers that may be null ("no data" ≠ 0). */
const fmt = (v, suffix) => (v === null || v === undefined || v === '' ? '—' : `${v}${suffix || ''}`);

/* mm:ss for duration metrics (plank 360 → "6:00"). */
const fmtSeconds = sec => {
  const n = parseFloat(sec);
  if (!Number.isFinite(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60), s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* SVG progress ring, 0..1. Built with createElementNS (no innerHTML). */
function ring(progress, size, label) {
  const p = Math.max(0, Math.min(1, progress || 0));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'gv-ring');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label || `Progress ${Math.round(p * 100)}%`);
  const mk = (cls, dash) => {
    const ci = document.createElementNS(NS, 'circle');
    ci.setAttribute('cx', size / 2); ci.setAttribute('cy', size / 2); ci.setAttribute('r', r);
    ci.setAttribute('class', cls);
    if (dash !== undefined) {
      ci.setAttribute('stroke-dasharray', `${dash} ${c}`);
      ci.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
    }
    svg.appendChild(ci);
    return ci;
  };
  mk('gv-ring-track');
  mk('gv-ring-fill', c * p);
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', '50%'); t.setAttribute('y', '50%');
  t.setAttribute('class', 'gv-ring-text');
  t.textContent = `${Math.round(p * 100)}%`;
  svg.appendChild(t);
  return svg;
}

/* Sparkline for a [{date, value}] series. */
function sparkline(points, w, h, label) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'gv-spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label || 'Trend');
  if (!points || points.length < 2) return svg;
  const vals = points.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const px = i => 4 + (i / (points.length - 1)) * (w - 8);
  const py = val => h - 6 - ((val - min) / span) * (h - 12);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'gv-spark-line');
  svg.appendChild(path);
  const last = document.createElementNS(NS, 'circle');
  last.setAttribute('cx', px(points.length - 1)); last.setAttribute('cy', py(vals[vals.length - 1]));
  last.setAttribute('r', 3); last.setAttribute('class', 'gv-spark-dot');
  svg.appendChild(last);
  return svg;
}

module.exports = { el, ico, clear, fmt, fmtSeconds, ring, sparkline };
