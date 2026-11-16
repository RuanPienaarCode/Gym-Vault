'use strict';
/* NO WHITE PAPER IN LIGHT MODE (16 Nov 2026, Ruan: "never use white bg, make
   it a light background with colour that matches the design").

   Runs the real cascade (tests/css-cascade.js) for every style x accent in the
   light theme and reads the colour actually painted behind text on the page
   and inside a card. Each must be:
     P1  not near-white (relative luminance under 0.90; #fff is 1.0), and
     P2  a colour, not a grey (RGB channels at least 8 apart).
   Readability on the new papers is contrast.test.cjs's job; it probes the same
   cascade. GV_STYLES_CSS points at a broken copy for mutation testing. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

const rules = cx.load(process.env.GV_STYLES_CSS);
/* luminance via the helper's own ratio: lum = ratio(c, black) * 0.05 - 0.05 */
const lum = c => cx.ratio(c, { r: 0, g: 0, b: 0, a: 1 }) * 0.05 - 0.05;
const SKINS = ['floor', 'editorial', 'apex', 'lockin', 'calm'];
const ACCENTS = ['lime', 'volt', 'blaze', 'electric', 'punch', 'olive'];
const SPOTS = {
  page: ['p.gv-kicker'],
  card: ['div.gv-card', 'div.gv-tile-label'],
};

const bad = [];
for (const skin of SKINS) for (const accent of ACCENTS) for (const [spot, chain] of Object.entries(SPOTS)) {
  const t = cx.textColor(cx.appChain({ theme: 'light', skin, accent }, ...chain), rules);
  const c = t.bg;
  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  const l = lum(c);
  if (l >= 0.90) bad.push(`P1 ${skin}/${accent} ${spot} ${cx.hex(c)} is near-white (lum ${l.toFixed(3)})`);
  else if (spread < 8) bad.push(`P2 ${skin}/${accent} ${spot} ${cx.hex(c)} is grey, not a colour`);
}

if (bad.length) {
  console.error(`light-paper: ${bad.length} failed\n  ` + bad.join('\n  '));
  process.exit(1);
}
console.log(`light-paper OK (${SKINS.length * ACCENTS.length * 2} spots)`);
assert.ok(true);
