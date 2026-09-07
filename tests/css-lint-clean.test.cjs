'use strict';
/* THE STYLESHEET STAYS CLEAN FOR THE COMMUNITY REVIEW LINTER.

   Obsidian's directory review runs a CSS linter over the stylesheet a plugin
   ships, and two of its warnings had been sitting in this file:

     Unexpected duplicate "overflow-wrap"   (.gv-chunk-label)
     Avoid !important                       (.gv-photo-layer, reduced motion)

   Both were deliberate once and neither survived contact with the reason:

   - The duplicate was the old two-value fallback, `break-word` then
     `anywhere`, leaning on an engine dropping a value it does not know.
     That still works, but it reads as one declaration typed twice. It is an
     @supports guard now, which says the same thing on purpose.

   - The !important was fighting an INLINE transition written by
     photo-viewer.js. Nothing but !important can beat an inline style, so the
     rule had no quieter form — and it did not need one, because
     photo-viewer.js already checks prefers-reduced-motion before it sets the
     transition at all. The rule was dead weight over a decision made
     elsewhere.

   This file pins both, and pins the accessibility promise that made the
   second one look necessary, so removing the rule cannot quietly remove the
   behaviour with it.

   ROOT styles.css IS BUILD OUTPUT (src/font.css + src/styles.css). Both are
   checked, because the linter reads the shipped file and only the built one
   is shipped. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
/* Comments are prose and may legitimately discuss !important by name — the
   whole explanation above one of these fixes does. Blank them out (keeping
   line numbers) so only real declarations are examined. */
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

for (const file of ['src/styles.css', 'styles.css']) {
  const css = stripComments(read(file));

  /* ---- no !important anywhere ---- */
  const shouts = [];
  css.split('\n').forEach((line, i) => {
    if (line.indexOf('!important') !== -1) shouts.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  assert.deepStrictEqual(
    shouts, [],
    'the community review linter flags every !important, and this stylesheet has no need of one: ' +
    'raise specificity, or move the decision to the code that owns the inline style. Found:\n' +
    shouts.join('\n'),
  );

  /* ---- no property declared twice in one rule block ---- */
  const lines = css.split('\n');
  let depth = 0;
  let block = null;
  let opensAt = 0;
  const dupes = [];
  lines.forEach((line, i) => {
    if (depth > 0 && block) {
      const m = line.match(/^\s*([-a-zA-Z]+)\s*:/);
      if (m) {
        const prop = m[1];
        if (block.has(prop)) {
          dupes.push(`${file}:${i + 1}: "${prop}" already set at line ${block.get(prop)} (rule opens line ${opensAt})`);
        } else {
          block.set(prop, i + 1);
        }
      }
    }
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    for (let k = 0; k < opens; k++) { depth++; if (depth === 1) { block = new Map(); opensAt = i + 1; } }
    for (let k = 0; k < closes; k++) { depth--; if (depth <= 0) { depth = 0; block = null; } }
  });
  assert.deepStrictEqual(
    dupes, [],
    'a property set twice in one rule is flagged as a duplicate by the review linter. When the second ' +
    'value is a NEWER-ENGINE fallback (the reason this pattern existed here), express it as an @supports ' +
    'block instead — it survives the linter and says what it means. Found:\n' + dupes.join('\n'),
  );
}

/* ---- the iOS 15 fallback still exists, in its new shape ---- */

const src = read('src/styles.css');
assert.ok(
  /overflow-wrap:\s*break-word/.test(src),
  'break-word must remain the BASE value: `anywhere` is Safari 15.4+ and this plugin\'s engine floor is ' +
  'iOS 15.0, so a phone on 15.0 needs the older value to wrap a long headline at all.',
);
assert.ok(
  /@supports \(overflow-wrap: anywhere\)[\s\S]{0,200}overflow-wrap:\s*anywhere/.test(src),
  '`anywhere` must stay behind an @supports guard. Deleting it would regress the long-unbroken-token case ' +
  'on modern engines; inlining it back into the base rule would restore the duplicate-property warning.',
);

/* ---- reduced motion is still honoured for the photo cross-fade ---- */

const viewer = read('src/photo-viewer.js');
assert.ok(
  /prefers-reduced-motion/.test(viewer),
  'photo-viewer.js must check prefers-reduced-motion itself. Its cross-fade is an INLINE transition, so ' +
  'the stylesheet cannot override it without the !important that was just removed — deleting this check ' +
  'would leave a user who asked for no motion with no defence anywhere.',
);
assert.ok(
  /if \(!animate \|\| reducedMotion\(\)\)/.test(viewer),
  'the reduced-motion branch must still short-circuit BEFORE the transition is set, rather than setting ' +
  'a fade and trying to cancel it afterwards.',
);

/* And the stylesheet still governs the transitions it genuinely owns. */
const blocks = (read('src/styles.css').match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length;
assert.ok(
  blocks >= 9,
  `the file's other reduced-motion blocks cover CSS-owned animations (the punch, the dial heartbeat, the ` +
  `streak flicker, the count ring, the recording pulse) and none of them needs !important. Expected at ` +
  `least 9, found ${blocks} — if one was removed, the animation it guarded now ignores the preference.`,
);

console.log('css lint clean OK (no !important, no duplicate declarations, the iOS 15 wrap fallback lives ' +
  'in @supports, and reduced motion is still honoured where the inline style is written)');
