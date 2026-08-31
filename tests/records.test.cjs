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

/* ============================================================================
   recordHistory / allRecords — the layer the Records page and the
   post-session screen both read.

   THE ONE INVARIANT WORTH A TEST FILE: whatever these report as the current
   best MUST be the number stats.exerciseBests reports. Two ways of computing
   "the best" is the failure this codebase keeps finding (see this file's own
   header, and stats.js's), and here it would show as the Records page and
   the exercise page each confidently displaying a different figure.
   ============================================================================ */

const { exerciseBests } = require('../src/stats');
const records = require('../src/records');

const wk = (date, rows) => ({ fm: { date }, rows });
const HISTORY = [
  wk('2026-01-05', [{ exercise: 'Push-ups', reps: '10' }]),
  wk('2026-01-12', [{ exercise: 'Push-ups', reps: '8' }, { exercise: 'Push-ups', reps: '14' }]),
  wk('2026-01-19', [{ exercise: 'Push-ups', reps: '14' }]),          // a tie beats nothing
  wk('2026-01-26', [{ exercise: 'Push-ups', reps: '21' }]),
  wk('2026-02-02', [{ exercise: 'Bench', weight_kg: '60', reps: '5' }]),
];

{
  const h = records.recordHistory(HISTORY, 'Push-ups', 'reps');
  assert.deepStrictEqual(h, [
    { value: 10, prev: null, date: '2026-01-05' },
    { value: 14, prev: 10, date: '2026-01-12' },
    { value: 21, prev: 14, date: '2026-01-26' },
  ], 'every time the best moved, oldest first — and a tie is not a move');

  /* The first entry is a BASELINE, not a record broken. isRecord() already
     says a null previous best is not a record; the history has to agree. */
  assert.strictEqual(h[0].prev, null);
  assert.strictEqual(records.isRecord(h[0].prev, h[0].value), false, 'the first time you ever do something is not a record');
  assert.strictEqual(records.isRecord(h[1].prev, h[1].value), true);
}

/* THE INVARIANT. */
for (const name of ['Push-ups', 'Bench', 'Never done']) {
  for (const kind of records.KINDS) {
    const h = records.recordHistory(HISTORY, name, kind);
    const best = exerciseBests(HISTORY, name)[kind];
    if (!h.length) {
      assert.strictEqual(best, null, `${name}/${kind}: no history must mean no best`);
      continue;
    }
    assert.strictEqual(
      h[h.length - 1].value, best,
      `${name}/${kind}: the last record in the history MUST equal stats.exerciseBests — two rules for one figure`,
    );
  }
}

/* Rows out of date order must not invent a record. Sorting is done here
   rather than trusted from the caller, because the failure is silent: an
   unsorted feed reports an older figure "beating" a newer, larger one. */
{
  const shuffled = [HISTORY[3], HISTORY[0], HISTORY[2], HISTORY[1]];
  assert.deepStrictEqual(
    records.recordHistory(shuffled, 'Push-ups', 'reps'),
    records.recordHistory(HISTORY.slice(0, 4), 'Push-ups', 'reps'),
    'the history must not depend on the order workouts arrive in',
  );
}

/* A workout with no date sorts LAST: it cannot be placed in the story, and
   at the end it can only add a record, never retroactively invalidate one. */
{
  const undated = records.inDateOrder([{ fm: {}, rows: [] }, HISTORY[0]]);
  assert.strictEqual(undated[0].fm.date, '2026-01-05');
  assert.strictEqual(undated[1].fm.date, undefined);
}

/* An unknown kind is empty, not a crash — distance has no record concept
   here, and a caller asking for one should get nothing back. */
assert.deepStrictEqual(records.recordHistory(HISTORY, 'Push-ups', 'distance'), []);
assert.deepStrictEqual(records.recordHistory(HISTORY, 'Push-ups', undefined), []);

/* ---- allRecords ---- */
{
  const exercises = [{ name: 'Push-ups' }, { name: 'Bench' }, { name: 'Never done' }];
  const all = records.allRecords(HISTORY, exercises);

  const byKey = Object.fromEntries(all.map(r => [`${r.exercise}/${r.kind}`, r]));
  assert.deepStrictEqual(byKey['Push-ups/reps'], { exercise: 'Push-ups', kind: 'reps', value: 21, date: '2026-01-26', times: 3 });
  assert.deepStrictEqual(byKey['Bench/weight'], { exercise: 'Bench', kind: 'weight', value: 60, date: '2026-02-02', times: 1 });

  /* `times: 1` is a BASELINE — set once, never beaten. The page needs to be
     able to tell that from a record that has actually moved. */
  assert.strictEqual(byKey['Bench/weight'].times, 1);
  assert.strictEqual(byKey['Push-ups/reps'].times, 3);

  /* An exercise with nothing logged contributes no rows at all — rather than
     rows of nulls the page would then have to filter. */
  assert.ok(!all.some(r => r.exercise === 'Never done'), 'nothing logged means nothing to show');

  /* Same invariant, from the other direction. */
  for (const r of all) {
    assert.strictEqual(
      r.value, exerciseBests(HISTORY, r.exercise)[r.kind],
      `${r.exercise}/${r.kind}: allRecords must not disagree with exerciseBests`,
    );
  }

  assert.deepStrictEqual(records.allRecords(HISTORY, []), []);
  assert.deepStrictEqual(records.allRecords([], exercises), []);
}

console.log('records history OK (one rule for "the best"; a tie is not a record; order-independent)');
