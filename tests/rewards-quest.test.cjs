'use strict';
/* THE ONE WEEKLY-QUEST RULE (rewards.questFor), driven with plans of every
   shape. daysOn is built the way ctx.daysOn is: weekday key -> [{plan, day}].

   Named cases:
     Q1  rep-based week -> "Do N reps" with N = sum of sets x first number
     Q2  a single exercise names the quest; one training day names it; else no subject
     Q3  time-based, km, and plain-seconds weeks -> "Do N sets this week"
     Q4  mixed rep + time week -> sets
     Q5  a rep line that names no number (submax / AMRAP) or a percentage -> sets
     Q6  no sets given = the app's default of 3 (itemSets)
     Q7  empty plan / no items / rest-only week -> NO quest
     Q8  rest days and fallback plans are not planned work; parallel plans are
     Q9  progress counts only THIS calendar week's logged work, real reps / real sets
     Q10 Monday vs Sunday weekStart: the week boundary, the key, the schedule
     Q11 done / toGo / pct / complete at the exact boundary; pct capped
     Q12 paid follows the ledger key
     Q13 undated workouts belong to no week */
const assert = require('node:assert');
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const TODAY = '2026-10-08';                 // a Thursday; Mon-start week 5-11 Oct
const q = (schedule, over, planFm) => R.questFor({
  daysOn: F.daysOnFrom(schedule, planFm), exercises: F.EXERCISES, workouts: [], today: TODAY, weekStart: 'mon', ...over,
});

check('Q1 a rep-based week -> "Do N reps" with N = sets x first number, summed over the week', () => {
  const r = q({ mon: [F.day('Push Day', [['Bench Press', 4, '8-12'], ['Push-ups', 3, '12']])], thu: [F.day('Push Day', [['Bench Press', 2, '5 @ 60kg']])] });
  assert.strictEqual(r.kind, 'reps');
  assert.strictEqual(r.target, 4 * 8 + 3 * 12 + 2 * 5, '"8-12" asks 8, "5 @ 60kg" asks 5');
  assert.strictEqual(r.xp, 120);
  assert.strictEqual(r.key, 'quest:2026-10-05');
  assert.strictEqual(r.weekStart, '2026-10-05');
  assert.strictEqual(r.weekEnd, '2026-10-11');
  assert.strictEqual(r.title, `Do ${r.target} reps of Push Day`);
});

check('Q2 one exercise names the quest; one training day names it; otherwise no subject', () => {
  const one = q({ mon: [F.day('Pull Day', [['Pull-ups', 5, '10']])], thu: [F.day('Pull Day', [['Pull-ups', 5, '10']])] });
  assert.strictEqual(one.subject, 'Pull-ups');
  assert.strictEqual(one.title, 'Do 100 reps of Pull-ups');
  const oneDay = q({ mon: [F.day('Pull Day', [['Pull-ups', 5, '10'], ['Push-ups', 3, '10']])] });
  assert.strictEqual(oneDay.subject, 'Pull Day');
  const many = q({ mon: [F.day('Pull Day', [['Pull-ups', 5, '10']])], wed: [F.day('Leg Day', [['Squat', 5, '5']])] });
  assert.strictEqual(many.subject, null);
  assert.strictEqual(many.title, `Do ${many.target} reps this week`);
});

check('Q3 time-based, km and seconds weeks -> "Do N sets this week"', () => {
  const timed = q({ mon: [F.day('Core', [['Plank', 3, '30s'], ['Push-ups', 2, '45 sec']])] });
  assert.deepStrictEqual([timed.kind, timed.target, timed.title], ['sets', 5, 'Do 5 sets this week']);
  const jog = q({ tue: [F.day('Run', [['Easy Run', 1, '30 min easy']])] });
  assert.deepStrictEqual([jog.kind, jog.target], ['sets', 1]);
  const plank = q({ mon: [F.day('Core', [['Plank', 3, '45']])] });
  assert.strictEqual(plank.kind, 'sets', 'a seconds-unit exercise is never counted in reps, even with a bare number');
});

