'use strict';
/* PROGRESS AND PERSONAL-BEST DERIVATIONS (Apex skin, Lane B).

   Every number the new Today / live-set / completion / Records elements print
   is computed by a pure function in src/progress.js (and records.latestRecord),
   and each of those reads its figures from the rules that already exist:
   records.previousBest / isRecord / recordHistory / claimableKinds for bests,
   stats.sessionsInWeek / weekStreak for the week. This file pins both halves:
   the arithmetic, and that nothing here grew a second rule.

   CONTRACT (written before the code):
     pbTarget(best, current)      -> null | {best, current, beaten, over, toGo, pct}
     pbDelta(old, new)            -> null | {abs, pct|null}
     marginText(kind, abs)        -> "+2 reps" | "+2.5 kg" | "+5s"
     pctText(pct)                 -> "+16.7%"
     liveBest(workouts, ex, entry, observed) -> number | null
     pbInReach(items, workouts, exercises)   -> null | {exercise, kind, best, target}
     reachText(reach)             -> "PB in reach · best 12, hit 13"
     weekPlan(daysOn, today, weekStart)      -> [{iso, wk, planDay}] x7
     weekProgress({workouts, goals, daysOn, today, weekStart})
                                  -> null | {done, target, source, pct, toGo, met}
     streakRisk(streak, wp, today, weekStart) -> null | {streak, by}
     records.latestRecord(workouts, exercises) -> null | {exercise, kind, value, prev, date} */
const assert = require('node:assert');
const Module = require('node:module');

/* progress.js formats seconds through dom.fmtSeconds (the one formatter), and
   dom.js imports obsidian. The stub is the repo's usual one. */
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {},
  Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p,
} : origLoad(req, ...rest));
const P = require('../src/progress');
const records = require('../src/records');
const { weekStreak, workoutDates } = require('../src/stats');
Module._load = origLoad;

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); } catch (e) { failures++; console.error('  FAIL ' + name + '\n       ' + e.message); }
};

/* ------------------------------------------------------------------ */
/* pbTarget — the live "Beat 12 / You're on 6 / 7 to go" figure.        */
/* ------------------------------------------------------------------ */

check('pbTarget: the design example (best 12, on 6) is 7 to go at 50%', () => {
  assert.deepStrictEqual(P.pbTarget(12, 6), { best: 12, current: 6, beaten: false, over: 0, toGo: 7, pct: 50 });
});
check('pbTarget: matching the best is NOT a record (isRecord says a tie beats nothing) — 1 to go, 100%', () => {
  const t = P.pbTarget(12, 12);
  assert.strictEqual(t.beaten, false);
  assert.strictEqual(t.toGo, 1);
  assert.strictEqual(t.pct, 100);
});
check('pbTarget: one past the best is beaten, nothing to go, and says by how much', () => {
  const t = P.pbTarget(12, 13);
  assert.strictEqual(t.beaten, true);
  assert.strictEqual(t.toGo, 0);
  assert.strictEqual(t.over, 1);
  assert.strictEqual(t.pct, 100, 'the bar is capped at 100 even when the count runs past the best');
});
check('pbTarget: the bar is capped at 100 far past the best', () => {
  assert.strictEqual(P.pbTarget(10, 25).pct, 100);
});
check('pbTarget: a fractional best needs the next whole figure (12.5 -> 13)', () => {
  const t = P.pbTarget(12.5, 12);
  assert.strictEqual(t.toGo, 1);
  assert.strictEqual(P.pbTarget(12.5, 13).beaten, true, 'agrees with isRecord(12.5, 13)');
});
check('pbTarget: beaten always agrees with records.isRecord', () => {
  for (const best of [1, 8, 12, 12.5, 45]) for (const cur of [0, 1, 7, 8, 9, 12, 13, 46]) {
    assert.strictEqual(P.pbTarget(best, cur).beaten, records.isRecord(best, cur), `best ${best} cur ${cur}`);
  }
});
check('pbTarget: nothing to beat -> null (never a "Beat 0" or a divide by zero)', () => {
  assert.strictEqual(P.pbTarget(null, 3), null);
  assert.strictEqual(P.pbTarget(undefined, 3), null);
  assert.strictEqual(P.pbTarget(0, 3), null);
  assert.strictEqual(P.pbTarget('x', 3), null);
});
check('pbTarget: a count of 0 is 0%, and 13 to go', () => {
  const t = P.pbTarget(12, 0);
  assert.strictEqual(t.pct, 0);
  assert.strictEqual(t.toGo, 13);
});

