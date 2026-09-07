'use strict';
/* Guards for the five journey-audit findings on plan detail
   (commit 8469070, src/page-plans.js):

     1. HIGH   "Make active" must never appear on a parallel/fallback plan,
               and setActivePlan must only ever be handed ctx.mainPlans().
     2. MEDIUM the Remove-x on every exercise line in READ mode is gone —
               removing a line now requires entering edit mode first.
     3. MEDIUM a Target box typed as "N x …" peels N into Sets instead of
               embedding a second multiplier.
     4. LOW    edit mode is keyed to the plan it was switched on for.
     5. LOW    a Sets/Target `change` no longer forces a full-page reload
               while focus is still inside the row.

   These drive the REAL render() from src/page-plans.js — not a
   reimplementation — through a minimal DOM + obsidian stub (see
   plans-dom-stub.js). Each guard is run against the ACTUAL pre-fix source
   at commit 8469070 (loaded from a scratch copy, never written into src/)
   as well as the current source, so a regression that resurrects the old
   behaviour fails this file by name. */
const assert = require('node:assert');
const vm = require('node:vm');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { makeDocument, fire, flat, byTag, hasClass, obsidianStub } = require('./plans-dom-stub');

const SRC_DIR = path.join(__dirname, '..', 'src');
const REPO_ROOT = path.join(__dirname, '..');

global.document = makeDocument();

/* Hijack Module._load just long enough to pull in the CURRENT module tree
   (dom.js, modals.js, equipment.js, constants.js, plan-parse.js, dates.js …)
   with 'obsidian' stubbed. Everything is then cached by Node under its real
   src/ path, so loading the OLD scratch copy afterwards needs no hijack of
   its own — its relative requires resolve to the very same cached modules. */
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? obsidianStub : origLoad(req, ...rest));
const CURRENT = require('../src/page-plans');
Module._load = origLoad;

/* Evaluate a page-plans.js SOURCE STRING as if it lived at src/page-plans.js,
   without ever writing it there. Its own relative requires are rewritten to
   the real, already-cached src/ modules. */
function loadFromSource(code, fakePath) {
  const wrapped = `(function (module, exports, require, __dirname, __filename) {\n${code}\n});`;
  const compiled = vm.runInThisContext(wrapped, { filename: fakePath });
  const mod = { exports: {} };
  const localRequire = id => (id.startsWith('.') ? require(path.join(SRC_DIR, id)) : require(id));
  compiled(mod, mod.exports, localRequire, SRC_DIR, fakePath);
  return mod.exports;
}

/* The pre-fix source at commit 8469070 (the commit the audit's line numbers
   cite), fetched straight from git history — never written into src/, so it
   can never be mistaken for a real module or picked up by the build. This
   is what lets the OLD-behaviour assertions below run for anyone who checks
   this branch out, not just in the session that wrote them. */
let OLD = null;
try {
  const code = execFileSync('git', ['show', '8469070:src/page-plans.js'], { cwd: REPO_ROOT, encoding: 'utf8' });
  OLD = loadFromSource(code, path.join(SRC_DIR, 'page-plans.js'));
} catch (e) {
  console.log(`  (skipping OLD-behaviour mutation checks: commit 8469070 not reachable here — ${e.message})`);
}

const flushAsync = () => new Promise(res => setImmediate(res));

/* ---- fixtures ---------------------------------------------------------- */

