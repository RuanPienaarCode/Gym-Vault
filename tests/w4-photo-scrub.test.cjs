'use strict';
/* W4-9b / L5-08 (usability fix wave 2, 20 Oct 2026): THE PHOTO SCRUBBER IS STYLED LIKE THE APP'S OTHER SLIDER.

   The progress-photo viewer's slider (input.gv-photo-scrub) had no styling for its track or thumb, so
   it rendered as the host's own: a hairline and a grey knob that belong to no skin. The guided-session
   dial (.gv-dial-range) already paints the app's slider: a 6px --gv-line track (--gv-line-2 on graphite)
   and a 28px lime thumb with an ink border, by styling the pseudo-elements (accent-color is inert on
   range). The scrubber now shares those same rules (one selector list, so they cannot drift), and the
   rule that clears the host's native look carries .gv-app so it out-ranks app.css's
   `input[type='range']` (0,1,1). */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load();
const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
const find = (sel, dark) => rules.find(r => r.selector === `${dark ? '.theme-dark ' : ''}.gv-app ${sel}` && !r.media);

/* The light track and thumb, and the dark twins the dial declares (track and thumb both have one). */
for (const [pseudo, dark] of [['::-webkit-slider-runnable-track', false], ['::-webkit-slider-runnable-track', true], ['::-webkit-slider-thumb', false], ['::-webkit-slider-thumb', true]]) {
  check(`${dark ? 'dark: ' : ''}.gv-photo-scrub${pseudo} is painted, with the dial's own values`, () => {
    const scrub = find(`.gv-photo-scrub${pseudo}`, dark);
    const dial = find(`.gv-dial-range${pseudo}`, dark);
    assert.ok(dial, `the dial's ${dark ? 'dark ' : ''}${pseudo} rule is missing (the reference)`);
    assert.ok(scrub, `no .gv-app .gv-photo-scrub${pseudo} rule: the scrubber's ${pseudo.includes('thumb') ? 'thumb' : 'track'} is the host's own`);
    assert.deepStrictEqual(scrub.decls.map(d => d.prop + ':' + d.value), dial.decls.map(d => d.prop + ':' + d.value), 'the scrubber and the dial must paint the same slider');
  });
}
check('the scrubber clears the native look under .gv-app (-webkit-appearance: none, no host background)', () => {
  const r = rules.find(r => r.selector === '.gv-app .gv-photo-scrub' && decl(r, '-webkit-appearance') === 'none');
  assert.ok(r, 'no `.gv-app .gv-photo-scrub { -webkit-appearance: none }`: the host paints the native control over the custom track');
  assert.strictEqual(decl(r, 'background'), 'transparent');
});
check('the scrubber keeps its 44px touch height and full width (the host\'s 100px must lose)', () => {
  const rs = rules.filter(r => r.selector === '.gv-app .gv-photo-scrub');
  assert.ok(rs.some(r => decl(r, 'width') === '100%') && rs.some(r => decl(r, 'min-height') === '44px'));
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-photo-scrub OK');
