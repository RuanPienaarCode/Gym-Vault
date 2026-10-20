'use strict';
/* R2-02 / R1-03 / L1-06: Today said "~15 MIN" for "1 x 30 min easy" because
   estMinutes counted sets only (1.8 min a set, floor 15). A line that WRITES a
   duration is at least that long: a set takes max(1.8 min, its written time).
   One rule - estMinutes(day) - feeds the "est." line and the slab chips. */
const assert = require('node:assert');
const T = require('./f3-stub');
const dashboard = require('../src/page-dashboard');

const item = (exercise, sets, target) => ({ exercise, sets, target });
const { estMinutes } = dashboard;

assert.strictEqual(estMinutes(9), 15, 'legacy: a plain set count still works');
assert.strictEqual(estMinutes(27), 50);
assert.strictEqual(estMinutes({ items: [item('Easy Run', 1, '30 min easy')] }), 30, '1 x 30 min easy is a 30 minute day');
assert.strictEqual(estMinutes({ items: [item('Recovery Walk', 1, '20-30 min easy')] }), 20, 'a range reads its first number, like the clock does');
assert.strictEqual(estMinutes({ items: [item('Plank', 3, '60s'), item('Push-ups', 3, '12')] }), 15, 'short holds are still sets: unchanged');
assert.strictEqual(estMinutes({ items: [item('Squat', 5, '5'), item('Easy Run', 1, '45 min'), item('Row', 3, '10')] }), 60, 'strength sets + a written run add');
assert.strictEqual(estMinutes({ items: [item('Intervals', 4, '3 min')] }), 15, '4 x 3 min = 12, floor 15');

const plan = { name: 'P', fm: { active: 'true' }, model: { days: [{ name: 'Run Day', weekday: 'mon', items: [item('Easy Run', 1, '30 min easy')], notes: [] }], intro: [] } };
const ctx = {
  app: {}, data: { workouts: [], exercises: [{ name: 'Easy Run', fm: { unit: 'km' } }], goals: [], body: [] },
  settings: { weekStart: 'mon' }, state: {}, io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
  activePlan: () => plan, activePlanIsImplicit: () => false, mainPlans: () => [plan], parallelPlans: () => [], fallbackPlans: () => [],
  daysOn: () => [{ plan, day: plan.model.days[0] }],
};
const root = T.render(dashboard, ctx);
const chip = T.findAll(root, 'gv-hero-chip-min')[0], line = T.findAll(root, 'gv-shout-est')[0];
assert.ok(chip && /~30 min/.test(chip.textContent), `slab chip: ${chip && chip.textContent}`);
assert.ok(line && /est\. 30 min/.test(line.textContent), `est line: ${line && line.textContent}`);
console.log('f3 est minutes OK');
