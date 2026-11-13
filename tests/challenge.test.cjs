'use strict';
/* challenge.js — the weekly "beat your best unbroken set" challenge.

   THE RULES THIS PINS:
   - The score is the BEST UNBROKEN SET, never a session total. A Sets day of
     30/20/20/10/10/10 scores 30, not 100.
   - Week one is a test: no target until there is a best to beat.
   - Each week's target is last attempted week's best + ~10% (at least +1),
     never above the goal.
   - A rest longer than the limit ends the set; the next rep starts a new one.
     That is the only thing that splits a set, in either mode. */
const assert = require('node:assert');
const c = require('../src/challenge');

/* ---------- isChallenge ---------- */

assert.strictEqual(c.isChallenge({ fm: { challenge: 'weekly', metric: 'exercise-reps', exercise: 'Push-ups' } }), true);
assert.strictEqual(c.isChallenge({ fm: { metric: 'exercise-reps', exercise: 'Push-ups' } }), false, 'a plain goal is not a challenge');
assert.strictEqual(c.isChallenge({ fm: { challenge: 'weekly', metric: 'body-weight' } }), false, 'only a best-reps goal can be a weekly set challenge');
assert.strictEqual(c.isChallenge({ fm: { challenge: 'weekly', metric: 'exercise-reps', exercise: '' } }), false, 'no exercise, nothing to count');
assert.strictEqual(c.isChallenge(null), false);

/* ---------- parseShape / restSeconds ---------- */

assert.deepStrictEqual(c.parseShape('30, 20,20,10 ,10,10'), [30, 20, 20, 10, 10, 10]);
assert.deepStrictEqual(c.parseShape([40, 30, 30]), [40, 30, 30]);
assert.deepStrictEqual(c.parseShape('50,abc,-3,0,25'), [50, 25], 'junk parts are dropped, not zeroed');
for (const bad of ['', 'abc', null, undefined, [], 7]) {
  assert.deepStrictEqual(c.parseShape(bad), c.DEFAULT_SHAPE, `${JSON.stringify(bad)} falls back to the default shape`);
}
assert.deepStrictEqual(c.DEFAULT_SHAPE, [30, 20, 20, 10, 10, 10]);

assert.strictEqual(c.restSeconds({}), 5, 'five seconds unless the note says otherwise');
assert.strictEqual(c.restSeconds({ rest_limit_s: 8 }), 8);
assert.strictEqual(c.restSeconds({ rest_limit_s: '3' }), 3, 'frontmatter may hold it as text');
for (const bad of [0, -2, 'x', null]) assert.strictEqual(c.restSeconds({ rest_limit_s: bad }), 5);

/* ---------- splitSets ---------- */

assert.deepStrictEqual(c.splitSets(100), [30, 20, 20, 10, 10, 10], 'the example the challenge was asked for');
assert.deepStrictEqual(c.splitSets(80), [24, 16, 16, 8, 8, 8]);
/* Uneven: largest remainder first, ties to the earlier (bigger) set. */
assert.deepStrictEqual(c.splitSets(25), [8, 5, 5, 3, 2, 2]);
for (const n of [1, 3, 7, 13, 25, 37, 51, 99, 100, 150]) {
  const s = c.splitSets(n);
  assert.strictEqual(s.reduce((a, b) => a + b, 0), n, `split of ${n} must add back up to ${n}`);
  assert.ok(s.every(x => Number.isInteger(x) && x >= 1), `split of ${n} has no empty or fractional sets: ${s}`);
}
assert.deepStrictEqual(c.splitSets(3), [1, 1, 1], 'a tiny target drops the sets that would be empty');
assert.deepStrictEqual(c.splitSets(10, [50, 50]), [5, 5], 'a custom shape is honoured');
for (const bad of [0, -5, NaN, null, 'x']) assert.deepStrictEqual(c.splitSets(bad), []);

/* ---------- nextTarget ---------- */

assert.strictEqual(c.nextTarget(null, 50), null, 'no best yet: week one is a test, not a target');
assert.strictEqual(c.nextTarget(20, 50), 22, '+10%');
assert.strictEqual(c.nextTarget(5, 50), 6, 'at least one more than last time');
assert.strictEqual(c.nextTarget(23, 50), 26, '10% rounds UP — 25.3 is 26');
assert.strictEqual(c.nextTarget(48, 50), 50, 'never above the goal');
assert.strictEqual(c.nextTarget(55, 50), 50, 'past the goal, the target is to hold it');

