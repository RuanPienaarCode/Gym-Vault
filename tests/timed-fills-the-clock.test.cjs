'use strict';
/* A TIMED CIRCUIT RUNS FOR THE TIME YOU ASKED FOR.

   Two things used to end one early:

   1. The schedule stopped at the first interval that would not fit whole, so a
      day with a 5-minute run in it could stop minutes short of the dial. Now the
      last set is cut to the time left instead.

   2. The schedule is a list worked out before you start, so a skipped interval
      was simply time gone. A circuit with a 5-minute run in every round, and
      that run skipped from round two, finished ten minutes early. Now a skip
      hands its unused seconds back and the circuit plays on.

   Pure half: timed-plan.js. Live half: the REAL controller and guided screen
   (tests/live-session-harness.js: fake clock, recording speech). */
const assert = require('node:assert');
const tp = require('../src/timed-plan');
const H = require('./live-session-harness.js');

const item = (exercise, target, unit) => ({ exercise, target: target || '', unit: unit || null });
const works = s => s.intervals.filter(i => i.kind === 'work');
const THREE = [item('Push-ups', '15'), item('Squats', '25'), item('Lunges', '30')];
/* A run first and a short hold last: the shape that exposed both bugs. */
const CIRCUIT = [
  item('Warm-up Run', '5 min easy'), item('Jump Squat', '8'), item('Pull-ups', '3'), item('Dips', '5'),
  item('Lunges', '6/leg'), item('Push-ups', '8'), item('Bridge', '12'), item('Plank', '30s', 'seconds'),
];

/* ---------- the schedule fills the dial ---------- */

/* T1. To the second, whatever the dial says. */
for (const minutes of [5, 10, 20, 30, 45]) {
  const s = tp.buildSchedule(THREE, { minutes, workSeconds: 40, transitionSeconds: 10, seed: 7 });
  assert.strictEqual(s.totalSeconds, minutes * 60, `${minutes} min scheduled ${s.totalSeconds}s`);
}

/* T2. The bug itself: the next round opens with a 5-minute run and only three
   minutes are left. It used to stop dead at 22.6 minutes of 25. */
{
  const s = tp.buildSchedule(CIRCUIT, { minutes: 25 });
  assert.strictEqual(s.totalSeconds, 25 * 60, `scheduled ${s.totalSeconds}s of 1500`);
  assert.strictEqual(s.rounds, 3, 'a third round has started');
  const last = works(s).pop();
  assert.strictEqual(last.exercise, 'Warm-up Run');
  assert.ok(last.seconds < 300, 'the last set is cut to the time left');
}

/* T3. Cut, not dropped: the third plank gets the minute that is left. */
{
  const items = [item('Plank', '90s', 'seconds')];
  const s = tp.buildSchedule(items, { minutes: 4, leadInSeconds: 0, transitions: false, seed: 1 });
  assert.deepStrictEqual(works(s).map(w => w.seconds), [90, 90, 60]);
}

/* T4. Too little left for a set worth starting: the set already running takes
   the leftover, rather than a few seconds of something new. */
{
  const items = [item('Plank', '60s', 'seconds')];
  const cfg = { leadInSeconds: 0, transitionSeconds: 10, seed: 1 };
  /* 120 s: 60, a 10 s gap, and a 50 s set is well worth starting. */
  assert.deepStrictEqual(works(tp.buildSchedule(items, { ...cfg, minutes: 2 })).map(w => w.seconds), [60, 50]);
  /* 75 s: 60, a 10 s gap, and only 5 s after it. */
  const crumbs = tp.buildSchedule(items, { ...cfg, minutes: 1.25 });
  assert.deepStrictEqual(works(crumbs).map(w => w.seconds), [75], 'never a 5-second set');
  assert.strictEqual(crumbs.totalSeconds, 75);
}

/* T5. The cool-down still closes the session and still comes out of the time. */
{
  const s = tp.buildSchedule(THREE, {
    minutes: 10, workSeconds: 40, seed: 2,
    warmup: true, cooldown: true, warmupItems: ['Cat-Cow'], cooldownItems: ['Hamstring Stretch'],
  });
  assert.strictEqual(s.totalSeconds, 600);
  assert.strictEqual(s.intervals[s.intervals.length - 1].kind, 'cooldown');
}

