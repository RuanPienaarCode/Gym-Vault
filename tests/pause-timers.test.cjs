'use strict';
/* PAUSE ON EVERY CLOCK THE USER MAY NEED TO STOP.

   Ruan, from his phone: "when user have a count down exercise there needs to
   be a pause button so if something happens user can pause and continue
   later". Only the timed circuit had one. A hold (a plank with a target) could
   only be stopped by finishing the set, and the rest between sets could only
   be skipped or waited out.

   THE CONTRACT these cases pin, on the REAL controller and the REAL guided
   screen (tests/live-session-harness.js, with its fake clock):
     - pause freezes the clock EXACTLY; paused time is never counted, so what
       the screen froze on is what the workout saves;
     - pausing a hold never completes the set — a tap on the zone while paused
       RESUMES (a stray tap must not save a half-set);
     - nothing the clock would have said is said while paused, and nothing is
       said in a burst on resume;
     - the target moment cannot fire while paused, and fires once after;
     - a paused screen survives a re-render and leaving the session;
     - finishing from paused records the frozen seconds;
     - the rest does not end, or advance, while paused; Next still works. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function guided(planBody, settings) {
  const b = await H.boot({ planBody, settings: Object.assign({ guideRestSeconds: 0 }, settings || {}) });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const q = (b, sel) => H.page(b.ctx).querySelector(sel);
const sess = b => b.ctx.state.session;
const pauseBtn = b => H.byLabel(H.page(b.ctx), 'Pause');
const resumeBtn = b => H.byLabel(H.page(b.ctx), 'Resume');
const zone = b => q(b, '.gv-session-zone');
/* What was actually SAID (enterGuided's unlock() speaks an empty utterance). */
const said = () => H.spoken().filter(Boolean);
const bodyLive = b => q(b, '.gv-session-body').children.find(c => c.matches('.gv-sr-only'));
const set = (b, e, s) => b.ctx.state.logDraft.entries[e].sets[s || 0];

/* Count-in over, hold running: advance to `secs` seconds into the hold. The
   hold's own start stamp is the reference, so "12 s" is exactly 12 s. */
function startHold(b) { H.advance(6000); assert.ok(sess(b).hold && sess(b).hold.running, 'fixture: the hold is running'); }
function holdTo(b, secs) {
  const h = sess(b).hold;
  H.advance(Math.max(0, h.startedAt + secs * 1000 - H.clock.now));
}
const PLANK = '## D (any)\n\n- Plank | 1 x 60s\n';
const PLANK2 = '## D (any)\n\n- Plank | 2 x 60s\n';

