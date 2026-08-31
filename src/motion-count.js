'use strict';
/* Pure rep counting from accelerometer samples — no DOM, no device APIs, no
   clock of its own, so every threshold and every edge case is unit-testable
   without a phone. motion-source.js is the only caller: it owns the
   permission prompt, the `devicemotion` subscription and the side effects,
   and leaves the decision "was that a rep?" to this module.

   WHY MAGNITUDE, NOT AN AXIS. The phone can be flat on the floor, strapped to
   an arm, in a pocket or held at the chest, and it rotates through the rep in
   most of those. |a| = sqrt(x²+y²+z²) is the same signal whichever way up the
   device is, so nothing here has to know or care about orientation. The cost
   is that magnitude alone cannot tell up from down — which is why a rep is
   defined below as a full oscillation rather than a single peak.

   THE SIGNAL. Two exponential moving averages over the magnitude:

     fast (τ≈0.12s)  smooths sensor noise without blunting a real rep
     slow (τ≈1.6s)   tracks gravity and posture — the thing to subtract

   s = fast − slow is what a rep actually looks like: a swing below zero on
   the way down and above zero on the way up, sitting on a baseline that
   drifts harmlessly as the phone changes orientation. Gravity never has to be
   measured or assumed, which matters because `accelerationIncludingGravity`
   and `acceleration` differ by exactly 9.8 and both are in the wild.

   A REP IS A FULL CYCLE. s must fall below −threshold (ARMED — you went down)
   and then rise above +threshold (COUNTED — you came back up). One squat is
   one down and one up, so counting on the up-crossing gives one rep per
   squat rather than two. A single jolt — setting the phone down, a knock,
   one stray bounce — only ever crosses one way, and is silently ignored.

   THE THRESHOLD ADAPTS. Someone's push-up on a rug and their pull-up on a bar
   do not produce the same amplitude, and no fixed number serves both. The
   detector tracks a decaying peak of |s| and asks for a fixed FRACTION of it,
   clamped into a sane band. The floor of that band is what stops a phone
   sitting on a table from counting the building's vibrations all afternoon,
   and it is the single most important number in this file. */

/* Every duration is seconds; every acceleration is m/s². */
const FAST_TAU_S = 0.12;
const SLOW_TAU_S = 1.6;

/* Nothing counts until the slow average has had time to find the baseline.
   Without this the transient of picking the phone up and settling it counts
   two or three "reps" before the set has started. */
const WARMUP_MS = 1200;

/* The floor on time between reps at NORMAL sensitivity. Deliberately close to
   the tap counter's 700ms debounce and for the same reason: a human rep of
   any of these movements takes longer than this, so anything faster is the
   signal ringing, not a person. Each sensitivity step carries its own value —
   see SENSITIVITY. */
const REFRACTORY_MS = 650;

/* A sample gap longer than this means the stream stalled — the app was
   backgrounded, the screen locked, the sensor dropped out. Rather than feed a
   1-second "gap" into averages tuned for 20ms steps, the detector re-warms as
   if it had just started. */
const STALL_MS = 700;

/* Threshold band. MIN is the noise floor: a still phone on a hard floor in a
   room with a treadmill in it reads a few tenths, and 1.1 sits clear of that
   without demanding a violent rep. MAX stops one enormous spike (a dropped
   phone) from arming a threshold no real rep can then reach. */
const MIN_THRESHOLD = 1.1;
const MAX_THRESHOLD = 6;
const THRESHOLD_FRACTION = 0.4;

/* How long a peak is remembered. Long enough to survive a slow rep, short
   enough that the first big rep of a set does not set the bar for a tiring
   tenth one. */
const PEAK_TAU_S = 6;

/* Sensitivity is TWO numbers, not one, because the two ways a rep count goes
   wrong are different problems.

   `scale` divides the threshold: HIGH means a lower bar and more reps
   counted, LOW means the opposite. That is the fix for a movement whose
   signal is too small to reach the bar (or an over-eager one that keeps
   crossing it).

   `refractoryMs` is the fix for the OTHER failure, and it is the one that
   bites on sit-ups: a trunk movement reverses direction twice per rep, so
   the accelerometer sees two oscillations for every one sit-up and counts
   double. Raising the threshold does not help — both oscillations are real
   and both are large. Demanding a longer gap between reps does, because no
   one does two genuine sit-ups in a second.

   Named steps rather than numbers, because "1.4" means nothing to someone
   standing under a pull-up bar. */
const SENSITIVITY = {
  low: { scale: 0.7, refractoryMs: 1200 },
  normal: { scale: 1, refractoryMs: REFRACTORY_MS },
  high: { scale: 1.4, refractoryMs: 450 },
};

