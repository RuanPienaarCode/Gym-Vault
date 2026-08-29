'use strict';
const assert = require('node:assert');
const { previousBest, isRecord } = require('../src/records');

const w = (date, rows) => ({ fm: { date }, rows });
const set = (exercise, reps, weight_kg, seconds) => ({ exercise, reps, weight_kg, seconds });

/* previousBest reads the same three dimensions stats.exerciseBests tracks,
   case-insensitively, from whatever workouts array it's given. */
{
  const workouts = [
    w('2026-08-20', [set('Pull-ups', '6', '', ''), set('Plank', '', '', '150')]),
    w('2026-08-24', [set('Pull-ups', '8', '', ''), set('RDL', '10', '40', '')]),
  ];
  assert.strictEqual(previousBest(workouts, 'pull-ups', 'reps'), 8);
  assert.strictEqual(previousBest(workouts, 'Plank', 'seconds'), 150);
  assert.strictEqual(previousBest(workouts, 'RDL', 'weight'), 40);
}

/* Never logged before → null, not zero: nothing to beat, so it's never a
   record no matter what value comes in. */
{
  const workouts = [w('2026-08-20', [set('Pull-ups', '6', '', '')])];
  assert.strictEqual(previousBest(workouts, 'Deadlift', 'weight'), null);
  assert.strictEqual(isRecord(previousBest(workouts, 'Deadlift', 'weight'), '60'), false, 'first-ever logged set is not a record');
  assert.strictEqual(isRecord(null, '1'), false);
}

/* isRecord: strictly greater is a record; a TIE is not. */
{
  assert.strictEqual(isRecord(8, '9'), true);
  assert.strictEqual(isRecord(8, '8'), false, 'a tie does not celebrate');
  assert.strictEqual(isRecord(8, '7'), false);
}

/* A non-numeric or blank value never counts as a record, even against a
   real previous best (an empty field shouldn't look like "0 beats 8"). */
{
  assert.strictEqual(isRecord(8, ''), false);
  assert.strictEqual(isRecord(8, 'not a number'), false);
}

/* End-to-end: a fresh exercise's SECOND logged set beats its first. */
{
  const before = [w('2026-08-20', [set('Row', '10', '30', '')])];
  const prevWeight = previousBest(before, 'Row', 'weight');
  assert.strictEqual(isRecord(prevWeight, '32.5'), true);
  assert.strictEqual(isRecord(prevWeight, '30'), false, 'matching last time is not a new best');
}

console.log('records OK');