/* ---------- weeklyBests ---------- */

const row = (exercise, reps, set = 1) => ({ exercise, set: String(set), reps: String(reps), weight_kg: '', seconds: '', note: '', distance_km: '' });
const w = (date, rows) => ({ fm: { date }, rows });
/* Week starting Monday: 2 Nov, 9 Nov, 16 Nov 2026. */
const workouts = [
  w('2026-10-26', [row('Push-ups', 40)]),                                   // before the challenge started
  w('2026-11-03', [row('Push-ups', 12), row('Push-ups', 9, 2)]),
  w('2026-11-05', [row(' push-UPS ', 15), row('Squat', 60)]),              // same name rule as the Goals card (case/space folded)
  w('2026-11-10', [row('Push-ups', 14)]),
  w('2026-11-11', [row('Push-ups', 17), row('Push-ups', '', 2)]),           // an empty set is not zero
  w('2026-11-17', [row('Push-ups', 30), row('Push-ups', 20, 2), row('Push-ups', 20, 3)]),
  { fm: {}, rows: [row('Push-ups', 99)] },                                    // undated: no week to put it in
];
const weeks = c.weeklyBests(workouts, 'Push-ups', { weekStart: 'mon', since: '2026-11-02' });
assert.deepStrictEqual(weeks.map(x => [x.week, x.best]), [
  ['2026-11-02', 15],
  ['2026-11-09', 17],
  ['2026-11-16', 30],
], 'one best UNBROKEN set per week, from the start date on');
assert.strictEqual(weeks[2].total, 70, 'the week total is kept for the summary, never used as the score');
assert.strictEqual(c.weeklyBests(workouts, 'Push-ups', { weekStart: 'mon' })[0].week, '2026-10-26', 'no start date: all history counts');
assert.deepStrictEqual(c.weeklyBests(workouts, 'Pull-ups', { weekStart: 'mon' }), []);

/* ---------- challengeStatus ---------- */

const goal = { fm: { challenge: 'weekly', metric: 'exercise-reps', exercise: 'Push-ups', target: 50, started: '2026-11-02' } };

const wk1 = c.challengeStatus(goal, workouts.slice(0, 3), { weekStart: 'mon', today: '2026-11-05' });
assert.strictEqual(wk1.testWeek, true, 'first week: a test');
assert.strictEqual(wk1.target, null);
assert.strictEqual(wk1.thisWeek.best, 15);
assert.strictEqual(wk1.beaten, false, 'nothing to beat in a test week');

const wk2 = c.challengeStatus(goal, workouts.slice(0, 4), { weekStart: 'mon', today: '2026-11-10' });
assert.strictEqual(wk2.lastWeek.best, 15);
assert.strictEqual(wk2.target, 17, '15 + 10% rounds up to 17');
assert.strictEqual(wk2.thisWeek.best, 14);
assert.strictEqual(wk2.beaten, false);
assert.strictEqual(wk2.toGo, 3, 'how many more in one set to beat it');

const wk2b = c.challengeStatus(goal, workouts.slice(0, 5), { weekStart: 'mon', today: '2026-11-12' });
assert.strictEqual(wk2b.beaten, true, '17 meets a target of 17');
assert.strictEqual(wk2b.toGo, 0);

/* A skipped week compares against the last week you actually did. */
const skipped = c.challengeStatus(goal, workouts.slice(0, 5), { weekStart: 'mon', today: '2026-11-25' });
assert.strictEqual(skipped.thisWeek, null, 'nothing logged this week yet');
assert.strictEqual(skipped.lastWeek.week, '2026-11-09');
assert.strictEqual(skipped.target, 19, '17 + 10% = 18.7, up to 19');

assert.strictEqual(wk1.weekNo, 1, 'started 2 Nov, today 5 Nov: week one');
assert.strictEqual(wk2.weekNo, 2);
assert.strictEqual(skipped.weekNo, 4, 'weeks count by the calendar, skipped ones included');
assert.strictEqual(c.challengeStatus({ fm: { ...goal.fm, started: '' } }, [], { weekStart: 'mon', today: '2026-11-18' }).weekNo, null, 'no start date, no week number');

