'use strict';
/* run-records.js — the Running records page's figures.

   THE INVARIANT WORTH THE FILE: every "longest" here must be the number
   stats.exerciseBests reports, and every week total must be the number
   stats.distanceInWeek reports — the Running page's own tiles. A records
   page that computed its own maximum would one day show a different figure
   from the exercise page beside it, and nothing would say which was wrong.

   The second rule: a pace is one run's own time over its own distance.
   Never the longest time over the longest distance, which can be two runs. */
const assert = require('node:assert');
const rr = require('../src/run-records');
const { exerciseBests, distanceInWeek } = require('../src/stats');

const w = (date, rows, name) => ({ name: name || date, fm: { date }, rows });
const run = (exercise, distance_km, seconds) => ({ exercise, distance_km, seconds });

const EX = [
  { name: 'Easy Run', fm: { unit: 'km' } },
  { name: 'Long Trail Run', fm: { unit: 'km' } },
  { name: 'Push-ups', fm: {} },
  { name: 'Hill Repeats', fm: { unit: 'km' } }, // in the library, never run
];

const HISTORY = [
  w('2026-07-07', [run('Easy Run', '4', '1500')]),                       // 6:15 /km
  w('2026-07-11', [run('Long Trail Run', '5', '2100')]),                 // 7:00 /km
  w('2026-07-14', [run('Easy Run', '4.5', '1620'), { exercise: 'Push-ups', reps: '20' }]), // 6:00 /km
  w('2026-07-18', [run('Long Trail Run', '7', '2800')]),                 // 6:40 /km
  w('2026-07-25', [run('Long Trail Run', '8', '')]),                     // longest, but untimed
  w('2026-08-01', [run('Long Trail Run', '8', '3000')]),                 // a tie on distance
  w('2026-08-04', [run('Easy Run', '0.4', '60')]),                       // a stride: 2:30 /km, under MIN_PACE_KM
];

/* ---------- runRows: one per distance row, in date order ---------- */
{
  const rows = rr.runRows(HISTORY);
  assert.strictEqual(rows.length, 7, 'every row with a distance is a run; the push-ups row is not');
  assert.deepStrictEqual(rows.map(r => r.date), ['2026-07-07', '2026-07-11', '2026-07-14', '2026-07-18', '2026-07-25', '2026-08-01', '2026-08-04']);
  assert.strictEqual(rows[4].seconds, null, 'an empty time is null, not 0 — "untimed" and "instant" are different facts');
}

/* Dated rows come first whatever order the workouts arrive in; an undated
   run sorts last so it can only add a record, never rewrite one. */
{
  const shuffled = [HISTORY[3], { fm: {}, rows: [run('Easy Run', '9', '')] }, HISTORY[0]];
  const rows = rr.runRows(shuffled);
  assert.deepStrictEqual(rows.map(r => r.date), ['2026-07-07', '2026-07-18', null]);
  assert.strictEqual(rr.longestTimeline(rows).slice(-1)[0].km, 9);
}

/* ---------- pace: one run's own figures ---------- */
{
  assert.strictEqual(rr.paceOf({ km: 4, seconds: 1500 }), 375);
  assert.strictEqual(rr.paceOf({ km: 8, seconds: null }), null, 'no time, no pace');
  assert.strictEqual(rr.fmtPace(375), '6:15 /km');
  assert.strictEqual(rr.fmtPace(359.6), '6:00 /km', 'rounded to the second');
  assert.strictEqual(rr.fmtPace(null), '—');
}

const R = rr.runRecords(HISTORY, EX, 'mon');

/* ---------- THE INVARIANT: longest per exercise is exerciseBests ---------- */
for (const ex of R.exercises) {
  const bests = exerciseBests(HISTORY, ex.exercise);
  assert.strictEqual(ex.longest ? ex.longest.km : null, bests.distance,
    `${ex.exercise}: the records page's longest must equal stats.exerciseBests.distance — two rules for one figure`);
  assert.strictEqual(ex.totalKm, bests.totalDistance, `${ex.exercise}: total km must be exerciseBests.totalDistance`);
}
assert.strictEqual(R.longest.km, Math.max(...R.exercises.map(e => e.longest ? e.longest.km : 0)),
  'the overall longest is the max of the per-exercise bests, not a third computation');
assert.strictEqual(R.timeline.slice(-1)[0].km, R.longest.km, 'the timeline\'s last entry must be the longest run');

