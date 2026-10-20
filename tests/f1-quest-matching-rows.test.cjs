'use strict';
/* C-02: a quest only counts what the week's plan asked for.

   "Do 100 reps of Push-ups" was complete (and paid 120 XP) after a week of squats,
   because the quest's progress summed the reps column of EVERY row logged that
   week. Only rows whose exercise matches (stats.sameName) a planned item count. */
const assert = require('node:assert');
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const TODAY = '2026-10-21';
const push = [F.day('Push', [['Push-ups', 5, '20']])];
const daysOn = F.daysOnFrom({ mon: push });
const quest = (workouts, d) => R.questFor({ daysOn: d || daysOn, exercises: F.EXERCISES, workouts, today: TODAY, weekStart: 'mon' });
const squats = F.wk('2026-10-19', F.sets('Squat', 10, { reps: 10, kg: 60 }), '2026-10-19 Legs');

check('C02a reps quest: logging only squats does not progress or complete a push-up quest', () => {
  const q = quest([squats]);
  assert.strictEqual(q.kind, 'reps');
  assert.strictEqual(q.done, 0, `done ${q.done} of ${q.target}: squat reps are not push-up reps`);
  assert.strictEqual(q.complete, false);
});

check('C02b the planned exercise counts, whatever the case/spacing it was logged in', () => {
  const w = F.wk('2026-10-19', F.sets('  push-UPS ', 5, { reps: 20 }), '2026-10-19 Push');
  const q = quest([squats, w]);
  assert.strictEqual(q.done, 100);
  assert.strictEqual(q.complete, true);
});

check('C02c sets quest: only sets of planned exercises count', () => {
  const d = F.daysOnFrom({ mon: [F.day('Core', [['Plank', 3, '30s']])] });
  const w = F.wk('2026-10-19', [...F.sets('Plank', 2, { sec: 30 }), ...F.sets('Squat', 9, { reps: 5 })], 'mixed');
  const q = quest([w], d);
  assert.strictEqual(q.kind, 'sets');
  assert.strictEqual(q.done, 2, 'two planks, not eleven sets');
});

check('C02d no XP is paid for a week of unplanned work: awardsForSession does not hand out the quest', () => {
  const sets = F.sets('Squat', 10, { reps: 10, kg: 60 });
  const out = R.awardsForSession({ workoutKey: 'Gym/Workouts/s.md', date: TODAY, sets, records: [], workouts: [], daysOn, exercises: F.EXERCISES, weekStart: 'mon', settings: {}, ledgerState: L.parseLedger('') });
  assert.ok(!out.some(a => a.kind === 'quest'), 'the quest must not pay for squats');
});

run('f1-quest-matching-rows');
