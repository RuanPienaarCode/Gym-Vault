'use strict';
/* AUDIT 16 NOV 2026 — Browse (the shared plan library).

   #42 (Low): a library name containing one of / : # [ ] never showed "added".
   Notes are saved under the FOLDED name (data.safeName: those characters become
   "-"), but Browse compared the unfolded library name with the local names, so
   the badge check failed forever, a second Add reported "added" although the
   install had been skipped, and the plan could be added again and again. Browse
   compares through ctx.io.safeName on both sides (contract K4), and the notice
   after a skipped install says the plan was already there.

   #46 (Low): Browse kept the old library after the Plan library address was
   changed. The fetched index was cached in ctx.state.browseUi and nothing
   cleared it, so Browse showed the old list and Add fetched the old entry from
   the new address (a 404). The cached index remembers the address it came from
   and is fetched again when settings.planRepo no longer matches.

   Drives the real page-browse.js over the shared DOM stub, with data.js's real
   safeName as ctx.io.safeName. */
const assert = require('node:assert');
const T = require('./f3-stub');
const browse = require('../src/page-browse');
const { safeName } = require('../src/data');

let failed = 0;
const queue = [];
const check = (name, fn) => queue.push([name, fn]);
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

const plan = (name, extra) => Object.assign({ name, file: `plans/${name}.md`, days: 3, exercises: ['a', 'b'], summary: 's' }, extra);

function setup({ localPlans = [], index, indexes, repo = 'https://lib-a.example' } = {}) {
  const notices = [];
  const fetches = [];
  const installs = [];
  const ctx = {
    app: {}, data: { plans: localPlans.map(name => ({ name })) }, settings: { planRepo: repo },
    state: { params: {} }, backTo: f => f, back() {}, nav() {}, reload: async () => {},
    notice: m => notices.push(m),
    io: {
      safeName,
      fetchPlanIndex: async () => { fetches.push(ctx.settings.planRepo); return indexes ? indexes[ctx.settings.planRepo] : index; },
      installPlan: async e => { installs.push(e.name); return { planSkipped: false, exercisesAdded: 0, exercisesSkipped: 0, failed: [] }; },
    },
  };
  return { ctx, notices, fetches, installs };
}
const cardNames = root => T.findAll(root, 'gv-browse-name').map(n => n.textContent.trim());
const addButtons = root => T.findAll(root, 'gv-btn').filter(b => /^\s*Add/.test(b.textContent.replace(/\s+/g, ' ')));
const badges = root => [...T.findAll(root, 'gv-badge'), ...T.findAll(root, 'gv-tag')].map(n => n.textContent.trim()).filter(t => t === 'added');

check('#42 a library name with / : # [ ] shows "added" once its folded note exists', async () => {
  const lib = plan('Push/Pull: Day #1 [A]');
  const s = setup({ localPlans: [safeName('Push/Pull: Day #1 [A]')], index: { plans: [lib] } });
  assert.strictEqual(safeName(lib.name), 'Push-Pull- Day -1 -A-', 'control: the note is saved under the folded name');
  const root = T.render(browse, s.ctx);
  await settle();
  assert.deepStrictEqual(badges(root), ['added'], 'the card should say "added"');
  assert.strictEqual(addButtons(root).length, 0, 'and offer no Add button for a plan already in the vault');
});

