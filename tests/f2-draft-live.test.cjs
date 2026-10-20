'use strict';
/* FIX WAVE F2, item 2 (audit C-05 + R2-04): WHAT THE DEVICE-LOCAL DRAFT KEEPS.

   draft-store.js kept the SETS only. Two things the live session holds besides
   sets were therefore lost the moment iOS evicted Obsidian:

   (a) A PAUSED HOLD. The banked seconds lived on the session object, so a plank
       paused at 40 s came back as a fresh count-in; and if it was set 1 that was
       paused, nothing was "logged", hasDraft was false and the session was gone.
   (b) THE RECORDS BROKEN SO FAR (sess.records). rewards-flow's sessionInputs
       reads ctx.state.session.records, so a personal best earned before the kill
       was neither celebrated on the completion screen nor paid on "Bank it".

   Both now ride on the draft as one plain-data block (`draft.live`), refreshed
   wherever the session changes it, whitelisted by draft-store and put back by
   page-session on a fresh session for that draft.

   Drives the REAL controller and the REAL guided screen (tests/live-session-
   harness.js), with ONE storage shared by two boots to model a relaunch. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const store = require('../src/draft-store.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const PLANK2 = '## D (any)\n\n- Plank | 2 x 60s\n';
const PLANK1 = '## D (any)\n\n- Plank | 1 x 60s\n';
const PUSH = '## D (any)\n\n- Push-ups | 2 x 10\n';
const opts = (storage, planBody) => ({ storage, planBody, settings: { soundMode: 'silent', guideRestSeconds: 0 } });

async function start(storage, planBody) {
  const a = await H.boot(opts(storage, planBody));
  const plan = a.ctx.activePlan(); a.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(a.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return a;
}
function holdFor(a, secs) {
  H.advance(6000);
  const h = a.ctx.state.session.hold;
  H.advance(Math.max(0, h.startedAt + secs * 1000 - Date.now()));
}
/* iOS: backgrounded (the controller writes the draft), then evicted. */
function background(then) {
  H.document.visibilityState = 'hidden';
  for (const fn of (H.docListeners.visibilitychange || []).slice()) fn();
  H.killProcess();
  H.document.visibilityState = 'visible';
}

