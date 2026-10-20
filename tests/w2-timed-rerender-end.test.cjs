'use strict';
/* WAVE 2, item 4 (audit L3-09): A RE-RENDER THAT LANDS AS A TIMED INTERVAL ENDS.

   renderTimedInterval runs tick() once straight away and then registers the
   ticker. When the interval was already over (the screen was re-rendered after
   iOS froze the page for longer than the interval), that first tick() calls
   advanceTimed, which re-renders the NEXT interval - and the outer render then
   resumed and called setPageInterval(staleTick), replacing the new interval's
   ticker with one bound to the finished interval. The stale ticker used
   the finished interval's length (a 5 s transition), but read the NEW interval's
   clock - so the 45 s work interval that followed was cut off after 5 s, and the
   dial on screen (bound to nodes nobody updated any more) froze.

   Drives the REAL controller and the REAL guided circuit screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};
async function circuit() {
  const b = await H.boot({
    planBody: '## D (any)\n\n- Push-ups | 3 x 10\n- Plank | 1 x 30s\n',
    exercises: [H.ex('Push-ups'), H.ex('Plank', { unit: 'seconds' })],
    settings: { soundMode: 'silent', guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true },
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const tp = b => b.ctx.state.session.timed;
const ivs = b => b.ctx.state.logDraft.timed.intervals;

(async () => {
  await check('W2-4a. a re-render landing after the interval ended steps exactly one interval', async () => {
    const b = await circuit();
    H.advance(1000);
    const idx = tp(b).index;
    H.clock.now += (ivs(b)[idx].seconds + 5) * 1000;   // frozen page: the interval is long over, no tick has run
    b.ctx.rerender();
    assert.strictEqual(tp(b).index, idx + 1, `one overdue interval moved the circuit from ${idx} to ${tp(b).index}`);
  });

  await check('W2-4b. and the ticker left running belongs to the NEW interval: it neither cuts it short nor leaves the dial frozen', async () => {
    const b = await circuit();
    H.advance(1000);
    const idx = tp(b).index;
    H.clock.now += (ivs(b)[idx].seconds + 5) * 1000;
    b.ctx.rerender();
    const after = tp(b).index;
    const digits = () => H.page(b.ctx).querySelector('.gv-timed-count').textContent;
    const before = Number(digits());
    H.advance(7000);   // longer than the finished 5 s transition, far shorter than the 45 s work interval
    assert.strictEqual(tp(b).index, after, `a stale ticker advanced ${after} -> ${tp(b).index} 7 s into a 45 s interval`);
    assert.ok(Number(digits()) < before, `the dial on screen froze at ${digits()}`);
    assert.strictEqual(H.liveIntervals(), 1, 'exactly one ticker is running');
  });

  await check('W2-4c. control: an ordinary mid-interval re-render leaves the index alone and keeps ticking', async () => {
    const b = await circuit();
    H.advance(1000);
    const idx = tp(b).index;
    b.ctx.rerender();
    H.advance(1000);
    assert.strictEqual(tp(b).index, idx);
    assert.ok(H.liveIntervals() >= 1);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`w2 timed rerender end OK (${results.length} cases)`);
  process.exit(0);
})();
