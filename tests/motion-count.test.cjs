'use strict';
/* The detector's whole job is telling a rep from everything else that shakes
   a phone, and none of that can be checked by hand on a device — you cannot
   do exactly eleven push-ups at a known amplitude twice. So every case here
   is a synthetic accelerometer stream fed at a fixed rate, and the assertions
   are about COUNTS: how many reps a signal should produce, and how many a
   non-signal must not. */
const assert = require('node:assert');
const {
  createMotionDetector, feedSample, currentThreshold, isWarmingUp,
  SENSITIVITY, WARMUP_MS, REFRACTORY_MS, MIN_THRESHOLD, STALL_MS,
} = require('../src/motion-count');

const HZ = 50;
const STEP = 1000 / HZ;
const GRAVITY = 9.81;

/* Feed a stream of magnitudes; returns { state, counted, times }. */
function run(state, samples, startT) {
  let t = startT == null ? 0 : startT;
  let counted = 0;
  const times = [];
  for (const mag of samples) {
    const r = feedSample(state, t, mag);
    state = r.state;
    if (r.counted) { counted++; times.push(t); }
    t += STEP;
  }
  return { state, counted, times, endT: t };
}

/* A rep as the accelerometer sees it: one sine cycle of `amp` over `periodMs`
   riding on gravity. Real reps are messier, but the shape — down then up,
   once per rep — is the thing the detector keys on.

   Every rep stream below is followed by a moment of stillness, because a set
   ends with the phone coming back to rest and the LAST rep's up-crossing has
   to land somewhere. Cutting the stream off mid-swing loses that rep — in the
   test and on a bar. */
function reps(n, amp, periodMs, baseline) {
  const base = baseline == null ? GRAVITY : baseline;
  const out = [];
  const perRep = Math.round(periodMs / STEP);
  /* cos, not sin: a rep starts at the TOP (standing, arms extended, chest
     up), descends to a trough and returns. Generating from sin instead
     starts the stream mid-ascent and ends it mid-ascent, which silently
     costs the last rep — the detector counts on the way UP, so a stream cut
     off at the bottom has one fewer completed rep in it than cycles. */
  for (let i = 0; i < n * perRep; i++) {
    out.push(base + amp * Math.cos((2 * Math.PI * i) / perRep));
  }
  return out;
}

function still(ms, jitter, baseline) {
  const base = baseline == null ? GRAVITY : baseline;
  const out = [];
  /* Deterministic pseudo-noise — a real Math.random() would make a failure
     impossible to reproduce. */
  let seed = 7;
  for (let i = 0; i < Math.round(ms / STEP); i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push(base + ((seed / 2147483648) - 0.5) * 2 * (jitter || 0));
  }
  return out;
}

/* ---------- it counts real reps ---------- */

/* Ten clean reps at a squat's pace count as ten. The warm-up eats the first
   second, so the stream opens with the phone settling — exactly as it does
   when someone starts the counter and gets into position. */
{
  const d = createMotionDetector();
  const { counted } = run(d, [...still(1500, 0.05), ...reps(10, 2.5, 1600), ...still(800, 0.05)]);
  assert.strictEqual(counted, 10, 'ten sine reps must count as exactly ten');
}

/* Same reps, four times the amplitude and half the pace: a pull-up rather
   than a slow squat. The adaptive threshold has to handle both without being
   told which is which. */
{
  const d = createMotionDetector();
  const { counted } = run(d, [...still(1500, 0.05), ...reps(8, 9, 900), ...still(800, 0.05)]);
  assert.strictEqual(counted, 8, 'fast, high-amplitude reps must count exactly');
}

/* A small-amplitude sit-up, still comfortably above the noise floor. */
{
  const d = createMotionDetector();
  const { counted } = run(d, [...still(1500, 0.05), ...reps(12, 1.8, 2000), ...still(800, 0.05)]);
  assert.strictEqual(counted, 12, 'small but real reps must not be dropped');
}

/* Gravity-free samples (`event.acceleration` rather than
   `accelerationIncludingGravity`) count the same — the baseline is
   subtracted, never assumed. */
{
  const d = createMotionDetector();
  const { counted } = run(d, [...still(1500, 0.05, 0), ...reps(10, 2.5, 1600, 0), ...still(800, 0.05, 0)]);
  assert.strictEqual(counted, 10, 'a zero-baseline stream must count identically');
}

/* ---------- it ignores everything else ---------- */

/* A phone lying still for half a minute counts nothing. This is the test that
   matters most: a counter that drifts upward on its own is worse than no
   counter, because you only find out after the set. */
{
  const d = createMotionDetector();
  const { counted } = run(d, still(30000, 0.25));
  assert.strictEqual(counted, 0, 'a still phone must never count a rep');
}

/* One sharp knock — the phone set down on a table — is a single crossing, not
   a cycle, and must not count. */
{
  const d = createMotionDetector();
  const knock = [...still(2000, 0.05), GRAVITY + 14, GRAVITY + 9, GRAVITY + 3, ...still(3000, 0.05)];
  const { counted } = run(d, knock);
  assert.strictEqual(counted, 0, 'a single jolt is not a rep');
}

