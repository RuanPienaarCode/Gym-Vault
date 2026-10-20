'use strict';
/* M-06 (usability fix wave 20 Oct 2026): THE FULL-SCREEN MODALS RESPECT THE SIDE
   SAFE-AREA INSETS IN LANDSCAPE.

   The media viewer and the rep counter are full-screen modals that restate every
   painted property of Obsidian's `.modal`, including `padding: 0`. They already
   pad the TOP bar with env(safe-area-inset-top) and the viewer's controls with the
   bottom inset, but on a landscape iPhone the notch / Dynamic Island sits at the
   left or right (59px on a 15 Pro) and the bar's close button, label and the
   counter's controls ran underneath it. Both modals now pad left and right with
   env(safe-area-inset-left / right), which is 0 everywhere that has no inset. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load();
for (const sel of ['.modal.gv-mv-modal', '.modal.gv-repcounter-modal']) {
  check(`${sel} pads left and right by the safe-area insets`, () => {
    const r = rules.filter(x => x.selector === sel && !x.media);
    assert.ok(r.length >= 1, `${sel} rule exists`);
    const text = r.map(x => x.decls.filter(d => /^padding/.test(d.prop)).map(d => d.prop + ':' + d.value).join(';')).join(';');
    assert.ok(/env\(\s*safe-area-inset-left/.test(text), `${sel} does not pad by env(safe-area-inset-left): the close button and label sit under the notch in landscape (padding: ${text})`);
    assert.ok(/env\(\s*safe-area-inset-right/.test(text), `${sel} does not pad by env(safe-area-inset-right) (padding: ${text})`);
  });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-landscape-insets OK');