/* Read a sensitivity off whatever the caller has — an exercise note's
   `motion_sensitivity` frontmatter, a settings value, a raw string. Anything
   unrecognised (missing, misspelt, a number someone typed) falls back to
   normal rather than throwing, because this value arrives from a text file a
   human edits. */
function sensitivityKey(value) {
  const k = String(value == null ? '' : value).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SENSITIVITY, k) ? k : 'normal';
}

function createMotionDetector(opts) {
  const o = opts || {};
  const step = SENSITIVITY[sensitivityKey(o.sensitivity)];
  return {
    sensitivity: step.scale,
    refractoryMs: step.refractoryMs,
    /* null until the first sample — the averages seed FROM it rather than
       from zero, so the detector does not spend its warm-up climbing out of
       a hole 9.8 deep. */
    fast: null,
    slow: null,
    peak: 0,
    phase: 'ready',     // 'ready' → waiting to go down; 'armed' → came down, waiting to come up
    startedAt: null,    // first sample's time, for the warm-up window
    lastT: null,
    lastRepAt: -Infinity,
    count: 0,
  };
}

/* alpha for an EMA with time constant τ over an irregular step dt. Sample
   rates vary by device and drop under load, so the smoothing has to be
   expressed in seconds rather than in samples. */
function alphaFor(dtSeconds, tauSeconds) {
  if (!(dtSeconds > 0)) return 0;
  return 1 - Math.exp(-dtSeconds / tauSeconds);
}

/* Feed one sample. `t` is milliseconds from the caller's clock (Date.now() in
   production, a fixed series in tests) and `mag` is |acceleration|.

   Returns { state, counted } and NEVER mutates the input — same contract as
   rep-counter.js's tap(), so both counting surfaces behave identically when a
   caller holds on to an old state. */
function feedSample(state, t, mag) {
  if (!Number.isFinite(t) || !Number.isFinite(mag)) return { state, counted: false };

  /* First sample, or the stream stalled: (re)seed and start the warm-up. */
  if (state.fast === null || state.lastT === null || t - state.lastT > STALL_MS || t < state.lastT) {
    return {
      state: { ...state, fast: mag, slow: mag, peak: 0, phase: 'ready', startedAt: t, lastT: t },
      counted: false,
    };
  }

  const dt = (t - state.lastT) / 1000;
  const fast = state.fast + alphaFor(dt, FAST_TAU_S) * (mag - state.fast);
  const slow = state.slow + alphaFor(dt, SLOW_TAU_S) * (mag - state.slow);
  const s = fast - slow;

  /* Peak decays toward |s| from above and jumps to it from below, so the
     threshold follows a set that is getting weaker and reacts immediately to
     one that gets stronger. */
  const decay = Math.exp(-dt / PEAK_TAU_S);
  const peak = Math.max(Math.abs(s), state.peak * decay);

  const threshold = Math.min(
    MAX_THRESHOLD,
    Math.max(MIN_THRESHOLD / state.sensitivity, (peak * THRESHOLD_FRACTION) / state.sensitivity),
  );

  const next = { ...state, fast, slow, peak, lastT: t };
  const warm = state.startedAt !== null && t - state.startedAt >= WARMUP_MS;

  if (!warm) return { state: next, counted: false };

  if (state.phase === 'ready') {
    if (s <= -threshold) next.phase = 'armed';
    return { state: next, counted: false };
  }

  /* phase === 'armed': the movement went down, so the next crossing UP is a
     completed rep — unless it lands inside the refractory window, in which
     case it is the same rep's overshoot ringing and the detector simply
     re-arms without counting. */
  if (s >= threshold) {
    next.phase = 'ready';
    if (t - state.lastRepAt < (state.refractoryMs || REFRACTORY_MS)) return { state: next, counted: false };
    next.lastRepAt = t;
    next.count = state.count + 1;
    return { state: next, counted: true };
  }
  return { state: next, counted: false };
}

/* The threshold the detector would use right now — for a sensitivity picker
   that wants to show its work, and for tests that assert on the band rather
   than on an internal field. */
function currentThreshold(state) {
  return Math.min(
    MAX_THRESHOLD,
    Math.max(MIN_THRESHOLD / state.sensitivity, (state.peak * THRESHOLD_FRACTION) / state.sensitivity),
  );
}

/* Is the detector still finding its baseline at time `t`? The UI says so
   rather than looking like it has failed for the first second. */
function isWarmingUp(state, t) {
  return state.startedAt === null || t - state.startedAt < WARMUP_MS;
}

module.exports = {
  createMotionDetector, feedSample, currentThreshold, isWarmingUp, sensitivityKey,
  SENSITIVITY, WARMUP_MS, REFRACTORY_MS, MIN_THRESHOLD, MAX_THRESHOLD, STALL_MS,
};
