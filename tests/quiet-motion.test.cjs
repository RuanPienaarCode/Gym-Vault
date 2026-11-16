'use strict';
/* CALM MOTION (16 Nov 2026). For someone who finds the gym's movement
   distracting: one setting stops confetti, every looping pulse/flicker/marquee
   and the exercise-image animation, without asking the OS for reduced motion.

   It reuses the hand-tuned reduced-motion rules rather than a blanket
   `animation: none` (some celebrations fade content IN; killing them blindly
   could leave it invisible):
     Q1  quietMotionOn: off by default, on for true / 'true' only
     Q2  exercise images and the muscle map stay still (autoPlayMedia false)
     Q3  confetti inside a quiet root is a no-op and touches nothing
     Q4  EVERY rule in a prefers-reduced-motion block has a twin scoped to
         .gv-quiet-motion with the same declarations (a new reduced-motion
         rule without its twin fails here, by selector)
     Q5  the app root and all three gym modals wear the class when it is on
   GV_STYLES_CSS points the CSS half at a broken copy (mutation testing). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { QUIET_CLASS, quietMotionOn, quietTwin } = require('../src/quiet-motion');
const { autoPlayMedia } = require('../src/media-cycle');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

check('Q1 off by default, on only for true', () => {
  assert.strictEqual(QUIET_CLASS, 'gv-quiet-motion');
  for (const v of [undefined, null, false, 'false', 0, 'yes']) assert.strictEqual(quietMotionOn({ quietMotion: v }), false, String(v));
  assert.strictEqual(quietMotionOn(null), false);
  assert.strictEqual(quietMotionOn({ quietMotion: true }), true);
  assert.strictEqual(quietMotionOn({ quietMotion: 'true' }), true);
});

check('Q2 calm motion keeps exercise images still', () => {
  assert.strictEqual(autoPlayMedia({ animateMedia: true, quietMotion: true }, false), false);
  assert.strictEqual(autoPlayMedia({ animateMedia: true }, false), true);
});

check('Q3 confetti inside a quiet root does nothing', () => {
  let touched = 0;
  const doc = { createElement() { touched++; return {}; } };
  global.window = { matchMedia: () => ({ matches: false }), requestAnimationFrame() { touched++; } };
  global.document = doc;
  const { burst } = require('../src/confetti');
  const host = { ownerDocument: { defaultView: global.window, createElement() { touched++; return { getContext: () => null, style: {} }; } },
    closest: sel => (sel === '.' + QUIET_CLASS ? {} : null), appendChild() { touched++; }, append() { touched++; } };
  const stop = burst(host);
  assert.strictEqual(typeof stop, 'function');
  stop();
  assert.strictEqual(touched, 0, 'burst touched the DOM inside a quiet root');
  delete global.window; delete global.document;
});

/* ---- Q4: the CSS twins ---- */
const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const norm = d => d.split(';').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean).sort().join('; ');
const rulesIn = text => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ sels: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean), decl: norm(m[2]) });
  return out;
};
const reduced = [];
const mq = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
let mm;
while ((mm = mq.exec(css))) {
  let depth = 1, i = mq.lastIndex;
  for (; i < css.length && depth; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
  reduced.push(...rulesIn(css.slice(mq.lastIndex, i - 1)));
}
const top = new Map();
{
  /* top-level rules only: blank out every @media block first */
  let flat = css, at;
  while ((at = flat.search(/@media[^{]*\{/)) >= 0) {
    let depth = 0, i = flat.indexOf('{', at);
    for (; i < flat.length; i++) { if (flat[i] === '{') depth++; else if (flat[i] === '}' && !--depth) break; }
    flat = flat.slice(0, at) + flat.slice(i + 1);
  }
  for (const r of rulesIn(flat)) for (const s of r.sels) top.set(s, (top.get(s) ? top.get(s) + '; ' : '') + r.decl);
}

check('Q4 every reduced-motion rule has a .gv-quiet-motion twin with the same declarations', () => {
  assert.ok(reduced.length >= 15, `expected the reduced-motion rules, found ${reduced.length}`);
  /* A selector can sit in more than one reduced-motion rule: compare the merged sets. */
  const want = new Map();
  for (const r of reduced) for (const s of r.sels) { const t = quietTwin(s); want.set(t, (want.get(t) ? want.get(t) + '; ' : '') + r.decl); }
  const missing = [];
  for (const [twin, decl] of want) {
    const got = top.get(twin);
    if (!got || norm(got) !== norm(decl)) missing.push(`${twin} { ${norm(decl)} }${got ? ' (has: ' + norm(got) + ')' : ''}`);
  }
  assert.ok(!missing.length, `${missing.length} twin(s) missing or different: ${missing.slice(0, 3).join(' || ')}`);
});

check('Q4 twins are scoped: the class sits on .gv-app itself, or above a non-app selector', () => {
  assert.strictEqual(quietTwin('.gv-app.gv-skin-apex .x'), '.gv-app.gv-skin-apex.gv-quiet-motion .x');
  assert.strictEqual(quietTwin('.theme-dark .gv-app.gv-skin-apex .x::after'), '.theme-dark .gv-app.gv-skin-apex.gv-quiet-motion .x::after');
  assert.strictEqual(quietTwin('.gv-app .gv-voice-rec.live::after'), '.gv-app.gv-quiet-motion .gv-voice-rec.live::after');
  assert.strictEqual(quietTwin('.gv-streak-svg.lit'), '.gv-quiet-motion .gv-streak-svg.lit');
});

check('Q5 the app root and the three gym modals wear the class', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const ctl = read('controller.js');
  const sync = ctl.slice(ctl.indexOf('const syncChrome'), ctl.indexOf('syncChrome();'));
  assert.match(sync, /QUIET_CLASS/, 'syncChrome must toggle the quiet class');
  for (const f of ['rep-counter-modal.js', 'challenge-modal.js', 'media-viewer.js']) assert.match(read(f), /quietMotionOn\(/, `${f} must add the quiet class`);
});

if (failed) { console.error(`quiet-motion: ${failed} failed`); process.exit(1); }
