'use strict';
/* AUDIT 25 NOV 2026, LANE SESSION: the live set-by-set screen.

   #5   "Later" threw away the reps counted so far (and a running hold). The count
        is now parked on the set and is back when the exercise comes round again;
        nothing is marked done by Later itself. The two exits that keep work (Bank
        it, Back to the log) keep a parked count too, as they keep the one on screen.
   #7   Outside Apex and Lock In the main live-set button was a small button. It is
        a full-size .gv-btn now.
   #8   The Apex live set said the same best four times. Kept: "Beat N", "N to go"
        and the big count. Gone: the 0 / n% of PB / PB n scale, "You're on N", and
        the recap's "Most reps" when it equals the target already shown.
   #23  Discard on the End session sheet threw the session away in one tap. It now
        asks first, in the log page's own words.

   Drives the REAL controller and guided screen (tests/live-session-harness.js). */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const HISTORY = [H.workout('2026-01-01', [
  { exercise: 'Push-ups', set: 1, reps: '12', weight_kg: '', seconds: '', note: '', distance_km: '' },
  { exercise: 'Plank', set: 1, reps: '', weight_kg: '', seconds: '40', note: '', distance_km: '' },
  { exercise: 'Goblet Squat', set: 1, reps: '8', weight_kg: '20', seconds: '', note: '', distance_km: '' },
])];

