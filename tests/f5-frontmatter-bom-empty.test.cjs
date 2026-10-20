'use strict';
/* C-10: a note that starts with a byte-order mark, or has an EMPTY `---` / `---`
   frontmatter block, was read as having NO frontmatter. The first app save then
   wrote a second block on top and pushed the note's own `---` block into the body.
   Both are common (Windows editors add a BOM; Obsidian itself writes an empty
   block for a note whose properties were all removed). */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const { parseFrontmatter } = loadSrc('markdown.js');
const { makeIo } = loadSrc('data.js');
const { check, run } = makeRunner();

const count = (t, s) => t.split(s).length - 1;

check('C-10 parse: a leading BOM does not hide the frontmatter', () => {
  const r = parseFrontmatter('﻿---\nunit: reps\nmuscles: [chest]\n---\nHow to do it.\n');
  assert.strictEqual(r.fm.unit, 'reps', `unit read as ${JSON.stringify(r.fm.unit)}: the whole note was treated as body`);
  assert.deepStrictEqual(r.fm.muscles, ['chest']);
  assert.strictEqual(r.body, 'How to do it.\n');
});

check('C-10 parse: an empty --- / --- block is a frontmatter block, not body', () => {
  const r = parseFrontmatter('---\n---\nHow to.\n');
  assert.strictEqual(r.body, 'How to.\n', `body is ${JSON.stringify(r.body)}: the empty block was left in the body`);
  assert.deepStrictEqual(Object.keys(r.fm), []);
});

check('C-10 parse: an empty block followed by a horizontal rule does not swallow the text between', () => {
  const r = parseFrontmatter('---\n---\nIntro\n\n---\nAfter the rule\n');
  assert.strictEqual(r.body, 'Intro\n\n---\nAfter the rule\n', `body is ${JSON.stringify(r.body)}`);
});

check('C-10 parse: CRLF empty block and ordinary notes are unchanged', () => {
  assert.strictEqual(parseFrontmatter('---\r\n---\r\nX\r\n').body, 'X\r\n');
  const r = parseFrontmatter('---\nunit: reps\n---\n\nBody\n');
  assert.strictEqual(r.fm.unit, 'reps');
  assert.strictEqual(r.body, 'Body\n');
  assert.strictEqual(parseFrontmatter('No block here\n').body, 'No block here\n');
});

check('C-10 save: the first app save of a BOM / empty-block note writes ONE frontmatter block', async () => {
  const cases = {
    bom: '﻿---\nunit: reps\nmuscles: [chest]\n---\nHow to do it.\n',
    empty: '---\n---\nHow to.\n',
  };
  const v = makeVault(Object.entries(cases).map(([k, t]) => [`Gym/Exercises/${k}.md`, t]));
  const io = makeIo(makePlugin(v));
  const data = await io.loadAll();
  for (const ex of data.exercises) {
    ex.fm.motion_counting = true;
    assert.ok(await io.saveExercise(ex), `${ex.name} did not save`);
    const after = v._disk.get(ex.file.path);
    assert.strictEqual(count(after, '\n---\n') + (after.startsWith('---\n') ? 1 : 0), 2,
      `${ex.name}: the saved note has more than one frontmatter block: ${JSON.stringify(after)}`);
  }
  assert.ok(/unit: reps/.test(v._disk.get('Gym/Exercises/bom.md')), 'the BOM note lost its own properties');
});

run('F5 frontmatter BOM / empty block');
