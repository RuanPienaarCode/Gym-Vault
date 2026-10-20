'use strict';
/* NEW (usability fix wave 20 Oct 2026): TODAY MUST NOT SCROLL SIDEWAYS ON A PHONE.

   Apex and Lock In put a slow pulse behind the Start slab (`.gv-btn-go::after`,
   gv-apex-pulse / gv-li-pulse). The pulse is the slab's own box, leaning and
   growing; at the end of its cycle it was scale(1.06, 1.4) of a 369px slab that sits
   12px from the page edge, and `.gv-hero-action` is overflow:visible, so the
   page's scrollWidth ran 7-9px past its clientWidth for part of every 1.9s cycle: the
   whole Today page wobbled sideways under a thumb.

   The pulse keeps growing UPWARD and DOWNWARD (that is the pulse) but not
   sideways, and its lean is budgeted: skewX shifts a box's top and bottom edges by
   tan(angle) x height/2, which must fit the narrowest gutter (12px) with room to
   spare. Pinned from the keyframes themselves, so a new pulse cannot reintroduce
   it. The runtime check (scrollWidth - clientWidth sampled across the whole cycle,
   six phone sizes, both skins) is the harness's. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const GUTTER = 12;          // the narrowest page gutter (.gv-app.gv-narrow)
const SLAB_H = 62;          // .gv-live-tick / the Start slab's min-height ceiling used here
for (const name of ['gv-apex-pulse', 'gv-li-pulse']) {
  check(`${name}: the pulse never grows wider than its slab and its lean fits the gutter`, () => {
    const m = new RegExp('@keyframes\\s+' + name + '\\s*\\{([\\s\\S]*?\\n\\})').exec(css);
    assert.ok(m, `@keyframes ${name} exists`);
    const frames = [...m[1].matchAll(/(\d+%|from|to)\s*\{([^}]*)\}/g)];
    assert.ok(frames.length >= 2, `${name} has frames`);
    for (const f of frames) {
      const t = /transform\s*:\s*([^;]+)/.exec(f[2]);
      if (!t) continue;
      const sk = /skewX\(\s*(-?[\d.]+)deg\s*\)/.exec(t[1]);
      const sc = /scale\(\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(t[1]);
      const sx = sc ? Number(sc[1]) : 1;
      const sy = sc ? Number(sc[2] !== undefined ? sc[2] : sc[1]) : 1;
      assert.ok(sx <= 1, `${name} ${f[1]}: scaleX ${sx} makes the pulse wider than the slab, which sits ${GUTTER}px from the page edge and overflowed it by 7-9px`);
      const shear = sk ? Math.tan(Math.abs(Number(sk[1])) * Math.PI / 180) * (SLAB_H * sy) / 2 : 0;
      assert.ok(shear <= GUTTER - 2, `${name} ${f[1]}: the lean shifts the pulse's corners ${shear.toFixed(1)}px, past the ${GUTTER}px gutter`);
    }
  });
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-pulse-overflow OK');
