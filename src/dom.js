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

/* A `<div>` that behaves like a button — the pattern every "the whole card
   is the tap target" surface in this app needs, and (before this helper)
   each one re-implemented by hand with no keyboard route at all. Wires
   role="button" + tabindex="0", a click listener, and the same Enter/Space
   handling attachTapZone uses for the tap-counter zones (rep-counter-
   shared.js) — so a keyboard or switch-control user can reach it exactly
   like a mouse/touch user can.

   `onActivate(e)` fires on click and on Enter/Space, but NOT when the event
   target is (or is inside) a nested <button> — cards that carry their own
   edit/delete icon buttons must let those fire on their own, not double as
   the card's own activation. Callers that used to write
   `c.addEventListener('click', e => { if (!e.target.closest('button')) ... })`
   by hand now get the same guard on both click AND keydown for free. */
function clickableCard(attrs, onActivate, ...kids) {
  const node = el('div', { ...attrs, role: attrs.role || 'button', tabindex: '0' }, ...kids);
  const nested = e => !!e.target.closest('button');
  node.addEventListener('click', e => { if (!nested(e)) onActivate(e); });
  node.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (nested(e)) return;
    e.preventDefault(); // ' ' must not also scroll the page
    onActivate(e);
  });
  return node;
}

/* A labelled on/off row — the shape both the export options and the guided-
   session setup screen need.

   A switch, not a button: the row toggles one thing on/off rather than
   activating an action, so it carries role="switch" + aria-checked. The
   accessible name lives on the ROW (aria-label) because the row is the whole
   hit target; the switch glyph itself is decorative. `onChange(next)` gets
   the value it is being moved TO — callers re-render themselves, since this
   module knows nothing about the app controller.

   `disabled` renders the row inert and unfocusable but still readable, for a
   toggle that has nothing to act on (a warm-up with no mobility exercises in
   the library). It carries its own explanation in `desc` — a dead control
   with no reason given is worse than no control. */
function toggleRow(name, desc, value, onChange, opts = {}) {
  const on = !!value;
  const cls = `gv-card gv-optrow${on ? ' on' : ''}${opts.disabled ? ' gv-optrow-off' : ''}`;
  const body = [
    el('div', { class: 'gv-optrow-main' },
      el('div', { class: 'gv-optrow-name' }, name),
      desc ? el('div', { class: 'gv-optrow-desc' }, desc) : ''),
    el('span', { class: `gv-switch${on ? ' on' : ''}`, 'aria-hidden': 'true' }),
  ];
  if (opts.disabled) {
    return el('div', { class: cls, 'aria-disabled': 'true' }, ...body);
  }
  return clickableCard(
    { class: cls, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': name },
    () => onChange(!on),
    ...body);
}

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

/* ---- Plan prose -------------------------------------------------------
   Plan intros are long-form coaching copy. Rendering them as
   `lines.join(' ')` flattened blank lines AND bullet lines into one
   unbroken blob — 700 characters of undifferentiated text, which is what
   "this copy is overwhelming" was reporting.

   The shape here is a chunked accordion. Each blank-line-separated group
   becomes a chunk with a permanently visible HEADLINE and a body that
   collapses. That choice is deliberate and safety-driven: these intros
   carry medical red flags ("stop and get assessed if you get: leaking
   urine…", "get it looked at"). An earlier version classified paragraphs
   as safety-critical by keyword and kept those expanded — but the matcher
   demonstrably missed a real warning paragraph that never says "stop" or
   "see a doctor". Hiding a red flag behind a button is a worse failure
   than a wall of text, so nothing is classified: EVERY chunk's headline
   stays on screen, and only the detail folds away. */

/* Blank-line-separated groups, lines kept intact (bullets must survive). */
const groups = lines => {
  const out = [];
  let cur = [];
  for (const line of lines || []) {
    if (String(line).trim() === '') { if (cur.length) { out.push(cur); cur = []; } }
    else cur.push(String(line));
  }
  if (cur.length) out.push(cur);
  return out;
};

/* Paragraph text per group — kept exported for the flattening tripwire. */
const paragraphs = lines => groups(lines).map(g => g.map(l => l.trim()).join(' ').trim()).filter(Boolean);

/* An ALL-CAPS lead-in ending in ":" or "." is this vault's headline
   convention ("THE WEEK:", "PHASE 1 OF 4 — FOUNDATION.", "STOP AND GET
   ASSESSED IF YOU GET:"). `[^a-z]` is the test: a lead-in has no lowercase. */
/* A parenthetical may carry lowercase ("WHILE REBUILDING (to 11 Sep):")
   without disqualifying the lead-in. */
const LEAD_IN = /^([A-Z](?:[^a-z(]|\([^)]*\)){2,70}?[:.])(\s+|$)/;
const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*(\d+)[.)]\s+(.*)$/;

/* One group → ordered blocks. Consecutive bullet lines coalesce into a real
   list instead of being space-joined into the paragraph. */
