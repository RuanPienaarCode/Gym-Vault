'use strict';
/* AUDIT 16 NOV 2026, findings #8 and #39.

   #8   A session left open (not killed) banked the whole gap as duration_min. The
        3-hour stale-gap correction ran only when a draft was restored after a kill,
        so start a log, tick a set, leave the app open 15 hours and Finish saved
        duration_min: 900, while the same session killed and restored saved a small
        figure. One rule now (draft-store.skipStaleGap), used by the restore path and
        by the live path: a gap longer than STALE_GAP_MS between two activities is not
        part of the workout. The log's clock label and the complete tile read the same
        rule (page-log.sessionMinutes), as the saved note does.
   #39  With two Gym views open, a fresh empty session in one erased the other's saved
        draft: an empty draft saved as "clear the store". A store now clears only a
        copy it wrote or loaded itself.

   Drives the real controller and log page (fake DOM and clock) and the store. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const ds = require('../src/draft-store.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.modals.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const HOUR = 3600 * 1000, MIN = 60 * 1000;
const PLAN = '## D (any)\n\n- Push-ups | 3 x 10\n';
async function log(opts) {
  const b = await H.boot(Object.assign({ planBody: PLAN, exercises: [H.ex('Push-ups')], settings: { soundMode: 'silent' } }, opts));
  const plan = b.ctx.activePlan(); b.ctx.startLog(plan, plan.model.days[0]);
  return b;
}
const tick = (b, i) => H.click(H.page(b.ctx).querySelectorAll('button').filter(x => /Mark done|Mark not done/.test(x.getAttribute('aria-label') || ''))[i]);
const bank = async b => { H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Save session/.test(x.textContent))); await H.flush(); await H.flush(); };

(async () => {
  await check('G1. #8: tick a set, 15 hours open, Finish: duration_min is the workout, not 900', async () => {
    const b = await log();
    H.advance(2 * MIN); tick(b, 0);
    H.advance(15 * HOUR);
    await bank(b);
    assert.strictEqual(b.saved.length, 1, 'fixture: saved');
    assert.ok(b.saved[0].duration_min <= 5, `duration_min ${b.saved[0].duration_min} banked the gap`);
  });

  await check('G2. #8: the log clock label and the complete tile read the same rule as the note', async () => {
    const b = await log();
    H.advance(10 * MIN); tick(b, 0);
    H.advance(15 * HOUR);
    const label = H.page(b.ctx).querySelector('.gv-log-elapsed');
    const { sessionMinutes } = require('../src/page-log.js');
    const m = sessionMinutes(b.ctx.state.logDraft);
    assert.ok(m >= 9 && m <= 12, `sessionMinutes ${m}`);
    const { elapsedMinutes } = require('../src/page-log.js');
    assert.strictEqual(typeof elapsedMinutes, 'function', 'the live label has one function to read');
    assert.strictEqual(elapsedMinutes(b.ctx.state.logDraft), 10, `label minutes ${elapsedMinutes(b.ctx.state.logDraft)}`);
    assert.ok(label, 'fixture: a clock label');
  });

  await check('G3. #8: two stretches of work with a 5 hour gap between count only the work', async () => {
    const b = await log();
    H.advance(10 * MIN); tick(b, 0);
    H.advance(5 * HOUR); tick(b, 1);                   // first activity after the gap
    H.advance(20 * MIN); tick(b, 2);
    const { sessionMinutes } = require('../src/page-log.js');
    const m = sessionMinutes(b.ctx.state.logDraft);
    assert.ok(m >= 29 && m <= 31, `sessionMinutes ${m} (10 + 20 min of work, the 5 hour gap not counted)`);
  });

  await check('G4. #8 control: a long session with no gap over 3 hours keeps its whole length', async () => {
    const b = await log();
    for (let i = 0; i < 3; i++) { H.advance(100 * MIN); tick(b, i); }   // 100-minute gaps
    H.advance(40 * MIN);
    const { sessionMinutes } = require('../src/page-log.js');
    assert.strictEqual(sessionMinutes(b.ctx.state.logDraft), 340, `sessionMinutes ${sessionMinutes(b.ctx.state.logDraft)}`);
  });

  await check('G5. #8: one rule - the restore path and the live path agree', async () => {
    assert.strictEqual(typeof ds.skipStaleGap, 'function', 'the shared rule is exported');
    const start = 1_000_000, last = start + 10 * MIN, now = last + 15 * HOUR;
    assert.strictEqual(ds.skipStaleGap(start, last, now), start + 15 * HOUR, 'a stale gap moves the start on by the gap');
    assert.strictEqual(ds.skipStaleGap(start, last, last + ds.STALE_GAP_MS), start, 'exactly the limit is not stale');
    const d = { date: '2026-11-16', plan: '', day: '', startedAt: start, entries: [{ exercise: 'X', target: '', duration: false, weighted: false, distance: false, sets: [{ reps: '5', done: true, touched: true }] }] };
    const snap = ds.snapshotDraft(d, last);
    const back = ds.restoreDraft(snap, now);
    assert.strictEqual(back.startedAt, ds.skipStaleGap(start, last, now), 'restore applies the same rule');
    assert.strictEqual(Math.round((now - back.startedAt) / MIN), 10);
  });

  await check('G6. #8 control: the same session killed and restored still saves a small duration', async () => {
    const storage = H.makeStorage();
    const a = await log({ storage });
    H.advance(2 * MIN); tick(a, 0);
    H.killProcess();
    H.advance(15 * HOUR);
    const b = await H.boot({ storage, planBody: PLAN, exercises: [H.ex('Push-ups')], settings: { soundMode: 'silent' } });
    b.ctx.resumeDraft();
    await bank(b);
    assert.ok(b.saved[0].duration_min <= 5, `restored duration_min ${b.saved[0].duration_min}`);
  });

  /* ---------- #39 ---------- */
  const mkStore = shared => ds.makeDraftStore({
    saveLocalStorage: (k, v) => { if (v) shared.set(k, JSON.stringify(v)); else shared.delete(k); },
    loadLocalStorage: k => (shared.has(k) ? JSON.parse(shared.get(k)) : null),
  });
  const worked = startedAt => ({ date: '2026-11-16', plan: 'P', day: 'D', startedAt, entries: [{ exercise: 'Push-ups', target: '', duration: false, weighted: false, distance: false, sets: [{ reps: '10', done: true, touched: true }] }] });
  const blank = startedAt => ({ date: '2026-11-16', plan: '', day: '', startedAt, entries: [{ exercise: 'Push-ups', target: '', duration: false, weighted: false, distance: false, sets: [{ reps: 10, done: false, touched: false }] }] });

  await check('G7. #39: a second view saving a fresh EMPTY draft does not erase the first view\'s saved one', async () => {
    const shared = new Map();
    const a = mkStore(shared), b = mkStore(shared);
    assert.strictEqual(a.save(worked(1000)), ds.KEPT);
    assert.strictEqual(b.save(blank(2000)), ds.EMPTY);
    const back = a.load();
    assert.ok(back && back.entries[0].sets[0].done, 'the first view\'s draft was erased by the other view\'s empty one');
  });

  await check('G8. #39 control: a view that un-ticks everything it wrote still clears its own copy', async () => {
    const shared = new Map();
    const a = mkStore(shared);
    a.save(worked(1000));
    assert.strictEqual(a.save(blank(1000)), ds.EMPTY);
    assert.strictEqual(a.load(), null, 'the draft this view wrote and then emptied must go');
  });

  await check('G9. #39 control: a view that RESTORED a copy and then empties it clears it too', async () => {
    const shared = new Map();
    mkStore(shared).save(worked(1000));
    const b = mkStore(shared);
    const back = b.load();
    assert.ok(back, 'fixture: restored');
    assert.strictEqual(b.save(blank(back.startedAt)), ds.EMPTY);
    assert.strictEqual(mkStore(shared).load(), null);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1116 session draft gap OK (${results.length} cases)`);
  process.exit(0);
})();
