'use strict';
const assert = require('node:assert');
const eq = require('../src/equipment');

const ex = (name, equipment) => ({ name, fm: { equipment } });

const LIBRARY = [
  ex('Pull-ups', 'bar'),
  ex('Push-ups', 'bodyweight'),
  ex('Kettlebell Swing', 'kettlebell'),
  ex('Kettlebell Deadlift', 'kettlebell'),
  ex('Box Jumps', 'box'),
  ex('Romanian Deadlift', 'dumbbells'),
  ex('Sandbag Carry', 'sandbag'),   // a value this app has never seen
  ex('Mystery Move', ''),            // frontmatter present but empty
  ex('No Frontmatter', undefined),
];

/* Distinct, in first-appearance order — the order you'd lay the kit out. */
{
  const keys = eq.equipmentKeys(LIBRARY, ['Kettlebell Swing', 'Box Jumps', 'Kettlebell Deadlift', 'Pull-ups']);
  assert.deepStrictEqual(keys, ['kettlebell', 'box', 'bar'], 'deduped, first-appearance order');
}

/* Bodyweight is not equipment — it never appears in the list. */
{
  assert.deepStrictEqual(
    eq.equipmentKeys(LIBRARY, ['Push-ups', 'Kettlebell Swing']), ['kettlebell'],
    'a bodyweight move alongside a kettlebell names only the kettlebell');
  assert.deepStrictEqual(
    eq.equipmentKeys(LIBRARY, ['Push-ups']), [],
    'bodyweight only yields an empty list, not ["bodyweight"]');
}

/* An exercise the vault does not define is skipped, never guessed at. */
{
  assert.deepStrictEqual(eq.equipmentKeys(LIBRARY, ['Not In The Vault', 'Pull-ups']), ['bar']);
  assert.deepStrictEqual(eq.equipmentKeys(LIBRARY, []), []);
  assert.deepStrictEqual(eq.equipmentKeys(LIBRARY, null), []);
  assert.deepStrictEqual(eq.equipmentKeys(null, ['Pull-ups']), []);
}

/* Names match the same way everything else in this app matches them. */
{
  assert.deepStrictEqual(eq.equipmentKeys(LIBRARY, ['  pull-UPS  ']), ['bar'], 'case and space insensitive');
}

/* Empty or missing equipment frontmatter contributes nothing. */
{
  assert.deepStrictEqual(eq.equipmentKeys(LIBRARY, ['Mystery Move', 'No Frontmatter']), []);
}

/* Labels: known keys read like objects you can pick up; unknown ones are
   title-cased rather than dropped — the note's author knows what they meant. */
{
  assert.strictEqual(eq.labelFor('bar'), 'Pull-up bar');
  assert.strictEqual(eq.labelFor('kettlebell'), 'Kettlebell');
  assert.strictEqual(eq.labelFor('sandbag'), 'Sandbag', 'an unknown value survives, title-cased');
  assert.strictEqual(eq.labelFor('BAR'), 'Pull-up bar', 'label lookup folds case');
  assert.strictEqual(eq.labelFor(''), '');
  assert.strictEqual(eq.labelFor(undefined), '');
}

{
  assert.deepStrictEqual(
    eq.equipmentFor(LIBRARY, ['Kettlebell Swing', 'Sandbag Carry']),
    [{ key: 'kettlebell', label: 'Kettlebell' }, { key: 'sandbag', label: 'Sandbag' }]);
}

/* The compact one-liner always says something actionable. */
{
  assert.strictEqual(eq.equipmentSummary(LIBRARY, ['Kettlebell Swing', 'Box Jumps']), 'Kettlebell · Box or step');
  assert.strictEqual(eq.equipmentSummary(LIBRARY, ['Push-ups']), 'No equipment',
    'bodyweight-only is a useful answer, not a blank');
  assert.strictEqual(eq.equipmentSummary(LIBRARY, []), 'No equipment');
}

/* planExerciseNames walks every day in order. */
{
  const plan = {
    model: {
      days: [
        { items: [{ exercise: 'Pull-ups' }, { exercise: 'Push-ups' }] },
        { items: [{ exercise: 'Box Jumps' }] },
      ],
    },
  };
  assert.deepStrictEqual(eq.planExerciseNames(plan), ['Pull-ups', 'Push-ups', 'Box Jumps']);
  assert.deepStrictEqual(eq.equipmentSummary(LIBRARY, eq.planExerciseNames(plan)), 'Pull-up bar · Box or step');
  assert.deepStrictEqual(eq.planExerciseNames(null), [], 'a half-loaded plan yields nothing, never throws');
  assert.deepStrictEqual(eq.planExerciseNames({ model: { days: [{}] } }), []);
}

console.log('equipment OK');
