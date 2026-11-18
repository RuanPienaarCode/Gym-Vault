'use strict';
/* WHAT YOU DID LAST TIME, AND YOUR BESTS, ON EACH EXERCISE (issue #28).

   A lifter sitting down at a machine wants three things without leaving the
   log: the sets they did last time, their heaviest set, and their most reps.
   src/recap.js is pure; the log card and the guided live set both print its
   recapLines, so the two screens cannot disagree.

   CONTRACT (written before the code):
     exerciseRecap(workouts, name) -> null | {
       last:     { date, sets: [row] },  the latest-dated session holding it
       best:     { weight, reps } | null, the heaviest SINGLE set (tie: more reps)
       mostReps: { reps, weight } | null, the set with most reps (tie: heavier)
       longest:  seconds | null }
     recapLines(recap) -> [{ label, text }] (Last, Best, Most reps | Longest)
   best.weight and mostReps.reps are pinned to stats.exerciseBests, so the
   exercise page's "best" and this line cannot drift (the repo's recurring
   "two figures, two rules" bug). */
const assert = require('node:assert');
const Module = require('node:module');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {},
  Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p,
} : origLoad(req, ...rest));
const R = require('../src/recap');
const { exerciseBests } = require('../src/stats');
const { fmtShort } = require('../src/dates'); // year-proof: "8 Nov" this year, "8 Nov 2026" after

const w = (date, rows) => ({ fm: { date }, rows });
const lp = (reps, weight_kg) => ({ exercise: 'Leg Press', reps: String(reps), weight_kg: String(weight_kg) });

/* Jeff's own screenshot, as history. */
const history = [
  w('2026-10-20', [lp(12, 160), lp(8, 160)]),
  w('2026-11-01', [lp(14, 140), lp(10, 150)]),
  w('2026-11-08', [lp(10, 120), lp(10, 120), lp(11, 120)]),
  w('2026-11-05', [{ exercise: 'Treadmill', seconds: '300' }]),
];

