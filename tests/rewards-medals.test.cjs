'use strict';
/* THE NINE STARTER MEDALS (rewards.medals / newMedals): pure functions of
   workouts + exercises, derived from the FULL history, never forward-counted.
   Every figure is cross-checked against the seam the rest of the app reads,
   computed here by a different route (brute force over stats / records).

   Named cases:
     M1  nine medals in the contract order, empty history = all locked at 0
     M2  the declared thresholds (a table: changing one must be a conscious edit)
     M3  tier boundaries for every medal: one below / exact, for every tier
     M4  progress to the next tier: next, floor pct, never 100 while locked, 100 at the top
     M5  earned dates come from walking the history in order (and ignore input order)
     M6  a workout with an unreadable date: counts where the app counts it, earns no date
     M7  10K Club volume == the sum of stats.sessionVolume (History's own figure)
     M8  Rep Machine == total reps; Distance Club == distance_km rows only (== exerciseBests totals)
     M9  Personal Best Hunter / First PB == allRecords' times-1 (recordHistory), baselines excluded
     M10 Iron Week == max stats.sessionsInWeek, for both weekStart settings
     M11 Week Streak == the longest stats.weekStreak the history ever reached
     M12 Consistency == consecutive weeks with >= 3 sessions
     M13 monotone: more history never lowers a tier or a value; shuffled input gives the same result
     M14 newMedals reports only the tiers gained, including a skipped tier */
const assert = require('node:assert');
const R = require('../src/rewards');
const stats = require('../src/stats');
const records = require('../src/records');
const { addDays, startOfWeek } = require('../src/dates');
const F = require('./rewards-fixtures');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const D0 = '2026-01-05';                       // a Monday
const d = n => addDays(D0, n);
const med = (list, key) => list.find(m => m.key === key);
const all = (workouts, over) => R.medals({ workouts, exercises: F.EXERCISES, weekStart: 'mon', ...over });
const one = (key, workouts, over) => med(all(workouts, over), key);
/* one single-row workout */
const lift = (date, o, name) => F.wk(date, [F.row(o.ex || 'Squat', o)], name);

const KEYS = ['first-pb', 'iron-week', 'week-streak', '10k-club', 'century', 'rep-machine', 'distance-club', 'consistency', 'pb-hunter'];
const THRESHOLDS = {
  'first-pb': [1], 'iron-week': [3, 4, 5], 'week-streak': [3, 5, 10], '10k-club': [10000, 50000, 100000],
  century: [25, 100, 250], 'rep-machine': [1000, 5000, 10000], 'distance-club': [50, 250, 1000],
  consistency: [4, 8, 12], 'pb-hunter': [5, 25, 100],
};

/* A history whose figure for `key` is exactly `v`. */
const BUILD = {
  'first-pb': v => pbHistory(v),
  'pb-hunter': v => pbHistory(v),
  '10k-club': v => [lift(d(0), { kg: v, reps: 1 })],
  century: v => Array.from({ length: v }, (_, i) => lift(d(i), { reps: 1, kg: 1 })),
  'rep-machine': v => [lift(d(0), { reps: v })],
  'distance-club': v => [F.wk(d(0), [F.row('Easy Run', { km: v })])],
  'iron-week': v => Array.from({ length: v }, (_, i) => lift(d(i), { reps: 1 })),                  // Mon..: one week
  'week-streak': v => Array.from({ length: v }, (_, i) => lift(d(i * 7), { reps: 1 })),
  consistency: v => Array.from({ length: v * 3 }, (_, i) => lift(d(Math.floor(i / 3) * 7 + (i % 3)), { reps: 1 })),
};
/* `v` PBs: a baseline, then v strict improvements on one rep exercise */
function pbHistory(v) {
  if (v === 0) return [];
  return Array.from({ length: v + 1 }, (_, i) => F.wk(d(i), [F.row('Push-ups', { reps: 10 + i })]));
}

