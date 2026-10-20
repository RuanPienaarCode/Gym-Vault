'use strict';
/* L4-03 (usability fix wave 20 Oct 2026): EVERY BUTTON HAS AN ACCESSIBLE NAME.

   Two buttons were announced as just "button" to a screen reader:

     - the nav tabs: the controller gave only the HEAD buttons an aria-label, and
       the label span is display:none in a narrow pane (every phone) - on Floor and
       Editorial the tab is an icon alone;
     - the log page's "Guided" button: its word sits in .gv-btn-guided-label, which a
       narrow pane hid with display:none, which also removes it from the
       accessibility tree.

   display:none is right for the nav label (the tab keeps its icon and now carries an
   aria-label), and the guard that pins it stays. For Guided the word is kept for
   assistive technology by the same visually-hidden technique .gv-sr-only uses. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

check('every nav tab button is given aria-label = its label, not only the head buttons', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  const at = src.indexOf("class: head ? 'gv-head-btn' : 'gv-nav-btn'");
  assert.ok(at > 0, 'buildNav button creation found');
  const attrs = src.slice(at, at + 260);
  const m = /'aria-label':\s*([^,\n]+),/.exec(attrs);
  assert.ok(m, 'an aria-label attribute is set on the nav/head button');
  assert.ok(!/head\s*\?/.test(m[1]) && /item\.label/.test(m[1]), `the aria-label is conditional on head (${m[1].trim()}): the bottom tabs are unnamed once the label span is hidden`);
});

check('the Guided button\'s word is hidden visually, not removed from the accessibility tree', () => {
  const rules = cx.load().filter(r => /\.gv-btn-guided-label\b/.test(r.selector));
  assert.ok(rules.length >= 1, 'a narrow-pane rule for .gv-btn-guided-label exists');
  for (const r of rules) {
    const get = p => (r.decls.find(d => d.prop === p) || {}).value;
    assert.notStrictEqual(get('display'), 'none', `\`${r.selector}\` is display:none: the button has no name left for a screen reader`);
    assert.notStrictEqual(get('visibility'), 'hidden', `\`${r.selector}\` is visibility:hidden`);
    assert.strictEqual(get('position'), 'absolute', `\`${r.selector}\` does not use the visually-hidden technique (position:absolute)`);
    assert.ok(/rect\(/.test(get('clip') || ''), `\`${r.selector}\` does not clip the word away`);
    assert.strictEqual(get('width'), '1px');
  }
});

check('the narrow nav label is still display:none (the tab keeps its icon; the name is the aria-label)', () => {
  const rule = cx.load().find(r => r.selector === '.gv-app.gv-narrow .gv-nav-label');
  assert.ok(rule && rule.decls.some(d => d.prop === 'display' && d.value === 'none'));
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-names OK');