(async () => {
  /* ================= THE HOLD ================= */

  await check('H1. pause freezes the numeral: ninety seconds later it still reads 12s', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    assert.strictEqual(H.countText(b.ctx), '12s', 'fixture: 12 s on the clock');
    H.click(pauseBtn(b));
    assert.strictEqual(H.countText(b.ctx), '12s');
    H.advance(90000);
    assert.strictEqual(H.countText(b.ctx), '12s', 'ninety seconds paused did not move the clock');
    assert.ok(resumeBtn(b), 'the button now says Resume');
    assert.strictEqual(pauseBtn(b), undefined, 'and no longer says Pause');
  });

  await check('H2. resume continues from the same second (12 s + 8 s = 20 s, not 110 s)', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b)); H.advance(90000);
    H.click(resumeBtn(b));
    assert.strictEqual(H.countText(b.ctx), '12s', 'resuming does not reset it');
    H.advance(8000);
    assert.strictEqual(H.countText(b.ctx), '20s');
    assert.ok(pauseBtn(b), 'and the button says Pause again');
  });

  await check('H3. paused time is not in the saved seconds: stop after 12 + 90 paused + 8 saves 20', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b)); H.advance(90000); H.click(resumeBtn(b)); H.advance(8000);
    H.tapZone(zone(b));
    const s = set(b, 0);
    assert.strictEqual(String(s.seconds), '20', `saved seconds ${JSON.stringify(s.seconds)}`);
    assert.strictEqual(s.done, true);
  });

  await check('H4. a tap on the zone while paused RESUMES — it does not complete the set', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b)); H.advance(30000);
    H.tapZone(zone(b));
    const s = set(b, 0);
    assert.strictEqual(s.done, false, 'a stray tap on a paused hold must not save the set');
    assert.ok(!s.touched, 'nor touch it');
    assert.strictEqual(sess(b).hold.paused, false, 'it resumed');
    assert.strictEqual(sess(b).hold.running, true);
    assert.strictEqual(H.countText(b.ctx), '12s', 'from the frozen value');
    H.advance(3000);
    assert.strictEqual(H.countText(b.ctx), '15s');
    H.tapZone(zone(b));
    assert.strictEqual(String(set(b, 0).seconds), '15', 'the next tap is the normal stop');
  });

  await check('H5. Done from the paused hold records the FROZEN seconds and moves on', async () => {
    const b = await guided(PLANK2); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b)); H.advance(120000);
    const done = q(b, '.gv-hold-done');
    assert.ok(done, 'a paused hold offers a way to finish it');
    H.click(done);
    const s = set(b, 0, 0);
    assert.strictEqual(String(s.seconds), '12', `seconds ${JSON.stringify(s.seconds)} — the two minutes paused are not in it`);
    assert.strictEqual(s.done, true);
    assert.strictEqual(sess(b).pos.setIndex, 1, 'and the session moved on to set 2');
  });

  await check('H5b. Done is offered only while paused (a running hold stops by its zone, as before)', async () => {
    const b = await guided(PLANK); startHold(b);
    const done = q(b, '.gv-hold-done');
    assert.strictEqual(done.disabled, true, 'a running hold has no Done: its zone is the stop');
    assert.strictEqual(done.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(done.style._p.visibility, 'hidden');
    H.click(done);
    assert.strictEqual(set(b, 0).done, false, 'and a click on the hidden one does nothing');
    H.click(pauseBtn(b));
    assert.strictEqual(done.disabled, false);
    assert.strictEqual(done.getAttribute('aria-hidden'), null);
    assert.strictEqual(done.style._p.visibility, 'visible');
    H.click(resumeBtn(b));
    assert.strictEqual(done.disabled, true);
  });

  await check('H5c. the pause button never moves: Done sits beside it, with a hidden twin keeping it centred', async () => {
    const b = await guided(PLANK); startHold(b);
    const row = pauseBtn(b).parentNode;
    const kids = () => row.children.map(c => c.getAttribute('aria-label') || c.className.split(' ').pop());
    const before = kids();
    H.click(pauseBtn(b));
    const kidsPaused = kids();
    assert.strictEqual(row.children.length, 3);
    assert.strictEqual(row.children.indexOf(resumeBtn(b)), 1, 'the play button is the middle of three, paused or not');
    assert.strictEqual(before.indexOf('Pause'), kidsPaused.indexOf('Resume'), 'and it holds the same slot');
    const [left, , right] = row.children;
    assert.ok(left.classList.contains('gv-hold-spacer') && left.disabled && left.style._p.visibility === 'hidden');
    assert.ok(right.classList.contains('gv-hold-done'));
  });

  await check('H6. X -> Bank it from a paused hold saves the frozen seconds', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b)); H.advance(300000);
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    await H.modals.at(-1).opts.onSave();
    const plank = b.saved[0].rows.find(r => r.exercise === 'Plank');
    assert.strictEqual(String(plank.seconds), '12', `saved ${JSON.stringify(plank && plank.seconds)}`);
  });

  await check('H7. nothing is announced while paused, and nothing bursts on resume', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 14);
    const before = said().length;
    H.click(pauseBtn(b));
    assert.ok(H.speech.some(s => s.op === 'cancel' && s.t === H.clock.now), 'pausing cancels any in-flight speech');
    const spokenAtPause = said().length;
    H.advance(90000);                    // 15 s, 30 s, 45 s would all have passed on the wall clock
    assert.strictEqual(said().length, spokenAtPause, `spoke while paused: ${JSON.stringify(said().slice(before))}`);
    H.click(resumeBtn(b));
    H.advance(2000);                     // the clock is at 16 s: it crossed 15
    const after = said().slice(spokenAtPause);
    assert.deepStrictEqual(after, ['15'], `on resume it carries on from where it was: ${JSON.stringify(after)}`);
    H.advance(12000);                    // 28 s: not yet 30
    assert.deepStrictEqual(said().slice(spokenAtPause), ['15']);
    H.advance(3000);                     // 31 s
    assert.deepStrictEqual(said().slice(spokenAtPause), ['15', '30'], 'and 30 lands at 30, not early');
  });

  await check('H7b. the screen-reader checkpoint region is silent while paused too', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 14);
    H.click(pauseBtn(b));
    const live = bodyLive(b);
    H.advance(60000);
    assert.ok(!/held/.test(live.textContent), `checkpoint wrote while paused: ${JSON.stringify(live.textContent)}`);
  });

  await check('H8. the target moment cannot fire while paused, and fires ONCE after resume', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 20s\n'); startHold(b);
    holdTo(b, 18);
    H.click(pauseBtn(b)); H.advance(60000);
    assert.ok(!said().includes('target'), 'no target cue while paused');
    assert.notStrictEqual(sess(b).hold.targetHit, true);
    assert.notStrictEqual(zone(b).getAttribute('data-fill'), 'done', 'the stage stays where it was frozen');
    H.click(resumeBtn(b)); H.advance(3000);
    assert.strictEqual(said().filter(t => t === 'target').length, 1, 'fires once after resume');
    assert.strictEqual(zone(b).getAttribute('data-fill'), 'done');
    H.advance(20000);
    assert.strictEqual(said().filter(t => t === 'target').length, 1, 'and only once');
  });

  /* Move the clock on WITHOUT letting the tick see it: a pause that lands
     in the gap between the clock crossing a moment and the tick that would
     have announced it. That is the case a tick which forgets to check
     `paused` gets wrong — it finds the crossed moment while frozen. */
  const slipTo = (b, secs) => { H.clock.now = sess(b).hold.startedAt + secs * 1000; };

  await check('H7c. a pause between the clock crossing 15 s and the tick that would announce it says nothing, then says it once', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 14);
    slipTo(b, 15.3);                     // crossed 15 s; no tick has seen it
    H.click(pauseBtn(b));
    const n = said().length;
    H.advance(60000);
    assert.deepStrictEqual(said().slice(n), [], 'a paused clock must not announce a moment it crossed before the pause');
    H.click(resumeBtn(b)); H.advance(1500);
    assert.deepStrictEqual(said().slice(n), ['15'], 'it is said once, after resuming');
  });

  await check('H8b. a pause between the clock crossing the TARGET and the tick that would see it: no cue while paused, one after', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 20s\n'); startHold(b);
    holdTo(b, 19);
    slipTo(b, 20.3);
    H.click(pauseBtn(b));
    H.advance(60000);
    assert.ok(!said().includes('target'), 'the target moment cannot fire while paused');
    assert.notStrictEqual(sess(b).hold.targetHit, true);
    assert.ok(!(q(b, '.gv-rc-pu-label') || { classList: { contains: () => false } }).classList.contains('go'), 'and neither can the detonation');
    H.click(resumeBtn(b)); H.advance(2000);
    assert.strictEqual(said().filter(t => t === 'target').length, 1, 'it fires once after the resume');
  });

  await check('H9. a re-render keeps it paused, at the exact frozen value, and does not auto-resume', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b));
    b.ctx.rerender();
    assert.strictEqual(H.countText(b.ctx), '12s', 'the rebuilt screen shows the frozen value, not 0:00');
    assert.ok(resumeBtn(b), 'and still offers Resume');
    assert.ok(zone(b).classList.contains('gv-session-zone-live') === false, 'no live styling while paused');
    H.advance(60000);
    assert.strictEqual(H.countText(b.ctx), '12s');
    assert.strictEqual(sess(b).hold.paused, true, 'nothing resumed it');
    b.ctx.rerender(); b.ctx.rerender();
    H.advance(5000);
    assert.strictEqual(H.countText(b.ctx), '12s');
  });

  await check('H9b. a re-render of a RUNNING hold shows the running value at once, and stays live', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    b.ctx.rerender();
    assert.strictEqual(H.countText(b.ctx), '12s');
    assert.ok(zone(b).classList.contains('gv-session-zone-live'), 'a running hold keeps its live styling across a re-render');
    assert.ok(pauseBtn(b));
  });

  await check('H9c. a re-render of a paused hold keeps its stage (the fill the frozen value earned)', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 20s\n'); startHold(b);
    holdTo(b, 12);                                       // 60% of the target: past halfway
    H.click(pauseBtn(b));
    assert.strictEqual(zone(b).getAttribute('data-fill'), 'hot', 'fixture: the frozen value is on the hot stage');
    b.ctx.rerender();
    assert.strictEqual(zone(b).getAttribute('data-fill'), 'hot', 'a rebuilt zone must not fall back to idle');
    assert.strictEqual(zone(b).style._p['--gv-fill'], '0.6');
  });

  await check('H5d. the frozen numeral IS what Done records, even when the last tick was a moment earlier', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    /* Find a tick, then move the clock on WITHOUT firing the next one, to the
       point where the true elapsed rounds differently from what the last tick
       painted. Pausing there must paint the frozen figure at once. */
    const start = sess(b).hold.startedAt;
    let shown = H.countText(b.ctx);
    for (let i = 0; i < 40 && H.countText(b.ctx) === shown; i++) H.advance(50);
    shown = H.countText(b.ctx);
    let moved = 0, differs = false;
    while (moved < 900) {
      H.clock.now += 50; moved += 50;
      if (String(Math.round((H.clock.now - start) / 1000)) + 's' !== shown) { differs = true; break; }
    }
    assert.ok(differs, 'fixture: a moment where the tick lags the clock');
    H.click(pauseBtn(b));
    const frozen = H.countText(b.ctx);
    assert.notStrictEqual(frozen, shown, 'pausing repaints the numeral at once; it does not wait for a tick that will not draw');
    H.click(q(b, '.gv-hold-done'));
    assert.strictEqual(String(set(b, 0).seconds) + 's', frozen, 'and that is the figure Done saves');
  });

  await check('H10. leaving the session and coming back: a PAUSED hold is still paused at the same value', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b));
    b.ctx.nav('dashboard');
    H.advance(120000);
    b.ctx.enterGuided();
    assert.strictEqual(H.countText(b.ctx), '12s', 'the same frozen value');
    assert.ok(resumeBtn(b), 'still paused');
    assert.strictEqual(q(b, '.gv-rc-countin-label'), null, 'no count-in: the hold had already begun');
    H.advance(30000);
    assert.strictEqual(H.countText(b.ctx), '12s');
    H.click(resumeBtn(b)); H.advance(5000);
    assert.strictEqual(H.countText(b.ctx), '17s');
  });

  await check('H10b. leaving for the log overview and changing that set drops the stale pause', async () => {
    const b = await guided(PLANK2); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b));
    b.ctx.nav('dashboard');
    set(b, 0, 0).seconds = '40'; set(b, 0, 0).touched = true;   // the user logged set 1 by hand
    b.ctx.enterGuided();
    assert.strictEqual(sess(b).pos.setIndex, 1, 'fixture: it lands on set 2');
    assert.ok(!(sess(b).hold && sess(b).hold.paused), 'the pause belonged to set 1 and must not follow to set 2');
  });

  await check('H11. a RUNNING hold left behind behaves as it always did (starts over with a count-in)', async () => {
    const b = await guided(PLANK); startHold(b);
    holdTo(b, 12);
    b.ctx.nav('dashboard'); b.ctx.enterGuided();
    assert.ok(q(b, '.gv-rc-countin-label'), 'counted in again');
    assert.ok(!(sess(b).hold && sess(b).hold.running));
  });

  await check('H12. the pause button is inert until the hold has begun (during the count-in)', async () => {
    const b = await guided(PLANK);
    H.advance(1000);
    const btn = pauseBtn(b);
    assert.ok(btn, 'the button is on screen from the start');
    assert.strictEqual(btn.disabled, true, 'but there is nothing to pause yet');
    H.click(btn);
    assert.ok(!(sess(b).hold && sess(b).hold.paused));
  });

  await check('H13. skipping the set from a paused hold moves on and the next set starts clean', async () => {
    const b = await guided(PLANK2); startHold(b);
    holdTo(b, 12);
    H.click(pauseBtn(b));
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
    assert.strictEqual(sess(b).pos.setIndex, 1);
    assert.ok(!(sess(b).hold && sess(b).hold.paused), 'no pause carried to set 2');
    assert.ok(q(b, '.gv-rc-countin-label'), 'set 2 counts in');
    assert.ok(!set(b, 0, 0).done, 'skip records nothing, as it always did');
  });

  await check('H14. the controls: a labelled pause button, in the circuit\'s own control row, >= 44px', async () => {
    const b = await guided(PLANK); startHold(b);
    const btn = pauseBtn(b);
    assert.ok(btn.classList.contains('gv-timed-play'), 'the circuit\'s button, so every skin already styles it');
    assert.ok(btn.parentNode.classList.contains('gv-timed-controls'));
    assert.strictEqual(btn.getAttribute('type'), 'button');
    H.click(btn);
    assert.ok(q(b, '.gv-rc-hint').textContent.length > 0, 'a visible "Paused" line');
    assert.ok(/paused/i.test(q(b, '.gv-rc-hint').textContent));
    assert.strictEqual(q(b, '.gv-rc-hint').getAttribute('aria-live'), null, 'the visible line is not a second live region');
    H.click(resumeBtn(b));
    assert.strictEqual(q(b, '.gv-rc-hint').textContent.trim(), '', 'and it clears on resume');
  });

  await check('H15. Paused / Resumed are announced through the hold\'s existing polite region', async () => {
    const b = await guided(PLANK); startHold(b);
    const live = bodyLive(b);
    assert.strictEqual(live.getAttribute('aria-live'), 'polite');
    H.click(pauseBtn(b));
    assert.strictEqual(live.textContent, 'Paused');
    H.click(resumeBtn(b));
    assert.strictEqual(live.textContent, 'Resumed');
  });

  /* ================= THE REST ================= */
  const REST = '## D (any)\n\n- Push-ups | 2 x 10\n';
  async function resting(settings) {
    const b = await guided(REST, Object.assign({ guideRestSeconds: 10 }, settings || {}));
    H.advance(6000);
    const z = zone(b);
    for (let i = 0; i < 10; i++) { H.tapZone(z); H.advance(500); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(sess(b).phase, 'resting', 'fixture: resting');
    return b;
  }
  const restText = b => q(b, '.gv-session-rest-clock').textContent;

  await check('R1. pause freezes the remaining time and does not end or advance the rest', async () => {
    const b = await resting();
    H.advance(3000);
    assert.strictEqual(restText(b), '7s', 'fixture: 3 s into a 10 s rest');
    H.click(pauseBtn(b));
    H.advance(120000);                    // far past the rest's end
    assert.strictEqual(sess(b).phase, 'resting', 'a paused rest does not end');
    assert.strictEqual(sess(b).pos.setIndex, 0, 'and does not advance to the next set');
    assert.strictEqual(restText(b), '7s', 'it shows the frozen remaining time');
    assert.ok(resumeBtn(b));
  });

  await check('R2. resume continues: 7 s left, so it advances at 7 s and not before', async () => {
    const b = await resting();
    H.advance(3000);
    H.click(pauseBtn(b)); H.advance(120000);
    H.click(resumeBtn(b));
    assert.strictEqual(restText(b), '7s');
    H.advance(5000);
    assert.strictEqual(sess(b).phase, 'resting');
    assert.strictEqual(restText(b), '2s');
    H.advance(2100);
    assert.strictEqual(sess(b).phase, 'active', 'and then it moves on by itself');
    assert.strictEqual(sess(b).pos.setIndex, 1);
  });

  await check('R3. Next still works while paused', async () => {
    const b = await resting();
    H.click(pauseBtn(b));
    H.click(H.byText(H.page(b.ctx), 'Next'));
    assert.strictEqual(sess(b).phase, 'active');
    assert.strictEqual(sess(b).pos.setIndex, 1);
    assert.strictEqual(sess(b).rest, null, 'the paused clock does not follow into the next rest');
  });

  await check('R3b. the NEXT rest starts fresh and running, not paused', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 3 x 10\n', { guideRestSeconds: 10 });
    H.advance(6000);
    for (let i = 0; i < 10; i++) { H.tapZone(zone(b)); H.advance(500); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    H.click(pauseBtn(b)); H.click(H.byText(H.page(b.ctx), 'Next'));
    H.advance(6000);
    for (let i = 0; i < 10; i++) { H.tapZone(zone(b)); H.advance(500); }
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(restText(b), '10s');
    assert.ok(pauseBtn(b), 'running: offers Pause');
    H.advance(4000);
    assert.strictEqual(restText(b), '6s');
  });

  await check('R4. a re-render keeps a paused rest paused at the frozen value', async () => {
    const b = await resting();
    H.advance(3000); H.click(pauseBtn(b));
    b.ctx.rerender();
    assert.strictEqual(restText(b), '7s');
    assert.ok(resumeBtn(b));
    H.advance(60000);
    assert.strictEqual(sess(b).phase, 'resting');
    assert.strictEqual(restText(b), '7s');
  });

  await check('R5. leaving and coming back: a paused rest is still a paused rest at the same time', async () => {
    const b = await resting();
    H.advance(3000); H.click(pauseBtn(b));
    b.ctx.nav('dashboard'); H.advance(120000); b.ctx.enterGuided();
    assert.strictEqual(sess(b).phase, 'resting');
    assert.strictEqual(restText(b), '7s');
    assert.ok(resumeBtn(b));
    H.advance(60000);
    assert.strictEqual(restText(b), '7s');
    assert.strictEqual(q(b, '.gv-session-rest-nextset').textContent, 'Set 2/2', 'with the same next set named');
    H.click(resumeBtn(b)); H.advance(7100);
    assert.strictEqual(sess(b).phase, 'active');
  });

  await check('R8. a pause between the clock reaching zero and the tick that would end the rest: it does not end while paused', async () => {
    const b = await resting();
    H.advance(9000);
    H.clock.now += 600;                  // 9.6 s: rounds to the full 10 s, but no tick has seen it
    H.click(pauseBtn(b));
    H.advance(60000);
    assert.strictEqual(sess(b).phase, 'resting', 'a paused rest never ends by itself');
    assert.strictEqual(restText(b), '0s');
    H.click(resumeBtn(b)); H.advance(1100);
    assert.strictEqual(sess(b).phase, 'active', 'and it ends after the resume');
  });

  await check('R6. a RUNNING rest left behind behaves as it always did (the next set, no rest)', async () => {
    const b = await resting();
    H.advance(3000);
    b.ctx.nav('dashboard'); b.ctx.enterGuided();
    assert.strictEqual(sess(b).phase, 'active');
  });

  await check('R7. the rest\'s pause button: the circuit\'s control row, labelled, disabled never', async () => {
    const b = await resting();
    const btn = pauseBtn(b);
    assert.ok(btn.classList.contains('gv-timed-play'));
    assert.ok(btn.parentNode.classList.contains('gv-timed-controls'));
    assert.strictEqual(btn.disabled, false);
    H.click(btn);
    assert.ok(/paused/i.test(q(b, '.gv-rc-hint').textContent), 'a visible Paused line');
    H.click(resumeBtn(b));
    assert.strictEqual(q(b, '.gv-rc-hint').textContent.trim(), '');
  });

  /* ================= THE TIMED CIRCUIT (already had pause) ================= */
  async function circuit() {
    const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 2 x 10\n- Plank | 1 x 30s\n',
      settings: { guideMode: 'timed', guideMinutes: 5, guideWarmup: false, guideCooldown: false, guideTransitions: true } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    return b;
  }
  const digits = b => q(b, '.gv-timed-count').textContent;

  await check('C1. the circuit pause still freezes the digits and silences the count', async () => {
    const b = await circuit();
    H.advance(2000);
    assert.strictEqual(digits(b), '3');
    const spokenBefore = said().length;
    H.click(pauseBtn(b));
    H.advance(60000);
    assert.strictEqual(digits(b), '3');
    assert.strictEqual(said().length, spokenBefore, 'no count-back while paused');
    assert.strictEqual(sess(b).timed.index, 0, 'and the interval did not advance');
    H.click(resumeBtn(b)); H.advance(1000);
    assert.strictEqual(digits(b), '2', 'resumes from 3');
  });

  await check('C6. a pause between the clock reaching the 3-2-1 and the tick that would say it: nothing while paused', async () => {
    const b = await circuit();
    H.advance(1000);
    H.clock.now = sess(b).timed.startedAt + 2300;   // 2.7 s left: "3" is due, no tick has seen it
    H.click(pauseBtn(b));
    const n = said().length;
    H.advance(60000);
    assert.deepStrictEqual(said().slice(n), [], 'a paused circuit says nothing');
    H.click(resumeBtn(b)); H.advance(600);
    assert.deepStrictEqual(said().slice(n), ['3'], 'and says the count it owes once, after resuming');
  });

  await check('C2. the circuit shows a visible Paused line, and keeps it across re-renders', async () => {
    const b = await circuit();
    H.advance(2000);
    assert.strictEqual(q(b, '.gv-rc-hint').textContent.trim(), '');
    H.click(pauseBtn(b));
    assert.ok(/paused/i.test(q(b, '.gv-rc-hint').textContent));
    b.ctx.rerender();
    assert.ok(/paused/i.test(q(b, '.gv-rc-hint').textContent));
    assert.strictEqual(digits(b), '3');
    H.click(resumeBtn(b));
    assert.strictEqual(q(b, '.gv-rc-hint').textContent.trim(), '');
  });

  await check('C5. Paused / Resumed reach the circuit\'s own live region, once each', async () => {
    const b = await circuit();
    H.advance(2000);
    const live = () => H.page(b.ctx).querySelectorAll('.gv-sr-only').find(n => n.getAttribute('aria-live') === 'assertive');
    H.click(pauseBtn(b));
    assert.strictEqual(live().textContent, 'Paused');
    b.ctx.rerender();
    assert.notStrictEqual(live().textContent, 'Paused', 'a plain re-render must not announce it again');
    H.click(resumeBtn(b));
    assert.strictEqual(live().textContent, 'Resumed');
  });

  await check('C3. leaving and coming back: a paused circuit is still paused on the same digits', async () => {
    const b = await circuit();
    H.advance(2000);
    H.click(pauseBtn(b));
    b.ctx.nav('dashboard'); H.advance(90000); b.ctx.enterGuided();
    assert.strictEqual(digits(b), '3');
    assert.ok(resumeBtn(b), 'still paused');
    H.advance(30000);
    assert.strictEqual(digits(b), '3');
    assert.strictEqual(sess(b).timed.index, 0);
    H.click(resumeBtn(b)); H.advance(1000);
    assert.strictEqual(digits(b), '2');
  });

  await check('C4. the circuit does not re-announce its interval on return from a pause', async () => {
    const b = await circuit();
    H.advance(2000); H.click(pauseBtn(b));
    const n = said().length;
    b.ctx.nav('dashboard'); b.ctx.enterGuided();
    assert.strictEqual(said().length, n, 'nothing said on return');
  });

  /* ================= THE LOOK (no page is rendered here: the shape of the CSS) ================= */
  await check('S1. every pause button is the circuit\'s own, >= 44px, in every width', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const dims = [...css.matchAll(/(?:^|\})\s*([^{}@]*\.gv-timed-play\s*)\{([^}]*)\}/g)]
      .map(m => ({ w: (m[2].match(/(?:^|[;\s])width:\s*(\d+)px/) || [])[1], h: (m[2].match(/(?:^|[;\s])height:\s*(\d+)px/) || [])[1] }))
      .filter(d => d.w && d.h);
    assert.ok(dims.length >= 2, 'the desktop and the phone sizes are both declared');
    for (const d of dims) assert.ok(+d.w >= 44 && +d.h >= 44, `a ${d.w}x${d.h} pause button is under the 44px touch box`);
  });

  await check('S2. the circuit\'s Paused line costs no height: it is in the ring, absolutely placed, token-only', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const raw = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    const m = raw.match(/\/\* PAUSED TIMERS\.[\s\S]*?\*\/\s*([^{}]*\.gv-timed-dial \.gv-rc-hint)\s*\{([^}]*)\}/);
    assert.ok(m, 'the delimited block exists');
    assert.ok(/position:\s*absolute/.test(m[2]), 'out of flow, or the controls move when it fills (and slide off a small phone)');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|color-mix|:has\(|dvh|@property|clip-path/.test(m[2]), 'tokens only, and nothing the iOS 15 floor lacks');
    const b = await circuit(); H.advance(2000); H.click(pauseBtn(b));
    const dial = q(b, '.gv-timed-dial');
    assert.ok(dial.children.some(c => c.matches('.gv-rc-hint')), 'the line is a child of the dial');
  });

  await check('R9. the rest\'s Paused line is a polite live region, present before it speaks, and it speaks on pause', async () => {
    const b = await resting();
    const line = q(b, '.gv-rc-hint');
    assert.ok(line, 'fixture: the rest has its hint line');
    assert.strictEqual(line.getAttribute('aria-live'), 'polite', 'a screen-reader user hears the pause (the circuit\'s and the hold\'s already do)');
    assert.strictEqual(line.getAttribute('aria-atomic'), 'true');
    assert.notStrictEqual(line.getAttribute('aria-live'), 'assertive', 'a pause must not interrupt');
    assert.strictEqual(line.textContent.trim(), '', 'it is in the page, silent, before the pause (a region filled on creation is not announced)');
    H.click(pauseBtn(b));
    assert.ok(line === q(b, '.gv-rc-hint'), 'the SAME node is updated in place, or the region would be re-created and not announced');
    assert.strictEqual(line.textContent, 'Paused');
    H.click(resumeBtn(b));
    assert.strictEqual(line.textContent.trim(), '');
  });

  /* ---- report ---- */
  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`pause timers OK (${results.length} cases)`);
})();