{ /* best and most reps come from the SAME set, never two maxima glued together */
  const r = R.exerciseRecap(history, 'Leg Press');
  assert.deepStrictEqual(r.best, { weight: 160, reps: 12 }, 'heaviest set: 160 with its own 12 reps');
  assert.deepStrictEqual(r.mostReps, { reps: 14, weight: 140 }, 'most reps: 14 with its own 140');
  const b = exerciseBests(history, 'Leg Press');
  assert.strictEqual(r.best.weight, b.weight, 'one rule with the exercise page');
  assert.strictEqual(r.mostReps.reps, b.reps, 'one rule with the exercise page');
  assert.strictEqual(r.last.date, '2026-11-08');
  assert.deepStrictEqual(r.last.sets.map(s => [s.reps, s.weight_kg]), [['10', '120'], ['10', '120'], ['11', '120']]);
  assert.deepStrictEqual(R.recapLines(r).map(l => [l.label, l.text]), [
    [`Last · ${fmtShort('2026-11-08')}`, '10 × 120 kg · 10 × 120 kg · 11 × 120 kg'],
    ['Best', '12 × 160 kg'],
    ['Most reps', '14 × 140 kg'],
  ]);
}
{ /* "last" is the latest DATE, whatever order the notes come in */
  const r = R.exerciseRecap(history.slice().reverse(), 'Leg Press');
  assert.strictEqual(r.last.date, '2026-11-08', 'order of the list does not decide last');
}
{ /* ties: heaviest set breaks on reps; most reps breaks on weight */
  const r = R.exerciseRecap([w('2026-11-01', [lp(5, 100), lp(8, 100), lp(12, 40), lp(12, 60)])], 'Leg Press');
  assert.deepStrictEqual(r.best, { weight: 100, reps: 8 });
  assert.deepStrictEqual(r.mostReps, { reps: 12, weight: 60 });
}
{ /* never logged, and undated notes cannot be "last" */
  assert.strictEqual(R.exerciseRecap(history, 'Squat'), null);
  assert.strictEqual(R.exerciseRecap([], 'Squat'), null);
  assert.deepStrictEqual(R.recapLines(null), []);
  const r = R.exerciseRecap([w('', [lp(9, 50)]), w('2026-11-02', [lp(7, 40)])], 'Leg Press');
  assert.strictEqual(r.last.date, '2026-11-02', 'a note with no readable date is never last');
  assert.deepStrictEqual(r.best, { weight: 50, reps: 9 }, 'but its sets still count for bests');
}
{ /* bodyweight: no weight, so no Best line; Most reps reads bare */
  const pu = reps => ({ exercise: 'Pull-ups', reps: String(reps), weight_kg: '' });
  const r = R.exerciseRecap([w('2026-11-03', [pu(6), pu(8), pu(5)])], 'Pull-ups');
  assert.strictEqual(r.best, null);
  assert.deepStrictEqual(R.recapLines(r).map(l => [l.label, l.text]), [[`Last · ${fmtShort('2026-11-03')}`, '6 · 8 · 5'], ['Most reps', '8']]);
}
{ /* timed: Last in mm:ss, Longest instead of Best / Most reps */
  const r = R.exerciseRecap(history, 'Treadmill');
  assert.strictEqual(r.longest, 300);
  assert.deepStrictEqual(R.recapLines(r).map(l => [l.label, l.text]), [[`Last · ${fmtShort('2026-11-05')}`, '5:00'], ['Longest', '5:00']]);
}
{ /* a run gets no lines: the Running pages own distance */
  const r = R.exerciseRecap([w('2026-11-03', [{ exercise: 'Run', distance_km: '5', seconds: '1800' }])], 'Run');
  assert.deepStrictEqual(R.recapLines(r), []);
}
{ /* many sets: the first six, then +n, so a card never grows a paragraph */
  const r = R.exerciseRecap([w('2026-11-03', [1, 2, 3, 4, 5, 6, 7, 8].map(n => lp(n, 20)))], 'Leg Press');
  assert.strictEqual(R.recapLines(r)[0].text, '1 × 20 kg · 2 × 20 kg · 3 × 20 kg · 4 × 20 kg · 5 × 20 kg · 6 × 20 kg · +2');
}
{ /* rows with no figures (a blank set) are not "last time" */
  const r = R.exerciseRecap([w('2026-11-01', [lp(9, 30)]), w('2026-11-04', [{ exercise: 'Leg Press', reps: '', weight_kg: '' }])], 'Leg Press');
  assert.strictEqual(r.last.date, '2026-11-01');
}
{ /* two notes on the latest day (morning + evening) are both "last time" */
  const r = R.exerciseRecap([w('2026-11-01', [lp(5, 50)]), w('2026-11-09', [lp(10, 60)]), w('2026-11-09', [lp(8, 65)])], 'Leg Press');
  assert.deepStrictEqual(r.last.sets.map(x => x.weight_kg), ['60', '65'], 'both sessions of the day, in file order');
}
{ /* the card says what the exercise IS: a timed piece shows Last + Longest
     even when an old note logged reps for it; a run shows nothing at all */
  const hist = [w('2026-11-01', [{ exercise: 'Plank', reps: '1', seconds: '40' }]), w('2026-11-06', [{ exercise: 'Plank', seconds: '75' }])];
  const r = R.exerciseRecap(hist, 'Plank');
  assert.deepStrictEqual(R.recapLines(r, 'duration').map(l => l.label), [`Last · ${fmtShort('2026-11-06')}`, 'Longest']);
  assert.strictEqual(R.recapLines(r, 'duration')[1].text, '1:15');
  const run = R.exerciseRecap([w('', [{ exercise: 'Run', distance_km: '5', seconds: '1800' }]), w('2026-10-01', [{ exercise: 'Run', reps: '3' }])], 'Run');
  assert.deepStrictEqual(R.recapLines(run, 'distance'), [], 'a run card never shows lifting lines, whatever its history holds');
  assert.strictEqual(R.kindOf({ exercise: 'Run', distance: true }), 'distance');
  assert.strictEqual(R.kindOf({ exercise: 'Plank', duration: true }), 'duration');
  assert.strictEqual(R.kindOf({ exercise: 'Dips' }), 'reps');
}
{ /* 0 kg is no load: no Best line, and Most reps reads bare */
  const r = R.exerciseRecap([w('2026-11-02', [lp(9, 0), lp(11, 0)])], 'Leg Press');
  assert.strictEqual(r.best, null);
  assert.deepStrictEqual(R.recapLines(r, 'reps').map(l => [l.label, l.text]), [[`Last · ${fmtShort('2026-11-02')}`, '9 · 11'], ['Most reps', '11']]);
}
console.log('recap OK');
