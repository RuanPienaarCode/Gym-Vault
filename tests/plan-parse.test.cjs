'use strict';
/* The plan grammar: seed parses, prose survives, serialization is stable. */
const assert = require('node:assert');
const { parsePlanBody, serializePlanBody, parsePrescription, targetWeight, targetFirstNumber, targetIsDuration } = require('../src/plan-parse');
const { SEED_PLAN } = require('../src/seed');

/* The seed program must parse to its 4 days with items intact. */
{
  const m = parsePlanBody(SEED_PLAN.body);
  assert.strictEqual(m.days.length, 4);
  assert.deepStrictEqual(m.days.map(d => d.weekday), ['mon', 'wed', 'fri', 'sat']);
  assert.strictEqual(m.days[0].items.length, 6);
  assert.strictEqual(m.days[0].items[0].exercise, 'Pull-ups');
  assert.strictEqual(m.days[0].items[0].sets, 5);
  assert.strictEqual(m.days[0].items[0].target, 'submax');
  assert.ok(m.intro.join(' ').includes('muscle-up'));
  assert.ok(m.days[2].notes.join(' ').includes('Superset'));
}

/* Serialize → parse is a fixpoint (stable round trip). */
{
  const m1 = parsePlanBody(SEED_PLAN.body);
  const s1 = serializePlanBody(m1);
  const m2 = parsePlanBody(s1);
  const s2 = serializePlanBody(m2);
  assert.strictEqual(s1, s2);
  assert.strictEqual(m2.days.length, 4);
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

console.log('plan grammar OK');