check('Q4 a mixed rep + time week -> sets', () => {
  const m = q({ mon: [F.day('Mix', [['Bench Press', 4, '8'], ['Plank', 3, '30s']])] });
  assert.deepStrictEqual([m.kind, m.target], ['sets', 7]);
  const lift = q({ mon: [F.day('Lift', [['Squat', 4, '5']])], wed: [F.day('Run', [['Easy Run', 1, '5 km']])] });
  assert.strictEqual(lift.kind, 'sets', 'a parallel running plan makes the week mixed');
});

check('Q5 a rep line with no number, or a percentage, cannot be projected in reps -> sets', () => {
  assert.strictEqual(q({ mon: [F.day('D', [['Pull-ups', 5, 'submax']])] }).kind, 'sets');
  assert.strictEqual(q({ mon: [F.day('D', [['Pull-ups', 5, 'AMRAP']])] }).kind, 'sets');
  assert.strictEqual(q({ mon: [F.day('D', [['Squat', 5, '65% max']])] }).kind, 'sets');
  assert.strictEqual(q({ mon: [F.day('D', [['Squat', 5, '0']])] }).kind, 'sets');
  assert.strictEqual(q({ mon: [F.day('D', [['Pull-ups', 5, 'submax'], ['Push-ups', 3, '10']])] }).target, 8, 'sets target still counts every line');
});

check('Q6 no sets given = the default of 3 (the one itemSets rule)', () => {
  const r = q({ mon: [F.day('D', [['Push-ups', null, '10']])] });
  assert.strictEqual(r.target, 30);
});

check('Q7 empty plan / no items / a rest-only week -> NO quest', () => {
  assert.strictEqual(q({}), null);
  assert.strictEqual(q({ mon: [F.day('Empty', [])] }), null);
  assert.strictEqual(q({ mon: [F.day('Rest day', [['Plank', 1, '30s']])], thu: [F.day('Recovery', [['Plank', 1, '30s']])] }), null);
  assert.strictEqual(R.questFor({ daysOn: null, workouts: [], today: TODAY, weekStart: 'mon' }), null);
  assert.strictEqual(R.questFor({ daysOn: () => [], workouts: [], today: 'nope', weekStart: 'mon' }), null);
});

check('Q8 rest days and fallback plans are not planned work; parallel plans are', () => {
  const r = q({ mon: [F.day('Lift', [['Squat', 5, '5']])], wed: [F.day('Rest and recovery', [['Plank', 3, '30s']])] });
  assert.deepStrictEqual([r.kind, r.target], ['reps', 25], 'the rest day neither adds sets nor turns the quest into a time quest');
  const fb = q({ mon: [F.day('Mobility flow', [['Plank', 3, '30s']])] }, {}, { fallback: true });
  assert.strictEqual(fb, null, 'a fallback plan alone schedules nothing worth a quest');
  /* two plans on one weekday (active + parallel), as resolveDaysOn merges them */
  const both = R.questFor({
    daysOn: wd => (wd === 'mon' ? [
      { plan: { fm: {} }, day: F.day('Lift', [['Squat', 5, '5']]) },
      { plan: { fm: { parallel: true } }, day: F.day('Lift 2', [['Bench Press', 2, '10']]) },
    ] : []),
    exercises: F.EXERCISES, workouts: [], today: TODAY, weekStart: 'mon',
  });
  assert.strictEqual(both.target, 25 + 20);
});

check('Q9 progress is this calendar week\'s real reps / real sets, nothing older', () => {
  const sched = { mon: [F.day('Push Day', [['Push-ups', 4, '10']])] };           // 40 reps
  const w = [
    F.wk('2026-10-04', F.sets('Push-ups', 5, { reps: 50 })),                       // last week (Sunday) - not counted
    F.wk('2026-10-05', F.sets('Push-ups', 2, { reps: 12 }).concat(F.sets('Bench Press', 1, { reps: 8, kg: 40 }))),
    F.wk('2026-10-07', [F.row('Easy Run', { km: 5, sec: 1800 })]),                 // a run has no reps
  ];
  const reps = q(sched, { workouts: w });
  assert.strictEqual(reps.done, 12 + 12, 'reps of the PLANNED exercise only (the bench row is not push-ups; f1-quest-matching-rows pins it)');
  const sets = q({ mon: [F.day('Mixed', [['Push-ups', 2, '30s'], ['Bench Press', 1, '30s'], ['Easy Run', 1, '5 km']])] }, { workouts: w });
  assert.strictEqual(sets.done, 2 + 1 + 1, 'every row of a planned exercise is a set: 2 push-up sets, 1 bench, 1 run (the 4 Oct row is last week)');
});

