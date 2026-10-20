'use strict';
/* FIX WAVE F2, item 8 (audit L3-06): A CUE IN FLIGHT IS NOT CUT.

   Every spoken "target", "new record" and "goal met" was silent. speakText cancels
   the speech queue before it speaks (fast reps must not build a backlog), and the
   callers followed the cue in the SAME TICK with announce(count) or sound.cancel()
   - which cancelled the cue before the engine had said a syllable of it.

   THE RULE (sound.js): a celebration cue (record, goal, and any cue passed
   {hold: true}) holds the floor for about as long as it takes to say. Anything
   that arrives meanwhile - a rep count, the next interval's "Next, ..." - waits
   behind it instead of cutting it; of several counts only the latest is kept (the
   backlog stays impossible), and cancel() still clears everything at once (mute,
   pause, leaving the page). Queued speech is spoken WITHOUT a cancel, so it can
   never cut a cue that runs longer than the estimate.

   Pure sound.js against a fake speechSynthesis and a fake clock. */
const assert = require('node:assert');

let now = 1_000_000;
Date.now = () => now;
const log = [];
let timers = [];
let nextId = 1;
global.window = {
  speechSynthesis: {
    speak(u) { log.push({ op: 'speak', text: String(u.text), t: now }); },
    cancel() { log.push({ op: 'cancel', t: now }); },
    getVoices: () => [],
  },
  SpeechSynthesisUtterance: class { constructor(t) { this.text = t; } },
  setTimeout(fn, ms) { const id = nextId++; timers.push({ id, fn, at: now + ms }); return id; },
  clearTimeout(id) { timers = timers.filter(t => t.id !== id); },
};
function advance(ms) {
  const end = now + ms;
  for (;;) {
    const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) break;
    timers = timers.filter(t => t !== due);
    now = due.at; due.fn();
  }
  now = end;
}
const sound = require('../src/sound.js');
const S = { soundMode: 'voice' };
const reset = () => { sound.cancel(); log.length = 0; timers = []; now += 10_000; };
const said = () => log.filter(l => l.op === 'speak' && l.text !== '').map(l => l.text);

const results = [];
const check = (name, fn) => {
  reset();
  try { fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

check('F2-8a. "target" then the rep count in the same tick: the cue is spoken and NOT cancelled; the count follows it', () => {
  sound.cue('go', 'target', S, { hold: true });
  sound.announce(12, S);
  const afterCue = log.slice(log.findIndex(l => l.text === 'target') + 1);
  assert.ok(log.some(l => l.text === 'target'), 'the cue is spoken');
  assert.ok(!afterCue.some(l => l.op === 'cancel'), `the cue was cancelled by what followed it: ${JSON.stringify(log)}`);
  assert.ok(!said().includes('12'), 'the count waits for the cue');
  advance(3000);
  assert.deepStrictEqual(said(), ['target', '12'], 'and is spoken after it');
  assert.ok(!log.slice(log.findIndex(l => l.text === 'target') + 1).some(l => l.op === 'cancel'), 'with no cancel on the way');
});

check('F2-8b. "new record" and "goal met" hold the floor by default (no opts needed)', () => {
  for (const [kind, words] of [['record', 'new record'], ['goal', 'goal met']]) {
    reset();
    sound.cue(kind, words, S);
    sound.announce(3, S);
    assert.ok(!log.slice(log.findIndex(l => l.text === words) + 1).some(l => l.op === 'cancel'), `${words} was cut`);
    advance(3000);
    assert.deepStrictEqual(said(), [words, '3']);
  }
});

check('F2-8c. the next interval\'s "begin" cue waits behind a record cue instead of cutting it', () => {
  sound.cue('record', 'new record', S);
  sound.cue('begin', 'Next, Plank', S);
  assert.ok(!log.slice(log.findIndex(l => l.text === 'new record') + 1).some(l => l.op === 'cancel'));
  assert.deepStrictEqual(said(), ['new record'], 'not yet');
  advance(3000);
  assert.deepStrictEqual(said(), ['new record', 'Next, Plank']);
});

check('F2-8d. of several counts that arrive during a cue only the LATEST is spoken (no backlog)', () => {
  sound.cue('record', 'new record', S);
  sound.announce(3, S); sound.announce(4, S); sound.announce(5, S);
  advance(3000);
  assert.deepStrictEqual(said(), ['new record', '5']);
});

check('F2-8e. cancel() still clears everything at once: nothing queued is spoken afterwards (mute, pause, leaving)', () => {
  sound.cue('record', 'new record', S);
  sound.announce(3, S);
  sound.cancel();
  log.length = 0;
  advance(5000);
  assert.deepStrictEqual(said(), [], 'the queued count died with the cancel');
  sound.announce(7, S);
  assert.deepStrictEqual(said(), ['7'], 'and the floor is free again straight away');
});

check('F2-8f. with no cue in flight nothing changes: a fast second count still cancels and replaces the first', () => {
  sound.announce(1, S);
  sound.announce(2, S);
  assert.deepStrictEqual(log.map(l => l.op === 'cancel' ? 'cancel' : l.text), ['cancel', '1', 'cancel', '2']);
});

check('F2-8g. a plain cue (begin / Begin) does not hold the floor: a count right after it behaves as before', () => {
  sound.cue('begin', 'Next, Plank', S);
  sound.announce(3, S);
  assert.deepStrictEqual(said(), ['Next, Plank', '3']);
});

check('F2-8h. the floor is released after the cue: later counts speak immediately', () => {
  sound.cue('record', 'new record', S);
  advance(4000);
  log.length = 0;
  sound.announce(9, S);
  assert.deepStrictEqual(said(), ['9']);
});

let bad = 0;
for (const [name, err] of results) {
  if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
  else console.log(`ok    ${name}`);
}
if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
console.log(`f2 sound queue OK (${results.length} cases)`);
