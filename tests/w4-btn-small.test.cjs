'use strict';
/* W4-6 / L5-13 (usability fix wave 2, 20 Oct 2026): A SMALL BUTTON IS SMALL ON FLOOR AND EDITORIAL.

   `.gv-btn-small { padding: 7px 11px }` is (0,1,0); the base `.gv-app .gv-btn { padding: 10px 16px }`
   is (0,2,0) (it needs .gv-app to beat the host's button chrome), so on Floor and Editorial the
   "small" button computed 10px 16px - the same size as the full one. Apex and Lock In were fine:
   their own rule is (0,4,0). The small modifier now carries .gv-app too. The cascade is run for
   every skin and both themes, on a plain .gv-btn, a ghost one and the counter bar's. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));
const vertical = v => { const t = String(v).trim().split(/\s+/).map(parseFloat); return t.length === 1 ? t[0] : t[0]; };

for (const skin of ['apex', 'lockin', 'floor', 'editorial']) {
  for (const theme of ['light', 'dark']) {
    for (const cls of ['gv-btn.gv-btn-small', 'gv-btn.gv-btn-ghost.gv-btn-small']) {
      check(`${skin}/${theme}: button.${cls} is smaller than a full button`, () => {
        const small = cx.computed(cx.appChain({ theme, skin }, `button.${cls}`), 'padding', rules);
        const full = cx.computed(cx.appChain({ theme, skin }, 'button.gv-btn'), 'padding', rules);
        assert.ok(small && full, 'both resolve a padding');
        assert.ok(vertical(small.value) < vertical(full.value),
          `the small button's padding is "${small.value}" (from ${small.rule.selector}) and the full one's is "${full.value}": the small modifier lost the cascade`);
      });
    }
  }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-btn-small OK');
