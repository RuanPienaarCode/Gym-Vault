'use strict';
/* L2-12 — Body Log and workout tables were read by column POSITION; only the
   write path checked headers. A hand-made table with the columns in another
   order (or an extra column of the user's own in the middle) was misread:
   "Waist" values shown as weight. Now read by header name when the header
   names the columns, positional otherwise. */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const { makeIo, tableByHeader } = loadSrc('data.js');
const { BODY_COLUMNS, WORKOUT_COLUMNS } = require('../src/constants');
const { tableToObjects, buildMdTable } = require('../src/markdown');
const { check, run } = makeRunner();

const pick = (rows, keys) => rows.map(r => Object.fromEntries(keys.map(k => [k, r[k]])));

check('L2-12 a body table with its columns in another order is read by header name', () => {
  const t = '| Date | Waist (cm) | Weight (kg) |\n|---|---|---|\n| 2026-10-01 | 80 | 70.5 |\n';
  const rows = tableByHeader(t, BODY_COLUMNS);
  assert.deepStrictEqual(pick(rows, ['date', 'weight_kg', 'waist_cm']), [{ date: '2026-10-01', weight_kg: '70.5', waist_cm: '80' }]);
});

check('L2-12 a column of the user\'s own in the middle does not shift the ones after it', () => {
  const t = '| Exercise | My feeling | Set | Reps | Weight (kg) |\n|---|---|---|---|---|\n| Press | great | 1 | 8 | 40 |\n';
  const rows = tableByHeader(t, WORKOUT_COLUMNS);
  assert.deepStrictEqual(pick(rows, ['exercise', 'set', 'reps', 'weight_kg']), [{ exercise: 'Press', set: '1', reps: '8', weight_kg: '40' }]);
});

check('L2-12 headers that name no column fall back to position, exactly as before', () => {
  const t = '| A | B | C |\n|---|---|---|\n| Press | 1 | 8 |\n';
  assert.deepStrictEqual(tableByHeader(t, WORKOUT_COLUMNS), tableToObjects(t, WORKOUT_COLUMNS));
  assert.strictEqual(tableByHeader(t, WORKOUT_COLUMNS)[0].reps, '8');
});

check('L2-12 a table written by the app reads identically (the header matches positionally)', () => {
  const t = buildMdTable(WORKOUT_COLUMNS, [{ exercise: 'Press', set: '1', reps: '8', weight_kg: '40', seconds: '', note: 'x | y', distance_km: '' }]);
  assert.deepStrictEqual(tableByHeader(t, WORKOUT_COLUMNS), tableToObjects(t, WORKOUT_COLUMNS));
  const old = '| Exercise | Set | Reps |\n|---|---|---|\n| Press | 1 | 8 |\n';
  assert.deepStrictEqual(tableByHeader(old, WORKOUT_COLUMNS), tableToObjects(old, WORKOUT_COLUMNS));
  const extra = buildMdTable(WORKOUT_COLUMNS, [{ exercise: 'P', set: '1' }], ['Mine']);
  assert.deepStrictEqual(tableByHeader(extra, WORKOUT_COLUMNS), tableToObjects(extra, WORKOUT_COLUMNS));
});

check('L2-12 a lightly renamed header (Weight vs Weight (kg)) in its own slot is still read from that slot', () => {
  const t = '| Date | Weight | Waist (cm) |\n|---|---|---|\n| 2026-10-01 | 70.5 | 80 |\n';
  const r = tableByHeader(t, BODY_COLUMNS)[0];
  assert.strictEqual(r.waist_cm, '80');
  assert.strictEqual(r.weight_kg, '70.5');
});

check('L2-12 loadAll uses it for the Body Log and for workouts', async () => {
  const v = makeVault([
    ['Gym/Body Log.md', '| Date | Waist (cm) | Weight (kg) |\n|---|---|---|\n| 2026-10-01 | 80 | 70.5 |\n'],
    ['Gym/Workouts/2026-10-01 A.md', '---\ndate: 2026-10-01\n---\n| Exercise | Reps | Set |\n|---|---|---|\n| Press | 8 | 1 |\n'],
  ]);
  const d = await makeIo(makePlugin(v)).loadAll();
  assert.strictEqual(d.body[0].weight_kg, '70.5');
  assert.strictEqual(d.body[0].waist_cm, '80');
  assert.strictEqual(d.workouts[0].rows[0].reps, '8');
  assert.strictEqual(d.workouts[0].rows[0].set, '1');
});

run('w1-table-by-header');
