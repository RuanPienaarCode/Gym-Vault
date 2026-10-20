'use strict';
/* WAVE 2, item 3 (audit R2-12): SKIPS ARE REMEMBERED FOR THE LIFE OF THE DRAFT.

   Leaving guided and coming back rebuilt the session at flow.initialPosition,
   which only treats a set as handled when it is ticked or typed into. A skip
   deliberately leaves the set untouched, so every skip was forgotten and you
   landed on exercise 1 set 1 again.

   Now a skip is marked on the set itself (set.skipped, plain data that travels
   with the set if the log page adds or removes others), and a fresh session
   lands on the first set that is neither done/typed nor skipped. The mark does
   NOT make the set count as logged: buildRows / stats.setCounts never read it,
   so what a saved workout note reads as is unchanged.

   Drives the REAL controller and the REAL guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const flow = require('../src/session-flow.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};
const PLAN = '## D (any)\n\n- Push-ups | 3 x 10\n- Squat | 2 x 10\n';
const EXS = [H.ex('Push-ups'), H.ex('Squat')];
async function start(planBody, settings) {
  const b = await H.boot({ planBody: planBody || PLAN, exercises: EXS, settings: Object.assign({ soundMode: 'silent', guideRestSeconds: 0 }, settings || {}) });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const pos = b => b.ctx.state.session.pos;
const skipSet = b => H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
const skipEx = b => H.click(H.byLabel(H.page(b.ctx), 'Skip this exercise'));
const leaveAndReturn = b => { b.ctx.nav('dashboard'); H.advance(5000); b.ctx.enterGuided(); };

(async () => {
  await check('W2-3a. two skipped sets are not offered again on re-entry', async () => {
    const b = await start();
    skipSet(b); skipSet(b);
    assert.deepStrictEqual(pos(b), { entryIndex: 0, setIndex: 2 }, 'fixture: on set 3 after two skips');
    leaveAndReturn(b);
    assert.deepStrictEqual(pos(b), { entryIndex: 0, setIndex: 2 }, `re-entered at ${JSON.stringify(pos(b))}, not where the skips left off`);
  });

  await check('W2-3b. a skipped exercise stays skipped on re-entry', async () => {
    const b = await start();
    skipEx(b);
    assert.deepStrictEqual(pos(b), { entryIndex: 1, setIndex: 0 }, 'fixture: on exercise 2');
    leaveAndReturn(b);
    assert.deepStrictEqual(pos(b), { entryIndex: 1, setIndex: 0 }, `re-entered at ${JSON.stringify(pos(b))}`);
  });

  await check('W2-3c. the skip is NOT a logged set: untouched, unticked, and absent from the saved rows', async () => {
    const b = await start();
    skipSet(b);
    const set0 = b.ctx.state.logDraft.entries[0].sets[0];
    assert.strictEqual(set0.done, false); assert.strictEqual(set0.touched, false);
    const { buildRows } = require('../src/page-log');
    assert.strictEqual(buildRows(b.ctx.state.logDraft).length, 0, 'a skipped, untouched set must not be saved');
  });

  await check('W2-3d. control: with nothing skipped, re-entry still lands on the first unhandled set', async () => {
    const b = await start();
    leaveAndReturn(b);
    assert.deepStrictEqual(pos(b), { entryIndex: 0, setIndex: 0 });
  });

  await check('W2-3e. a skipped set that is then ticked on the overview counts as done (done beats skipped)', async () => {
    const b = await start();
    skipSet(b);
    const set0 = b.ctx.state.logDraft.entries[0].sets[0];
    set0.done = true; set0.touched = true;
    assert.strictEqual(flow.isHandled(set0), true);
    leaveAndReturn(b);
    assert.deepStrictEqual(pos(b), { entryIndex: 0, setIndex: 1 });
  });

  await check('W2-3f. a skipped circuit interval is not offered again on re-entry', async () => {
    const b = await start(undefined, { guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true });
    const ivs = () => b.ctx.state.logDraft.timed.intervals;
    const tp = () => b.ctx.state.session.timed;
    /* skip forward until the first work interval has been skipped */
    let guard = 0;
    const first = ivs().findIndex(i => i.kind === 'work');
    while (tp().index <= first && guard++ < 20) H.click(H.byLabel(H.page(b.ctx), tp().index === first ? 'Skip this interval' : 'Skip ahead'));
    assert.ok(tp().index > first, 'fixture: moved past the first work interval');
    const f = ivs()[first];
    leaveAndReturn(b);
    const at = ivs()[tp().index];
    const landedOnSkipped = at.kind === 'work' && at.entryIndex === f.entryIndex && at.setIndex === f.setIndex;
    assert.ok(!landedOnSkipped && tp().index > first, `re-entered on interval ${tp().index}, the one that was skipped`);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`w2 skip memory OK (${results.length} cases)`);
  process.exit(0);
})();
