'use strict';
/* THE TICKER DOES NOT MAKE TODAY SCROLL SIDEWAYS (0.14.0).

   The ticker is a lime / black strip rotated 1.5-2 degrees across the full width of the page. A rotated rectangle's
   corners swing outside its own box by (height / 2) x sin(angle): about half a pixel at each end. That overshoot is
   scrollable overflow, so on a 390px phone Today could be dragged a pixel sideways ("scrollWidth 391, clientWidth 390").

   The cause is the rotation reaching past the page, so the fix is a CLIP that sits around the rotation:
     .gv-ticker       the WRAPPER: not rotated, full bleed (the strip's old box), overflow: hidden, so nothing the
                      rotation does can reach the page. It carries a little vertical padding (a percentage of the
                      width, because the strip's far ends swing up and down by (width / 2) x sin(angle)), cancelled
                      by the same amount of negative margin so the strip lands exactly where it always did.
     .gv-ticker-band  the strip itself: background, ink, the rotation, the marquee track.
   It is NOT put on the page, the Today column or the hero: those would clip the hero's own overflow-visible needs (the
   starburst, the hexagon's triangles) and, as scroll containers, would take the sticky Start slab away from the page.

   What can go wrong silently, and what this pins (the CSS half runs the real cascade):
     1  THE ROTATION IS ON THE BAND, never on the wrapper (a rotated wrapper is the original bug again);
     2  THE WRAPPER CLIPS (overflow hidden, not `clip`, which iOS 15 does not know) and the band bleeds by nothing itself;
     3  THE PADDING COVERS THE SWING: percent >= 100 x sin(angle) / 2 for a pane as narrow as 200px, or the far ends
        of the strip would be cut off;
     4  THE LAYOUT IS UNCHANGED: the margins give back exactly what the padding takes, in the narrow (flex) layout, where
        margins add up, AND the wide (block) layout, where the strip's 8px collapses into the Rx list's 10px;
     5  THE MARKUP IS WRAPPER > BAND > TRACK, and Floor and Editorial still draw none of it.
   The pixels are checked in a browser (every skin x theme x width: scrollWidth <= clientWidth, and the screenshots equal). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const root = path.join(__dirname, '..');
/* the engine refuses a sibling combinator; no rule that styles the ticker uses one, so those rules are left out of this probe */
const rules = cx.load().filter(r => !/\s[+~]\s/.test(r.selector));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const HERO = ['div.gv-today', 'div.gv-hero.gv-hero-today'];
const val = (chain, prop) => { const c = cx.computed(chain, prop, rules); return c ? c.value.trim() : null; };
const winner = (chain, props) => { const h = cx.declarationsFor(chain, props, rules)[0]; return h ? { prop: h.decl.prop, value: h.decl.value.trim(), line: h.rule.line } : null; };
const MIN_PANE = 200, GUTTER = 18;

