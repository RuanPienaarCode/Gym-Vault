'use strict';
/* 0.15.2 acceptance: the count-in fit (W4-3) tightened the "Reps" / "Hold" unit
   and the hint for the 5-4-3 count-in, but its rules matched the live zone at any
   time in a short pane, so once counting began "Reps" stayed shrunk (20px -> 16px)
   and the live digit sat 6px lower on every phone. The zone carries `gv-rc-arming`
   only while the count-in runs; the tighter unit and hint belong to that state. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');
const rules = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));

for (const skin of ['apex', 'lockin']) {
  /* gv-short only: the shortest tier (375x667) keeps the tight unit while counting
     too, because a 20px "Reps" hangs 1px past its zone there (measured). */
  for (const tiers of [['gv-short']]) {
    const root = `div.view-content.gv-app.gv-skin-${skin}.gv-accent-lime${tiers.map(c => '.' + c).join('')}`;
    const at = (zone, leaf) => cx.chainOf(['body.theme-light', root, 'div.gv-session-page', zone, leaf]);
    const val = (zone, leaf, prop) => { const c = cx.computed(at(zone, leaf), prop, rules); return c ? c.value : null; };
    const counting = 'div.gv-rc-zone.gv-session-zone.gv-live-zone';
    const base = cx.chainOf(['body.theme-light', `div.view-content.gv-app.gv-skin-${skin}.gv-accent-lime`, 'div.gv-session-page', counting, 'div.gv-rc-target']);
    const baseSize = cx.computed(base, 'font-size', rules).value;
    assert.strictEqual(val(counting, 'div.gv-rc-target', 'font-size'), baseSize,
      `${skin} ${tiers.join('+')}: once counting, "Reps" keeps its size (${baseSize}), got ${val(counting, 'div.gv-rc-target', 'font-size')}`);
    const arming = counting + '.gv-rc-arming';
    assert.notStrictEqual(val(arming, 'div.gv-rc-target', 'font-size'), baseSize,
      `${skin} ${tiers.join('+')}: during the count-in the unit is still tightened`);
  }
}
console.log('live unit size OK (the count-in tightening applies only while the zone is arming)');
