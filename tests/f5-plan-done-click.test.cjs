'use strict';
/* Plan edit mode: the first click on "Done" after editing a line was swallowed.

   The row's `focusout` waits for the save and then reloads (re-renders) the page.
   Pressing Done moves focus out of the field on mousedown, so the re-render
   replaced the Done button between mousedown and mouseup and the browser never
   delivered the click: `plansUi.editing` stayed true and the user had to tap
   twice. A reload must therefore wait until a press that is in progress has
   finished, and still happen (and still save) afterwards.

   Drives the REAL page-plans render() and io over the fake vault; the document
   gets the pointer events a browser sends. */
const assert = require('node:assert');
const { makeDocument, fire, byTag, hasClass, flat } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner, notices, sleep } = require('./gym-fake-vault');

const doc = makeDocument();
doc.listeners = {};
doc.addEventListener = (ev, fn) => { (doc.listeners[ev] ||= []).push(fn); };
const docFire = ev => (doc.listeners[ev] || []).forEach(fn => fn({}));
global.document = doc;
const { makeIo } = loadSrc('data.js');
const pagePlans = loadSrc('page-plans.js');

const PLAN = 'Gym/Plans/Test Plan.md';
const PLAN_TEXT = '---\nactive: true\n---\n## Push (mon)\n\n- Push-ups | 3 x 10\n- Dips | 3 x 8\n';

async function mount() {
  const v = makeVault([
    ['Gym/Profile.md', '---\nname: T\n---\n'],
    ['Gym/Exercises/Push-ups.md', '---\nunit: reps\n---\n'],
    ['Gym/Exercises/Dips.md', '---\nunit: reps\n---\n'],
    [PLAN, PLAN_TEXT],
  ], { delay: 5 });
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
const doneBtn = page => byTag(page.root, 'button').find(b => b.attrs['aria-pressed'] === 'true');
const elsewhere = { tag: 'button', contains: () => false };
const { check, run } = makeRunner();

check('F5 Done: the page is not re-rendered under a press that is still in progress', async () => {
  const { v, ctx, page } = await mount();
  const r0 = rows(page)[0];
  const done = doneBtn(page);
  setsOf(r0).value = '5'; fire(setsOf(r0), 'change');       // edit a field
  docFire('pointerdown');                                    // press on Done: mousedown ...
  fire(r0, 'focusout', { relatedTarget: elsewhere });        // ... moves focus out of the field
  await sleep(80);                                           // the save lands
  assert.strictEqual(page.reloads, 0,
    `the page was re-rendered ${page.reloads} time(s) while the pointer was still down, so the Done button the user pressed was thrown away and the click is lost`);
  assert.strictEqual(doneBtn(page), done, 'the Done button under the finger was replaced');
  /* ... the press ends, the click reaches the same button */
  docFire('pointerup');
  fire(done, 'click');
  assert.strictEqual(ctx.state.plansUi.editing, false, 'one click on Done must leave edit mode');
  await sleep(150);
  assert.ok(page.reloads >= 1, 'the deferred refresh must still happen once the press is over');
  assert.ok(/Push-ups \| 5 x 10/.test(v._disk.get(PLAN)), 'the edit made before pressing Done must be saved');
});

check('F5 Done: with no press in progress the reload still happens at once (keyboard tabbing)', async () => {
  const { page } = await mount();
  const r0 = rows(page)[0];
  setsOf(r0).value = '4'; fire(setsOf(r0), 'change');
  fire(r0, 'focusout', { relatedTarget: elsewhere });
  await sleep(80);
  assert.strictEqual(page.reloads, 1, 'leaving the row by keyboard must reload as before');
});

check('F5 Done: a press that never ends (lost pointerup) cannot hold the reload forever', async () => {
  const { page } = await mount();
  const r0 = rows(page)[0];
  setsOf(r0).value = '4'; fire(setsOf(r0), 'change');
  docFire('pointerdown');
  fire(r0, 'focusout', { relatedTarget: elsewhere });
  await sleep(1800);
  assert.ok(page.reloads >= 1, 'the reload never happened after a lost pointerup');
});

run('F5 plan Done click');
