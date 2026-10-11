'use strict';
/* THE ONE RULE FOR A CLOCK THAT CAN PAUSE.

   Three screens run a clock the user may need to stop: the hold's stopwatch,
   the rest countdown and the timed circuit's interval. Each used to keep (or
   would have had to invent) its own start stamp, and a pause written three
   times is three chances to count the paused minutes in one of them. This is
   the single rule; page-session.js only stores the three fields it returns.

   A clock is { startedAt, bankedSeconds, paused }:
     startedAt      ms (the caller's Date.now()) when the CURRENT run began;
                    null while paused.
     bankedSeconds  seconds earned before the last pause.
     paused         true while frozen.

   Elapsed is DERIVED, never accumulated tick by tick: banked + the time since
   startedAt. A counter bumped on a timer drifts, and iOS throttles background
   timers hard enough that the drift shows inside one set. Pausing banks the
   exact elapsed value at that instant, so what the screen froze on is what the
   workout saves, and no amount of waiting changes it.

   Every function is pure and returns a NEW object holding exactly those three
   fields, so a caller that keeps other state beside the clock (an interval
   index, a `running` flag) merges the result with Object.assign and cannot
   have the clock's fields drift out of step with each other. `now` is always
   passed in: nothing here reads the wall clock, which is what lets a test
   say "paused for 90 seconds" and mean exactly that. */

const seconds = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/* A running clock that starts counting from zero at `now`. */
function startClock(now) {
  return { startedAt: now, bankedSeconds: 0, paused: false };
}

/* Seconds the clock has really run at `now`. A clock that moved backwards
   (a manual time change) never reads negative. */
function elapsedSeconds(clock, now) {
  const banked = seconds(clock && clock.bankedSeconds);
  if (!clock || clock.paused || typeof clock.startedAt !== 'number' || !Number.isFinite(clock.startedAt)) return banked;
  return banked + Math.max(0, (now - clock.startedAt) / 1000);
}

/* Freeze at `now`. Pausing a paused clock changes nothing — in particular it
   must not bank again, which would count the paused time. */
function pauseClock(clock, now) {
  /* elapsedSeconds of a paused clock is its banked value, so this is
     idempotent without a branch of its own. */
  return { startedAt: null, bankedSeconds: elapsedSeconds(clock, now), paused: true };
}

/* Carry on from the frozen value. Resuming a running clock changes nothing —
   it must not restart the stamp, which would drop the time since it began. */
function resumeClock(clock, now) {
  if (!clock || !clock.paused) {
    return { startedAt: clock && typeof clock.startedAt === 'number' ? clock.startedAt : now, bankedSeconds: seconds(clock && clock.bankedSeconds), paused: false };
  }
  return { startedAt: now, bankedSeconds: seconds(clock.bankedSeconds), paused: false };
}

/* A clock frozen at an already-known value, for restoring a pause. */
function frozenClock(bankedSeconds) {
  return { startedAt: null, bankedSeconds: seconds(bankedSeconds), paused: true };
}

module.exports = { startClock, elapsedSeconds, pauseClock, resumeClock, frozenClock };