/* T6. Every set count still matches the intervals that index it. */
{
  const s = tp.buildSchedule(CIRCUIT, { minutes: 28 });
  CIRCUIT.forEach((_, e) => {
    const seen = works(s).filter(w => w.entryIndex === e).map(w => w.setIndex);
    assert.deepStrictEqual(seen, seen.map((_, i) => i), 'set indexes run 0..n');
    assert.strictEqual(seen.length, s.setsPerEntry[e]);
  });
}

/* ---------- a skip gives its time back ---------- */

/* T7. The seconds land at the end and nothing already played moves, shuffle
   included: live positions in the schedule stay valid. */
{
  const cfg = { minutes: 15, shuffle: true, seed: 42 };
  const before = tp.buildSchedule(CIRCUIT, cfg);
  const after = tp.giveTimeBack(before, 200);
  assert.strictEqual(after.totalSeconds, before.totalSeconds + 200);
  const keep = before.intervals.length - 1; // the last one may have been cut to fit
  assert.deepStrictEqual(after.intervals.slice(0, keep), before.intervals.slice(0, keep));
  assert.ok(after.workTotalSeconds > before.workTotalSeconds, 'the time became more work');
  after.setsPerEntry.forEach((n, i) => assert.ok(n >= before.setsPerEntry[i], 'set counts only ever grow'));
}

/* T8. Twice over adds up, and the cool-down stays last. */
{
  const cfg = { minutes: 10, seed: 3, cooldown: true, cooldownItems: ['Hamstring Stretch'] };
  const s = tp.giveTimeBack(tp.giveTimeBack(tp.buildSchedule(THREE, cfg), 45), 45);
  assert.strictEqual(s.totalSeconds, 600 + 90);
  assert.strictEqual(s.intervals[s.intervals.length - 1].kind, 'cooldown');
}

/* T8b. Skipping the set that was cut to fit: its time lands AFTER it, not back
   on the set you just left. 100 + 110 + 85 fills 295 s with the last plank cut
   to 75, so the 75 s skipped must all be there to play afterwards. */
{
  const s = tp.buildSchedule([item('Plank', '100s', 'seconds')], { minutes: 5 });
  const last = s.intervals.length - 1;
  assert.strictEqual(s.intervals[last].seconds, 75, 'fixture: the last plank is cut');
  const after = tp.giveTimeBack(s, 75, last);
  const played = after.intervals.slice(last + 1).reduce((n, i) => n + i.seconds, 0);
  assert.strictEqual(played, 75, `${played}s of the 75s skipped came back after the set`);
}

/* T9. Nothing to give back changes nothing. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5 });
  for (const v of [0, -5, NaN, undefined]) assert.strictEqual(tp.giveTimeBack(s, v), s);
}

/* ---------- the real screen ---------- */

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const CIRCUIT_PLAN = `## D (any)\n\n${CIRCUIT.map(c => `- ${c.exercise} | 1 x ${c.target}`).join('\n')}\n`;

