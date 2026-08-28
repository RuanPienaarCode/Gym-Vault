'use strict';
/* The plan grammar: seed parses, prose survives, serialization is stable. */
const assert = require('node:assert');
const { parsePlanBody, serializePlanBody, parsePrescription, targetWeight, targetFirstNumber, targetIsDuration } = require('../src/plan-parse');
const { SEED_PLAN } = require('../src/seed');

/* The seed program: 4 strength days + 3 running days, in weekday order,
   with items and hand-written prose intact. */
{
  const m = parsePlanBody(SEED_PLAN.body);
  assert.strictEqual(m.days.length, 7);
  assert.deepStrictEqual(m.days.map(d => d.weekday), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  const byDay = Object.fromEntries(m.days.map(d => [d.weekday, d]));
  assert.strictEqual(byDay.mon.items.length, 6);
  assert.strictEqual(byDay.mon.items[0].exercise, 'Pull-ups');
  assert.strictEqual(byDay.mon.items[0].sets, 5);
  assert.strictEqual(byDay.mon.items[0].target, 'submax');
  assert.strictEqual(byDay.tue.items[0].exercise, 'Easy Run');
  assert.strictEqual(byDay.sun.items[0].exercise, 'Long Trail Run');
  assert.ok(m.intro.join(' ').includes('muscle-up'));
  assert.ok(m.intro.join(' ').includes('15km'), 'intro should carry the run ladder');
  assert.ok(byDay.fri.notes.join(' ').includes('Superset'));
}

/* Serialize → parse is a fixpoint (stable round trip). */
{
  const m1 = parsePlanBody(SEED_PLAN.body);
  const s1 = serializePlanBody(m1);
  const m2 = parsePlanBody(s1);
  const s2 = serializePlanBody(m2);
  assert.strictEqual(s1, s2);
  assert.strictEqual(m2.days.length, 7);
  assert.deepStrictEqual(
    m2.days.map(d => d.items.map(i => `${i.exercise}|${i.sets}|${i.target}`)),
    m1.days.map(d => d.items.map(i => `${i.exercise}|${i.sets}|${i.target}`)));
}

/* Prescription grammar corners. */
assert.deepStrictEqual(parsePrescription('5 x submax'), { sets: 5, target: 'submax' });
assert.deepStrictEqual(parsePrescription('3 × 8-12'), { sets: 3, target: '8-12' });
assert.deepStrictEqual(parsePrescription('just move'), { sets: null, target: 'just move' });
assert.strictEqual(targetWeight('8-10 @ 22.5kg'), 22.5);
assert.strictEqual(targetWeight('8-10'), null);
assert.strictEqual(targetFirstNumber('8-12'), 8);
assert.strictEqual(targetFirstNumber('30-45s'), 30);
assert.strictEqual(targetFirstNumber('submax'), null);
assert.strictEqual(targetFirstNumber('8 @ 60kg'), 8);
assert.ok(targetIsDuration('30-45s'));
assert.ok(targetIsDuration('2 min'));
assert.ok(!targetIsDuration('8-12'));

/* An exercise name containing an escaped pipe survives. */
{
  const s = serializePlanBody({ intro: [], days: [{ name: 'D', weekday: 'mon', notes: [], items: [{ exercise: 'Odd | Name', sets: 3, target: '10' }] }] });
  const m = parsePlanBody(s);
  assert.strictEqual(m.days[0].items[0].exercise, 'Odd | Name');
}

/* Prose written BETWEEN two exercise lines keeps its position across a
   save (the notes-then-items model used to hoist it above the list). */
{
  const body = '## D (mon)\n\n- Pull-ups | 3 x 5\nRest 90s here.\n- Dips | 3 x 8\n';
  const m = parsePlanBody(body);
  const s = serializePlanBody(m);
  const lines = s.split('\n').filter(l => l.trim());
  assert.deepStrictEqual(lines, ['## D (mon)', '- Pull-ups | 3 x 5', 'Rest 90s here.', '- Dips | 3 x 8']);
  assert.strictEqual(serializePlanBody(parsePlanBody(s)), s); // still a fixpoint
}

/* A hand-written item with extra pipes keeps its whole tail. */
{
  const m = parsePlanBody('## D (mon)\n\n- Superset: rows \\| dips | 3 x 5 | slow\n');
  assert.strictEqual(m.days[0].items[0].exercise, 'Superset: rows | dips');
  assert.strictEqual(m.days[0].items[0].target, '5 | slow');
  const s = serializePlanBody(m);
  assert.strictEqual(serializePlanBody(parsePlanBody(s)), s);
}

/* Structural edit helpers keep parts and items in lockstep. */
{
  const { addItem, removeItemAt } = require('../src/plan-parse');
  const m = parsePlanBody('## D (mon)\n\nCue line.\n\n- A | 3 x 5\n- B | 3 x 8\n');
  const day = m.days[0];
  addItem(day, { exercise: 'C', sets: 2, target: '10' });
  removeItemAt(day, 0); // drop A
  const s = serializePlanBody(m);
  assert.ok(s.includes('Cue line.'));
  assert.ok(!s.includes('- A |'));
  assert.ok(s.indexOf('- B | 3 x 8') < s.indexOf('- C | 2 x 10'));
  assert.strictEqual(day.items.length, day.parts.filter(p => p.kind === 'item').length);
}

console.log('plan grammar OK');
