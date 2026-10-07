'use strict';
/* L2-05 — "Create starter files" must not take over Today.

   scaffold() creates every MISSING starter, and the starter plan carries
   `active: true`. On a vault that already had a plan the user runs, re-running
   setup (Settings -> Starter files) re-created a deleted starter beside it,
   flagged active — two active plans, and Today (which takes the first active
   main plan, alphabetically) switched to the starter. The starter plan is now
   seeded active ONLY when nothing in the vault could already drive Today: no
   plan flagged active and no main (non-parallel, non-fallback) plan that
   Today would fall back to. An existing plan is never touched (scaffold never
   overwrites). */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

const { makeIo } = loadSrc('data.js');
const { parseFrontmatter } = loadSrc('markdown.js');
const { SEED_PLAN, SEED_RUN_PLAN, SEED_REST_PLAN } = loadSrc('seed.js');

const STARTER = `Gym/Plans/${SEED_PLAN.name}.md`;
const mine = '## Push (mon)\n\n- Push-ups | 3 x 10\n';

const scaffoldOver = async files => {
  const v = makeVault(files);
  const io = makeIo(makePlugin(v));
  await io.scaffold();
  const data = await io.loadAll();
  const flagged = data.plans.filter(p => String(p.fm.active) === 'true').map(p => p.name);
  return { v, data, flagged };
};

const { check, run } = makeRunner();

check('L2-05 a vault with an active plan of its own: the starter is created INACTIVE and Today does not switch', async () => {
  const { v, flagged } = await scaffoldOver([['Gym/Plans/Push Pull Legs.md', `---\nactive: true\n---\n${mine}`]]);
  assert.ok(v.getFileByPath(STARTER), 'the missing starter plan should still be created');
  assert.deepStrictEqual(flagged, ['Push Pull Legs'], `plans flagged active after scaffold: ${flagged.join(' + ')} (expected only the user's plan)`);
});

check('L2-05 plans exist but none is flagged: the starter must not become the explicit active plan', async () => {
  /* Today falls back to the first main plan when none is flagged (controller
     isImplicitActive) — an `active: true` starter would take that over too. */
  const { flagged } = await scaffoldOver([['Gym/Plans/Aardvark Plan.md', `---\nactive: false\n---\n${mine}`]]);
  assert.deepStrictEqual(flagged, [], `the starter was flagged active over the user's implicit plan: ${flagged.join(' + ')}`);
});

check('L2-05 an empty vault: the starter IS the active plan (first-run setup is unchanged)', async () => {
  const { flagged } = await scaffoldOver([]);
  assert.deepStrictEqual(flagged, [SEED_PLAN.name]);
});

check('L2-05 only parallel/fallback plans exist: the starter still becomes active (they cannot drive Today)', async () => {
  const { flagged } = await scaffoldOver([
    ['Gym/Plans/Easy Running.md', '---\nparallel: true\n---\n## Run (tue)\n\n- Easy Run | 1 x 30 min\n'],
    ['Gym/Plans/Rest.md', '---\nparallel: true\nfallback: true\n---\n## Rest (any)\n\n- Walk | 1 x 20 min\n'],
  ]);
  assert.deepStrictEqual(flagged, [SEED_PLAN.name]);
});

check('L2-05 re-running setup on a complete vault changes no plan note', async () => {
  const v = makeVault([]);
  const io = makeIo(makePlugin(v));
  await io.scaffold();
  const plans = [SEED_PLAN.name, SEED_RUN_PLAN.name, SEED_REST_PLAN.name].map(n => `Gym/Plans/${n}.md`);
  const before = plans.map(p => v._disk.get(p));
  assert.ok(before.every(t => typeof t === 'string'), 'first scaffold must create all three starter plans');
  await io.scaffold();
  assert.deepStrictEqual(plans.map(p => v._disk.get(p)), before);
  assert.strictEqual(String(parseFrontmatter(v._disk.get(plans[0])).fm.active), 'true');
});

check('L2-05 the user deleted the starter and runs another plan: re-running setup brings it back inactive', async () => {
  const v = makeVault([]);
  const io = makeIo(makePlugin(v));
  await io.scaffold();
  await io.trash(v.getFileByPath(STARTER));
  await io.createPlan('My Split', { active: true }, mine);   // the user's own plan takes over
  await io.scaffold();
  const data = await io.loadAll();
  const flagged = data.plans.filter(p => String(p.fm.active) === 'true').map(p => p.name);
  assert.deepStrictEqual(flagged, ['My Split'], `after re-running setup the active plans are: ${flagged.join(' + ')}`);
});

run('scaffold keeps the active plan');