check('#42 the same holds for a phase row of a series, and the series reads complete', async () => {
  const p1 = plan('Prog 1 · Base/Build', { series: 'Prog', phase: 1 });
  const p2 = plan('Prog 2 · Peak: Taper', { series: 'Prog', phase: 2 });
  const s = setup({ localPlans: [safeName(p1.name), safeName(p2.name)], index: { plans: [p1, p2] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(addButtons(root).length, 0, `${addButtons(root).length} Add button(s) for a series that is fully installed`);
  assert.ok(badges(root).length >= 1, 'the series says "added"');
});

check('#42 control: a plain name, and a plan that is genuinely missing, behave as before', async () => {
  const s = setup({ localPlans: ['Solo'], index: { plans: [plan('Solo'), plan('Other/Plan')] } });
  const root = T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(badges(root).length, 1, 'only Solo is added');
  assert.strictEqual(addButtons(root).length, 1, 'Other/Plan is still offered');
});

check('#42 a skipped install says it was already there, not "added"', async () => {
  const s = setup({ index: { plans: [plan('Solo')] } });
  s.ctx.io.installPlan = async () => ({ planSkipped: true, exercisesAdded: 0, exercisesSkipped: 2, failed: [] });
  const root = T.render(browse, s.ctx);
  await settle();
  addButtons(root)[0].click();
  await settle();
  assert.strictEqual(s.notices.length, 1, `notices: ${JSON.stringify(s.notices)}`);
  assert.ok(/already there/.test(s.notices[0]), `notice: "${s.notices[0]}"`);
  assert.ok(!/Solo added/.test(s.notices[0]), `notice still claims it was added: "${s.notices[0]}"`);
});

check('#42 a series where one phase was skipped counts only the plans it really added', async () => {
  const p1 = plan('Prog 1 · A', { series: 'Prog', phase: 1 });
  const p2 = plan('Prog 2 · B', { series: 'Prog', phase: 2 });
  const s = setup({ index: { plans: [p1, p2] } });
  let n = 0;
  s.ctx.io.installPlan = async () => ({ planSkipped: n++ === 0, exercisesAdded: 0, exercisesSkipped: 0, failed: [] });
  const root = T.render(browse, s.ctx);
  await settle();
  addButtons(root).find(b => /Add all/.test(b.textContent)).click();
  await settle();
  assert.ok(/^1 plan added/.test(s.notices[0]) && /1 already there/.test(s.notices[0]), `notice: "${s.notices[0]}"`);
});

check('#42 a one-phase series names that plan in the notice (never " added.")', async () => {
  const p1 = plan('Prog 1 · A', { series: 'Prog', phase: 1 });
  const s = setup({ index: { plans: [p1] } });
  const root = T.render(browse, s.ctx);
  await settle();
  addButtons(root).find(b => /Add all/.test(b.textContent)).click();
  await settle();
  assert.strictEqual(s.notices[0], 'Prog 1 · A added.', `notice: "${s.notices[0]}"`);
});

check('control: a real install still says "<name> added."', async () => {
  const s = setup({ index: { plans: [plan('Solo')] } });
  const root = T.render(browse, s.ctx);
  await settle();
  addButtons(root)[0].click();
  await settle();
  assert.strictEqual(s.notices[0], 'Solo added.');
});

check('#46 changing the Plan library address refetches: the list is the new library, not the cached one', async () => {
  const s = setup({
    repo: 'https://lib-a.example',
    indexes: { 'https://lib-a.example': { plans: [plan('Old Plan')] }, 'https://lib-b.example': { plans: [plan('New Plan')] } },
  });
  const first = T.render(browse, s.ctx);
  await settle();
  assert.deepStrictEqual(cardNames(first), ['Old Plan']);
  s.ctx.settings.planRepo = 'https://lib-b.example';       // the user edits the address in Settings, then comes back
  const second = T.render(browse, s.ctx);
  await settle();
  assert.deepStrictEqual(cardNames(second), ['New Plan'], `Browse shows ${JSON.stringify(cardNames(second))} after the address changed (fetches: ${JSON.stringify(s.fetches)})`);
  assert.deepStrictEqual(s.fetches, ['https://lib-a.example', 'https://lib-b.example']);
});

check('#46 control: with the address unchanged the cached index is reused (no second fetch)', async () => {
  const s = setup({ index: { plans: [plan('Solo')] } });
  T.render(browse, s.ctx);
  await settle();
  const again = T.render(browse, s.ctx);
  await settle();
  assert.deepStrictEqual(cardNames(again), ['Solo']);
  assert.strictEqual(s.fetches.length, 1, `fetched ${s.fetches.length} times`);
});

check('#46 a trailing slash on the address is the same address (no needless refetch)', async () => {
  const s = setup({ index: { plans: [plan('Solo')] }, repo: 'https://lib-a.example' });
  T.render(browse, s.ctx);
  await settle();
  s.ctx.settings.planRepo = 'https://lib-a.example/';
  T.render(browse, s.ctx);
  await settle();
  assert.strictEqual(s.fetches.length, 1);
});

check('#46 a failed fetch from the NEW address does not resurface the old library on the next visit', async () => {
  const s = setup({ indexes: { 'https://lib-a.example': { plans: [plan('Old Plan')] } } });
  T.render(browse, s.ctx);
  await settle();
  s.ctx.settings.planRepo = 'https://lib-bad.example';
  s.ctx.io.fetchPlanIndex = async () => { s.fetches.push(s.ctx.settings.planRepo); throw new Error('404'); };
  T.render(browse, s.ctx);
  await settle();
  const third = T.render(browse, s.ctx);
  await settle();
  assert.ok(!cardNames(third).includes('Old Plan'), `the old library came back: ${JSON.stringify(cardNames(third))}`);
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
  }
  if (failed) { console.error(`audit-1116 content browse: ${failed} of ${queue.length} check(s) FAILED`); process.exit(1); }
  console.log('audit-1116 content browse OK');
})();
