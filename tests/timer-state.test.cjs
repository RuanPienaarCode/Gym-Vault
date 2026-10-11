'use strict';
/* THE ONE RULE FOR A CLOCK THAT CAN PAUSE (src/timer-state.js).

   Ruan, from his phone: "when user have a count down exercise there needs to
   be a pause button so if something happens user can pause and continue
   later". Three screens run a clock (the hold, the rest, the circuit's
   interval). They share ONE rule for what a pause does to the clock, so these
   cases are the whole of "paused time is never counted". Pure: `now` is
   always passed in, so "paused for 90 seconds" is exact. */
const assert = require('node:assert');
const { startClock, elapsedSeconds, pauseClock, resumeClock, frozenClock } = require('../src/timer-state');

const T0 = 1_780_000_000_000;
const s = n => n * 1000;

/* 1. a running clock reads the time since it started */
{
  const c = startClock(T0);
  assert.deepStrictEqual(c, { startedAt: T0, bankedSeconds: 0, paused: false });
  assert.strictEqual(elapsedSeconds(c, T0), 0);
  assert.strictEqual(elapsedSeconds(c, T0 + s(12.5)), 12.5);
}

/* 2. PAUSE FREEZES EXACTLY: no amount of waiting changes the figure */
{
  const p = pauseClock(startClock(T0), T0 + s(12.5));
  assert.strictEqual(p.paused, true);
  assert.strictEqual(p.bankedSeconds, 12.5, 'banks the exact elapsed value at the instant of the pause');
  assert.strictEqual(elapsedSeconds(p, T0 + s(12.5)), 12.5);
  assert.strictEqual(elapsedSeconds(p, T0 + s(12.5 + 90)), 12.5, 'ninety seconds paused still reads 12.5');
  assert.strictEqual(elapsedSeconds(p, T0 + s(10 * 3600)), 12.5, 'and so does a night');
}

/* 3. RESUME CONTINUES FROM THE SAME SECOND; the paused gap is never counted */
{
  const p = pauseClock(startClock(T0), T0 + s(12));
  const r = resumeClock(p, T0 + s(12 + 90));
  assert.strictEqual(r.paused, false);
  assert.strictEqual(elapsedSeconds(r, T0 + s(12 + 90)), 12, 'the instant of resuming reads the frozen value');
  assert.strictEqual(elapsedSeconds(r, T0 + s(12 + 90 + 8)), 20, '12 s + 8 s: the 90 s pause is not in it');
}

/* 4. several pauses accumulate only the running stretches */
{
  let c = startClock(T0);
  c = pauseClock(c, T0 + s(5));                // 5 run
  c = resumeClock(c, T0 + s(65));              // 60 paused
  c = pauseClock(c, T0 + s(65 + 7));           // 7 run  -> 12
  c = resumeClock(c, T0 + s(1000));
  assert.strictEqual(elapsedSeconds(c, T0 + s(1000 + 3)), 15);
}

/* 5. IDEMPOTENT: a double tap (or a re-render replaying a handler) must not
   count the paused time, and must not drop the running time */
{
  const p1 = pauseClock(startClock(T0), T0 + s(10));
  const p2 = pauseClock(p1, T0 + s(500));
  assert.deepStrictEqual(p2, p1, 'pausing a paused clock banks nothing more');
  assert.strictEqual(elapsedSeconds(p2, T0 + s(600)), 10);

  const r1 = resumeClock(p1, T0 + s(100));
  const r2 = resumeClock(r1, T0 + s(150));
  assert.deepStrictEqual(r2, r1, 'resuming a running clock must not restart its stamp');
  assert.strictEqual(elapsedSeconds(r2, T0 + s(104)), 14);
}

/* 6. results are NEW three-field objects, so a caller can Object.assign them
   over a record that has other state, and the input is never mutated */
{
  const c = startClock(T0);
  const frozen = JSON.stringify(c);
  const p = pauseClock(c, T0 + s(3));
  assert.strictEqual(JSON.stringify(c), frozen, 'the input is untouched');
  assert.notStrictEqual(p, c);
  assert.deepStrictEqual(Object.keys(p).sort(), ['bankedSeconds', 'paused', 'startedAt']);
  const rec = Object.assign({ index: 4, spokenAt: 2 }, p);
  assert.strictEqual(rec.index, 4, 'the other fields survive the merge');
  assert.strictEqual(rec.paused, true);
}

/* 7. hostile input never produces NaN or a negative */
{
  assert.strictEqual(elapsedSeconds(startClock(T0), T0 - s(30)), 0, 'a clock that moved backwards reads 0, not -30');
  assert.strictEqual(elapsedSeconds({ startedAt: T0, bankedSeconds: NaN, paused: false }, T0 + s(2)), 2);
  assert.strictEqual(elapsedSeconds({ startedAt: T0, bankedSeconds: -9, paused: false }, T0 + s(2)), 2);
  assert.strictEqual(elapsedSeconds({ startedAt: null, bankedSeconds: 4, paused: false }, T0), 4, 'no stamp: only what was banked');
  assert.strictEqual(elapsedSeconds(null, T0), 0);
  assert.strictEqual(pauseClock(null, T0).bankedSeconds, 0);
}

/* 7b. PAUSED WINS over a stale stamp: a frozen clock that still carries the
   stamp it was started with (a hand-built or restored one) must not read
   as running, and resuming it must restart from NOW, not from that stamp */
{
  const stale = { startedAt: T0, bankedSeconds: 5, paused: true };
  assert.strictEqual(elapsedSeconds(stale, T0 + s(100)), 5, 'paused means frozen, whatever startedAt says');
  const r = resumeClock(stale, T0 + s(100));
  assert.strictEqual(elapsedSeconds(r, T0 + s(100)), 5, 'resuming it restarts from now: the 100 s paused are not counted');
  assert.strictEqual(elapsedSeconds(r, T0 + s(103)), 8);
  assert.strictEqual(pauseClock(stale, T0 + s(100)).bankedSeconds, 5, 'and pausing it again banks nothing more');
}

/* 8. restoring a pause (leaving the session and coming back) */
{
  const f = frozenClock(23);
  assert.deepStrictEqual(f, { startedAt: null, bankedSeconds: 23, paused: true });
  assert.strictEqual(elapsedSeconds(f, T0 + s(9999)), 23);
  assert.strictEqual(elapsedSeconds(resumeClock(f, T0), T0 + s(2)), 25);
  assert.strictEqual(frozenClock(-4).bankedSeconds, 0);
}

console.log('timer-state OK (pause freezes exactly; resume continues; paused time is never counted)');