(async () => {
  await check('F2-2a. a hold paused on set 2 survives the app being evicted: back paused at the same seconds', async () => {
    const storage = H.makeStorage();
    const a = await start(storage, PLANK2);
    holdFor(a, 30); H.tapZone(H.page(a.ctx).querySelector('.gv-session-zone'));   // set 1: 30 s
    holdFor(a, 40); H.click(H.byLabel(H.page(a.ctx), 'Pause'));                   // set 2 paused at 40 s
    background();
    const b = await H.boot(opts(storage, PLANK2));
    b.ctx.resumeDraft(); b.ctx.enterGuided();
    const s = b.ctx.state.session;
    assert.ok(s.hold, 'a hold exists on set 2');
    assert.strictEqual(s.hold.running, true, 'it had begun');
    assert.strictEqual(s.hold.paused, true, 'and is still paused');
    assert.strictEqual(Math.round(s.hold.bankedSeconds), 40, 'at the same seconds');
    assert.ok(H.byLabel(H.page(b.ctx), 'Resume'), 'the screen offers Resume');
    assert.strictEqual(H.countText(b.ctx), '40s');
    H.advance(60000);
    assert.strictEqual(H.countText(b.ctx), '40s', 'a minute later it has not moved');
  });

  await check('F2-2b. a session whose ONLY work is a paused hold on set 1 is still a draft worth keeping', async () => {
    const storage = H.makeStorage();
    const a = await start(storage, PLANK1);
    holdFor(a, 25); H.click(H.byLabel(H.page(a.ctx), 'Pause'));
    background();
    const b = await H.boot(opts(storage, PLANK1));
    assert.ok(b.ctx.state.logDraft, 'the session is offered back (hasDraft would be false before)');
    b.ctx.resumeDraft(); b.ctx.enterGuided();
    const s = b.ctx.state.session;
    assert.ok(s.hold && s.hold.paused === true, 'and its pause with it');
    assert.strictEqual(Math.round(s.hold.bankedSeconds), 25);
  });

  await check('F2-2c. a hold that was merely RUNNING when the app died is not resurrected as paused (as before)', async () => {
    const storage = H.makeStorage();
    const a = await start(storage, PLANK2);
    holdFor(a, 30); H.tapZone(H.page(a.ctx).querySelector('.gv-session-zone'));
    holdFor(a, 20);   // running, never paused
    background();
    const b = await H.boot(opts(storage, PLANK2));
    b.ctx.resumeDraft(); b.ctx.enterGuided();
    const s = b.ctx.state.session;
    assert.ok(!s.hold || !s.hold.paused, 'a running clock is not carried');
  });

  await check('F2-2d. the records broken before the kill are on the restored session (so Bank it pays them)', async () => {
    const storage = H.makeStorage();
    const a = await start(storage, PUSH);
    H.advance(6000);
    const z = H.page(a.ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 14; i++) { H.tapZone(z); H.advance(1000); }               // history best is 12
    H.click(H.byText(H.page(a.ctx), 'Done'));
    assert.strictEqual(a.ctx.state.session.records.length, 1, 'fixture: a PB earned');
    background();
    const b = await H.boot(opts(storage, PUSH));
    b.ctx.resumeDraft(); b.ctx.enterGuided();
    const recs = b.ctx.state.session.records;
    assert.strictEqual(recs.length, 1, 'the PB survived the relaunch');
    assert.strictEqual(recs[0].exercise, 'Push-ups');
    assert.strictEqual(recs[0].kind, 'reps');
    assert.strictEqual(String(recs[0].val), '14');
    assert.strictEqual(String(recs[0].prev), '12');
  });

  await check('F2-2e. leaving and returning (no kill) still carries the tally and the pause, through the same block', async () => {
    const storage = H.makeStorage();
    const a = await start(storage, PLANK2);
    holdFor(a, 30); H.tapZone(H.page(a.ctx).querySelector('.gv-session-zone'));
    holdFor(a, 15); H.click(H.byLabel(H.page(a.ctx), 'Pause'));
    a.ctx.nav('dashboard'); H.advance(30000); a.ctx.enterGuided();
    const s = a.ctx.state.session;
    assert.ok(s.hold && s.hold.paused, 'still paused after an in-process round trip');
    assert.strictEqual(Math.round(s.hold.bankedSeconds), 15);
  });

  await check('F2-2f. draft-store: the live block is whitelisted plain data; garbage in it is dropped, not trusted', () => {
    const draft = {
      date: '2026-01-02', plan: 'P', day: 'D', startedAt: 1, finishing: true,
      entries: [{ exercise: 'Plank', target: '60s', duration: true, weighted: false, distance: false, sets: [{ seconds: '', done: false, touched: false }] }],
      live: {
        records: [{ key: 'Plank/seconds', exercise: 'Plank', kind: 'seconds', val: '70', prev: '40', junk: () => 1 }, 'nope', { exercise: 3 }],
        goalCount: 2, metGoals: ['Plank 70s', 5],
        paused: { kind: 'hold', key: '0:0', bankedSeconds: 33, targetHit: true, lastAnnounced: 30, lastLiveAnnounced: 30, evil: {} },
      },
    };
    const snap = store.snapshotDraft(draft, 5);
    assert.ok(snap, 'a paused hold alone is worth keeping');
    const live = snap.draft.live;
    assert.strictEqual(live.records.length, 1, 'only the well-formed record');
    assert.deepStrictEqual(Object.keys(live.records[0]).sort(), ['exercise', 'key', 'kind', 'prev', 'val']);
    assert.deepStrictEqual(live.metGoals, ['Plank 70s']);
    assert.strictEqual(live.goalCount, 2);
    assert.strictEqual(live.paused.kind, 'hold');
    assert.strictEqual(live.paused.bankedSeconds, 33);
    assert.ok(!('evil' in live.paused));
    assert.ok(!('finishing' in snap.draft));
    const back = store.restoreDraft(JSON.parse(JSON.stringify(snap)), 6);
    assert.ok(back && back.live && back.live.paused.bankedSeconds === 33, 'and it round-trips');
    /* nothing logged and nothing paused: still nothing to keep */
    assert.strictEqual(store.snapshotDraft({ date: '2026-01-02', startedAt: 1, entries: draft.entries, live: { records: [], paused: null } }, 5), null);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 draft live OK (${results.length} cases)`);
})();
