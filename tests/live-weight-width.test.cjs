'use strict';
/* THE LIVE SET'S WEIGHT FIGURE IS WIDE ENOUGH FOR "102.25" (iOS-safety review, 0.14.0).

   The weight input is 46px italic Barlow Condensed in a box of `width: 4.2ch`. Measured in the browser
   harness (Chromium, real stylesheet, real embedded font): 1ch = 20.47px at that size, so the box is
   85.97px; "102.5" is 86.1px wide (it only just fails) and "102.25" / "1002.5" are 106.8 / 106.6px
   (5.22ch) and overflow the box by 21px, clipping the figure being typed. The fix is a `min-width`
   of 5.4ch on both bottom-of-screen skins (Apex, Lock In - the only skins with this stepper).

   Named cases:
     X1  the effective width (the larger of width and min-width) is at least 5.3ch on both skins and both themes
     X2  the box is not wider than 6.2ch, so the minus / plus buttons still fit on a 320px phone
     X3  the figure's size is still the one measured (46px): change it and the width needs measuring again */
const assert = require('node:assert');
const cx = require('./css-cascade.js');
const { makeRunner } = require('./gym-fake-vault');
const rules = cx.load();
const { check, run } = makeRunner();

const ch = v => { const m = /^(\d+(?:\.\d+)?)ch$/.exec(String(v || '').trim()); return m ? Number(m[1]) : null; };
const chain = (theme, skin) => cx.appChain({ theme, skin, narrow: true }, 'div.gv-session-page', 'div.gv-live-weight', 'div.gv-live-weightval', 'input.gv-session-weight');

check('X1 the effective width is at least 5.3ch on both skins and both themes', () => {
  for (const theme of ['light', 'dark']) for (const skin of ['apex', 'lockin']) {
    const w = cx.declarationsFor(chain(theme, skin), ['width'], rules)[0];
    const min = cx.declarationsFor(chain(theme, skin), ['min-width'], rules)[0];
    const eff = Math.max(ch(w && w.decl.value) || 0, ch(min && min.decl.value) || 0);
    assert.ok(eff >= 5.3, `${theme}/${skin}: the weight input is ${eff}ch wide (width ${w && w.decl.value}, min-width ${min && min.decl.value}); "102.25" needs 5.22ch`);
  }
});

check('X2 not wider than 6.2ch (the stepper must still fit a 320px phone)', () => {
  for (const skin of ['apex', 'lockin']) {
    const w = cx.declarationsFor(chain('light', skin), ['width'], rules)[0];
    const min = cx.declarationsFor(chain('light', skin), ['min-width'], rules)[0];
    const eff = Math.max(ch(w && w.decl.value) || 0, ch(min && min.decl.value) || 0);
    assert.ok(eff <= 6.2, `${skin}: ${eff}ch`);
  }
});

check('X3 the figure is still 46px, the size the width was measured at', () => {
  for (const skin of ['apex', 'lockin']) {
    const f = cx.declarationsFor(chain('light', skin), ['font-size'], rules)[0];
    assert.strictEqual(f && f.decl.value, '46px', `${skin}: the weight figure's size changed; measure "102.25" again and update this guard`);
  }
});

run('live-weight-width');
