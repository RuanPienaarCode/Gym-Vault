'use strict';
/* Audit 25 Nov 2026, lane L6 "log + history" — finding #27, UI half.

   FIXING A SAVED WORKOUT MEANT EDITING A RAW MARKDOWN TABLE. History's session
   now has "Edit" beside "Open note": it opens the SAME log screen loaded with the
   note's rows, in an editing mode that
     - builds the draft from the note (date, plan, day, duration, every row with
       reps / weight / seconds / distance / note) and carries `editing: <path>`;
     - reads "Editing <date> · <day>", saves with "Save changes";
     - saves through io.updateWorkout(file, { date, plan, day, duration_min, rows,
       kind? }) - never saveWorkout, never a second note, never the XP award;
     - keeps the note's duration_min and a challenge go's kind;
     - discards back to History changing nothing;
     - never touches a live session draft: it is not shown on Today, not kept on
       the device, and not resumable after its save or discard.
   io.updateWorkout belongs to lane L1; it is faked here and its argument shape is
   asserted exactly. Drives the real controller, History and log pages. Synthetic. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const pageLog = require('../src/page-log');
const { fmtShort } = require('../src/dates');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.modals.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

const STORE = 'gym-app-draft';
const row = (exercise, set, o) => Object.assign({ exercise, set, reps: '', weight_kg: '', seconds: '', note: '', distance_km: '' }, o);
const ROWS = [
  row('Push-ups', 1, { reps: '12', note: 'left wrist sore' }),
  row('Push-ups', 2, { reps: '10' }),
  row('Goblet Squat', 1, { reps: '8', weight_kg: '24' }),
  row('Plank', 1, { seconds: '45' }),
  row('Easy Run', 1, { seconds: '1830', distance_km: '5.2' }),
  row('Push-ups', 1, { reps: '15', seconds: '40' }),
];
const SESSION = { name: '2026-11-20 Upper', fm: { date: '2026-11-20', plan: 'Synthetic Plan', day: 'Upper', duration_min: 42 }, rows: ROWS, file: { path: 'Gym/Workouts/2026-11-20 Upper.md' } };
const GO = { name: '2026-11-21 Pull-ups go', fm: { date: '2026-11-21', plan: '', day: 'Pull-ups challenge', kind: 'challenge', duration_min: 3 }, rows: [row('Push-ups', 1, { reps: '20' })], file: { path: 'Gym/Workouts/2026-11-21 Pull-ups go.md' } };
const EXERCISES = [H.ex('Push-ups'), H.ex('Plank', { unit: 'seconds' }), H.ex('Goblet Squat', { unit: 'kg' }), H.ex('Easy Run', { unit: 'km' })];

async function rig(storage) {
  const b = await H.boot({ storage, workouts: [SESSION, GO], exercises: EXERCISES, settings: { soundMode: 'silent', rewards: true } });
  const calls = { update: [], rewards: 0 };
  b.ctx.io.updateWorkout = async (file, session) => { calls.update.push([file, JSON.parse(JSON.stringify(session))]); return file.path; };
  b.ctx.io.readRewards = async () => { calls.rewards++; return { entries: [], keys: new Set() }; };
  b.ctx.io.appendRewards = async () => { calls.rewards++; return { appended: [] }; };
  return { b, calls };
}
const openEdit = (b, w) => {
  b.ctx.nav('history', { session: w.name });
  const edit = H.byText(H.page(b.ctx), 'Edit');
  assert.ok(edit, 'the open History session has no Edit button');
  assert.ok(H.byText(H.page(b.ctx), 'Open note'), 'Open note must stay beside Edit');
  H.click(edit);
};
const saveBtn = b => H.byText(H.page(b.ctx), 'Save changes');
const loaded = b => b.ctx.data.workouts.find(w => w.file.path === SESSION.file.path);
const settle = async () => { for (let i = 0; i < 6; i++) await H.flush(); };

(async () => {
  await check('#27 Edit opens the log in editing mode, built from the note', async () => {
    const storage = H.makeStorage();
    const { b } = await rig(storage);
    openEdit(b, SESSION);
    assert.strictEqual(b.ctx.state.page, 'log');
    const title = H.page(b.ctx).querySelector('h2').textContent;
    assert.strictEqual(title, `Editing ${fmtShort('2026-11-20')} · Upper`);
    assert.ok(saveBtn(b), 'the save button does not say "Save changes"');
    assert.ok(!H.byText(H.page(b.ctx), 'Save session'), 'an edit still offers "Save session"');
    const d = b.ctx.state.editDraft;
    assert.ok(d && d.editing === SESSION.file.path, `draft does not carry editing: ${d && d.editing}`);
    assert.deepStrictEqual(d.entries.map(e => [e.exercise, e.sets.length]), [['Push-ups', 2], ['Goblet Squat', 1], ['Plank', 1], ['Easy Run', 1], ['Push-ups', 1]]);
    assert.strictEqual(b.ctx.state.logDraft, null, 'the edit became the live session draft');
    assert.ok(!storage.raw.has(STORE), 'the edit was kept on the device as a session in progress');
  });

  await check('#27 Save changes with nothing changed hands updateWorkout the note exactly as it was', async () => {
    const { b, calls } = await rig(H.makeStorage());
    openEdit(b, SESSION);
    H.click(saveBtn(b));
    await settle();
    assert.strictEqual(calls.update.length, 1, `updateWorkout called ${calls.update.length} times`);
    const [file, session] = calls.update[0];
    assert.strictEqual(file, loaded(b).file, 'updateWorkout was not given the note\'s own file');
    assert.deepStrictEqual(session, { date: '2026-11-20', plan: 'Synthetic Plan', day: 'Upper', duration_min: 42, rows: ROWS });
    assert.strictEqual(b.saved.length, 0, 'an edit called saveWorkout (a second note)');
    assert.strictEqual(calls.rewards, 0, 'an edit ran the XP award again');
    assert.strictEqual(b.ctx.state.editDraft, null, 'the edit is still resumable after its save');
    assert.strictEqual(b.ctx.state.page, 'history');
  });

  await check('#27 a changed figure is saved; duration stays the note\'s own', async () => {
    const { b, calls } = await rig(H.makeStorage());
    openEdit(b, SESSION);
    b.ctx.state.editDraft.startedAt -= 60 * 60 * 1000; // an hour spent editing is not training time
    const reps = H.page(b.ctx).querySelectorAll('input').filter(x => /^Reps/.test(x.getAttribute('aria-label') || ''))[1];
    reps.value = '11'; H.fire(reps, 'input');
    H.click(saveBtn(b));
    await settle();
    const session = calls.update[0][1];
    assert.strictEqual(session.rows[1].reps, '11');
    assert.strictEqual(session.duration_min, 42);
    assert.strictEqual(session.rows.length, ROWS.length);
  });

  await check('#27 a weekly-challenge go keeps its kind', async () => {
    const { b, calls } = await rig(H.makeStorage());
    openEdit(b, GO);
    H.click(saveBtn(b));
    await settle();
    assert.strictEqual(calls.update[0][1].kind, 'challenge');
    assert.strictEqual(calls.rewards, 0);
  });

  await check('#27 discarding changes nothing and returns to History at that session', async () => {
    const { b, calls } = await rig(H.makeStorage());
    openEdit(b, SESSION);
    const reps = H.page(b.ctx).querySelectorAll('input').filter(x => /^Reps/.test(x.getAttribute('aria-label') || ''))[0];
    reps.value = '99'; H.fire(reps, 'input');
    H.click(H.byText(H.page(b.ctx), 'Discard changes'));
    const m = H.modals[H.modals.length - 1];
    assert.ok(m && m.kind === 'confirm', 'a changed edit was thrown away without asking');
    m.opts.onConfirm();
    await settle();
    assert.strictEqual(calls.update.length, 0, 'discard wrote the note');
    assert.strictEqual(b.saved.length, 0);
    assert.strictEqual(b.ctx.state.editDraft, null, 'a discarded edit is still resumable');
    assert.strictEqual(b.ctx.state.page, 'history');
    assert.strictEqual(b.ctx.state.params.session, SESSION.name);
    assert.strictEqual(loaded(b).rows[0].reps, '12', 'discard changed the loaded session');
  });

  await check('#27 an edit never replaces, hides or stores over a live session', async () => {
    const storage = H.makeStorage();
    const { b, calls } = await rig(storage);
    const plan = b.ctx.activePlan();
    b.ctx.startLog(plan, plan.model.days[0]);
    H.click(H.byLabel(H.page(b.ctx), 'Mark done'));
    const live = b.ctx.state.logDraft;
    const kept = storage.raw.get(STORE);
    openEdit(b, SESSION);
    assert.strictEqual(b.ctx.state.logDraft, live, 'Edit replaced the live session');
    b.ctx.nav('dashboard');
    assert.ok(H.page(b.ctx).textContent.indexOf('Session in progress') >= 0, 'fixture: Today offers the live session');
    assert.strictEqual(H.page(b.ctx).textContent.split('Session in progress').length - 1, 1, 'Today offers more than one session in progress');
    assert.strictEqual(b.ctx.describeDraft(), `${live.day} · Synthetic Plan`, `Today's card names ${b.ctx.describeDraft()}, not the live session`);
    assert.ok(H.page(b.ctx).textContent.indexOf('Editing') < 0, 'Today shows the edit');
    assert.strictEqual(JSON.parse(storage.raw.get(STORE)).draft.date, JSON.parse(kept).draft.date, 'the stored copy is no longer the live session');
    /* Back into the edit, type, then iOS kills the app: the relaunch offers the LIVE session only. */
    b.ctx.nav('log', { editing: SESSION.file.path });
    assert.ok(saveBtn(b), 'fixture: back in the edit');
    const reps = H.page(b.ctx).querySelectorAll('input').filter(x => /^Reps/.test(x.getAttribute('aria-label') || ''))[0];
    reps.value = '13'; H.fire(reps, 'input');
    assert.deepStrictEqual(JSON.parse(storage.raw.get(STORE)).draft.entries, JSON.parse(kept).draft.entries, 'typing in the edit rewrote the stored live session');
    H.click(saveBtn(b));
    await settle();
    assert.strictEqual(calls.update.length, 1);
    assert.strictEqual(b.ctx.state.logDraft, live, 'saving the edit dropped the live session');
    H.killProcess();
    const again = await H.boot({ storage, workouts: [SESSION], exercises: EXERCISES, settings: { soundMode: 'silent' } });
    assert.ok(again.ctx.state.logDraft, 'the live session was not kept');
    assert.strictEqual(again.ctx.state.logDraft.day, live.day, 'the relaunch offered the edit, not the live session');
    assert.ok(!again.ctx.state.logDraft.editing);
  });

  await check('#27 an edit draft handed to finishSession is still an update, never a new note', async () => {
    const { b, calls } = await rig(H.makeStorage());
    openEdit(b, SESSION);
    await pageLog.finishSession(b.ctx, b.ctx.state.editDraft);
    await settle();
    assert.strictEqual(b.saved.length, 0, 'finishSession wrote a new note for an edit');
    assert.strictEqual(calls.update.length, 1);
    assert.strictEqual(calls.rewards, 0);
  });

  await check('#27 a failed update keeps the edit open and says so', async () => {
    const { b } = await rig(H.makeStorage());
    openEdit(b, SESSION);
    b.ctx.io.updateWorkout = async () => { throw new Error('note is gone'); };
    const d = b.ctx.state.editDraft;
    H.click(saveBtn(b));
    await settle();
    assert.strictEqual(b.ctx.state.editDraft, d);
    assert.strictEqual(d.finishing, false);
    assert.strictEqual(b.ctx.state.page, 'log');
    assert.ok(H.notices.some(n => /could not save the changes/.test(n)), `notices: ${H.notices}`);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1125 log edit OK (${results.length} cases)`);
  process.exit(0);
})();