check('M1 nine medals in the contract order; empty history = all locked at 0', () => {
  const list = all([]);
  assert.deepStrictEqual(list.map(m => m.key), KEYS);
  for (const m of list) {
    assert.strictEqual(m.tier, 'locked', m.key);
    assert.strictEqual(m.tierIndex, -1);
    assert.strictEqual(m.progress.value, 0, m.key);
    assert.strictEqual(m.progress.next, THRESHOLDS[m.key][0]);
    assert.strictEqual(m.progress.pct, 0);
    assert.deepStrictEqual(m.earned, { bronze: null, silver: null, gold: null });
    assert.strictEqual(m.earnedOn, null);
    assert.strictEqual(m.complete, false);
    assert.ok(m.name && m.desc && m.unit !== undefined);
  }
  assert.strictEqual(all(null).length, 9, 'null history is an empty history');
});

check('M2 the declared thresholds', () => {
  for (const m of all([])) assert.deepStrictEqual(m.tiers.map(t => t.at), THRESHOLDS[m.key], m.key);
  assert.deepStrictEqual(med(all([]), 'iron-week').tiers.map(t => t.tier), ['bronze', 'silver', 'gold']);
  assert.deepStrictEqual(med(all([]), 'first-pb').tiers.map(t => t.tier), ['bronze']);
});

check('M3 tier boundaries for every medal: one below / exact, every tier', () => {
  for (const key of KEYS) {
    const at = THRESHOLDS[key];
    const names = ['bronze', 'silver', 'gold'];
    for (let i = 0; i < at.length; i++) {
      const below = one(key, BUILD[key](at[i] - 1));
      assert.strictEqual(below.tier, i === 0 ? 'locked' : names[i - 1], `${key}: ${at[i] - 1} must not reach ${names[i]}`);
      const exact = one(key, BUILD[key](at[i]));
      assert.strictEqual(exact.tier, names[i], `${key}: exactly ${at[i]} must reach ${names[i]}`);
      assert.strictEqual(exact.progress.value, at[i], `${key} value at ${at[i]}`);
    }
  }
});

check('M4 progress: next, floor pct, never 100 while locked, 100 at the top', () => {
  const v = one('10k-club', [lift(d(0), { kg: 7200, reps: 1 })]);
  assert.deepStrictEqual(v.progress, { value: 7200, next: 10000, pct: 72 }, 'the mockup\'s "10K Club 72%"');
  assert.strictEqual(one('10k-club', [lift(d(0), { kg: 9999, reps: 1 })]).progress.pct, 99, '9999 of 10000 is 99, not 100');
  const silver = one('10k-club', [lift(d(0), { kg: 60000, reps: 1 })]);
  assert.deepStrictEqual([silver.tier, silver.progress.next, silver.progress.pct], ['silver', 100000, 60]);
  const gold = one('10k-club', [lift(d(0), { kg: 250000, reps: 1 })]);
  assert.deepStrictEqual([gold.tier, gold.progress.next, gold.progress.pct, gold.complete], ['gold', null, 100, true]);
  const fp = one('first-pb', pbHistory(2));
  assert.deepStrictEqual([fp.tier, fp.progress.next, fp.progress.pct, fp.complete], ['bronze', null, 100, true]);
  for (const key of KEYS) for (const n of [0, 1, 2, 3, 7, 24, 99]) {
    const m = one(key, BUILD[key](n));
    if (!m.complete) assert.ok(m.progress.pct >= 0 && m.progress.pct <= 99, `${key}@${n} pct ${m.progress.pct}`);
  }
});

