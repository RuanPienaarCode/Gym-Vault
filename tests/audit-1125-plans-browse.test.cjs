'use strict';
/* AUDIT 25 NOV 2026 — lane L5, Browse (src/page-browse.js).

   26  once a library plan is added, the dead "added" badge becomes an "Open"
       button (with a small "added" marker beside it) that goes to that plan's
       page, so the Active switch is one tap away; Back from there returns to
       Browse through the page's own back stack.
   39  "added" was decided by NAME only. A library plan also counts as added when
       any vault plan's frontmatter `source` equals the library entry's `id`
       (installPlan writes `source: <id>`); the name match stays for plans that
       were installed before that.

   Drives the real page-browse.js over the shared DOM stub. */
const assert = require('node:assert');
const T = require('./f3-stub');
const browse = require('../src/page-browse');
const { safeName } = require('../src/data');
const fake = require('./gym-fake-vault');

const { check, run } = fake.makeRunner();
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

const entry = (name, extra) => Object.assign({ id: name.toLowerCase().replace(/\W+/g, '-'), name, file: `plans/${name}.md`, days: 3, exercises: ['a', 'b'], summary: 's' }, extra);

function setup({ localPlans = [], index }) {
  const navs = [];
  const ctx = {
    app: {}, data: { plans: localPlans.map(p => (typeof p === 'string' ? { name: p, fm: {} } : p)) }, settings: { planRepo: 'https://lib.example' },
    state: { params: {} }, backTo: f => f, back() {}, nav: (...a) => navs.push(a), reload: async () => {}, notice() {},
    io: {
      safeName,
      fetchPlanIndex: async () => index,
      installPlan: async () => ({ planSkipped: false, exercisesAdded: 0, exercisesSkipped: 0, failed: [] }),
    },
  };
  return { ctx, navs };
}
const buttons = (root, re) => T.findAll(root, 'gv-btn').filter(b => re.test(b.textContent.replace(/\s+/g, ' ').trim()));
const markers = root => [...T.findAll(root, 'gv-badge'), ...T.findAll(root, 'gv-tag')].map(n => n.textContent.trim()).filter(t => t === 'added');

check('26: an added plan shows an Open button (and a small "added" marker) instead of a dead badge', async () => {
  const s = setup({ localPlans: ['Solo'], index: { plans: [entry('Solo')] } });
  const root = T.render(browse, s.ctx);
  await settle();
  const open = buttons(root, /^Open$/);
  assert.strictEqual(open.length, 1, 'one Open button');
  assert.strictEqual(open[0].attrs.type, 'button');
  assert.deepStrictEqual(markers(root), ['added'], 'the small added marker stays');
  assert.strictEqual(buttons(root, /^Add/).length, 0);
});
check('26: Open goes to that plan\'s page (the vault plan\'s own name), which pushes Browse on the back stack', async () => {
  const s = setup({ localPlans: [{ name: 'Push-Pull', fm: {} }], index: { plans: [entry('Push/Pull')] } });
  const root = T.render(browse, s.ctx);
  await settle();
  buttons(root, /^Open$/)[0].click();
  assert.deepStrictEqual(s.navs, [['plans', { plan: 'Push-Pull' }]]);
});
check('26: a plan not yet added still offers Add and no Open', async () => {
  const s = setup({ localPlans: [], index: { plans: [entry('Fresh')] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(buttons(root, /^Open$/).length, 0);
  assert.strictEqual(buttons(root, /^Add/).length, 1);
});
check('26: each added phase row of a series gets its own Open', async () => {
  const p1 = entry('Prog 1 · A', { series: 'Prog', phase: 1 });
  const p2 = entry('Prog 2 · B', { series: 'Prog', phase: 2 });
  const s = setup({ localPlans: ['Prog 1 · A'], index: { plans: [p1, p2] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(buttons(root, /^Open$/).length, 1, 'phase 1 is added');
  assert.strictEqual(buttons(root, /^Add$/).length, 1, 'phase 2 is not');
  buttons(root, /^Open$/)[0].click();
  assert.deepStrictEqual(s.navs, [['plans', { plan: 'Prog 1 · A' }]]);
});

check('39: a vault plan whose frontmatter source equals the entry id counts as added, whatever its name', async () => {
  const s = setup({ localPlans: [{ name: 'My renamed copy', fm: { source: 'hill-day' } }], index: { plans: [entry('Hill Day', { id: 'hill-day' })] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.deepStrictEqual(markers(root), ['added']);
  assert.strictEqual(buttons(root, /^Add/).length, 0);
  buttons(root, /^Open$/)[0].click();
  assert.deepStrictEqual(s.navs, [['plans', { plan: 'My renamed copy' }]], 'Open goes to the plan found by source');
});
check('39: the name match still counts for plans installed before `source` was written', async () => {
  const s = setup({ localPlans: [{ name: 'Old Install', fm: {} }], index: { plans: [entry('Old Install', { id: 'old-install' })] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.deepStrictEqual(markers(root), ['added']);
});
check('39: a different source id does not count; a plan with no source does not match by accident', async () => {
  const s = setup({ localPlans: [{ name: 'Else', fm: { source: 'other-id' } }, { name: 'Bare', fm: {} }], index: { plans: [entry('Hill Day', { id: 'hill-day' })] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(markers(root).length, 0);
  assert.strictEqual(buttons(root, /^Add/).length, 1);
});
check('39: a series is complete when its phases are found by source id', async () => {
  const p1 = entry('Prog 1 · A', { series: 'Prog', phase: 1, id: 'prog-1' });
  const p2 = entry('Prog 2 · B', { series: 'Prog', phase: 2, id: 'prog-2' });
  const s = setup({ localPlans: [{ name: 'x1', fm: { source: 'prog-1' } }, { name: 'x2', fm: { source: 'prog-2' } }], index: { plans: [p1, p2] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(buttons(root, /^Add/).length, 0, 'no Add all on a complete series');
  assert.strictEqual(buttons(root, /^Open$/).length, 2);
});

run('audit 1125 plans browse');