for (const skin of ['apex', 'lockin']) for (const narrow of [true, false]) {
  const o = { theme: 'light', skin, accent: 'lime', narrow };
  const where = `${skin}${narrow ? ' (narrow)' : ' (wide)'}`;
  const wrap = cx.appChain(o, ...HERO, 'div.gv-ticker');
  const band = cx.appChain(o, ...HERO, 'div.gv-ticker', 'div.gv-ticker-band');

  /* 1 */
  eq(val(wrap, 'transform'), null, `${where}: the wrapper is never rotated`);
  const rot = /^rotate\((-?\d+(?:\.\d+)?)deg\)$/.exec(val(band, 'transform') || '');
  ok(rot, `${where}: the band carries the rotation (saw ${val(band, 'transform')})`);
  const angle = Math.abs(Number(rot[1]));
  ok(angle > 0 && angle < 5, `${where}: a gentle angle`);

  /* 2 */
  eq(val(wrap, 'overflow'), 'hidden', `${where}: the wrapper clips what the rotation swings out (overflow: hidden, never clip)`);
  eq(val(band, 'overflow'), 'hidden', `${where}: and the band still clips the marquee track`);
  eq(val(wrap, 'display'), 'block', `${where}: the wrapper is shown`);
  eq(val(wrap, 'position'), 'relative', `${where}: and stacks above the head (it was the strip's own stacking context)`);
  eq(val(band, 'margin'), null, `${where}: the band does not bleed by itself (the wrapper does)`);

  /* 3 */
  const padDecl = val(wrap, '--gv-ticker-pad');
  const pad = /^(\d+(?:\.\d+)?)%$/.exec(padDecl || '');
  ok(pad, `${where}: the clip's vertical room is a percentage of the width (saw ${padDecl})`);
  const need = 100 * Math.sin(angle * Math.PI / 180) / 2 * (1 + 2 * GUTTER / MIN_PANE);
  ok(Number(pad[1]) >= need, `${where}: ${pad[1]}% of the width is room for the strip's ends to swing ${need.toFixed(2)}% (at a ${MIN_PANE}px pane)`);
  eq(val(wrap, 'padding'), 'var(--gv-ticker-pad) 0', `${where}: the wrapper pads top and bottom by exactly that`);
  eq(val(wrap, 'pointer-events'), 'none', `${where}: the room is not a touch target (it sits over the head and the list)`);
  eq(val(band, 'pointer-events'), 'auto', `${where}: the strip is, as it always was`);

  /* 4 */
  const top = winner(wrap, ['margin', 'margin-top']), bottom = winner(wrap, ['margin', 'margin-bottom']);
  eq(top && [top.prop, top.value], ['margin-top', 'calc(-22px - var(--gv-ticker-pad))'], `${where}: the top margin gives back the padding on top of the strip's -22px overlap`);
  eq(bottom && [bottom.prop, bottom.value], ['margin-bottom', narrow ? 'calc(8px - var(--gv-ticker-pad))' : 'calc(-1 * var(--gv-ticker-pad))'],
    `${where}: the bottom margin gives back the padding${narrow ? ' (flex: the 8px is its own)' : ' (block: the 8px collapses into the list\'s 10px)'}`);
}

/* the wrapper is the only element in the hero with the strip's full-bleed horizontal margins */
for (const skin of ['apex', 'lockin']) {
  const m = winner(cx.appChain({ theme: 'light', skin, accent: 'lime' }, ...HERO, 'div.gv-ticker'), ['margin']);
  ok(m && /^16px calc\(-1 \* var\(--gv-page-gutter\)\) \d+px$/.test(m.value), `${skin}: the wrapper bleeds by the page's real gutter (saw ${m && m.value})`);
}

/* 5 */
for (const skin of ['floor', 'editorial']) {
  eq(val(cx.appChain({ theme: 'light', skin, accent: 'lime' }, ...HERO, 'div.gv-ticker'), 'display'), 'none', `${skin}: draws no ticker`);
}
{
  const js = fs.readFileSync(path.join(root, 'src', 'page-dashboard.js'), 'utf8');
  const fn = /function ticker\(\) \{[\s\S]*?\n\}/.exec(js);
  ok(fn, 'the ticker builder is in page-dashboard.js');
  ok(/class: 'gv-ticker', 'aria-hidden': 'true' \},\s*el\('div', \{ class: 'gv-ticker-band' \},\s*el\('div', \{\}, /.test(fn[0]), 'the markup is wrapper > band > track');
}
/* nothing else in the stylesheet re-introduces `overflow: clip` (Safari 16+) or a rotation on the wrapper */
{
  const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(root, 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/overflow(-x|-y)?\s*:\s*clip/.test(css), 'no overflow: clip anywhere (not valid before Safari 16)');
  ok(!/\.gv-ticker\s*\{[^}]*transform\s*:/.test(css), 'no rule puts a transform on the .gv-ticker wrapper itself');
}

console.log(`ticker clip OK (${n} checks: the rotation is on the band, the wrapper clips, its padding covers the swing and its margins give it back in the flex and the block layout)`);
