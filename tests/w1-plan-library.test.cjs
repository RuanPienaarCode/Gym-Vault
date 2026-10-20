'use strict';
/* L6-05 — one malformed entry in the remote plans.json used to blank Browse
   (only "plans is an array" was checked; the first entry without `exercises`
   threw while drawing). L6-06 — the library URL accepted http://, and a plan
   could name any number of exercises, each one fetched. */
const assert = require('node:assert');
const { obsidianStub, notices, loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

let handler = async () => { throw new Error('offline'); };
const urls = [];
obsidianStub.requestUrl = async req => { urls.push(req.url); return handler(req); };
const { makeIo } = loadSrc('data.js');
const { check, run } = makeRunner();

const good = n => ({ name: n, file: `plans/${n}.md`, days: 3, exercises: ['A', 'B'], summary: 's' });
const io = (repo = 'https://raw.githubusercontent.com/x/y/main', files = []) => makeIo(makePlugin(makeVault(files), { planRepo: repo }));
const serve = index => { handler = async () => ({ text: JSON.stringify(index) }); };

check('L6-05 one malformed entry is skipped and counted; the rest are shown', async () => {
  serve({ plans: [good('One'), null, 'text', { name: 'No file' }, { file: 'plans/x.md' }, { name: '', file: 'a.md' }, { name: 'No list', file: 'plans/n.md' }, good('Two')] });
  const idx = await io().fetchPlanIndex();
  assert.deepStrictEqual(idx.plans.map(p => p.name), ['One', 'No list', 'Two']);
  assert.strictEqual(idx.skipped, 5, `skipped: ${idx.skipped}`);
});

check('L6-05 an entry without an exercises list is kept with an empty list (Browse reads .length)', async () => {
  serve({ plans: [{ name: 'No list', file: 'plans/n.md', exercises: 'oops' }] });
  const idx = await io().fetchPlanIndex();
  assert.deepStrictEqual(idx.plans[0].exercises, []);
});

check('L6-05 a clean index reports skipped: 0 and tells nobody', async () => {
  notices.length = 0;
  serve({ plans: [good('One'), good('Two')] });
  const idx = await io().fetchPlanIndex();
  assert.strictEqual(idx.skipped, 0);
  assert.deepStrictEqual(notices, []);
});

check('L6-05 skipped entries are said out loud', async () => {
  notices.length = 0;
  serve({ plans: [good('One'), null] });
  await io().fetchPlanIndex();
  assert.ok(notices.some(n => /1 .*skipped/.test(n)), `notices: ${notices.join(' | ')}`);
});

check('L6-05 an index that is not { plans: [] } still throws the existing message', async () => {
  serve({ nope: true });
  await assert.rejects(io().fetchPlanIndex(), /did not return a plan index/);
});

check('L6-06 an http:// library URL is refused before anything is fetched', async () => {
  urls.length = 0;
  await assert.rejects(io('http://example.com/plans').fetchPlanIndex(), /https/);
  assert.strictEqual(urls.length, 0, `fetched: ${urls}`);
});

check('L6-06 raw.githubusercontent.com (https) still works', async () => {
  serve({ plans: [good('One')] });
  const idx = await io('https://raw.githubusercontent.com/RuanPienaarCode/gym_plans/main/').fetchPlanIndex();
  assert.strictEqual(idx.plans.length, 1);
});

check('L6-06 a plan naming hundreds of exercises fetches only a capped number, and says so', async () => {
  notices.length = 0; urls.length = 0;
  handler = async req => ({ text: req.url.endsWith('.md') && req.url.includes('/plans/') ? '---\n---\n## D (mon)\n\n- E | 3 x 5\n' : '---\ntype: strength\n---\n' });
  const names = Array.from({ length: 500 }, (_, i) => `Ex ${i}`);
  const out = await io().installPlan({ name: 'Huge', file: 'plans/huge.md', exercises: names });
  const fetched = urls.filter(u => u.includes('/exercises/')).length;
  assert.ok(fetched <= 60, `fetched ${fetched} exercise files`);
  assert.ok(fetched > 0);
  assert.strictEqual(out.exercisesAdded, fetched);
  assert.ok(out.capped > 0 && out.capped === 500 - fetched, `capped: ${out.capped}`);
  assert.ok(notices.some(n => /Huge/.test(n) && /500/.test(n)), `notices: ${notices.join(' | ')}`);
});

check('L6-06 a normal plan (26 exercises) is not capped', async () => {
  notices.length = 0; urls.length = 0;
  handler = async () => ({ text: '---\ntype: strength\n---\n' });
  const out = await io().installPlan({ name: 'Normal', file: 'plans/normal.md', exercises: Array.from({ length: 26 }, (_, i) => `N ${i}`) });
  assert.strictEqual(out.exercisesAdded, 26);
  assert.ok(!out.capped);
  assert.deepStrictEqual(notices, []);
});

run('w1-plan-library');
