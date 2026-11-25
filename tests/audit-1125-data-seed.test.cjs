'use strict';
/* Audit 25 Nov 2026, lane L1 "data" — finding #25.

   "Create my gym" switched the author's whole programme on for every new
   user: the running add-on, the rest backup and ten goals including
   "10 Muscle-ups" and "15km Trail Run". Now the add-on and the backup arrive
   switched OFF (`paused: true`), and the only goals seeded are ones the
   active starter plan trains, plus the general workouts-a-week goal.
   Existing vaults are untouched (scaffold is write-if-absent).
   Everything is synthetic. */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

const { makeIo } = loadSrc('data.js');
const { SEED_PLAN, SEED_RUN_PLAN, SEED_REST_PLAN, SEED_GOALS } = loadSrc('seed.js');
const P = loadSrc('plan-parse.js');
const { sameName } = loadSrc('stats.js');
const { check, run } = makeRunner();

const fresh = async () => {
  const v = makeVault([]);
  const io = makeIo(makePlugin(v));
  await io.scaffold();
  return { v, io, data: await io.loadAll() };
};

check('#25 a new vault: the add-on and the backup arrive switched off', async () => {
  const { data } = await fresh();
  const run_ = data.plans.find(p => p.name === SEED_RUN_PLAN.name);
  const rest = data.plans.find(p => p.name === SEED_REST_PLAN.name);
  assert.ok(run_ && rest, 'both starter plans are still created');
  assert.strictEqual(P.isPaused(run_), true, `${SEED_RUN_PLAN.name} is on`);
  assert.strictEqual(P.isPaused(rest), true, `${SEED_REST_PLAN.name} is on`);
});

check('#25 a new vault: the main starter plan is the one Today runs', async () => {
  const { data } = await fresh();
  assert.strictEqual(P.activePlanOf(data.plans).name, SEED_PLAN.name);
});

check('#25 every seeded exercise goal measures an exercise the active starter plan trains', async () => {
  const { data } = await fresh();
  const trained = P.parsePlanBody(SEED_PLAN.body).days.flatMap(d => d.items.map(i => i.exercise));
  const strays = data.goals
    .filter(g => /^exercise-/.test(g.fm.metric || ''))
    .filter(g => !trained.some(x => sameName(x, g.fm.exercise)))
    .map(g => `${g.name} (${g.fm.exercise})`);
  assert.deepStrictEqual(strays, [], 'goals for exercises the plan does not train');
});

check('#25 no running goal is seeded, and the workouts-a-week goal is', async () => {
  const { data } = await fresh();
  const names = data.goals.map(g => g.name);
  assert.ok(!names.some(n => /trail|run|km\b/i.test(n)), `running goals seeded: ${names.join(', ')}`);
  assert.ok(!names.some(n => /muscle-up/i.test(n)), `muscle-up goal seeded: ${names.join(', ')}`);
  assert.strictEqual(data.goals.filter(g => g.fm.metric === 'workouts-per-week').length, 1, names.join(', '));
});

check('#25 the workouts-a-week target is reachable from the active starter plan alone', async () => {
  const days = P.parsePlanBody(SEED_PLAN.body).days.filter(d => !P.isRestDay(d)).length;
  const goal = SEED_GOALS.find(g => g.fm.metric === 'workouts-per-week');
  assert.ok(Number(goal.fm.target) <= days, `target ${goal.fm.target} > ${days} training days in ${SEED_PLAN.name}`);
});

check('#25 an existing vault is not touched by re-running setup', async () => {
  const runText = '---\nparallel: true\n---\n## Run (tue)\n\n- Easy Run | 1 x 30 min\n';
  const goalText = '---\nmetric: exercise-distance\nexercise: Long Trail Run\ntarget: 15\n---\n';
  const v = makeVault([
    [`Gym/Plans/${SEED_RUN_PLAN.name}.md`, runText],
    ['Gym/Goals/15km Trail Run.md', goalText],
  ]);
  const io = makeIo(makePlugin(v));
  await io.scaffold();
  assert.strictEqual(v._disk.get(`Gym/Plans/${SEED_RUN_PLAN.name}.md`), runText);
  assert.strictEqual(v._disk.get('Gym/Goals/15km Trail Run.md'), goalText);
});

run('audit-1125-data-seed');
