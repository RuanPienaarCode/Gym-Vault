'use strict';
/* countdown.js — the one count-in rule, and the invariant that keeps it from
   eating a set.

   WHY THIS FILE EXISTS: there are now three places that count "3, 2, 1" —
   the set-by-set gate, the freestyle counter, and the last three seconds of
   every timed interval. They render differently on purpose, but they must
   AGREE on when 3 is 3, or the spoken count and the clock drift apart by a
   second and the app feels broken in a way nobody can quite name. */
const assert = require('node:assert');
const Module = require('node:module');

/* countdown.js requires sound.js, which is window-free-safe; nothing here
   touches the DOM helpers, so no obsidian stub is needed. */
const countdown = require('../src/countdown');

/* ---------- countInNumber: the ceil rule ---------- */

/* Math.ceil, not floor. With 2.9s left the display must already say 3 — that
   is the instant a human expects to hear "three". floor() would hold 2 until
   a whole second had gone, landing the whole count a second behind the clock
   it is counting down. */
assert.strictEqual(countdown.countInNumber(3.0), 3);
assert.strictEqual(countdown.countInNumber(2.9), 3);
assert.strictEqual(countdown.countInNumber(2.0), 2);
assert.strictEqual(countdown.countInNumber(1.999), 2);
assert.strictEqual(countdown.countInNumber(1.0), 1);
assert.strictEqual(countdown.countInNumber(0.001), 1);

/* Zero and past-zero are NOT "0" — nobody says zero. That moment belongs to
   the word at the end, which is the caller's to raise. */
assert.strictEqual(countdown.countInNumber(0), null);
assert.strictEqual(countdown.countInNumber(-1), null);

/* Above the starting number there is nothing to show yet: a ten-second rest
   must not spend seven of them displaying "10, 9, 8…". */
assert.strictEqual(countdown.countInNumber(4), null);
assert.strictEqual(countdown.countInNumber(3.01), null);

/* A caller can count in from further out. */
assert.strictEqual(countdown.countInNumber(4.5, 5), 5);
assert.strictEqual(countdown.countInNumber(9, 5), null);

/* Every number from the top down to 1 must be reachable — a sequence that
   skips one is a countdown that stutters. */
{
  const seen = new Set();
  for (let t = countdown.COUNT_IN_FROM; t > 0; t -= 0.05) {
    const n = countdown.countInNumber(t);
    if (n !== null) seen.add(n);
  }
  assert.deepStrictEqual(
    [...seen].sort((a, b) => b - a), [3, 2, 1],
    'the count-in must pass through every number from the top to 1',
  );
}

/* ---------- the shared constants ---------- */

assert.strictEqual(countdown.COUNT_IN_FROM, 3);
assert.ok(countdown.TICK_MS < 1000, 'the ring must tick faster than once a second, or it jerks');
assert.ok(1000 % countdown.TICK_MS === 0, 'a tick that does not divide a second makes the numbers land unevenly');
assert.ok(typeof countdown.GO_WORD === 'string' && countdown.GO_WORD.length,
  'the word at zero is shown on screen as well as spoken — it has to exist for a muted user');

/* ---------- runCountIn: onDone fires exactly once ---------- */

