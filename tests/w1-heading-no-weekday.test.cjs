'use strict';
/* A `## Heading` with no `(weekday)` folds into the day above it. That is a
   DELIBERATE parse (plan-parse.js explains why guessing is worse), so it is
   not changed here. What changes: the user is told, in the same shape as the
   missing-exercise warning (data.missingExercises -> Exercises page). */
const assert = require('node:assert');
const { makeDocument, byTag, hasClass } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
global.document = makeDocument();
const { makeIo } = loadSrc('data.js');
const pageExercises = loadSrc('page-exercises.js');
const { parsePlanBody } = require('../src/plan-parse');
const { check, run } = makeRunner();

const PLAN = '---\nactive: true\n---\n## Push (mon)\n\n- Push-ups | 3 x 10\n\n## Pull Day\n\n- Rows | 3 x 8\n\n## Legs (wed)\n\n- Squats | 3 x 5\n';
const load = async fl => makeIo(makePlugin(makeVault(fl))).loadAll();
const renderWarns = data => {
  const ctx = { data: { exercises: [], plans: [], goals: [], workouts: [], duplicateExercises: [], missingExercises: [], ...data }, state: {}, nav() {}, rerender() {}, reload() {}, notice() {}, app: {}, io: {} };
  const root = document.createElement('div');
  pageExercises.render(ctx, root);
  return byTag(root, 'div').filter(d => hasClass(d, 'gv-warn-line')).map(d => d.textContent);
};

check('the parse itself is unchanged: the headingless section stays inside the day above', () => {
  const m = parsePlanBody(PLAN.split('---\n')[2]);
  assert.deepStrictEqual(m.days.map(d => d.name), ['Push', 'Legs']);
  assert.deepStrictEqual(m.days[0].items.map(i => i.exercise), ['Push-ups', 'Rows']);
});

check('loadAll reports the headingless heading with its plan and the day it was folded into', async () => {
  const d = await load([['Gym/Plans/Split.md', PLAN]]);
  assert.deepStrictEqual(d.foldedHeadings, [{ heading: 'Pull Day', plan: 'Split', day: 'Push' }]);
});

check('a plan whose every heading has a weekday reports nothing (empty list, not undefined)', async () => {
  const d = await load([['Gym/Plans/Split.md', '---\n---\n## Push (mon)\n\n- Push-ups | 3 x 10\n']]);
  assert.deepStrictEqual(d.foldedHeadings, []);
});

check('a heading before the first day, a ### sub-heading and a fenced example are not reported', async () => {
  const d = await load([['Gym/Plans/Split.md', '---\n---\n## Notes\n\nintro\n\n## Push (mon)\n\n### Warm-up\n\n```\n## Fake\n```\n- Push-ups | 3 x 10\n']]);
  assert.deepStrictEqual(d.foldedHeadings, []);
});

check('the Exercises page says it in words: heading, plan, and the day it is read as part of', async () => {
  const d = await load([['Gym/Plans/Split.md', PLAN]]);
  const warns = renderWarns(d);
  assert.ok(warns.some(w => w.includes('‘Pull Day’ in Split has no (weekday), so it is read as part of Push')), `warnings: ${warns.join(' | ')}`);
});

check('no warning is rendered when nothing is folded', async () => {
  assert.deepStrictEqual(renderWarns({ foldedHeadings: [] }), []);
  assert.deepStrictEqual(renderWarns({}), []);
});

check('a long list is capped, with the true count', async () => {
  const many = Array.from({ length: 8 }, (_, i) => `## Extra ${i + 1}\n\n- Rows | 3 x 8\n`).join('\n');
  const d = await load([['Gym/Plans/Big.md', `---\n---\n## Push (mon)\n\n${many}`]]);
  assert.strictEqual(d.foldedHeadings.length, 8);
  const text = renderWarns(d).join(' | ');
  assert.ok(!text.includes('Extra 8'), 'every heading printed');
  assert.ok(/5 more/.test(text), text);
});

run('w1-heading-no-weekday');