/* ------------------------------------------------------------------ */
/* pbDelta / marginText / pctText — the completion screen's chips.      */
/* ------------------------------------------------------------------ */

check('pbDelta: 12 -> 14 is +2 and +16.7%', () => {
  assert.deepStrictEqual(P.pbDelta(12, 14), { abs: 2, pct: 16.7 });
});
check('pbDelta: accepts the string a set holds', () => {
  assert.deepStrictEqual(P.pbDelta(12, '14'), { abs: 2, pct: 16.7 });
});
check('pbDelta: kg steps keep one decimal, no float dust', () => {
  assert.deepStrictEqual(P.pbDelta(80, 82.5), { abs: 2.5, pct: 3.1 });
  assert.strictEqual(P.pbDelta(0.1 + 0.2, 1).abs, 0.7);
});
check('pbDelta: a first-ever best has no old value -> null (no 0, no %)', () => {
  assert.strictEqual(P.pbDelta(null, 14), null);
  assert.strictEqual(P.pbDelta(undefined, 14), null);
  assert.strictEqual(P.pbDelta('', 14), null);
});
check('pbDelta: an old best of 0 has an absolute gain but no percentage (no divide by zero)', () => {
  assert.deepStrictEqual(P.pbDelta(0, 5), { abs: 5, pct: null });
});
check('pbDelta: not an improvement -> null', () => {
  assert.strictEqual(P.pbDelta(12, 12), null);
  assert.strictEqual(P.pbDelta(12, 10), null);
  assert.strictEqual(P.pbDelta(12, 'nope'), null);
});
check('marginText: per kind, singular and plural', () => {
  assert.strictEqual(P.marginText('reps', 2), '+2 reps');
  assert.strictEqual(P.marginText('reps', 1), '+1 rep');
  assert.strictEqual(P.marginText('weight', 2.5), '+2.5 kg');
  assert.strictEqual(P.marginText('seconds', 5), '+5s');
  assert.strictEqual(P.marginText('seconds', 75), '+1:15');
  assert.strictEqual(P.marginText('distance', 3), '');
});
check('pctText', () => {
  assert.strictEqual(P.pctText(16.7), '+16.7%');
  assert.strictEqual(P.pctText(20), '+20%');
});

/* ------------------------------------------------------------------ */
/* liveBest — the best a live screen may show a target against.         */
/* ------------------------------------------------------------------ */

const w = (date, rows) => ({ name: date, fm: { date }, rows });
const row = (exercise, o) => Object.assign({ exercise, set: 1, reps: '', weight_kg: '', seconds: '', distance_km: '' }, o);
const ex = (name, unit) => ({ name, fm: { unit } });

const HISTORY = [
  w('2026-01-01', [row('Push-ups', { reps: '12' }), row('Plank', { seconds: '40' }), row('Squat', { reps: '8', weight_kg: '60' })]),
  w('2026-01-05', [row('Push-ups', { reps: '10' }), row('Run', { distance_km: '5', seconds: '1500' })]),
];
const EXS = [ex('Push-ups', 'reps'), ex('Plank', 'seconds'), ex('Squat', 'kg'), ex('Run', 'km')];
const entryOf = o => Object.assign({ exercise: 'Push-ups', duration: false, weighted: false, distance: false }, o);
const OBS_REPS = ['reps'], OBS_SECONDS = ['seconds'];