const status = c.challengeStatus(goal, workouts, { weekStart: 'mon', today: '2026-11-18' });
assert.strictEqual(status.best, 30, 'all-time best unbroken set since the start');
assert.strictEqual(status.goal, 50);
assert.strictEqual(status.done, false);
assert.strictEqual(c.challengeStatus({ fm: { ...goal.fm, target: 30 } }, workouts, { weekStart: 'mon', today: '2026-11-18' }).done, true);

/* ---------- the live run: a rest splits the set ---------- */

let r = c.createRun(5000);
assert.deepStrictEqual(c.runSets(r), []);
assert.strictEqual(c.restingFor(r, 1000), null, 'no rep yet: not resting');
let out;
out = c.addRep(r, 0);       r = out.run; assert.strictEqual(out.split, false);
out = c.addRep(r, 1500);    r = out.run;
out = c.addRep(r, 6400);    r = out.run; assert.strictEqual(out.split, false, '4.9s gap: same set');
assert.strictEqual(r.current, 3);
out = c.addRep(r, 11500);   r = out.run; assert.strictEqual(out.split, true, '5.1s gap: that was a rest, this rep starts set two');
assert.deepStrictEqual(r.sets, [3]);
assert.strictEqual(r.current, 1);
assert.deepStrictEqual(c.runSets(r), [3, 1], 'the open set is included');

/* closeIfRested: the screen can close the set the moment the rest runs out,
   without waiting for the next rep. Idempotent. */
let cl = c.closeIfRested(r, 14000);
assert.strictEqual(cl.closed, null, 'still inside the limit');
cl = c.closeIfRested(r, 17000);
assert.strictEqual(cl.closed, 1);
r = cl.run;
assert.deepStrictEqual(r.sets, [3, 1]);
assert.strictEqual(r.current, 0);
assert.strictEqual(c.closeIfRested(r, 30000).closed, null, 'nothing open, nothing to close');
out = c.addRep(r, 30000); r = out.run;
assert.strictEqual(out.split, true, 'the first rep after a closed set is a new set');
assert.deepStrictEqual(c.runSets(r), [3, 1, 1]);
assert.strictEqual(c.restingFor(r, 32500), 2500);

/* Undo takes back the last rep, reopening a set the rest had closed. */
r = c.undoRep(r);
assert.deepStrictEqual(c.runSets(r), [3, 1]);
r = c.undoRep(r);
assert.deepStrictEqual(c.runSets(r), [3], 'undoing set two\'s only rep empties it');
r = c.undoRep(c.undoRep(c.undoRep(c.undoRep(r))));
assert.deepStrictEqual(c.runSets(r), [], 'floored at nothing');

/* The input is never mutated. */
const frozen = Object.freeze({ ...c.createRun(5000), sets: Object.freeze([]) });
assert.doesNotThrow(() => c.addRep(frozen, 0));

assert.strictEqual(c.bestSet([12, 30, 8]), 30);
assert.strictEqual(c.bestSet([]), 0);

/* ---------- challengeRows: what a finished run saves ---------- */

const rows = c.challengeRows('Push-ups', [18, 6, 4], 'max');
assert.deepStrictEqual(rows.map(x => [x.exercise, x.set, x.reps]), [
  ['Push-ups', '1', '18'], ['Push-ups', '2', '6'], ['Push-ups', '3', '4'],
], 'one row per unbroken set, so the best set reads back as the best set');
assert.strictEqual(rows[0].note, 'Challenge · max');
assert.strictEqual(rows[1].note, '');
for (const k of ['weight_kg', 'seconds', 'distance_km']) assert.strictEqual(rows[0][k], '', `${k} is left empty, never 0`);
assert.deepStrictEqual(c.challengeRows('Push-ups', [0, 12, -1], 'sets').map(x => x.reps), ['12'], 'empty sets are not saved');
assert.deepStrictEqual(c.challengeRows('Push-ups', [], 'max'), []);

/* Saved rows read back through weeklyBests as the same best. */
const saved = c.weeklyBests([w('2026-11-13', rows)], 'Push-ups', { weekStart: 'mon' });
assert.strictEqual(saved[0].best, 18);

