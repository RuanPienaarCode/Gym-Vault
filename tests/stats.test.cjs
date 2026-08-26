'use strict';
const assert = require('node:assert');
const { weekStreak, countInWeek, exerciseBests, goalCurrent, goalProgress, sessionVolume, weightSeries, bmi } = require('../src/stats');

const w = (date, rows) => ({ fm: { date }, rows });
const set = (exercise, reps, weight_kg, seconds) => ({ exercise, reps, weight_kg, seconds });

/* Streak: current week counts when it has a session; an empty current week
   doesn't break the chain. Today is Wed 2026-08-26 in these fixtures. */
{
  const dates = ['2026-08-10', '2026-08-19', '2026-08-24'];
  assert.strictEqual(weekStreak(dates, 'mon', '2026-08-26'), 3);
  assert.strictEqual(weekStreak(['2026-08-19', '2026-08-12'], 'mon', '2026-08-26'), 2); // this week empty, streak intact
  assert.strictEqual(weekStreak([], 'mon', '2026-08-26'), 0);
  assert.strictEqual(countInWeek(dates, '2026-08-26', 'mon'), 1);
}

/* Bests: null (never logged) stays distinct from zero. */
{
  const workouts = [
    w('2026-08-20', [set('Pull-ups', '6', '', ''), set('Plank', '', '', '150')]),
    w('2026-08-24', [set('Pull-ups', '8', '', ''), set('RDL', '10', '40', '')]),
  ];
  const pb = exerciseBests(workouts, 'pull-ups'); // case-insensitive
  assert.strictEqual(pb.reps, 8);
  assert.strictEqual(pb.weight, null);
  assert.strictEqual(exerciseBests(workouts, 'Plank').seconds, 150);
  assert.strictEqual(exerciseBests(workouts, 'Never Done').reps, null);
  assert.strictEqual(sessionVolume(workouts[1].rows), 400);
}

/* Goals: current + progress across metrics. */
{
  const ctx = {
    workouts: [w('2026-08-24', [set('Pull-ups', '6', '', ''), set('Plank', '', '', '180')])],
    body: [{ date: '2026-08-01', weight_kg: '95' }, { date: '2026-08-20', weight_kg: '92' }],
    weekStart: 'mon', today: '2026-08-26',
  };
  const reps = { fm: { metric: 'exercise-reps', exercise: 'Pull-ups', target: 10 } };
  assert.strictEqual(goalCurrent(reps, ctx), 6);
  assert.strictEqual(goalProgress(reps, 6), 0.6);

  const plank = { fm: { metric: 'exercise-duration', exercise: 'Plank', target: 360 } };
  assert.strictEqual(goalCurrent(plank, ctx), 180);
  assert.strictEqual(goalProgress(plank, 180), 0.5);

  const cut = { fm: { metric: 'body-weight', target: 90, start_value: 95, direction: 'decrease' } };
  assert.strictEqual(goalCurrent(cut, ctx), 92);
  assert.ok(Math.abs(goalProgress(cut, 92) - 0.6) < 1e-9);

  const freq = { fm: { metric: 'workouts-per-week', target: 4 } };
  assert.strictEqual(goalCurrent(freq, ctx), 1);

  assert.strictEqual(goalProgress(reps, null), null); // no data ≠ zero
}

/* Body series + BMI. */
{
  const s = weightSeries([{ date: '2026-08-20', weight_kg: '92' }, { date: '2026-08-01', weight_kg: '95' }, { date: '2026-08-10', weight_kg: 'x' }]);
  assert.deepStrictEqual(s.map(p => p.value), [95, 92]);
  assert.strictEqual(bmi(92, 190), 25.5);
  assert.strictEqual(bmi('', 190), null);
}

console.log('stats OK');
