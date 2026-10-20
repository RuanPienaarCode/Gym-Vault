'use strict';
/* L4-04: Running > This week > Log on a PAST day wrote TODAY's date, so the row
   never flipped to done. startDraft takes an optional date; Running passes the
   row's own day when it is in the past (today and future days log as today). */
const assert = require('node:assert');
const T = require('./f3-stub');
const pageLog = require('../src/page-log');
const running = require('../src/page-running');
const { todayISO, weekdayKey, startOfWeek, addDays } = require('../src/dates');

const today = todayISO();
const plan = { name: 'P' };
const day = { name: 'D', items: [] };
const mk = () => ({ data: { exercises: [] }, state: {} });
let c = mk(); pageLog.startDraft(c, plan, day);
assert.strictEqual(c.state.logDraft.date, today, 'default is today');
c = mk(); pageLog.startDraft(c, plan, day, { date: '2026-10-12' });
assert.strictEqual(c.state.logDraft.date, '2026-10-12', 'an explicit past date is honoured');
c = mk(); pageLog.startDraft(c, plan, day, { date: addDays(today, 3) });
assert.strictEqual(c.state.logDraft.date, today, 'a future date is refused (today instead)');
c = mk(); pageLog.startDraft(c, plan, day, { date: 'nonsense' });
assert.strictEqual(c.state.logDraft.date, today, 'junk is ignored');

/* Running passes the row's day for a past day only */
const weekStart = startOfWeek(today, 'mon');
const runPlan = { name: 'Trail', fm: {}, model: { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(w => ({ name: `Run ${w}`, weekday: w, items: [{ exercise: 'Easy Run', sets: 1, target: '30 min' }], notes: [] })), intro: [] } };
const calls = [];
const ctx = { app: {}, data: { workouts: [], exercises: [{ name: 'Easy Run', fm: { unit: 'km' } }] }, settings: { weekStart: 'mon' }, state: {}, nav() {}, runPlan: () => runPlan, startLog: (...a) => calls.push(a) };
const root = T.render(running, ctx);
const rows = T.findAll(root, 'gv-runday').filter(r => /^\S*\s*Run /.test(r.textContent.replace(/^\s*\S+\s+\S+\s+\S+\s+/, 'x ')) || /Run (mon|tue|wed|thu|fri|sat|sun)/.test(r.textContent));
assert.strictEqual(rows.length, 7, 'seven scheduled days this week');
rows.forEach(r => { const b = T.findAll(r, 'gv-btn')[0]; b && b.listeners.click.forEach(f => f({})); });
assert.strictEqual(calls.length, 7);
const byDay = Object.fromEntries(calls.map(a => [a[1].name, a[2]]));
for (let i = 0; i < 7; i++) {
  const iso = addDays(weekStart, i), name = `Run ${weekdayKey(iso)}`;
  if (iso < today) assert.deepStrictEqual(byDay[name], { date: iso }, `${name} (${iso}) is past: logs on its own day, got ${JSON.stringify(byDay[name])}`);
  else assert.ok(!byDay[name] || !byDay[name].date, `${name} is today/future: logs today`);
}
console.log('f3 log past day OK');
