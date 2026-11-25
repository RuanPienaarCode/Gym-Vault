'use strict';
/* Audit 25 Nov 2026, findings 51, 53, 54, 55 — one quantity, one rule.

   51: 0 kg is "no weight" (as recap and progress already read it), so a later
       5 kg set is a first weight, not "a new record (was 0)".
   53: an impossible date (2026-11-31) is undated, not quietly moved to 1 Dec.
   54: a goal target of 0 is "no target set", never "NaN%".
   55: the whole first logged DAY of an exercise is the starting point: a second
       session the same day does not "beat" the first. */
const assert = require('node:assert');
const { t, done } = require('./audit-1125-numbers-t');
const S = require('../src/stats');
const D = require('../src/dates');
const Rec = require('../src/records');
const { buildSummary } = require('../src/export');

const row = (exercise, o) => Object.assign({ exercise, set: 1, reps: '', weight_kg: '', seconds: '', note: '', distance_km: '' }, o);
const wk = (date, rows) => ({ name: 'w' + date, fm: { date }, rows });

t('finding 51', () => {
{
  const H = [wk('2026-11-01', [row('Push-ups', { reps: '10', weight_kg: '0' })]), wk('2026-11-05', [row('Push-ups', { reps: '10', weight_kg: '5' })])];
  assert.strictEqual(S.exerciseBests(H, 'Push-ups').weight, 5);
  assert.strictEqual(S.exerciseBests([H[0]], 'Push-ups').weight, null, '0 kg is no weight, not a best of 0');
  const hist = Rec.recordHistory(H, 'Push-ups', 'weight');
  assert.deepStrictEqual(hist.map(h => [h.value, h.prev]), [[5, null]], 'the 5 kg set is the first weight, not "was 0"');
  assert.strictEqual(Rec.recordHistory([H[0]], 'Push-ups', 'weight').length, 0, 'only 0 kg: no weight history');
  const ex = [{ name: 'Push-ups', fm: { unit: 'reps' } }];
  assert.ok(!Rec.allRecords([H[0]], ex).some(r => r.kind === 'weight'), '0 kg never appears on Records');
}
});

t('finding 53', () => {
assert.strictEqual(D.fromISO('2026-11-31'), null, '31 Nov is not a date');
assert.strictEqual(D.fromISO('2026-02-30'), null);
assert.strictEqual(D.fromISO('2026-13-01'), null);
assert.strictEqual(D.fromISO('2026-00-10'), null);
assert.strictEqual(D.fromISO('2026-11-00'), null);
assert.ok(D.fromISO('2024-02-29'), 'a real leap day is kept');
assert.strictEqual(D.fromISO('2026-02-29'), null, 'not a leap year');
assert.strictEqual(D.toISO(D.fromISO('2026-08-26T09:30')), '2026-08-26', 'a time part is still read');
assert.strictEqual(S.workoutDate({ fm: { date: '2026-11-31' } }), null, 'an impossible workout date is undated');
assert.strictEqual(D.daysBetween('2026-11-31', '2026-12-02'), null);
assert.strictEqual(D.fmtShort('2026-11-31'), '2026-11-31', 'printed as typed, not moved');
});

