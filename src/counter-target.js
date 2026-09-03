'use strict';
/* What a counter is counting TOWARDS — and how far along it is.

   Pure: no DOM, no obsidian, no timers. The counter surfaces (the freestyle
   modal, the guided set screen) own the pixels; this owns the arithmetic, so
   "am I at 80% of my target" cannot come to mean two different things on two
   screens.

   A TARGET IS NOT A RESULT. Everything here describes an intention — what
   you said you were going for before you started. Nothing in this module may
   ever be written into a set as a logged figure; the codebase already draws
   that line with `set.touched` and applyCompletion's `measured` flag,
   precisely because a prefilled number that got saved as if it were observed
   is the bug shape this project keeps digging out. */

const { targetFirstNumber, targetDurationSeconds } = require('./plan-parse');

const KINDS = ['reps', 'seconds'];

/* A target is {kind, value} or null. null means OPEN-ENDED — count as long
   as you like — which is a real and deliberate choice, not a missing value:
   the fill bar simply does not appear, because a progress bar with no
   destination is a lie. */
function makeTarget(kind, value) {
  if (!KINDS.includes(kind)) return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  /* Zero is not a target ("do zero reps" is not a set) and neither is a
     negative or a NaN. All of them read as open-ended rather than as an
     error: this comes from a text box, and the worst outcome of a fumbled
     entry is a counter that just counts. */
  if (!Number.isFinite(n) || n <= 0) return null;
  /* Reps are whole. Seconds are not — a 2.5-minute hold is 150, and
     rounding it would be arbitrary — but a fractional REP does not exist. */
  return { kind, value: kind === 'reps' ? Math.round(n) : n };
}

/* The target a PLAN line already implies, so the guided screen does not have
   to ask a question the plan has already answered.

   `entry.target` IS THE RIGHT-HAND SIDE ONLY — plan-parse has already split
   "4 x 12" into {sets: 4, target: "12"} by the time a draft entry exists,
   and the set count lives on entry.sets. Read it as the whole prescription
   and the first number you find is the SET count, so a "4 x 12" set fills up
   at four reps and celebrates two thirds early.

   Reuses plan-parse's own helpers rather than parsing again here:
   page-log.js's makeEntry already turned this same string into a prefilled
   12 with exactly these two calls, and a second parser would eventually
   disagree with the first about something like "8-10". */
function targetFromEntry(entry) {
  if (!entry || entry.distance) return null; // a run is not counted, it is measured
  const raw = entry.target || '';
  /* "2 min" is 120 seconds, not 2. The meter used to fill against the bare
     number, so a two-minute hold showed as complete after two seconds. */
  const written = targetDurationSeconds(raw);
  if (written) return makeTarget('seconds', written);
  const n = targetFirstNumber(raw);
  if (n === null || n === undefined) return null;
  return makeTarget(entry.duration ? 'seconds' : 'reps', n);
}

/* THE STOPWATCH'S STARTING FIGURE FOR A HOLD — and the reason it is not
   simply set.seconds.

   makeEntry prefills a duration entry's `seconds` from the plan ("60s" -> 60)
   and marks it `touched: false`. durationBody seeded the stopwatch with that
   number, so after Begin the big numeral read 0:30 while elapsed was zero,
   until the first one-second tick caught up. A tap-to-stop inside that window
   logged about 0s against a display that had just said 0:30 — two figures
   derived by different rules, which is the failure this codebase keeps
   finding, and the same one timedSetValues fixes on the save side.

   A TARGET IS NOT ELAPSED TIME. The prefill stays what it always was, the
   fill meter's target. Only a figure the user actually measured — a touched
   set, which is a genuine resume — is a time to start counting from. */
function resumeSeconds(set) {
  if (!set || !set.touched) return 0;
  const n = parseFloat(set.seconds);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* How far along, as a fraction. Deliberately NOT clamped at 1: going past
   the target is the good outcome, and the surface deciding how to celebrate
   an overshoot needs to be able to tell 1.0 from 1.4. Clamp at the point of
   use, not here. Returns 0 with no target — callers should be checking for
   null first, and 0 is the safe thing to draw. */
function fillFraction(count, target) {
  if (!target || !target.value) return 0;
  const n = typeof count === 'number' ? count : parseFloat(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / target.value;
}

/* The escalation stage a fill is in, as a name the stylesheet keys off.
   Named stages rather than raw percentages in the CSS because the thresholds
   are a design decision that belongs in one place, testable, instead of
   spread across a stylesheet as magic numbers.

     idle  nothing yet
     warm  under way
     hot   past halfway
     peak  the last stretch — this is where it should start to feel urgent
     done  target met or beaten

   'done' covers overshoot too: once you are past the target the interesting
   thing is that you beat it, not by how much the bar has overflowed. */
function fillStage(fraction) {
  const f = Number.isFinite(fraction) ? fraction : 0;
  if (f >= 1) return 'done';
  if (f >= 0.8) return 'peak';
  if (f >= 0.5) return 'hot';
  if (f > 0) return 'warm';
  return 'idle';
}

/* How a target reads on screen. Seconds are shown as seconds here rather
   than through fmtSeconds: this is the goal you set ("45s"), not a running
   clock, and "0:45" for a thing you typed as 45 reads as a conversion. */
function describeTarget(target) {
  if (!target) return '';
  if (target.kind === 'seconds') return `${target.value}s`;
  return `${target.value} reps`;
}

/* Quick picks offered before a freestyle count, so the common case is one
   tap rather than a keyboard. Not configurable and not learned from history
   on purpose — a picker whose options move around is a picker you have to
   read every time. */
const QUICK_REPS = [5, 8, 10, 12, 15, 20, 25, 30];
const QUICK_SECONDS = [20, 30, 45, 60, 90, 120];

module.exports = {
  KINDS, QUICK_REPS, QUICK_SECONDS,
  makeTarget, targetFromEntry, resumeSeconds, fillFraction, fillStage, describeTarget,
};
