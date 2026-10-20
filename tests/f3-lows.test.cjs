'use strict';
/* L1-07: fmtSeconds(119.6) = "1:60" and (59.5) = "60s" - the seconds were rounded
   AFTER the minute split. C-09: Arabic-Indic, Persian and full-width digits (and
   the Arabic / full-width decimal marks) were ERASED by normaliseNumber on a
   phone with such a keyboard; they now map to ASCII. B-L4-09: "1 days left",
   "1 days . 1 exercises". */
const assert = require('node:assert');
const T = require('./f3-stub');
const { fmtSeconds, normaliseNumber } = require('../src/dom');
const goals = require('../src/page-goals');
const browse = require('../src/page-browse');
const { todayISO, addDays } = require('../src/dates');

/* fmtSeconds: one rounding, then the split */
assert.strictEqual(fmtSeconds(119.6), '2:00');
assert.strictEqual(fmtSeconds(59.5), '1:00');
assert.strictEqual(fmtSeconds(59.4), '59s');
assert.strictEqual(fmtSeconds(45), '45s');
assert.strictEqual(fmtSeconds(75), '1:15');
assert.strictEqual(fmtSeconds(360), '6:00');
assert.strictEqual(fmtSeconds(''), '—');
assert.strictEqual(fmtSeconds(null), '—');

/* normaliseNumber */
assert.strictEqual(normaliseNumber('١٢'), '12', 'Arabic-Indic digits');
assert.strictEqual(normaliseNumber('۴۵'), '45', 'Persian digits');
assert.strictEqual(normaliseNumber('１２０'), '120', 'full-width digits');
assert.strictEqual(normaliseNumber('٤٫٣'), '4.3', 'Arabic decimal separator');
assert.strictEqual(normaliseNumber('４．３'), '4.3', 'full-width full stop');
assert.strictEqual(normaliseNumber('4,3'), '4.3', 'control: comma still a decimal');
assert.strictEqual(normaliseNumber('abc-5kg'), '5', 'control: junk and minus still dropped');
assert.strictEqual(normaliseNumber('12.5.6'), '12.56', 'control: second point dropped');

/* plurals */
const text = n => n.textContent.replace(/\s+/g, ' ');
{
  const today = todayISO();
  const mk = deadline => ({ name: 'G', file: { path: 'g.md' }, fm: { metric: 'workouts-per-week', target: 3, deadline } });
  const ctx = gs => ({ data: { goals: gs, workouts: [], body: [], exercises: [] }, settings: { weekStart: 'mon' }, app: {}, state: {}, nav() {}, notice() {}, reload() {}, openFile() {} });
  let t = text(T.render(goals, ctx([mk(addDays(today, 1))])));
  assert.ok(/1 day left/.test(t) && !/1 days/.test(t), `goal deadline plural: ${t}`);
  t = text(T.render(goals, ctx([mk(addDays(today, 5))])));
  assert.ok(/5 days left/.test(t), 'control: 5 days left');
  t = text(T.render(goals, ctx([mk(addDays(today, -1))])));
  assert.ok(/1 day past/.test(t) && !/1 days/.test(t), `past plural: ${t}`);
}
{
  const plan = (name, extra) => Object.assign({ name, days: 1, exercises: ['a'], summary: 's' }, extra);
  const index = { plans: [plan('Solo'), plan('Prog 1 · Base', { series: 'Prog', phase: 1 }), plan('Prog 2 · Build', { series: 'Prog', phase: 2, days: 3, exercises: ['a', 'b'] })] };
  const ctx = { app: {}, data: { plans: [] }, state: { browseUi: { index, error: null, loading: false, busy: null } }, backTo: f => f, back() {}, nav() {}, notice() {}, reload: async () => {}, io: { fetchPlanIndex: async () => index, installPlan: async () => ({}) } };
  const t = text(T.render(browse, ctx));
  assert.ok(/1 day · 1 exercise(?!s)/.test(t) && !/1 days|1 exercises/.test(t), `browse plural: ${t}`);
  assert.ok(/3 days · 2 exercises/.test(t), 'control: plural stays plural');
}
console.log('f3 lows OK');
