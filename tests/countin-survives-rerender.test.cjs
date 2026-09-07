'use strict';
/* THE COUNT-IN GATE SURVIVES A GENUINE RE-RENDER (0.11.2 journey audit,
   finding L8).

   THE BUG THIS REPRODUCES. page-session.js's own comment claimed the gate
   "can re-render for any of the reasons it does — a mute toggle, motion
   switched on, a typed weight — without restarting the count", but none of
   those interaction paths actually call ctx.rerender() — they patch their
   own corner of the DOM directly. The one thing that DOES force a full
   re-render mid-gate (a vault sync landing while five seconds are counting
   down) rebuilds repsBody/durationBody from scratch, and that used to mean
   a fresh attachCountIn seeded from a fresh Date.now() every time — putting
   the numeral straight back to 5 no matter how far into the count it was.

   THE FIX: the sequencer now accepts `startedAt`, and page-session.js
   persists the ORIGINAL start stamp on `sess` (keyed by position, next to
   sess.countedIn) so a rebuild resumes the same clock instead of starting
   a new one. This file proves countdown.js honours `startedAt` (the layer
   that actually owns the remaining-time math), and pins that the forwarding
   chain (attachCountIn -> startCountIn, page-session.js -> attachCountIn)
   is actually wired, the same style countin-mute-live.test.cjs used for the
   `muted` getter. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const countdown = require('../src/countdown');

/* ---------- 1. countdown.js: a resumed count-in is already partway in ---- */
{
  const origNow = Date.now;
  let now = 1000000;
  Date.now = () => now;

  const origWindow = global.window;
  const timers = new Map();
  let nextId = 1;
  global.window = {
    setInterval(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn) { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const runTimers = () => { for (const fn of [...timers.values()]) fn(); };

  try {
    /* A gate that started 2 real seconds ago, resumed with the ORIGINAL
       stamp: the first tick must already read "3" (5 - 2 = 3 remaining),
       never a fresh "5". */
    const startedAt = now - 2000;
    const numbers = [];
    countdown.startCountIn({
      from: 5, muted: true, startedAt,
      onNumber: n => numbers.push(n),
      onGo: () => {},
      onDone: () => {},
    });
    now += 100; // one tick, TICK_MS later
    runTimers();
    assert.deepStrictEqual(numbers, [3],
      'a count-in resumed from a 2-second-old stamp must read 3, not restart at 5 — this is the exact regression reported');

    /* And with no startedAt at all (a genuinely fresh gate), the first
       number must still be the top of the count — resuming must never
       become the only way to get a correct countdown. */
    timers.clear();
    const freshNumbers = [];
    countdown.startCountIn({
      from: 5, muted: true,
      onNumber: n => freshNumbers.push(n),
      onGo: () => {}, onDone: () => {},
    });
    now += 100;
    runTimers();
    assert.deepStrictEqual(freshNumbers, [5], 'a fresh count-in (no startedAt) must still start at the top');
  } finally {
    Date.now = origNow;
    global.window = origWindow;
  }
}

/* ---------- 2. THE FORWARDING CHAIN IS ACTUALLY WIRED ---------- */
{
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

  assert.match(read('rep-counter-shared.js'), /startedAt: o\.startedAt/,
    'attachCountIn must forward startedAt to startCountIn, not drop it on the floor');

  const session = read('page-session.js');
  const startedForCount = (session.match(/countInStartedFor/g) || []).length;
  assert.ok(startedForCount >= 4,
    'both the rep gate and the hold gate must persist and reuse countInStartedFor/countInStartedAt on sess');
  assert.match(session, /startedAt: sess\.countInStartedAt/,
    'the rep counter must hand its persisted stamp to attachCountIn');
  /* Two attachCountIn call sites (reps, duration) must each pass it. */
  assert.strictEqual((session.match(/startedAt: sess\.countInStartedAt/g) || []).length, 2,
    'both count-in call sites (reps and duration/hold) must forward the persisted stamp');
}

console.log('count-in survives re-render OK (a genuine rebuild mid-gate resumes the same clock instead of restarting at the top)');
