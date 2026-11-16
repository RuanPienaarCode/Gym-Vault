'use strict';
/* AUDIT 16 NOV 2026, LANE SHELL: the router (controller.js).

   #11  every re-draw threw the page back to the top. `pageEl.scrollTop = 0` ran
        after EVERY render, so ticking a set on the last card, starring a plan,
        expanding a History card or toggling a Setup switch lost your place.
        K2: a re-draw of the SAME page keeps the scroll (clamped to the new
        content height); a change of page starts at the top; Back restores where
        the page was left; a nav tab always goes to the top. Focus moves to the
        heading only on a change of page (or a tab tap), never on a same-page
        re-draw. The decision is ONE pure function, scrollDecision.
   #12  Today did not notice that the day had changed. A pure predicate,
        shouldRedrawForNewDay, decides; the controller listens for the view
        becoming visible again and for window focus.
   #6   "Discard and start" ran the new draft's creation BEFORE the old session
        page's cleanup, so the cleanup tied the discarded session's records to
        the NEW draft and the next session paid them out.
   #45  ctx.activePlan filtered out parallel plans only, while mainPlans also
        filters out fallback plans: a fallback-only plan could become the plan
        Today runs. One rule, mainPlansOf.

   Drives the REAL controller through tests/live-session-harness.js. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
/* The controller is required AFTER the first boot: the harness swaps ./data
   for its stub at require time, and a controller loaded before that keeps the
   real vault io for good. */
let controller = null;

/* The harness' fake nodes have a no-op focus(); record who got it. */
const focused = [];
H.N.prototype.focus = function () { focused.push(this.tag); };

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  focused.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const pageNode = ctx => H.page(ctx);
const tab = (ctx, label) => ctx.view.contentEl.querySelectorAll('button').find(b => b.getAttribute('aria-label') === label);
const planOf = (name, fm, days) => {
  const { parsePlanBody } = require('../src/plan-parse');
  return { name, fm, file: { path: `Gym/Plans/${name}.md` }, model: parsePlanBody(days || '## Day A (any)\n\n- Push-ups | 2 x 10\n') };
};

