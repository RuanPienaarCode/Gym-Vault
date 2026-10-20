'use strict';
/* FIX WAVE F2, item 3 (audit R2-05): GUIDED WEIGHT CARRIES FROM SET TO SET.

   Set 2 of "Goblet Squat 3 x 8 @ 20kg" typed 22 kg; set 3 opened on 20 again and
   saved 20, so the log said 20 for a set that was lifted at 22. weightedBody
   only ever prefilled from the plan or from HISTORY, never from the set the user
   had just done.

   THE RULE: a set the user has not touched opens on the weight of the nearest
   earlier set in THIS session that was done (or typed) with one; with nothing
   earlier, the plan or history as before. The carried figure stays a PREFILL
   (set.touched false): it is saved, but it can never claim a weight record,
   because nobody typed it on this set (applyCompletion's trust rule).

   Drives the REAL controller and the REAL guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  H.notices.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const GOBLET = '## D (any)\n\n- Goblet Squat | 3 x 8 @ 20kg\n';
const BARE = '## D (any)\n\n- Goblet Squat | 3 x 8\n';
const row = (w, reps) => ({ exercise: 'Goblet Squat', set: 1, reps: reps || '8', weight_kg: w, seconds: '', note: '', distance_km: '' });

async function start(planBody, workouts) {
  const b = await H.boot({
    planBody, workouts,
    settings: { soundMode: 'silent', guideRestSeconds: 0 },
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const weightBox = b => H.page(b.ctx).querySelector('.gv-session-weight');
const typeWeight = (b, v) => { const i = weightBox(b); i.value = v; H.fire(i, 'input'); };
/* count in, eight reps, tick the set */
function doSet(b) {
  H.advance(6000);
  const z = H.page(b.ctx).querySelector('.gv-session-zone');
  for (let i = 0; i < 8; i++) { H.tapZone(z); H.advance(1000); }
  H.click(H.byText(H.page(b.ctx), 'Done'));
}
const sets = b => b.ctx.state.logDraft.entries[0].sets;
const bests = () => H.notices.filter(n => /NEW BEST/.test(n));

(async () => {
  await check('F2-3a. set 2 typed 22 kg: set 3 opens on 22 and saves 22 (not the plan\'s 20 again)', async () => {
    const b = await start(GOBLET);
    assert.strictEqual(weightBox(b).value, '20', 'fixture: set 1 opens on the plan\'s 20');
    doSet(b);
    assert.strictEqual(weightBox(b).value, '20', 'set 2 opens on 20 (set 1 was done at 20)');
    typeWeight(b, '22');
    doSet(b);
    assert.strictEqual(sets(b)[1].weight_kg, '22', 'fixture: set 2 saved 22');
    assert.strictEqual(weightBox(b).value, '22', 'set 3 opens on what set 2 was lifted at');
    assert.strictEqual(sets(b)[2].weight_kg, '22');
    doSet(b);
    assert.strictEqual(sets(b)[2].weight_kg, '22', 'and set 3 saves 22');
    assert.strictEqual(sets(b)[2].done, true);
  });

  await check('F2-3b. the carried figure is a PREFILL: untouched until the user types, so it never claims a record by itself', async () => {
    const hist = [H.workout('2026-01-01', [row('20', '8')])];
    const b = await start(GOBLET, hist);
    doSet(b);
    typeWeight(b, '22');
    doSet(b);
    assert.strictEqual(bests().length, 1, 'fixture: the 22 the user TYPED beat the 20 and claimed once');
    assert.strictEqual(sets(b)[2].weight_kg, '22', 'fixture: carried onto set 3');
    assert.strictEqual(sets(b)[2].touched, false, 'but it is not the user\'s word on set 3');
    doSet(b);
    assert.strictEqual(bests().length, 1, 'carrying the 22 forward did not claim a second NEW BEST');
  });

  await check('F2-3c. a weight the user typed on a later set is never overwritten by the carry (even across a re-render)', async () => {
    const b = await start(GOBLET);
    doSet(b); typeWeight(b, '22'); doSet(b);
    typeWeight(b, '25');
    assert.strictEqual(sets(b)[2].weight_kg, '25');
    b.ctx.rerender();
    assert.strictEqual(weightBox(b).value, '25', 'the re-render keeps the typed 25, not the carried 22');
    doSet(b);
    assert.strictEqual(sets(b)[2].weight_kg, '25');
  });

  await check('F2-3d. with no earlier set this session, history still fills a blank weight (as before)', async () => {
    const b = await start(BARE, [H.workout('2026-01-01', [row('17.5')])]);
    assert.strictEqual(weightBox(b).value, '17.5');
    doSet(b);
    assert.strictEqual(weightBox(b).value, '17.5', 'and the carried figure agrees');
  });

  await check('F2-3e. the carry follows what the LOG holds (stats.setCounts): an untouched, unticked set carries nothing', async () => {
    const b = await start(BARE, [H.workout('2026-01-01', [row('17.5')])]);
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));          // set 1 skipped, never ticked or typed
    assert.strictEqual(sets(b)[0].done, false);
    typeWeight(b, '30');                                          // set 2: typed 30, then skipped
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
    assert.strictEqual(sets(b)[1].touched, true);
    assert.strictEqual(weightBox(b).value, '30', 'set 3 opens on the 30 the log is about to save for set 2');
    assert.strictEqual(sets(b)[0].weight_kg, '17.5', 'fixture: skipped set 1 still holds only its history prefill');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 weight carry OK (${results.length} cases)`);
})();
