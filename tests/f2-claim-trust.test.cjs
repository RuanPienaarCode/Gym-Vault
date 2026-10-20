'use strict';
/* FIX WAVE F2, item 5 (audit L3-05 + L1-03): WHAT MAY CLAIM A RECORD.

   L3-05. applyCompletion ended every completion with `set.touched = true`,
   including a TIMED interval, whose only figure is the clock. So after one
   interval ran, its set read as "typed by the user", and re-running the same
   interval (Previous, in a session picked up again) claimed "NEW BEST 1:00 hold"
   from the clock alone. A clock is not the user's word: it no longer marks a set
   touched. The sets whose figure the screen really watched (the tap counter,
   the stopwatch: opts.observed non-empty) still do, as before.

   L1-03. applyCompletion never asked records.claimableKinds, which every other
   surface does: a kg-unit exercise with a "2 x 40s" line got a live NEW BEST for
   a hold that Records refuses to show. Same gate, same seam.

   The first block drives applyCompletion directly with the exact opts each real
   call site passes; the last drives the real timed screen end to end. */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const motionStub = { motionAvailable: () => false, startMotionCounter: async () => () => {} };
const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === './motion-source') return motionStub;
  return origLoad(req, ...rest);
};
const mkNode = () => ({
  nodeType: 1, className: '', style: { setProperty() {}, removeProperty() {} }, children: [], attrs: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, addEventListener() {}, append() {}, querySelector: () => null,
  insertBefore() {}, remove() {}, removeChild() {},
});
global.document = {
  createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }),
  addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
};
global.window = global.window || { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };
const { applyCompletion } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const ex = (name, unit) => ({ name, fm: { unit } });
const newCtx = exercises => ({ view: null, settings: {}, data: { goals: [], exercises } });
const newSess = workoutsAtStart => ({ workoutsAtStart, records: [], goalCount: 0, muted: true, metGoals: new Set() });
const plankHistory = [{ rows: [{ exercise: 'Plank', seconds: '40' }] }];
const plankEntry = () => ({ exercise: 'Plank', duration: true, target: '60s' });
const freshSet = () => ({ reps: '', weight_kg: '', seconds: '60', done: false, touched: false });