async function circuit(planBody, guideMinutes, extra) {
  const b = await H.boot({
    planBody,
    exercises: [H.ex('Push-ups'), H.ex('Squats'), H.ex('Plank', { unit: 'seconds' }), H.ex('Warm-up Run', { unit: 'km' })],
    settings: Object.assign({
      soundMode: 'silent', guideMode: 'timed', guideMinutes, guideWarmup: false, guideCooldown: false, guideTransitions: true,
    }, extra || {}),
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const pos = b => b.ctx.state.session.timed;
const ivs = b => b.ctx.state.logDraft.timed.intervals;
const live = b => ivs(b)[pos(b).index];
const over = b => pos(b).index >= ivs(b).length;
const skipBtn = b => H.byLabel(H.page(b.ctx), 'Skip this interval') || H.byLabel(H.page(b.ctx), 'Skip ahead');

/* Play it out on the fake clock, skipping whatever `shouldSkip` says, and
   report how long the clock actually ran. */
function playOut(b, shouldSkip) {
  let ran = 0;
  for (let guard = 0; guard < 40000 && !over(b); guard++) {
    if (shouldSkip(live(b))) { H.click(skipBtn(b)); continue; }
    H.advance(200);
    ran += 0.2;
  }
  assert.ok(over(b), 'the circuit reached the end');
  return ran;
}

(async () => {
  await check('L1. skipping the repeat runs no longer ends a 30-minute circuit at 19 minutes', async () => {
    const b = await circuit(CIRCUIT_PLAN, 30);
    const ran = playOut(b, iv => iv.kind === 'work' && iv.exercise === 'Warm-up Run' && iv.round > 0);
    assert.ok(ran > 29 * 60, `the clock ran ${(ran / 60).toFixed(1)} min of 30`);
    assert.ok(ran <= 30 * 60 + 1, `and stopped on time, not after (${(ran / 60).toFixed(1)} min)`);
  });

  await check('L2. a skip part-way through hands back only what was left of it', async () => {
    const b = await circuit(CIRCUIT_PLAN, 10);
    while (!(live(b).kind === 'work' && live(b).exercise === 'Jump Squat')) H.advance(200);
    const before = b.ctx.state.logDraft.timed.totalSeconds;
    H.advance(15000);
    H.click(skipBtn(b));
    const given = b.ctx.state.logDraft.timed.totalSeconds - before;
    assert.ok(given >= 29 && given <= 31, `gave back ${given}s of a 45s set 15s in`);
  });

  await check('L3. skipping the very last interval carries on instead of ending the session', async () => {
    const b = await circuit('## D (any)\n\n- Plank | 1 x 100s\n', 5);
    while (pos(b).index < ivs(b).length - 1) H.advance(200);
    assert.ok(H.page(b.ctx).querySelector('.gv-timed-count'), 'fixture: on the last interval');
    const last = pos(b).index;
    H.click(skipBtn(b));
    assert.ok(!over(b), 'not finished: the time was not used');
    assert.strictEqual(pos(b).index, last + 1);
    assert.ok(H.page(b.ctx).querySelector('.gv-timed-count'), 'still on a running interval');
    const played = ivs(b).slice(last + 1).reduce((n, i) => n + i.seconds, 0);
    assert.ok(played >= 74, `${played}s of the 75s skipped came back after the set`);
  });

  await check('L4. sets added by a skip are real sets: they log like any other', async () => {
    const b = await circuit('## D (any)\n\n- Push-ups | 1 x 10\n- Squats | 1 x 12\n', 5);
    const draft = b.ctx.state.logDraft;
    const planned = draft.entries[0].sets.length;
    while (!(live(b).kind === 'work' && live(b).setIndex === 1)) H.advance(200);
    H.click(skipBtn(b));
    H.click(skipBtn(b));
    playOut(b, () => false);
    assert.strictEqual(ivs(b).filter(i => i.kind === 'work' && i.entryIndex === 0).length, draft.entries[0].sets.length,
      'one set for every interval of this exercise');
    assert.ok(draft.entries[0].sets.length > planned, 'the draft grew with the schedule');
    assert.ok(draft.entries[0].sets[draft.entries[0].sets.length - 1].done, 'the last one was played and ticked');
  });

  await check('L5. a run stays one entry however many times the circuit comes back to it', async () => {
    const b = await circuit(CIRCUIT_PLAN, 15);
    H.advance(10000);
    H.click(skipBtn(b));
    assert.strictEqual(b.ctx.state.logDraft.entries[0].sets.length, 1);
  });

  await check('L6. skipping the cool-down still ends the session: that is the point of it', async () => {
    const b = await circuit('## D (any)\n\n- Push-ups | 1 x 10\n', 5, { guideCooldown: true });
    const pool = ivs(b).filter(i => i.kind === 'cooldown');
    if (!pool.length) return; // no mobility notes in the fixture: nothing to skip
    while (live(b).kind !== 'cooldown') H.advance(200);
    const total = b.ctx.state.logDraft.timed.totalSeconds;
    H.click(skipBtn(b));
    assert.strictEqual(b.ctx.state.logDraft.timed.totalSeconds, total);
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of failed) console.error(`FAIL ${name}\n  ${e && e.message}`);
  if (failed.length) process.exit(1);
  console.log(`timed fills the clock OK (${results.length} live checks)`);
  process.exit(0);
})();
