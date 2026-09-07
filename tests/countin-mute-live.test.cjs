'use strict';
/* MUTING PART-WAY THROUGH A COUNT-IN ACTUALLY SILENCES IT.

   THE BUG THIS REPRODUCES (0.11.2 journey audit, finding L5). The count-in
   runs for five seconds and the mute button is on screen for every one of
   them, but the flag was copied by VALUE twice on the way down —
   page-session.js built `{ muted: sess.muted }` for attachCountIn, which
   built another `{ muted: o.muted }` for startCountIn — so the sequencer was
   holding a snapshot taken before the first number was spoken. Hitting mute
   at 1.5 s still said "3, 2, 1, Begin" into a room the user had just asked
   for quiet.

   countdown.js already re-read `o.muted` on every tick; nothing upstream
   gave it anything live to re-read. `muted` may now be a FUNCTION, and the
   whole chain forwards it instead of dereferencing it.

   The timers are real, so this drives the clock rather than waiting on it:
   window.setInterval is stubbed and ticked by hand. */
const assert = require('node:assert');
const Module = require('node:module');

/* sound.js is the thing under observation — every call it receives is a
   noise the user would have heard. */
const spoken = [];
const soundStub = {
  announce: n => spoken.push(`n:${n}`),
  cue: (kind, words) => spoken.push(`cue:${kind}:${words}`),
  unlock: () => {}, cancel: () => {},
  resolveMode: () => 'speech',
};

const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') {
    return {
      setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
      ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
      normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
    };
  }
  if (req === './sound' || req === '../src/sound') return soundStub;
  return origLoad(req, ...rest);
};

/* A hand-driven clock. countdown.js reads Date.now() for the remaining
   time and window.setInterval for the ticks, so both are ours. */
let now = 1000000;
const realNow = Date.now;
Date.now = () => now;

const intervals = [];
const timeouts = [];
global.window = {
  setInterval: (fn) => { intervals.push(fn); return intervals.length; },
  clearInterval: () => {},
  setTimeout: (fn) => { timeouts.push(fn); return timeouts.length; },
  clearTimeout: () => {},
};

const countdown = require('../src/countdown');

/* Advance the clock and run every registered tick, the way a browser would. */
const advance = ms => { now += ms; for (const fn of intervals.slice()) fn(); };

/* ---- PROMISE 1: a LIVE getter is honoured mid-count ---- */

spoken.length = 0;
let muted = false;
let done = false;
countdown.startCountIn({
  from: 5,
  muted: () => muted,
  settings: {},
  onNumber: () => {},
  onGo: () => {},
  onDone: () => { done = true; },
});

advance(1200);
assert.ok(
  spoken.length > 0,
  'the count-in speaks while unmuted — if it never spoke at all this test would pass for the wrong reason.',
);
const beforeMute = spoken.length;

muted = true;
advance(4200);

assert.strictEqual(
  spoken.length, beforeMute,
  'muting part-way through a count-in must silence the REST of it. The flag used to be copied by value ' +
  'twice on the way down, so the sequencer held a snapshot from before the first number and kept talking. ' +
  `Heard after mute: ${spoken.slice(beforeMute).join(', ')}`,
);
/* "Begin" is spoken from finish(), a different call site from the per-number
   announce — the old bug reached both, so the guard has to cover both. */
assert.ok(
  !spoken.some(s => s.indexOf('cue:go') !== -1),
  `"Begin" is announced from a second call site and must respect a live mute too. Heard: ${spoken.join(', ')}`,
);

/* Silencing the voice must not silence the SESSION: onDone still fires, or
   muting mid-count-in would strand the set instead of arming it. */
for (const fn of timeouts.slice()) fn();
assert.strictEqual(done, true, 'mute silences the voice, never the handover — onDone still arms the counter.');

/* ---- PROMISE 2: a plain boolean still works (no caller had to change) ---- */

spoken.length = 0;
intervals.length = 0; timeouts.length = 0;
countdown.startCountIn({
  from: 5, muted: true, settings: {},
  onNumber: () => {}, onGo: () => {}, onDone: () => {},
});
advance(6000);
assert.deepStrictEqual(
  spoken, [],
  'a plain `muted: true` boolean must still silence the count-in — accepting a function is an addition, ' +
  'not a replacement, and rep-counter-modal.js still passes a boolean.',
);

spoken.length = 0;
intervals.length = 0; timeouts.length = 0;
countdown.startCountIn({
  from: 5, muted: false, settings: {},
  onNumber: () => {}, onGo: () => {}, onDone: () => {},
});
advance(1200);
assert.ok(spoken.length > 0, 'a plain `muted: false` boolean must still let the count-in speak.');

/* ---- SOURCE PIN: the chain forwards, it does not dereference ---- */

Date.now = realNow;
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const sessionSrc = read('page-session.js');
assert.ok(
  /muted: \(\) => sess\.muted/.test(sessionSrc),
  'page-session.js must hand the count-in a getter, not sess.muted read once — a value here collapses ' +
  'the live chain no matter what countdown.js does with it.',
);
assert.ok(
  !/muted: sess\.muted\b/.test(sessionSrc),
  'no call site may still copy sess.muted by value: one snapshot anywhere in the chain restores the bug.',
);
assert.ok(
  /muted: o\.muted\b/.test(read('rep-counter-shared.js')),
  'rep-counter-shared.js must FORWARD whatever it was given. Reading it (o.muted ? true : false, or any ' +
  'coercion) would turn a getter back into the snapshot this whole chain exists to avoid.',
);

console.log('count-in mute OK (a live getter silences the rest of the count and the "Begin" cue, the ' +
  'handover still fires, and a plain boolean still works)');