check('liveBest: reps screen, plain reps entry -> records.previousBest(reps)', () => {
  assert.strictEqual(P.liveBest(HISTORY, EXS[0], entryOf(), OBS_REPS), records.previousBest(HISTORY, 'Push-ups', 'reps'));
  assert.strictEqual(P.liveBest(HISTORY, EXS[0], entryOf(), OBS_REPS), 12);
});
check('liveBest: hold screen, duration entry -> the seconds best', () => {
  assert.strictEqual(P.liveBest(HISTORY, EXS[1], entryOf({ exercise: 'Plank', duration: true }), OBS_SECONDS), 40);
});
check('liveBest: a screen that does NOT observe the kind shows no target (the trust rule)', () => {
  assert.strictEqual(P.liveBest(HISTORY, EXS[1], entryOf({ exercise: 'Plank', duration: true }), OBS_REPS), null);
  assert.strictEqual(P.liveBest(HISTORY, EXS[0], entryOf(), []), null, 'a timed interval observes nothing');
});
check('liveBest: a weighted entry is a WEIGHT record, which the reps screen never observes -> none', () => {
  assert.strictEqual(P.liveBest(HISTORY, EXS[2], entryOf({ exercise: 'Squat', weighted: true }), OBS_REPS), null);
});
check('liveBest: a run has no record concept', () => {
  assert.strictEqual(P.liveBest(HISTORY, EXS[3], entryOf({ exercise: 'Run', distance: true }), OBS_REPS), null);
});
check('liveBest: never logged -> null, not 0 (nothing to beat)', () => {
  assert.strictEqual(P.liveBest(HISTORY, ex('Dips', 'reps'), entryOf({ exercise: 'Dips' }), OBS_REPS), null);
});
check('liveBest: claimableKinds gates it — a REP exercise with a circuit clock reading has no hold to beat', () => {
  const circuit = [w('2026-01-01', [row('Push-ups', { reps: '10', seconds: '45' })])];
  assert.strictEqual(P.liveBest(circuit, ex('Push-ups', 'reps'), entryOf({ duration: true }), OBS_SECONDS), null);
});
check('liveBest: reads the snapshot it is given, so this session\'s own sets never move the target', () => {
  const before = P.liveBest(HISTORY, EXS[0], entryOf(), OBS_REPS);
  const during = HISTORY.concat([w('2026-02-01', [row('Push-ups', { reps: '20' })])]);
  assert.strictEqual(before, 12);
  assert.strictEqual(P.liveBest(during, EXS[0], entryOf(), OBS_REPS), 20, 'sanity: the function does read what it is given');
});

/* ------------------------------------------------------------------ */
/* entryShape / classifyKind — the item's session kind.                 */
/* ------------------------------------------------------------------ */

check('classifyKind: run / duration / weighted / reps, in that order of precedence', () => {
  assert.strictEqual(P.classifyKind({ distance: true, duration: true, weighted: true }), null);
  assert.strictEqual(P.classifyKind({ duration: true, weighted: true }), 'seconds');
  assert.strictEqual(P.classifyKind({ weighted: true }), 'weight');
  assert.strictEqual(P.classifyKind({}), 'reps');
});
check('entryShape: unit and written target decide, exactly as page-log.makeEntry does', () => {
  assert.deepStrictEqual(P.entryShape(ex('A', 'km'), '30 min'), { distance: true, duration: false, weighted: false });
  assert.deepStrictEqual(P.entryShape(ex('A', 'seconds'), ''), { distance: false, duration: true, weighted: false });
  assert.deepStrictEqual(P.entryShape(ex('A', 'reps'), '20s'), { distance: false, duration: true, weighted: false }, 'a written duration wins over the note unit');
  assert.deepStrictEqual(P.entryShape(ex('A', 'kg'), '8'), { distance: false, duration: false, weighted: true });
  assert.deepStrictEqual(P.entryShape(ex('A', 'reps'), '8 @ 20kg'), { distance: false, duration: false, weighted: true });
  assert.deepStrictEqual(P.entryShape(null, '8'), { distance: false, duration: false, weighted: false }, 'a plan line with no note');
});

/* ------------------------------------------------------------------ */
/* pbInReach — Today's one nudge.                                       */
/* ------------------------------------------------------------------ */

const item = (exercise, target) => ({ exercise, sets: 3, target });

