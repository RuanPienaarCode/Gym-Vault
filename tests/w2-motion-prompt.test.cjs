'use strict';
/* WAVE 2, items 5 (audit L3-10 + L3-13): THE iOS MOTION-PERMISSION PROMPT.

   L3-10. Tapping the motion toggle starts startMotionCounter, whose promise
   stays pending while iOS shows its prompt. A re-render in that window found
   motion "on" with no live subscription (sess.stopMotion is only set when the
   promise resolves) and began a SECOND start: two permission requests, and when
   both resolved two devicemotion listeners, each calling a rep into a different
   render's counter - every rep counted twice, one of them into a detached screen.

   L3-13. The toggle wrote "Asking for the motion sensor..." into the hint line,
   but the 'listening' status returned early and nothing wrote it back, so the
   line kept asking after the answer was in.

   Now ONE start serves the exercise however many renders pass while it is
   pending (the newest render receives the answer), and the hint settles on
   every outcome. Drives the REAL controller and the REAL guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.setMotionPermission(null);
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const COUNTING = 'Counting your movement — taps still work';
const ASKING = 'Asking for the motion sensor…';
const PLAN = '## D (any)\n\n- Push-ups | 2 x 10\n';

async function session() {
  const b = await H.boot({ planBody: PLAN, settings: { guideRestSeconds: 0, soundMode: 'silent' }, exercises: [H.ex('Push-ups')] });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  await H.flush();
  H.advance(6000);                                     // the 5 s count-in is over: it rewrites the hint line when it hands over
  return b;
}
const hint = b => { const n = H.page(b.ctx).querySelector('.gv-rc-hint'); return n ? n.textContent : null; };
function motionBtn(b) {
  if (!H.page(b.ctx).querySelector('.gv-cs')) H.click(H.byLabel(H.page(b.ctx), 'Counter settings'));
  return H.page(b.ctx).querySelectorAll('button').find(x => /movement|No motion sensor/.test(x.getAttribute('aria-label') || ''));
}
const pulse = () => { if (H.motionListeners()) H.emitMotion(9.8); };
/* One permission model for the file: the first request stays pending (the prompt
   is open); `release(answer)` answers it. Every request is counted. */
function pending() {
  const m = { calls: 0 };
  const first = new Promise(r => { m.release = r; });
  H.setMotionPermission(() => (++m.calls === 1 ? first : Promise.resolve('granted')));
  return m;
}

(async () => {
  await check('W2-5a. a re-render while the prompt is open does not ask for permission again', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    assert.strictEqual(m.calls, 1, 'fixture: one request for the tap');
    b.ctx.rerender();                                   // anything that re-renders: a mute toggle, a vault sync
    m.release('granted'); await H.flush(); await H.flush();
    pulse(); H.advance(6000); await H.flush();
    assert.strictEqual(m.calls, 1, `the re-render asked for permission again (${m.calls} requests)`);
  });

  await check('W2-5a2. a re-render while the prompt is open leaves ONE devicemotion listener', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    assert.strictEqual(m.calls, 1, 'fixture: one request for the tap');
    b.ctx.rerender();                                   // anything that re-renders: a mute toggle, a vault sync
    m.release('granted'); await H.flush(); await H.flush();
    pulse(); H.advance(6000); await H.flush();
    assert.strictEqual(H.motionListeners(), 1, `${H.motionListeners()} devicemotion listeners - every rep would count that many times`);
  });

  await check('W2-5b. the answer lands on the screen that is showing: the hint settles to Counting there', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    b.ctx.rerender();
    m.release('granted'); await H.flush(); await H.flush();
    pulse(); H.advance(6000); await H.flush();
    assert.strictEqual(hint(b), COUNTING, `hint on the current screen: "${hint(b)}"`);
  });

  await check('W2-5c. without any re-render, a granted answer replaces "Asking for the motion sensor..."', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    assert.strictEqual(hint(b), ASKING, 'fixture: the toggle says it is asking');
    m.release('granted'); await H.flush(); await H.flush();
    pulse(); H.advance(6000); await H.flush();
    assert.strictEqual(hint(b), COUNTING, `hint still reads "${hint(b)}" after the sensor answered`);
    assert.strictEqual(H.motionListeners(), 1);
  });

  await check('W2-5d. a declined answer stops asking too (and says so in a notice)', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    m.release('denied'); await H.flush(); await H.flush();
    assert.notStrictEqual(hint(b), ASKING, 'still asking after a decline');
    assert.strictEqual(motionBtn(b).getAttribute('aria-pressed'), 'false');
    assert.strictEqual(H.motionListeners(), 0);
    assert.ok(H.notices.some(n => /motion/i.test(n)), 'a notice says it was declined');
  });

  await check('W2-5d2. a decline that arrives after a re-render still switches motion off and says so', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    b.ctx.rerender();
    m.release('denied'); await H.flush(); await H.flush();
    assert.strictEqual(motionBtn(b).getAttribute('aria-pressed'), 'false', 'still showing motion on after a decline');
    assert.notStrictEqual(hint(b), ASKING);
    assert.strictEqual(H.motionListeners(), 0);
    assert.ok(H.notices.some(n => /motion/i.test(n)), 'the tap that asked is still told it was declined');
  });

  await check('W2-5e. granted but a silent sensor: the line stops asking (it ends on the no-sensor copy)', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    m.release('granted'); await H.flush(); await H.flush();
    H.advance(3000); await H.flush();                   // no sample ever arrives
    assert.notStrictEqual(hint(b), ASKING, 'still asking after the sensor stayed silent');
    assert.strictEqual(motionBtn(b).getAttribute('aria-pressed'), 'false');
  });

  await check('W2-5f. control: no re-render, one tap, one request, one listener', async () => {
    const m = pending();
    const b = await session();
    H.click(motionBtn(b));
    m.release('granted'); await H.flush(); await H.flush();
    pulse(); H.advance(6000); await H.flush();
    assert.strictEqual(m.calls, 1);
    assert.strictEqual(H.motionListeners(), 1);
  });

  const failed = results.filter(r => r[1]);
  for (const [name, e] of results) console.log(`  ${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n').join('\n       ')}` : ''}`);
  if (failed.length) { console.log(`w2 motion prompt: ${failed.length} of ${results.length} FAILED`); process.exit(1); }
  console.log(`w2 motion prompt OK (${results.length} checks)`);
  process.exit(0);
})();
