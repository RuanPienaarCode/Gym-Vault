'use strict';
/* L2-07 — renaming an exercise note used to detach it, silently.

   Plans, goals and every logged row reference an exercise BY NAME. Rename the
   note in Obsidian and plan lines, goals and history keep the old name: the
   plan line goes inert, the goal reads "no data", and nothing says why. Ruan's
   decision: WARN, do not auto-rewrite. loadAll() now computes
   data.missingExercises — [{ name, plans: [...], goals: [...] }] — for every
   exercise a plan line or an exercise goal names that has no exercise note
   (compared with stats.sameName, the one name rule), and the Exercises page
   shows it beside the duplicate-name warning.

   The list must be EMPTY for a vault where every named exercise has a note —
   including a freshly scaffolded one — or the warning is noise. */
const assert = require('node:assert');
const { makeDocument, flat, byTag, hasClass } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

global.document = makeDocument();
const { makeIo } = loadSrc('data.js');
const pageExercises = loadSrc('page-exercises.js');

const files = noteName => [
  [`Gym/Exercises/${noteName}.md`, '---\ntype: strength\nunit: seconds\n---\nHold it.\n'],
  ['Gym/Plans/Core.md', '---\nactive: true\n---\n## Core (mon)\n\n- Front Hold | 3 x 30s\n'],
  ['Gym/Goals/2-minute hold.md', '---\nmetric: exercise-duration\nexercise: Front Hold\ntarget: 120\n---\n'],
  ['Gym/Workouts/2026-01-05 Core.md', '---\ndate: 2026-01-05\nplan: Core\nday: Core\n---\n| Exercise | Set | Reps | Weight (kg) | Time (s) | Note | Distance (km) |\n|---|---|---|---|---|---|---|\n| Front Hold | 1 |  |  | 45 |  |  |\n'],
];
const load = async fl => makeIo(makePlugin(makeVault(fl))).loadAll();

const { check, run } = makeRunner();

check('L2-07 a renamed exercise note is reported with the plans and goals that still use the old name', async () => {
  const d = await load(files('Front Plank Hold'));
  assert.ok(Array.isArray(d.missingExercises), 'loadAll() must return data.missingExercises');
  assert.deepStrictEqual(d.missingExercises, [{ name: 'Front Hold', plans: ['Core'], goals: ['2-minute hold'] }]);
});

check('L2-07 nothing is reported when the note matches the name (empty list, not undefined)', async () => {
  const d = await load(files('Front Hold'));
  assert.deepStrictEqual(d.missingExercises, []);
});

check('L2-07 matching uses the one name rule: case and surrounding space do not make an exercise "missing"', async () => {
  const d = await load([
    ['Gym/Exercises/Front Hold.md', '---\nunit: seconds\n---\n'],
    ['Gym/Plans/Core.md', '---\nactive: true\n---\n## Core (mon)\n\n- front hold | 3 x 30s\n- Front Hold  | 3 x 30s\n'],
    ['Gym/Goals/Hold.md', '---\nmetric: exercise-duration\nexercise: " FRONT HOLD "\ntarget: 120\n---\n'],
  ]);
  assert.deepStrictEqual(d.missingExercises, []);
});

check('L2-07 one exercise used by two plans and a goal is ONE entry naming all of them', async () => {
  const d = await load([
    ['Gym/Plans/A.md', '---\nactive: true\n---\n## D (mon)\n\n- Ghost Row | 3 x 8\n'],
    ['Gym/Plans/B.md', '---\n---\n## D (tue)\n\n- ghost row | 3 x 8\n- Other Ghost | 1 x 5\n'],
    ['Gym/Goals/G.md', '---\nmetric: exercise-reps\nexercise: Ghost Row\ntarget: 10\n---\n'],
  ]);
  const ghost = d.missingExercises.find(m => m.name === 'Ghost Row');
  assert.ok(ghost, `entries: ${JSON.stringify(d.missingExercises)}`);
  assert.deepStrictEqual(ghost.plans, ['A', 'B']);
  assert.deepStrictEqual(ghost.goals, ['G']);
  assert.strictEqual(d.missingExercises.length, 2, `entries: ${JSON.stringify(d.missingExercises)}`);
});

check('L2-07 a goal that does not measure an exercise, or names none, is not reported', async () => {
  const d = await load([
    ['Gym/Goals/Weekly.md', '---\nmetric: workouts-per-week\nexercise: Leftover Name\ntarget: 4\n---\n'],
    ['Gym/Goals/Blank.md', '---\nmetric: exercise-reps\ntarget: 4\n---\n'],
  ]);
  assert.deepStrictEqual(d.missingExercises, []);
});

check('L2-07 a freshly scaffolded vault reports nothing (every starter plan line and goal has a note)', async () => {
  const v = makeVault([]);
  const io = makeIo(makePlugin(v));
  await io.scaffold();
  const d = await io.loadAll();
  assert.deepStrictEqual(d.missingExercises, [], `the starter library is out of step with its own plans/goals: ${JSON.stringify(d.missingExercises)}`);
});

/* ---- the page ------------------------------------------------------------ */

function renderPage(data) {
  const ctx = { data: { exercises: [], plans: [], goals: [], workouts: [], duplicateExercises: [], ...data }, state: {}, nav() {}, rerender() {}, reload() {}, notice() {}, app: {}, io: {} };
  const root = document.createElement('div');
  pageExercises.render(ctx, root);
  return byTag(root, 'div').filter(d => hasClass(d, 'gv-warn-line')).map(d => d.textContent);
}

check('L2-07 the Exercises page warns: names the exercise and where it is used, with a one-line hint', async () => {
  const d = await load(files('Front Plank Hold'));
  const warns = renderPage(d);
  const text = warns.join(' | ');
  assert.ok(warns.length >= 1, 'no warning rendered for a missing exercise');
  for (const needle of ['Front Hold', 'Core', '2-minute hold']) assert.ok(text.includes(needle), `warning does not mention "${needle}": ${text}`);
  assert.ok(/renamed or deleted/i.test(text) && /rename/i.test(text), `warning has no hint: ${text}`);
});

check('L2-07 the Exercises page shows NO missing-exercise warning when nothing is missing', async () => {
  const d = await load(files('Front Hold'));
  const warns = renderPage(d);
  assert.deepStrictEqual(warns, [], `unexpected warning(s): ${warns.join(' | ')}`);
});

check('L2-07 the missing-exercise warning sits beside the duplicate warning, it does not replace it', async () => {
  const d = await load(files('Front Plank Hold'));
  d.duplicateExercises = ['Gym/Exercises/Legs/Bench.md'];
  const warns = renderPage(d);
  assert.ok(warns.some(w => /shares? a name/.test(w)), `duplicate warning gone: ${warns.join(' | ')}`);
  assert.ok(warns.some(w => /Front Hold/.test(w)), `missing warning gone: ${warns.join(' | ')}`);
});

check('L2-07 a long list is capped, with the true count', async () => {
  const lines = Array.from({ length: 12 }, (_, i) => `- Ghost ${i + 1} | 3 x 8`).join('\n');
  const d = await load([['Gym/Plans/Big.md', `---\nactive: true\n---\n## D (mon)\n\n${lines}\n`]]);
  assert.strictEqual(d.missingExercises.length, 12);
  const text = renderPage(d).join(' | ');
  assert.ok(/12 exercises/.test(text), `the count is missing: ${text}`);
  assert.ok(!text.includes('Ghost 12'), 'every one of 12 names was printed — the banner is a wall of text');
  assert.ok(/more/.test(text), `the cap is not announced: ${text}`);
});

run('missing exercise warning');
