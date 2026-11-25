'use strict';
/* AUDIT 25 NOV 2026, LANE SESSION, finding 38 (schedule half): timed mode chopped
   a run-only day into 45-second laps. "Long Trail Run | 1 x per the ladder" on a
   15-minute dial became 17 work intervals with 16 "next up" breaks between laps
   of the same run.

   Decision (lead): a day whose work items are all one-set runs is not a circuit.
   Each run is ONE continuous work interval, the dial's minutes shared between
   them, no repeats and no "next up" between laps of the same run. A run's written
   time is never cut (the first interval never was: audit 16 Nov 2026 #37). A
   mixed day is unchanged. Pure: timed-plan.buildSchedule / giveTimeBack. */
const assert = require('node:assert');
const tp = require('../src/timed-plan');

const run = (exercise, target, sets) => ({ exercise, target, unit: 'km', sets: sets == null ? 1 : sets });
const item = (exercise, target, unit, sets) => ({ exercise, target, unit: unit || null, sets: sets || 3 });
const works = s => s.intervals.filter(i => i.kind === 'work');
const breaks = s => s.intervals.filter(i => i.kind === 'transition' && !i.leadIn);

const results = [];
const check = (name, fn) => { try { fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };

check('38a. a run-only day is ONE continuous interval that fills the dial (15/30/45 min)', () => {
  for (const minutes of [15, 30, 45]) {
    const s = tp.buildSchedule([run('Long Trail Run', 'per the ladder')], { minutes, seed: 1 });
    assert.strictEqual(works(s).length, 1, `${minutes} min: ${works(s).length} work intervals, want 1`);
    assert.strictEqual(breaks(s).length, 0, `${minutes} min: no "next up" between laps of one run`);
    assert.strictEqual(s.totalSeconds, minutes * 60, `${minutes} min: scheduled ${s.totalSeconds}s`);
    assert.strictEqual(s.rounds, 1);
    assert.deepStrictEqual(s.setsPerEntry, [1]);
    assert.strictEqual(works(s)[0].setIndex, 0);
  }
});

check('38a. two runs share the dial: one interval each, one break between them, clock filled', () => {
  for (const minutes of [15, 30, 45]) {
    const s = tp.buildSchedule([run('Easy Run', 'easy'), run('Cool-down Jog', 'easy')], { minutes, seed: 1 });
    assert.deepStrictEqual(works(s).map(w => w.exercise), ['Easy Run', 'Cool-down Jog'], `${minutes} min`);
    assert.strictEqual(breaks(s).length, 1, 'the break names the second run');
    assert.strictEqual(s.totalSeconds, minutes * 60);
    const [a, b] = works(s).map(w => w.seconds);
    assert.ok(Math.abs(a - b) <= 1, `shared evenly: ${a} vs ${b}`);
  }
});

check('38a. a run\'s written time is never cut: `1 x 30 min easy` on a 10-minute dial stays 30 min', () => {
  const s = tp.buildSchedule([run('Easy Run', '30 min easy')], { minutes: 10, seed: 1 });
  assert.strictEqual(works(s).length, 1);
  assert.strictEqual(works(s)[0].seconds, 1800);
});

check('38a. and on a longer dial the one run takes the whole dial, not a second lap', () => {
  const s = tp.buildSchedule([run('Easy Run', '30 min easy')], { minutes: 45, seed: 1 });
  assert.strictEqual(works(s).length, 1, 'no second interval of the same run');
  assert.strictEqual(s.totalSeconds, 45 * 60);
});

check('38a. warm-up and cool-down still come out of the time', () => {
  const s = tp.buildSchedule([run('Easy Run', 'easy')], {
    minutes: 20, seed: 1, warmup: true, cooldown: true, warmupItems: ['Cat-Cow'], cooldownItems: ['Hamstring Stretch'],
  });
  assert.strictEqual(s.totalSeconds, 20 * 60);
  assert.strictEqual(works(s).length, 1);
  assert.strictEqual(s.intervals[s.intervals.length - 1].kind, 'cooldown');
});

check('38a. skipping the first of two runs hands its time to the second, nothing already played moves', () => {
  const s = tp.buildSchedule([run('Easy Run', 'easy'), run('Cool-down Jog', 'easy')], { minutes: 30, seed: 1 });
  const first = s.intervals.findIndex(i => i.kind === 'work');
  const after = tp.giveTimeBack(s, 200, first);
  assert.strictEqual(after.totalSeconds, s.totalSeconds + 200);
  assert.deepStrictEqual(after.intervals.slice(0, first + 1), s.intervals.slice(0, first + 1));
  assert.strictEqual(works(after).length, 2, 'still two runs, no extra lap');
  assert.strictEqual(works(after)[1].seconds, works(s)[1].seconds + 200);
});

check('38a. skipping the only run adds no lap of it', () => {
  const s = tp.buildSchedule([run('Long Trail Run', 'per the ladder')], { minutes: 15, seed: 1 });
  const at = s.intervals.findIndex(i => i.kind === 'work');
  const after = tp.giveTimeBack(s, 300, at);
  assert.strictEqual(works(after).length, 1);
});

check('control: a mixed day is unchanged - the one-off run plays once, the laps fill the clock', () => {
  const s = tp.buildSchedule([run('Easy Run', '5 min easy'), item('Push-ups', '10'), item('Squats', '12')], { minutes: 30, seed: 1 });
  assert.strictEqual(works(s).filter(w => w.exercise === 'Easy Run').length, 1);
  assert.ok(works(s).filter(w => w.exercise === 'Push-ups').length > 3, 'laps repeat');
  assert.strictEqual(s.totalSeconds, 30 * 60);
});

check('control: a run written as repeats is still interval training and comes back each round', () => {
  const s = tp.buildSchedule([run('Hill Repeats', '3 min hard', 6)], { minutes: 30, seed: 1 });
  assert.ok(works(s).length > 1, 'repeats are the session');
});

const failed = results.filter(([, e]) => e);
for (const [name, e] of failed) console.error(`FAIL ${name}\n  ${e && e.message}`);
if (failed.length) process.exit(1);
console.log(`audit-1125 session timed runs OK (${results.length} checks)`);
