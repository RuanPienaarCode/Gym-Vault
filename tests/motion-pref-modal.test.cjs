'use strict';
/* MOTION COUNTING IS REMEMBERED PER EXERCISE — the plain-log counter.

   The log page's per-set counter button opens RepCounterModal, which has its
   OWN motion toggle (a second consumer of the same preference as the guided
   screen). Opened for an exercise whose note says `motion_counting: true` it
   starts counting from motion; its toggle writes the preference back through
   the page's saver, exactly as the sensitivity picker does.

   Drives the real modal and the real log page's counter button against the
   harness's fake DOM and devicemotion source, with iOS's gesture rule
   modelled (see motion-pref-session.test.cjs). Synthetic data only. */
const assert = require('node:assert');
const path = require('node:path');
const H = require('./live-session-harness.js');
const { RepCounterModal } = require(path.join(H.SRC, 'rep-counter-modal'));
const { startDraft } = require(path.join(H.SRC, 'page-log'));
const pageLog = require(path.join(H.SRC, 'page-log'));

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.modals.length = 0; H.setMotionPermission(null);
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

let inGesture = false;
const iosNeedsGesture = answer => H.setMotionPermission(() => (inGesture
  ? Promise.resolve(answer)
  : Promise.reject(Object.assign(new Error('requires a user gesture'), { name: 'NotAllowedError' }))));
const tapWithGesture = node => { inGesture = true; try { H.click(node); } finally { inGesture = false; } };
const RESUME = 'Tap the movement button to turn counting back on';

function open(opts) {
  const prefs = [];
  const m = new RepCounterModal({}, Object.assign({
    exerciseName: 'Push-ups', settings: { soundMode: 'silent' },
    onMotionPref: on => prefs.push(on),
  }, opts));
  m.open();
  m.prefs = prefs;
  return m;
}
const btn = (m, re) => m.contentEl.querySelectorAll('button').find(b => re.test(b.getAttribute('aria-label') || ''));
const motionBtn = m => btn(m, /movement|No motion sensor/);
const isOn = m => motionBtn(m).getAttribute('aria-pressed') === 'true';
const motionNotices = () => H.notices.filter(n => /motion/i.test(n));
const settle = async m => { await H.flush(); if (H.motionListeners()) H.emitMotion(9.8); H.advance(6000); await H.flush(); };

