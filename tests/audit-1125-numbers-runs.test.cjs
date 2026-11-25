'use strict';
/* Audit 25 Nov 2026, finding 50 - "last run", "done" and "longest time" followed
   three rules (page-running, the exercise page, run-records). One rule now,
   run-records.isRunRow: a row is a run when it has a distance above 0, or a time
   above 0 on a run exercise (unit km). A timed run with no distance counts for
   "last run", "done" and "longest time"; it cannot count for distance, pace or
   longest-distance records. Also: Running copes with ctx.runPlan() === null. */
const assert = require('node:assert');
const { t, done } = require('./audit-1125-numbers-t');
const T = require('./f3-stub');
const F = require('./rewards-fixtures');
const S = require('../src/stats');
const RR = require('../src/run-records');
const running = require('../src/page-running');
const detail = require('../src/page-exercise-detail');
const { todayISO, addDays, fmtShort } = require('../src/dates');

const EX = F.EXERCISES; // Easy Run is unit km, Plank unit seconds
const today = todayISO(), earlier = addDays(today, -3), later = addDays(today, -1);
const run = (o) => F.row('Easy Run', o);

t('the one rule', () => {
  assert.strictEqual(typeof RR.isRunRow, 'function');
  assert.strictEqual(RR.isRunRow(run({ km: 5 }), EX), true, 'a distance row');
  assert.strictEqual(RR.isRunRow(F.row('Whatever', { km: 5 }), EX), true, 'a distance row of any name');
  assert.strictEqual(RR.isRunRow(run({ sec: 1800 }), EX), true, 'a timed run with no distance');
  assert.strictEqual(RR.isRunRow(F.row('Plank', { sec: 60 }), EX), false, 'a hold is not a run');
  assert.strictEqual(RR.isRunRow(F.row('Push-ups', { reps: 10, sec: 45 }), EX), false, 'a circuit clock is not a run');
  assert.strictEqual(RR.isRunRow(run({}), EX), false, 'a blank run row is not a run');
  assert.strictEqual(RR.isRunRow(run({ km: 0 }), EX), false, '0 km and no time');
});

t('timed run: counts for time and last date, never for distance', () => {
  const W = [F.wk(earlier, [run({ km: 5, sec: 1500 })], 'a'), F.wk(later, [run({ sec: 3600 })], 'b')];
  const runs = RR.runRows(W, EX);
  assert.strictEqual(runs.length, 2, 'both are runs you did');
  assert.strictEqual(RR.longestTime(runs).seconds, 3600, 'longest time counts the timed run');
  assert.strictEqual(RR.longestRun(runs).km, 5, 'longest distance ignores it');
  assert.strictEqual(RR.fastestPace(runs, 0), runs[0], 'pace ignores it');
  assert.strictEqual(RR.lastRunDate(runs), later);
  const R = RR.runRecords(W, EX, 'mon');
  assert.strictEqual(R.longestTime.seconds, 3600);
  assert.strictEqual(R.longest.km, 5);
  assert.strictEqual(R.totalKm, 5);
  assert.ok(R.biggestWeek === null || R.biggestWeek.km > 0, 'a km-less week is never the biggest week');
  assert.ok(R.timeline.every(x => x.km > 0));
});

t('ranOn is the same rule', () => {
  const W = [F.wk(later, [run({ sec: 1800 })], 'b'), F.wk(earlier, [F.row('Plank', { sec: 60 })], 'c')];
  assert.strictEqual(S.ranOn(W, later, EX), true);
  assert.strictEqual(S.ranOn(W, earlier, EX), false, 'a hold session is not a run day');
  assert.strictEqual(S.ranOn([F.wk(later, [F.row('Easy Run', {})], 'x')], later, EX), false, 'a blank run row is not a run');
  assert.strictEqual(S.ranOn([F.wk(later, [F.row('Walk', { km: 3 })], 'x')], later, EX), true, 'a distance row of any name');
});

const tilesOf = root => T.findAll(root, 'gv-tile').map(x => x.textContent.replace(/\s+/g, ' ').trim());
const plan = { name: 'Trail', fm: { parallel: 'true' }, model: { days: [], intro: [] } };
const renderRunning = (W, runPlan) => T.render(running, { app: {}, data: { workouts: W, exercises: EX }, settings: { weekStart: 'mon' }, state: {}, nav() {}, startLog() {}, runPlan: () => runPlan });

t('Running page: last run counts a timed run; a null plan does not crash', () => {
  const W = [F.wk(earlier, [run({ km: 5, sec: 1500 })], 'a'), F.wk(later, [run({ sec: 3600 })], 'b')];
  const tiles = tilesOf(renderRunning(W, plan));
  assert.ok(tiles.some(x => x.includes(fmtShort(later)) && /last run/.test(x)), `last run must be the timed run: ${JSON.stringify(tiles)}`);
  assert.ok(tiles.some(x => /^5 km\s+longest run$/.test(x)), `longest run stays the distance run: ${JSON.stringify(tiles)}`);
  const root = renderRunning(W, null);
  assert.ok(/No running plan yet/.test(root.textContent), 'a null run plan shows the no-plan state');
  assert.ok(!/Plan$/.test(T.findAll(root, 'gv-toolbar-actions')[0].children.map(c => c.textContent).join('|')), 'no Plan button without a plan');
  const empty = renderRunning([], null);
  assert.ok(/No runs logged yet/.test(empty.textContent));
});

t('exercise page: longest time and last run read the run rule', () => {
  const W = [F.wk(earlier, [run({ km: 5, sec: 1500 })], 'a'), F.wk(later, [run({ sec: 3600 })], 'b'), F.wk(today, [F.row('Plank', { sec: 60 }), run({ km: 0 })], 'c')];
  const ex = EX.find(e => e.name === 'Easy Run');
  const ctx = {
    app: { vault: { getFileByPath: () => null, getResourcePath: () => '' }, metadataCache: { getFirstLinkpathDest: () => null } },
    data: { workouts: W, exercises: EX.map(e => Object.assign({ body: '', file: { path: `${e.name}.md` } }, e)) },
    state: { params: { exercise: 'Easy Run' } }, nav() {}, backTo: f => f, back() {}, openFile() {}, view: null,
  };
  const tiles = tilesOf(T.render(detail, ctx));
  assert.ok(tiles.some(x => /longest time/.test(x) && /1:00:00|60:00/.test(x)), `longest time: ${JSON.stringify(tiles)}`);
  assert.ok(tiles.some(x => /last run/.test(x) && x.includes(fmtShort(later))), `last run: ${JSON.stringify(tiles)}`);
  void ex;
});
done('audit-1125 numbers runs');