/* ---------- holds: the same challenge, scored in seconds ---------- */

const plank = { fm: { challenge: 'weekly', metric: 'exercise-duration', exercise: 'Plank', target: 180, started: '2026-11-02' } };
assert.strictEqual(c.isChallenge(plank), true, 'a best-hold goal can be a weekly challenge');
assert.strictEqual(c.kindOf(plank), 'seconds');
assert.strictEqual(c.kindOf(goal), 'reps');
assert.strictEqual(c.isChallenge({ fm: { ...plank.fm, metric: 'exercise-weight' } }), false, 'heaviest weight is not a weekly set challenge');

const hold = (exercise, seconds, set = 1) => ({ ...row(exercise, '', set), seconds: String(seconds) });
const holds = [
  w('2026-11-03', [hold('Plank', 45), hold('Plank', 30, 2)]),
  w('2026-11-10', [hold('Plank', 52)]),
  /* A timed circuit leaves its clock in `seconds` on a REP exercise: that is
     not a push-up challenge score, and reps are not a plank score. */
  w('2026-11-10', [{ ...row('Push-ups', 20), seconds: '45' }]),
];
const pw = c.weeklyBests(holds, 'Plank', { weekStart: 'mon', kind: 'seconds' });
assert.deepStrictEqual(pw.map(x => [x.week, x.best]), [['2026-11-02', 45], ['2026-11-09', 52]]);
assert.deepStrictEqual(c.weeklyBests(holds, 'Push-ups', { weekStart: 'mon' }).map(x => x.best), [20], 'a rep challenge reads reps, never the circuit clock');
const ps = c.challengeStatus(plank, holds, { weekStart: 'mon', today: '2026-11-18' });
assert.strictEqual(ps.kind, 'seconds');
assert.strictEqual(ps.lastWeek.best, 52);
assert.strictEqual(ps.target, 58, '52 s + 10% = 57.2, up to 58');

const holdRows = c.challengeRows('Plank', [62, 40], 'max', 'seconds');
assert.deepStrictEqual(holdRows.map(x => [x.set, x.reps, x.seconds]), [['1', '', '62'], ['2', '', '40']], 'a hold saves seconds and leaves reps empty');
assert.strictEqual(c.weeklyBests([w('2026-11-13', holdRows)], 'Plank', { weekStart: 'mon', kind: 'seconds' })[0].best, 62);

/* ---------- popular challenges: what the quick picker offers ---------- */

const exercises = ['Push-ups', 'Plank', 'Burpees', 'Sit-Up', 'Bench Press', 'Jump Squat', 'Wall Sit'].map(name => ({
  name, fm: { unit: /Plank|Wall Sit/.test(name) ? 'seconds' : 'reps' },
}));
const picks = c.popularChallenges(exercises);
assert.deepStrictEqual(picks.map(p => p.name), ['Push-ups', 'Sit-Up', 'Jump Squat', 'Burpees', 'Plank', 'Wall Sit'],
  'only popular bodyweight moves you actually have, in the list\'s order');
assert.deepStrictEqual(picks.find(p => p.name === 'Plank'), { name: 'Plank', metric: 'exercise-duration', kind: 'seconds' });
assert.deepStrictEqual(picks.find(p => p.name === 'Burpees'), { name: 'Burpees', metric: 'exercise-reps', kind: 'reps' });
assert.strictEqual(c.metricFor({ fm: { unit: 'seconds' } }), 'exercise-duration');
assert.strictEqual(c.metricFor({ fm: { unit: 'km' } }), null, 'a run is not a set challenge');
assert.strictEqual(c.metricFor({ fm: {} }), 'exercise-reps');

assert.strictEqual(c.challengeName('Push-ups', 50, 'reps'), '50 Push-ups challenge');
assert.strictEqual(c.challengeName('Plank', 180, 'seconds'), '3-minute Plank challenge', 'it becomes a file name: no colon');
assert.strictEqual(c.challengeName('Plank', 90, 'seconds'), '90s Plank challenge');
assert.strictEqual(c.challengeName('Wall Sit', 45, 'seconds'), '45s Wall Sit challenge');

console.log('challenge ok');
