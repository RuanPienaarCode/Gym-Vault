'use strict';
/* MOTION COUNTING IS REMEMBERED PER EXERCISE — the guided screen, end to end.

   Drives the REAL controller and the REAL guided session (tests/
   live-session-harness.js) with a recording io.saveExercise, so what is
   asserted is what a user's tap actually writes to the exercise note and what
   the next exercise's screen actually starts with — not that a helper exists.

   iOS is modelled: when `needGesture` is on, DeviceMotionEvent.
   requestPermission() REJECTS unless it is called synchronously inside a click
   (the harness's click is synchronous, so a flag set around it is exactly
   that). Synthetic exercises and a synthetic plan only. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.setMotionPermission(null);
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

const RESUME = 'Tap the movement button to turn counting back on';
const COUNTING = 'Counting your movement — taps still work';
const DECLINED = /declined/;

/* ---------- iOS permission model ---------- */
let inGesture = false;
let grantedInApp = false; // once a tap has been granted, later calls resolve 'granted' with no tap (as the app's own re-render path already relies on)
function iosPermission(answer) { // answer: 'granted' | 'denied'
  grantedInApp = false;
  H.setMotionPermission(() => (inGesture
    ? (grantedInApp = grantedInApp || answer === 'granted', Promise.resolve(answer))
    : grantedInApp ? Promise.resolve('granted') : Promise.reject(Object.assign(new Error('Requesting device orientation or motion access requires a user gesture to prompt'), { name: 'NotAllowedError' }))));
}
const tapWithGesture = node => { inGesture = true; try { H.click(node); } finally { inGesture = false; } };

/* ---------- the session ---------- */
const PLAN = '## D (any)\n\n- Push-ups | 2 x 10\n- Dips | 2 x 10\n- Step-ups | 2 x 10\n';
/* Push-ups: note says ON.  Dips: a note, no key.  Step-ups: NO note at all. */
const exercises = fm => [
  H.ex('Push-ups', Object.assign({ motion_counting: 'true', motion_sensitivity: 'high', tags: ['gym'] }, fm || {})),
  H.ex('Dips'),
];

async function session(opts) {
  const o = opts || {};
  const writes = [];
  const b = await H.boot({
    planBody: PLAN, settings: { guideRestSeconds: 0 }, exercises: o.exercises || exercises(),
    saveExercise: async rec => { writes.push({ name: rec.name, fm: JSON.parse(JSON.stringify(rec.fm)) }); },
  });
  b.writes = writes;
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  await H.flush();
  return b;
}
const hint = b => { const n = H.page(b.ctx).querySelector('.gv-rc-hint'); return n ? n.textContent : null; };
/* The motion toggle lives in the counter-settings sheet; open it and find the button. */
function motionBtn(b) {
  if (!H.page(b.ctx).querySelector('.gv-cs')) H.click(H.byLabel(H.page(b.ctx), 'Counter settings'));
  return H.page(b.ctx).querySelectorAll('button').find(x => /movement|No motion sensor/.test(x.getAttribute('aria-label') || ''));
}
const isOn = b => motionBtn(b).getAttribute('aria-pressed') === 'true';
const closeSheet = b => { const c = H.page(b.ctx).querySelector('.gv-cs'); if (c) c.remove(); };
const current = b => H.page(b.ctx).querySelector('.gv-session-ex, .gv-session-name, h2, .gv-session-title');
/* The fake sensor delivers one sample to whatever is subscribed (a real phone
   streams them; one is all `listening` needs). Without it a subscription
   correctly gives up after 2.5 s as "no sensor". */
const sensorPulse = () => { if (H.motionListeners()) H.emitMotion(9.8); };
/* Let the screen settle: start-up promises, one sensor sample, the 5 s count-in. */
async function settle(b, ms) {
  await H.flush(); sensorPulse(); H.advance(ms == null ? 6000 : ms); await H.flush();
}
async function finishSet(b, reps) {
  await H.flush(); sensorPulse();
  H.advance(6000);
  const z = H.page(b.ctx).querySelector('.gv-session-zone');
  for (let i = 0; i < (reps || 3); i++) { H.tapZone(z); H.advance(800); }
  H.click(H.byText(H.page(b.ctx), 'Done'));
  await H.flush();
}
/* Which exercise is on screen — the plan order is fixed, so read it off the draft position. */
const whichExercise = b => b.ctx.state.logDraft.entries[b.ctx.state.session.pos.entryIndex].exercise;
const motionNotices = () => H.notices.filter(n => /motion/i.test(n));

