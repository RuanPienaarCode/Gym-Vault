'use strict';
/* R2-07: a timed-circuit run is saved with minutes and NO km (a row of a km
   exercise with `seconds` and an empty distance). Today read the saved session
   ("Logged for today") while Running's "This week" still offered "Log" - two
   rules for "this run happened". One rule now, stats.ranOn: a session that day
   holds a distance row OR a row of a km exercise. Distance STATS (tiles,
   records, pace) still need a distance, so a km-less row adds no km. */
const assert = require('node:assert');
const T = require('./f3-stub');
const { todayISO, weekdayKey } = require('../src/dates');
const S = require('../src/stats');
const running = require('../src/page-running');

const today = todayISO(), wk = weekdayKey(today);
const exercises = [{ name: 'Easy Run', fm: { unit: 'km' } }, { name: 'Push-ups', fm: { unit: 'reps' } }];
const plan = { name: 'Trail', fm: { parallel: 'true' }, model: { days: [{ name: 'Easy Run', weekday: wk, items: [{ exercise: 'Easy Run', sets: 1, target: '30 min easy' }], notes: [] }], intro: [] } };
const row = (exercise, o) => Object.assign({ exercise, set: 1, reps: '', weight_kg: '', seconds: '', note: '', distance_km: '' }, o);
const session = rows => ({ name: 'w', fm: { date: today }, rows, file: { path: 'w.md' } });

assert.strictEqual(typeof S.ranOn, 'function', 'stats exports ranOn');
assert.strictEqual(S.ranOn([session([row('Easy Run', { seconds: '1800' })])], today, exercises), true, 'a km-less row of a run exercise is a run');
assert.strictEqual(S.ranOn([session([row('easy run ', { seconds: '1800' })])], today, exercises), true, 'name folded');
assert.strictEqual(S.ranOn([session([row('Whatever', { distance_km: '5' })])], today, exercises), true, 'a distance row is a run whatever it is called');
assert.strictEqual(S.ranOn([session([row('Push-ups', { reps: '10' })])], today, exercises), false, 'a lift is not a run');
assert.strictEqual(S.ranOn([session([row('Easy Run', { seconds: '1800' })])], '2020-01-01', exercises), false, 'another day');

function render(workouts) {
  const ctx = { app: {}, data: { workouts, exercises }, settings: { weekStart: 'mon' }, state: {}, nav() {}, startLog() {}, runPlan: () => plan };
  return T.render(running, ctx);
}
let root = render([session([row('Easy Run', { seconds: '1800' })])]);
let day = T.findAll(root, 'gv-runday').find(d => /Easy Run/.test(d.textContent) && /today/.test(d.className));
assert.ok(day && /done/.test(day.textContent), `Running still offered Log for a saved run: "${day && day.textContent}"`);
const tiles = T.findAll(root, 'gv-tile').map(t => t.textContent.replace(/\s+/g, ' '));
assert.ok(tiles.some(t => /^0 km\s+this week$/.test(t.trim())), `a km-less row must add no kilometres: ${JSON.stringify(tiles)}`);
root = render([session([row('Push-ups', { reps: '10' })])]);
day = T.findAll(root, 'gv-runday').find(d => /today/.test(d.className));
assert.ok(day && /Log/.test(day.textContent) && !/done/.test(day.textContent), 'control: a lifting session does not tick the run');
console.log('f3 run happened OK');