(async () => {
  await check('1. opened for an exercise that remembers motion: it is ON and listening with no tap', async () => {
    const m = open({ motionPref: true });
    await settle(m);
    assert.strictEqual(isOn(m), true);
    assert.strictEqual(H.motionListeners(), 1);
    assert.strictEqual(m.hintEl.textContent, 'Counting your movement — taps still work');
    assert.ok(m.sensEl.querySelectorAll('button').length === 3, 'the sensitivity picker is showing');
    assert.deepStrictEqual(m.prefs, [], 'starting from the preference writes nothing');
    m.close();
    assert.strictEqual(H.motionListeners(), 0, 'closing tears the subscription down');
  });

  await check('2. no preference: starts OFF exactly as before; a tap turns it ON and SAVES it; another tap clears it', async () => {
    const m = open({});
    await settle(m);
    assert.strictEqual(isOn(m), false);
    assert.strictEqual(H.motionListeners(), 0);
    tapWithGesture(motionBtn(m)); await H.flush();
    assert.deepStrictEqual(m.prefs, [true]);
    assert.strictEqual(isOn(m), true);
    tapWithGesture(motionBtn(m)); await H.flush();
    assert.deepStrictEqual(m.prefs, [true, false]);
    assert.strictEqual(isOn(m), false);
    m.close();
  });

  await check('3. iOS, no gesture: the remembered start is refused -> no declined notice, soft hint, still remembered', async () => {
    iosNeedsGesture('granted');
    const m = open({ motionPref: true });
    await settle(m);
    assert.deepStrictEqual(motionNotices(), [], JSON.stringify(H.notices));
    assert.strictEqual(isOn(m), false);
    assert.strictEqual(m.hintEl.textContent, RESUME);
    assert.deepStrictEqual(m.prefs, [], 'the preference is not touched');
    tapWithGesture(motionBtn(m)); await H.flush();
    assert.strictEqual(isOn(m), true, 'the tap gets the prompt and counting turns on');
    assert.deepStrictEqual(m.prefs, [true], 'tapping ON reports ON (the saver ignores a no-change)');
    m.close();
  });

  await check('4. iOS: a REAL decline on a tap keeps the existing notice and does not write an OFF', async () => {
    iosNeedsGesture('denied');
    const m = open({});
    tapWithGesture(motionBtn(m)); await H.flush(); await H.flush();
    assert.strictEqual(motionNotices().length, 1);
    assert.match(motionNotices()[0], /declined/);
    assert.strictEqual(isOn(m), false);
    assert.deepStrictEqual(m.prefs, [true], 'ON was the user\'s choice; the decline did not undo it');
    m.close();
  });

  await check('5. no sensor on a remembered start: quiet hint, no notice, preference kept', async () => {
    const m = open({ motionPref: true });
    await H.flush(); H.advance(6000); await H.flush(); // no sample ever arrives
    assert.deepStrictEqual(motionNotices(), []);
    assert.strictEqual(isOn(m), false);
    assert.strictEqual(m.hintEl.textContent, 'No motion sensor here — counting by tap');
    assert.deepStrictEqual(m.prefs, []);
    m.close();
  });

  await check('6. a device with no motion API at all: the button is disabled and a remembered preference does not throw', async () => {
    const had = H.win.DeviceMotionEvent;
    delete H.win.DeviceMotionEvent;
    try {
      const m = open({ motionPref: true });
      await H.flush();
      assert.strictEqual(motionBtn(m).disabled, true);
      assert.strictEqual(H.motionListeners(), 0);
      m.close();
    } finally { H.win.DeviceMotionEvent = had; }
  });

  await check('7. sensitivity still saves through its own callback and leaves the preference alone', async () => {
    const sens = [];
    const m = open({ motionPref: true, onSensitivity: v => sens.push(v) });
    await settle(m);
    H.click(m.sensEl.querySelectorAll('button').find(b => /High/.test(b.textContent)));
    await H.flush();
    assert.deepStrictEqual(sens, ['high']);
    assert.deepStrictEqual(m.prefs, []);
    assert.strictEqual(H.motionListeners(), 1, 'restarted, not stacked');
    m.close();
  });

  /* The log page's counter button: reads the preference off the exercise note
     and writes it back through io.saveExercise. */
  const logCtx = (exercises, writes) => {
    const ctx = {
      app: {}, settings: { skin: 'apex', accent: 'lime', soundMode: 'silent' },
      data: { exercises, workouts: [], plans: [], goals: [] },
      state: {}, nav() {}, rerender() {}, notice() {}, setPageInterval() {},
      io: { saveExercise: async rec => { writes.push({ name: rec.name, fm: JSON.parse(JSON.stringify(rec.fm)) }); } },
    };
    startDraft(ctx, { name: 'P' }, { items: [{ exercise: 'Push-ups', target: '10', sets: 1 }, { exercise: 'Ghost', target: '10', sets: 1 }] });
    return ctx;
  };
  const clickCounter = (ctx, n) => {
    const root = new H.N('div');
    pageLog.render(ctx, root);
    const b = root.querySelectorAll('button').filter(x => /Tap-count reps for/.test(x.getAttribute('aria-label') || ''))[n];
    H.click(b);
    return H.modals.at(-1);
  };

  await check('8. log page: the counter opens ON for an exercise whose note remembers it, and a toggle writes ONE change', async () => {
    const writes = [];
    const ctx = logCtx([H.ex('Push-ups', { motion_counting: 'true', tags: ['gym'] })], writes);
    const m = clickCounter(ctx, 0);
    await settle(m);
    assert.strictEqual(isOn(m), true);
    tapWithGesture(motionBtn(m)); await H.flush();                 // OFF
    assert.strictEqual(writes.length, 1);
    assert.ok(!('motion_counting' in writes[0].fm), 'key removed');
    assert.deepStrictEqual(writes[0].fm.tags, ['gym'], 'other keys kept');
    tapWithGesture(motionBtn(m)); await H.flush();                 // ON again
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[1].fm.motion_counting, true);
    m.close();
  });

  await check('9. log page: an exercise with no note toggles for the set, writes nothing, throws nothing', async () => {
    const writes = [];
    const ctx = logCtx([H.ex('Push-ups')], writes);
    const m = clickCounter(ctx, 1); // Ghost
    tapWithGesture(motionBtn(m)); await H.flush();
    assert.strictEqual(isOn(m), true);
    assert.strictEqual(writes.length, 0);
    m.close();
  });

  const failed = results.filter(r => r[1]);
  for (const [name, e] of results) console.log(`  ${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n       ')}` : ''}`);
  if (failed.length) { console.log(`motion pref (modal): ${failed.length} of ${results.length} FAILED`); process.exit(1); }
  console.log(`motion pref (modal) OK (${results.length} checks)`);
})();