(async () => {
  await check('1. saved ON: the exercise opens with motion ON and listening (Android/desktop-style permission)', async () => {
    const b = await session();
    assert.strictEqual(whichExercise(b), 'Push-ups');
    await settle(b);
    assert.strictEqual(H.motionListeners(), 1, 'a live devicemotion subscription must have started with no tap');
    assert.strictEqual(isOn(b), true, 'the button shows it on');
    assert.strictEqual(hint(b), COUNTING, 'and the hint line says what it always says');
    assert.strictEqual(b.writes.length, 0, 'starting from a remembered preference writes nothing');
    assert.deepStrictEqual(motionNotices(), []);
  });

  await check('2. an exercise WITHOUT the key starts OFF, and the previous exercise\'s ON does not carry over', async () => {
    const b = await session();
    await finishSet(b); await finishSet(b); // Push-ups x2 -> Dips
    assert.strictEqual(whichExercise(b), 'Dips');
    await settle(b);
    assert.strictEqual(isOn(b), false, 'Dips has no preference: OFF, not Push-ups\' ON');
    assert.strictEqual(H.motionListeners(), 0, 'and nothing is subscribed');
    assert.strictEqual(hint(b), '');
  });

  await check('3. toggling ON saves exactly one frontmatter change, keeping every other key; OFF removes it', async () => {
    const b = await session();
    await finishSet(b); await finishSet(b); // -> Dips
    closeSheet(b);
    const before = JSON.parse(JSON.stringify(b.ctx.data.exercises.find(e => e.name === 'Dips').fm));
    tapWithGesture(motionBtn(b));
    await H.flush();
    assert.strictEqual(b.writes.length, 1, `one write, got ${b.writes.length}`);
    assert.strictEqual(b.writes[0].name, 'Dips');
    assert.deepStrictEqual(b.writes[0].fm, Object.assign({}, before, { motion_counting: true }), 'the ONLY change is the new key');
    assert.strictEqual(isOn(b), true);
    tapWithGesture(motionBtn(b));
    await H.flush();
    assert.strictEqual(b.writes.length, 2);
    assert.deepStrictEqual(b.writes[1].fm, before, 'OFF puts the note back exactly as it was: the key is removed, not set to false');
    assert.ok(!('motion_counting' in b.writes[1].fm));
    assert.strictEqual(isOn(b), false);
  });

  await check('4. a re-render within the same exercise keeps the state (set 1 -> set 2), without stacking subscriptions', async () => {
    const b = await session();
    await finishSet(b); // Push-ups set 1 -> set 2
    assert.strictEqual(whichExercise(b), 'Push-ups');
    await H.flush();
    assert.strictEqual(isOn(b), true);
    assert.strictEqual(H.motionListeners(), 1, 'exactly one live subscription after the re-render');
    // and a user's OFF survives the same re-render even though the note still says ON? — it does not: OFF removes the note's key too.
    closeSheet(b);
    tapWithGesture(motionBtn(b)); await H.flush();
    assert.strictEqual(isOn(b), false);
    assert.strictEqual(H.motionListeners(), 0);
  });

  await check('5. a toggle on A does not leak into B (B has a note without the key)', async () => {
    const b = await session({ exercises: exercises({ motion_counting: undefined }) });
    assert.strictEqual(isOn(b), false, 'fixture: Push-ups now has no key');
    closeSheet(b);
    tapWithGesture(motionBtn(b)); await H.flush();
    assert.strictEqual(isOn(b), true);
    await finishSet(b); await finishSet(b); // -> Dips
    await H.flush();
    assert.strictEqual(whichExercise(b), 'Dips');
    assert.strictEqual(isOn(b), false, 'Dips does not inherit the toggle');
    assert.strictEqual(H.motionListeners(), 0);
  });

  await check('6. a plan line with NO note: the session toggle works, nothing is written, nothing throws, it survives the re-render', async () => {
    const b = await session({ exercises: [H.ex('Push-ups'), H.ex('Dips')] }); // Step-ups has no note
    await finishSet(b); await finishSet(b); await finishSet(b); await finishSet(b);
    assert.strictEqual(whichExercise(b), 'Step-ups');
    closeSheet(b);
    tapWithGesture(motionBtn(b)); await H.flush();
    assert.strictEqual(isOn(b), true, 'the session-level toggle still works');
    assert.strictEqual(b.writes.length, 0, 'there is no note to write to');
    await finishSet(b); await H.flush();
    assert.strictEqual(whichExercise(b), 'Step-ups');
    assert.strictEqual(isOn(b), true, 'and it survives the next set\'s render');
  });

  await check('7. iOS, no gesture: the remembered start is refused -> NO "declined" notice, preference KEPT, soft hint, button off', async () => {
    iosPermission('granted');
    const b = await session();
    await H.flush(); await H.flush();
    assert.strictEqual(hint(b), 'Tap to start now', 'while the count-in runs the line is the count-in\'s: the soft hint waits for the hand-over');
    await settle(b);
    assert.strictEqual(whichExercise(b), 'Push-ups');
    assert.deepStrictEqual(motionNotices(), [], `the declined notice must not appear for a start nobody tapped: ${JSON.stringify(H.notices)}`);
    assert.strictEqual(isOn(b), false, 'the button is visibly off');
    assert.strictEqual(hint(b), RESUME);
    assert.strictEqual(H.motionListeners(), 0);
    assert.strictEqual(b.writes.length, 0, 'the saved preference was not touched');
    const fm = b.ctx.data.exercises.find(e => e.name === 'Push-ups').fm;
    assert.strictEqual(fm.motion_counting, 'true', 'still ON in the note');
  });

  await check('8. iOS: after the refused auto-start, the user\'s tap gets the prompt and counting turns on; the note is not re-written', async () => {
    iosPermission('granted');
    const b = await session();
    await settle(b);
    closeSheet(b);
    tapWithGesture(motionBtn(b)); await H.flush();
    assert.strictEqual(isOn(b), true);
    assert.strictEqual(H.motionListeners(), 1);
    assert.strictEqual(b.writes.length, 0, 'the note already said ON — no redundant write');
    await finishSet(b); await H.flush();
    assert.strictEqual(whichExercise(b), 'Push-ups');
    assert.strictEqual(isOn(b), true, 'the re-render path restarts without a gesture');
  });

  await check('9. iOS: a REAL decline on a tap still shows the existing notice, and does NOT forget the saved preference', async () => {
    iosPermission('denied');
    const b = await session({ exercises: exercises({ motion_counting: undefined }) }); // starts OFF; the tap turns it ON
    closeSheet(b);
    tapWithGesture(motionBtn(b)); await H.flush(); await H.flush();
    assert.strictEqual(motionNotices().length, 1, JSON.stringify(H.notices));
    assert.match(motionNotices()[0], DECLINED);
    assert.strictEqual(isOn(b), false, 'falls back to tap counting');
    const writes = b.writes.map(w => ('motion_counting' in w.fm));
    assert.deepStrictEqual(writes, [true], 'the tap saved ON once; the decline did not write an OFF');
  });

  await check('10. a resolved "denied" on a remembered start is ALSO soft (conservative: cannot prove a user said no)', async () => {
    iosPermission('denied');
    inGesture = true; // permission answers 'denied' (not a rejection) even with no tap
    const b = await session();
    inGesture = false;
    await settle(b);
    assert.deepStrictEqual(motionNotices(), []);
    assert.strictEqual(hint(b), RESUME);
    assert.strictEqual(b.writes.length, 0);
  });

  await check('11. no sensor (events never come): a remembered start says so quietly, keeps the preference', async () => {
    const b = await session();
    await H.flush();
    assert.strictEqual(isOn(b), true, 'optimistic until the sensor stays silent');
    H.advance(6000); await H.flush(); // no sample ever arrives
    assert.deepStrictEqual(motionNotices(), [], 'no 6-second notice every time a synced exercise comes up on a desktop');
    assert.strictEqual(isOn(b), false);
    assert.strictEqual(hint(b), 'No motion sensor here — counting by tap');
    assert.strictEqual(b.writes.length, 0);
  });

  await check('12. a tap on a device with no sensor keeps the existing notice', async () => {
    const b = await session({ exercises: exercises({ motion_counting: undefined }) });
    closeSheet(b);
    tapWithGesture(motionBtn(b)); await H.flush();
    H.advance(2600); await H.flush(); // no sample ever arrives
    assert.strictEqual(motionNotices().length, 1);
    assert.match(motionNotices()[0], /no motion sensor available/);
  });

  await check('13. sensitivity still works: picker shows while ON, saves motion_sensitivity, leaves motion_counting alone', async () => {
    const b = await session();
    await settle(b);
    const sens = H.page(b.ctx).querySelector('.gv-rc-sens');
    const low = sens.querySelectorAll('button').find(x => /Low/.test(x.textContent));
    assert.ok(low, 'the sensitivity picker is present while motion is on');
    H.click(low); await H.flush();
    assert.strictEqual(b.writes.length, 1);
    assert.strictEqual(b.writes[0].fm.motion_sensitivity, 'low');
    assert.strictEqual(b.writes[0].fm.motion_counting, 'true', 'untouched');
    assert.strictEqual(H.motionListeners(), 1, 'restarted, not stacked');
  });

  await check('7b. a refused remembered start is not retried (or re-explained) on every set of that exercise', async () => {
    let calls = 0;
    H.setMotionPermission(() => { calls++; return Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' })); });
    const b = await session();
    await settle(b);
    assert.strictEqual(calls, 1);
    await finishSet(b); await settle(b);                     // Push-ups set 2
    assert.strictEqual(whichExercise(b), 'Push-ups');
    assert.strictEqual(calls, 1, 'the second set must not ask again');
    assert.strictEqual(isOn(b), false);
    assert.deepStrictEqual(motionNotices(), []);
    assert.strictEqual(b.writes.length, 0, 'and the note still says ON');
  });

  await check('14. a device with no motion API: a remembered preference leaves the button disabled, nothing subscribed, nothing thrown', async () => {
    const had = H.win.DeviceMotionEvent;
    delete H.win.DeviceMotionEvent;
    try {
      const b = await session();
      await settle(b);
      const m = motionBtn(b);
      assert.strictEqual(m.disabled, true);
      assert.strictEqual(m.getAttribute('aria-pressed'), 'false');
      assert.strictEqual(H.motionListeners(), 0);
      assert.strictEqual(b.writes.length, 0);
      assert.deepStrictEqual(motionNotices(), []);
    } finally { H.win.DeviceMotionEvent = had; }
  });

  await check('15. a late failure report from the PREVIOUS exercise does not switch off the exercise on screen now', async () => {
    let calls = 0, release;
    const first = new Promise(r => { release = r; });
    H.setMotionPermission(() => (++calls === 1 ? first : Promise.resolve('granted')));
    const b = await session({ exercises: [H.ex('Push-ups', { motion_counting: 'true' }), H.ex('Dips', { motion_counting: 'true' })] });
    await finishSet(b); await finishSet(b);                  // Push-ups' prompt is still pending; on to Dips
    assert.strictEqual(whichExercise(b), 'Dips');
    await settle(b);
    assert.strictEqual(isOn(b), true, 'fixture: Dips is counting');
    release('denied'); await H.flush(); await H.flush();     // Push-ups' answer arrives late
    assert.strictEqual(isOn(b), true, 'Dips must still be counting');
    assert.strictEqual(H.motionListeners(), 1);
  });

  const failed = results.filter(r => r[1]);
  for (const [name, e] of results) console.log(`  ${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n').join('\n       ')}` : ''}`);
  if (failed.length) { console.log(`motion pref (guided): ${failed.length} of ${results.length} FAILED`); process.exit(1); }
  console.log(`motion pref (guided) OK (${results.length} checks)`);
})();
