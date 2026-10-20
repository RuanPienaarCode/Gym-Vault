'use strict';
/* C-07 / L1-02: a circuit's clock on a REP exercise is not a "hold". The Records
   page and the Goals page already refuse it; Today's goals, the exercise page's
   "best hold" tile and Progression, and the export still printed it. One gate
   (stats.claimableKinds, via goalCurrent / claimedBests) now reaches them all. */
const assert = require('node:assert');
const T = require('./f3-stub');
const F = require('./rewards-fixtures');
const X = require('../src/export');
const dashboard = require('../src/page-dashboard');
const detail = require('../src/page-exercise-detail');
const goals = require('../src/page-goals');

const workouts = [
  F.wk('2026-10-12', [F.row('Push-ups', { reps: 12, sec: 30 }), F.row('Plank', { sec: 60 }), F.row('Easy Run', { km: 5, sec: 1800 })], 'a'),
  F.wk('2026-10-19', [F.row('Push-ups', { reps: 14, sec: 45 }), F.row('Plank', { sec: 75 })], 'b'),
];
const goal = { name: 'Hold 60s', file: { path: 'g.md' }, fm: { metric: 'exercise-duration', exercise: 'Push-ups', target: 60 } };
const plankGoal = { name: 'Plank 90', file: { path: 'g2.md' }, fm: { metric: 'exercise-duration', exercise: 'Plank', target: 90 } };
const data = { profile: { fm: {} }, body: [], exercises: F.EXERCISES, plans: [], goals: [goal, plankGoal], workouts };
const NO_PLAN = { activePlan: () => null, activePlanIsImplicit: () => false, mainPlans: () => [], parallelPlans: () => [], fallbackPlans: () => [], daysOn: () => [] };

/* Today's "Goals in flight" */
{
  const ctx = Object.assign({ app: {}, data, settings: { weekStart: 'mon' }, state: {}, io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {} }, NO_PLAN);
  const root = T.render(dashboard, ctx);
  const minis = T.findAll(root, 'gv-goal-mini');
  const push = minis.find(m => /Hold 60s/.test(m.textContent));
  assert.ok(push, 'the goal is listed');
  assert.ok(!/45s/.test(push.textContent), `Today read a circuit clock as a hold: "${push.textContent}"`);
  const plank = minis.find(m => /Plank 90/.test(m.textContent));
  assert.ok(/1:15/.test(plank.textContent), `control: a real plank hold still reads: "${plank.textContent}"`);
}

/* Goals page uses the same seam (no private copy) */
{
  const ctx = { data, settings: { weekStart: 'mon' }, app: {}, state: {}, nav() {}, notice() {}, reload() {}, openFile() {} };
  const root = T.render(goals, ctx);
  assert.ok(!/45s/.test(root.textContent), 'Goals page: no circuit clock');
  assert.ok(/1:15/.test(root.textContent), 'Goals page: real hold reads');
}

/* Export */
{
  const md = X.buildSummary(data, { today: '2026-10-21' });
  const goalRow = md.split('\n').find(l => /Hold 60s/.test(l));
  assert.ok(/\|\s*—\s*\|\s*60\s*\|/.test(goalRow), `export goal row printed a clock reading: ${goalRow}`);
  const pushBest = md.split('\n').find(l => /^\| Push-ups \|/.test(l) && /reps/.test(l));
  assert.ok(pushBest && !/ s\b/.test(pushBest), `export Personal bests gave Push-ups a hold: ${pushBest}`);
  const plankBest = md.split('\n').find(l => /^\| Plank \|/.test(l));
  assert.ok(/75 s/.test(plankBest), `control: Plank keeps its hold: ${plankBest}`);
  const runBest = md.split('\n').find(l => /^\| Easy Run \|/.test(l));
  assert.ok(/5 km/.test(runBest), `control: a run keeps its distance: ${runBest}`);
  const js = JSON.parse(X.buildJson(data, { today: '2026-10-21' }));
  assert.strictEqual(js.goals.find(g => g.name === 'Hold 60s').current, null, 'json goal current');
  assert.strictEqual(js.exercises.find(e => e.name === 'Push-ups').bests.seconds, null, 'json bests.seconds');
  assert.strictEqual(js.exercises.find(e => e.name === 'Plank').bests.seconds, 75);
  assert.strictEqual(js.exercises.find(e => e.name === 'Easy Run').bests.distance, 5);
}

/* Exercise page: tile + Progression */
{
  const mk = name => {
    const ex = F.EXERCISES.find(e => e.name === name);
    const ctx = {
      app: { vault: { getFileByPath: () => null, getResourcePath: () => '' }, metadataCache: { getFirstLinkpathDest: () => null } },
      data: { workouts, exercises: F.EXERCISES.map(e => Object.assign({ body: '', file: { path: `${e.name}.md` } }, e)) },
      state: { params: { exercise: name } }, nav() {}, backTo: f => f, back() {}, openFile() {}, view: null,
    };
    return T.render(detail, ctx);
  };
  const push = mk('Push-ups');
  const hold = T.findAll(push, 'gv-tile').find(t => /best hold/.test(t.textContent));
  assert.ok(hold && /—/.test(hold.textContent) && !/45s/.test(hold.textContent), `Push-ups "best hold" tile: ${hold && hold.textContent}`);
  assert.ok(!/Longest hold/.test(push.textContent), 'Push-ups Progression has no hold steps');
  const plank = mk('Plank');
  assert.ok(/1:15/.test(T.findAll(plank, 'gv-tile').map(t => t.textContent).join('|')), 'control: Plank best hold tile reads 1:15');
}
console.log('f3 claimed surfaces OK');
