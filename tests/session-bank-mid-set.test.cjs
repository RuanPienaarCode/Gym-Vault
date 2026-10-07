'use strict';
/* "BANK IT" FROM THE X MID-SET KEEPS THE COUNT ON THE SCREEN (0.12.1, audit
   L3-02).

   THE BUG THIS LOCKS. On the live screen the X opens the End session sheet.
   With twelve taps on the counter and no Done yet, "Bank it" saved the sets
   that were already ticked and silently dropped the twelve; "Back to the log"
   did the same and the log showed an empty set. A hold that was running was
   dropped the same way: a 50-second plank saved nothing. What the user was
   looking at was not what landed.

   Ruan's decision: SAVE it. The live figure is committed through
   applyCompletion with the SAME observed kind the Done button uses (reps for
   the tap counter, seconds for the stopwatch) — no new trust rule. Only the
   two exits that keep the work do it; "Keep going" must leave the live set
   exactly as it was, and Discard must not write anything.

   Drives the REAL controller and the REAL guided screen (tests/
   live-session-harness.js). */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function guided(planBody, opts) {
  const b = await H.boot(Object.assign({ planBody, settings: { guideRestSeconds: 0 } }, opts));
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
/* Set 1 properly (10 taps, Done), then `n` taps on set 2 and stop there. */
async function twelveOnScreen(opts) {
  const b = await guided('## D (any)\n\n- Push-ups | 2 x 10\n- Plank | 1 x 60s\n', opts);
  H.advance(6000); let z = H.page(b.ctx).querySelector('.gv-session-zone');
  for (let i = 0; i < 10; i++) { H.tapZone(z); H.advance(800); }
  H.click(H.byText(H.page(b.ctx), 'Done'));
  H.advance(6000); z = H.page(b.ctx).querySelector('.gv-session-zone');
  for (let i = 0; i < 12; i++) { H.tapZone(z); H.advance(800); }
  assert.strictEqual(H.countText(b.ctx), '12', 'fixture: twelve on the counter');
  return b;
}
const openSheet = ctx => { H.click(H.byLabel(H.page(ctx), 'End session')); return H.modals.at(-1); };
const rowsOf = b => (b.saved[0] ? b.saved[0].rows : []).map(r => `${r.exercise} s${r.set} reps=${r.reps} sec=${r.seconds}`);
const savedOnce = b => { assert.strictEqual(b.saved.length, 1, `expected one saved session, got ${b.saved.length} (rows: ${JSON.stringify(rowsOf(b))})`); return b.saved[0]; };

(async () => {
  await check('1. 12 taps, X, Bank it -> a row with reps=12', async () => {
    const b = await twelveOnScreen();
    await openSheet(b.ctx).opts.onSave();
    const reps = savedOnce(b).rows.filter(r => r.exercise === 'Push-ups').map(r => r.reps);
    assert.deepStrictEqual(reps, ['10', '12'], `saved push-up reps ${JSON.stringify(reps)} — the 12 on screen must be the second set`);
  });

  await check('2. 12 taps, X, Back to the log -> the log shows set 2 done with 12', async () => {
    const b = await twelveOnScreen();
    openSheet(b.ctx).opts.onReview();
    assert.strictEqual(b.ctx.state.page, 'log');
    const set = b.ctx.state.logDraft.entries[0].sets[1];
    assert.strictEqual(set.reps, '12', `set 2 reps ${JSON.stringify(set.reps)}`);
    assert.strictEqual(set.done, true, 'and it is ticked, so it counts');
  });

  await check('3. Keep going leaves the live set exactly as it was', async () => {
    const b = await twelveOnScreen();
    const sheet = openSheet(b.ctx);
    assert.ok(sheet.opts.onSave && sheet.opts.onReview && sheet.opts.onDiscard, 'the sheet is wired');
    /* "Keep going" has no callback — it only closes. Opening the sheet alone
       must not have committed anything. */
    const set = b.ctx.state.logDraft.entries[0].sets[1];
    assert.strictEqual(set.done, false, 'opening the sheet must not commit the live count');
    H.tapZone(H.page(b.ctx).querySelector('.gv-session-zone')); H.advance(800);
    assert.strictEqual(H.countText(b.ctx), '13', 'and the counter carries on');
  });

  await check('4. Discard writes nothing and does not tick the live set on the way out', async () => {
    const b = await twelveOnScreen();
    const set = b.ctx.state.logDraft.entries[0].sets[1];
    openSheet(b.ctx).opts.onDiscard();
    await H.flush();
    assert.strictEqual(b.saved.length, 0);
    assert.strictEqual(b.ctx.state.logDraft, null);
    assert.strictEqual(set.done, false, 'a discard must not commit the live count first');
    assert.strictEqual(set.touched, false);
  });

  await check('5. an empty counter commits nothing (no reps=0 row)', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(6000);
    assert.strictEqual(H.countText(b.ctx), '0');
    openSheet(b.ctx).opts.onReview();
    const sets = b.ctx.state.logDraft.entries[0].sets;
    assert.ok(sets.every(s => !s.done && !s.touched), `no set may be ticked: ${JSON.stringify(sets)}`);
  });

  await check('6. a running 50 s hold, X, Bank it -> seconds 50', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n- Plank | 1 x 60s\n');
    H.advance(6000); const z = H.page(b.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 10; i++) { H.tapZone(z); H.advance(800); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    H.advance(5420 + 50000);
    assert.strictEqual(H.countText(b.ctx), '50s', 'fixture: a 50 s hold on screen');
    await openSheet(b.ctx).opts.onSave();
    const plank = savedOnce(b).rows.find(r => r.exercise === 'Plank');
    assert.ok(plank, `no Plank row saved: ${JSON.stringify(rowsOf(b))}`);
    assert.strictEqual(String(plank.seconds), '50', `plank seconds ${JSON.stringify(plank.seconds)}`);
  });

  await check('7a. a banked hold claims a record exactly as Done would (history best is 40 s)', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 60s\n');
    H.advance(5420 + 50000);
    openSheet(b.ctx).opts.onReview();
    const carried = (b.ctx.state.sessionCarry || {}).records || [];
    assert.strictEqual(carried.length, 1, `the 50 s hold beats the 40 s best: ${JSON.stringify(carried)}`);
    assert.strictEqual(carried[0].kind, 'seconds');
    assert.strictEqual(String(carried[0].val), '50');
  });
  await check('7b. a banked count claims a record exactly as Done would (history best is 12 reps)', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); const z = H.page(b.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 13; i++) { H.tapZone(z); H.advance(800); }
    openSheet(b.ctx).opts.onReview();
    const carried = (b.ctx.state.sessionCarry || {}).records || [];
    assert.strictEqual(carried.length, 1, `13 beats the 12-rep best: ${JSON.stringify(carried)}`);
    assert.strictEqual(String(carried[0].val), '13');
  });
  await check('7c. a banked count that only EQUALS the best claims nothing', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); const z = H.page(b.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 12; i++) { H.tapZone(z); H.advance(800); }
    openSheet(b.ctx).opts.onReview();
    assert.strictEqual(((b.ctx.state.sessionCarry || {}).records || []).length, 0);
    assert.strictEqual(b.ctx.state.logDraft.entries[0].sets[0].reps, '12', 'but the 12 is still saved into the set');
  });

  await check('8. a hold that has not started (still in the count-in) commits nothing', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 60s\n');
    H.advance(2000);
    openSheet(b.ctx).opts.onReview();
    const set = b.ctx.state.logDraft.entries[0].sets[0];
    assert.ok(!set.done && !set.touched, `count-in must not commit: ${JSON.stringify(set)}`);
  });

  await check('9. on the rest screen there is no live set: Bank it saves exactly the ticked sets', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 2 x 10\n', { settings: { guideRestSeconds: 30 } });
    H.advance(6000); const z = H.page(b.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 10; i++) { H.tapZone(z); H.advance(800); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.ok(H.page(b.ctx).querySelector('.gv-session-rest'), 'fixture: resting');
    await openSheet(b.ctx).opts.onSave();
    assert.deepStrictEqual(savedOnce(b).rows.map(r => r.reps), ['10']);
  });

  await check('10. a typed count (Type button) is committed like a tapped one', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000);
    /* typeCountButton's `set` writes sess.counter exactly like this */
    b.ctx.state.session.counter = { count: 17, lastTapAt: b.ctx.state.session.counter.lastTapAt };
    await openSheet(b.ctx).opts.onSave();
    assert.strictEqual(savedOnce(b).rows[0].reps, '17');
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n')[0]}` : ''}`);
  if (failed.length) { console.error(`${failed.length} of ${results.length} bank-mid-set checks failed`); process.exit(1); }
  console.log(`session bank mid-set OK (${results.length} checks: the live count and the running hold are saved by Bank it and Back to the log, never by Keep going or Discard)`);
})();
