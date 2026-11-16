'use strict';
/* AUDIT 16 NOV 2026, finding #2 (High): A SKIPPED SET WAS SAVED IF ITS WEIGHT WAS
   CHANGED FIRST.

   A weight write sets `touched` on the set, and `touched` plus any figure is what
   stats.setCounts calls "worth saving". Skip left a touched set exactly as it was,
   so `Bench Press | 3 x 8 @ 60kg` with the weight nudged to 62.5 on set 3 and then
   Skip saved a third set `8 x 62.5`, and the tile said "3 sets done". The same
   happened on X -> Bank it / Back to the log with 0 reps on the counter.

   The rule lives in session-flow.markSkipped: Skip puts the set back to a plan
   prefill (touched false), so stats.setCounts, buildRows, flow.progress and the
   complete tile all stop counting it without any of them learning a new rule. A
   figure typed AFTER the skip (on the log) wins again.

   Drives the REAL controller and the REAL guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const flow = require('../src/session-flow.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.speech.length = 0; H.notices.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const PLAN = '## D (any)\n\n- Bench Press | 3 x 8 @ 60kg\n';
async function start() {
  const b = await H.boot({ planBody: PLAN, exercises: [H.ex('Bench Press', { unit: 'kg' })], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
function doSet(b) {
  H.advance(6000);
  const z = H.page(b.ctx).querySelector('.gv-session-zone');
  for (let i = 0; i < 8; i++) { H.tapZone(z); H.advance(800); }
  H.click(H.byText(H.page(b.ctx), 'Done'));
}
const nudgeWeight = (b, v) => { const w = H.page(b.ctx).querySelector('input.gv-session-weight'); w.value = v; H.fire(w, 'input'); };
const draft = b => b.ctx.state.logDraft;
const sets = b => draft(b).entries[0].sets;
const { buildRows } = require('../src/page-log.js');

(async () => {
  await check('A1. Skip after a weight change: the set is not saved, not counted, and the tile says 2', async () => {
    const b = await start();
    doSet(b); doSet(b);
    H.advance(6000);
    nudgeWeight(b, '62.5');
    assert.strictEqual(sets(b)[2].touched, true, 'fixture: the weight write touched set 3');
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
    assert.strictEqual(buildRows(draft(b)).length, 2, `buildRows would save ${buildRows(draft(b)).length} sets, not 2`);
    assert.deepStrictEqual(flow.progress(draft(b)), { done: 2, total: 3 }, 'progress counts the skipped set as done');
    const text = H.page(b.ctx).textContent;
    assert.ok(/2\s*sets done/.test(text), `the complete tile reads: ${JSON.stringify(text.slice(0, 200))}`);
    H.click(H.byText(H.page(b.ctx), 'Finish & save'));
    await H.flush();
    assert.strictEqual(b.saved.length, 1, 'the session was saved');
    assert.deepStrictEqual(b.saved[0].rows.map(r => r.reps + 'x' + r.weight_kg), ['8x60', '8x60'], 'the skipped set 3 reached the note');
  });

  await check('A2. X -> Bank it with a weight change and 0 reps on the counter: the untouched set is not saved', async () => {
    const b = await start();
    doSet(b); doSet(b);
    H.advance(6000);
    nudgeWeight(b, '62.5');
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    const sheet = H.modals.slice().reverse().find(m => m.kind === 'end');
    await sheet.opts.onSave();
    assert.strictEqual(b.saved.length, 1);
    assert.strictEqual(b.saved[0].rows.length, 2, `saved ${b.saved[0].rows.length} sets: ${JSON.stringify(b.saved[0].rows.map(r => r.reps + 'x' + r.weight_kg))}`);
  });

  await check('A3. X -> Back to the log with a weight change and 0 reps: set 3 is not a counted set on the log', async () => {
    const b = await start();
    doSet(b); doSet(b);
    H.advance(6000);
    nudgeWeight(b, '62.5');
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    H.modals.slice().reverse().find(m => m.kind === 'end').opts.onReview();
    assert.strictEqual(b.ctx.state.page, 'log');
    assert.strictEqual(buildRows(draft(b)).length, 2, 'the log would save a third set');
    assert.strictEqual(sets(b)[2].done, false, 'and it was not ticked for the user');
  });

  await check('A4. control: a weight change and then a REAL set (8 reps, Done) is saved at the new weight', async () => {
    const b = await start();
    doSet(b); doSet(b);
    H.advance(6000);
    nudgeWeight(b, '62.5');
    const z = H.page(b.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 8; i++) { H.tapZone(z); H.advance(800); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.deepStrictEqual(buildRows(draft(b)).map(r => r.reps + 'x' + r.weight_kg), ['8x60', '8x60', '8x62.5']);
  });

  await check('A5. control: reps TYPED on the log before Guided, then X -> Bank it with 0 on the counter, still saves the typed set', async () => {
    const b = await start();
    doSet(b);
    H.advance(6000);
    const s = sets(b)[1];
    s.reps = '9'; s.touched = true;          // typed on the log overview earlier
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    await H.modals.slice().reverse().find(m => m.kind === 'end').opts.onSave();
    assert.deepStrictEqual(b.saved[0].rows.map(r => r.reps), ['8', '9'], 'a figure the user typed themselves must still save');
  });

  await check('A6. a skipped set that is then typed into on the log counts again (typed wins over skipped)', async () => {
    const b = await start();
    doSet(b);
    nudgeWeight(b, '62.5');
    H.advance(6000);
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
    const s = sets(b)[1];
    assert.strictEqual(buildRows(draft(b)).length, 1, 'fixture: the skip dropped it');
    s.reps = '7'; s.touched = true;
    assert.strictEqual(buildRows(draft(b)).length, 2, 'typed after the skip must count');
  });

  await check('A7. session-flow.markSkipped / markExerciseSkipped drop a touched, unticked set from the counted sets and leave a ticked one alone', async () => {
    const mk = () => ({ entries: [{ sets: [
      { reps: '8', weight_kg: '62.5', seconds: '', done: false, touched: true },
      { reps: '8', weight_kg: '60', seconds: '', done: true, touched: true },
    ] }] });
    const d = mk();
    flow.markSkipped(d, { entryIndex: 0, setIndex: 0 });
    assert.strictEqual(d.entries[0].sets[0].skipped, true);
    assert.strictEqual(d.entries[0].sets[0].touched, false, 'a skipped, unticked set is a prefill again');
    flow.markSkipped(d, { entryIndex: 0, setIndex: 1 });
    assert.strictEqual(d.entries[0].sets[1].done, true, 'a ticked set is never un-done by a skip');
    assert.strictEqual(d.entries[0].sets[1].touched, true);
    const e = mk(); e.entries[0].sets[1].done = false;
    flow.markExerciseSkipped(e, { entryIndex: 0, setIndex: 0 });
    assert.strictEqual(e.entries[0].sets[0].touched, false, 'skip exercise drops the set on screen too');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1116 session skip saves OK (${results.length} cases)`);
  process.exit(0);
})();
