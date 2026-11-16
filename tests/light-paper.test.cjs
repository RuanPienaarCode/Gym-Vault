'use strict';
/* NO WHITE PAPER IN LIGHT MODE (16 Nov 2026, Ruan: "never use white bg, make
   it a light background with colour that matches the design").

   Runs the real cascade (tests/css-cascade.js) for every style x accent in the
   light theme and reads the colour actually painted behind text on the page
   and inside a card. Each must be:
     P1  not near-white (relative luminance under 0.90; #fff is 1.0), and
     P2  a colour, not a grey (RGB channels at least 8 apart), and
     P3  Obsidian's --background-primary resolves to the same paper (see below).
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

/* P3 OBSIDIAN'S OWN PAPER. The view container (.view-content, which IS the
   .gv-app root) is painted by Obsidian with var(--background-primary), white
   in light mode. Each style must point that variable at its own paper, or the
   page shows white around the tinted cards (16 Nov 2026: Calm did exactly
   that on a real phone while P1/P2 passed). */
for (const skin of SKINS) for (const accent of ACCENTS) {
  const chain = cx.appChain({ theme: 'light', skin, accent }, 'p.gv-kicker');
  const host = cx.computed(chain, '--background-primary', rules);
  const ours = cx.computed(chain, '--gv-bg', rules);
  const val = host && cx.resolveVars(chain, host.value, rules);
  const want = ours && cx.resolveVars(chain, ours.value, rules);
  if (!host || String(val).trim() !== String(want).trim()) bad.push(`P3 ${skin}/${accent} --background-primary is ${host ? val : 'unset (Obsidian white)'}, not the page ${want}`);
}

/* P4 HIGHLIGHTS ARE TINTS TOO. --gv-lime-ghost backs the active tab, a PB-in-reach row, a
   done day. Near-white, it reads as a white patch on the tinted paper (it did, on Calm's Today
   tab and Pull-ups row). Checked where it is painted: the PB-in-reach row on Today. */
for (const skin of SKINS) for (const accent of ACCENTS) {
  const chain = cx.appChain({ theme: 'light', skin, accent }, 'p.gv-kicker');
  const g = cx.computed(chain, '--gv-lime-ghost', rules);
  const v = g && cx.resolveVars(chain, g.value, rules);
  const c = v && cx.parseColor(String(v));
  if (c && c.a >= 0.5 && lum(c) >= 0.9) bad.push(`P4 ${skin}/${accent} highlight tint ${v} is near-white`);
}

if (bad.length) {
  console.error(`light-paper: ${bad.length} failed\n  ` + bad.join('\n  '));
  process.exit(1);
}
console.log(`light-paper OK (${SKINS.length * ACCENTS.length * 2} spots)`);
assert.ok(true);