(async () => {
  await check('F2-5a. a timed interval (observed []) does not mark its set touched; it is only done', () => {
    const set = freshSet();
    applyCompletion(newCtx([ex('Plank', 'seconds')]), { entries: [] }, newSess(plankHistory), set, plankEntry(), { seconds: '60' }, { observed: [] });
    assert.strictEqual(set.done, true);
    assert.strictEqual(set.touched, false, 'a clock is not the user\'s word');
  });

  await check('F2-5b. re-running the same timed interval claims NOTHING (was: NEW BEST from the clock alone)', () => {
    const ctx = newCtx([ex('Plank', 'seconds')]);
    const sess = newSess(plankHistory), set = freshSet();
    const first = applyCompletion(ctx, { entries: [] }, sess, set, plankEntry(), { seconds: '60' }, { observed: [] });
    const second = applyCompletion(ctx, { entries: [] }, sess, set, plankEntry(), { seconds: '60' }, { observed: [] });
    assert.deepStrictEqual(first, [], 'first run claims nothing (as before)');
    assert.deepStrictEqual(second, [], `the re-run claimed: ${JSON.stringify(second)}`);
    assert.deepStrictEqual(sess.records, []);
  });

  await check('F2-5c. a seconds figure the user TYPED into the timed box still claims', () => {
    const ctx = newCtx([ex('Plank', 'seconds')]);
    const sess = newSess(plankHistory), set = Object.assign(freshSet(), { seconds: '55', touched: true });
    const out = applyCompletion(ctx, { entries: [] }, sess, set, plankEntry(), { seconds: '55' }, { observed: [] });
    assert.strictEqual(out.length, 1, 'typed is the user\'s own word');
    assert.strictEqual(sess.records.length, 1);
  });

  await check('F2-5d. the stopwatch / tap counter (observed non-empty) still mark the set touched and claim', () => {
    const ctx = newCtx([ex('Plank', 'seconds')]);
    const sess = newSess(plankHistory), set = freshSet();
    const out = applyCompletion(ctx, { entries: [] }, sess, set, plankEntry(), { seconds: '70' }, { observed: ['seconds'] });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(set.touched, true, 'an observed figure is the user\'s own measurement');
  });

  await check('F2-5e. claimableKinds gates the live claim: a kg-unit exercise with a "2 x 40s" line gets no hold record (Records refuses it)', () => {
    const entry = { exercise: 'Farmers Carry', duration: true, target: '40s' };
    const history = [{ rows: [{ exercise: 'Farmers Carry', seconds: '30' }] }];
    const sess = newSess(history), set = freshSet();
    const out = applyCompletion(newCtx([ex('Farmers Carry', 'kg')]), { entries: [] }, sess, set, entry, { seconds: '45' }, { observed: ['seconds'] });
    assert.deepStrictEqual(out, [], `a hold NEW BEST the Records page would never show: ${JSON.stringify(out)}`);
    assert.deepStrictEqual(sess.records, []);
    /* the same hold on an exercise whose unit IS seconds claims, so the gate is not a blanket block */
    const sess2 = newSess(history);
    const out2 = applyCompletion(newCtx([ex('Farmers Carry', 'seconds')]), { entries: [] }, sess2, freshSet(), entry, { seconds: '45' }, { observed: ['seconds'] });
    assert.strictEqual(out2.length, 1);
  });

  await check('F2-5f. a plan line with NO exercise note has no unit to gate on: it claims what it observed, as before', () => {
    const sess = newSess(plankHistory);
    const out = applyCompletion(newCtx([]), { entries: [] }, sess, freshSet(), plankEntry(), { seconds: '70' }, { observed: ['seconds'] });
    assert.strictEqual(out.length, 1);
  });

  /* ---- the real timed screen, end to end ---- */
  await check('F2-5g. REAL timed screen: a plank interval re-run after leaving and coming back claims no NEW BEST', async () => {
    const H = require('./live-session-harness.js');
    H.killProcess();
    const b = await H.boot({
      planBody: '## D (any)\n\n- Plank | 2 x 60s\n',
      workouts: [H.workout('2026-01-01', [{ exercise: 'Plank', set: 1, reps: '', weight_kg: '', seconds: '30', note: '', distance_km: '' }])],
      settings: { soundMode: 'silent', guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true },
    });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    const tp = () => b.ctx.state.session.timed;
    const ivs = b.ctx.state.logDraft.timed.intervals;
    const firstWork = ivs.findIndex(i => i.kind === 'work');
    let guard = 0;
    while (guard++ < 5000 && !b.ctx.state.logDraft.entries[0].sets[0].done) H.advance(200);
    assert.ok(b.ctx.state.logDraft.entries[0].sets[0].done, 'fixture: the first plank interval ran by the clock');
    assert.strictEqual(b.ctx.state.logDraft.entries[0].sets[0].touched, false, 'and the clock did not make it the user\'s');
    b.ctx.nav('dashboard'); b.ctx.enterGuided();                       // leave and come back: tp.completed is gone
    guard = 0;
    while (guard++ < 20 && tp().index > firstWork) H.click(H.byLabel(H.page(b.ctx), 'Previous interval'));
    assert.strictEqual(tp().index, firstWork, 'fixture: stepped back onto the first plank interval');
    guard = 0;
    while (guard++ < 5000 && tp().index === firstWork) H.advance(200);   // let it run to the end again
    assert.deepStrictEqual(b.ctx.state.session.records, [], `re-running the interval claimed: ${JSON.stringify(b.ctx.state.session.records)}`);
    assert.strictEqual((b.ctx.state.session.pendingCallouts || []).length, 0, 'and showed no NEW BEST callout');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 claim trust OK (${results.length} cases)`);
  process.exit(0);
})();
