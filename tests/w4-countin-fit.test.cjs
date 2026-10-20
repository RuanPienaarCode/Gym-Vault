'use strict';
/* W4-3 (usability fix wave 2, 20 Oct 2026): THE 5-4-3 COUNT-IN FITS ITS ZONE AT A SHORT PANE.

   The count-in stacks the hollow digit (or, with "Type the count", the number box), the
   "Counting you in" label, "Tap to start now" and the exercise's unit ("Reps") in the one live
   zone. The digit was sized for a bare count, so on Apex and Lock In the stack was taller than
   the zone: 5px at 393x852, up to 22px at 393x812 and 16px at 375x667, and "Reps" hung out of
   the bottom edge under the sheet (found in wave 1, left as a caveat).

   A stylesheet guard cannot lay anything out, so this one does the arithmetic the browser does
   for each tier's smallest zone and pins the stack under it:
     gv-short   zone >= 100px (a 681px pane: 122px measured at 701px, one px per px)
                at a 791px-tall window, the shortest that is not gv-shorter
     gv-shorter zone floor 84px, at 375x667 (the iPhone SE the compaction is written for)
   The number box is ~1.25x its type (measured: 71px for a 57px digit); the digit's own line
   box is 0.9x, so 1.25x is the larger and the one budgeted.
   Runtime numbers live in the commit message (worst overflow 22px -> 0). */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
/* The cascade engine refuses sibling combinators (it would rather throw than skip a rule that might
   match). None of the few that exist (the week header) can reach the live zone, and the properties
   probed here (margin-top) are ones they declare, so they are dropped up front. */
const rules = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));

/* min(30vw, 72px, calc(80vh - 585px)) at a window, in px. Only the shapes this file uses. */
const px = (value, vw, vh) => {
  const v = String(value).trim();
  let m = /^min\((.+)\)$/.exec(v);
  if (m) return Math.min(...m[1].split(',').map(x => px(x, vw, vh)));
  m = /^calc\(\s*(-?[\d.]+)(vh|vw)\s*-\s*([\d.]+)px\s*\)$/.exec(v);
  if (m) return Number(m[1]) * (m[2] === 'vw' ? vw : vh) / 100 - Number(m[3]);
  m = /^(-?[\d.]+)(px|vw|vh)$/.exec(v);
  if (!m) throw new Error(`cannot read "${value}" as px/vw/vh`);
  return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * (m[2] === 'vw' ? vw : vh) / 100;
};

const TIERS = [
  { tier: 'gv-short', classes: ['gv-short'], vw: 360, vh: 791, zone: 100 },
  { tier: 'gv-shorter', classes: ['gv-short', 'gv-shorter'], vw: 375, vh: 667, zone: 84 },
];
for (const skin of ['apex', 'lockin']) {
  for (const t of TIERS) {
    for (const theme of ['light', 'dark']) {
      check(`${skin}/${theme}/${t.tier}: digit + label + hint + unit stack fits a ${t.zone}px zone`, () => {
        const root = `div.view-content.gv-app.gv-skin-${skin}.gv-accent-lime${t.classes.map(c => '.' + c).join('')}`;
        const zone = 'div.gv-rc-zone.gv-session-zone.gv-live-zone';
        const at = leaf => cx.chainOf([`body.theme-${theme}`, root, 'div.gv-session-page', zone, leaf]);
        const get = (leaf, prop) => { const c = cx.computed(at(leaf), prop, rules); return c ? c.value : null; };
        const fs = px(get('div.gv-rc-count.gv-session-count.gv-rc-countin', 'font-size'), t.vw, t.vh);
        const label = get('div.gv-rc-countin-label', 'display') === 'none' ? 0 : 2 + 1.5 * 10.5;
        /* A line with no px line-height is `normal`, which the measured faces make 1.5x the type (hint 12px -> 18px, unit 20px -> 30px). */
        const line = leaf => { const lh = get(leaf, 'line-height'); return lh ? parseFloat(lh) : 1.5 * parseFloat(get(leaf, 'font-size')); };
        const hint = parseFloat(get('div.gv-rc-hint', 'margin-top')) + line('div.gv-rc-hint');
        const unit = parseFloat(get('div.gv-rc-target', 'margin-top')) + line('div.gv-rc-target');
        const stack = 1.25 * fs + label + hint + unit;
        assert.ok(stack <= t.zone, `the count-in stack is ${stack.toFixed(1)}px (digit box ${(1.25 * fs).toFixed(1)} from ${fs.toFixed(1)}px type + label ${label} + hint ${hint} + unit ${unit}) in a ${t.zone}px zone: "Reps" hangs out of the bottom`);
      });
    }
  }
}

check('the live count after GO is not shrunk by the count-in rules', () => {
  const root = 'div.view-content.gv-app.gv-skin-apex.gv-accent-lime.gv-short.gv-shorter';
  const c = cx.chainOf(['body.theme-light', root, 'div.gv-live-zone', 'div.gv-rc-count.gv-session-count']);
  const v = cx.computed(c, 'font-size', rules).value;
  assert.ok(px(v, 375, 667) > 48, `the counting digit is ${v}: the count-in size leaked onto the live count`);
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-countin-fit OK');
