'use strict';
/* The count-in — "3, 2, 1, Begin" — and the ring it draws itself with.

   THERE IS ONLY ONE COUNTDOWN IN THIS APP, and this is it. Timed circuits
   had one first (the last three seconds of every interval); the set-by-set
   screen and the freestyle counter now want the same thing before a set
   arms. Writing a second one is how they drift: a different starting number,
   a different word at zero, a ring that sweeps the other way, "Begin" spoken
   in one place and "Go" in another. Two figures derived by different rules
   is this codebase's recurring bug shape and a countdown is no exception.

   So the two SHAPES stay different — a gate before a set is not the last
   three seconds of a running clock — but everything they have in common
   lives here: the ring, the number sequence, the word at zero, and the
   announce cadence.

   No obsidian import: this is DOM + timers only, which is what lets
   countInNumber be unit-tested without a browser. */

const sound = require('./sound');

/* TWO NUMBERS, BECAUSE THEY ARE TWO DIFFERENT THINGS.

   COUNT_IN_FROM is the tail of a RUNNING CLOCK — the last seconds of a timed
   interval, counted out as it expires. Three is right there: the interval
   itself has been running, you already know it is nearly over, and five
   seconds of talking between short intervals is chatter.

   GATE_FROM is the count-in before a set STARTS from nothing. Three proved
   too quick in use — it is not long enough to get down onto the floor and
   set your hands — so the gate counts from five. Same sequence, same voice,
   same word at zero; only the runway is longer. */
const COUNT_IN_FROM = 3;
const GATE_FROM = 5;
/* Faster than once a second so the ring sweeps rather than jerks. Every
   spoken/shown number is gated on whole seconds regardless, so the extra
   ticks cost nothing but arithmetic. */
const TICK_MS = 200;
const GO_WORD = 'Begin';
/* How long "Begin" stays on screen before the set replaces it. Long enough
   to read, short enough that it does not feel like a pause. */
const GO_HOLD_MS = 420;

/* Which number belongs on screen with `remaining` seconds left, or null when
   the count-in is not showing one (too early, or already at zero).

   Math.ceil, not floor: 3 appears the instant the clock drops below 3.0,
   which is where a human expects to hear it — floor would show 3 only once
   a full second had already been eaten, and the count would land a second
   late against the timer it is counting. */
function countInNumber(remaining, from) {
  const top = from == null ? COUNT_IN_FROM : from;
  if (!(remaining > 0)) return null;
  const whole = Math.ceil(remaining);
  return whole <= top ? whole : null;
}

/* A ring that sweeps as a clock runs down. Decorative on purpose
   (aria-hidden): the seconds themselves are in a real element beside it, and
   a screen reader gets the meaningful moments from a live region rather than
   a per-tick stream of numbers. Built with createElementNS — no innerHTML,
   same rule as dom.js. */
function countdownRing(size) {
  const NS = 'http://www.w3.org/2000/svg';
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'gv-count-ring');
  svg.setAttribute('aria-hidden', 'true');
  const arc = cls => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', size / 2); c.setAttribute('cy', size / 2); c.setAttribute('r', r);
    c.setAttribute('class', cls);
    svg.appendChild(c);
    return c;
  };
  arc('gv-count-ring-track');
  const fill = arc('gv-count-ring-fill');
  fill.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  return {
    svg,
    set(p) {
      const clamped = Math.max(0, Math.min(1, p || 0));
      fill.setAttribute('stroke-dasharray', `${(circumference * clamped).toFixed(2)} ${circumference.toFixed(2)}`);
    },
  };
}

/* THE SEQUENCER — headless. It owns the clock, the numbers, the sound, the
   skip and the teardown; the CALLER owns every pixel.

   It used to own its own pixels too: a full-bleed screen with a ring and a
   giant numeral that REPLACED the counter, counted down, and then handed
   over. That put the countdown somewhere the counter was not, so the thing
   you were about to use appeared only once the count was finished. Now the
   counter is on screen the whole time and the numbers land in ITS display,
   which is where you are already looking.

   opts:
     from      seconds to count from (default GATE_FROM)
     muted     this session's mute toggle — silences the app's own voice,
               never a caller's aria-live (a screen-reader user is not using
               the app's speech and must not lose the cue with it)
     settings  passed to sound.js for the mode and voice
     onNumber(n)  a new whole second landed — show it
     onGo()       the count reached zero; GO_WORD is the word
     onDone()     hand over. Called EXACTLY ONCE, run out or skipped.

   Returns {stop, skip}. `skip` is what a caller wires to a tap. `stop` is
   teardown and does NOT call onDone — leaving the page mid-count is a
   different thing from saying "now", and a stop that advanced the session
   would advance one the user has walked away from. onDone firing exactly
   once is the invariant everything here is arranged around: it arms the
   counter, and arming twice would eat a set. */
function startCountIn(opts) {
  const o = opts || {};
  const from = o.from == null ? GATE_FROM : o.from;
  const done = typeof o.onDone === 'function' ? o.onDone : () => {};
  const onNumber = typeof o.onNumber === 'function' ? o.onNumber : () => {};
  const onGo = typeof o.onGo === 'function' ? o.onGo : () => {};

  let finished = false;
  let timer = null;
  /* Held separately from the tick interval because it outlives it: finish()
     clears the interval and THEN schedules this. A teardown landing in that
     gap has to be able to cancel it. */
  let handoff = null;
  const startedAt = Date.now();
  let lastShown = null;

  const finish = skipped => {
    if (finished) return;
    finished = true;
    if (timer) { window.clearInterval(timer); timer = null; }
    if (!skipped) {
      onGo();
      if (!o.muted) sound.cue('go', GO_WORD, o.settings);
    }
    /* One beat of "Begin" before the counter takes over. A SKIP gets no such
       pause — a skip is someone saying "now", and making them wait for a
       word they just dismissed would be its own small insult. */
    if (skipped) done();
    else handoff = window.setTimeout(() => { handoff = null; done(); }, GO_HOLD_MS);
  };

  timer = window.setInterval(() => {
    const remaining = from - (Date.now() - startedAt) / 1000;
    const n = countInNumber(remaining, from);
    if (n !== null && n !== lastShown) {
      lastShown = n;
      onNumber(n, from ? Math.max(0, remaining) / from : 0);
      if (!o.muted) sound.announce(n, o.settings);
    }
    if (remaining <= 0) finish(false);
  }, TICK_MS);

  return {
    /* The tap that skips is also the user gesture iOS wants before this page
       may make a sound — the count-in is often the first thing in a session
       that tries to. Unlocking on a skip is not wasted: the set that follows
       will be counting reps out loud. */
    skip() { sound.unlock(); finish(true); },
    stop() {
      if (timer) { window.clearInterval(timer); timer = null; }
      if (handoff) { window.clearTimeout(handoff); handoff = null; }
      finished = true; // teardown, not a skip — onDone must not fire
    },
  };
}

module.exports = { COUNT_IN_FROM, GATE_FROM, TICK_MS, GO_WORD, GO_HOLD_MS, countInNumber, countdownRing, startCountIn };