function makePlan(name, fmExtra, days) {
  return { name, file: { path: `Gym/Plans/${name}.md` }, fm: { active: false, ...fmExtra }, model: { intro: [], days: days || [] } };
}
function makeDay(name, weekday, items) {
  return { name, weekday, notes: [], items, parts: items.map(item => ({ kind: 'item', item })) };
}
function makeCtx(plans, opts = {}) {
  const calls = { setActivePlan: [], savePlan: [], reload: 0 };
  const ctx = {
    data: { plans, exercises: [] },
    app: {},
    state: { params: { plan: opts.openPlan }, plansUi: opts.plansUi },
    io: {
      setActivePlan: async (list, target) => { calls.setActivePlan.push({ list, target }); },
      savePlan: async p => { calls.savePlan.push(p); },
      trash: async () => {},
    },
    nav: () => {}, rerender: () => {}, reload: () => { calls.reload++; },
    notice: () => {}, openFile: () => {}, startGuided: () => {},
    mainPlans: () => plans.filter(p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true'),
    backTo: fallback => fallback, back: () => {},
  };
  return { ctx, calls };
}
function renderRoot(renderFn, ctx) {
  const root = global.document.createElement('div');
  renderFn(ctx, root);
  return root;
}

/* ============================================================================
   GUARD 1 — "Make active" scope (HIGH)
   ============================================================================ */
{
  const check = (render, label) => {
    const strength = makePlan('Strength', {}, [makeDay('Push', 'mon', [{ exercise: 'Push-ups', sets: 3, target: '10' }])]);
    const rest = makePlan('Rest & Recovery', { fallback: true }, [makeDay('Rest', 'any', [])]);
    const running = makePlan('Running', { parallel: true }, [makeDay('Easy Run', 'tue', [])]);
    const plans = [strength, rest, running];

    // A real switch target: the button must exist, and clicking it must
    // hand setActivePlan ctx.mainPlans() — never the raw plan list.
    {
      const { ctx, calls } = makeCtx(plans, { openPlan: 'Strength' });
      const root = renderRoot(render, ctx);
      const btn = byTag(root, 'button').find(b => b.textContent.includes('Make active'));
      assert.ok(btn, `${label}: a main, inactive plan must offer "Make active"`);
      fire(btn, 'click');
      return { calls, ctx, plans, label };
    }
  };

  const assertScoped = ({ calls, plans, label }) => {
    assert.strictEqual(calls.setActivePlan.length, 1, `${label}: clicking Make active must call setActivePlan exactly once`);
    const { list, target } = calls.setActivePlan[0];
    assert.strictEqual(target.name, 'Strength');
    assert.deepStrictEqual(list.map(p => p.name), ['Strength'],
      `${label}: setActivePlan must be handed ctx.mainPlans() (parallel/fallback excluded), not the raw plan list — got ${JSON.stringify(list.map(p => p.name))}`);
  };

  // NEW: passes.
  assertScoped(check(CURRENT.render, 'NEW'));

  // NEW: neither the fallback nor the parallel plan offers the button, and
  // each explains what it does instead.
  {
    const rest = makePlan('Rest & Recovery', { fallback: true }, [makeDay('Rest', 'any', [])]);
    const running = makePlan('Running', { parallel: true }, [makeDay('Easy Run', 'tue', [])]);
    const strength = makePlan('Strength', {}, []);
    const plans = [strength, rest, running];

    const { ctx: restCtx } = makeCtx(plans, { openPlan: 'Rest & Recovery' });
    const restRoot = renderRoot(CURRENT.render, restCtx);
    assert.ok(!byTag(restRoot, 'button').some(b => b.textContent.includes('Make active')),
      'NEW: a fallback plan must not offer "Make active"');
    assert.ok(flat(restRoot).some(n => n.tag === 'span' && n.textContent === 'Fills empty days'),
      'NEW: a fallback plan must say what it actually does instead');

    const { ctx: runCtx } = makeCtx(plans, { openPlan: 'Running' });
    const runRoot = renderRoot(CURRENT.render, runCtx);
    assert.ok(!byTag(runRoot, 'button').some(b => b.textContent.includes('Make active')),
      'NEW: a parallel plan must not offer "Make active"');
    assert.ok(flat(runRoot).some(n => n.tag === 'span' && n.textContent === 'Runs alongside the active plan'),
      'NEW: a parallel plan must say what it actually does instead');
  }

  // OLD (mutation proof): the same clicks reproduce BOTH halves of the bug.
  if (OLD) {
    // 1a. the button shows on every non-active plan, including fallback/parallel.
    const rest = makePlan('Rest & Recovery', { fallback: true }, [makeDay('Rest', 'any', [])]);
    const plans = [makePlan('Strength', {}, []), rest, makePlan('Running', { parallel: true }, [])];
    const { ctx } = makeCtx(plans, { openPlan: 'Rest & Recovery' });
    const root = renderRoot(OLD.render, ctx);
    assert.ok(byTag(root, 'button').some(b => b.textContent.includes('Make active')),
      'OLD (expected failure surfaced): a fallback plan offered "Make active" in the pre-fix source — this is finding #1');

    // 1b. clicking it hands setActivePlan the WHOLE plan list, not mainPlans().
    let threw = false;
    try { assertScoped(check(OLD.render, 'OLD')); } catch (e) { threw = true; }
    assert.ok(threw, 'OLD (expected failure surfaced): setActivePlan must have been called with the raw plan list, not ctx.mainPlans() — the fix could not be proven against unchanged old code otherwise');
  }
  console.log('guard 1 OK (Make active is scoped to real switch targets, and only ever hands setActivePlan ctx.mainPlans())');
}

/* ============================================================================
   GUARD 2 — no Remove-x outside edit mode (MEDIUM)
   ============================================================================ */
{
  const plan = makePlan('Strength', {}, [makeDay('Push', 'mon', [{ exercise: 'Push-ups', sets: 3, target: '10' }])]);

  const removeButtons = (render, editing) => {
    const { ctx } = makeCtx([plan], { openPlan: 'Strength', plansUi: editing ? { plan: 'Strength', editing: true } : undefined });
    const root = renderRoot(render, ctx);
    return byTag(root, 'button').filter(b => (b.attrs['aria-label'] || '') === 'Remove');
  };

  assert.strictEqual(removeButtons(CURRENT.render, false).length, 0,
    'NEW: read mode must carry no Remove-x on an exercise line');
  assert.strictEqual(removeButtons(CURRENT.render, true).length, 1,
    'NEW: edit mode must still carry exactly one Remove-x per line');

  if (OLD) {
    assert.strictEqual(removeButtons(OLD.render, false).length, 1,
      'OLD (expected failure surfaced): read mode carried a Remove-x with no confirm and no undo — this is finding #2');
  }
  console.log('guard 2 OK (Remove-x only exists once you have deliberately entered edit mode)');
}

/* ============================================================================
   GUARD 3 — the Target box peels a leading "N x" into Sets (MEDIUM)
   ============================================================================ */
{
  const { serializePlanBody } = require('../src/plan-parse');

  const typeIntoTarget = (render, initialSets, typed) => {
    const day = makeDay('Push', 'mon', [{ exercise: 'Push-ups', sets: initialSets, target: '10' }]);
    const plan = makePlan('Strength', {}, [day]);
    const { ctx } = makeCtx([plan], { openPlan: 'Strength', plansUi: { plan: 'Strength', editing: true } });
    const root = renderRoot(render, ctx);
    const targetInput = byTag(root, 'input').find(i => hasClass(i, 'gv-edititem-target'));
    targetInput.value = typed;
    fire(targetInput, 'change');
    return serializePlanBody(plan.model);
  };

  // Sets already 3; typing the full "3 x 10" back into Target must not embed
  // a second multiplier.
  assert.ok(typeIntoTarget(CURRENT.render, 3, '3 x 10').includes('- Push-ups | 3 x 10'),
    'NEW: retyping "3 x 10" into Target with Sets already 3 must write a single "3 x 10", not a doubled one');
  assert.ok(!typeIntoTarget(CURRENT.render, 3, '3 x 10').includes('3 x 3 x 10'),
    'NEW: must never stack the typed count on top of the existing Sets count');

  // Blank Sets; typing "5 x 10" must land the 5 in Sets, not stay embedded.
  assert.ok(typeIntoTarget(CURRENT.render, null, '5 x 10').includes('- Push-ups | 5 x 10'),
    'NEW: "5 x 10" typed with blank Sets must still resolve to sets:5 target:10');

  if (OLD) {
    const bad = typeIntoTarget(OLD.render, 3, '3 x 10');
    assert.ok(bad.includes('3 x 3 x 10'),
      `OLD (expected failure surfaced): retyping "3 x 10" over an existing Sets of 3 embedded a second multiplier — this is finding #3. Got: ${bad}`);
  }
  console.log('guard 3 OK (a leading "N x" typed into Target is peeled into Sets, matching the parser exactly)');
}

/* ============================================================================
   GUARD 4 — edit mode is keyed to the plan it was switched on for (LOW)
   ============================================================================ */
{
  const strength = makePlan('Strength', {}, [makeDay('Push', 'mon', [{ exercise: 'Push-ups', sets: 3, target: '10' }])]);
  const running = makePlan('Running', {}, [makeDay('Easy Run', 'tue', [{ exercise: 'Easy Run', sets: 1, target: '30 min' }])]);

  const editingSurvivesSwitch = render => {
    const state = { params: { plan: 'Strength' }, plansUi: { plan: 'Strength', editing: true } };
    const { ctx } = makeCtx([strength, running]);
    ctx.state = state;
    renderRoot(render, ctx); // plan A, already in edit mode

    ctx.state = { ...state, params: { plan: 'Running' } }; // switch to plan B without touching plansUi
    const root = renderRoot(render, ctx);
    return byTag(root, 'div').some(d => hasClass(d, 'gv-edititem'));
  };

  assert.strictEqual(editingSurvivesSwitch(CURRENT.render), false,
    'NEW: opening a different plan must not inherit edit mode from the last one');

  if (OLD) {
    assert.strictEqual(editingSurvivesSwitch(OLD.render), true,
      'OLD (expected failure surfaced): edit mode was a bare bool with no plan key, so it survived a plan switch — this is finding #4');
  }
  console.log('guard 4 OK (edit mode is keyed to the plan, and does not leak into the next one you open)');
}

/* ============================================================================
   GUARD 5 — a Sets/Target change no longer reloads while focus is still in
   the row (LOW), and the write still happens either way
   ============================================================================ */
{
  async function tabWithinRow(render) {
    const day = makeDay('Push', 'mon', [{ exercise: 'Push-ups', sets: 3, target: '10' }]);
    const plan = makePlan('Strength', {}, [day]);
    const { ctx, calls } = makeCtx([plan], { openPlan: 'Strength', plansUi: { plan: 'Strength', editing: true } });
    const root = renderRoot(render, ctx);
    const editRow = byTag(root, 'div').find(d => hasClass(d, 'gv-edititem'));
    const setsInput = byTag(root, 'input').find(i => hasClass(i, 'gv-edititem-sets'));
    const targetInput = byTag(root, 'input').find(i => hasClass(i, 'gv-edititem-target'));

    /* The stub does not implement DOM bubbling, so `focusout` is fired
       directly on the ROW — exactly where the real listener lives, which is
       what a real browser's bubble phase would deliver regardless of which
       child actually lost focus. */
    setsInput.value = '4';
    fire(setsInput, 'change');           // blur fires `change` on every field it leaves
    if (editRow) fire(editRow, 'focusout', { relatedTarget: targetInput }); // …landing INSIDE the same row
    await flushAsync();
    const reloadsWhileStillInRow = calls.reload;

    if (editRow) fire(editRow, 'focusout', { relatedTarget: null }); // now genuinely leaving the row
    await flushAsync();
    return { reloadsWhileStillInRow, reloadsAfterLeaving: calls.reload, wrote: calls.savePlan.length > 0 };
  }

  (async () => {
    const now = await tabWithinRow(CURRENT.render);
    assert.strictEqual(now.reloadsWhileStillInRow, 0,
      'NEW: tabbing from Sets to Target within the same row must not trigger a reload yet');
    assert.ok(now.wrote, 'NEW: the value must still be persisted even though the reload is deferred');
    assert.strictEqual(now.reloadsAfterLeaving, 1,
      'NEW: leaving the row for good must still trigger exactly one reload');

    if (OLD) {
      const old = await tabWithinRow(OLD.render);
      assert.ok(old.reloadsWhileStillInRow >= 1,
        'OLD (expected failure surfaced): a change on Sets reloaded the whole page immediately, mid-tab into Target — this is finding #5');
    }
    console.log('guard 5 OK (the reload waits for focus to actually leave the row; the write does not)');
    console.log('plans journey-audit guards OK (findings #1-#5)');
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
