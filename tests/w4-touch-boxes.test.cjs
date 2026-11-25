'use strict';
/* W4-8 / B-L4-10 (usability fix wave 2, 20 Oct 2026): THE SMALL CONTROLS HAVE 44px TOUCH BOXES.

   Measured on a 393px phone by hit-testing (elementFromPoint along the centre lines): Floor and
   Editorial buttons were 38px tall, small ones 32px, the Skip pair 26px, the log page's Guided
   button 32px; the 48 voice-page mic/play/delete buttons (and the log page's tap-count and remove
   buttons) were 40x40 in every skin; Editorial goal rows 36px.

   They are made 44px without a visible change: a transparent ::after centred on the control, as
   large as the control or 44px, whichever is bigger (a click on it is a click on the button; the
   same technique as .gv-planswap and the Floor chips). It is ::after because the poster skins
   already paint their slab on ::before, and .gv-btn-go (not a .gv-btn) keeps its own ::after pulse.
   The runtime numbers are in the commit message (hit-tested before/after). */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load();
const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;

/* + the small text links and the "Session in progress" pill the 25 Nov 2026 fix wave added (drawn small, touched at 44px). */
const TARGETS = ['.gv-btn:not(.gv-btn-go)', '.gv-btn-hero-ghost', '.gv-icon-btn', '.gv-goal-mini', '.gv-start-link', '.gv-recrow-session', '.gv-session-pill'];
for (const t of TARGETS) {
  check(`${t} is positioned and has a 44px transparent ::after`, () => {
    const host = rules.find(r => r.selector.split(',').map(s => s.trim()).includes(`.gv-app ${t}`) && decl(r, 'position') === 'relative' && !r.media);
    assert.ok(host, `no \`.gv-app ${t}\` rule makes it position: relative: its ::after has nothing to be absolute against`);
    const hit = rules.find(r => r.selector === `.gv-app ${t}::after` && !r.media);
    assert.ok(hit, `no \`.gv-app ${t}::after\` hit area: the control's touch box is its own (smaller than 44px) box`);
    assert.strictEqual(decl(hit, 'width'), 'max(100%, 44px)', 'the hit area is at least 44px wide');
    assert.strictEqual(decl(hit, 'height'), 'max(100%, 44px)', 'the hit area is at least 44px tall');
    assert.strictEqual(decl(hit, 'content'), "''");
    assert.strictEqual(decl(hit, 'position'), 'absolute');
    assert.ok(!decl(hit, 'background') && !decl(hit, 'background-color') && !decl(hit, 'border') && !decl(hit, 'box-shadow'), 'the hit area must paint nothing');
  });
}
check('.gv-btn-go keeps its own ::after (the Apex pulse): the hit area is not applied to it', () => {
  assert.ok(!TARGETS.some(t => /gv-btn-go\b/.test(t.replace(':not(.gv-btn-go)', ''))), 'a target names .gv-btn-go');
  assert.ok(TARGETS[0].includes(':not(.gv-btn-go)'), 'the .gv-btn rule must exclude .gv-btn-go');
});

/* AUDIT 25 NOV 2026 (#7): THE DRAWN BOX IS 44px TOO, ON A PHONE, IN EVERY SKIN. The ::after above makes the
   hit area 44px, but a small button still LOOKED 22-31px tall in Calm, Floor and Editorial (Calm's live-set Skip
   pair 39x22, Done 65x31, measured in a headless browser) while Apex and Lock In drew 44. Every skin, both
   themes, a narrow pane and a phone host: the small button, the live set's Skip, and a plan card's Start. */
const minPx = (chain) => { const c = cx.computed(chain, 'min-height', rules); return c ? parseFloat(c.value) : 0; };
for (const skin of ['apex', 'lockin', 'calm', 'floor', 'editorial']) {
  for (const theme of ['light', 'dark']) {
    for (const [where, o] of [['narrow pane', { narrow: true }], ['phone', { host: ['is-mobile', 'is-phone'] }]]) {
      for (const el of ['button.gv-btn.gv-btn-small', 'button.gv-btn.gv-btn-ghost.gv-btn-small.gv-session-skip', 'button.gv-btn.gv-btn-small.gv-plan-go']) {
        check(`${skin}/${theme}/${where}: ${el} is at least 44px tall`, () => {
          const h = minPx(cx.appChain(Object.assign({ theme, skin }, o), el));
          assert.ok(h >= 44, `min-height resolves to ${h}px`);
        });
      }
    }
  }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-touch-boxes OK');
