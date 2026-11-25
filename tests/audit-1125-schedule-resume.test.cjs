'use strict';
/* AUDIT 25 NOV 2026, FINDING 24: RESUME GOES BACK TO THE SCREEN YOU LEFT, AND
   EVERY OTHER PAGE SAYS A SESSION IS OPEN.

   Leave a guided session by a tab and "Resume" used to open the list of sets,
   so getting back to the set you were on took three taps; a timed circuit came
   back as that list too. And no page but Today said a session was open.

   Now ctx.resumeDraft() (same name, no argument - Today's card calls it)
   returns to the screen the draft was last open on: the set-by-set screen, the
   timed screen, or the log. After a relaunch the screen is not known (the
   device copy keeps plain data only, draft-store.js), so it falls back to the
   log, as before. A "Session in progress" pill, a real button in the shell,
   shows on every page that is not the session, log or setup page while a draft
   exists, and resumes it.

   Drives the REAL controller and session pages through the live-session
   harness. Synthetic plan only. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.document.visibilityState = 'visible';
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

const pill = ctx => ctx.view.contentEl.querySelector('button.gv-session-pill');
const startGuided = async opts => {
  const b = await H.boot(Object.assign({ settings: { guideRestSeconds: 0 } }, opts));
  const plan = b.ctx.activePlan();
  b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
};
const tab = (ctx, id) => ctx.nav(id, null, { reset: true });

(async () => {
  await check('guided: leave by a tab after one set, Resume returns to the guided screen at the next set', async () => {
    const { ctx } = await startGuided();
    assert.strictEqual(ctx.state.page, 'session', 'fixture: in guided mode');
    H.advance(6000);
    const zone = H.page(ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 10; i++) { H.tapZone(zone); H.advance(800); }
    H.click(H.byText(H.page(ctx), 'Done'));
    tab(ctx, 'plans');
    assert.strictEqual(ctx.state.page, 'plans');
    ctx.resumeDraft();
    assert.strictEqual(ctx.state.page, 'session', `Resume went to "${ctx.state.page}", not the guided screen`);
    assert.ok(ctx.state.session && !ctx.state.session.timed, 'the set-by-set session, not a timed one');
    assert.deepStrictEqual(ctx.state.session.pos, { entryIndex: 0, setIndex: 1 }, 'back on the first set not yet done');
  });

  await check('timed: leave a timed circuit, Resume returns to the timed screen, not interval 1', async () => {
    const { ctx } = await startGuided({ settings: { guideMode: 'timed', guideMinutes: 5, guideTransitions: true, guideRestSeconds: 0 } });
    const draft = ctx.state.logDraft;
    assert.ok(draft && draft.timed, 'fixture: a timed session');
    Object.assign(draft.entries[0].sets[0], { reps: '10', done: true, touched: true });
    tab(ctx, 'history');
    ctx.resumeDraft();
    assert.strictEqual(ctx.state.page, 'session', `Resume went to "${ctx.state.page}", not the timed screen`);
    assert.ok(ctx.state.session && ctx.state.session.timed, 'the timed session');
    assert.ok(ctx.state.session.timed.index > 0, `came back at interval ${ctx.state.session.timed.index}, i.e. restarted`);
    assert.ok(H.page(ctx).querySelector('.gv-timed'), 'the timed screen is drawn');
  });

  await check('log-only: a draft started with Log manually resumes on the log', async () => {
    const b = await H.boot();
    const plan = b.ctx.activePlan();
    b.ctx.startLog(plan, plan.model.days[0]);
    assert.strictEqual(b.ctx.state.page, 'log');
    tab(b.ctx, 'goals');
    b.ctx.resumeDraft();
    assert.strictEqual(b.ctx.state.page, 'log');
  });

  await check('guided, then "review in log", then away: Resume returns to the log (the last screen open)', async () => {
    const { ctx } = await startGuided();
    ctx.nav('log');
    tab(ctx, 'plans');
    ctx.resumeDraft();
    assert.strictEqual(ctx.state.page, 'log');
  });

  await check('a new draft does not inherit the old one\'s screen', async () => {
    const { ctx } = await startGuided();
    tab(ctx, 'plans');
    ctx.state.logDraft = null;
    const plan = ctx.activePlan();
    ctx.startLog(plan, plan.model.days[0]);
    ctx.state.page = 'plans';
    ctx.resumeDraft();
    assert.strictEqual(ctx.state.page, 'log');
  });

  await check('relaunch: the screen is unknown, so Resume falls back to the log', async () => {
    const storage = H.makeStorage();
    const a = await startGuided({ storage });
    H.advance(6000);
    const zone = H.page(a.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 10; i++) { H.tapZone(zone); H.advance(800); }
    H.click(H.byText(H.page(a.ctx), 'Done'));
    tab(a.ctx, 'plans');
    H.killProcess();
    const b = await H.boot({ storage });
    assert.ok(b.ctl.hasDraft(), 'fixture: the draft came back');
    b.ctx.resumeDraft();
    assert.strictEqual(b.ctx.state.page, 'log');
  });

  await check('pill: a real button on other pages while a draft exists, and it resumes', async () => {
    const { ctx } = await startGuided();
    assert.strictEqual(pill(ctx), null, 'no pill on the session page itself');
    tab(ctx, 'plans');
    const b = pill(ctx);
    assert.ok(b, 'the pill shows on Plans');
    assert.strictEqual(b.getAttribute('type'), 'button');
    assert.strictEqual(b.textContent.trim(), 'Session in progress');
    assert.ok(!b.closest('main.gv-page') && !b.closest('nav.gv-nav'), 'in the shell, not in the page or the tab bar');
    H.click(b);
    assert.strictEqual(ctx.state.page, 'session', 'the pill resumes the session');
    assert.strictEqual(pill(ctx), null);
  });

  await check('pill: shown on every non-live page, never on session, log or setup, never without a draft', async () => {
    const b = await H.boot();
    for (const p of ['dashboard', 'plans', 'history', 'goals']) {
      tab(b.ctx, p);
      assert.strictEqual(pill(b.ctx), null, `no draft: no pill on ${p}`);
    }
    const plan = b.ctx.activePlan();
    b.ctx.startLog(plan, plan.model.days[0]);
    assert.strictEqual(pill(b.ctx), null, 'no pill on the log page');
    /* Profile is left out only because the harness io has no photo store; the
       pill is drawn by the shell before any page, so it is the same there. */
    for (const p of ['dashboard', 'exercises', 'plans', 'goals', 'running', 'history', 'export']) {
      tab(b.ctx, p);
      assert.ok(pill(b.ctx), `the pill shows on ${p}`);
    }
    b.ctx.state.logDraft = null;
    b.ctx.rerender();
    assert.strictEqual(pill(b.ctx), null, 'gone once the draft is');
    b.ctx.startGuided(plan, plan.model.days[0]);
    assert.strictEqual(b.ctx.state.page, 'setup');
    assert.strictEqual(pill(b.ctx), null, 'no pill on setup');
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n')[0]}` : ''}`);
  if (failed.length) { console.error(`${failed.length} of ${results.length} resume checks failed`); process.exit(1); }
  console.log(`audit-1125 resume + pill OK (${results.length} checks)`);
})();
