'use strict';
/* FIX WAVE F2, item 8 (audit L3-06 + L3-07 + M-04): THE CALL SITES.

   tests/f2-sound-queue.test.cjs pins the rule inside sound.js. This pins that the
   screens actually use it, on the REAL controller and the REAL guided screen
   (tests/live-session-harness.js, fake clock, recording speech):

   L3-06  "target" is spoken on the rep that meets a reps target and on the second
          a hold reaches its target - in the same tick as the count, which used to
          cut it - and "new record" survives a timed interval handing over to the
          next one (advanceTimed cancelled it, then the next cue cut it again).
   L3-07  The freestyle counter's count-in got `muted: this.muted`, a boolean
          copied when the count-in began, so Mute pressed during it changed
          nothing. It is a function now (countdown.js reads it live).
   M-04   iOS lets this page speak only after a speech call made inside a real
          tap. Pause, Resume and Tick are taps the session depends on being able
          to talk after, so each calls the idempotent sound.unlock(). */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  H.notices.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function start(planBody, extra) {
  const b = await H.boot(Object.assign({ planBody, settings: { soundMode: 'voice', guideRestSeconds: 10 } }, extra || {}));
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const sess = b => b.ctx.state.session;
const zone = b => H.page(b.ctx).querySelector('.gv-session-zone');
const ops = () => H.speech.filter(s => s.op === 'cancel' || (s.op === 'speak' && s.text !== ''));
/* Was `text` spoken, and did no cancel follow it before something else was? */
function spokenUncut(text) {
  const list = ops();
  const i = list.findIndex(s => s.op === 'speak' && s.text === text);
  if (i < 0) return false;
  const next = list[i + 1];
  return !(next && next.op === 'cancel');
}
const unlocked = () => H.speech.some(s => s.op === 'speak' && s.text === '');

(async () => {
  await check('F2-8i. reps: the rep that meets the target speaks "target", uncut, and the count follows it', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 1 x 3\n');
    H.advance(6000);
    for (let i = 0; i < 3; i++) { H.tapZone(zone(b)); H.advance(1000); }
    assert.ok(H.speech.some(s => s.op === 'speak' && s.text === 'target'), 'fixture: the cue was sent');
    assert.ok(spokenUncut('target'), `"target" was cancelled the moment it was spoken: ${JSON.stringify(ops().map(o => o.op === 'cancel' ? '(cancel)' : o.text))}`);
  });

  await check('F2-8j. hold: the second the clock reaches the target speaks "target", uncut (it shares a tick with the 30 s checkpoint)', async () => {
    const b = await start('## D (any)\n\n- Plank | 1 x 30s\n');
    H.advance(6000);
    const h = sess(b).hold;
    H.advance(Math.max(0, h.startedAt + 31000 - H.clock.now));
    assert.ok(H.speech.some(s => s.op === 'speak' && s.text === 'target'), 'fixture: the cue was sent');
    assert.ok(spokenUncut('target'), `"target" was cut by the 30 s checkpoint: ${JSON.stringify(ops().map(o => o.op === 'cancel' ? '(cancel)' : o.text))}`);
  });

  await check('F2-8k. timed: "new record" survives the interval handing over to the next one', async () => {
    const b = await start('## D (any)\n\n- Plank | 2 x 60s\n', {
      settings: { soundMode: 'voice', guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true },
    });
    /* get to the first work interval, then type a held time that beats the 40 s best */
    const ivs = b.ctx.state.logDraft.timed.intervals;
    let guard = 0;
    while (guard++ < 5000 && !(sess(b).timed.index >= 0 && ivs[sess(b).timed.index].kind === 'work')) H.advance(200);
    const box = H.page(b.ctx).querySelector('.gv-timed-input');
    assert.ok(box, 'fixture: the seconds box');
    box.value = '55'; H.fire(box, 'input');
    H.speech.length = 0;
    const idx = sess(b).timed.index;
    guard = 0;
    while (guard++ < 5000 && sess(b).timed.index === idx) H.advance(200);
    assert.ok(H.speech.some(s => s.op === 'speak' && s.text === 'new record'), 'fixture: the record cue was sent');
    assert.ok(spokenUncut('new record'), `"new record" was cancelled: ${JSON.stringify(ops().map(o => o.op === 'cancel' ? '(cancel)' : o.text))}`);
  });

  await check('F2-8l. mute pressed DURING the freestyle counter\'s count-in silences it (muted is read live)', async () => {
    const { RepCounterModal } = require('../src/rep-counter-modal');
    const app = {};
    const modal = new RepCounterModal(app, { exerciseName: 'Push-ups', settings: { soundMode: 'voice' } });
    modal.open();
    const just = modal.contentEl.querySelectorAll('button').find(x => /Just count/.test(x.textContent));
    assert.ok(just, 'fixture: the target step');
    H.click(just);
    H.advance(1000);
    H.speech.length = 0;
    H.click(H.byLabel(modal.contentEl, 'Mute count-back'));
    H.advance(8000);
    const heard = H.speech.filter(s => s.op === 'speak' && s.text !== '').map(s => s.text);
    assert.deepStrictEqual(heard, [], `the muted count-in kept speaking: ${JSON.stringify(heard)}`);
    modal.close();
  });

  await check('F2-8m. M-04: Pause and Resume on a hold are gestures that unlock audio', async () => {
    const b = await start('## D (any)\n\n- Plank | 1 x 60s\n');
    H.advance(6000); H.advance(5000);
    H.speech.length = 0;
    H.click(H.byLabel(H.page(b.ctx), 'Pause'));
    assert.ok(unlocked(), 'Pause did not call sound.unlock()');
    H.speech.length = 0;
    H.click(H.byLabel(H.page(b.ctx), 'Resume'));
    assert.ok(unlocked(), 'Resume did not call sound.unlock()');
  });

  await check('F2-8n. M-04: Pause on the rest and on a circuit unlock audio too', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(6000);
    for (let i = 0; i < 4; i++) { H.tapZone(zone(b)); H.advance(1000); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(sess(b).phase, 'resting', 'fixture: resting');
    H.speech.length = 0;
    H.click(H.byLabel(H.page(b.ctx), 'Pause'));
    assert.ok(unlocked(), 'Pause on the rest did not call sound.unlock()');
    H.killProcess(); H.speech.length = 0;
    const c = await start('## D (any)\n\n- Push-ups | 2 x 10\n', { settings: { soundMode: 'voice', guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true } });
    H.advance(1000); H.speech.length = 0;
    H.click(H.byLabel(H.page(c.ctx), 'Pause'));
    assert.ok(unlocked(), 'Pause on the circuit did not call sound.unlock()');
    H.speech.length = 0;
    H.click(H.byLabel(H.page(c.ctx), 'Resume'));
    assert.ok(unlocked(), 'Resume on the circuit did not call sound.unlock()');
  });

  await check('F2-8o. M-04: Tick set is a gesture that unlocks audio', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(6000);
    for (let i = 0; i < 3; i++) { H.tapZone(zone(b)); H.advance(1000); }
    H.speech.length = 0;
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.ok(unlocked(), 'Tick set did not call sound.unlock()');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 cue sites OK (${results.length} cases)`);
  process.exit(0);
})();
