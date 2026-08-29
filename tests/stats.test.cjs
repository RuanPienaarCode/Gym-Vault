'use strict';
const assert = require('node:assert');
const { weekStreak, countInWeek, exerciseBests, goalCurrent, goalIssue, goalProgress, sessionVolume, weightSeries, bmi, setCounts, workoutDates, ladderWeek, workoutDate } = require('../src/stats');

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


/* One rule for "how many days apart", everywhere.

   THE BUG: ladderWeek did raw millisecond arithmetic on local-midnight Dates.
   A spring-forward DST transition between the start date and today loses an
   hour, and Math.floor turns that into a whole missing day — so on exactly
   the day the ladder should step up a rung, it still showed the old one.
   dates.daysBetween already got this right with Math.round. Two rules for
   one quantity is the recurring bug shape in this codebase. */
{
  const { daysBetween } = require('../src/dates');
  const start = '2026-03-23';                       // Europe/London springs forward 29 Mar 2026
  for (const today of ['2026-03-30', '2026-04-06', '2026-04-13', '2026-05-04']) {
    const expected = Math.min(12, Math.floor(daysBetween(start, today) / 7) + 1);
    assert.strictEqual(ladderWeek(start, today, 12), expected,
      `ladderWeek disagrees with daysBetween on ${today} (DST week-rollover bug)`);
  }
}

/* One rule for "the date of a workout", everywhere. The dashboard, the
   history page and the export must not report three different counts for
   the same files. */
{
  const wk = d => ({ fm: { date: d }, file: { basename: d }, body: '' });
  const workouts = [wk('2026-8-6'), wk('26/08/2026'), wk('2026-08-27')];
  assert.strictEqual(typeof workoutDate, 'function',
    'stats must export a single workoutDate() normaliser for every consumer to route through');
  assert.strictEqual(workoutDate(workouts[2]), '2026-08-27', 'a valid ISO date must normalise to itself');
  assert.strictEqual(workoutDate(workouts[1]), null, 'an unparseable date must be reported as null, not guessed');
}


/* A goal that points at nothing must SAY so, not look like it is waiting for
   data. Blaming the user for a typo is the failure mode being fixed. */
{
  const names = ['Pull-ups', 'Bench Press'];
  const goal = fm => ({ name: 'g', fm });

  assert.strictEqual(goalIssue(goal({ metric: 'exercise-reps', exercise: 'Pull-ups' }), { exerciseNames: names }), null,
    'a goal naming a real exercise has no issue');
  assert.strictEqual(goalIssue(goal({ metric: 'exercise-reps', exercise: 'pull-UPS' }), { exerciseNames: names }), null,
    'the name check must fold case, like every other name comparison');
  assert.match(goalIssue(goal({ metric: 'exercise-reps', exercise: 'pull ups' }), { exerciseNames: names }) || '',
    /no exercise named "pull ups"/, 'a typo\'d exercise name must be reported');
  assert.match(goalIssue(goal({ metric: 'body-weight' }), {}) || '', /^$|.*/);
  assert.strictEqual(goalIssue(goal({ metric: 'body-weight' }), { exerciseNames: names }), null,
    'a non-exercise metric needs no exercise');
  assert.match(goalIssue(goal({}), {}) || '', /no metric/, 'a goal with no metric must be reported');
  assert.strictEqual(goalIssue(goal({ metric: 'exercise-reps', exercise: 'pull ups' }), {}), null,
    'without an exercise list the check is skipped, not guessed');
}

console.log('stats OK');
