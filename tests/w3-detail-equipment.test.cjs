'use strict';
/* L4-08: an exercise note with two or more equipment items printed
   "bardumbbells" on its detail page - el() flattened the array into adjacent
   text nodes with no separator. Each item is now its own tag, labelled the way
   the kit chips elsewhere in the app label it. */
const assert = require('node:assert');
const T = require('./f3-stub');
const detail = require('../src/page-exercise-detail');

const tagsFor = equipment => {
  const ex = { name: 'Row', file: { path: 'Gym/Exercises/Row.md' }, fm: { type: 'strength', equipment, muscles: ['back'] }, body: '' };
  const ctx = {
    data: { exercises: [ex], workouts: [] },
    settings: {}, state: { params: { exercise: 'Row', path: ex.file.path } },
    app: {}, view: null, nav() {}, notice() {}, reload() {}, openFile() {}, back() {}, backTo: f => f,
  };
  const root = T.render(detail, ctx);
  return T.findAll(root, 'gv-tag').map(t => t.textContent.replace(/\s+/g, ' ').trim());
};

const failures = [];
const test = (name, fn) => { try { fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

test('L4-08 a YAML list of equipment reads as separate labelled tags', () => {
  const tags = tagsFor(['bar', 'dumbbells']);
  assert.ok(tags.includes('Pull-up bar') && tags.includes('Dumbbells'), `tags: ${JSON.stringify(tags)}`);
  assert.ok(!tags.some(t => /bardumbbells|bar dumbbells/i.test(t)), 'items must not run together');
});
test('L4-08 a comma string reads the same way', () => {
  const tags = tagsFor('bar, kettlebell');
  assert.ok(tags.includes('Pull-up bar') && tags.includes('Kettlebell'), `tags: ${JSON.stringify(tags)}`);
});
test('L4-08 control: one item and free text still show', () => {
  assert.ok(tagsFor('sandbag').includes('Sandbag'));
  assert.ok(tagsFor('bodyweight').includes('Bodyweight'), 'a bodyweight-only note keeps its tag');
  assert.ok(!tagsFor('').some(t => /undefined|^$/.test(t)), 'no equipment -> no equipment tag');
});
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 detail equipment OK');
