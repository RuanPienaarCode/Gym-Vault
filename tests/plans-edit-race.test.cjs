'use strict';
/* L2-01 — plan edit mode used to LOSE edits.

   `change` called persist() without awaiting it, and the row's `focusout`
   called ctx.reload() in the same task. Obsidian's cachedRead() serves the
   OLD text until the write has landed, so the reload rebuilt the model from
   stale text, put the old value back on screen, and the NEXT edit saved that
   stale model over the first edit. The user typed 5 sets; the note kept 3.

   This drives the REAL render() from src/page-plans.js and the REAL io from
   src/data.js over a fake vault with Obsidian's write timing (writes land
   late; cachedRead is stale until then — see gym-fake-vault.js). The ctx.reload
   below does what controller.js's does: loadAll(), then re-render. */
const assert = require('node:assert');
const { makeDocument, fire, flat, byTag, hasClass } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner, notices, sleep } = require('./gym-fake-vault');

global.document = makeDocument();
const { makeIo } = loadSrc('data.js');
const pagePlans = loadSrc('page-plans.js');

const PLAN = 'Gym/Plans/Test Plan.md';
const PLAN_TEXT = '---\nactive: true\n---\n## Push (mon)\n\n- Push-ups | 3 x 10\n- Dips | 3 x 8\n';

/* A page backed by the real io. `delay` is how long a write takes to land. */
async function mount(delay) {
  const v = makeVault([
    ['Gym/Profile.md', '---\nname: T\n---\n'],
    ['Gym/Exercises/Push-ups.md', '---\nunit: reps\n---\n'],
    ['Gym/Exercises/Dips.md', '---\nunit: reps\n---\n'],
    [PLAN, PLAN_TEXT],
  ], { delay });
  const io = makeIo(makePlugin(v));
  const page = { root: null, reloads: 0 };
  const ctx = {
    app: {}, io, data: await io.loadAll(),
    state: { params: { plan: 'Test Plan' }, plansUi: { plan: 'Test Plan', editing: true } },
    nav() {}, openFile() {}, startGuided() {}, backTo: f => f, back() {},
    notice: m => notices.push(m),
    mainPlans: () => ctx.data.plans.filter(p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true'),
  };
  ctx.rerender = () => { page.root = document.createElement('div'); pagePlans.render(ctx, page.root); };
  ctx.reload = async () => { page.reloads++; ctx.data = await io.loadAll(); ctx.rerender(); };
  ctx.rerender();
  return { v, ctx, page };
}

const rows = page => byTag(page.root, 'div').filter(d => hasClass(d, 'gv-edititem'));
const setsOf = row => byTag(row, 'input').find(i => hasClass(i, 'gv-edititem-sets'));
const targetOf = row => byTag(row, 'input').find(i => hasClass(i, 'gv-edititem-target'));
const elsewhere = { tag: 'div', contains: () => false };   // focus landing outside the row
const type = (input, value) => { input.value = value; fire(input, 'change'); };
const leave = row => fire(row, 'focusout', { relatedTarget: elsewhere });
const line = (text, exercise) => (text.split('\n').find(l => l.startsWith(`- ${exercise}`)) || '(line missing)');

const { check, run } = makeRunner();

check('L2-01 edit, leave the row, edit another row: BOTH edits are on disk', async () => {
  const { v, page } = await mount(5);
  /* Edit 1: Push-ups sets 3 -> 5, then focus leaves the row (-> reload). */
  const r0 = rows(page)[0];
  type(setsOf(r0), '5');
  leave(r0);
  await sleep(80);
  /* Edit 2, on the page as it is now (re-rendered by the reload): Dips target 8 -> 12. */
  const r1 = rows(page)[1];
  type(targetOf(r1), '12');
  leave(r1);
  await sleep(80);
  const disk = v._disk.get(PLAN);
  assert.strictEqual(line(disk, 'Push-ups'), '- Push-ups | 5 x 10',
    `the first edit was lost: Push-ups line on disk is "${line(disk, 'Push-ups')}" (user typed 5 sets)`);
  assert.strictEqual(line(disk, 'Dips'), '- Dips | 3 x 12',
    `the second edit is missing: Dips line on disk is "${line(disk, 'Dips')}" (user typed target 12)`);
});

check('L2-01 the screen shows what was saved after the reload (not the stale model)', async () => {
  const { page } = await mount(5);
  const r0 = rows(page)[0];
  type(setsOf(r0), '5');
  leave(r0);
  await sleep(80);
  assert.strictEqual(setsOf(rows(page)[0]).value, '5',
    `after the reload the Sets box shows "${setsOf(rows(page)[0]).value}", not the 5 the user typed and the note now holds`);
});

check('L2-01 two edits before the first write lands: both reach the note, in order', async () => {
  const { v, page } = await mount(15);
  const [r0, r1] = rows(page);
  type(setsOf(r0), '5');          // write 1 starts
  type(targetOf(r1), '12');       // write 2 requested while write 1 is still landing
  leave(r1);
  await sleep(120);
  const disk = v._disk.get(PLAN);
  assert.strictEqual(line(disk, 'Push-ups'), '- Push-ups | 5 x 10', `Push-ups line on disk is "${line(disk, 'Push-ups')}"`);
  assert.strictEqual(line(disk, 'Dips'), '- Dips | 3 x 12', `Dips line on disk is "${line(disk, 'Dips')}"`);
});

check('L2-01 a reload never reads the note while one of its own saves is still landing', async () => {
  const { v, ctx, page } = await mount(30);
  let readsDuringWrite = 0;
  const realRead = v.cachedRead;
  let writing = false;
  const realProcess = v.process, realModify = v.modify;
  v.process = async (f, fn) => { writing = true; try { return await realProcess(f, fn); } finally { writing = false; } };
  v.modify = async (f, t) => { writing = true; try { return await realModify(f, t); } finally { writing = false; } };
  v.cachedRead = async f => { if (writing && f.path === PLAN) readsDuringWrite++; return realRead(f); };
  const r0 = rows(page)[0];
  type(setsOf(r0), '5');
  leave(r0);
  await sleep(150);
  assert.strictEqual(readsDuringWrite, 0,
    `the focusout reload read the plan ${readsDuringWrite} time(s) while its own save was still in flight`);
  assert.ok(page.reloads >= 1, 'the reload after leaving the row must still happen');
  assert.strictEqual(ctx.data.plans[0].model.days[0].items[0].sets, 5, 'the reloaded model must hold the edit');
});

run('plans edit race');