/* THE INVARIANT. onDone advances the session by one set. Firing it twice
   skips a set silently; firing it zero times strands the user on a
   countdown that has finished. Both are unrecoverable from the user's side,
   so the guard is here rather than left to a browser check. */
{
  /* A DOM stub just deep enough for runCountIn: it builds nodes by hand
     (createElement / createElementNS) because it has no obsidian import. */
  const mkNode = () => {
    const n = {
      nodeType: 1, className: '', textContent: '', type: '',
      children: [], attrs: {}, listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      appendChild(c) { this.children.push(c); return c; },
      append(...cs) { for (const c of cs) this.children.push(c); },
      addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
      focus() {},
      remove() {},
    };
    n.classList.add = () => {};
    return n;
  };

  const origDoc = global.document;
  const origWin = global.window;
  let now = 1000;
  const timers = new Map();
  let nextId = 1;

  global.document = { createElement: mkNode, createElementNS: mkNode };
  global.window = {
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { fn, ms, kind: 'i' }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, ms, kind: 't' }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  /* runCountIn reads Date.now() for elapsed time — drive it by hand so the
     test is deterministic rather than sleeping for three real seconds. */
  const origNow = Date.now;
  Date.now = () => now;

  const runTimers = () => {
    for (const [id, t] of [...timers]) {
      if (t.kind === 't') timers.delete(id);
      t.fn();
    }
  };

  try {
    /* ---- runs to completion: exactly one onDone ---- */
    let calls = 0;
    const host = mkNode();
    countdown.runCountIn(host, { from: 3, muted: true, onDone: () => { calls++; } });

    now += 3200;          // past zero
    runTimers();          // interval fires -> finish(false) -> schedules the 420ms handoff
    assert.strictEqual(calls, 0, 'the word at zero must be visible before the set replaces it');
    runTimers();          // the handoff timeout
    assert.strictEqual(calls, 1, 'onDone must fire once the count-in ends');

    now += 5000;
    runTimers();          // nothing left should be ticking
    assert.strictEqual(calls, 1, 'a finished count-in must not keep firing');

    /* ---- skipped: onDone fires once, immediately, with no handoff pause ---- */
    calls = 0;
    timers.clear();
    const host2 = mkNode();
    countdown.runCountIn(host2, { from: 3, muted: true, onDone: () => { calls++; } });
    const gate = host2.children[0];
    gate.listeners.click[0]();
    assert.strictEqual(calls, 1, 'a skip hands over immediately — no waiting for a word just dismissed');
    gate.listeners.click[0]();
    assert.strictEqual(calls, 1, 'tapping twice must not advance two sets');
    now += 5000;
    runTimers();
    assert.strictEqual(calls, 1, 'a skipped count-in must stop its own timer');

    /* ---- cancelled (teardown): onDone must NOT fire ---- */
    /* Leaving the page mid-count is not the same as skipping. A cancel that
       called onDone would advance a session the user has just walked away
       from. */
    calls = 0;
    timers.clear();
    const host3 = mkNode();
    const stop = countdown.runCountIn(host3, { from: 3, muted: true, onDone: () => { calls++; } });
    stop();
    now += 9000;
    runTimers();
    assert.strictEqual(calls, 0, 'teardown must never advance the session');
    assert.strictEqual(timers.size, 0, 'teardown must clear the interval');

    /* A cancelled count-in that is then clicked (a detached node still in
       someone's hand) must stay dead. */
    host3.children[0].listeners.click[0]();
    assert.strictEqual(calls, 0, 'a torn-down count-in must ignore a late tap');

    /* ---- torn down DURING the handoff window ---- */
    /* The nastiest gap: the count reached zero, "Begin" is on screen, and
       the handoff to the set is still pending when the user leaves. The tick
       interval is already cleared by then, so a teardown that only clears
       intervals would let onDone fire against a session that no longer
       exists — advancing a discarded draft and forcing a render of whatever
       page the user actually navigated to. */
    calls = 0;
    timers.clear();
    const host4 = mkNode();
    const stop4 = countdown.runCountIn(host4, { from: 3, muted: true, onDone: () => { calls++; } });
    now += 3200;
    runTimers();                       // hits zero, schedules the handoff
    assert.strictEqual(calls, 0, 'the handoff has not fired yet');
    assert.strictEqual(timers.size, 1, 'exactly the handoff should be pending');
    stop4();                           // user leaves inside the handoff window
    assert.strictEqual(timers.size, 0, 'teardown must cancel the pending handoff too');
    runTimers();
    assert.strictEqual(calls, 0, 'a count-in torn down mid-handoff must never advance the session');
  } finally {
    Date.now = origNow;
    global.document = origDoc;
    global.window = origWin;
  }
}

console.log('countdown OK (ceil rule shared by all three count-ins; onDone fires exactly once, never on teardown)');
