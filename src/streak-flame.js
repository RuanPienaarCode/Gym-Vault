'use strict';
/* THE STREAK FLAME — one component whose intensity IS the number.

   Three weeks is a candle; thirty is a bonfire. The scale and the flicker
   rate both come off the count, so the drawing carries the reading and the
   digit beside it is confirmation rather than the only information. That is
   the whole idea: a flame that looked identical at 3 and at 30 would be
   decoration, and decoration on a number is worse than no drawing at all.

   Ported from design/counter-animations.html (10 Streak flame), with its
   constraints kept:
     - transform and opacity only, so nothing here triggers layout;
     - the flicker is a CSS animation on ONE node — the catalogue's warning
       about infinite animations keeping the compositor awake is why there is
       exactly one flame per page and no per-ember loop;
     - under prefers-reduced-motion the flicker stops but the SIZE still
       scales, so the reading survives with the movement removed.

   Built through createElementNS, not innerHTML — same rule as everywhere. */

const { el } = require('./dom');

const NS = 'http://www.w3.org/2000/svg';

/* The two paths from the design page, unchanged: an outer body and an inner
   core. Two shapes rather than a gradient because a gradient at this size
   turns to mud on a phone. */
const OUTER = 'M28 4 C40 22 52 30 52 46 C52 62 41 72 28 72 C15 72 4 62 4 46 C4 32 14 28 20 16 C22 26 26 28 28 30 C30 24 28 14 28 4 Z';
const INNER = 'M28 34 C35 44 40 48 40 55 C40 64 34 69 28 69 C22 69 16 64 16 55 C16 48 22 44 28 34 Z';

/* Where the flame stops growing. Past this the drawing cannot say anything
   more, and a flame that kept scaling would eventually be the page. The
   NUMBER keeps climbing regardless — the cap is on the picture, not the
   fact. */
const FULL_AT = 12;

/* How hot, 0..1, from a streak count. Deliberately not linear: the jump from
   1 week to 2 is the one that should feel like something, and from 20 to 21
   is not. sqrt gives most of its movement early. */
function intensity(count) {
  const n = Number.isFinite(count) ? count : parseFloat(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1, Math.sqrt(n / FULL_AT));
}

/* Scale and flicker period for an intensity. Faster flicker AND bigger
   flame as it rises; the period floor stops a long streak strobing. */
function flameStyle(count) {
  const t = intensity(count);
  return {
    intensity: t,
    scale: Math.round((0.66 + t * 0.62) * 1000) / 1000,   // 0.66 cold -> 1.28 hot
    flickerMs: Math.round(620 - t * 320),                  // 620ms -> 300ms
  };
}

/* The flame itself. `count` of 0 renders an UNLIT flame — grey, still, and
   present. A missing streak is a real state with something to say ("nothing
   yet"), and hiding the component would make the layout jump the week a
   streak starts. */
function streakFlame(count, opts) {
  const o = opts || {};
  const n = Number.isFinite(count) ? count : 0;
  const { scale, flickerMs } = flameStyle(n);
  const lit = n > 0;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 56 76');
  svg.setAttribute('class', `gv-streak-svg${lit ? ' lit' : ''}`);
  /* Decorative: the count sits beside it in real text, and a screen reader
     hearing "streak flame" learns nothing the number did not already say. */
  svg.setAttribute('aria-hidden', 'true');
  if (lit) svg.style.animationDuration = `${flickerMs}ms`;

  const outer = document.createElementNS(NS, 'path');
  outer.setAttribute('d', OUTER);
  outer.setAttribute('class', 'gv-streak-outer');
  const inner = document.createElementNS(NS, 'path');
  inner.setAttribute('d', INNER);
  inner.setAttribute('class', 'gv-streak-inner');
  svg.appendChild(outer);
  svg.appendChild(inner);

  /* THE SIZE GOES ON THE WRAPPER, NOT THE SVG. The flicker is a CSS
     animation on the svg that animates `transform`, and an animation beats
     an inline style — so a scale set on the svg is silently wiped the
     moment the flame is lit, and every streak from 1 to 30 renders at
     exactly the same size. Which is the one thing this component exists not
     to do, and it looked completely fine until the computed transform was
     actually measured.

     Nesting them composes cleanly: the wrapper carries the value, the svg
     carries the movement, and neither can overwrite the other. The wrapper
     is transform-only, so scaling it moves no neighbour. */
  const wrap = el('div', { class: 'gv-streak-flame' }, svg);
  wrap.style.transform = `scale(${scale})`;

  if (o.bare) return wrap;

  /* The whole tile: flame, number, label. One element so both callers (the
     dashboard and History) get the same object rather than each assembling
     their own from the parts and drifting. */
  return el('div', { class: 'gv-streak' },
    wrap,
    el('div', { class: 'gv-streak-read' },
      el('div', { class: 'gv-streak-num' }, String(n)),
      el('div', { class: 'gv-streak-label' }, o.label || (n === 1 ? 'week streak' : 'week streak'))),
  );
}

module.exports = { streakFlame, flameStyle, intensity, FULL_AT };
