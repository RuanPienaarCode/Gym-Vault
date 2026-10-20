'use strict';
/* M-01 (usability fix wave 20 Oct 2026): THE LIVE SET FILLS THE PANE.

   "Tick set" sat below the fold on every iPhone: 393x852 gave a 741px pane and
   1014px of content. The counter zone is touch-action:none, so nobody can drag
   it out of the way; the fit has to be done by layout. Three causes, three
   guards:

     1  the live page must be EXACTLY the pane tall (`height: 100%`, not just
        `min-height`, which lets it grow), so the count zone is the thing that
        flexes;
     2  the compaction is keyed on the PANE (controller.js puts `gv-short` /
        `gv-shorter` on the view root from its ResizeObserver; K4), not on
        `@media (max-height)`, which is the WINDOW and never fired where it was
        needed;
     3  the zone's own floor is small enough for the fixed pieces to fit.

   The runtime numbers (Tick's bottom edge against the pane, five phone sizes,
   Apex and Lock In, both themes) are measured by the harness; this holds the
   stylesheet and the class contract. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

const rules = cx.load();
const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
const px = v => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v || '').trim()); return m ? Number(m[1]) : null; };
const unmedia = r => !r.media;
const SKINS = ['apex', 'lockin'];
const find = (skin, tail, mod) => rules.filter(r => unmedia(r) && r.selector === `.gv-app.gv-skin-${skin}${mod || ''} ${tail}`);

/* ---- K4: the pane-height classes ---- */
const origLoad = Module._load;
const stub = { setIcon() {}, Notice: class {}, Modal: class {}, Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, normalizePath: p => p, requestUrl() {} };
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const ctl = require('../src/controller');

check('K4: paneHeightTier names the pane tiers: 0 unmeasured/tall, 1 short, 2 shorter', () => {
  assert.strictEqual(typeof ctl.paneHeightTier, 'function', 'controller.js exports paneHeightTier');
  assert.strictEqual(ctl.paneHeightTier(0), 0, 'a hidden pane reports 0px and is neither short nor shorter');
  assert.strictEqual(ctl.paneHeightTier(1069), 0, 'a 820x1180 tablet pane is not short');
  assert.strictEqual(ctl.paneHeightTier(821), 1, 'an iPhone Pro Max pane (932 - 111) is short');
  assert.strictEqual(ctl.paneHeightTier(741), 1, 'an iPhone 15 pane (852 - 111) is short');
  assert.strictEqual(ctl.paneHeightTier(556), 2, 'an iPhone SE pane (667 - 111) is shorter');
  assert.ok(ctl.SHORTER_PANE_PX < ctl.SHORT_PANE_PX, 'shorter is a subset of short');
  assert.strictEqual(ctl.paneHeightTier(ctl.SHORT_PANE_PX), 1);
  assert.strictEqual(ctl.paneHeightTier(ctl.SHORT_PANE_PX + 1), 0);
  assert.strictEqual(ctl.paneHeightTier(ctl.SHORTER_PANE_PX), 2);
  assert.strictEqual(ctl.paneHeightTier(ctl.SHORTER_PANE_PX + 1), 1);
});

check('K4: the ResizeObserver sets gv-short and gv-shorter on the view root, beside gv-narrow', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  const at = src.indexOf("'gv-narrow'");
  assert.ok(at > 0, 'gv-narrow toggle still there');
  const body = src.slice(at - 400, at + 900);
  assert.ok(/toggle\('gv-short'/.test(body), 'rootEl.classList.toggle(\'gv-short\', ...) next to gv-narrow');
  assert.ok(/toggle\('gv-shorter'/.test(body), 'rootEl.classList.toggle(\'gv-shorter\', ...) next to gv-narrow');
  assert.ok(/contentRect\.height|rect\.height/.test(body), 'the tier is read from the observed pane height');
});

/* ---- 1: the page is exactly the pane tall ---- */
for (const skin of SKINS) {
  check(`${skin}: the live session page is height:100% of the pane, not min-height only`, () => {
    const hit = find(skin, '.gv-session-page').find(r => decl(r, 'height') === '100%');
    assert.ok(hit, `.gv-app.gv-skin-${skin} .gv-session-page { height: 100% } is missing: the page grows with its content and Tick set leaves the screen`);
  });
}

/* ---- 2: compaction keyed on the pane ---- */
const SHORT_NEEDS = [
  ['.gv-live-head .gv-session-exname.gv-live-name', 'font-size', v => /clamp\(/.test(v), 'the name steps down'],
  ['.gv-live .gv-pb-target', 'padding', v => !!v, 'the PB target tightens'],
  ['.gv-live-zone.gv-session-zone', 'min-height', v => px(v) !== null && px(v) <= 100, 'the zone floor is at most 100px (it was 140)'],
  ['.gv-live-zone .gv-session-count', 'font-size', v => /min\(/.test(v), 'the count steps down with the height'],
  ['.gv-live-ring', 'display', v => v === 'none', 'the rest ring goes'],
  ['.gv-live-sheet', 'padding-top', v => px(v) !== null && px(v) < 34, 'the sheet gives back padding'],
];
for (const skin of SKINS) {
  for (const [tail, prop, okv, what] of SHORT_NEEDS) {
    check(`${skin}: gv-short compaction - ${what}`, () => {
      const rs = rules.filter(r => unmedia(r) && r.selector.includes(`.gv-app.gv-skin-${skin}.gv-short`) && r.selector.includes(tail));
      const hit = rs.find(r => okv(decl(r, prop) || ''));
      assert.ok(hit, `no \`.gv-app.gv-skin-${skin}.gv-short ${tail}\` rule sets ${prop}: the short-pane compaction is keyed on the window (@media max-height), which an 852px phone never meets`);
    });
  }
  check(`${skin}: gv-shorter hides the what-is-next row and trims the thumbnail`, () => {
    const hidden = rules.filter(r => unmedia(r) && r.selector.includes(`.gv-app.gv-skin-${skin}.gv-shorter`) && decl(r, 'display') === 'none').map(r => r.selector);
    assert.ok(hidden.some(s => s.includes('.gv-live-next')), 'the next row goes at gv-shorter');
    const fr = rules.find(r => unmedia(r) && r.selector.includes(`.gv-app.gv-skin-${skin}.gv-shorter`) && r.selector.includes('.gv-session-frame'));
    assert.ok(fr && px(decl(fr, 'height')) <= 56, 'the thumbnail frame shrinks at gv-shorter');
  });
}

/* Nothing in the new compaction may use the window: a vh/@media key would
   bring the original bug back. (vh INSIDE a min() font-size is a scale, not a
   switch, and the pre-existing media blocks are left in place.) */
check('the new compaction is not an @media (max-height) switch', () => {
  const mine = rules.filter(r => /\.gv-(short|shorter)\b/.test(r.selector));
  assert.ok(mine.length >= 20, `the gv-short block parsed to ${mine.length} rules`);
  for (const r of mine) assert.ok(!r.media, `${r.selector} sits inside ${r.media}: key it on the pane class, not the window`);
});

Module._load = origLoad;
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-live-fit OK');
