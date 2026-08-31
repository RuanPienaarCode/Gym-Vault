'use strict';
/* The device seam: permission, subscription, teardown. motion-count.js is
   tested on its own; what can go wrong HERE is different in kind — a listener
   that outlives its screen, a permission rejection that escapes as an
   exception, a caller handed `undefined` instead of a stop function.

   None of that needs a real accelerometer, only a `window` that behaves like
   one, so this file builds the smallest stub that can be wrong in those ways
   and drives the real module against it. (The full path — a bundled
   motion-source driven by genuine dispatched `devicemotion` events — is
   exercised in a browser; this is the part that has to stay green in CI.) */
const assert = require('node:assert');

/* ---------- a window, small enough to reason about ---------- */

function makeWindow(opts) {
  const o = opts || {};
  const listeners = {};
  const timers = new Map();
  let nextTimer = 1;
  const w = {
    listeners,
    timers,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter(f => f !== fn);
    },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    emit(type, event) { for (const fn of (listeners[type] || []).slice()) fn(event); },
    fireTimers() { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
    count(type) { return (listeners[type] || []).length; },
  };
  if (o.deviceMotion !== false) {
    w.DeviceMotionEvent = function DeviceMotionEvent() {};
    if (o.permission) w.DeviceMotionEvent.requestPermission = o.permission;
  }
  return w;
}

/* motion-source.js reads the global `window` at call time, so swapping it per
   case is enough — no module cache games needed. */
function withWindow(w, fn) {
  const had = Object.prototype.hasOwnProperty.call(global, 'window');
  const prev = global.window;
  global.window = w;
  return Promise.resolve()
    .then(fn)
    .finally(() => { if (had) global.window = prev; else delete global.window; });
}

const src = require('../src/motion-source');
const { magnitudeOf, startMotionCounter, SILENT_SENSOR_MS } = src;

/* A devicemotion event carrying one axis, so |a| is just that number. */
const sample = mag => ({ accelerationIncludingGravity: { x: mag, y: 0, z: 0 } });

/* Feed a settle period then `n` cosine reps, exactly as the pure module's
   tests do — the point here is that the events ARRIVE and are counted, not
   the detection maths. */
function drive(w, n, amp, periodMs) {
  const STEP = 20, G = 9.81;
  let t = 0;
  const emit = mag => { w.now = t; w.emit('devicemotion', sample(mag)); t += STEP; };
  for (let i = 0; i < 1500 / STEP; i++) emit(G);
  const perRep = Math.round(periodMs / STEP);
  for (let i = 0; i < n * perRep; i++) emit(G + amp * Math.cos((2 * Math.PI * i) / perRep));
  return () => t;
}

const runs = [];

/* ---------- magnitude ---------- */

runs.push(() => {
  assert.strictEqual(magnitudeOf({ accelerationIncludingGravity: { x: 3, y: 4, z: 0 } }), 5);
  /* Android devices that populate only `acceleration` must work identically. */
  assert.strictEqual(magnitudeOf({ acceleration: { x: 0, y: 0, z: 2 } }), 2);
  /* An event carrying neither is the signal that no samples are coming. */
  assert.strictEqual(magnitudeOf({ acceleration: null, accelerationIncludingGravity: null }), null);
  assert.strictEqual(magnitudeOf({ accelerationIncludingGravity: { x: null, y: 1, z: 1 } }), null);
  assert.strictEqual(magnitudeOf(null), null);
});

/* ---------- no sensor at all ---------- */

runs.push(() => withWindow(makeWindow({ deviceMotion: false }), () => {
  const seen = [];
  return startMotionCounter({ onStatus: s => seen.push(s) }).then(stop => {
    assert.deepStrictEqual(seen, ['unsupported']);
    assert.strictEqual(typeof stop, 'function', 'callers must always get a stop() to store');
    stop(); // must not throw
  });
}));

/* ---------- iOS permission ---------- */

runs.push(() => {
  const w = makeWindow({ permission: () => Promise.resolve('denied') });
  return withWindow(w, () => {
    const seen = [];
    return startMotionCounter({ onStatus: s => seen.push(s) }).then(stop => {
      assert.deepStrictEqual(seen, ['denied']);
      assert.strictEqual(w.count('devicemotion'), 0, 'a refusal must not leave a listener behind');
      stop();
    });
  });
});

/* A requestPermission that THROWS (older WebViews, and iOS when the call
   lost its user gesture) is a refusal, not a crash. */
runs.push(() => {
  const w = makeWindow({ permission: () => { throw new Error('no gesture'); } });
  return withWindow(w, () => {
    const seen = [];
    return startMotionCounter({ onStatus: s => seen.push(s) }).then(() => {
      assert.deepStrictEqual(seen, ['denied']);
    });
  });
});

/* ---------- the happy path, and its teardown ---------- */

runs.push(() => {
  const w = makeWindow({ permission: () => Promise.resolve('granted') });
  return withWindow(w, () => {
    let reps = 0;
    const seen = [];
    return startMotionCounter({
      onRep: () => reps++, onStatus: s => seen.push(s), now: () => w.now,
    }).then(stop => {
      assert.strictEqual(w.count('devicemotion'), 1, 'exactly one subscription');
      const clock = drive(w, 10, 2.5, 1600);
      assert.strictEqual(reps, 10, 'ten reps through the real event path');
      assert.deepStrictEqual(seen, ['listening'], 'status is announced once, when samples start');

      stop();
      assert.strictEqual(w.count('devicemotion'), 0, 'stop() must remove the listener');
      /* THE BUG THIS GUARDS: a subscription that outlives its screen keeps
         counting into a draft nobody is looking at. Shake the phone after
         stop() and the count must not move. */
      let t = clock();
      for (let i = 0; i < 200; i++) { w.now = t; w.emit('devicemotion', sample(9.81 + 6 * Math.cos(i / 3))); t += 20; }
      assert.strictEqual(reps, 10, 'no counting after stop()');
      stop(); // idempotent
    });
  });
});

/* Permission granted by a device that then sends nothing: say so rather than
   sitting there claiming to watch. */
runs.push(() => {
  const w = makeWindow({ permission: () => Promise.resolve('granted') });
  return withWindow(w, () => {
    const seen = [];
    return startMotionCounter({ onStatus: s => seen.push(s) }).then(stop => {
      assert.ok([...w.timers.values()].some(t => t.ms === SILENT_SENSOR_MS), 'silence timer armed');
      w.fireTimers();
      assert.deepStrictEqual(seen, ['nosensor']);
      stop();
    });
  });
});

/* An event that carries no acceleration payload is skipped without being
   mistaken for the sensor working. */
runs.push(() => {
  const w = makeWindow({ permission: () => Promise.resolve('granted') });
  return withWindow(w, () => {
    const seen = [];
    return startMotionCounter({ onStatus: s => seen.push(s), now: () => 0 }).then(stop => {
      w.emit('devicemotion', { acceleration: null, accelerationIncludingGravity: null });
      assert.deepStrictEqual(seen, [], 'an empty event is not "listening"');
      w.emit('devicemotion', sample(9.81));
      assert.deepStrictEqual(seen, ['listening']);
      stop();
    });
  });
});

runs.reduce((p, fn) => p.then(fn), Promise.resolve())
  .then(() => console.log('motion-source OK (permission paths, counting, teardown, silent sensor)'))
  .catch(e => { console.error(e); process.exit(1); });
