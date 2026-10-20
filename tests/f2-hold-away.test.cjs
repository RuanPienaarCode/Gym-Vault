'use strict';
/* FIX WAVE F2, item 7 (audit B-hold-away): A HOLD LEFT RUNNING IN THE BACKGROUND
   IS NOT A PERSONAL BEST.

   The hold's stopwatch is derived from wall-clock time, so a plank started and
   then forgotten while the app sat in the background (the Music button, a call, a
   locked phone) read an hour when the user came back and tapped to stop - and
   the screen watched that "hold" (observed: ['seconds']) and announced a NEW
   BEST. The seconds are still saved - they are what the clock says, and the user
   can fix them in the log - but a hold that was out of sight is not a figure the
   stopwatch observed, so it can no longer claim a record.

   Drives the REAL controller and the REAL guided screen (tests/live-session-
   harness.js). */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  H.notices.length = 0;
  H.document.visibilityState = 'visible';
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const PLANK = '## D (any)\n\n- Plank | 2 x 60s\n';   // history best: 40 s
async function start() {
  const b = await H.boot({ planBody: PLANK, settings: { soundMode: 'silent', guideRestSeconds: 0 } });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const sess = b => b.ctx.state.session;
const zone = b => H.page(b.ctx).querySelector('.gv-session-zone');
const sets = b => b.ctx.state.logDraft.entries[0].sets;
const setHidden = hidden => {
  H.document.visibilityState = hidden ? 'hidden' : 'visible';
  for (const fn of (H.docListeners.visibilitychange || []).slice()) fn();
};

(async () => {
  await check('F2-7a. a hold left running while the app was hidden: seconds saved, but no NEW BEST', async () => {
    const b = await start();
    H.advance(6000);
    assert.ok(sess(b).hold && sess(b).hold.running, 'fixture: the hold is running');
    H.advance(5000);
    setHidden(true);
    H.advance(60 * 60 * 1000);            // an hour in the background
    setHidden(false);
    H.tapZone(zone(b));                    // back, tap to stop
    assert.strictEqual(sets(b)[0].done, true);
    assert.ok(parseFloat(sets(b)[0].seconds) >= 3600, `the seconds are still saved: ${sets(b)[0].seconds}`);
    const rec = (sess(b).records || []).length;
    assert.strictEqual(rec, 0, `an hour in the background claimed ${rec} record(s)`);
    assert.ok(!H.notices.some(n => /NEW BEST/.test(n)) && !(sess(b).pendingCallouts || []).some(n => /NEW BEST/.test(n)), 'and announced none');
  });

  await check('F2-7b. control: the same hold with the app in view the whole time still claims', async () => {
    const b = await start();
    H.advance(6000);
    H.advance(55000);
    H.tapZone(zone(b));
    assert.strictEqual((sess(b).records || []).length, 1, 'a 55 s plank against a 40 s best is a record');
  });

  await check('F2-7c. backgrounded DURING THE COUNT-IN (before the hold began) does not taint the hold', async () => {
    const b = await start();
    H.advance(1500);
    setHidden(true); H.advance(500); setHidden(false);
    H.advance(6000);
    assert.ok(sess(b).hold.running);
    H.advance(55000);
    H.tapZone(zone(b));
    assert.strictEqual((sess(b).records || []).length, 1, 'only time away while the hold is RUNNING counts');
  });

  await check('F2-7d. hidden while the hold is PAUSED does not taint it (a paused clock cannot run away)', async () => {
    const b = await start();
    H.advance(6000); H.advance(10000);
    H.click(H.byLabel(H.page(b.ctx), 'Pause'));
    setHidden(true); H.advance(600000); setHidden(false);
    H.click(H.byLabel(H.page(b.ctx), 'Resume'));
    H.advance(45000);
    H.tapZone(zone(b));
    assert.strictEqual((sess(b).records || []).length, 1, 'banked 10 s + 45 s = 55 s, all in view');
  });

  await check('F2-7e. ending the session with the tainted hold on screen (Bank it) saves the seconds and claims nothing', async () => {
    const b = await start();
    H.advance(6000); H.advance(5000);
    setHidden(true); H.advance(3600 * 1000); setHidden(false);
    // the controller's commitLiveSet path, via the end-session sheet's onSave
    const sheet = H.modals.slice().reverse().find(m => m.kind === 'end');
    assert.ok(!sheet, 'fixture: no sheet open yet');
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    const modal = H.modals.slice().reverse().find(m => m.kind === 'end');
    assert.ok(modal, 'the end-session sheet opened');
    modal.opts.onReview();                               // commits the live hold, then opens the log
    assert.ok(parseFloat(sets(b)[0].seconds) >= 3600, 'saved');
    const carry = b.ctx.state.sessionCarry;
    assert.strictEqual(((carry && carry.records) || []).length, 0, 'and claimed nothing');
  });

  await check('F2-7f. the flag survives pausing, leaving and coming back (a tainted hold cannot be laundered through a pause)', async () => {
    const b = await start();
    H.advance(6000); H.advance(5000);
    setHidden(true); H.advance(3600 * 1000); setHidden(false);
    H.click(H.byLabel(H.page(b.ctx), 'Pause'));
    b.ctx.nav('dashboard'); b.ctx.enterGuided();
    assert.ok(sess(b).hold && sess(b).hold.paused, 'fixture: came back paused');
    H.click(H.byLabel(H.page(b.ctx), 'Resume'));
    H.tapZone(zone(b));
    assert.strictEqual((sess(b).records || []).length, 0, 'still no claim');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 hold away OK (${results.length} cases)`);
  process.exit(0);
})();
