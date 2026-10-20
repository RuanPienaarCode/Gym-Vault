'use strict';
/* L2-16 — a hand-written plan must read the way it looks.

   The parser only knew `- ` bullets and `5 x submax`. A plan typed in another
   editor (`* ` or `+ ` bullets, `1.` / `1)` numbered lines, "3X8", "4 sets of
   10") parsed as a pile of prose: no exercises, an empty day, no error.

   The other half of the rule: every line that ALREADY parsed must parse
   identically, so the "before" table below is the output of the previous
   parser, frozen. */
const assert = require('node:assert');
const { makeRunner } = require('./gym-fake-vault');
const { parsePlanBody, serializePlanBody, parsePrescription } = require('../src/plan-parse');
const { SEED_PLAN, SEED_RUN_PLAN, SEED_REST_PLAN } = require('../src/seed');

const { check, run } = makeRunner();

/* BEFORE: [line, result of parsePrescription before this change]. */
const BEFORE = [
  ['5 x submax', 5, 'submax'], ['3 × 8-12', 3, '8-12'], ['3x8', 3, '8'], ['3 x 8 @ 20kg', 3, '8 @ 20kg'],
  ['just move', null, 'just move'], ['', null, ''], ['12', null, '12'], ['submax', null, 'submax'],
  ['1 x 30 min easy', 1, '30 min easy'], ['2 x 10/leg', 2, '10/leg'], ['3x', null, '3x'], ['x 5', null, 'x 5'],
  ['3 x', null, '3 x'], ['10 reps', null, '10 reps'], ['3 sets', null, '3 sets'], ['5 x 5 @ 100 kg', 5, '5 @ 100 kg'],
  ['4×6', 4, '6'], ['65% max', null, '65% max'], ['30-45s', null, '30-45s'], ['3 xylophone', 3, 'ylophone'],
  ['2 x 30-45s', 2, '30-45s'], ['8/leg', null, '8/leg'], ['1 round of 5', null, '1 round of 5'],
  ['0 x 5', 0, '5'], ['10 x 1 x 5', 10, '1 x 5'],
];

check('L2-16 every prescription line that parsed before parses identically', () => {
  for (const [line, sets, target] of BEFORE) {
    assert.deepStrictEqual(parsePrescription(line), { sets, target }, `"${line}"`);
  }
});

check('L2-16 the seed plans parse exactly as before (frozen digest)', () => {
  const dump = p => JSON.stringify(parsePlanBody(p.body).days.map(d => [d.name, d.weekday, d.items.map(i => [i.exercise, i.sets, i.target])]));
  const all = dump(SEED_PLAN) + dump(SEED_RUN_PLAN) + dump(SEED_REST_PLAN);
  let h = 5381; for (let i = 0; i < all.length; i++) h = ((h * 33) ^ all.charCodeAt(i)) >>> 0;
  assert.strictEqual(h, SEED_DIGEST, `digest ${h}`);
});

check('L2-16 a "- " bullet item has exactly the old shape (no marker key)', () => {
  const m = parsePlanBody('## A (mon)\n\n- Pull-ups | 5 x submax\n- Dead Hang\n');
  assert.deepStrictEqual(m.days[0].items, [{ exercise: 'Pull-ups', sets: 5, target: 'submax' }, { exercise: 'Dead Hang', sets: null, target: '' }]);
});

check('L2-16 "3X8", "3 X 8", "4 sets of 10", "3 sets x 10", "3 sets × 10" read as sets and a target', () => {
  assert.deepStrictEqual(parsePrescription('3X8'), { sets: 3, target: '8' });
  assert.deepStrictEqual(parsePrescription('3 X 8-12'), { sets: 3, target: '8-12' });
  assert.deepStrictEqual(parsePrescription('4 sets of 10'), { sets: 4, target: '10' });
  assert.deepStrictEqual(parsePrescription('4 Sets Of 10 @ 20kg'), { sets: 4, target: '10 @ 20kg' });
  assert.deepStrictEqual(parsePrescription('3 sets x 10'), { sets: 3, target: '10' });
  assert.deepStrictEqual(parsePrescription('3 sets × 10'), { sets: 3, target: '10' });
  assert.deepStrictEqual(parsePrescription('1 set of 30s'), { sets: 1, target: '30s' });
  assert.deepStrictEqual(parsePrescription('3 sets of'), { sets: null, target: '3 sets of' });
});

check('L2-16 "* " and "+ " bullets and "1." / "1)" numbered lines are exercise items', () => {
  const body = ['## A (mon)', '', '* Pull-ups | 3X8', '+ Rows | 4 sets of 10', '1. Dips | 3 x 12', '2) Dead Hang | 30s', '10. Squats'].join('\n');
  const items = parsePlanBody(body).days[0].items;
  assert.deepStrictEqual(items.map(i => [i.exercise, i.sets, i.target]),
    [['Pull-ups', 3, '8'], ['Rows', 4, '10'], ['Dips', 3, '12'], ['Dead Hang', null, '30s'], ['Squats', null, '']]);
});

check('L2-16 an indented "* " line stays an annotation, a thematic break stays prose', () => {
  const body = ['## A (mon)', '', '- Pull-ups | 3 x 8', '  * grip: overhand', '* * *', '***', '---', '- Rows | 3 x 8'].join('\n');
  const d = parsePlanBody(body).days[0];
  assert.deepStrictEqual(d.items.map(i => i.exercise), ['Pull-ups', 'Rows']);
});

check('L2-16 the author\'s own bullet marker survives a save (no silent rewrite to "- ")', () => {
  const body = ['## A (mon)', '', '* Pull-ups | 3 x 8', '+ Rows | 4 x 10', '1. Dips | 3 x 12', '2) Hang | 30s', '- Plain | 3 x 5'].join('\n');
  const out = serializePlanBody(parsePlanBody(body));
  assert.ok(out.includes('\n* Pull-ups | 3 x 8\n'), out);
  assert.ok(out.includes('\n+ Rows | 4 x 10\n'), out);
  assert.ok(out.includes('\n1. Dips | 3 x 12\n'), out);
  assert.ok(out.includes('\n2) Hang | 30s\n'), out);
  assert.ok(out.includes('\n- Plain | 3 x 5\n'), out);
  assert.strictEqual(serializePlanBody(parsePlanBody(out)), out, 'fixpoint');
});

check('L2-16 an item added in the app still writes a "- " bullet', () => {
  const { addItem } = require('../src/plan-parse');
  const m = parsePlanBody('## A (mon)\n\n* X | 3 x 8\n');
  addItem(m.days[0], { exercise: 'New', sets: 3, target: '5' });
  assert.ok(serializePlanBody(m).includes('\n- New | 3 x 5'), serializePlanBody(m));
});

const SEED_DIGEST = 2434849774;
run('w1-plan-hand-written');
