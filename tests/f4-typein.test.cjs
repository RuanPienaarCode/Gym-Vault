'use strict';
/* M-02 (usability fix wave 20 Oct 2026): "TYPE THE COUNT" SHOWS ITS DIGITS.

   The box swaps in for the giant count and inherits its font size (~180px).
   Obsidian's app.css sizes every number box

       input[type='number'] { height: var(--input-height) }         (0,1,1)

   and the plugin rule never said how tall its own box is, so the host's 44px won:
   180px digits in a 44px box, a cropped strip. And on focus the host's

       input[type='number']:focus         { border-color: ... }      (0,2,1)
       input[type='number']:focus-visible { box-shadow: 0 0 0 ... }  (0,2,1)

   out-ranked `.gv-app .gv-rc-typein` (0,2,0), turning the lime underline grey and
   drawing the host's ring round a box that is meant to look like the number.

   app.css is absent in CI, so the three host rules are DATA here, with the version
   they were read from (Obsidian 1.14.4). :focus-visible is not in the cascade
   engine's vocabulary and has the same specificity as :focus, so the ring is
   encoded under :focus (a box focused by a tap, or by script as here, matches both). */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

const HOST = [
  { selector: "input[type='number']", decls: [{ prop: 'height', value: 'var(--input-height)' }], line: 21208, media: null },
  { selector: "input[type='number']:focus", decls: [{ prop: 'border-bottom-color', value: 'var(--background-modifier-border-focus)' }, { prop: 'box-shadow', value: '0 0 0 var(--input-border-width-focus) var(--background-modifier-border-focus)' }], line: 8631, media: null },
];
const rules = cx.load();
const chain = focus => cx.chainOf(['div.gv-app.gv-skin-apex', 'div.gv-rc-zone', 'div.gv-rc-count', 'input.gv-rc-typein[type=number]' + (focus ? ':focus' : '')]);
const win = (focus, prop) => cx.declarationsFor(chain(focus), [prop], rules, HOST)[0];

check('the box is not sized by the host: its height is the plugin\'s own, from its font size', () => {
  const w = win(false, 'height');
  assert.ok(w, 'some rule sets the height');
  assert.ok(!w.rule.host, `the host's \`${w.rule.selector} { height: ${w.decl.value} }\` wins: the box is 44px tall with ~180px digits in it`);
  assert.ok(/^(auto|\d+(\.\d+)?em|calc\()/.test(w.decl.value), `height should follow the type (auto or em), got ${w.decl.value}`);
});

check('focused, the lime underline survives the host\'s grey border-color', () => {
  const w = win(true, 'border-bottom-color');
  assert.ok(w && !w.rule.host, `the host's :focus border-color (0,2,1) wins over the plugin underline: ${w && w.rule.selector}`);
  assert.ok(/--gv-lime/.test(w.decl.value), `the focus underline stays the accent, got ${w.decl.value}`);
});

check('focused, the host\'s ring does not wrap the box', () => {
  const w = win(true, 'box-shadow');
  assert.ok(w && !w.rule.host, `the host's focus ring (0,2,1) wins over the plugin's \`box-shadow: none\`: ${w && w.rule.selector}`);
  assert.strictEqual(w.decl.value, 'none');
});

check('the focus rule is plain :focus (not :focus-visible, invalid before iOS 15.4)', () => {
  const hits = rules.filter(r => /gv-rc-typein/.test(r.selector) && /focus/.test(r.selector));
  assert.ok(hits.length >= 1, 'a .gv-rc-typein:focus rule exists');
  for (const r of hits) assert.ok(!/focus-visible/.test(r.selector), `${r.selector} uses :focus-visible`);
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-typein OK');
