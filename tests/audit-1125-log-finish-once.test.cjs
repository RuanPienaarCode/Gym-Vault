'use strict';
/* Audit 25 Nov 2026, lane L6 "log + history" — finding #4.

   A FINISHED SESSION MUST STOP BEING RESUMABLE THE MOMENT ITS NOTE EXISTS.
   finishSession used to await the XP award (up to 1.5 s) BEFORE it cleared
   ctx.state.logDraft. Backgrounding the app in that window re-kept the draft on
   the device, so it came back as "Session in progress"; finishing it again wrote
   a second note and paid XP twice. Now the draft and its stored copy go as soon
   as io.saveWorkout resolves, the award still gets what it needs (the records
   carried for THIS draft), and a failed save leaves the draft exactly as it was.

   Drives the real controller and log page over the shared harness. Synthetic data. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.modals.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

const STORE = 'gym-app-draft';
const PATH = 'Gym/Workouts/finished.md';

/* A log draft with one ticked set, over a device store; the award is held open
   until the test releases it. */
async function rig(storage) {
  const b = await H.boot({ storage, planBody: '## D (any)\n\n- Push-ups | 2 x 10\n', settings: { soundMode: 'silent', rewards: true } });
  let release = null;
  const appended = [];
  b.ctx.io.saveWorkout = async w => { b.saved.push(JSON.parse(JSON.stringify(w))); return PATH; };
  b.ctx.io.readRewards = () => new Promise(r => { release = () => r({ entries: [], keys: new Set() }); });
  b.ctx.io.appendRewards = async awards => { appended.push(awards); return { appended: awards }; };
  const plan = b.ctx.activePlan();
  b.ctx.startLog(plan, plan.model.days[0]);
  H.click(H.byLabel(H.page(b.ctx), 'Mark done'));
  return { b, appended, release: () => release && release() };
}
const bankIt = b => H.click(H.byText(H.page(b.ctx), 'Save session'));
const hide = () => {
  H.document.visibilityState = 'hidden';
  for (const fn of [...(H.docListeners.visibilitychange || [])]) fn();
  H.document.visibilityState = 'visible';
};

(async () => {
  await check('#4a while the award is still running, the draft is gone and backgrounding cannot keep it again', async () => {
    const storage = H.makeStorage();
    const { b, release } = await rig(storage);
    assert.ok(storage.raw.has(STORE), 'fixture: a ticked set is kept on the device');
    const draft = b.ctx.state.logDraft;
    bankIt(b);
    await H.flush(); await H.flush();
    assert.strictEqual(b.saved.length, 1, 'fixture: the note was saved');
    assert.strictEqual(b.ctx.state.logDraft, null, 'the saved session is still the live draft while XP is worked out');
    assert.ok(!storage.raw.has(STORE), 'the stored copy of a saved session is still on the device during the award');
    /* The app goes to the background mid-award: the controller writes the draft. */
    hide();
    assert.ok(!storage.raw.has(STORE), 'backgrounding during the award wrote the saved session back to the device');
    /* iOS kills it there; the next launch must not offer the saved session back. */
    H.killProcess();
    const again = await H.boot({ storage, settings: { soundMode: 'silent' } });
    assert.strictEqual(again.ctx.state.logDraft, null, `a saved session came back as unfinished: ${JSON.stringify(again.ctx.state.logDraft && again.ctx.state.logDraft.entries)}`);
    release();
    assert.ok(draft.finishing, 'fixture: the double-tap guard stays up');
  });

  await check('#4b the award still runs once, for the saved path, after the draft is cleared', async () => {
    const storage = H.makeStorage();
    const { b, appended, release } = await rig(storage);
    bankIt(b);
    await H.flush(); await H.flush();
    bankIt(b); // a second tap on the still-drawn button
    release();
    for (let i = 0; i < 6; i++) await H.flush();
    assert.strictEqual(b.saved.length, 1, 'a second tap wrote a second note');
    assert.strictEqual(appended.length, 1, `XP was written ${appended.length} times`);
    assert.ok(appended[0].some(a => a.kind === 'session' && a.key.indexOf(PATH) >= 0), `no session award for ${PATH}: ${JSON.stringify(appended[0])}`);
    assert.strictEqual(b.ctx.state.page, 'dashboard');
  });

  await check('#4c a record carried for THIS draft is still paid when the carry is dropped while the award runs', async () => {
    const storage = H.makeStorage();
    const { b, appended, release } = await rig(storage);
    const rec = { key: 'Push-ups|reps', exercise: 'Push-ups', kind: 'reps', val: 30, prev: 12 };
    b.ctx.state.sessionCarry = { draft: b.ctx.state.logDraft, records: [rec], goalCount: 0, metGoals: [] };
    bankIt(b);
    await H.flush(); await H.flush();
    /* What a guided page's cleanup would leave behind if it ran now. */
    b.ctx.state.sessionCarry = { draft: null, records: [], goalCount: 0, metGoals: [] };
    b.ctx.state.session = null;
    release();
    for (let i = 0; i < 6; i++) await H.flush();
    assert.strictEqual(appended.length, 1);
    assert.ok(appended[0].some(a => a.kind === 'pb'), `the carried record was not paid: ${JSON.stringify(appended[0].map(a => a.kind))}`);
  });

  await check('#4d a failed save leaves the draft and its stored copy exactly as they were', async () => {
    const storage = H.makeStorage();
    const { b } = await rig(storage);
    const draft = b.ctx.state.logDraft;
    const before = storage.raw.get(STORE);
    b.ctx.io.saveWorkout = async () => { throw new Error('disk full'); };
    bankIt(b);
    await H.flush(); await H.flush();
    assert.strictEqual(b.ctx.state.logDraft, draft, 'a failed save lost the draft');
    assert.strictEqual(draft.finishing, false, 'a failed save left the double-tap latch on');
    assert.ok(storage.raw.has(STORE), 'a failed save cleared the stored copy');
    assert.strictEqual(JSON.parse(storage.raw.get(STORE)).draft.entries.length, JSON.parse(before).draft.entries.length);
    assert.ok(H.notices.some(n => /could not save the session/.test(n)), `no notice: ${H.notices}`);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1125 log finish once OK (${results.length} cases)`);
  process.exit(0);
})();
