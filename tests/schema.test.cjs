'use strict';
/* TRIPWIRE — the flat-table schemas are APPEND-ONLY.

   Every row in Body Log.md / a workout note is mapped POSITIONALLY against
   these arrays, so reordering or removing a key silently re-reads existing
   user data as the wrong field (a note column read as a blood-pressure
   reading, a weight read as a waist). Adding a NEW key at the END is the
   only safe change — and that is exactly what this test allows.

   If this test fails, do NOT "update the expected list" to make it pass
   unless you are appending. Reordering is a data-corruption bug. */
const assert = require('node:assert');
const { BODY_COLUMNS, WORKOUT_COLUMNS } = require('../src/constants');

const FROZEN_BODY = [
  'date', 'weight_kg', 'body_fat_pct', 'chest_cm', 'waist_cm', 'hips_cm',
  'arm_cm', 'thigh_cm', 'resting_hr', 'note',
  'bp_systolic', 'bp_diastolic', 'cholesterol', 'glucose',
];
const FROZEN_WORKOUT = ['exercise', 'set', 'reps', 'weight_kg', 'seconds', 'note'];

const keys = cols => cols.map(c => c.key);

/* The frozen prefix must survive verbatim; anything beyond it is an append. */
assert.deepStrictEqual(
  keys(BODY_COLUMNS).slice(0, FROZEN_BODY.length), FROZEN_BODY,
  'BODY_COLUMNS was reordered or a key removed — existing Body Log rows would be misread');
assert.deepStrictEqual(
  keys(WORKOUT_COLUMNS).slice(0, FROZEN_WORKOUT.length), FROZEN_WORKOUT,
  'WORKOUT_COLUMNS was reordered or a key removed — existing workout rows would be misread');

/* Labels land in the markdown header row, so they must be unique and
   non-empty, and keys must be unique or the object mapping collides. */
for (const [name, cols] of [['BODY_COLUMNS', BODY_COLUMNS], ['WORKOUT_COLUMNS', WORKOUT_COLUMNS]]) {
  const k = keys(cols), l = cols.map(c => c.label);
  assert.strictEqual(new Set(k).size, k.length, `${name}: duplicate key`);
  assert.strictEqual(new Set(l).size, l.length, `${name}: duplicate label`);
  for (const c of cols) {
    assert.ok(c.key && c.label, `${name}: a column is missing key or label`);
    assert.ok(!/\|/.test(c.label), `${name}: a label contains a pipe and would break the table`);
  }
}

console.log(`schema tripwire OK (body ${BODY_COLUMNS.length} cols, workout ${WORKOUT_COLUMNS.length})`);
