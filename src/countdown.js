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

/* "3, 2, 1" — the last three seconds. Long enough to get into position,
   short enough that nobody taps past it. */
const COUNT_IN_FROM = 3;
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

/* THE GATE: a full-bleed count-in that runs, then hands over.

   opts:
     from      seconds to count from (default 3)
     label     what this is a count-in TO ("Push-ups · set 2 of 3")
     muted     this session's mute toggle — silences the app's own voice,
               never the aria-live region (a screen-reader user is not
               using the app's speech, and must not lose the cue with it)
     settings  passed to sound.js for the mode and voice
     onDone    called exactly once, whether it ran out or was skipped

   Returns a cancel function. Cancelling does NOT call onDone — that is for
   teardown (leaving the page mid-count), which is a different thing from
   skipping. onDone firing exactly once is the invariant everything else here
   is arranged around: it advances the screen, and advancing twice would eat
   a set. */
function runCountIn(host, opts) {
  const o = opts || {};
  const from = o.from == null ? COUNT_IN_FROM : o.from;
  const done = typeof o.onDone === 'function' ? o.onDone : () => {};

  let finished = false;
  let timer = null;
  /* The handoff timeout is held separately from the tick interval because it
     outlives it: finish() clears the interval and THEN schedules this. A
     teardown landing in that gap has to be able to cancel it, or onDone
     fires against a session the user has already walked away from. */
  let handoff = null;
  const startedAt = Date.now();
  let lastShown = null;

  const ring = countdownRing(220);
  const numberEl = document.createElement('div');
  numberEl.className = 'gv-countin-number';
  numberEl.textContent = String(from);
  /* assertive, not polite: this is a three-second window and a queued
     announcement that arrives after "Begin" is worse than none. */
  const live = document.createElement('div');
  live.className = 'gv-sr-only';
  live.setAttribute('aria-live', 'assertive');
  live.setAttribute('aria-atomic', 'true');

  const dial = document.createElement('div');
  dial.className = 'gv-countin-dial';
  dial.append(ring.svg, numberEl);

  const labelEl = document.createElement('div');
  labelEl.className = 'gv-countin-label';
  labelEl.textContent = o.label || '';

  const hint = document.createElement('div');
  hint.className = 'gv-countin-hint';
  hint.textContent = 'Tap to start now';

  /* A real button, not a div with a listener: it has to be reachable by
     keyboard and announce itself, and "skip the countdown" is exactly the
     thing someone who cannot see the ring most wants to do. */
  const wrap = document.createElement('button');
  wrap.type = 'button';
  wrap.className = 'gv-countin clickable-icon';
  wrap.setAttribute('aria-label', `Counting in${o.label ? ` to ${o.label}` : ''}. Activate to start now.`);
  wrap.append(labelEl, dial, hint, live);

  const finish = skipped => {
    if (finished) return;
    finished = true;
    if (timer) { window.clearInterval(timer); timer = null; }
    if (!skipped) {
      live.textContent = GO_WORD;
      if (!o.muted) sound.cue('go', GO_WORD, o.settings);
      numberEl.textContent = GO_WORD;
      numberEl.classList.add('gv-countin-go');
    }
    /* One frame of "Begin" on screen before the set replaces it. Skipping
       gets no such pause — a skip is someone saying "now", and making them
       wait for a word they just dismissed would be its own small insult. */
    if (skipped) done();
    else handoff = window.setTimeout(() => { handoff = null; done(); }, GO_HOLD_MS);
  };

  wrap.addEventListener('click', () => {
    /* The click is also the user gesture iOS wants before this page may make
       a sound — the count-in is often the first thing in a session that
       tries to. Unlocking on a SKIP is not wasted: the set that follows will
       be counting reps out loud. */
    sound.unlock();
    finish(true);
  });

  timer = window.setInterval(() => {
    const remaining = from - (Date.now() - startedAt) / 1000;
    ring.set(from ? Math.max(0, remaining) / from : 0);
    const n = countInNumber(remaining, from);
    if (n !== null && n !== lastShown) {
      lastShown = n;
      numberEl.textContent = String(n);
      live.textContent = String(n);
      if (!o.muted) sound.announce(n, o.settings);
    }
    if (remaining <= 0) finish(false);
  }, TICK_MS);

  host.append(wrap);
  return () => {
    if (timer) { window.clearInterval(timer); timer = null; }
    if (handoff) { window.clearTimeout(handoff); handoff = null; }
    finished = true; // teardown, not a skip — onDone must not fire
  };
}

module.exports = { COUNT_IN_FROM, TICK_MS, GO_WORD, GO_HOLD_MS, countInNumber, countdownRing, runCountIn };
