'use strict';
const assert = require('node:assert');
const { createCounter, tap, undo, DEBOUNCE_MS } = require('../src/rep-counter');

/* Fresh counter starts at zero and never mutates in place. */
{
  const s0 = createCounter();
  assert.strictEqual(s0.count, 0);
  const { state: s1, counted } = tap(s0, 1000);
  assert.ok(counted);
  assert.strictEqual(s1.count, 1);
  assert.strictEqual(s0.count, 0, 'tap must not mutate the input state');
}

/* Debounce: a second tap inside the window doesn't count — a descending
   face registering nose+chin+forehead must land as ONE rep. */
{
  let s = createCounter();
  ({ state: s } = tap(s, 0));
  assert.strictEqual(s.count, 1);
  const r = tap(s, 300); // 300ms < 700ms default window
  assert.ok(!r.counted);
  assert.strictEqual(r.state.count, 1, 'debounced tap must not increment');
  assert.strictEqual(r.state, s, 'debounced tap returns the SAME state object');
}

/* A tap right at the edge of the window (>=) counts; a custom debounce
   window is honoured. */
{
  let s = createCounter();
  ({ state: s } = tap(s, 0));
  const atEdge = tap(s, DEBOUNCE_MS);
  assert.ok(atEdge.counted, 'a tap exactly at the debounce boundary counts');
  assert.strictEqual(atEdge.state.count, 2);

  let custom = createCounter();
  ({ state: custom } = tap(custom, 0, 200));
  assert.ok(!tap(custom, 150, 200).counted);
  assert.ok(tap(custom, 200, 200).counted);
}

/* Sustained taps outside the window each count. */
{
  let s = createCounter();
  const times = [0, 800, 1600, 2400];
  let counted = 0;
  for (const t of times) {
    const r = tap(s, t);
    s = r.state;
    if (r.counted) counted++;
  }
  assert.strictEqual(counted, times.length);
  assert.strictEqual(s.count, 4);
}

/* Undo: floors at 0, doesn't count as a tap, and does NOT reset the
   debounce window (an undo right after a real rep must not let the very
   next genuine tap slip through as a duplicate). */
{
  let s = createCounter();
  ({ state: s } = tap(s, 1000));
  const beforeUndoLastTap = s.lastTapAt;
  s = undo(s);
  assert.strictEqual(s.count, 0);
  assert.strictEqual(s.lastTapAt, beforeUndoLastTap, 'undo must not touch lastTapAt');

  s = undo(s);
  assert.strictEqual(s.count, 0, 'undo floors at zero, never negative');
}

console.log('rep-counter OK');
