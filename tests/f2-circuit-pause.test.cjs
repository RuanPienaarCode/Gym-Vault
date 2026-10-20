'use strict';
/* FIX WAVE F2, item 1 (audit C-04 + L3-11): a PAUSED CIRCUIT.

   C-04. restorePaused only put a paused circuit back when the fresh session
   landed on the very interval that was paused. timed-plan.initialIndex lands
   on the TRANSITION before an unfinished work interval, so a circuit paused on
   interval 3 (a work interval, after the transition at 2) came back RUNNING on
   the transition and the frozen seconds were gone. Only interval 0 worked,
   which is the only one the old guard covered.

   L3-11. Skip / Previous while paused restarted a running clock on the new
   interval: a pause is "stop everything", and one tap of an arrow undid it.

   Drives the REAL controller and the REAL guided screen (tests/live-session-
   harness.js: fake clock, recording speech). */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const PLAN = '## D (any)\n\n- Push-ups | 2 x 10\n- Plank | 1 x 30s\n';
async function circuit() {
  const b = await H.boot({
    planBody: PLAN,
    settings: { soundMode: 'silent', guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true },
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const tp = b => b.ctx.state.session.timed;
const q = (b, sel) => H.page(b.ctx).querySelector(sel);
const digits = b => q(b, '.gv-timed-count').textContent;
const pauseBtn = b => H.byLabel(H.page(b.ctx), 'Pause');
const resumeBtn = b => H.byLabel(H.page(b.ctx), 'Resume');
const ivs = b => b.ctx.state.logDraft.timed.intervals;
/* Run the clock until `index` is the live interval, then 3 s into it. */
function runToWork(b, minIndex) {
  let guard = 0;
  while (guard++ < 5000 && !(tp(b).index >= minIndex && ivs(b)[tp(b).index].kind === 'work')) H.advance(200);
  H.advance(3000);
}

(async () => {
  await check('F2-1a. a circuit paused on a LATER work interval comes back paused on that interval, same seconds', async () => {
    const b = await circuit();
    runToWork(b, 3);
    const idx = tp(b).index;
    assert.strictEqual(ivs(b)[idx].kind, 'work', 'fixture: paused on a work interval');
    H.click(pauseBtn(b));
    const frozen = digits(b);
    b.ctx.nav('dashboard'); H.advance(90000); b.ctx.enterGuided();
    assert.strictEqual(tp(b).index, idx, `back on interval ${idx}, not the transition before it`);
    assert.strictEqual(tp(b).paused, true, 'still paused');
    assert.strictEqual(digits(b), frozen, 'the frozen seconds survived the trip');
    assert.ok(resumeBtn(b), 'and the button says Resume');
    H.advance(5000);
    assert.strictEqual(digits(b), frozen, 'nothing moves while it stays paused');
  });

  await check('F2-1b. a pause on interval 0 still comes back (the case the old guard covered)', async () => {
    const b = await circuit();
    H.advance(2000); H.click(pauseBtn(b));
    const frozen = digits(b);
    b.ctx.nav('dashboard'); H.advance(60000); b.ctx.enterGuided();
    assert.strictEqual(tp(b).index, 0);
    assert.strictEqual(tp(b).paused, true);
    assert.strictEqual(digits(b), frozen);
  });

  await check('F2-1c. a pause on an interval whose set was since logged by hand is NOT put back on it', async () => {
    const b = await circuit();
    runToWork(b, 3);
    const idx = tp(b).index;
    const iv = ivs(b)[idx];
    H.click(pauseBtn(b));
    b.ctx.nav('dashboard');
    const set = b.ctx.state.logDraft.entries[iv.entryIndex].sets[iv.setIndex];
    set.done = true; set.touched = true; set.reps = '10'; set.seconds = '30';
    b.ctx.enterGuided();
    assert.notStrictEqual(tp(b).index, idx, 'that set is handled; the session moves on, as it always did');
    assert.strictEqual(tp(b).paused, false, 'and nothing stale is frozen on the wrong interval');
  });

  await check('F2-1d. Skip while paused leaves the clock PAUSED on the next interval (c-pause-skip.cjs)', async () => {
    const b = await circuit();
    H.advance(2000); H.click(pauseBtn(b));
    const from = tp(b).index;
    H.click(H.byLabel(H.page(b.ctx), 'Skip ahead'));
    assert.strictEqual(tp(b).index, from + 1, 'fixture: it moved on');
    assert.strictEqual(tp(b).paused, true, 'still paused');
    const shown = digits(b);
    H.advance(20000);
    assert.strictEqual(digits(b), shown, 'twenty seconds later the new interval has not started counting');
    assert.ok(resumeBtn(b), 'Resume is offered');
    H.click(resumeBtn(b));
    H.advance(1000);
    assert.notStrictEqual(digits(b), shown, 'and Resume starts it');
  });

  await check('F2-1e. Previous while paused stays paused too; a running clock still restarts on Skip (unchanged)', async () => {
    const b = await circuit();
    H.advance(2000); H.click(H.byLabel(H.page(b.ctx), 'Skip ahead'));   // running -> index 1, running
    assert.strictEqual(tp(b).paused, false, 'a running clock skips onto a RUNNING interval, as before');
    H.advance(1000); H.click(pauseBtn(b));
    H.click(H.byLabel(H.page(b.ctx), 'Previous interval'));
    assert.strictEqual(tp(b).index, 0);
    assert.strictEqual(tp(b).paused, true);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 circuit pause OK (${results.length} cases)`);
})();