check('M5 earned dates come from walking the history in order, whatever order it arrives in', () => {
  const w = [lift(d(30), { kg: 4000, reps: 1 }), lift(d(10), { kg: 4000, reps: 1 }), lift(d(20), { kg: 4000, reps: 1 })];
  const m = one('10k-club', w);
  assert.strictEqual(m.tier, 'bronze');
  assert.strictEqual(m.earned.bronze, d(30), '4000 + 4000 + 4000 crosses 10,000 on the LAST dated session');
  assert.strictEqual(m.earned.silver, null);
  assert.strictEqual(m.earnedOn, d(30));
  /* two tiers at different dates */
  const big = [lift(d(0), { kg: 12000, reps: 1 }), lift(d(5), { kg: 40000, reps: 1 })];
  const b = one('10k-club', big);
  assert.deepStrictEqual([b.earned.bronze, b.earned.silver, b.earned.gold, b.earnedOn], [d(0), d(5), null, d(5)]);
  /* one session crossing two tiers earns both on that date */
  const jump = one('10k-club', [lift(d(3), { kg: 60000, reps: 1 })]);
  assert.deepStrictEqual([jump.earned.bronze, jump.earned.silver], [d(3), d(3)]);
  /* Century: the 25th session is the one */
  const c = one('century', BUILD.century(26));
  assert.strictEqual(c.earned.bronze, d(24));
  /* PB date is the date the best was beaten */
  const pb = one('first-pb', [F.wk(d(0), [F.row('Push-ups', { reps: 10 })]), F.wk(d(9), [F.row('Push-ups', { reps: 12 })])]);
  assert.strictEqual(pb.earned.bronze, d(9));
});

check('M6 a workout with an unreadable date counts where the app counts it and earns no date', () => {
  const dated = BUILD.century(24);
  const undated = { name: 'u', fm: { date: 'soon' }, rows: [F.row('Squat', { reps: 1, kg: 1 })], file: { path: 'u' } };
  const noFm = { name: 'v', rows: [F.row('Squat', { reps: 1, kg: 1 })], file: { path: 'v' } };
  const c = one('century', dated.concat([undated]));
  assert.strictEqual(c.progress.value, stats.sessionCount(dated.concat([undated])), 'an undated note is still a session (stats.sessionCount)');
  assert.strictEqual(c.tier, 'bronze');
  assert.strictEqual(c.earned.bronze, null, 'it sorts last, so the 25th session has no readable date');
  assert.strictEqual(one('century', dated.concat([noFm])).tier, 'bronze');
  /* a "date" the app cannot parse never reaches a week-based medal */
  const wkOnly = [lift(d(0), { reps: 1 }), lift(d(1), { reps: 1 }), undated, noFm];
  assert.strictEqual(one('iron-week', wkOnly).progress.value, 2);
  assert.strictEqual(one('consistency', wkOnly).progress.value, 0);
  /* a PB set by an undated workout still counts, without a date */
  const pb = one('first-pb', [F.wk(d(0), [F.row('Push-ups', { reps: 5 })]), { name: 'u', fm: { date: '2026-8-6x' }, rows: [F.row('Push-ups', { reps: 9 })] }]);
  assert.deepStrictEqual([pb.tier, pb.earned.bronze], ['bronze', null]);
  /* ISO timestamps are dates (stats.workoutDate) */
  const ts = one('iron-week', [3, 4, 5].map(n => ({ name: `t${n}`, fm: { date: `${d(n)}T09:30` }, rows: [F.row('Squat', { reps: 1 })] })));
  assert.strictEqual(ts.tier, 'bronze');
});

const rnd = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

check('M7 10K Club volume == sum of stats.sessionVolume over the same data', () => {
  const r = rnd(7);
  const workouts = Array.from({ length: 40 }, (_, i) => F.wk(d(i * 2), Array.from({ length: 1 + Math.floor(r() * 6) }, () =>
    F.row(r() < 0.5 ? 'Squat' : 'Bench Press', { reps: Math.floor(r() * 12), kg: r() < 0.2 ? null : Math.round(r() * 1400) / 10 }))));
  const expected = workouts.reduce((n, w) => n + stats.sessionVolume(w.rows), 0);
  assert.ok(expected > 0);
  assert.strictEqual(one('10k-club', workouts).progress.value, expected);
  /* the per-session rounding is part of the rule: 2 sessions of 4000.4 are 8000, not 8001 */
  const halves = [lift(d(0), { reps: 1, kg: 4000.4 }), lift(d(1), { reps: 1, kg: 4000.4 })];
  assert.strictEqual(one('10k-club', halves).progress.value, 8000);
  assert.strictEqual(one('10k-club', halves).progress.value, halves.reduce((n, w) => n + stats.sessionVolume(w.rows), 0));
});

