'use strict';
/* THE BOTTOM TAB BAR GOES AWAY WITH THE KEYBOARD (iOS-safety review, 0.14.0).

   view.js already shrinks the app root to the visible viewport while the iOS
   soft keyboard is up. Apex and Lock In keep their tab bar at the BOTTOM of
   that root (a flex child), so it kept its ~56px and ate a quarter of a view
   the keyboard had already cut down: on the Log screen the set being typed
   into had barely any room. view.js now owns a root class, gv-kb, set while
   the keyboard is up; the stylesheet hides the bottom bar under it.

   Named cases:
     K1  keyboard opens: root gets gv-kb and the visible height; keyboard closes: both go
     K2  the threshold: a viewport 100px short is a toolbar, not a keyboard (no class)
     K3  a scroll event with the keyboard still up keeps the class (no flicker), a late resize drops it
     K4  teardown (onClose) removes the class and the height
     K5  the stylesheet hides .gv-nav under gv-kb for the Apex and Lock In bottom bars, and ONLY there
     K6  the unrelated focus-mode class is untouched by the keyboard class (they are two switches) */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadSrc, makeRunner } = require('./gym-fake-vault');
const cx = require('./css-cascade.js');

const { GymView } = loadSrc('view.js');

function mk(innerHeight = 800) {
  const listeners = {};
  const vv = { height: innerHeight, offsetTop: 0, addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener() {} };
  const cls = new Set(['gv-app', 'gv-focus']);
  const root = {
    style: { height: '' },
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); return on; } },
    getBoundingClientRect: () => ({ top: 40 }),
    contains: () => false,
  };
  global.window = Object.assign(global.window || {}, { visualViewport: vv, innerHeight, setTimeout: () => 0, clearTimeout() {} });
  const view = new GymView({}, {});
  view.contentEl = root;
  view.registerDomEvent = (t, ev, fn) => t.addEventListener(ev, fn);
  view.setupKeyboardViewport();
  const fire = (ev, height) => { if (height != null) vv.height = height; (listeners[ev] || []).forEach(f => f()); };
  return { view, root, cls, fire, vv };
}

const { check, run } = makeRunner();

check('K1 keyboard opens: root gets gv-kb and the visible height; keyboard closes: both go', () => {
  const t = mk();
  assert.ok(!t.cls.has('gv-kb'), 'no class before any resize');
  t.fire('resize', 460);                                   // 340px keyboard
  assert.ok(t.cls.has('gv-kb'), 'gv-kb while the keyboard is up');
  assert.strictEqual(t.root.style.height, '420px', 'height = visible bottom - root top');
  t.fire('resize', 800);
  assert.ok(!t.cls.has('gv-kb'), 'gv-kb gone with the keyboard');
  assert.strictEqual(t.root.style.height, '');
});

check('K2 a viewport 100px short is a toolbar, not a keyboard', () => {
  const t = mk();
  t.fire('resize', 700);
  assert.ok(!t.cls.has('gv-kb'));
  assert.strictEqual(t.root.style.height, '');
});

check('K3 scroll with the keyboard still up keeps the class; a late resize drops it', () => {
  const t = mk();
  t.fire('resize', 460);
  t.fire('scroll');
  assert.ok(t.cls.has('gv-kb'), 'a viewport scroll must not flicker the bar back');
  t.fire('scroll', 800);
  assert.ok(!t.cls.has('gv-kb'));
});

check('K4 teardown removes the class and the height', () => {
  const t = mk();
  t.fire('resize', 460);
  assert.ok(t.cls.has('gv-kb'));
  t.view.teardownKeyboardViewport();
  assert.ok(!t.cls.has('gv-kb'), 'a closed view must not leave the class on a re-used root');
  assert.strictEqual(t.root.style.height, '');
});

check('K4b onClose runs that teardown', async () => {
  const t = mk();
  t.fire('resize', 460);
  assert.ok(t.cls.has('gv-kb'), 'fixture: the keyboard class is set before the close');
  t.view.appCtl = { keepDraft: () => 'none', stop() {} };
  await t.view.onClose();
  assert.ok(!t.cls.has('gv-kb'));
});

check('K6 the focus-mode class is a separate switch the keyboard never touches', () => {
  const t = mk();
  t.fire('resize', 460);
  assert.ok(t.cls.has('gv-focus'), 'gv-focus survived the keyboard opening');
  t.fire('resize', 800);
  assert.ok(t.cls.has('gv-focus'), 'and the keyboard closing');
});

check('K5 the stylesheet hides .gv-nav under gv-kb for the bottom-bar skins, and only there', () => {
  const rules = cx.load();
  const hide = rules.filter(r => /\bgv-kb\b/.test(r.selector) && /\.gv-nav\b/.test(r.selector));
  assert.ok(hide.length, 'no rule hides .gv-nav under .gv-kb');
  for (const theme of ['light', 'dark']) {
    const visible = (skin, extra, kb) => {
      const classes = ['gv-skin-' + skin, 'gv-accent-lime', 'gv-narrow'].concat(extra || [], kb ? ['gv-kb'] : []);
      const chain = cx.chainOf(['body.theme-' + theme + '.is-mobile.is-phone', 'div.workspace-leaf-content', 'div.view-content.gv-app.' + classes.join('.'), 'nav.gv-nav']);
      const hit = cx.declarationsFor(chain, ['display'], rules)[0];
      return !hit || hit.decl.value !== 'none';
    };
    for (const skin of ['apex', 'lockin']) {
      assert.ok(visible(skin, [], false), `${theme}/${skin}: the bar is visible without the keyboard`);
      assert.ok(!visible(skin, [], true), `${theme}/${skin}: the bottom bar is hidden while the keyboard is up`);
    }
    for (const skin of ['floor', 'editorial']) {
      assert.ok(visible(skin, [], true), `${theme}/${skin}: a top bar is none of this rule's business`);
    }
  }
});

run('keyboard-nav');
