'use strict';
/* K5: ONE minutes rule for a finished session. duration_min used to be the time
   the log page was open, so a 30-min run logged afterwards saved `1` and History
   read "1 SET - 1 MIN". sessionMinutes(draft, now) =
   max(1, round(elapsed minutes), round(entered work time: seconds + run minutes)).
   A floor from the work you entered, never a reduction of a live clock. */
const assert = require('node:assert');
const { loadSrc } = require('./gym-fake-vault');
const pageLog = loadSrc('page-log.js');

const NOW = 1_800_000_000_000;
const set = o => Object.assign({ reps: '', weight_kg: '', seconds: '', done: true, touched: true }, o);
const run = (km, minutes) => ({ exercise: 'Easy Run', distance: true, sets: [{ distance_km: km, minutes, done: false, touched: true }] });
const lift = (...sets) => ({ exercise: 'Pull-ups', distance: false, sets });
const draft = (entries, agoMin) => ({ date: '2026-10-20', plan: 'P', day: 'D', startedAt: NOW - agoMin * 60000, entries });

assert.strictEqual(typeof pageLog.sessionMinutes, 'function', 'page-log exports sessionMinutes');
const sm = pageLog.sessionMinutes;
assert.strictEqual(sm(draft([run('5', '30')], 1), NOW), 30, 'a 30 min run logged after the fact reads 30, not the minute the page was open');
assert.strictEqual(sm(draft([run('5', '30')], 45), NOW), 45, 'a live clock that is longer still wins');
assert.strictEqual(sm(draft([lift(set({ reps: '8' }))], 0), NOW), 1, 'never below 1');
assert.strictEqual(sm(draft([lift(set({ reps: '8' }))], 12), NOW), 12, 'no work time entered: elapsed, as before');
assert.strictEqual(sm(draft([lift(set({ seconds: '90' }), set({ seconds: '90' }))], 0), NOW), 3, 'seconds across counted sets: 180 s = 3 min');
assert.strictEqual(sm(draft([run('5', '30'), lift(set({ seconds: '120' }))], 0), NOW), 32, 'run minutes + hold seconds add');
assert.strictEqual(sm(draft([lift({ reps: '8', seconds: '600', done: false, touched: false })], 0), NOW), 1, 'an untouched prefill is not work time (setCounts)');
assert.strictEqual(sm(draft([run('', '')], 0), NOW), 1, 'an empty run set counts nothing (setWorthSaving)');

/* finishSession writes it */
(async () => {
  let saved = null;
  const d = draft([run('5', '30')], 1); d.startedAt = Date.now() - 60000;
  const ctx = {
    settings: { rewards: false }, data: { workouts: [], exercises: [] }, state: { logDraft: d },
    io: { saveWorkout: async w => { saved = w; return 'Gym/Workouts/x.md'; } },
    notice: () => {}, nav: () => {}, reload: () => {},
  };
  await pageLog.finishSession(ctx, d);
  assert.strictEqual(saved && saved.duration_min, 30, `finishSession saved duration_min ${saved && saved.duration_min}`);
  console.log('f3 K5 session minutes OK');
})().catch(e => { console.error(e); process.exit(1); });
