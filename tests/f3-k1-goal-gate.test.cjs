'use strict';
/* K1: stats.goalCurrent is the gated seam. With ctx.exercises it returns null
   for a metric whose kind the exercise cannot claim (a timed circuit leaves its
   clock in `seconds` on a REP exercise - that is not a hold). Distance is NEVER
   gated: claimableKinds([km]) is [] and gating it would blank every run goal. */
const assert = require('node:assert');
const S = require('../src/stats');
const R = require('../src/records');
const F = require('./rewards-fixtures');

const workouts = [
  F.wk('2026-10-12', [F.row('Push-ups', { reps: 12, sec: 30 }), F.row('Easy Run', { km: 5 }), F.row('Plank', { sec: 60 }), F.row('Squat', { reps: 5, kg: 100 })], 'a'),
  F.wk('2026-10-19', [F.row('Push-ups', { reps: 14, sec: 45 })], 'b'),
];
const goal = (metric, exercise) => ({ name: 'g', fm: { metric, exercise, target: 60 } });
const ctx = { workouts, body: [], weekStart: 'mon', today: '2026-10-21' };
const gated = { ...ctx, exercises: F.EXERCISES };

assert.strictEqual(S.claimableKinds, R.claimableKinds, 'records re-exports stats.claimableKinds unchanged');
assert.deepStrictEqual(S.claimableKinds(F.EXERCISES[1]), ['reps', 'weight']);

assert.strictEqual(S.goalCurrent(goal('exercise-duration', 'Push-ups'), ctx), 45, 'no ctx.exercises: unchanged (ungated)');
assert.strictEqual(S.goalCurrent(goal('exercise-duration', 'Push-ups'), gated), null,
  'a circuit clock on a rep exercise is not a hold (gated)');
assert.strictEqual(S.goalCurrent(goal('exercise-duration', 'push-ups '), gated), null, 'name match is case/space folded');
assert.strictEqual(S.goalCurrent(goal('exercise-duration', 'Plank'), gated), 60, 'a real hold still reads');
assert.strictEqual(S.goalCurrent(goal('exercise-reps', 'Push-ups'), gated), 14);
assert.strictEqual(S.goalCurrent(goal('exercise-weight', 'Squat'), gated), 100);
assert.strictEqual(S.goalCurrent(goal('exercise-reps', 'Plank'), gated), null, 'a hold exercise claims no rep best');
assert.strictEqual(S.goalCurrent(goal('exercise-distance', 'Easy Run'), gated), 5,
  'distance is NEVER gated - claimableKinds([km]) is [] and gating would blank every run goal');
assert.strictEqual(S.goalCurrent(goal('exercise-duration', 'No Such Thing'), gated), null, 'unknown exercise: no data, not an error');
assert.strictEqual(S.goalCurrent(goal('workouts-per-week'), gated), 1, 'non-exercise metrics untouched');
console.log('f3 K1 goal gate OK');