/* The warm-up window swallows the start-up transient. Reps that begin
   immediately still get counted once the window passes, but nothing lands
   inside it. */
{
  const d = createMotionDetector();
  const { times } = run(d, reps(12, 3, 1200));
  assert.ok(times.length > 0, 'reps after the warm-up still count');
  assert.ok(times[0] >= WARMUP_MS, `first rep at ${times[0]}ms must be after the ${WARMUP_MS}ms warm-up`);
}

/* Ringing inside the refractory window is one rep, not several. */
{
  const d = createMotionDetector();
  const fast = reps(6, 4, 300); // 300ms per cycle — faster than any human rep
  const { times } = run(d, [...still(1500, 0.05), ...fast]);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= REFRACTORY_MS,
      `reps ${i - 1}->${i} landed ${times[i] - times[i - 1]}ms apart, inside the refractory window`);
  }
}

/* ---------- sensitivity ---------- */

/* High sensitivity lowers the bar, low sensitivity raises it — asserted on
   the threshold rather than on a hand-tuned signal, so the test says what the
   setting MEANS instead of restating one magic number. */
{
  const fresh = s => createMotionDetector({ sensitivity: s });
  assert.ok(currentThreshold(fresh('high')) < currentThreshold(fresh('normal')));
  assert.ok(currentThreshold(fresh('normal')) < currentThreshold(fresh('low')));
  assert.strictEqual(currentThreshold(fresh('normal')), MIN_THRESHOLD);
  assert.strictEqual(SENSITIVITY.normal.scale, 1);
}

/* THE SIT-UP PROBLEM, which is what sensitivity exists for.

   A trunk movement reverses direction twice in one rep, so the accelerometer
   sees TWO oscillations per sit-up and the detector — which counts one rep
   per oscillation — doubles the count. Raising the threshold cannot fix it:
   both oscillations are real and both are large. The longer refractory window
   at LOW sensitivity is the fix, and this is the test that says so. */
{
  const perOsc = 1000; // two of these per rep = a ~2s sit-up
  const doubled = [...still(1500, 0.05), ...reps(16, 3, perOsc), ...still(800, 0.05)];
  const atNormal = run(createMotionDetector(), doubled).counted;
  const atLow = run(createMotionDetector({ sensitivity: 'low' }), doubled).counted;
  assert.strictEqual(atNormal, 16, 'normal counts every oscillation — 8 sit-ups read as 16');
  assert.strictEqual(atLow, 8, 'low sensitivity collapses the double-bump back to 8 real reps');
}

/* A signal too weak for the default catches at high sensitivity. That is the
   whole point of the control: a gentle movement with the phone in a pocket
   still gets counted when the user asks for it. */
{
  const weak = [...still(1500, 0.03), ...reps(10, 1.2, 1800)];
  const low = run(createMotionDetector({ sensitivity: 'low' }), weak).counted;
  const high = run(createMotionDetector({ sensitivity: 'high' }), weak).counted;
  assert.ok(high > low, `high sensitivity (${high}) must catch more than low (${low}) on a weak signal`);
}

/* ---------- stream health ---------- */

/* A gap in the stream (backgrounded app, locked screen) re-warms rather than
   feeding a one-second step into averages tuned for 20ms. */
{
  const d = createMotionDetector();
  const first = run(d, [...still(1500, 0.05), ...reps(3, 3, 1200)]);
  assert.strictEqual(first.counted, 3);

  const afterGap = feedSample(first.state, first.endT + STALL_MS + 500, GRAVITY);
  assert.strictEqual(afterGap.counted, false);
  assert.ok(isWarmingUp(afterGap.state, afterGap.state.startedAt), 're-seeded after a stall');
  assert.strictEqual(afterGap.state.count, 3, 'a stall must not lose the count so far');
}

/* Garbage in, nothing out: a sensor that yields NaN must not corrupt the
   averages or throw. */
{
  const d = createMotionDetector();
  const seeded = run(d, still(1500, 0.05));
  const bad = feedSample(seeded.state, seeded.endT, NaN);
  assert.strictEqual(bad.counted, false);
  assert.strictEqual(bad.state, seeded.state, 'a NaN sample returns the SAME state object');
  const badTime = feedSample(seeded.state, NaN, GRAVITY);
  assert.strictEqual(badTime.state, seeded.state);
}

/* Purity: feeding a sample must not mutate the state handed in. */
{
  const d = createMotionDetector();
  const seeded = run(d, [...still(1500, 0.05), ...reps(2, 3, 1200)]);
  const before = { ...seeded.state };
  feedSample(seeded.state, seeded.endT, GRAVITY + 5);
  assert.deepStrictEqual({ ...seeded.state }, before, 'feedSample must not mutate its input');
}

console.log('motion-count OK (reps counted, stillness ignored, sensitivity ordered, stalls re-warmed)');
