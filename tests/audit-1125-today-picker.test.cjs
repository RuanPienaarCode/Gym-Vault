'use strict';
/* The "Choose another workout" picker (finding 30): pure row order + modal.
     P1 pickerRows: plans in use first (main, add-on, backup), then the rest,
        switched-off plans included; a plan with nothing to train is left out
     P2 each row carries the day plan-parse.startDayFor would open
     P3 the modal lists name + day, Start calls onStart(plan, day) once and closes
     P4 a search box appears past ten plans and filters by plan or day name
   Test-only helpers live in tests/audit-1125-today-harness.js. */
const assert = require('node:assert');
const H = require('./audit-1125-today-harness');
const { pickerRows, WorkoutPickerModal } = H.picker;
const { startDayFor } = H.planParse;

let failed = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); } };

const P = (name, days, fm) => H.mkPlan(name, days, fm);
const main = P('Main', [H.mkDay('mon', 'Upper')], { active: 'true' });
const other = P('Other', [H.mkDay('wed', 'Lower')], { active: 'false' });
const add = P('Run', [H.mkDay('tue', 'Easy Run')], { parallel: 'true' });
const backup = P('Recover', [H.mkDay('any', 'Stretch')], { fallback: 'true' });
const restOnly = P('Rest only', [H.mkDay('mon', 'Rest', [])], { active: 'false' });
const off = P('Paused run', [H.mkDay('thu', 'Hills')], { parallel: 'true', paused: 'true' });

check('P1 plans in use first, then the rest (switched off included), rest-only left out', () => {
  const rows = pickerRows([other, restOnly, backup, off, add, main], main, 'tue');
  assert.deepStrictEqual(rows.map(r => r.plan.name), ['Main', 'Run', 'Recover', 'Other', 'Paused run']);
  assert.deepStrictEqual(rows.map(r => r.inUse), [true, true, true, false, false]);
});
check('P2 each row carries startDayFor\'s day', () => {
  for (const key of ['mon', 'tue', 'sat']) {
    for (const r of pickerRows([main, other, add, backup], main, key)) {
      const want = startDayFor(r.plan, key);
      assert.strictEqual(r.pick.day, want.day, `${r.plan.name} on ${key}`);
      assert.strictEqual(r.pick.today, want.today);
    }
  }
});
check('P2 empty or missing input gives no rows', () => {
  assert.deepStrictEqual(pickerRows([], null, 'mon'), []);
  assert.deepStrictEqual(pickerRows(undefined, null, 'mon'), []);
});

const open = (rows, onStart) => {
  const m = new WorkoutPickerModal({}, { rows, onStart });
  m.open();
  return m;
};
check('P3 the modal names plan and day; Start calls onStart once and closes', () => {
  const calls = [];
  const rows = pickerRows([main, other], main, 'tue');
  const m = open(rows, (p, d) => calls.push([p, d]));
  const text = H.txt(m.contentEl);
  assert.ok(/Main/.test(text) && /Upper/.test(text) && /Other/.test(text) && /Lower/.test(text), text);
  const starts = H.buttons(m.contentEl);
  assert.strictEqual(starts.length, 2, 'one Start per plan');
  assert.ok(/Start/.test(H.buttonText(starts[1])));
  for (const fn of starts[1].listeners.click) fn({ stopPropagation() {} });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], other);
  assert.strictEqual(calls[0][1].name, 'Lower');
  assert.ok(m.closed);
});
check('P4 search appears past ten plans and filters by plan or day name', () => {
  const few = open(pickerRows([main, other], main, 'mon'), () => {});
  assert.strictEqual(H.byTag(few.contentEl, 'input').length, 0, 'no search for two plans');
  const many = Array.from({ length: 11 }, (_, i) => P(`Plan ${i}`, [H.mkDay('mon', i === 4 ? 'Swim Day' : `Day ${i}`)], { active: 'false' }));
  const m = open(pickerRows(many, null, 'mon'), () => {});
  const input = H.byTag(m.contentEl, 'input')[0];
  assert.ok(input, 'a search box');
  assert.strictEqual(H.buttons(m.contentEl).length, 11);
  input.value = 'swim';
  for (const fn of input.listeners.input) fn({ target: input });
  assert.strictEqual(H.buttons(m.contentEl).length, 1, 'one match by day name');
  input.value = 'plan 7';
  for (const fn of input.listeners.input) fn({ target: input });
  assert.strictEqual(H.buttons(m.contentEl).length, 1, 'one match by plan name');
  input.value = 'zzz';
  for (const fn of input.listeners.input) fn({ target: input });
  assert.strictEqual(H.buttons(m.contentEl).length, 0);
  assert.ok(/No workout matches/.test(H.txt(m.contentEl)));
});

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('audit-1125 today picker OK');
