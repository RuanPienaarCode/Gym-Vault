'use strict';
/* AUDIT 16 NOV 2026, LANE TIMED: four findings in timed circuits.

   #4  A timed circuit on a RUN day logged only its first interval. A run is one
       row everywhere (page-log.makeEntry), but the schedule plays it as many
       intervals, and every interval after the first had no set to write to: no
       distance box, no time. Now each completed interval adds its seconds to the
       run's ONE row and the distance box is on every interval.
   #5  Typing only the reps let an UNTOUCHED weight prefill claim NEW BEST.
       "Typed" was one flag per set; it is now known per figure.
   #36 Previous then Skip handed a whole, already-played interval back to the
       clock and grew the draft by a set.
   #37 The Start button and the "n min scheduled" line read the same schedule
       through two different roundings and could disagree.

   Drives the REAL controller and guided screens (tests/live-session-harness.js:
   fake clock) plus the pure halves. Every check names the finding it guards. */
const assert = require('node:assert');
const path = require('node:path');
const H = require('./live-session-harness.js');
const tp = require('../src/timed-plan');
const flow = require('../src/session-flow');
const { buildRows } = require('../src/page-log');
const { applyCompletion } = require(path.join(H.SRC, 'page-session'));

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const STRENGTH_SETTINGS = { soundMode: 'silent', guideMode: 'timed', guideWarmup: false, guideCooldown: false, guideTransitions: true };
async function circuit(planBody, exercises, guideMinutes, extra, workouts) {
  const b = await H.boot({
    planBody, exercises, workouts,
    settings: Object.assign({}, STRENGTH_SETTINGS, { guideMinutes }, extra || {}),
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  /* A one-exercise day opens set by set (audit 25 Nov 2026, #38): this guard is about the timed circuit, so pick it. */
  { const card = H.page(b.ctx).querySelectorAll('[role=radio]').find(c => c.getAttribute('aria-label') === 'Timed circuit'); if (b.settings.guideMode === 'timed' && card && card.getAttribute('aria-checked') !== 'true') H.click(card); }
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /^Start/.test(x.textContent.trim())));
  return b;
}
const sessOf = b => b.ctx.state.session;
const pos = b => sessOf(b).timed;
const draftOf = b => b.ctx.state.logDraft;
const ivs = b => draftOf(b).timed.intervals;
const live = b => ivs(b)[pos(b).index];
const over = b => pos(b).index >= ivs(b).length;
const skipBtn = b => H.byLabel(H.page(b.ctx), 'Skip this interval') || H.byLabel(H.page(b.ctx), 'Skip ahead');
const backBtn = b => H.byLabel(H.page(b.ctx), 'Previous interval');
const boxes = b => H.page(b.ctx).querySelectorAll('.gv-timed-input');
const type = (box, v) => { box.value = v; H.fire(box, 'input'); };
const toFirstWork = b => { for (let g = 0; g < 5000 && live(b).kind !== 'work'; g++) H.advance(200); assert.strictEqual(live(b).kind, 'work'); };
const nextInterval = b => { const i = pos(b).index; for (let g = 0; g < 20000 && !over(b) && pos(b).index === i; g++) H.advance(200); };
const workSeconds = b => ivs(b).filter(i => i.kind === 'work').reduce((n, i) => n + i.seconds, 0);

const RUN = H.ex('Hill Repeats', { unit: 'km' });
const EASY = H.ex('Easy Run', { unit: 'km' });

