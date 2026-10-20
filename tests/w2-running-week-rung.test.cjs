'use strict';
/* WAVE 2, item 1 (audit L1-15): EACH DAY'S LONG RUN SHOWS THE RUNG OF ITS OWN WEEK.

   Running > This week printed `${target} km` (TODAY's rung) against every long
   run in the week. A ladder whose start_date falls mid-week steps up between two
   days of the same calendar week, so the earlier long run showed a distance
   the ladder had not reached yet (or the later one a stale one). The rule is
   stats.ladderWeek, evaluated for the DAY's date. */
const assert = require('node:assert');
const T = require('./f3-stub');
const { todayISO, startOfWeek, addDays, weekdayKey } = require('../src/dates');
const running = require('../src/page-running');

const today = todayISO();
const weekStart = startOfWeek(today, 'mon');
const wed = addDays(weekStart, 2), sat = addDays(weekStart, 5);
/* The ladder steps up on THURSDAY: start two Thursdays before this week's. */
const start = addDays(weekStart, 3 - 14);
const day = (name, iso, target) => ({ name, weekday: weekdayKey(iso), items: [{ exercise: 'Long Run', sets: 1, target }], notes: [] });
const plan = {
  name: 'Trail', fm: { parallel: 'true', start_date: start, ladder: [10, 12, 14, 16] },
  model: { days: [day('Long run A', wed, 'easy'), day('Long run B', sat, 'easy'), day('Tempo', addDays(weekStart, 1), '5 km tempo')], intro: [] },
};
const exercises = [{ name: 'Long Run', fm: { unit: 'km' } }];
const ctx = { app: {}, data: { workouts: [], exercises }, settings: { weekStart: 'mon' }, state: {}, nav() {}, startLog() {}, runPlan: () => plan };
const root = T.render(running, ctx);
const rx = name => {
  const d = T.findAll(root, 'gv-runday').find(n => n.textContent.indexOf(name) >= 0);
  return d ? T.findAll(d, 'gv-runday-rx').map(n => n.textContent).join('|') : null;
};
assert.strictEqual(rx('Long run A'), '12 km', `Wednesday's long run is in ladder week 2 (12 km), printed: ${rx('Long run A')}`);
assert.strictEqual(rx('Long run B'), '14 km', `Saturday's long run is in ladder week 3 (14 km), printed: ${rx('Long run B')}`);
assert.strictEqual(rx('Tempo'), '5 km tempo', 'a day that is not a long run still prints the plan target');
console.log('w2 running week rung OK');