(async () => {
  await H.boot();
  controller = require('../src/controller');
  /* ---------- #11: the decision, pure ---------- */
  await check('11a scrollDecision: a same-page re-draw KEEPS the scroll and does not move focus', () => {
    const d = controller.scrollDecision({ page: 'log', scrollTop: 1480 }, { page: 'log', cause: 'rerender' });
    assert.deepStrictEqual([d.mode, d.top, d.focus], ['keep', 1480, false]);
  });
  await check('11b scrollDecision: a nav to the SAME page with new params keeps the scroll, no focus move', () => {
    const d = controller.scrollDecision({ page: 'history', scrollTop: 1200 }, { page: 'history', cause: 'nav' });
    assert.deepStrictEqual([d.mode, d.top, d.focus], ['keep', 1200, false]);
  });
  await check('11c scrollDecision: a change of page starts at the top and moves focus', () => {
    const d = controller.scrollDecision({ page: 'plans', scrollTop: 900 }, { page: 'exercises', cause: 'nav' });
    assert.deepStrictEqual([d.mode, d.top, d.focus], ['reset', 0, true]);
  });
  await check('11d scrollDecision: Back restores the scroll saved on the stack entry and moves focus', () => {
    const d = controller.scrollDecision({ page: 'exercise', scrollTop: 40 }, { page: 'exercises', cause: 'back', savedTop: 5229 });
    assert.deepStrictEqual([d.mode, d.top, d.focus], ['restore', 5229, true]);
  });
  await check('11e scrollDecision: Back with nothing saved lands at the top', () => {
    const d = controller.scrollDecision({ page: 'exercise', scrollTop: 40 }, { page: 'exercises', cause: 'back' });
    assert.strictEqual(d.top, 0);
  });
  await check('11f scrollDecision: a tab tap goes to the top even on the tab you are already on', () => {
    const same = controller.scrollDecision({ page: 'history', scrollTop: 800 }, { page: 'history', cause: 'tab' });
    assert.deepStrictEqual([same.mode, same.top, same.focus], ['reset', 0, true]);
    const other = controller.scrollDecision({ page: 'history', scrollTop: 800 }, { page: 'plans', cause: 'tab' });
    assert.deepStrictEqual([other.mode, other.top], ['reset', 0]);
  });
  await check('11g scrollDecision: the very first draw (no page drawn yet) starts at the top without stealing focus', () => {
    const d = controller.scrollDecision({ page: null, scrollTop: 0 }, { page: 'dashboard', cause: 'rerender' });
    assert.deepStrictEqual([d.mode, d.top, d.focus], ['reset', 0, false]);
  });
  await check('11h scrollDecision: a re-draw that finds a DIFFERENT page than the one drawn resets', () => {
    const d = controller.scrollDecision({ page: 'plans', scrollTop: 300 }, { page: 'goals', cause: 'rerender' });
    assert.strictEqual(d.mode, 'reset');
  });
  await check('11i clampScroll: bounded by the new content height, never negative, tolerant of unknowns', () => {
    assert.strictEqual(controller.clampScroll(1881, 1000, 600), 400);
    assert.strictEqual(controller.clampScroll(250, 1000, 600), 250);
    assert.strictEqual(controller.clampScroll(-5, 1000, 600), 0);
    assert.strictEqual(controller.clampScroll(NaN, 1000, 600), 0);
    assert.strictEqual(controller.clampScroll(300, 400, 600), 0, 'content shorter than the pane');
    assert.strictEqual(controller.clampScroll(300, undefined, undefined), 300, 'no layout to measure: leave it');
  });

  /* ---------- #11: through the real controller ---------- */
  await check('11j ctx.rerender() on the same page keeps scrollTop', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    pageNode(ctx).scrollTop = 1480;
    ctx.rerender();
    assert.strictEqual(pageNode(ctx).scrollTop, 1480, 'a tick / star / toggle re-draw threw the page back to the top');
  });
  await check('11k ctx.reload() (vault watcher) keeps scrollTop', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    pageNode(ctx).scrollTop = 1200;
    await ctx.reload();
    assert.strictEqual(pageNode(ctx).scrollTop, 1200);
  });
  await check('11l History expand/collapse (a nav to the page you are on) keeps scrollTop', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    pageNode(ctx).scrollTop = 1200;
    ctx.nav('history', { session: '2026-01-01' });
    assert.strictEqual(pageNode(ctx).scrollTop, 1200, 'tapping the 11th session card jumped the list to the top');
    assert.strictEqual(ctx._backStack.length, 0, 'a same-page nav is still not a step');
  });
  await check('11m the kept scroll is clamped to the new content height', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    const p = pageNode(ctx);
    p.scrollTop = 1881; p.scrollHeight = 1000; p.clientHeight = 600;
    ctx.rerender();
    assert.strictEqual(p.scrollTop, 400);
  });
  await check('11n a change of page starts at the top', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    pageNode(ctx).scrollTop = 900;
    ctx.nav('records');
    assert.strictEqual(pageNode(ctx).scrollTop, 0);
  });
  await check('11o Back restores the scroll the page had when you left it', async () => {
    const { ctx } = await H.boot();
    ctx.nav('exercises', null, { reset: true });
    pageNode(ctx).scrollTop = 5229;
    ctx.nav('exercise', { name: 'Push-ups' });
    assert.strictEqual(pageNode(ctx).scrollTop, 0, 'the detail page opens at the top');
    pageNode(ctx).scrollTop = 80;
    ctx.back('exercises');
    assert.strictEqual(ctx.state.page, 'exercises');
    assert.strictEqual(pageNode(ctx).scrollTop, 5229, 'Back dropped you at the top of the library');
  });
  await check('11p a nav tab goes to the top, including the tab you are already on', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    pageNode(ctx).scrollTop = 700;
    H.click(tab(ctx, 'History'));
    assert.strictEqual(pageNode(ctx).scrollTop, 0);
    pageNode(ctx).scrollTop = 700;
    H.click(tab(ctx, 'Plans'));
    assert.strictEqual(pageNode(ctx).scrollTop, 0);
  });
  await check('11q focus moves to the heading on a change of page and on a tab tap, not on a same-page re-draw', async () => {
    const { ctx } = await H.boot();
    ctx.nav('history', null, { reset: true });
    assert.ok(focused.includes('h2'), 'a change of page must still focus the heading');
    focused.length = 0;
    ctx.rerender();
    assert.deepStrictEqual(focused, [], 'a same-page re-draw must not move focus');
    ctx.nav('history', { session: '2026-01-01' });
    assert.deepStrictEqual(focused, [], 'a nav to the page you are on must not move focus');
    await ctx.reload();
    assert.deepStrictEqual(focused, [], 'a reload must not move focus');
    H.click(tab(ctx, 'History'));
    assert.ok(focused.includes('h2'), 'a tab tap is a fresh start and moves focus');
  });
  await check('11r the session screens survive a re-draw at the same scroll (live workout)', async () => {
    const { ctx } = await H.boot();
    const plan = ctx.data.plans[0];
    ctx.startLog(plan, plan.model.days[0]);
    ctx.enterGuided();
    pageNode(ctx).scrollTop = 120;
    ctx.rerender();
    assert.strictEqual(pageNode(ctx).scrollTop, 120);
  });

  /* ---------- #12: the day rolls over ---------- */
  await check('12a shouldRedrawForNewDay: only when the date differs and no live workout is on screen', () => {
    const f = controller.shouldRedrawForNewDay;
    assert.strictEqual(f('2026-11-16', '2026-11-17', 'dashboard'), true);
    assert.strictEqual(f('2026-11-16', '2026-11-17', 'history'), true);
    assert.strictEqual(f('2026-11-16', '2026-11-16', 'dashboard'), false, 'same day');
    for (const live of ['session', 'setup', 'log']) assert.strictEqual(f('2026-11-16', '2026-11-17', live), false, `${live} is a live workout`);
    assert.strictEqual(f(null, '2026-11-17', 'dashboard'), false, 'nothing drawn yet');
    assert.strictEqual(f('2026-11-16', '', 'dashboard'), false, 'no usable date');
  });
  await check('12b a tab left open past midnight re-draws when the view becomes visible again', async () => {
    const RealDate = Date;
    let fakeNow = new RealDate(2026, 10, 16, 23, 58).getTime();
    global.Date = class extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(fakeNow); }
      static now() { return fakeNow; }
    };
    try {
      const { ctx } = await H.boot();
      ctx.nav('dashboard', null, { reset: true });
      const marker = new H.N('i'); pageNode(ctx).append(marker);
      H.document.visibilityState = 'hidden';
      for (const fn of [...(H.docListeners.visibilitychange || [])]) fn();
      assert.ok(marker.parentNode, 'hiding the page must not re-draw it');
      fakeNow += 5 * 60 * 1000; // 00:03 the next day
      H.document.visibilityState = 'visible';
      for (const fn of [...(H.docListeners.visibilitychange || [])]) fn();
      assert.strictEqual(marker.parentNode, null, 'Today kept showing yesterday after the date rolled over');
      /* and on window focus */
      const again = new H.N('i'); pageNode(ctx).append(again);
      fakeNow += 24 * 3600 * 1000;
      for (const fn of [...(H.windowListeners.focus || [])]) fn();
      assert.strictEqual(again.parentNode, null, 'window focus must also notice a new day');
    } finally { global.Date = RealDate; }
  });
  await check('12c a live workout is left alone when the date rolls over', async () => {
    const RealDate = Date;
    let fakeNow = new RealDate(2026, 10, 16, 23, 58).getTime();
    global.Date = class extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(fakeNow); }
      static now() { return fakeNow; }
    };
    try {
      const { ctx } = await H.boot();
      const plan = ctx.data.plans[0];
      ctx.startLog(plan, plan.model.days[0]);
      const marker = new H.N('i'); pageNode(ctx).append(marker);
      fakeNow += 5 * 60 * 1000;
      H.document.visibilityState = 'visible';
      for (const fn of [...(H.docListeners.visibilitychange || [])]) fn();
      for (const fn of [...(H.windowListeners.focus || [])]) fn();
      assert.ok(marker.parentNode, 'the log page was redrawn out from under a live workout');
    } finally { global.Date = RealDate; }
  });
  await check('12d stop() removes the new listeners', async () => {
    const { ctl } = await H.boot();
    assert.strictEqual((H.windowListeners.focus || []).length, 1, 'a window focus listener is registered by start()');
    assert.strictEqual((H.docListeners.visibilitychange || []).length, 1);
    const before = (H.docListeners.visibilitychange || []).length + (H.windowListeners.focus || []).length;
    ctl.stop();
    const after = (H.docListeners.visibilitychange || []).length + (H.windowListeners.focus || []).length;
    assert.ok(after < before, 'visibilitychange/focus listeners leaked past stop()');
    assert.strictEqual((H.windowListeners.focus || []).length, 0);
  });

  /* ---------- #6: a discarded session pays nothing to the next one ---------- */
  await check('6a discardLiveSession runs the leaving page cleanup, then clears session and carry', () => {
    const calls = [];
    const state = {
      logDraft: { id: 'old' },
      session: { records: [{ key: 'x' }] },
      sessionCarry: { draft: { id: 'old' }, records: [{ key: 'x' }] },
      pageCleanup: () => { calls.push('cleanup'); state.sessionCarry = { draft: state.logDraft, records: [{ key: 'x' }] }; state.session = null; },
    };
    controller.discardLiveSession(state);
    assert.deepStrictEqual(calls, ['cleanup']);
    assert.strictEqual(state.pageCleanup, null);
    assert.strictEqual(state.session, null);
    assert.strictEqual(state.sessionCarry, null, 'the cleanup stashed a carry; it must not survive a discard');
  });
  await check('6b "Discard and start" does not hand the discarded session\'s records to the new one', async () => {
    const { ctx } = await H.boot();
    const plan = ctx.data.plans[0];
    const day = plan.model.days[0];
    ctx.startLog(plan, day);
    ctx.enterGuided();
    assert.ok(ctx.state.session, 'guided mode is up');
    ctx.state.session.records.push({ key: 'push-ups|reps', exercise: 'Push-ups', kind: 'reps', val: 30, prev: 12 });
    const oldDraft = ctx.state.logDraft;
    const before = H.modals.length;
    ctx.startLog(plan, day); // asks first
    const ask = H.modals[H.modals.length - 1];
    assert.ok(H.modals.length > before && ask.kind === 'confirm', 'the discard confirmation opens');
    ask.opts.onConfirm();
    assert.notStrictEqual(ctx.state.logDraft, oldDraft, 'a new draft replaced the old');
    assert.strictEqual(ctx.state.sessionCarry, null, 'the old session left a carry tied to the NEW draft');
    ctx.enterGuided();
    assert.strictEqual(ctx.state.session.records.length, 0, 'a record from the thrown-away session is paid out to the next one');
  });

  /* ---------- #45: one rule for "the main plan" ---------- */
  await check('45a mainPlansOf / activePlanOf skip parallel AND fallback plans', () => {
    const fb = planOf('Aaa Rest', { fallback: 'true' });
    const par = planOf('Bbb Run', { parallel: 'true' });
    const main = planOf('Ccc Strength', {});
    assert.deepStrictEqual(controller.mainPlansOf([fb, par, main]), [main]);
    assert.strictEqual(controller.activePlanOf([fb, par, main]), main, 'a fallback that sorts first became the plan Today runs');
    assert.strictEqual(controller.activePlanOf([fb, par]), null);
    const flagged = planOf('Ddd Flagged', { active: 'true' });
    assert.strictEqual(controller.activePlanOf([fb, main, flagged]), flagged, 'the flagged plan still wins');
  });
  await check('45b ctx.activePlan and ctx.activePlanIsImplicit use the same rule as ctx.mainPlans', async () => {
    const { ctx } = await H.boot();
    const fb = planOf('Aaa Rest', { fallback: 'true' });
    const main = planOf('Ccc Strength', {});
    ctx.data.plans = [fb, main];
    assert.strictEqual(ctx.activePlan(), main);
    assert.strictEqual(ctx.activePlanIsImplicit(), true, 'main plan unflagged: implicit');
    assert.deepStrictEqual(ctx.mainPlans(), [main]);
    ctx.data.plans = [fb];
    assert.strictEqual(ctx.activePlan(), null, 'a fallback-only vault has no active plan');
    assert.strictEqual(ctx.activePlanIsImplicit(), false, 'a fallback-only vault is not "implicitly" running a plan');
  });

  let failed = 0;
  for (const [name, e] of results) {
    if (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e && e.message).split('\n')[0]); }
    else console.log('  ok   ' + name);
  }
  if (failed) { console.error(`audit-1116-shell-router: ${failed} failed`); process.exit(1); }
  console.log('audit-1116-shell-router OK');
})();
