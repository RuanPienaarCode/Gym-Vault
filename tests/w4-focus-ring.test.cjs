'use strict';
/* W4-7 / L5-09 (usability fix wave 2, 20 Oct 2026): A KEYBOARD USER CAN SEE WHERE THEY ARE.

   The plugin sets `box-shadow: none` on its buttons (to escape the host's chrome) and the host's own
   focus ring IS a box-shadow, so tabbing through the app showed nothing: no focus-visible rule
   existed anywhere in the stylesheet. There is now an OUTLINE ring (outline is untouched by the
   box-shadow reset) in the accent's own token on every button, role=button card, switch and link:
   --gv-lime-deep on paper, --gv-lime on the dark theme, so each accent has its own ring.

   iOS: `:focus-visible` is invalid before Safari 15.4, and ONE unknown pseudo-class invalidates
   the whole rule list it sits in. So it lives only inside `@supports selector(:focus-visible)`
   (which 15.0-15.3 evaluate false: they skip the block), and those engines get the plain
   `:focus` ring from `@supports not selector(:focus-visible)` (a button does not take focus from
   a tap on iOS, so it shows for the keyboard and switch control only).

   Read from the stylesheet text, plus the ring's contrast against the page and the card in every
   skin, theme and accent (3:1, the non-text threshold). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const file = process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css');
const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

/* [open, close] offsets of every top-level @supports block with its prelude. */
const supports = [];
for (const m of css.matchAll(/@supports\s+([^{]+)\{/g)) {
  let depth = 0, i = m.index + m[0].length - 1;
  for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
  supports.push({ prelude: m[1].trim(), from: m.index, open: m.index + m[0].length, to: i });
}
/* An occurrence in an @supports PRELUDE is the feature query itself, not a rule. */
const inPrelude = off => supports.some(s => s.from < off && off < s.open);
const inside = (off, wanted) => supports.some(s => s.open <= off && off < s.to && wanted.test(s.prelude));

check('there is a :focus-visible ring in the stylesheet', () => {
  assert.ok(/:focus-visible/.test(css), 'no :focus-visible rule: a keyboard user gets no focus indicator (the host\'s is a box-shadow, which this file resets to none)');
});
check('every :focus-visible sits inside @supports selector(:focus-visible) (iOS 15.0-15.3 would drop the whole rule list)', () => {
  const bad = [];
  for (const m of css.matchAll(/:focus-visible/g)) if (!inPrelude(m.index) && !inside(m.index, /^selector\(\s*:focus-visible\s*\)$/)) bad.push(css.slice(0, m.index).split('\n').length);
  assert.deepStrictEqual(bad, [], `:focus-visible outside the @supports guard at line(s) ${bad.join(', ')}`);
});
check('engines without :focus-visible get a :focus ring from @supports not selector(:focus-visible)', () => {
  const blocks = supports.filter(s => /^not\s+selector\(\s*:focus-visible\s*\)$/.test(s.prelude));
  assert.ok(blocks.length === 1, `expected one @supports not selector(:focus-visible) block, found ${blocks.length}`);
  const body = css.slice(blocks[0].from, blocks[0].to);
  assert.ok(/button:focus\b[^{]*\{[^}]*outline:/.test(body), 'the fallback gives buttons no outline');
});
check('the ring is an outline on button, role=button, role=switch and link, not a box-shadow', () => {
  const m = /@supports\s+selector\(\s*:focus-visible\s*\)\s*\{([\s\S]*?\n\})/.exec(css);
  assert.ok(m, 'no @supports selector(:focus-visible) block');
  for (const sel of ['.gv-app button:focus-visible', ".gv-app [role='button']:focus-visible", ".gv-app [role='switch']:focus-visible", '.gv-app a:focus-visible']) {
    assert.ok(m[1].includes(sel), `the ring does not reach ${sel}`);
  }
  assert.ok(/outline:\s*2px solid var\(--gv-lime-deep\)/.test(m[1]), 'the ring is a 2px outline in --gv-lime-deep');
  assert.ok(/\.theme-dark \.gv-app button:focus-visible[\s\S]*?outline-color:\s*var\(--gv-lime\)/.test(m[1]), 'the dark theme ring is --gv-lime');
  assert.ok(!/box-shadow/.test(m[1]), 'the ring must not be a box-shadow');
});

const rules = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));
for (const skin of ['apex', 'lockin', 'floor', 'editorial']) {
  for (const theme of ['light', 'dark']) {
    for (const accent of ['lime', 'volt', 'blaze', 'electric', 'punch']) {
      check(`${skin}/${theme}/${accent}: the ring holds 3:1 on the page and on a card`, () => {
        const chain = cx.appChain({ theme, skin, accent }, 'div.gv-card');
        const tok = theme === 'dark' ? '--gv-lime' : '--gv-lime-deep';
        const ring = cx.parseColor(cx.resolveVars(chain, `var(${tok})`, rules));
        for (const surface of ['--gv-bg', '--gv-surface']) {
          const bg = cx.parseColor(cx.resolveVars(chain, `var(${surface})`, rules));
          const r = cx.ratio(ring, bg);
          assert.ok(r >= 3, `ring ${cx.hex(ring)} on ${surface} ${cx.hex(bg)} is ${r.toFixed(2)}:1`);
        }
      });
    }
  }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-focus-ring OK');
