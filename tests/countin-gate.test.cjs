'use strict';
/* THE COUNT-IN GATE HOLDS AGAINST THE SENSOR TOO (issue #15).

   THE BUG THIS REPRODUCES. registerTap has always checked the gate: while
   the count-in runs, a tap SKIPS it and does not score. registerMotionRep
   checked nothing. motionOn survives from set to set and the detector warms
   up in roughly 1.2s of a 5s gate — so a phone still moving from the last
   rep scored into the next set before it had begun. Worse than the count
   being wrong: showRep() overwrites the countdown digit with the live count,
   so the numeral stopped being the countdown the user was reading.

   Both counters had it — the guided screen and the standalone modal.

   AND THE FIX IS NOT THE SAME AS THE TAP'S. A tap on the zone is a
   deliberate "I'm ready", so it dismisses the gate. A phone wobbling on a
   bench says nothing of the kind. Motion during the count-in is DROPPED, not
   treated as ready — letting it skip would hand the count-in to a shoelace.
   That asymmetry is the interesting half of this file.

   countdown.test.cjs is headless and never sees motion; motion-count.test.cjs
   never sees the gate. The hole was exactly between them. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, Platform: { isMobile: false } }
  : origLoad(req, ...rest));
const { RepCounterModal } = require('../src/rep-counter-modal');
Module._load = origLoad;

/* The two methods only touch _countIn, state and commitRep, so they can be
   driven on a stand-in without standing up a modal, a DOM and a sensor. */
const proto = RepCounterModal.prototype;
const stand = armed => ({
  _countIn: { armed: () => armed, skipped: 0, skip() { this.skipped++; } },
  state: { count: 0, lastTapAt: 0 },
  commits: 0,
  commitRep() { this.commits++; },
});

/* ---------- 1. motion during the gate scores nothing ---------- */
{
  const m = stand(false);
  for (let i = 0; i < 12; i++) proto.registerMotionRep.call(m);
  assert.strictEqual(m.state.count, 0,
    'twelve reps of sensor noise during the count-in must leave the set on zero');
  assert.strictEqual(m.commits, 0,
    'commitRep must not run — it is what repaints the numeral over the countdown');
}

/* ---------- 2. AND IT DOES NOT SKIP THE COUNT-IN ---------- */
{
  const m = stand(false);
  for (let i = 0; i < 12; i++) proto.registerMotionRep.call(m);
  assert.strictEqual(m._countIn.skipped, 0,
    'a moving phone is not a deliberate "ready" — motion must be DROPPED, never treated as the skip gesture');
}

/* ---------- 3. a TAP during the gate still skips, and still does not score ---- */
{
  const m = stand(false);
  proto.registerTap.call(m);
  assert.strictEqual(m._countIn.skipped, 1,
    'a tap on the zone IS a deliberate "ready" and must still dismiss the count-in');
  assert.strictEqual(m.state.count, 0,
    'but the tap that says ready is not rep one');
  assert.strictEqual(m.commits, 0);
}

/* ---------- 4. once armed, motion counts normally ---------- */
{
  const m = stand(true);
  for (let i = 0; i < 5; i++) proto.registerMotionRep.call(m);
  assert.strictEqual(m.state.count, 5, 'the gate must open, not stay shut');
  assert.strictEqual(m.commits, 5);

  /* Motion still bypasses the tap DEBOUNCE — motion-count.js runs its own
     refractory window, and stacking the two drops reps in the gap. Five
     calls in the same millisecond prove the debounce is not back. */
  const fast = { ...stand(true), state: { count: 0, lastTapAt: Date.now() } };
  fast.commitRep = () => { fast.commits++; };
  for (let i = 0; i < 5; i++) proto.registerMotionRep.call(fast);
  assert.strictEqual(fast.state.count, 5,
    'closing the count-in hole must not reintroduce the tap debounce on the sensor');
}

/* ---------- 5. with no count-in at all, motion counts ---------- */
{
  const m = { _countIn: null, state: { count: 0, lastTapAt: 0 }, commits: 0, commitRep() { this.commits++; } };
  proto.registerMotionRep.call(m);
  assert.strictEqual(m.state.count, 1,
    'a resumed set has no gate to wait for — the guard must not swallow reps when there is no count-in');
}

/* ---------- 6. the guided screen carries the same guard ---------- */

/* page-session.js pulls half the plugin and the obsidian host with it, and
   registerMotionRep is a closure inside repsBody, so the contract is checked
   where it is written — the counter-settings.test.cjs precedent. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-session.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const i = src.indexOf('const registerMotionRep = () => {');
  assert.ok(i >= 0, 'registerMotionRep has been renamed or reshaped — this guard must move with it');
  const body = src.slice(i, src.indexOf('};', i));

  assert.match(body, /if \(countIn && !countIn\.armed\(\)\) return;/,
    'the guided screen\'s motion reps must check the same gate its taps do');
  assert.ok(!/countIn\.skip\(\)/.test(body),
    'and must not skip it — that is the tap\'s job, because a tap means ready and a wobble does not');

  /* The tap's own guard is the thing this was modelled on; if it ever loses
     the skip, the two have drifted and one of them is wrong. */
  const t = src.indexOf('const registerTap = () => {');
  const tapBody = src.slice(t, src.indexOf('};', t));
  assert.match(tapBody, /countIn\.skip\(\)/,
    'a tap during the count-in must still dismiss it');
}

console.log('count-in gate OK (the sensor cannot score through the gate, and cannot dismiss it either)');
