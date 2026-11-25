'use strict';
/* STICKY START ON THE SETUP SCREEN (25 Nov 2026, Ruan, iPhone 11: "start
   button still bit off screen"). On a narrow pane with the bottom tab bar
   (the poster skins), the setup screen's Start slab sticks to the bottom of
   the scroll area with the same offset as Today's, so it is never half under
   the tab bar. No ancestor between it and the page may scroll or clip. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SEL = '.gv-app.gv-skin-poster.gv-narrow .gv-guidesetup .gv-setup-start';
const block = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].split(',').map(s => s.trim()).includes(SEL));
assert.ok(block, 'the setup Start needs its narrow poster rule');
assert.match(block[2], /position:\s*sticky/, 'it must stick');
assert.match(block[2], /bottom:\s*-24px/, "same offset as Today's sticky Start (the page's 24px bottom padding)");
assert.match(block[2], /background-image:[^;]*var\(--gv-bg\)/, 'it needs the page ground behind it so scrolled content does not show through');
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (/\.gv-guidesetup\s*$/.test(m[1].trim()) && /overflow(-y)?:\s*(auto|scroll|hidden)/.test(m[2])) assert.fail('.gv-guidesetup must not clip or scroll, or sticky stops working');
}
console.log('setup start sticky OK');