/* ---------- ties keep the earlier run ---------- */
assert.strictEqual(R.longest.date, '2026-07-25', 'an 8 km tie a week later beats nothing — the first 8 km keeps the record');
assert.strictEqual(R.timeline.length, 4, 'the longest moved at 4, 5, 7, 8 — the tie is not a move');
assert.deepStrictEqual(R.timeline.map(t => [t.km, t.prev]), [[4, null], [5, 4], [7, 5], [8, 7]]);

/* ---------- fastest pace: floors, and never a stride ---------- */
assert.strictEqual(R.fastest.date, '2026-07-14', 'fastest overall is the 6:00 /km run, not the 0.4 km stride at 2:30');
assert.strictEqual(rr.fastestPace(rr.runRows(HISTORY), 0).date, '2026-08-04', 'with no floor the stride wins — which is why there is a floor');
{
  /* Recompute the 5 km band by hand so the assertion above cannot lie. */
  const eligible = rr.runRows(HISTORY).filter(r => r.km >= 5 && r.seconds);
  const best = eligible.reduce((a, b) => (rr.paceOf(b) < rr.paceOf(a) ? b : a));
  assert.strictEqual(best.date, '2026-08-01');
  const bands = Object.fromEntries(R.bands.map(b => [b.km, b.best]));
  assert.strictEqual(bands[5].date, '2026-08-01', '5 km and up: the timed 8 km at 6:15 is the best pace over that distance');
  assert.strictEqual(bands[10], null, 'no run of 10 km yet — the band says so rather than inventing a split');
  assert.strictEqual(bands[21.1], null);
}

/* An untimed longest run never becomes a pace record. */
assert.ok(R.bands.every(b => !b.best || b.best.seconds), 'a pace record must carry a time');

/* ---------- longest time on feet ---------- */
assert.strictEqual(R.longestTime.seconds, 3000);
assert.strictEqual(R.longestTime.date, '2026-08-01');

/* ---------- biggest week is distanceInWeek ---------- */
{
  assert.ok(R.biggestWeek, 'there is a biggest week');
  assert.strictEqual(R.biggestWeek.km, distanceInWeek(HISTORY, R.biggestWeek.weekStart, 'mon'),
    'the biggest week must be the figure the Running page\'s own week tile would show');
  /* Week of 14 Jul (Mon 13th): 4.5 + 7 = 11.5, the biggest. */
  assert.strictEqual(R.biggestWeek.weekStart, '2026-07-13');
  assert.strictEqual(R.biggestWeek.km, 11.5);
}

/* ---------- totals and the library ---------- */
assert.strictEqual(R.runs, 7);
assert.strictEqual(R.totalKm, 36.9);
assert.strictEqual(R.firstDate, '2026-07-07');
{
  const names = R.exercises.map(e => e.exercise);
  assert.ok(names.includes('Hill Repeats'), 'a km-unit exercise never run still appears, honestly empty');
  assert.ok(!names.includes('Push-ups'), 'a strength exercise is not a run');
  const hills = R.exercises.find(e => e.exercise === 'Hill Repeats');
  assert.strictEqual(hills.longest, null);
  assert.strictEqual(hills.runs, 0);
  assert.strictEqual(hills.totalKm, 0, 'exerciseBests.totalDistance is 0 for never-run — the page shows "—" via its own null check on longest');
  assert.strictEqual(names[0], 'Long Trail Run', 'most kilometres first');
}

/* A run logged against a name that has no exercise note still shows. */
{
  const R2 = rr.runRecords([w('2026-08-10', [run('Parkrun', '5', '1500')])], EX, 'mon');
  assert.ok(R2.exercises.some(e => e.exercise === 'Parkrun'));
  assert.strictEqual(R2.longest.exercise, 'Parkrun');
}

/* Empty vault: everything null, nothing throws. */
{
  const E = rr.runRecords([], EX, 'mon');
  assert.strictEqual(E.runs, 0);
  assert.strictEqual(E.longest, null);
  assert.strictEqual(E.fastest, null);
  assert.strictEqual(E.biggestWeek, null);
  assert.deepStrictEqual(E.timeline, []);
  assert.ok(E.bands.every(b => b.best === null));
}

console.log('run-records OK (longest is exerciseBests, week is distanceInWeek, pace is one run\'s own figures, ties keep the first)');
