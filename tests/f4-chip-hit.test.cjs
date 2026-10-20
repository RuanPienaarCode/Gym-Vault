'use strict';
/* R1-04 (usability fix wave 20 Oct 2026): FLOOR / EDITORIAL FILTER CHIPS ARE
   44px TO A THUMB.

   `.gv-app .gv-chip` is padding 5px 10px of 10.5px type: 24px tall, 13 of them on
   Exercises, Records, Plans, Export and Profile pages. Apex and Lock In already give
   them min-height 44. Floor and Editorial keep the 24px LOOK and get the hit area
   from a transparent ::before - the .gv-planswap pattern - 11px past the chip's padding box above
   and below (the border is the 24px chip's own 1px each side), with 8px of margin each side so that two wrapped rows' touch boxes meet
   (6px gap + 2 x 8px = 22px = 2 x 11px) instead of overlapping: where they overlap
   the later row wins, which would hand the bottom of a visible chip to the chip
   beneath it.

   Scoped to chips on a page (.gv-page): the rep counter's and photo viewer's chips
   live in modals and are already 48px. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load();
const px = v => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v || '').trim()); return m ? Number(m[1]) : null; };
const get = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;

const VISIBLE = 24;   // padding 5+5, border 1+1, 10.5px type: measured 24 in the harness
for (const skin of ['floor', 'editorial']) {
  check(`${skin}: a page chip has a >= 44px touch box that does not overlap the next row's`, () => {
    const pseudo = rules.find(r => r.selector.includes('.gv-skin-' + skin) && r.selector.includes('.gv-chip') && /::?before$/.test(r.selector));
    assert.ok(pseudo, `no \`.gv-app.gv-skin-${skin} .gv-page .gv-chip::before\` rule: the chip is ${VISIBLE}px tall and only ${VISIBLE}px of it takes a tap`);
    assert.strictEqual(get(pseudo, 'position'), 'absolute', 'the touch box is absolutely positioned');
    const up = -px(get(pseudo, 'top')), down = -px(get(pseudo, 'bottom'));
    /* absolute offsets are from the PADDING box: the 1px border either side is the chip's own hit area */
    assert.ok(up + down + VISIBLE - 2 >= 44, `touch box ${up + down + VISIBLE - 2}px < 44px`);
    const chip = rules.find(r => r.selector === `.gv-app.gv-skin-${skin} .gv-page .gv-chip`);
    assert.ok(chip, 'the chip itself is positioned');
    assert.strictEqual(get(chip, 'position'), 'relative');
    const m = get(chip, 'margin') || '';
    const vert = px(m.split(/\s+/)[0]);
    assert.ok(vert !== null && 6 + 2 * vert >= up + down, `two rows' touch boxes (${up}+${down}px) would overlap: the gap between rows is only ${6 + 2 * vert}px`);
  });
}
check('Apex and Lock In chips are untouched (already min-height 44)', () => {
  assert.ok(!rules.some(r => /gv-skin-(apex|lockin)/.test(r.selector) && /\.gv-page \.gv-chip/.test(r.selector)));
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-chip-hit OK');
