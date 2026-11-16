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
     L4  the controller calls it from syncChrome and on css-change */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { paintLeaf } = require('../src/leaf-paper');

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

if (failed) { console.error(`leaf-paper: ${failed} failed`); process.exit(1); }
