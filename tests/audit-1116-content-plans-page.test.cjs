'use strict';
/* AUDIT 16 NOV 2026 — the Plans page.

   #7 (Medium): a double tap on Remove deleted two exercises. Remove mutated the
   model by the index captured at render, then saved and reloaded
   asynchronously; the button stayed live, so a second click removed whatever
   had slid into that index. Two clicks 80 ms apart removed Pull-ups AND
   Push-ups. Once a structural edit (Remove or Move) has been clicked, further
   clicks on the plan's row controls are ignored until the save has finished and
   the page has been re-drawn.

   #1 (display half): a line with a set count and an empty Target printed a
   dangling "5 × ". It prints "5 sets".

   Also: a Plans facet filter could strand you — the chip row hides when one kit
   is left, but the stale `ui.kit` kept filtering, so the list said "No plan
   matches both filters" with no chip to clear.

   Drives the REAL page-plans.js and the REAL io from data.js over the fake
   vault (write timing of Obsidian 1.14.4, see gym-fake-vault.js). */
const assert = require('node:assert');
const { makeDocument, fire, flat, byTag, hasClass } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner, notices, sleep } = require('./gym-fake-vault');

global.document = makeDocument();
const { makeIo } = loadSrc('data.js');
const pagePlans = loadSrc('page-plans.js');
const planParse = require('../src/plan-parse');

const PLAN = 'Gym/Plans/Test Plan.md';
const THREE = '---\nactive: true\n---\n## Push (mon)\n\n- Pull-ups | 3 x 8\n- Push-ups | 3 x 10\n- Dips | 3 x 8\n';

async function mount(text, delay, editing) {
  const v = makeVault([
    ['Gym/Profile.md', '---\nname: T\n---\n'],
    ['Gym/Exercises/Pull-ups.md', '---\nunit: reps\n---\n'],
    ['Gym/Exercises/Push-ups.md', '---\nunit: reps\n---\n'],
    ['Gym/Exercises/Dips.md', '---\nunit: reps\n---\n'],
    [PLAN, text],
  ], { delay });
  const io = makeIo(makePlugin(v));
  const page = { root: null, reloads: 0, draws: 0 };
  const ctx = {
    app: {}, io, data: await io.loadAll(),
    state: { params: { plan: 'Test Plan' }, plansUi: { plan: 'Test Plan', editing: editing !== false } },
    nav() {}, openFile() {}, startGuided() {}, backTo: f => f, back() {},
    notice: m => notices.push(m),
    mainPlans: () => ctx.data.plans,
  };
  ctx.rerender = () => { page.draws++; page.root = document.createElement('div'); pagePlans.render(ctx, page.root); };
  ctx.reload = async () => { page.reloads++; ctx.data = await io.loadAll(); ctx.rerender(); };
  ctx.rerender();
  return { v, ctx, page };
}

const btn = (page, label) => byTag(page.root, 'button').filter(b => b.attrs['aria-label'] === label);
const removeBtns = page => byTag(page.root, 'button').filter(b => b.attrs['aria-label'] === 'Remove');
const click = b => fire(b, 'click', {});
const exercisesOnDisk = v => (v._disk.get(PLAN).match(/^- (.+?) \|/gm) || []).map(l => l.replace(/^- | \|$/g, ''));

const { check, run } = makeRunner();

check('#7 two taps on the same Remove, 80 ms apart: ONE exercise is removed', async () => {
  const { v, page } = await mount(THREE, 150);
  const first = removeBtns(page)[0];            // Pull-ups
  click(first);
  await sleep(80);
  click(first);                                 // the second tap of a double tap, save still landing
  await sleep(500);
  assert.deepStrictEqual(exercisesOnDisk(v), ['Push-ups', 'Dips'],
    `the plan on disk now lists ${JSON.stringify(exercisesOnDisk(v))}: the second tap removed whatever slid into the index`);
});

check('#7 a tap on ANOTHER row\'s Remove while the first removal is saving is ignored too', async () => {
  const { v, page } = await mount(THREE, 150);
  const [r0, r1] = removeBtns(page);
  click(r0);
  await sleep(40);
  click(r1);
  await sleep(500);
  assert.deepStrictEqual(exercisesOnDisk(v), ['Push-ups', 'Dips'],
    `disk lists ${JSON.stringify(exercisesOnDisk(v))}: a second row was removed under the first save`);
});

check('#7 Move is held the same way: two taps on Move down move the line once', async () => {
  const { v, page } = await mount(THREE, 150);
  const down = btn(page, 'Move Pull-ups down')[0];
  click(down);
  await sleep(40);
  click(down);
  await sleep(500);
  assert.deepStrictEqual(exercisesOnDisk(v), ['Push-ups', 'Pull-ups', 'Dips'],
    `disk order is ${JSON.stringify(exercisesOnDisk(v))}`);
});

