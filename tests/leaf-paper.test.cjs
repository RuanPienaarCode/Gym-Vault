'use strict';
/* OBSIDIAN'S TITLE BAR WEARS THE GYM'S PAPER (16 Nov 2026, "no white for
   header or body or menu in light mode").

   The leaf's own header (back/forward, "Gym") sits OUTSIDE .gv-app, so the
   skin tokens never reach it; Obsidian paints it with --background-primary,
   white in light mode. paintLeaf copies the app root's resolved --gv-bg onto
   the leaf container as --background-primary.
     L1  it sets the leaf's --background-primary to the root's --gv-bg
     L2  an empty read (not laid out yet) clears it rather than writing ''
     L3  it never throws (no window, no leaf, getComputedStyle throwing)
     L4  the controller calls it from syncChrome and on css-change
     L5  (audit 16 Nov 2026, #22) it ALSO sets --file-header-background. In
         Obsidian 1.15.1 the title bar (.view-header) paints with
         background-color: var(--file-header-background), and that variable is
         declared once at body level as var(--background-primary), so it
         resolves THERE and the leaf's --background-primary never reaches it.
         Setting it on the leaf container too is what makes the bar take the
         gym's colour; both go when there is no colour.
     L6  clearLeaf removes both, and the controller's teardown calls it
     L7  nothing outside the leaf is written */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { paintLeaf, clearLeaf } = require('../src/leaf-paper');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const leaf = () => {
  const props = {};
  return { props, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } } };
};
const win = bg => ({ getComputedStyle: () => ({ getPropertyValue: k => (k === '--gv-bg' ? bg : '') }) });

check('L1 copies --gv-bg to the leaf as --background-primary', () => {
  const l = leaf();
  assert.strictEqual(paintLeaf({}, l, win('  #e0e8d4 ')), '#e0e8d4');
  assert.strictEqual(l.props['--background-primary'], '#e0e8d4');
});

check('L2 an empty read clears the leaf instead of writing an empty value', () => {
  const l = leaf();
  paintLeaf({}, l, win('#e0e8d4'));
  assert.strictEqual(paintLeaf({}, l, win('')), '');
  assert.ok(!('--background-primary' in l.props));
});

check('L3 never throws', () => {
  assert.strictEqual(paintLeaf(null, null, null), '');
  assert.strictEqual(paintLeaf({}, leaf(), { getComputedStyle() { throw new Error('detached'); } }), '');
});

check('L4 the controller paints the leaf on every chrome sync and on theme change', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  const sync = src.slice(src.indexOf('const syncChrome'), src.indexOf('syncChrome();'));
  assert.match(sync, /paintLeaf\(/, 'syncChrome must call paintLeaf');
  assert.match(src, /on\('css-change'[^)]*\)?[\s\S]{0,120}paintLeaf|css-change[\s\S]{0,160}syncChrome/, 'css-change must repaint the leaf');
});

check('L5 the title bar variable is set beside --background-primary and cleared with it', () => {
  const l = leaf();
  paintLeaf({}, l, win('#e0e8d4'));
  assert.strictEqual(l.props['--file-header-background'], '#e0e8d4', 'the view header stayed white: its variable never reached it');
  assert.strictEqual(l.props['--background-primary'], '#e0e8d4');
  paintLeaf({}, l, win(''));
  assert.ok(!('--file-header-background' in l.props), 'an empty read must clear the header variable too');
  assert.ok(!('--background-primary' in l.props));
});

check('L6 clearLeaf removes both variables, never throws, and the controller stop() calls it', () => {
  const l = leaf();
  paintLeaf({}, l, win('#e0e8d4'));
  clearLeaf(l);
  assert.deepStrictEqual(Object.keys(l.props), []);
  assert.doesNotThrow(() => { clearLeaf(null); clearLeaf({}); clearLeaf({ style: {} }); });
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  const stop = src.slice(src.indexOf('    stop() {'), src.indexOf('hasDraft:'));
  assert.match(stop, /clearLeaf\(view\.containerEl\)/, 'the view teardown must take the paper off the title bar');
});

check('L7 only the leaf container is written (no body, mod-root or navbar)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'leaf-paper.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document\.body|documentElement|\.mod-root|mobile-navbar|querySelector/.test(src), 'leaf-paper reaches outside the leaf');
});

if (failed) { console.error(`leaf-paper: ${failed} failed`); process.exit(1); }