check('M8 Rep Machine == total reps; Distance Club == distance_km rows only', () => {
  const workouts = [
    F.wk(d(0), [F.row('Push-ups', { reps: 30 }), F.row('Plank', { sec: 90 }), F.row('Easy Run', { km: 5.25, sec: 1700 })]),
    F.wk(d(2), [F.row('Pull-ups', { reps: 12 }), F.row('Easy Run', { km: 10.5 }), F.row('Squat', { reps: 5, kg: 60 })]),
    F.wk(d(4), [F.row('Push-ups', { reps: 'abc' }), F.row('Plank', { sec: 60, km: '' })]),
  ];
  assert.strictEqual(one('rep-machine', workouts).progress.value, 30 + 12 + 5);
  const km = one('distance-club', workouts).progress.value;
  assert.strictEqual(km, 15.8, 'sums distance_km only (5.25 + 10.5), 1 decimal like the Running page');
  assert.strictEqual(km, stats.exerciseBests(workouts, 'Easy Run').totalDistance, 'the Running page\'s own total for that exercise');
  assert.strictEqual(km, stats.distanceInWeek(workouts, d(0), 'mon'));
  /* 49.96 km reads 50.0 on every screen, so it earns the tier */
  assert.strictEqual(one('distance-club', [F.wk(d(0), [F.row('Easy Run', { km: 49.96 })])]).tier, 'bronze');
  assert.strictEqual(one('distance-club', [F.wk(d(0), [F.row('Easy Run', { km: 49.94 })])]).tier, 'locked');
});

check('M9 First PB / Personal Best Hunter == allRecords times-1; baselines are not PBs', () => {
  const ex = F.EXERCISES;
  const workouts = [
    F.wk(d(0), [F.row('Pull-ups', { reps: 5 }), F.row('Squat', { reps: 5, kg: 80 }), F.row('Plank', { sec: 30 }), F.row('Easy Run', { km: 5 })]),
    F.wk(d(7), [F.row('Pull-ups', { reps: 6 }), F.row('Squat', { reps: 5, kg: 85 }), F.row('Plank', { sec: 30 }), F.row('Easy Run', { km: 9 })]),
    F.wk(d(14), [F.row('Pull-ups', { reps: 6 }), F.row('Squat', { reps: 6, kg: 85 }), F.row('Plank', { sec: 45 }), F.row('Easy Run', { km: 12 })]),
    F.wk(d(21), [F.row('Pull-ups', { reps: 8 }), F.row('Pull-ups', { reps: 9 }), F.row('Squat', { reps: 4, kg: 90 })]),
  ];
  const expected = records.allRecords(workouts, ex).reduce((n, r) => n + (r.times - 1), 0);
  assert.ok(expected >= 6, `fixture should hold several PBs, got ${expected}`);
  assert.strictEqual(one('pb-hunter', workouts, { exercises: ex }).progress.value, expected);
  assert.strictEqual(one('first-pb', workouts, { exercises: ex }).progress.value, expected);
  /* a timed circuit writes `seconds` on a REP exercise (page-log.buildRows): that clock reading is not a hold, so it is not a record */
  const circuit = [F.wk(d(0), [F.row('Push-ups', { reps: 10, sec: 30 }), F.row('Easy Run', { km: 5, sec: 1800 })]),
    F.wk(d(7), [F.row('Push-ups', { reps: 10, sec: 45 }), F.row('Easy Run', { km: 5, sec: 2400 })])];
  assert.strictEqual(one('pb-hunter', circuit).progress.value, 0, 'seconds on a reps exercise / a run claim nothing');
  assert.strictEqual(one('pb-hunter', circuit).progress.value, records.allRecords(circuit, ex).reduce((n, r) => n + (r.times - 1), 0));
  /* runs claim no strength record (claimableKinds), so Easy Run's 5 -> 9 -> 12 is not a PB */
  const runsOnly = [F.wk(d(0), [F.row('Easy Run', { km: 5 })]), F.wk(d(7), [F.row('Easy Run', { km: 9 })])];
  assert.strictEqual(one('first-pb', runsOnly).progress.value, 0);
  /* one logged session is only a baseline */
  assert.strictEqual(one('first-pb', [F.wk(d(0), [F.row('Pull-ups', { reps: 9 })])]).tier, 'locked');
  /* a tie beats nothing */
  assert.strictEqual(one('first-pb', [F.wk(d(0), [F.row('Pull-ups', { reps: 9 })]), F.wk(d(7), [F.row('Pull-ups', { reps: 9 })])]).tier, 'locked');
  /* an exercise with no library note claims nothing, as on the Records page */
  assert.strictEqual(one('first-pb', [F.wk(d(0), [F.row('Mystery', { reps: 1 })]), F.wk(d(7), [F.row('Mystery', { reps: 9 })])]).tier, 'locked');
  /* a duplicate note for one name is not double-counted */
  const dup = ex.concat([F.ex('pull-ups', 'reps')]);
  assert.strictEqual(one('pb-hunter', workouts, { exercises: dup }).progress.value, expected);
});

