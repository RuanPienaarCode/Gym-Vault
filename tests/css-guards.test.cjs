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

/* GUARD 3: primary touch targets must stay thumb-sized (Apple HIG ~44px).
   The nav shipped at 37px once and had to be reported from a phone. */
{
  const navTouch = bare.match(/\.gv-app\.gv-narrow \.gv-nav-btn\s*\{[^}]*\}/);
  assert.ok(navTouch, 'narrow nav button rule missing');
  const minW = /min-width:\s*(\d+)px/.exec(navTouch[0]);
  const minH = /min-height:\s*(\d+)px/.exec(navTouch[0]);
  assert.ok(minW && Number(minW[1]) >= 44, `narrow nav button min-width must be >= 44px, got ${minW && minW[1]}`);
  assert.ok(minH && Number(minH[1]) >= 44, `narrow nav button min-height must be >= 44px, got ${minH && minH[1]}`);
}

/* GUARD 4: features the community-plugin review linter flags as only
   partially supported by older Obsidian. Both of these shipped once and came
   back as warnings on the submission report, so they are tripwired rather
   than left to be re-noticed by a reviewer.

   Checked against the BUILD OUTPUT as well as the source: styles.css is
   src/font.css + src/styles.css concatenated, and the linter reads both. */
{
  const built = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  for (const [label, file] of [['src/styles.css', css], ['styles.css', built]]) {
    const stripped = file.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/\bclip-path\s*:/.test(stripped),
      `${label}: clip-path is flagged by the review linter as only partially supported. ` +
      'The cut-corner CTAs were rebuilt without it — do not reintroduce it.',
    );
    assert.ok(
      !/\bui-(monospace|sans-serif|serif)\b/.test(stripped),
      `${label}: extended system fonts (ui-monospace and friends) are flagged by the ` +
      'review linter. Name real faces instead — the fallback stack already covers every platform.',
    );
  }
}

/* GUARD 5: app.css sets `white-space: nowrap` on the bare `button` element
   (specificity 0,0,1). Any plugin button whose label is allowed to run onto a
   second line must reset it, or the text simply overflows the screen edge
   instead of wrapping. The plan-intro headline shipped this way and had to be
   reported from a phone — a harness that does not load app.css wraps happily
   and reports a false pass. */
{
  const head = bare.match(/\.gv-app \.gv-chunk-head\s*\{[^}]*\}/);
  assert.ok(head, '.gv-app .gv-chunk-head rule missing');
  assert.match(
    head[0], /white-space:\s*normal/,
    '.gv-chunk-head is a <button>, and app.css sets white-space:nowrap on bare `button` — ' +
    'it must reset white-space:normal or its headline cannot wrap and runs off a phone screen.',
  );
}

/* GUARD 6: Obsidian mobile's floating navbar overlaps view content instead
   of reserving space, so a bottom action needs --view-bottom-spacing
   clearance to be tappable at all. That clearance belongs on .gv-page — the
   ONE scroll container every page renders into — and nowhere else:

     - on a single screen only, every OTHER screen's bottom control sits
       under the navbar (this shipped: the session-setup Start button was
       unreachable because the rule was on .gv-session-page alone);
     - on .gv-page AND a descendant, the clearance is added twice inside
       that descendant.

   So: exactly one rule, and it is the .gv-page one. */
{
  const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => /var\(\s*--view-bottom-spacing/.test(m[2]));
  assert.strictEqual(
    rules.length, 1,
    'exactly one rule may claim --view-bottom-spacing clearance (nested claims stack); found: ' +
    rules.map(r => r[1].trim()).join(' | '),
  );
  assert.match(
    rules[0][1].trim(), /\.gv-page\s*$/,
    'the --view-bottom-spacing clearance must sit on .gv-page, the scroll container every page ' +
    `renders into — not on one screen. Found: ${rules[0][1].trim()}`,
  );
  assert.match(
    rules[0][1].trim(), /body\.is-phone/,
    'navbar clearance is a phone behaviour — keep it keyed on body.is-phone so tablets and ' +
    'desktop do not gain dead space.',
  );
}

console.log('css guards OK (no bare-span display:none; narrow nav keeps its icons; no linter-flagged features; wrapping button labels reset white-space; one navbar-clearance rule, on .gv-page)');
