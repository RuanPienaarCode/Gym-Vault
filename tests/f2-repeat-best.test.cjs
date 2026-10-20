'use strict';
/* FIX WAVE F2, item 6 (audit R2-09): A BEST YOU ALREADY BEAT THIS SESSION IS THE NEW BAR.

   History best 8, set 1 does 10 (a record, "was 8"). Set 2 does 10 again: it
   re-announced "NEW BEST (was 8)" with confetti, and the live "Beat 8" target
   on the set-2 screen was still chasing 8. Both read the history snapshot only.

   THE RULE, in ONE helper (page-session.js figureToBeat) used by the
   announcement (applyCompletion) AND the live target (liveTarget):
       figure to beat = max(history best at the start, the record already set
                            for this exercise+kind in THIS session)
   so the live flag and the announcement cannot disagree (the live-target guard
   "ONE RULE: .is-beaten at the moment Done would record it" still holds).

   The record row keeps one best-of-session against the REAL previous best
   (completion screen: "11 reps, was 8"); only the moment's callout names the bar
   that was actually beaten. */
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

const newCtx = () => ({ view: null, settings: {}, data: { goals: [], exercises: [] } });
const newSess = workoutsAtStart => ({ workoutsAtStart, records: [], goalCount: 0, muted: true, metGoals: new Set() });
const entry = { exercise: 'Pull-ups' };
const hist = [{ rows: [{ exercise: 'Pull-ups', reps: '8' }] }];
const run = (sess, reps) => applyCompletion(newCtx(), { entries: [] }, sess, { reps: '', touched: false }, entry, { reps: String(reps) }, { observed: ['reps'] });

(async () => {
  await check('F2-6a. repeating the same best in a later set announces nothing (was: "NEW BEST (was 8)" again)', () => {
    const sess = newSess(hist);
    const first = run(sess, 10);
    assert.deepStrictEqual(first, ['NEW BEST · 10 reps (was 8)']);
    const second = run(sess, 10);
    assert.deepStrictEqual(second, [], `the repeat re-announced: ${JSON.stringify(second)}`);
    assert.strictEqual(sess.records.length, 1);
    assert.strictEqual(String(sess.records[0].val), '10');
  });

  await check('F2-6b. beating the session\'s own best IS announced, against the bar beaten; the row keeps the real previous best', () => {
    const sess = newSess(hist);
    run(sess, 10);
    const third = run(sess, 11);
    assert.deepStrictEqual(third, ['NEW BEST · 11 reps (was 10)']);
    assert.strictEqual(sess.records.length, 1, 'still one row per exercise+kind');
    assert.strictEqual(String(sess.records[0].val), '11');
    assert.strictEqual(String(sess.records[0].prev), '8', 'the completion screen says "was 8", the real previous best');
  });

  await check('F2-6c. a lower-but-still-above-history set after the best is not a record (9 after 10, history 8)', () => {
    const sess = newSess(hist);
    run(sess, 10);
    assert.deepStrictEqual(run(sess, 9), []);
    assert.strictEqual(String(sess.records[0].val), '10', 'and the row keeps the 10');
  });

  await check('F2-6d. LIVE: after a 14 the next set\'s target reads "Beat 14", and .is-beaten agrees with the announcement', async () => {
    const H = require('./live-session-harness.js');
    H.killProcess();
    const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 3 x 10\n', settings: { soundMode: 'silent', guideRestSeconds: 0 } });   // history best 12
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    const text = sel => H.page(b.ctx).querySelector(sel).textContent;
    const tapN = n => { const z = H.page(b.ctx).querySelector('.gv-session-zone'); for (let i = 0; i < n; i++) { H.tapZone(z); H.advance(1000); } };
    H.advance(6000);
    assert.strictEqual(text('.gv-pb-target-label'), 'Beat 12', 'fixture: set 1 chases the history best');
    tapN(14); H.click(H.byText(H.page(b.ctx), 'Done'));
    H.advance(6000);
    assert.strictEqual(text('.gv-pb-target-label'), 'Beat 14', 'set 2 chases the 14 just set, not the stale 12');
    tapN(13);
    const node = H.page(b.ctx).querySelector('.gv-pb-target');
    assert.strictEqual(node.classList.contains('is-beaten'), false, '13 does not beat 14 (it would have beaten the stale 12)');
    tapN(2);   // 15
    assert.strictEqual(node.classList.contains('is-beaten'), true, '15 beats it');
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(String(b.ctx.state.session.records[0].val), '15', 'and Done records it: one rule');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 repeat best OK (${results.length} cases)`);
  process.exit(0);
})();