check('Q10 weekStart Sunday vs Monday: boundary, key and schedule', () => {
  const sched = { mon: [F.day('Push Day', [['Push-ups', 3, '10']])] };
  const w = [F.wk('2026-10-11', F.sets('Push-ups', 3, { reps: 10 }))];            // a Sunday
  const mon = q(sched, { workouts: w, today: '2026-10-08', weekStart: 'mon' });
  assert.strictEqual(mon.done, 30, 'Sunday 11 Oct closes the Mon-start week of 5 Oct');
  assert.strictEqual(mon.key, 'quest:2026-10-05');
  const monNext = q(sched, { workouts: w, today: '2026-10-12', weekStart: 'mon' });
  assert.strictEqual(monNext.done, 0, 'Monday 12 Oct starts a new week: Sunday does not carry over');
  assert.strictEqual(monNext.key, 'quest:2026-10-12');
  const sun = q(sched, { workouts: w, today: '2026-10-12', weekStart: 'sun' });
  assert.strictEqual(sun.done, 30, 'Sun-start: Sunday 11 Oct opens the week that Monday 12 Oct is in');
  assert.strictEqual(sun.key, 'quest:2026-10-11');
  assert.strictEqual(sun.weekEnd, '2026-10-17');
  /* the schedule moves with the week: a Sunday-only plan lands in the NEXT Mon-start week's end, this Sun-start week's start */
  const sundayOnly = { sun: [F.day('Long', [['Push-ups', 1, '5']])] };
  assert.strictEqual(q(sundayOnly, { today: '2026-10-12', weekStart: 'mon' }).weekStart, '2026-10-12');
  assert.strictEqual(q(sundayOnly, { today: '2026-10-11', weekStart: 'sun' }).weekStart, '2026-10-11');
});

check('Q11 done / toGo / pct / complete at the exact boundary; pct capped at 100', () => {
  const sched = { mon: [F.day('P', [['Push-ups', 1, '10']])] };                   // 10 reps
  const at = n => q(sched, { workouts: [F.wk('2026-10-06', n ? [F.row('Push-ups', { reps: n })] : [])] });
  assert.deepStrictEqual([at(0).done, at(0).toGo, at(0).pct, at(0).complete], [0, 10, 0, false]);
  const nine = at(9);
  assert.deepStrictEqual([nine.done, nine.toGo, nine.pct, nine.complete], [9, 1, 90, false]);
  const ten = at(10);
  assert.deepStrictEqual([ten.done, ten.toGo, ten.pct, ten.complete], [10, 0, 100, true]);
  const over = at(25);
  assert.deepStrictEqual([over.toGo, over.pct, over.complete], [0, 100, true]);
  /* the mockup: 62 of 100 reps */
  const m = q({ mon: [F.day('Push', [['Push-ups', 10, '10']])] }, { workouts: [F.wk('2026-10-06', [F.row('Push-ups', { reps: 62 })])] });
  assert.deepStrictEqual([m.target, m.done, m.toGo, m.pct], [100, 62, 38, 62]);
});

check('Q12 paid follows the ledger key', () => {
  const sched = { mon: [F.day('P', [['Push-ups', 1, '10']])] };
  assert.strictEqual(q(sched).paid, false);
  const ledgerState = L.parseLedger(L.appendToText(null, [{ date: TODAY, kind: 'quest', key: 'quest:2026-10-05', xp: 120, note: '' }]).text);
  assert.strictEqual(q(sched, { ledger: ledgerState }).paid, true);
  assert.strictEqual(q(sched, { ledger: ledgerState, today: '2026-10-14' }).paid, false, 'next week is a new key');
});

check('Q13 an undated or unreadable-date workout belongs to no week', () => {
  const sched = { mon: [F.day('P', [['Push-ups', 1, '10']])] };
  const w = [{ name: 'x', fm: {}, rows: [F.row('Push-ups', { reps: 10 })] }, { name: 'y', fm: { date: 'soon' }, rows: [F.row('Push-ups', { reps: 10 })] }, { name: 'z', rows: [F.row('Push-ups', { reps: 10 })] }];
  assert.strictEqual(q(sched, { workouts: w }).done, 0);
});

run('rewards-quest');