check('pbInReach: first item with a prior best wins; reps target is best + 1', () => {
  const r = P.pbInReach([item('Dips', 'AMRAP'), item('Push-ups', '10'), item('Plank', '30s')], HISTORY, EXS.concat(ex('Dips', 'reps')));
  assert.deepStrictEqual(r, { index: 1, exercise: 'Push-ups', kind: 'reps', best: 12, target: 13 });
});
check('pbInReach: skips items that were never logged', () => {
  const r = P.pbInReach([item('Dips', 'AMRAP')], HISTORY, EXS.concat(ex('Dips', 'reps')));
  assert.strictEqual(r, null);
});
check('pbInReach: a hold is best + 5 s', () => {
  const r = P.pbInReach([item('Plank', '30s')], HISTORY, EXS);
  assert.deepStrictEqual(r, { index: 0, exercise: 'Plank', kind: 'seconds', best: 40, target: 45 });
});
check('pbInReach: a weighted exercise reaches for WEIGHT (best + 2.5 kg), the kind a session would celebrate', () => {
  const r = P.pbInReach([item('Squat', '8')], HISTORY, EXS);
  assert.deepStrictEqual(r, { index: 0, exercise: 'Squat', kind: 'weight', best: 60, target: 62.5 });
});
check('pbInReach: a run never has one', () => {
  assert.strictEqual(P.pbInReach([item('Run', '30 min')], HISTORY, EXS), null);
});
check('pbInReach: a claimable gate — Push-ups\' circuit clock is not a hold to beat', () => {
  const circuit = [w('2026-01-01', [row('Push-ups', { seconds: '45' })])];
  assert.strictEqual(P.pbInReach([item('Push-ups', '20s')], circuit, [ex('Push-ups', 'reps')]), null);
});
check('pbInReach: empty plan day -> null', () => {
  assert.strictEqual(P.pbInReach([], HISTORY, EXS), null);
  assert.strictEqual(P.pbInReach(null, HISTORY, EXS), null);
});
check('pbInReach: name matching is case/space folded like every other best', () => {
  const r = P.pbInReach([item('  push-UPS ', '10')], HISTORY, EXS);
  assert.ok(r && r.best === 12);
});
check('reachText', () => {
  assert.strictEqual(P.reachText({ kind: 'reps', best: 12, target: 13 }), 'PB in reach · best 12, hit 13');
  assert.strictEqual(P.reachText({ kind: 'weight', best: 60, target: 62.5 }), 'PB in reach · best 60 kg, hit 62.5 kg');
  assert.strictEqual(P.reachText({ kind: 'seconds', best: 40, target: 45 }), 'PB in reach · best 40s, hit 45s');
});

/* ------------------------------------------------------------------ */
/* week plan / progress / streak risk                                   */
/* ------------------------------------------------------------------ */

/* 2026-10-07 is a Wednesday. Week (mon start) = 5 Oct .. 11 Oct. */
const TODAY = '2026-10-07';
const lift = { name: 'A · Pull', items: [], notes: [] };
const legs = { name: 'B · Legs', items: [], notes: [] };
const restDay = { name: 'Rest & recovery', items: [], notes: [] };
const SCHEDULE = { mon: lift, tue: legs, wed: restDay, thu: lift, fri: null, sat: legs, sun: null };
const daysOn = wk => (SCHEDULE[wk] ? [{ plan: {}, day: SCHEDULE[wk] }] : []);
const sess = d => w(d, [row('Push-ups', { reps: '10' })]);

