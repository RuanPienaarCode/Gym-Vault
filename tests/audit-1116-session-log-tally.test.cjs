'use strict';
/* AUDIT 16 NOV 2026, finding #49: THE LOG'S SETS / REPS TALLY DID NOT UPDATE AS
   FIGURES WERE TYPED.

   The tally was computed once per render. A typed figure changes the draft in place
   and must NOT re-render (the input would lose focus), so the tally stayed stale
   until the next re-draw although the row already counted and saved. It is repainted
   in place now - the two text nodes - and never by ctx.rerender().

   Drives the real controller and log page. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
async function log(planBody) {
  const b = await H.boot({ planBody: planBody || '## D (any)\n\n- Push-ups | 2 x 10\n', exercises: [H.ex('Push-ups'), H.ex('Bench Press', { unit: 'kg' })], settings: { soundMode: 'silent' } });
  const plan = b.ctx.activePlan(); b.ctx.startLog(plan, plan.model.days[0]);
  b.rerenders = 0;
  const orig = b.ctx.rerender;
  b.ctx.rerender = (...a) => { b.rerenders++; return orig.apply(b.ctx, a); };
  return b;
}
const tally = b => { const bs = H.page(b.ctx).querySelector('.gv-log-tally').querySelectorAll('b'); return { sets: bs[0].textContent, reps: bs[1].textContent }; };
const repsBox = (b, i) => H.page(b.ctx).querySelectorAll('input').filter(x => /^Reps/.test(x.getAttribute('aria-label') || ''))[i];
const type = (input, v) => { input.value = v; H.fire(input, 'input'); };

(async () => {
  await check('L1. typing reps updates the tally in place, with no re-render', async () => {
    const b = await log();
    assert.deepStrictEqual(tally(b), { sets: '0', reps: '0' }, 'fixture: nothing logged yet');
    type(repsBox(b, 0), '12');
    assert.deepStrictEqual(tally(b), { sets: '1', reps: '12' }, `after typing 12: ${JSON.stringify(tally(b))}`);
    type(repsBox(b, 0), '15');
    assert.deepStrictEqual(tally(b), { sets: '1', reps: '15' });
    type(repsBox(b, 1), '8');
    assert.deepStrictEqual(tally(b), { sets: '2', reps: '23' });
    assert.strictEqual(b.rerenders, 0, 'the tally was refreshed by re-rendering the page');
  });

  await check('L2. clearing the figure takes the set back out of the tally', async () => {
    const b = await log();
    type(repsBox(b, 0), '12');
    type(repsBox(b, 0), '');
    assert.deepStrictEqual(tally(b), { sets: '0', reps: '0' });
  });

  await check('L3. the tally agrees with what the note would save (typed weight on a weighted row counts as a set)', async () => {
    const b = await log('## D (any)\n\n- Bench Press | 2 x 8 @ 60kg\n');
    const w = H.page(b.ctx).querySelectorAll('input').filter(x => /^Weight/.test(x.getAttribute('aria-label') || ''))[0];
    type(w, '62.5');
    const { buildRows } = require('../src/page-log.js');
    assert.strictEqual(tally(b).sets, String(buildRows(b.ctx.state.logDraft).length));
    assert.strictEqual(b.rerenders, 0);
  });

  await check('L4. control: ticking a set still re-renders and shows the right tally', async () => {
    const b = await log();
    H.click(H.page(b.ctx).querySelectorAll('button').filter(x => x.getAttribute('aria-label') === 'Mark done')[0]);
    assert.deepStrictEqual(tally(b), { sets: '1', reps: '10' });
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1116 session log tally OK (${results.length} cases)`);
  process.exit(0);
})();
