'use strict';
/* C-08: the Muscle Map marked nothing as working unless `muscles:` held the
   motion's exact group words as a real list. A hand-typed
   `muscles: quads, glutes` is ONE string "quads, glutes" to the frontmatter
   reader, which matched no group, so a squat showed no working muscle at all.
   Comma strings are split the way the rest of the app reads muscles
   (page-exercises parseMuscles), and a note whose muscles match none of the
   motion's prime movers gets the motion's own prime movers. */
const assert = require('node:assert');
const lib = require('../src/motion-library');

const ex = (name, muscles) => ({ name, fm: muscles === undefined ? {} : { muscles }, body: '' });
const work = (id, muscles) => lib.muscleRoles(lib.MOTIONS[id], ex('x', muscles)).prime.slice().sort();
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
};

check('C-08 a comma string "quads, glutes" marks the squat prime movers (same as the list form)', () => {
  const list = work('squat', ['quads', 'glutes']);
  assert.deepStrictEqual(list, ['glute', 'quad']);
  assert.deepStrictEqual(work('squat', 'quads, glutes'), list,
    `muscles: quads, glutes gave working=[${work('squat', 'quads, glutes')}] (the list form gives [${list}])`);
});

check('C-08 a comma string inside a list, spaces and capitals are all read', () => {
  assert.deepStrictEqual(work('squat', ['Quads, Glutes']), ['glute', 'quad']);
  assert.deepStrictEqual(work('squat', '  QUADS ,glutes  '), ['glute', 'quad']);
});

check('C-08 the front squat reads a comma string too', () => {
  assert.deepStrictEqual(work('squat-front', 'quads, glutes'), work('squat-front', ['quads', 'glutes']));
  assert.ok(work('squat-front', 'quads, glutes').length > 0, 'nothing marked working');
});

check('C-08 muscles that match none of the motion\'s prime movers fall back to the motion\'s own', () => {
  assert.deepStrictEqual(work('squat', ['legs']), ['glute', 'quad'],
    `muscles: [legs] gave working=[${work('squat', ['legs'])}], not the squat's prime movers`);
  assert.deepStrictEqual(work('squat', 'quadriceps'), ['glute', 'quad']);
  assert.deepStrictEqual(work('push-up', 'quads, glutes'), ['delt', 'pec', 'tri'],
    'a push-up note listing only leg muscles still lights up the push-up movers');
});

check('C-08 existing behaviour is kept: a listed prime group narrows the work, front delt always counts', () => {
  assert.deepStrictEqual(work('push-up', ['triceps']), ['delt', 'tri']);
  assert.deepStrictEqual(work('push-up', ['chest', 'triceps', 'core']), ['delt', 'pec', 'tri']);
  assert.deepStrictEqual(work('push-up', undefined), ['delt', 'pec', 'tri']);
  assert.deepStrictEqual(work('push-up', ''), ['delt', 'pec', 'tri']);
});

if (failed) { console.log(`F5 muscle roles: ${failed} guard(s) FAILED`); process.exit(1); }
console.log('F5 muscle roles OK');