async function guided(planBody, settings) {
  const b = await H.boot({ planBody, workouts: HISTORY, settings: Object.assign({ guideRestSeconds: 0, soundMode: 'silent', guideMode: 'reps' }, settings) });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const pg = b => H.page(b.ctx);
const zone = b => pg(b).querySelector('.gv-session-zone');
const taps = (b, n) => { for (let i = 0; i < n; i++) { H.tapZone(zone(b)); H.advance(800); } };
const draftSet = (b, e, s) => b.ctx.state.logDraft.entries[e].sets[s];
const exName = b => pg(b).querySelector('.gv-session-exname').textContent;
const recapLabels = b => pg(b).querySelectorAll('.gv-recap-line').map(l => l.querySelector('dt').textContent);
const openSheet = b => { H.click(H.byLabel(pg(b), 'End session')); return H.modals.at(-1); };

const REPS_PLAN = '## D (any)\n\n- Push-ups | 2 x 15\n- Goblet Squat | 1 x 8\n';

(async () => {
  /* ---------------------------------------------------------------- #5 */
  await check('#5. 12 taps, Later, come back: the counter is at 12 and Later ticked nothing', async () => {
    const b = await guided(REPS_PLAN, { skin: 'floor' });
    H.advance(6000); taps(b, 12);
    assert.strictEqual(H.countText(b.ctx), '12', 'fixture');
    H.click(H.byLabel(pg(b), 'Do Push-ups later'));
    const set = draftSet(b, 0, 0);
    assert.strictEqual(set.done, false, 'Later must not tick the set');
    assert.strictEqual(set.touched, false, 'nor mark it typed');
    assert.strictEqual(exName(b), 'Goblet Squat', 'fixture: moved on');
    H.advance(6000); taps(b, 8); H.click(H.byText(pg(b), 'Done'));
    assert.strictEqual(exName(b), 'Push-ups', 'fixture: back on the put-off exercise');
    H.advance(6000);
    assert.strictEqual(H.countText(b.ctx), '12', `the counter reads ${H.countText(b.ctx)}`);
    taps(b, 3); H.click(H.byText(pg(b), 'Done'));
    assert.strictEqual(draftSet(b, 0, 0).reps, '15', 'and carries on from 12');
  });

  await check('#5. a parked count is kept by Save session, like the one on screen', async () => {
    const b = await guided(REPS_PLAN, { skin: 'floor' });
    H.advance(6000); taps(b, 12);
    H.click(H.byLabel(pg(b), 'Do Push-ups later'));
    await openSheet(b).opts.onSave();
    const rows = (b.saved[0] || { rows: [] }).rows.filter(r => r.exercise === 'Push-ups').map(r => r.reps);
    assert.deepStrictEqual(rows, ['12'], `saved push-up reps ${JSON.stringify(rows)}`);
  });

  await check('#5. a running hold, Later, come back: it is there, paused at its time, and Done saves it', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 60s\n- Push-ups | 1 x 10\n', { skin: 'floor' });
    H.advance(5420 + 20000);
    assert.strictEqual(H.countText(b.ctx), '20s', 'fixture: a 20 s hold running');
    H.click(H.byLabel(pg(b), 'Do Plank later'));
    assert.strictEqual(draftSet(b, 0, 0).done, false, 'Later must not tick the hold');
    H.advance(6000); taps(b, 10); H.click(H.byText(pg(b), 'Done'));
    assert.strictEqual(exName(b), 'Plank', 'fixture: back on the plank');
    H.advance(10000);
    assert.strictEqual(H.countText(b.ctx), '20s', `the hold reads ${H.countText(b.ctx)} (paused, not counting in again)`);
    assert.ok(H.byLabel(pg(b), 'Resume'), 'it can be resumed');
    H.click(pg(b).querySelector('.gv-hold-done'));
    assert.strictEqual(draftSet(b, 0, 0).seconds, '20');
    assert.strictEqual(draftSet(b, 0, 0).done, true);
  });

  /* ---------------------------------------------------------------- #7 */
  await check('#7. the live set\'s Done is a full-size button in Floor, Editorial and Calm', async () => {
    for (const skin of ['floor', 'editorial', 'calm']) {
      const b = await guided(REPS_PLAN, { skin });
      const done = H.byText(pg(b), 'Done');
      assert.ok(done.classList.contains('gv-btn'), `${skin}: ${done.className}`);
      assert.ok(!done.classList.contains('gv-btn-small'), `${skin}: Done is still small (${done.className})`);
      H.killProcess();
    }
  });

  /* ---------------------------------------------------------------- #8 */
  await check('#8. Apex: "Beat 12" and "13 to go" stay; the scale and "You\'re on" go', async () => {
    const b = await guided(REPS_PLAN, { skin: 'apex' });
    H.advance(6000);
    const pb = pg(b).querySelector('.gv-pb-target');
    assert.ok(pb, 'fixture: the PB target is shown');
    assert.strictEqual(pb.querySelector('.gv-pb-target-label').textContent, 'Beat 12');
    assert.strictEqual(pb.querySelector('.gv-pb-target-togo').textContent, '13 to go');
    assert.strictEqual(pb.querySelector('.gv-pb-target-marks'), null, 'no 0 / n% of PB / PB n scale');
    const now = pb.querySelector('.gv-pb-target-now');
    assert.ok(!now || now.textContent === '', `"You're on" is still there: ${now && now.textContent}`);
    taps(b, 1);
    assert.strictEqual(pb.querySelector('.gv-pb-target-togo').textContent, '12 to go', 'and it still moves');
  });

  await check('#8. the recap\'s "Most reps" goes when it equals the target (Apex and Floor)', async () => {
    for (const skin of ['apex', 'floor']) {
      const b = await guided(REPS_PLAN, { skin });
      assert.ok(pg(b).querySelector('.gv-pb-target'), `${skin}: fixture: the target is shown`);
      assert.ok(recapLabels(b).some(l => /^Last/.test(l)), `${skin}: the Last line stays: ${recapLabels(b)}`);
      assert.ok(!recapLabels(b).includes('Most reps'), `${skin}: Most reps repeats Beat 12: ${recapLabels(b)}`);
      H.killProcess();
    }
  });

  await check('#8. control: with no PB target (a weighted lift) the recap keeps Most reps', async () => {
    const b = await guided('## D (any)\n\n- Goblet Squat | 2 x 8\n- Push-ups | 1 x 10\n', { skin: 'apex' });
    assert.strictEqual(pg(b).querySelector('.gv-pb-target'), null, 'fixture: no target on a weighted lift');
    assert.ok(recapLabels(b).includes('Most reps'), `recap: ${recapLabels(b)}`);
  });

  /* --------------------------------------------------------------- #23 */
  await check('#23. Discard asks first, in the log page\'s words, and Cancel keeps the session', async () => {
    const b = await guided(REPS_PLAN, { skin: 'floor' });
    const draft = b.ctx.state.logDraft;
    openSheet(b).opts.onDiscard();
    const ask = H.modals.at(-1);
    assert.strictEqual(ask.kind, 'confirm', `a confirm opened (got ${ask.kind})`);
    assert.strictEqual(ask.opts.title, 'Discard session?');
    assert.strictEqual(ask.opts.message, 'Nothing you logged will be saved.');
    assert.strictEqual(ask.opts.confirmLabel, 'Discard');
    assert.strictEqual(b.ctx.state.logDraft, draft, 'nothing is thrown away before the answer');
    ask.opts.onConfirm();
    assert.strictEqual(b.ctx.state.logDraft, null, 'confirmed: gone');
    assert.strictEqual(b.ctx.state.page, 'dashboard');
    assert.strictEqual(b.saved.length, 0);
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n  ${e.message}` : ''}`);
  if (failed.length) process.exit(1);
  console.log(`audit-1125 session live OK (${results.length} checks)`);
  process.exit(0);
})();
