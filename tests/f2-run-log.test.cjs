'use strict';
/* FIX WAVE F2, item 9 (audit L1-04): A GUIDED RUN WITH NOTHING ENTERED CANNOT BE LOGGED.

   The guided run screen let "Log run" through with both the km and the minutes
   boxes empty. The set was ticked, the session ended on "Finish & save", and
   Finish - whose own rule (page-log.setWorthSaving) refuses a run with neither
   figure - only showed a notice: a button that appeared to save and did not.

   Now the button is disabled while both boxes are empty, with the reason written
   under it (a disabled button alone explains nothing), and a click that reaches
   the handler anyway (assistive tech, a stale tap) does nothing. Either box is
   enough, as page-log.setWorthSaving has always allowed.

   Drives the REAL controller and the REAL guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function start(workouts) {
  const b = await H.boot({
    planBody: '## D (any)\n\n- Easy Run | 1 x 30 min\n',
    exercises: [H.ex('Easy Run', { unit: 'km' })],
    workouts: workouts || [],
    settings: { soundMode: 'silent', guideRestSeconds: 0 },
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const logBtn = b => H.page(b.ctx).querySelectorAll('button').find(x => /Log run/.test(x.textContent));
const boxes = b => H.page(b.ctx).querySelectorAll('input.gv-session-distance');
const type = (input, v) => { input.value = v; H.fire(input, 'input'); };
const set = b => b.ctx.state.logDraft.entries[0].sets[0];

(async () => {
  await check('F2-9a. with km and minutes both empty, Log run is disabled and says why', async () => {
    const b = await start();
    assert.strictEqual(boxes(b).length, 2, 'fixture: the run screen with two boxes');
    assert.ok(logBtn(b), 'fixture: the Log run button');
    assert.strictEqual(logBtn(b).disabled, true, 'Log run was enabled with nothing entered');
    const text = H.page(b.ctx).querySelector('.gv-session-body').textContent;
    assert.ok(/km or minutes/i.test(text), `no inline reason: ${JSON.stringify(text)}`);
  });

  await check('F2-9b. a click that reaches the handler anyway logs nothing', async () => {
    const b = await start();
    H.click(logBtn(b));
    assert.strictEqual(set(b).done, false, 'an empty run was ticked');
    assert.deepStrictEqual(b.ctx.state.session.pos, { entryIndex: 0, setIndex: 0 }, 'and the session moved on');
  });

  await check('F2-9c. typing km enables it (and removes the reason); clearing it disables it again', async () => {
    const b = await start();
    const [km, min] = boxes(b);
    type(km, '4.3');
    assert.strictEqual(logBtn(b).disabled, false);
    assert.ok(!/km or minutes/i.test(H.page(b.ctx).querySelector('.gv-session-body').textContent), 'the reason is gone');
    type(km, '');
    assert.strictEqual(logBtn(b).disabled, true);
    type(min, '25');
    assert.strictEqual(logBtn(b).disabled, false, 'minutes alone are enough, as the log page allows');
  });

  await check('F2-9d. whitespace is not a figure', async () => {
    const b = await start();
    const [km, min] = boxes(b);
    type(km, '  '); type(min, ' ');
    assert.strictEqual(logBtn(b).disabled, true);
  });

  await check('F2-9e. a run prefilled from the last one (both boxes already full) is loggable straight away', async () => {
    const b = await start([H.workout('2026-01-01', [{ exercise: 'Easy Run', set: 1, reps: '', weight_kg: '', seconds: '1800', note: '', distance_km: '5' }])]);
    assert.strictEqual(logBtn(b).disabled, false);
    H.click(logBtn(b));
    assert.strictEqual(set(b).done, true);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 run log OK (${results.length} cases)`);
  process.exit(0);
})();
