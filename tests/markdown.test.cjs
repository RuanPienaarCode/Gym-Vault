'use strict';
/* Round-trip guarantees for the storage layer. */
const assert = require('node:assert');
const { parseFrontmatter, serializeFrontmatter, parseMdTable, tableToObjects, buildMdTable } = require('../src/markdown');
const { BODY_COLUMNS, WORKOUT_COLUMNS } = require('../src/constants');

/* frontmatter: scalars, quoted strings, inline lists */
{
  const text = '---\ntype: strength\nmuscles: [back, biceps]\nequipment: "bar: straight"\ntarget: 10\n---\n\nBody text.\n';
  const { fm, body } = parseFrontmatter(text);
  assert.strictEqual(fm.type, 'strength');
  assert.deepStrictEqual(fm.muscles, ['back', 'biceps']);
  assert.strictEqual(fm.equipment, 'bar: straight');
  assert.strictEqual(fm.target, '10');
  assert.strictEqual(body.trim(), 'Body text.');

  const re = parseFrontmatter(serializeFrontmatter(fm) + '\n' + body);
  assert.strictEqual(re.fm.type, 'strength');
  assert.deepStrictEqual(re.fm.muscles, ['back', 'biceps']);
  assert.strictEqual(re.fm.equipment, 'bar: straight');
}

/* serializer skips empties, keeps numbers/booleans */
{
  const out = serializeFrontmatter({ a: '', b: null, c: undefined, active: true, n: 0 });
  assert.ok(out.includes('active: true'));
  assert.ok(out.includes('n: 0'));
  assert.ok(!out.includes('a:'));
}

/* table round trip incl. pipes and newlines in cells */
{
  const rows = [
    { date: '2026-08-26', weight_kg: '70.5', body_fat_pct: '', chest_cm: '', waist_cm: '80', hips_cm: '', arm_cm: '', thigh_cm: '', resting_hr: '62', note: 'after run | felt good\ntwo lines' },
  ];
  const md = buildMdTable(BODY_COLUMNS, rows);
  const back = tableToObjects(md, BODY_COLUMNS);
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].weight_kg, '70.5');
  assert.strictEqual(back[0].waist_cm, '80');
  assert.strictEqual(back[0].note, 'after run | felt good\ntwo lines');
}

/* first-table-only: a second table below must not bleed in */
{
  const text = buildMdTable(WORKOUT_COLUMNS, [{ exercise: 'Pull-ups', set: '1', reps: '8', weight_kg: '', seconds: '', note: '' }])
    + '\n\nSome prose.\n\n| Other | Table |\n|---|---|\n| a | b |\n';
  const rows = tableToObjects(text, WORKOUT_COLUMNS);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].exercise, 'Pull-ups');
}

/* hand-edited row missing its trailing pipe keeps the final cell */
{
  const rows = parseMdTable('| a | b | c\n|---|---|---|\n| 1 | 2 | 3');
  assert.deepStrictEqual(rows[1], ['1', '2', '3']);
}

console.log('markdown round-trips OK');