(async () => {
  /* ---------------------------------------------------------------- #4 */

  await check('#4a. a run-only circuit logs ONE row holding the total time of every interval', async () => {
    const b = await circuit('## D (any)\n\n- Hill Repeats | 6 x 3 min hard\n', [RUN], 30);
    const draft = draftOf(b);
    assert.strictEqual(draft.entries[0].sets.length, 1, 'fixture: a run keeps its one set');
    const worksPlayed = ivs(b).filter(i => i.kind === 'work').length;
    assert.ok(worksPlayed > 1, 'fixture: the schedule plays the run as many intervals');
    toFirstWork(b);
    type(boxes(b)[0], '5');
    while (!over(b)) H.advance(200);
    assert.strictEqual(draft.entries[0].sets.length, 1, 'still one set after the circuit');
    const rows = buildRows(draft);
    assert.strictEqual(rows.length, 1, 'one row, not one per interval');
    assert.strictEqual(rows[0].seconds, String(workSeconds(b)), `the row holds ${workSeconds(b)} s, the sum of every work interval`);
    assert.strictEqual(rows[0].distance_km, '5');
  });

  await check('#4b. the distance box is on EVERY interval of the run and edits the same one figure', async () => {
    const b = await circuit('## D (any)\n\n- Hill Repeats | 6 x 3 min hard\n', [RUN], 30);
    const set = draftOf(b).entries[0].sets[0];
    toFirstWork(b);
    nextInterval(b);              // transition
    nextInterval(b);              // first -> second work interval is two steps away
    for (let g = 0; g < 5000 && live(b).kind !== 'work'; g++) H.advance(200);
    assert.strictEqual(live(b).setIndex, 1, 'fixture: on the run\'s second interval');
    assert.strictEqual(boxes(b).length, 1, 'a distance box is offered on the second interval');
    type(boxes(b)[0], '1.5');
    assert.strictEqual(set.distance_km, '1.5', 'it edits the one set');
    nextInterval(b);
    for (let g = 0; g < 5000 && live(b).kind !== 'work'; g++) H.advance(200);
    assert.strictEqual(boxes(b).length, 1, 'and on the third');
    assert.strictEqual(boxes(b)[0].value, '1.5', 'showing the same figure');
  });

  await check('#4c. a skipped interval of the run adds nothing to its time', async () => {
    const b = await circuit('## D (any)\n\n- Hill Repeats | 6 x 3 min hard\n', [RUN], 30);
    toFirstWork(b);
    let played = 0, skipped = 0;
    for (let g = 0; g < 40000 && !over(b); g++) {
      const iv = live(b);
      if (iv.kind === 'work' && iv.setIndex === 2) { H.click(skipBtn(b)); skipped += iv.seconds; continue; }
      const before = pos(b).index;
      H.advance(200);
      if (pos(b).index !== before && iv.kind === 'work') played += iv.seconds;
    }
    assert.ok(skipped > 0, 'fixture: an interval was skipped');
    const rows = buildRows(draftOf(b));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].seconds, String(played), `row ${rows[0].seconds} s vs ${played} s actually played`);
  });

  await check('#4d. `1 x 30 min easy` on a 45-minute dial keeps its second interval', async () => {
    const b = await circuit('## D (any)\n\n- Easy Run | 1 x 30 min easy\n', [EASY], 45);
    toFirstWork(b);
    while (!over(b)) H.advance(200);
    const rows = buildRows(draftOf(b));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].seconds, String(workSeconds(b)));
    assert.ok(Number(rows[0].seconds) > 1800, `${rows[0].seconds} s is more than the first 30-minute interval`);
  });

  await check('#4e. every interval of a run points at the run\'s ONE set, so a skip cannot roll onto the next exercise', async () => {
    /* Live, the next exercise's first set is already played by the time a run's
       second interval is reached, so the old mis-aim was invisible there. The
       position rule itself is what is pinned: session-flow.markSkipped rolls an
       out-of-range setIndex forward onto the NEXT entry. */
    assert.strictEqual(typeof tp.positionFor, 'function');
    const draft = { entries: [
      { exercise: 'Hill Repeats', distance: true, sets: [{ distance_km: '', minutes: '', done: false, touched: false }] },
      { exercise: 'Push-ups', distance: false, sets: [{ reps: '10', done: false, touched: false }, { reps: '10', done: false, touched: false }] },
    ] };
    const iv = { kind: 'work', entryIndex: 0, setIndex: 2 };
    assert.deepStrictEqual(tp.positionFor(draft, iv), { entryIndex: 0, setIndex: 0 });
    assert.strictEqual(tp.setFor(draft, iv), draft.entries[0].sets[0]);
    assert.deepStrictEqual(tp.positionFor(draft, { kind: 'work', entryIndex: 1, setIndex: 1 }), { entryIndex: 1, setIndex: 1 }, 'other entries keep their own setIndex');
    flow.markSkipped(draft, tp.positionFor(draft, iv));
    assert.ok(draft.entries[1].sets.every(s => !s.skipped), 'the next exercise was not touched');
    assert.strictEqual(draft.entries[0].sets[0].skipped, true, 'the run\'s own set carries the skip');
  });

  await check('#4f. control: a one-off run on a mixed day still plays once and logs its minutes', async () => {
    const b = await circuit('## D (any)\n\n- Easy Run | 1 x 5 min easy\n- Push-ups | 3 x 10\n', [EASY, H.ex('Push-ups')], 15);
    assert.strictEqual(ivs(b).filter(i => i.kind === 'work' && i.exercise === 'Easy Run').length, 1);
    toFirstWork(b);
    nextInterval(b);
    const row = buildRows(draftOf(b)).find(r => r.exercise === 'Easy Run');
    assert.ok(row, 'the run row is saved');
    assert.strictEqual(row.seconds, '300');
  });

  /* ---------------------------------------------------------------- #5 */

  const BENCH = H.ex('Bench Press', { unit: 'kg' });
  const benchHistory = [H.workout('2026-01-01', [
    { exercise: 'Bench Press', set: 1, reps: '8', weight_kg: '55', seconds: '', note: '', distance_km: '' },
  ])];
  const BENCH_PLAN = '## D (any)\n\n- Bench Press | 3 x 8 @ 60kg\n';

  await check('#5a. typing only the reps does NOT let the untouched 60 kg prefill claim NEW BEST', async () => {
    const b = await circuit(BENCH_PLAN, [BENCH], 5, null, benchHistory);
    toFirstWork(b);
    const idx = pos(b).index;
    assert.strictEqual(boxes(b).length, 2, 'fixture: a reps box and a weight box');
    type(boxes(b)[0], '6');
    nextInterval(b);
    assert.ok(pos(b).index > idx, 'fixture: the interval ended');
    assert.deepStrictEqual(sessOf(b).records, [], 'no record row (it pays XP)');
    assert.ok(!(sessOf(b).pendingCallouts || []).some(l => /NEW BEST/.test(l)), `callouts: ${JSON.stringify(sessOf(b).pendingCallouts)}`);
    const set = draftOf(b).entries[0].sets[0];
    assert.strictEqual(buildRows(draftOf(b))[0].weight_kg, '60', 'the saved row still holds the prefilled weight (settled decision)');
    assert.strictEqual(set.reps, '6');
  });

  await check('#5b. editing the weight box itself does claim the weight record', async () => {
    const b = await circuit(BENCH_PLAN, [BENCH], 5, null, benchHistory);
    toFirstWork(b);
    type(boxes(b)[1], '62.5');
    nextInterval(b);
    assert.strictEqual(sessOf(b).records.length, 1);
    assert.strictEqual(sessOf(b).records[0].kind, 'weight');
    assert.strictEqual(sessOf(b).records[0].val, '62.5');
  });

  await check('#5c. control: typing reps on a reps exercise still claims the reps record', async () => {
    const b = await circuit('## D (any)\n\n- Push-ups | 3 x 10\n', [H.ex('Push-ups')], 5);
    toFirstWork(b);
    type(boxes(b)[0], '15');
    nextInterval(b);
    assert.strictEqual(sessOf(b).records.length, 1);
    assert.strictEqual(sessOf(b).records[0].kind, 'reps');
  });

  await check('#5d. applyCompletion takes the per-figure list: typed reps say nothing about the weight', async () => {
    const mkCtx = () => ({
      data: { exercises: [BENCH], goals: [], workouts: [], body: [] }, settings: {}, io: {},
      view: null, notice() {}, state: {},
    });
    const entry = { exercise: 'Bench Press', target: '3 x 8 @ 60kg', duration: false, weighted: true, distance: false, sets: [] };
    const mkSess = () => ({ workoutsAtStart: benchHistory, metGoals: new Set(), records: [], goalCount: 0, muted: true });
    const run = typed => {
      const set = { reps: '6', weight_kg: '60', seconds: '', done: false, touched: true };
      const sess = mkSess();
      return applyCompletion(mkCtx(), { entries: [entry], date: '2026-02-01', day: 'D' }, sess, set, entry, {}, { observed: [], typed }).filter(l => /NEW BEST/.test(l));
    };
    assert.strictEqual(run(['reps']).length, 0, 'reps typed: no weight claim');
    assert.strictEqual(run(['weight']).length, 1, 'weight typed: weight claim');
  });

  await check('#5e. session-flow keeps the per-figure knowledge beside `touched`, and a skip wipes it', async () => {
    assert.strictEqual(typeof flow.markTyped, 'function');
    assert.strictEqual(typeof flow.typedKinds, 'function');
    const set = { reps: '8', weight_kg: '60', seconds: '', done: false, touched: false };
    assert.deepStrictEqual(flow.typedKinds(set), [], 'an untouched set holds no typed figure');
    flow.markTyped(set, 'reps');
    set.touched = true;
    assert.deepStrictEqual(flow.typedKinds(set), ['reps']);
    flow.markTyped(set, 'weight_kg');
    assert.deepStrictEqual(flow.typedKinds(set).sort(), ['reps', 'weight']);
    flow.markSkipped({ entries: [{ sets: [set] }] }, { entryIndex: 0, setIndex: 0 });
    assert.strictEqual(set.touched, false);
    assert.deepStrictEqual(flow.typedKinds(set), [], 'a skipped set is a prefill again: nothing typed');
    /* A set marked touched by an older build has no per-figure record: it keeps the old rule. */
    assert.deepStrictEqual(flow.typedKinds({ reps: '8', touched: true }).sort(), ['reps', 'seconds', 'weight']);
  });

  /* ---------------------------------------------------------------- #36 */

  const SQUATS = '## D (any)\n\n- Push-ups | 1 x 10\n- Squats | 1 x 12\n';
  const SQ_EX = [H.ex('Push-ups'), H.ex('Squats')];

  await check('#36a. Previous then Skip on an interval that already finished gives nothing back', async () => {
    const b = await circuit(SQUATS, SQ_EX, 20);
    toFirstWork(b);
    const w = pos(b).index;
    nextInterval(b);
    assert.ok(pos(b).index > w, 'fixture: the first work interval finished');
    const total = draftOf(b).timed.totalSeconds, count = ivs(b).length;
    const sets = draftOf(b).entries.map(e => e.sets.length);
    while (pos(b).index > w) H.click(backBtn(b));
    assert.strictEqual(pos(b).index, w);
    H.click(skipBtn(b));
    assert.strictEqual(draftOf(b).timed.totalSeconds, total, 'the schedule did not grow');
    assert.strictEqual(ivs(b).length, count, 'no interval was added');
    assert.deepStrictEqual(draftOf(b).entries.map(e => e.sets.length), sets, 'the draft did not grow');
    assert.strictEqual(pos(b).index, w + 1, 'it just moved on');
  });

  await check('#36b. skipping the same interval twice gives its time back once', async () => {
    const b = await circuit(SQUATS, SQ_EX, 20);
    toFirstWork(b);
    const w = pos(b).index;
    H.click(skipBtn(b));
    const once = draftOf(b).timed.totalSeconds;
    assert.ok(once > 20 * 60, 'fixture: the first skip handed time back');
    H.click(backBtn(b));
    assert.strictEqual(pos(b).index, w);
    H.click(skipBtn(b));
    assert.strictEqual(draftOf(b).timed.totalSeconds, once, 'the second skip of the same interval gave nothing more');
  });

  await check('#36c. control: skipping a fresh interval still hands its time back', async () => {
    const b = await circuit(SQUATS, SQ_EX, 20);
    toFirstWork(b);
    const total = draftOf(b).timed.totalSeconds;
    H.click(skipBtn(b));
    assert.ok(draftOf(b).timed.totalSeconds > total);
  });

  /* ---------------------------------------------------------------- #37 */

  const setupOf = async (planBody, exercises, settings) => {
    const b = await H.boot({ planBody, exercises, settings: Object.assign({}, STRENGTH_SETTINGS, settings) });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    const root = H.page(b.ctx);
    const button = root.querySelector('.gv-btn-go');
    const line = root.querySelector('.gv-setup-preview');
    assert.ok(button && line, 'fixture: the setup screen');
    return { b, button, line, root };
  };
  const numberIn = text => Number((/(\d+)/.exec(text) || [])[1]);

  await check('#37a. a run-only day `1 x 30 min` on a 10-minute dial: the button says what is scheduled', async () => {
    const { button, line } = await setupOf('## D (any)\n\n- Easy Run | 1 x 30 min easy\n', [EASY], { guideMinutes: 10 });
    assert.match(line.textContent, /30 min scheduled/, `fixture: ${line.textContent}`);
    assert.strictEqual(numberIn(button.textContent), 30, `the button reads "${button.textContent}"`);
  });

  await check('#37b. the button and the summary line agree on every dial, with warm-up and cool-down too', async () => {
    const mobility = [H.ex('Cat-Cow', { type: 'mobility' }), H.ex('Child Pose', { type: 'mobility' }), H.ex('Hamstring Stretch', { type: 'mobility' }), H.ex('Hip Opener', { type: 'mobility' })];
    for (const minutes of [5, 10, 30, 45]) {
      for (const extra of [{}, { guideWarmup: true, guideCooldown: true }]) {
        for (const plan of ['## D (any)\n\n- Easy Run | 1 x 30 min easy\n', '## D (any)\n\n- Push-ups | 3 x 10\n- Squats | 3 x 12\n']) {
          const { button, line } = await setupOf(plan, [EASY, H.ex('Push-ups'), H.ex('Squats'), ...mobility], Object.assign({ guideMinutes: minutes }, extra));
          assert.strictEqual(numberIn(button.textContent), numberIn(/(\d+) min scheduled/.exec(line.textContent)[1]),
            `dial ${minutes} ${JSON.stringify(extra)}: "${button.textContent}" vs "${line.textContent}"`);
        }
      }
    }
  });

  await check('#37c. the label comes from the schedule total, rounded like the summary line', async () => {
    const setup = require('../src/page-session-setup');
    assert.strictEqual(typeof setup.startLabel, 'function');
    assert.strictEqual(setup.startLabel({ totalSeconds: 1805 }), 'Start 30 minutes');
    assert.strictEqual(setup.startLabel({ totalSeconds: 350 }), 'Start 6 minutes');
    assert.strictEqual(setup.startLabel({ totalSeconds: 60 }), 'Start 1 minute');
  });

  /* ------------------------------------------------- reps-mode preview */

  await check('#37d. the reps-mode preview counts a run as ONE set, like the draft', async () => {
    const plan = '## D (any)\n\n- Hill Repeats | 6 x 3 min hard\n- Push-ups | 3 x 10\n';
    const { b, line, button } = await setupOf(plan, [RUN, H.ex('Push-ups')], { guideMode: 'reps' });
    assert.match(line.textContent, /4 sets/, `the preview says "${line.textContent}"`);
    H.click(button);
    const held = draftOf(b).entries.reduce((n, e) => n + e.sets.length, 0);
    assert.strictEqual(held, 4, 'the draft holds the same number');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit 1116 timed circuits OK (${results.length} checks)`);
  process.exit(0);
})();
