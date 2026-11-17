'use strict';
/* AUDIT 16 NOV 2026, findings #13 and #47: THE COMPLETE SCREEN COUNTED WHAT FINISH
   WOULD NOT SAVE.

   #13  Log -> tick an empty run row -> Guided showed "Session done - 1 set done" with a
        Finish & save that only raised "Tick a set (or type a figure) before
        finishing." renderComplete counted with stats.setCounts, page-log's
        finishSession saves by setWorthSaving (via buildRows). One rule now: the tile,
        the button and the saved rows all come from buildRows(draft).length.
   #47  A freestyle guided session with no exercises went straight to a "Session
        done" trophy at 0 sets. With nothing to save there is no celebration: a plain
        "nothing logged yet" state that leads to the log or Discard.

   Drives the REAL controller, the real log page and the real guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const text = b => H.page(b.ctx).textContent;
const labels = b => H.page(b.ctx).querySelectorAll('button').map(x => x.textContent.trim());

(async () => {
  await check('E1. #13: Log -> tick an empty run row -> Guided offers no Finish & save and no "1 set done"', async () => {
    const b = await H.boot({
      planBody: '## D (any)\n\n- Easy Run | 1 x 30 min\n',
      exercises: [H.ex('Easy Run', { unit: 'km' })], workouts: [],
      settings: { soundMode: 'silent', guideRestSeconds: 0 },
    });
    const plan = b.ctx.activePlan(); b.ctx.startLog(plan, plan.model.days[0]);
    assert.strictEqual(b.ctx.state.page, 'log');
    H.click(H.byLabel(H.page(b.ctx), 'Mark done'));          // an empty run row, ticked
    assert.strictEqual(b.ctx.state.logDraft.entries[0].sets[0].done, true, 'fixture: ticked');
    b.ctx.enterGuided();
    assert.ok(!/1\s*set done/.test(text(b)), `the tile still says: ${JSON.stringify(text(b))}`);
    assert.ok(!labels(b).includes('Finish & save'), 'a dead Finish & save is offered');
    assert.ok(labels(b).includes('Discard'), 'Discard is the honest way out');
    assert.ok(/nothing logged/i.test(text(b)), 'the screen says nothing is logged');
    assert.ok(labels(b).some(l => /Review in log/.test(l)), 'and leads back to the log');
  });

  await check('E2. #47: freestyle guided with no exercises is not a "Session done" trophy', async () => {
    const b = await H.boot({ settings: { soundMode: 'silent', guideRestSeconds: 0 } });
    b.ctx.startLog(null, null);
    b.ctx.enterGuided();
    assert.strictEqual(b.ctx.state.page, 'session');
    assert.ok(!/Session done/.test(text(b)), `celebrates an empty session: ${JSON.stringify(text(b))}`);
    assert.ok(H.page(b.ctx).querySelectorAll('.gv-session-complete-ico').length === 0, 'the trophy is drawn');
    assert.ok(/nothing logged/i.test(text(b)));
    assert.ok(labels(b).includes('Discard'));
    assert.ok(labels(b).some(l => /Add exercise|Review in log/.test(l)), 'and a way to the log to add one');
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Add exercise|Review in log/.test(x.textContent)));
    assert.strictEqual(b.ctx.state.page, 'log', 'it leads to the log');
  });

  await check('E3. all sets skipped: the same plain state (the tile never says 0 sets done under a trophy)', async () => {
    const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 1 x 10\n', exercises: [H.ex('Push-ups')], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
    assert.ok(!/Session done/.test(text(b)), JSON.stringify(text(b)));
    assert.ok(!labels(b).includes('Finish & save'));
  });

  await check('E4. control: one real set done -> "Session done", 1 set done, Finish & save saves it', async () => {
    const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 1 x 10\n', exercises: [H.ex('Push-ups')], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    H.advance(6000);
    const z = H.page(b.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 10; i++) { H.tapZone(z); H.advance(800); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.ok(/Session done/.test(text(b)));
    assert.ok(/1\s*set done/.test(text(b)));
    H.click(H.byText(H.page(b.ctx), 'Finish & save'));
    await H.flush();
    assert.strictEqual(b.saved.length, 1);
  });

  await check('E5. control: a tick on a rep set with no figure at all counts nowhere, so the tile and the button agree on the same number', async () => {
    const { buildRows } = require('../src/page-log');
    const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 2 x 10\n- Easy Run | 1 x 30 min\n', exercises: [H.ex('Push-ups'), H.ex('Easy Run', { unit: 'km' })], workouts: [], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
    const plan = b.ctx.activePlan(); b.ctx.startLog(plan, plan.model.days[0]);
    const ticks = H.page(b.ctx).querySelectorAll('button').filter(x => x.getAttribute('aria-label') === 'Mark done');
    ticks.forEach(t => H.click(t));                           // 2 push-up sets (prefilled 10) + the empty run
    const rows = buildRows(b.ctx.state.logDraft).length;
    assert.strictEqual(rows, 2, 'fixture: the empty run is not saveable, the two push-up sets are');
    b.ctx.enterGuided();
    assert.ok(new RegExp(`${rows}\\s*sets done`).test(text(b)), `tile: ${JSON.stringify(text(b))}`);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1116 session complete empty OK (${results.length} cases)`);
  process.exit(0);
})();
