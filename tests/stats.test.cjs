'use strict';
const assert = require('node:assert');
const { weekStreak, countInWeek, exerciseBests, goalCurrent, goalProgress, sessionVolume, weightSeries, bmi, setCounts, workoutDates } = require('../src/stats');

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

/* The one rule for whether a logged set counts: ticked done, OR the user
   edited it and it holds a figure. A PREFILLED (untouched) value must NOT
   count — otherwise finishing an untouched session logs every exercise as
   performed exactly to the plan's target. */
{
  assert.ok(setCounts({ done: true, touched: false, reps: '', weight_kg: '', seconds: '' }));
  assert.ok(setCounts({ done: false, touched: true, reps: '8', weight_kg: '', seconds: '' }));
  assert.ok(setCounts({ done: false, touched: true, reps: '', weight_kg: '20', seconds: '' }));
  assert.ok(setCounts({ done: false, touched: true, reps: '', weight_kg: '', seconds: '45' }));
  assert.ok(!setCounts({ done: false, touched: false, reps: '8', weight_kg: '20', seconds: '' })); // prefill only
  assert.ok(!setCounts({ done: false, touched: true, reps: '', weight_kg: '', seconds: '' }));     // touched but emptied
  assert.ok(!setCounts({ done: false, touched: false, reps: '', weight_kg: '', seconds: '' }));
}

/* A hand-edited datetime date counts the same as a plain date everywhere. */
{
  const dates = workoutDates([w('2026-08-26T09:00', []), w('2026-08-26', []), w('not-a-date', [])]);
  assert.deepStrictEqual(dates, ['2026-08-26']);
}

/* Running: longest single distance and total logged, kept distinct. */
{
  const runs = [w('2026-08-01', [set('Long Trail Run','', '', '')]), w('2026-08-08', [])];
  runs[0].rows = [{ exercise: 'Long Trail Run', distance_km: '6.4', seconds: '2820' }];
  runs[1].rows = [{ exercise: 'Long Trail Run', distance_km: '8', seconds: '3600' }];
  const b = exerciseBests(runs, 'long trail run');
  assert.strictEqual(b.distance, 8);
  assert.strictEqual(b.totalDistance, 14.4);
  assert.strictEqual(exerciseBests(runs, 'Never Run').distance, null);
}

console.log('stats OK');
