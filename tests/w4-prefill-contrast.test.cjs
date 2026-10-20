'use strict';
/* W4-5 / L5-11 (usability fix wave 2, 20 Oct 2026): PREFILLED SET VALUES AND UNITS READ AT 4.5:1.

   A prefilled box (the last session's numbers, offered but not yet confirmed) dimmed its value to
   opacity .75 and its unit to .6 over the dim ink token, which on paper measured 2.5-2.9:1 (units)
   and 3.3-3.7:1 (values) in every skin's light theme, 3.2-3.9:1 for units on dark. They are the
   only label next to the box. The cue that the number is unconfirmed is the dim ink itself (the
   confirmed value is --gv-ink), not a fade: the same token, full strength.

   The cascade engine does not model opacity, so it is multiplied in here: every ancestor's
   opacity, then the foreground blended over the painted surface. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
/* Sibling combinators are refused by the engine; none can reach a set row. */
const rules = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));

const PROBES = {
  'log unit': ['div.gv-log-card', 'div.gv-log-set.prefill', 'span.gv-set-unit'],
  'log value': ['div.gv-log-card', 'div.gv-log-set.prefill', 'input.gv-set-input'],
  'timed unit': ['div.gv-session-page', 'div.gv-timed-field.gv-timed-prefill', 'span.gv-set-unit'],
  'timed value': ['div.gv-session-page', 'div.gv-timed-field.gv-timed-prefill', 'input.gv-set-input'],
};
for (const skin of ['apex', 'lockin', 'floor', 'editorial']) {
  for (const theme of ['light', 'dark']) {
    for (const [label, inner] of Object.entries(PROBES)) {
      check(`${skin}/${theme}: prefilled ${label} is 4.5:1`, () => {
        const chain = cx.appChain({ theme, skin }, ...inner);
        let opacity = 1;
        for (let e = chain.length; e >= 1; e--) {
          const hit = cx.declarationsFor(chain.slice(0, e), ['opacity'], rules)[0];
          if (hit) opacity *= parseFloat(hit.decl.value);
        }
        const t = cx.textColor(chain, rules);
        const blend = { r: t.fg.r * opacity + t.bg.r * (1 - opacity), g: t.fg.g * opacity + t.bg.g * (1 - opacity), b: t.fg.b * opacity + t.bg.b * (1 - opacity), a: 1 };
        const r = cx.ratio(blend, t.bg);
        assert.ok(r >= 4.5, `${label} is ${r.toFixed(2)}:1 (${cx.hex(t.fg)} at opacity ${opacity} on ${cx.hex(t.bg)})`);
      });
    }
  }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-prefill-contrast OK');
