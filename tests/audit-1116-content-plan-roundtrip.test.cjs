'use strict';
/* AUDIT 16 NOV 2026, finding #1 (High): a set count with an empty Target was
   written as `N x` and could not be read back.

   Add exercise with Sets 5 and a blank Target (the field is optional) wrote
   `- Pull-ups | 5 x`. parsePrescription needed text after the x, so that read
   back as {sets: null, target: "5 x"}: the Sets box came up empty, the session
   ran the default 3 sets and prefilled 5 reps. Clearing the Target of `4 x 8`
   wrote `4 x`, and typing Sets 6 after that wrote `6 x 4 x`.

   THE PROPERTY: write -> read is a fixpoint for every (sets, target) pair the
   UI can produce, the empty target included. Pure: drives plan-parse.js only.
   Also pinned here: lines that already parsed still parse the same, and a
   `- - -` rule or a bare `- ` is prose, never an exercise. */
const assert = require('node:assert');
const P = require('../src/plan-parse');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
};

const SETS = [null, 1, 3, 5, 12];
const TARGETS = ['', '8', '8-12', '45s', '5 @ 60kg', '65% max', 'submax', '3 x 10'];

const bodyOf = item => P.serializePlanBody({
  intro: [],
  days: [{ name: 'D', weekday: 'mon', parts: [{ kind: 'item', item }], notes: [], items: [item] }],
});
const readBack = body => P.parsePlanBody(body).days[0].items;

check('write -> read -> write is stable, and sets/target come back as given, for every pair the UI can make', () => {
  const bad = [];
  for (const sets of SETS) {
    for (const target of TARGETS) {
      const body = bodyOf({ exercise: 'Pull-ups', sets, target });
      const items = readBack(body);
      if (items.length !== 1) { bad.push(`sets=${sets} target="${target}": ${items.length} items read back from ${JSON.stringify(body)}`); continue; }
      const back = items[0];
      /* The one pair that is rewritten on the way: no count and a target that
         itself starts "3 x" is peeled, exactly as the Edit box's own peel does. */
      const want = sets === null && target === '3 x 10' ? { sets: 3, target: '10' } : { sets, target };
      if (back.sets !== want.sets || back.target !== want.target) {
        bad.push(`sets=${sets} target="${target}" wrote ${JSON.stringify(body.split('\n').pop() || body.split('\n')[body.split('\n').length - 2])} and read back {sets:${back.sets}, target:"${back.target}"}`);
        continue;
      }
      if (bodyOf(back) !== body) bad.push(`sets=${sets} target="${target}": second write differs from the first`);
    }
  }
  assert.deepStrictEqual(bad, [], `${bad.length} pair(s) do not survive a save:\n  ${bad.join('\n  ')}`);
});

check('Add exercise with Sets 5 and no Target: reads back as 5 sets (not a target of "5 x")', () => {
  const [it] = readBack(bodyOf({ exercise: 'Pull-ups', sets: 5, target: '' }));
  assert.strictEqual(it.sets, 5, `sets read back as ${it.sets}`);
  assert.strictEqual(it.target, '', `target read back as "${it.target}"`);
});

check('clearing the Target of `4 x 8`, then setting Sets 6, never writes `6 x 4 x`', () => {
  const day = P.parsePlanBody('## D (mon)\n\n- Rows | 4 x 8\n').days[0];
  P.updateItem(day, 0, { target: '' });
  const afterClear = P.serializePlanBody({ intro: [], days: [day] });
  const day2 = P.parsePlanBody(afterClear).days[0];
  P.updateItem(day2, 0, { sets: '6' });
  const out = P.serializePlanBody({ intro: [], days: [day2] });
  assert.ok(!/6 x 4 x/.test(out), `the second edit stacked a count on a dangling one: ${JSON.stringify(out)}`);
  assert.strictEqual(P.parsePlanBody(out).days[0].items[0].sets, 6);
  assert.strictEqual(P.parsePlanBody(out).days[0].items[0].target, '');
});

check('parsePrescription: a bare count reads as sets with an empty target', () => {
  for (const [text, sets] of [['5 x', 5], ['5 ×', 5], ['5x', 5], ['5 sets', 5], ['1 set', 1], ['3 sets x', 3], ['3 sets ×', 3]]) {
    assert.deepStrictEqual(P.parsePrescription(text), { sets, target: '' }, `"${text}"`);
  }
});

check('parsePrescription: every shape that parsed before parses the same (pinned)', () => {
  const pins = [
    ['5 x submax', { sets: 5, target: 'submax' }],
    ['3 × 8-12 @ 20kg', { sets: 3, target: '8-12 @ 20kg' }],
    ['3X8', { sets: 3, target: '8' }],
    ['3 X 8', { sets: 3, target: '8' }],
    ['4 sets of 10', { sets: 4, target: '10' }],
    ['3 sets x 10', { sets: 3, target: '10' }],
    ['3 sets × 10', { sets: 3, target: '10' }],
    ['5 Xtreme', { sets: null, target: '5 Xtreme' }],
    ['submax', { sets: null, target: 'submax' }],
    ['65% max', { sets: null, target: '65% max' }],
    ['30-45s', { sets: null, target: '30-45s' }],
    ['', { sets: null, target: '' }],
    ['3 x 3 x 10', { sets: 3, target: '3 x 10' }],
  ];
  for (const [text, want] of pins) assert.deepStrictEqual(P.parsePrescription(text), want, `"${text}"`);
});

check('a `- - -` rule inside a day is prose, not an exercise named "- -"', () => {
  const body = '## D (mon)\n\n- Push-ups | 3 x 10\n- - -\n- Dips | 3 x 8\n';
  const day = P.parsePlanBody(body).days[0];
  assert.deepStrictEqual(day.items.map(i => i.exercise), ['Push-ups', 'Dips'], `items: ${JSON.stringify(day.items.map(i => i.exercise))}`);
  assert.ok(day.notes.includes('- - -'), 'the rule is kept as a note line');
  assert.strictEqual(P.serializePlanBody({ intro: [], days: [day] }), body, 'and written back exactly where it was');
});

check('a bare `- ` line inside a day is prose, not an exercise named ""', () => {
  const body = '## D (mon)\n\n- Push-ups | 3 x 10\n- \n- Dips | 3 x 8\n';
  const day = P.parsePlanBody(body).days[0];
  assert.deepStrictEqual(day.items.map(i => i.exercise), ['Push-ups', 'Dips'], `items: ${JSON.stringify(day.items.map(i => i.exercise))}`);
  assert.strictEqual(P.serializePlanBody({ intro: [], days: [day] }), body, 'the line is written back untouched');
});

check('control: an exercise line with a pipe, and `- Name`, are still exercises', () => {
  const day = P.parsePlanBody('## D (mon)\n\n- A | 2 x 5\n- B\n- C | note | more\n').days[0];
  assert.deepStrictEqual(day.items.map(i => i.exercise), ['A', 'B', 'C']);
  assert.strictEqual(day.items[2].target, 'note | more');
});

if (failed) { console.error(`audit-1116 content plan round trip: ${failed} check(s) FAILED`); process.exit(1); }
console.log('audit-1116 content plan round trip OK');