const brute = {
  /* max sessions in any week, scanning every dated session through the app's own sessionsInWeek */
  week(workouts, ws) { let m = 0; for (const w of workouts) { const x = stats.workoutDate(w); if (x) m = Math.max(m, stats.sessionsInWeek(workouts, x, ws)); } return m; },
  /* longest weekStreak the history ever reached, asked at every dated day */
  streak(workouts, ws) {
    let m = 0;
    for (const x of stats.workoutDates(workouts)) m = Math.max(m, stats.weekStreak(stats.workoutDates(workouts.filter(w => (stats.workoutDate(w) || '9') <= x)), ws, x));
    return m;
  },
  /* longest run of consecutive weeks with >= 3 sessions, by scanning week starts */
  steady(workouts, ws) {
    const dates = stats.workoutDates(workouts);
    if (!dates.length) return 0;
    let best = 0, run = 0;
    for (let s = startOfWeek(dates[0], ws); s <= dates[dates.length - 1]; s = addDays(s, 7)) {
      run = stats.sessionsInWeek(workouts, s, ws) >= 3 ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  },
};

/* A messy 6-week history: doubles, gaps, a Sunday, an undated note. */
function sixWeeks() {
  const out = [];
  const add = (n, rows) => out.push(F.wk(d(n), rows || [F.row('Squat', { reps: 5, kg: 60 + n })], `s${out.length}`));
  [0, 2, 4, 7, 7, 9, 11, 13, 14, 17, 19, 20, 22, 29, 31, 33, 34, 35, 38, 40].forEach(n => add(n));
  out.push({ name: 'u', fm: { date: '' }, rows: [F.row('Squat', { reps: 1, kg: 1 })], file: { path: 'u' } });
  return out;
}

check('M10 Iron Week == max stats.sessionsInWeek, for both weekStart settings', () => {
  const h = sixWeeks();
  for (const ws of ['mon', 'sun']) {
    assert.strictEqual(one('iron-week', h, { weekStart: ws }).progress.value, brute.week(h, ws), ws);
  }
  /* sessions, not days (the app's own rule): two on one day are two */
  assert.strictEqual(one('iron-week', [lift(d(0), { reps: 1 }, 'a'), lift(d(0), { reps: 1 }, 'b'), lift(d(0), { reps: 1 }, 'c')]).tier, 'bronze');
  /* Sunday, Monday, Tuesday: three in a Sun-start week, never three in a Mon-start one */
  const sdt = [lift(d(6), { reps: 1 }), lift(d(7), { reps: 1 }), lift(d(8), { reps: 1 })];
  assert.strictEqual(one('iron-week', sdt, { weekStart: 'mon' }).tier, 'locked');
  assert.strictEqual(one('iron-week', sdt, { weekStart: 'sun' }).tier, 'bronze');
  assert.strictEqual(one('iron-week', sdt, { weekStart: 'sun' }).earned.bronze, d(8));
});

check('M11 Week Streak == the longest stats.weekStreak the history ever reached; a break keeps the medal', () => {
  const h = sixWeeks();
  for (const ws of ['mon', 'sun']) assert.strictEqual(one('week-streak', h, { weekStart: ws }).progress.value, brute.streak(h, ws), ws);
  /* 5 weeks, a gap, 1 more: the best (5) is what the medal holds */
  const broken = BUILD['week-streak'](5).concat([lift(d(5 * 7 + 14), { reps: 1 })]);
  const m = one('week-streak', broken);
  assert.strictEqual(m.progress.value, 5);
  assert.strictEqual(m.tier, 'silver');
  assert.strictEqual(m.earned.bronze, d(14), 'the third consecutive week');
  assert.strictEqual(m.earned.silver, d(28));
  /* two sessions in the same week are still one week */
  const dbl = BUILD['week-streak'](3).concat([lift(d(1), { reps: 1 }, 'extra')]);
  assert.strictEqual(one('week-streak', dbl).progress.value, 3);
});

check('M12 Consistency == consecutive weeks with >= 3 sessions', () => {
  const h = sixWeeks();
  for (const ws of ['mon', 'sun']) assert.strictEqual(one('consistency', h, { weekStart: ws }).progress.value, brute.steady(h, ws), ws);
  const m = one('consistency', BUILD.consistency(4));
  assert.strictEqual(m.tier, 'bronze');
  assert.strictEqual(m.earned.bronze, d(3 * 7 + 2), 'the third session of the fourth week');
  /* a week of two sessions breaks the run */
  const weeks = [];
  for (let wkI = 0; wkI < 7; wkI++) for (let s = 0; s < (wkI === 3 ? 2 : 3); s++) weeks.push(lift(d(wkI * 7 + s), { reps: 1 }, `w${wkI}s${s}`));
  assert.strictEqual(one('consistency', weeks).progress.value, 3);
  assert.strictEqual(one('consistency', weeks).progress.value, brute.steady(weeks, 'mon'));
});

const snapshot = list => JSON.stringify(list.map(m => [m.key, m.tier, m.progress, m.earned]));

check('M13 more history never lowers a tier or a value; shuffled input is the same result', () => {
  const h = sixWeeks();
  let prev = null;
  for (let n = 0; n <= h.length; n++) {
    const list = all(h.slice(0, n));
    if (prev) for (let i = 0; i < list.length; i++) {
      /* an undated note sorts last and a late-arriving dated note can only add */
      assert.ok(list[i].progress.value >= prev[i].progress.value, `${list[i].key} fell at ${n}: ${prev[i].progress.value} -> ${list[i].progress.value}`);
      assert.ok(list[i].tierIndex >= prev[i].tierIndex, `${list[i].key} lost a tier at ${n}`);
    }
    prev = list;
  }
  const r = rnd(3);
  const shuffled = h.slice().sort(() => r() - 0.5);
  assert.strictEqual(snapshot(all(shuffled)), snapshot(all(h)));
  const before = JSON.stringify(h);
  all(h);
  assert.strictEqual(JSON.stringify(h), before, 'medals() must not mutate its input');
});

check('M14 newMedals reports only the tiers gained, including a skipped tier', () => {
  const a = all([lift(d(0), { kg: 9000, reps: 1 })]);
  const b = all([lift(d(0), { kg: 9000, reps: 1 }), lift(d(1), { kg: 1500, reps: 1 })]);
  const gained = R.newMedals(a, b);
  assert.deepStrictEqual(gained.map(g => [g.key, g.tier, g.from]), [['10k-club', 'bronze', 'locked']]);
  const c = all([lift(d(0), { kg: 120000, reps: 1 })]);
  assert.deepStrictEqual(R.newMedals(a, c).map(g => [g.key, g.tier, g.from]), [['10k-club', 'gold', 'locked']], 'a skipped tier reports the tier reached');
  assert.deepStrictEqual(R.newMedals(b, a), [], 'nothing is "gained" going backwards');
  assert.deepStrictEqual(R.newMedals(a, a), []);
  assert.deepStrictEqual(R.newMedals(null, a), []);
});

run('rewards-medals');