check('weekPlan: seven days from the week start, rest and empty days have no planDay', () => {
  const wp = P.weekPlan(daysOn, TODAY, 'mon');
  assert.deepStrictEqual(wp.map(d => d.iso), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  assert.deepStrictEqual(wp.map(d => !!d.planDay), [true, true, false, true, false, true, false]);
  assert.deepStrictEqual(wp.map(d => d.wk), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
});
check('weekPlan: honours a Sunday week start', () => {
  const wp = P.weekPlan(daysOn, TODAY, 'sun');
  assert.strictEqual(wp[0].iso, '2026-10-04');
  assert.strictEqual(wp[0].wk, 'sun');
});

check('weekProgress: target = non-rest scheduled days (4); done = sessionsInWeek', () => {
  const p = P.weekProgress({ workouts: [sess('2026-10-05'), sess('2026-10-06')], goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.deepStrictEqual(p, { done: 2, target: 4, source: 'plan', pct: 50, toGo: 2, met: false });
});
check('weekProgress: counts SESSIONS (two on one day are two), the same rule as the tile beside it', () => {
  const p = P.weekProgress({ workouts: [sess('2026-10-05'), sess('2026-10-05')], goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(p.done, 2);
});
check('weekProgress: sessions outside the week do not count', () => {
  const p = P.weekProgress({ workouts: [sess('2026-10-04'), sess('2026-10-12')], goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(p.done, 0);
});
check('weekProgress: a workouts-per-week goal overrides the plan', () => {
  const goals = [{ name: 'g', fm: { metric: 'workouts-per-week', target: 3 } }];
  const p = P.weekProgress({ workouts: [sess('2026-10-05')], goals, daysOn, today: TODAY, weekStart: 'mon' });
  assert.deepStrictEqual(p, { done: 1, target: 3, source: 'goal', pct: 33, toGo: 2, met: false });
});
check('weekProgress: other goal metrics are ignored', () => {
  const goals = [{ name: 'g', fm: { metric: 'exercise-reps', exercise: 'Push-ups', target: 30 } }];
  assert.strictEqual(P.weekProgress({ workouts: [], goals, daysOn, today: TODAY, weekStart: 'mon' }).target, 4);
});
check('weekProgress: at target is met, "0 to go", pct 100; past target is capped', () => {
  const four = ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-10'].map(sess);
  const p = P.weekProgress({ workouts: four, goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(p.met, true); assert.strictEqual(p.toGo, 0); assert.strictEqual(p.pct, 100);
  const six = four.concat([sess('2026-10-07'), sess('2026-10-09')]);
  const q = P.weekProgress({ workouts: six, goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(q.done, 6); assert.strictEqual(q.pct, 100); assert.strictEqual(q.toGo, 0);
});
check('weekProgress: a rest-only week with no goal has no target -> null (the ring is hidden)', () => {
  const restOnly = wk => [{ plan: {}, day: restDay }];
  assert.strictEqual(P.weekProgress({ workouts: [], goals: [], daysOn: restOnly, today: TODAY, weekStart: 'mon' }), null);
  assert.strictEqual(P.weekProgress({ workouts: [], goals: [], daysOn: () => [], today: TODAY, weekStart: 'mon' }), null);
});
check('weekProgress: a nonsense goal target falls back to the plan', () => {
  const goals = [{ name: 'g', fm: { metric: 'workouts-per-week', target: 0 } }];
  assert.strictEqual(P.weekProgress({ workouts: [], goals, daysOn, today: TODAY, weekStart: 'mon' }).source, 'plan');
});

check('streakRisk: alive streak and NOTHING logged this week -> the streak itself, and the day it ends', () => {
  const wp = { done: 0, target: 4, toGo: 4, met: false };
  assert.deepStrictEqual(P.streakRisk(9, wp, TODAY, 'mon'), { streak: 9, by: 'Sunday' });
  assert.deepStrictEqual(P.streakRisk(9, wp, TODAY, 'sun'), { streak: 9, by: 'Saturday' });
});
check('streakRisk: one session done but UNDER target is NOT a risk (weekStreak survives on one session)', () => {
  assert.strictEqual(P.streakRisk(9, { done: 1, target: 4, toGo: 3, met: false }, TODAY, 'mon'), null);
  assert.strictEqual(P.streakRisk(9, { done: 3, target: 4, toGo: 1, met: false }, TODAY, 'mon'), null);
});
check('streakRisk: hidden with no streak', () => {
  assert.strictEqual(P.streakRisk(0, { done: 0, target: 4, toGo: 4, met: false }, TODAY, 'mon'), null);
});
check('streakRisk: hidden once the target is met', () => {
  assert.strictEqual(P.streakRisk(9, { done: 4, target: 4, toGo: 0, met: true }, TODAY, 'mon'), null);
});
check('streakRisk: hidden when the week has no target (rest-only)', () => {
  assert.strictEqual(P.streakRisk(9, null, TODAY, 'mon'), null);
});
check('streakRiskText names the streak and what keeps it', () => {
  assert.strictEqual(P.streakRiskText({ streak: 9, by: 'Sunday' }), "Don't break it · 1 session by Sunday keeps your 9-week streak");
  assert.strictEqual(P.streakRiskText({ streak: 1, by: 'Saturday' }), "Don't break it · 1 session by Saturday keeps your 1-week streak");
});
check('streakRisk is fed by the SAME streak rule the flame uses (stats.weekStreak), and the week really is empty', () => {
  const ws = [sess('2026-09-28')];
  const streak = weekStreak(workoutDates(ws), 'mon', TODAY);
  assert.strictEqual(streak, 1, 'last week counts while this week is still empty');
  const wp = P.weekProgress({ workouts: ws, goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(wp.done, 0);
  assert.deepStrictEqual(P.streakRisk(streak, wp, TODAY, 'mon'), { streak: 1, by: 'Sunday' });
  /* ...and a first session this week makes the same streak safe. */
  const ws2 = ws.concat([sess('2026-10-05')]);
  const wp2 = P.weekProgress({ workouts: ws2, goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(P.streakRisk(weekStreak(workoutDates(ws2), 'mon', TODAY), wp2, TODAY, 'mon'), null);
});

/* ------------------------------------------------------------------ */
/* records.latestRecord — the Records page's "new" row.                 */
/* ------------------------------------------------------------------ */

const REC_HIST = [
  w('2026-01-01', [row('Push-ups', { reps: '12' }), row('Bench', { weight_kg: '60' })]),
  w('2026-02-01', [row('Push-ups', { reps: '14' })]),
  w('2026-03-01', [row('Bench', { weight_kg: '65' }), row('Plank', { seconds: '100' })]),
];
const REC_EXS = [ex('Push-ups', 'reps'), ex('Bench', 'kg'), ex('Plank', 'seconds')];

check('latestRecord: the most recently BEATEN best, with what it beat', () => {
  const r = records.latestRecord(REC_HIST, REC_EXS);
  assert.deepStrictEqual(r, { exercise: 'Bench', kind: 'weight', value: 65, prev: 60, date: '2026-03-01' });
});
check('latestRecord: a first-ever figure is a baseline, not a record (Plank 2026-03-01 is newest but never beaten)', () => {
  assert.notStrictEqual(records.latestRecord(REC_HIST, REC_EXS).exercise, 'Plank');
});
check('latestRecord: agrees with recordHistory and allRecords (same value, same date)', () => {
  const r = records.latestRecord(REC_HIST, REC_EXS);
  const h = records.recordHistory(REC_HIST, r.exercise, r.kind);
  assert.strictEqual(h[h.length - 1].value, r.value);
  assert.strictEqual(h[h.length - 1].prev, r.prev);
  const all = records.allRecords(REC_HIST, REC_EXS).find(x => x.exercise === r.exercise && x.kind === r.kind);
  assert.strictEqual(all.value, r.value);
  assert.strictEqual(all.date, r.date);
});
check('latestRecord: only baselines -> null', () => {
  assert.strictEqual(records.latestRecord([w('2026-01-01', [row('Push-ups', { reps: '12' })])], REC_EXS), null);
  assert.strictEqual(records.latestRecord([], REC_EXS), null);
});
check('latestRecord: respects claimableKinds (a circuit clock on Push-ups is not a record)', () => {
  const hist = [
    w('2026-01-01', [row('Push-ups', { reps: '10', seconds: '30' })]),
    w('2026-04-01', [row('Push-ups', { reps: '10', seconds: '45' })]),
  ];
  assert.strictEqual(records.latestRecord(hist, [ex('Push-ups', 'reps')]), null);
});
check('latestRecord: a tie on the date keeps the first in allRecords order (deterministic)', () => {
  const hist = [
    w('2026-01-01', [row('Push-ups', { reps: '10' }), row('Pull-ups', { reps: '5' })]),
    w('2026-02-01', [row('Push-ups', { reps: '11' }), row('Pull-ups', { reps: '6' })]),
  ];
  const r = records.latestRecord(hist, [ex('Push-ups', 'reps'), ex('Pull-ups', 'reps')]);
  assert.strictEqual(r.exercise, 'Push-ups');
});

if (failures) { console.error(`${failures} progress check(s) failed`); process.exit(1); }
console.log('progress OK');