function blocksOf(lines) {
  const blocks = [];
  let para = [];
  const flush = () => {
    const text = para.join(' ').trim();
    para = [];
    if (text) blocks.push({ kind: 'p', text });
  };
  for (const raw of lines) {
    const ul = raw.match(UL);
    const ol = ul ? null : raw.match(OL);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const item = (ul ? ul[1] : ol[2]).trim();
      const openList = blocks[blocks.length - 1];
      if (openList && openList.kind === kind) openList.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    /* Markdown lazy continuation: a plain line directly after a bullet
       belongs to THAT bullet. Without this every wrapped bullet split its
       list in two and dropped the tail into a stray paragraph. */
    const prevBlock = blocks[blocks.length - 1];
    if (!para.length && prevBlock && prevBlock.kind !== 'p') {
      prevBlock.items[prevBlock.items.length - 1] += ` ${raw.trim()}`;
      continue;
    }
    para.push(raw.trim());
  }
  flush();
  return blocks;
}

const words = (text, n) => {
  const w = text.split(/\s+/).filter(Boolean);
  return w.length <= n ? text.trim() : `${w.slice(0, n).join(' ')}…`;
};

/* Groups → [{label, blocks}]. A group that is ONLY a lead-in adopts the
   next group as its body, so "THE RULES FOR THESE TWO WEEKS:" followed by
   a bullet list reads as one chunk rather than an empty header. */
function chunks(lines) {
  const raw = groups(lines).map(g => {
    const blocks = blocksOf(g);
    let label = '';
    const first = blocks[0];
    if (first && first.kind === 'p') {
      const m = first.text.match(LEAD_IN);
      if (m) {
        label = m[1].trim();
        const rest = first.text.slice(m[0].length).trim();
        if (rest) first.text = rest;
        else blocks.shift();
      }
    }
    return { label, blocks };
  }).filter(c => c.label || c.blocks.length);

  const out = [];
  for (const c of raw) {
    const prev = out[out.length - 1];
    /* A group that is only a lead-in adopts the next group as its body. */
    if (prev && prev.label && !prev.blocks.length) { prev.blocks = c.blocks; continue; }
    /* A bare list is never its own topic — it continues whatever introduced
       it. Left alone, "THE RETURN-TO-RUNNING CHECKS." became a chunk with no
       checks in it, and the checks became a chunk headlined by their own
       first item. */
    if (prev && !c.label && c.blocks.length && c.blocks.every(b => b.kind !== 'p')) {
      prev.blocks = prev.blocks.concat(c.blocks);
      continue;
    }
    out.push(c);
  }
  /* Unlabelled chunks still need a visible headline, so summarise them —
     that is what keeps a warning with no caps lead-in ("Leaking or dragging
     during a run…") on screen. A DERIVED headline is a sentence opening, not
     a section title, so it is flagged and presented differently. */
  for (const c of out) {
    if (c.label) continue;
    const p = c.blocks.find(b => b.kind === 'p');
    const src = p ? p.text : (c.blocks[0] && c.blocks[0].items[0]) || '';
    c.label = words(src, 8);
    c.derived = true;
  }
  return out;
}

let proseUid = 0;

function renderBlocks(host, blocks) {
  for (const b of blocks) {
    if (b.kind === 'p') { host.append(el('p', {}, b.text)); continue; }
    const list = el(b.kind === 'ol' ? 'ol' : 'ul', { class: 'gv-prose-list' });
    for (const item of b.items) list.append(el('li', {}, item));
    host.append(list);
  }
}

/* Chunked prose. The first chunk is open; the rest show their headline with
   a disclosure control. Bodies are in the DOM throughout — collapsing is
   visual only, so find-in-page and screen readers still reach every word. */
function prose(lines, opts = {}) {
  const list = chunks(lines);
  const wrap = el('div', { class: `gv-prose${opts.class ? ' ' + opts.class : ''}` });
  if (!list.length) return wrap;

  /* A single chunk is just prose — no accordion chrome for one paragraph. */
  if (list.length === 1) {
    const only = list[0];
    if (only.blocks.length) renderBlocks(wrap, only.blocks);
    else wrap.append(el('p', {}, only.label));
    return wrap;
  }

  /* EVERY chunk starts closed. Leaving the first one open still opened the
     page on a seven-line paragraph, which is what "still too long for the
     intro" was reporting — so the intro is now a compact stack of headlines
     and the reader opens the one they want. */
  list.forEach(c => {
    const id = `gv-prose-${++proseUid}`;
    const body = el('div', { class: 'gv-chunk-body', id });
    renderBlocks(body, c.blocks);
    const chunk = el('div', { class: 'gv-chunk' });
    const btn = el('button', { class: 'gv-chunk-head', type: 'button', 'aria-controls': id });
    btn.append(el('span', { class: `gv-chunk-label${c.derived ? ' is-summary' : ''}` }, c.label), ico('chevron-down', 'gv-chunk-caret'));
    /* State lives in a class, never in an inline style: Obsidian's review
       guidelines ask plugins not to assign styles from JS, and it keeps the
       open/closed look in the stylesheet where a theme can reach it. */
    let shown = false;
    const apply = () => {
      chunk.className = `gv-chunk${shown ? ' open' : ''}`;
      btn.setAttribute('aria-expanded', shown ? 'true' : 'false');
    };
    btn.addEventListener('click', () => { shown = !shown; apply(); });
    chunk.append(btn, body);
    apply();
    wrap.append(chunk);
  });
  return wrap;
}

module.exports = { el, ico, clickableCard, toggleRow, clear, fmt, fmtSeconds, ring, sparkline, paragraphs, chunks, prose };