t('finding 54', () => {
{
  const g = (target, extra) => ({ name: 'G', fm: Object.assign({ metric: 'exercise-reps', exercise: 'Push-ups', target }, extra) });
  for (const t of [0, '0', -5, 'abc', '']) {
    assert.strictEqual(S.goalIssue(g(t), {}), 'this goal has no target set', `target ${JSON.stringify(t)} is no target`);
  }
  assert.strictEqual(S.goalIssue(g(20), {}), null);
  assert.strictEqual(S.goalProgress(g(0), 5, {}), null, 'a zero target has no progress');
  assert.strictEqual(S.goalProgress(g('-3'), 5, {}), null);
  assert.strictEqual(S.goalProgress(g(0, { direction: 'decrease', start_value: 10 }), 5, {}), null);
  assert.strictEqual(S.goalProgress(g(20), 10, {}), 0.5);
  assert.strictEqual(S.goalProgress(g(80, { start_value: 90, direction: 'decrease', metric: 'body-weight' }), 85, {}), 0.5);
  /* start at or past the target: the span to cover is 0 */
  assert.strictEqual(S.goalProgress(g(20, { start_value: 20 }), 20, {}), 1, 'start == target: base falls back to 0, still a real fraction');
  const exData = { profile: { fm: {}, body: '' }, body: [], exercises: [{ name: 'Push-ups', fm: { unit: 'reps' } }], plans: [], goals: [g(0)],
    workouts: [wk('2026-11-20', [row('Push-ups', { reps: '10' })])] };
  const text = buildSummary(exData, { today: '2026-11-25', days: 0, weekStart: 'mon' });
  assert.ok(/Push-ups/.test(text) && /\| G \|/.test(text), 'the goal row is exported');
  assert.ok(!/NaN/.test(text), 'the export never prints NaN');
}
});

t('finding 55', () => {
{
  const P = (reps, w) => row('Push-ups', { reps: String(reps), weight_kg: w ? String(w) : '' });
  /* Two sessions on the first day (10 then 14): the baseline is 14, nothing broken. */
  const H1 = [wk('2026-08-31', [P(10)]), wk('2026-08-31', [P(14)])];
  assert.deepStrictEqual(Rec.recordHistory(H1, 'Push-ups', 'reps').map(h => [h.value, h.prev]), [[14, null]], 'a second set on day one is part of the baseline');
  /* Within one note too */
  const H2 = [wk('2026-08-31', [P(10), P(12), P(14)])];
  assert.strictEqual(Rec.recordHistory(H2, 'Push-ups', 'reps').length, 1);
  /* A later day that beats the first day IS a record, measured from the day's best. */
  const H3 = H1.concat([wk('2026-09-02', [P(13)]), wk('2026-09-05', [P(16)])]);
  assert.deepStrictEqual(Rec.recordHistory(H3, 'Push-ups', 'reps').map(h => [h.value, h.prev, h.date]), [[14, null, '2026-08-31'], [16, 14, '2026-09-05']]);
  const ex = [{ name: 'Push-ups', fm: { unit: 'reps' } }];
  const r = Rec.allRecords(H3, ex).find(x => x.kind === 'reps');
  assert.strictEqual(r.times, 2, 'baseline + one break');
  assert.strictEqual(Rec.allRecords(H1, ex).find(x => x.kind === 'reps').times, 1, 'never beaten');
  assert.strictEqual(Rec.latestRecord(H1, ex), null, 'nothing beaten, nothing new');
  /* the last history value is still exerciseBests */
  const h = Rec.recordHistory(H3, 'Push-ups', 'reps');
  assert.strictEqual(h[h.length - 1].value, S.exerciseBests(H3, 'Push-ups').reps);
  /* the PB medals read the same function: day-one extras are not PBs */
  const rewards = require('../src/rewards');
  const pb = ctx => rewards.medals(ctx).find(m => m.key === 'first-pb').progress.value;
  assert.strictEqual(pb({ workouts: H1, exercises: ex, weekStart: 'mon' }), 0, 'First PB / PB Hunter: day-one extras are not personal bests');
  assert.strictEqual(pb({ workouts: H3, exercises: ex, weekStart: 'mon' }), 1, 'one real record on a later day');
  /* undated notes: only ever ADD a record after the dated ones */
  const H4 = [wk('', [P(30)]), wk('2026-09-01', [P(10)]), wk('2026-09-02', [P(12)])];
  assert.deepStrictEqual(Rec.recordHistory(H4, 'Push-ups', 'reps').map(x => [x.value, x.prev]), [[10, null], [12, 10], [30, 12]]);
}
});

done('audit-1125 numbers figures');
