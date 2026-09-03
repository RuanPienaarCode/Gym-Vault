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

/* ================================================================
   ONE NOTE CAN NAME SEVERAL THINGS (issue #23)
   ================================================================

   THE BUG THIS REPRODUCES. The exercise form's own placeholder says
   `bar, dumbbells, bodyweight`, and a YAML list stringifies to
   `bar,kettlebell` — but equipmentKeys lowercased the WHOLE field as ONE
   key. So `equipment: bar, kettlebell` produced a single chip reading
   "Bar, kettlebell", the `bar` facet the Plans filter offers never matched
   it, and `bodyweight, band` was neither dropped as bodyweight nor revealed
   as a band. Muscles have always been comma-split; equipment was not, while
   being invited to look identical. */

const { equipmentTokens } = eq;

/* ---- a comma string is a list ---- */
{
  assert.deepStrictEqual(equipmentTokens('bar, kettlebell'), ['bar', 'kettlebell'],
    'the placeholder invites a list, so the reader must read one');
  assert.deepStrictEqual(equipmentTokens('bar,dumbbells,bench'), ['bar', 'dumbbells', 'bench'],
    'with or without spaces');
  assert.deepStrictEqual(equipmentTokens('  BAR , Bench ,, '), ['bar', 'bench'],
    'trimmed, lowercased, and empty slots dropped');
}

/* ---- so is a YAML list ---- */
{
  assert.deepStrictEqual(equipmentTokens(['bar', 'bench']), ['bar', 'bench'],
    'frontmatter written as a YAML list must read the same as the comma form');
  assert.deepStrictEqual(equipmentTokens([]), []);
}

/* ---- bodyweight drops PER TOKEN, which is the point ---- */
{
  assert.deepStrictEqual(equipmentTokens('bodyweight, band'), ['band'],
    'a mixed note must surrender the band — dropping the whole field lost it');
  assert.deepStrictEqual(equipmentTokens('bodyweight'), [], 'still nothing to carry');
  assert.deepStrictEqual(equipmentTokens('none, bar'), ['bar']);
  assert.deepStrictEqual(equipmentTokens(['bodyweight', 'none']), []);
}

/* ---- free text survives: this is a splitter, not a vocabulary ---- */
{
  assert.deepStrictEqual(equipmentTokens('treadmill or road'), ['treadmill or road'],
    'splitting on spaces would shred a legitimate value into three');
  assert.deepStrictEqual(equipmentTokens('sandbag'), ['sandbag']);
  assert.deepStrictEqual(equipmentTokens('sandbag, treadmill or road'), ['sandbag', 'treadmill or road'],
    'commas separate; spaces do not');
}

/* ---- nothing at all ---- */
{
  for (const v of ['', '   ', ',,', null, undefined]) {
    assert.deepStrictEqual(equipmentTokens(v), [], `${JSON.stringify(v)} names no equipment`);
  }
}

/* ---- END TO END: the chips, the facet and the summary ---- */
{
  const exercises = [
    { name: 'Pull-ups', fm: { equipment: 'bar' } },
    { name: 'Swings', fm: { equipment: 'bar, kettlebell' } },
    { name: 'Rows', fm: { equipment: ['bar', 'bench'] } },
    { name: 'Pull-aparts', fm: { equipment: 'bodyweight, band' } },
    { name: 'Easy Run', fm: { equipment: 'treadmill or road' } },
    { name: 'Air Squat', fm: { equipment: 'bodyweight' } },
  ];
  const names = exercises.map(e => e.name);

  assert.deepStrictEqual(eq.equipmentKeys(exercises, names),
    ['bar', 'kettlebell', 'bench', 'band', 'treadmill or road'],
    'first-appearance order, deduped across notes — bar appears in three and is listed once');

  /* THE FACET. Plans builds `new Set(equipmentKeys(...))` and asks whether it
     has `bar`. Against the unsplit key "bar, kettlebell" it never did. */
  const facet = new Set(eq.equipmentKeys(exercises, ['Swings']));
  assert.ok(facet.has('bar'), 'a plan whose only kit note reads "bar, kettlebell" must still match the bar filter');
  assert.ok(facet.has('kettlebell'));

  /* And the labels: known keys keep theirs, unknown tokens stay title-cased. */
  assert.strictEqual(eq.equipmentSummary(exercises, names),
    'Pull-up bar · Kettlebell · Bench · Resistance band · Treadmill or road');
  assert.strictEqual(eq.equipmentSummary(exercises, ['Air Squat']), 'No equipment',
    'a bodyweight-only day still reads as no equipment');
}

/* ---- the form writes what the reader reads ---- */
{
  /* page-exercises.parseEquipment: one value stays a plain string so an
     ordinary `equipment: bar` note is never churned into `equipment: [bar]`
     by an unrelated rename; several become a list. */
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-exercises.js'), 'utf8');

  assert.match(src, /const parseEquipment = s => \{/,
    'the Equipment box must parse its comma list on the way in');
  assert.match(src, /equipment: parseEquipment\(v\.equipment\)/,
    'and both save paths must use it');
  assert.strictEqual((src.match(/equipment: parseEquipment\(v\.equipment\)/g) || []).length, 2,
    'add AND edit — one of the two saving raw is how a field drifts');
  assert.ok(!/equipment: v\.equipment\.trim\(\)/.test(src),
    'writing the raw box contents left "bar, kettlebell" to be read as one key');

  /* The list is DISPLAYED back as a comma string, or editing a YAML-list
     note showed "bar,bench" in the box. */
  assert.match(src, /value: listOf\(fm && fm\.equipment\)\.join\(', '\)/,
    'the box must render an existing YAML list the way it asks you to type one');

  /* And the exercise card's meta line shows labelled tokens, not the field. */
  assert.match(src, /equipmentTokens\(ex\.fm\.equipment\)\.map\(labelFor\)/,
    'the card used to print the raw field, so a YAML list read as "bar,bench"');
  assert.match(src, /require\('\.\/equipment'\)/,
    'and it must actually import them — a missing import is undefined at RENDER time, which no suite here would see');
}

console.log('equipment OK');
