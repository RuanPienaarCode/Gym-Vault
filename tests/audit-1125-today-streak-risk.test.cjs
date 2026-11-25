'use strict';
/* Finding 49: "Don't break it" asks the STREAK's own question. stats.weekStreak
   counts a week once ANY workout date (a weekly-challenge go included) falls in
   it, so the warning must not key on wp.done (sessions only).
     K1 weekKept agrees with weekStreak: the week is kept exactly when adding it
        raises the streak, for every weekStart
     K2 streakRisk is null when the week is kept, even with wp.done === 0
     K3 streakRisk still warns when the week holds nothing
     K4 no streak / no target keep their old answers */
const assert = require('node:assert');
require('./audit-1125-today-harness'); // installs the obsidian stub progress.js -> dom.js needs
const P = require('../src/progress');
const { weekStreak, workoutDates } = require('../src/stats');
const { addDays, startOfWeek } = require('../src/dates');

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); } };

const TODAY = '2026-10-07'; // a Wednesday
const wp0 = { done: 0, target: 3, toGo: 3, met: false };
const w = (date, extra) => ({ name: date, fm: Object.assign({ date }, extra || {}), rows: [] });

check('K1 weekKept is true exactly when this week raises weekStreak', () => {
  const sets = [
    [], ['2026-09-28'], ['2026-10-05'], ['2026-09-28', '2026-10-05'], ['2026-09-20'], ['2026-10-04'], ['2026-10-10'],
    ['2026-09-21', '2026-09-28', '2026-10-06'],
  ];
  for (const weekStart of ['mon', 'sun', 'sat']) {
    for (const dates of sets) {
      const begin = startOfWeek(TODAY, weekStart);
      const inThisWeek = dates.some(d => d >= begin && d < addDays(begin, 7));
      assert.strictEqual(P.weekKept(dates, TODAY, weekStart), inThisWeek, `${weekStart} ${dates.join(',')}`);
    }
  }
});

check('K2 a challenge go this week keeps the week: no risk although sessions done is 0', () => {
  const ws = [w('2026-09-30'), w('2026-10-06', { kind: 'challenge' })];
  const dates = workoutDates(ws);
  const streak = weekStreak(dates, 'mon', TODAY);
  assert.strictEqual(streak, 2, 'the flame counts the go');
  assert.strictEqual(P.streakRisk(streak, wp0, TODAY, 'mon', dates), null);
});

check('K3 an empty week still warns, with the day it ends', () => {
  const dates = workoutDates([w('2026-09-30')]);
  assert.deepStrictEqual(P.streakRisk(weekStreak(dates, 'mon', TODAY), wp0, TODAY, 'mon', dates), { streak: 1, by: 'Sunday' });
  assert.deepStrictEqual(P.streakRisk(9, wp0, TODAY, 'sun', []), { streak: 9, by: 'Saturday' });
});

check('K4 no streak and no target keep their old answers', () => {
  assert.strictEqual(P.streakRisk(0, wp0, TODAY, 'mon', []), null);
  assert.strictEqual(P.streakRisk(9, null, TODAY, 'mon', []), null);
});

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('audit-1125 streak risk OK');
