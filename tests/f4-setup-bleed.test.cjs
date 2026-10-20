'use strict';
/* L4-07 (usability fix wave 20 Oct 2026): FLOOR'S SETUP START FLOOD BLEEDS BY THE
   PAGE GUTTER, NOT THE HERO'S LITERAL -17px.

   `.gv-hero-action { margin: 18px -17px 0 }` is written for the Today hero (1px
   border + 16px padding). The guided-setup Start button is the same class but sits
   directly in the page, whose gutter in a narrow pane is 12px: -17px hung 5px past
   each screen edge and the page scrolled sideways 5px on Floor. The same cure the
   session's Next bar got (.gv-session-nextwrap): bleed by var(--gv-page-gutter). */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load();
const chain = ['body.is-phone', 'div.gv-app.gv-skin-floor.gv-narrow', 'main.gv-page', 'div.gv-hero-action.gv-setup-start'];

check('Floor setup: the Start flood\'s side margins follow the page gutter', () => {
  for (const side of ['margin-left', 'margin-right']) {
    const w = cx.declarationsFor(cx.chainOf(chain), [side, 'margin'], rules)[0];
    assert.ok(w, `${side} resolves`);
    assert.ok(/--gv-page-gutter/.test(w.decl.value), `${side} comes from \`${w.rule.selector} { ${w.decl.prop}: ${w.decl.value} }\`, a literal that overshoots a ${12}px gutter by 5px`);
  }
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-setup-bleed OK');