check('#7 on a vault that saves at once, a double tap 80 ms apart still removes ONE exercise', async () => {
  /* The save and the re-draw finish before the second tap, so the saving hold is
     already gone and the tap lands on the row that slid under it (Push-ups). */
  const { v, page } = await mount(THREE, 0);
  click(removeBtns(page)[0]);                   // Pull-ups
  await sleep(80);
  assert.ok(page.draws >= 2, 'fixture: the page was already re-drawn before the second tap');
  click(removeBtns(page)[0]);                   // the row now under the finger
  await sleep(300);
  assert.deepStrictEqual(exercisesOnDisk(v), ['Push-ups', 'Dips'], `disk lists ${JSON.stringify(exercisesOnDisk(v))}`);
});

check('#7 once the page has been re-drawn the controls work again (the hold is released)', async () => {
  const { v, page } = await mount(THREE, 40);
  click(removeBtns(page)[0]);                   // Pull-ups
  await sleep(450);                             // past the save AND the double-tap window
  assert.ok(page.draws >= 2, 'the page was re-drawn after the save');
  click(removeBtns(page)[0]);                   // Push-ups, on the fresh page
  await sleep(300);
  assert.deepStrictEqual(exercisesOnDisk(v), ['Dips'], `disk lists ${JSON.stringify(exercisesOnDisk(v))}`);
});

check('#7 a reload that keeps the same plan objects (a failed refresh) still releases the hold', async () => {
  const { v, ctx, page } = await mount(THREE, 20);
  const realReload = ctx.reload;
  let kept = true;
  ctx.reload = async () => { page.reloads++; if (kept) { kept = false; ctx.rerender(); return; } return realReload(); };
  click(removeBtns(page)[0]);
  await sleep(450);                             // past the double-tap window
  const b = removeBtns(page)[0];                // the page was re-drawn from the SAME model
  assert.ok(b, 'a Remove button is on the re-drawn page');
  click(b);
  await sleep(300);
  assert.deepStrictEqual(exercisesOnDisk(v), ['Dips'], `the second removal never ran (the hold was not released): ${JSON.stringify(exercisesOnDisk(v))}`);
});

check('#1 a line with a count and no Target is shown as "5 sets", never "5 × "', async () => {
  const { page } = await mount('---\nactive: true\n---\n## Push (mon)\n\n- Pull-ups | 5 x\n- Push-ups | 3 x 10\n- Dips | 1 x\n', 0, false);
  const rows = flat(page.root).filter(n => hasClass(n, 'gv-day-item'));
  const rx = rows.map(r => flat(r).filter(n => hasClass(n, 'gv-day-item-rx')).map(n => n.textContent).join(''));
  assert.deepStrictEqual(rx, ['5 sets', '3 × 10', '1 set'], `prescriptions shown: ${JSON.stringify(rx)}`);
});

check('#1 Add exercise with Sets 5 and a blank Target is written so the Sets box shows 5 after the reload', async () => {
  const { v, ctx, page } = await mount(THREE, 5);
  const day = ctx.data.plans[0].model.days[0];
  planParse.addItem(day, { exercise: 'Plank', sets: 5, target: '' });
  await ctx.io.savePlan(ctx.data.plans[0]);
  await ctx.reload();
  const row = flat(page.root).filter(n => hasClass(n, 'gv-edititem')).find(r => /Plank/.test(r.textContent));
  const sets = byTag(row, 'input').find(i => hasClass(i, 'gv-edititem-sets'));
  assert.strictEqual(sets.value, '5', `the Sets box shows "${sets.value}" after a reload (line on disk: ${(v._disk.get(PLAN).match(/- Plank.*/) || [''])[0]})`);
});

check('facet: a stale kit filter does not strand the list once only one kit is left', async () => {
  const mk = (name, kit) => ({
    name, file: { path: `Gym/Plans/${name}.md` }, fm: { active: false },
    model: { intro: [], days: [{ name: 'D', weekday: 'mon', notes: [], parts: [], items: [{ exercise: `ex-${name}`, sets: 3, target: '8' }] }] },
    kit,
  });
  const plans = [mk('Alpha', 'dumbbells'), mk('Beta', 'dumbbells')];
  const ctx = {
    data: { plans, exercises: plans.map(p => ({ name: `ex-${p.name}`, fm: { equipment: p.kit, muscles: ['back'] } })) },
    app: {}, state: { params: {}, plansListUi: { kit: 'kettlebell', focus: '', q: '' } },
    io: {}, nav() {}, rerender() {}, reload() {}, notice() {}, activePlan: () => plans[0], mainPlans: () => plans, backTo: f => f, back() {},
  };
  const root = document.createElement('div');
  pagePlans.render(ctx, root);
  const cards = flat(root).filter(n => hasClass(n, 'gv-plan-card'));
  const chips = flat(root).filter(n => hasClass(n, 'gv-facet'));
  assert.strictEqual(chips.length, 0, 'control: with one kit in use there is no chip row');
  assert.strictEqual(cards.length, 2, `the list shows ${cards.length} plan(s): a kit filter nobody can see or clear is still applied`);
});

check('planRole on the Plans page IS plan-parse\'s planRole (one rule, shared with the export)', () => {
  assert.strictEqual(pagePlans.planRole, planParse.planRole);
});

run('audit-1116 content plans page');
