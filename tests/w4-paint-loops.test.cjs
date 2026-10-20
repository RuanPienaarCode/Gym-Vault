'use strict';
/* W4-4 (usability fix wave 2, 20 Oct 2026): A LOOPING ANIMATION ONLY MOVES OPACITY AND TRANSFORM.

   filter and box-shadow are paint properties: animated on a loop they repaint the element every
   frame for as long as the screen is open, which on a phone is battery and dropped frames.
   Two loops did that:
     gv-fill-breathe  (the counter flood at the hot and peak stages) animated `filter: brightness`
     gv-voice-pulse   (the recording button's halo) animated `box-shadow`
   Both now move opacity (and, for the halo, transform) of a pseudo-element, which the compositor
   runs without repainting. The keyframes are read from the stylesheet text. A loop is any
   animation whose shorthand says `infinite`; a theme twin (`<name>-dark`, swapped in by an
   `animation-name` rule) is held to the same rule. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const file = process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css');
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

const frames = {};
for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
  let depth = 0, i = m.index + m[0].length - 1;
  const start = i;
  for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
  const body = css.slice(start + 1, i);
  const props = new Set();
  for (const blk of body.matchAll(/\{([^}]*)\}/g)) for (const d of blk[1].split(';')) { const k = d.split(':')[0].trim(); if (k) props.add(k); }
  frames[m[1]] = props;
}
const loops = new Set();
for (const m of css.matchAll(/(?:^|[;{\s])animation\s*:\s*([^;}]*)/g)) {
  if (!/\binfinite\b/.test(m[1])) continue;
  const name = m[1].split(/\s+/).find(t => frames[t]);
  if (name) loops.add(name);
}
for (const n of [...loops]) if (frames[n + '-dark']) loops.add(n + '-dark');

check('the stylesheet has looping animations to check (the parser is reading something)', () => {
  assert.ok(loops.size >= 10, `only ${loops.size} loops parsed: ${[...loops].join(', ')}`);
});
for (const name of [...loops].sort()) {
  check(`@keyframes ${name} (a loop) animates only opacity and transform`, () => {
    const bad = [...frames[name]].filter(p => p !== 'opacity' && p !== 'transform' && p !== 'animation-timing-function');
    assert.deepStrictEqual(bad, [], `@keyframes ${name} loops and animates ${bad.join(', ')}: a paint property repainted every frame`);
  });
}

check('the recording halo is a pseudo-element, not the button\'s own shadow, and stops under reduced motion', () => {
  assert.ok(/\.gv-voice-rec\.live::after\s*\{[^}]*animation:\s*gv-voice-pulse/.test(css), 'the pulse runs on .gv-voice-rec.live::after');
  assert.ok(!/\.gv-voice-rec\.live\s*\{[^}]*animation:/.test(css), 'the button itself still animates');
  assert.ok(/prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.gv-voice-rec\.live::after\s*\{\s*animation:\s*none/.test(css), 'reduced motion stops the halo');
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-paint-loops OK');
