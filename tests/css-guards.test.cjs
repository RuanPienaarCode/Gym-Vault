'use strict';
/* Structural guards on the stylesheet — the bugs that don't show on a
   desktop pane and only surface on a phone.

   GUARD 1: icons are <span class="gv-ico"> (see dom.js `ico()`), so ANY
   `display: none` on a rule whose selector ends in a bare `span` element
   hides iconography along with whatever it meant to hide. This shipped once:
   `.gv-app.gv-narrow .gv-nav-btn span { display: none }` blanked the whole
   nav bar on a phone, leaving only the active button's black block.
   Hide a CLASS you control instead. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

/* Strip comments so commented-out examples (like the one above) don't trip it. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

const offenders = [];
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = ruleRe.exec(bare))) {
  const decls = m[2];
  if (!/display\s*:\s*none/.test(decls)) continue;
  for (const sel of m[1].split(',')) {
    const s = sel.trim();
    if (!s) continue;
    // selector ends in a bare element `span` (not `.gv-nav-label`, not `.x span.y`)
    if (/(^|[\s>+~])span$/.test(s)) offenders.push(s);
  }
}
assert.deepStrictEqual(
  offenders, [],
  `display:none on a bare \`span\` also hides .gv-ico icons — target a class instead: ${offenders.join(', ')}`,
);

/* GUARD 2: the narrow-pane nav must hide the label and KEEP the icon. */
assert.ok(
  /\.gv-narrow[^{]*\.gv-nav-label\s*\{[^}]*display:\s*none/.test(bare),
  'narrow mode must hide .gv-nav-label (the label span), not the whole button contents',
);
assert.ok(
  !/\.gv-narrow[^{]*\.gv-ico\s*\{[^}]*display:\s*none/.test(bare),
  'narrow mode must never hide .gv-ico',
);

console.log('css guards OK (no bare-span display:none; narrow nav keeps its icons)');
