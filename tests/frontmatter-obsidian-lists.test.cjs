'use strict';
/* The frontmatter layer must read and write what OBSIDIAN writes.

   L2-02. Obsidian's Properties panel (processFrontMatter -> eemeli/yaml
   stringify) writes every list as a BLOCK SEQUENCE:

       muscles:
         - chest
         - triceps

   The reader passed those through untouched instead of reading them, so an
   exercise's image / muscles / equipment and a running plan's ladder read as
   absent. Worse, when the app later set that key the serializer APPENDED a
   second copy (`muscles` twice) — Obsidian's parser has uniqueKeys:true, so
   the note's properties became invalid. An empty `active:` did the same:
   Make active wrote `active:\nactive: true`.

   L2-09. A YAML single-quoted scalar (`unit: 'seconds'`, `''` = one literal
   `'`) kept its quotes when read, and the next save double-wrapped it as
   `unit: "'seconds'"`.

   Contract pinned here: a block sequence of scalars is READ as an array on
   every key; on write a key that already sits in the file is REPLACED where
   it sits (the plugin's flow style for what it writes), never duplicated; a
   key the plugin does not touch keeps its exact original text. */
const assert = require('node:assert');
const { parseFrontmatter, serializeFrontmatter } = require('../src/markdown');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
};

const roundTrip = text => {
  const { fm, body } = parseFrontmatter(text);
  return serializeFrontmatter(fm) + '\n' + body;
};
/* Top-level keys of the frontmatter block, as a duplicate-key-intolerant
   parser (Obsidian's) would see them. */
const topKeys = text => {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m[1].split(/\r?\n/).map(l => (l.match(/^([^\s#-][^:]*):/) || [])[1]).filter(Boolean);
};
const count = (text, key) => topKeys(text).filter(k => k === key).length;
const note = (fmLines, body = 'Body.\n') => `---\n${fmLines}\n---\n${body}`;

console.log('frontmatter, Obsidian-written lists');

/* ---- L2-02: reading ---------------------------------------------------- */

check('L2-02 read: block sequences of scalars read as arrays (muscles/equipment/image)', () => {
  const { fm } = parseFrontmatter(note(
    'type: strength\nmuscles:\n  - chest\n  - triceps\nequipment:\n  - bench\n  - dumbbells\nunit: reps\n'
    + 'image:\n  - Gym/Attachments/Sample Press/a.jpg\n  - Gym/Attachments/Sample Press/b.jpg'));
  assert.deepStrictEqual(fm.muscles, ['chest', 'triceps'], `muscles read as ${JSON.stringify(fm.muscles)}`);
  assert.deepStrictEqual(fm.equipment, ['bench', 'dumbbells'], `equipment read as ${JSON.stringify(fm.equipment)}`);
  assert.deepStrictEqual(fm.image, ['Gym/Attachments/Sample Press/a.jpg', 'Gym/Attachments/Sample Press/b.jpg'],
    `image read as ${JSON.stringify(fm.image)}`);
  assert.strictEqual(fm.type, 'strength');
  assert.strictEqual(fm.unit, 'reps');
});

check('L2-02 read: a running plan ladder written as a block sequence reads like the flow form', () => {
  const flow = parseFrontmatter(note('parallel: true\nladder: [4, 5, 6]\nstart_date: 2026-09-07')).fm.ladder;
  const block = parseFrontmatter(note('parallel: true\nladder:\n  - 4\n  - 5\n  - 6\nstart_date: 2026-09-07')).fm.ladder;
  assert.deepStrictEqual(block, flow, `block ladder read as ${JSON.stringify(block)}, flow as ${JSON.stringify(flow)}`);
  assert.deepStrictEqual(block, ['4', '5', '6']);
});

check('L2-02 read: ANY key, not just the modelled ones; un-indented sequences too', () => {
  const { fm } = parseFrontmatter(note('anything_else:\n  - one\n  - two\nflush:\n- x\n- y\nafter: 1'));
  assert.deepStrictEqual(fm.anything_else, ['one', 'two'], `anything_else read as ${JSON.stringify(fm.anything_else)}`);
  assert.deepStrictEqual(fm.flush, ['x', 'y'], `un-indented sequence read as ${JSON.stringify(fm.flush)}`);
  assert.strictEqual(fm.after, '1', 'the key after a flush sequence was swallowed');
});

check('L2-02 read: quoted items (double, single, wikilink) are unquoted; commas inside survive', () => {
  const { fm } = parseFrontmatter(note(
    'a:\n  - "x, y"\n  - \'it\'\'s\'\n  - "[[pic.png]]"\n  - plain: with-colon-after-nothing\nb:\n  - "say \\"go\\""\n  - https://example.test/p.jpg'));
  /* `plain: with-colon-after-nothing` is a MAP item, so `a` is not a list of
     scalars and must NOT be modelled — see the next check for the clean case. */
  assert.strictEqual(fm.a, undefined, `a list holding a map item was modelled as ${JSON.stringify(fm.a)}`);
  assert.deepStrictEqual(fm.b, ['say "go"', 'https://example.test/p.jpg'], `b read as ${JSON.stringify(fm.b)}`);
  const clean = parseFrontmatter(note('a:\n  - "x, y"\n  - \'it\'\'s\'\n  - "[[pic.png]]"\n  - 10:30')).fm.a;
  assert.deepStrictEqual(clean, ['x, y', "it's", '[[pic.png]]', '10:30'], `quoted items read as ${JSON.stringify(clean)}`);
});

check('L2-02 read: a list with blank / comment lines between items still reads whole', () => {
  const { fm } = parseFrontmatter(note('m:\n  - a\n\n  # why\n  - b\nn: 1'));
  assert.deepStrictEqual(fm.m, ['a', 'b'], `m read as ${JSON.stringify(fm.m)}`);
  assert.strictEqual(fm.n, '1');
});

check('L2-02 read: a trailing YAML comment is not part of the item; a `#` inside a value or wikilink is', () => {
  const { fm } = parseFrontmatter(note('m:\n  - chest  # primary\n  - Gym/pic#2.jpg\n  - "a #b"\n  - [[pic#frag.png]]'));
  assert.deepStrictEqual(fm.m, ['chest', 'Gym/pic#2.jpg', 'a #b', '[[pic#frag.png]]'], `m read as ${JSON.stringify(fm.m)}`);
});

check('L2-02 read: a nested map / list of maps / block scalar is still NOT hoisted or modelled', () => {
  const { fm } = parseFrontmatter(note('archive:\n  active: true\nsteps:\n  - name: a\n    reps: 3\ncue: >\n  hold tight\nreal: 1'));
  assert.strictEqual(fm.active, undefined, 'a nested key was hoisted to the top level');
  assert.strictEqual(fm.name, undefined, 'a map item leaked to the top level');
  assert.strictEqual(fm.archive, undefined);
  assert.strictEqual(fm.steps, undefined, `list of maps modelled as ${JSON.stringify(fm.steps)}`);
  assert.strictEqual(fm.real, '1');
});

/* ---- L2-02: writing ---------------------------------------------------- */

check('L2-02 write: a block list the plugin does not touch round-trips BYTE-FOR-BYTE', () => {
  const text = note('type: strength\ntags:\n  - gym\n  - push\nmuscles:\n  - chest\n  - triceps\n  - "x, y"\n\n# user comment\nunit: reps\nflush:\n- a\n- b');
  assert.strictEqual(roundTrip(text), text.replace('\n---\nBody.', '\n---\n\nBody.'),
    `untouched block lists changed:\n${roundTrip(text)}`);
});

check('L2-02 write: setting a key that is a block list REPLACES it in place — one copy, plugin style', () => {
  const text = note('type: strength\nmuscles:\n  - chest\n  - triceps\nequipment:\n  - bench\nunit: reps');
  const { fm, body } = parseFrontmatter(text);
  fm.muscles = ['chest', 'triceps', 'back'];
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.strictEqual(count(out, 'muscles'), 1, `"muscles" appears ${count(out, 'muscles')}x:\n${out}`);
  assert.deepStrictEqual(topKeys(out), ['type', 'muscles', 'equipment', 'unit'], `key order/duplicates:\n${out}`);
  assert.match(out, /^muscles: \[chest, triceps, back\]$/m, `not written in the plugin's flow style:\n${out}`);
  assert.ok(!/^ {2}- chest$/m.test(out), `old items left behind:\n${out}`);
  assert.match(out, /^equipment:\n {2}- bench$/m, `untouched neighbour disturbed:\n${out}`);
});

check('L2-02 write: mutating the array IN PLACE (push) is a change too', () => {
  const { fm, body } = parseFrontmatter(note('muscles:\n  - chest'));
  fm.muscles.push('back');
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.match(out, /^muscles: \[chest, back\]$/m, `in-place push not written:\n${out}`);
  assert.strictEqual(count(out, 'muscles'), 1);
});

check('L2-02 write: re-setting the SAME value (form submit, numbers for strings) keeps the original text', () => {
  const text = note('ladder:\n  - 4\n  - 5\n  - 6\nmuscles:\n  - chest');
  const { fm, body } = parseFrontmatter(text);
  fm.ladder = [4, 5, 6];
  fm.muscles = ['chest'];
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.match(out, /^ladder:\n {2}- 4\n {2}- 5\n {2}- 6\nmuscles:\n {2}- chest\n---$/m, `same-value write rewrote the block:\n${out}`);
});

check('L2-02 write: clearing a block list removes the key (same as clearing a flow list)', () => {
  const { fm, body } = parseFrontmatter(note('type: strength\nmuscles:\n  - chest\nunit: reps'));
  fm.muscles = [];
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.deepStrictEqual(topKeys(out), ['type', 'unit'], `after clearing:\n${out}`);
  assert.ok(!/- chest/.test(out), `items orphaned:\n${out}`);
});

check('L2-02 write: an EMPTY `active:` + Make active writes ONE `active: true`, in place', () => {
  const { fm, body } = parseFrontmatter(note('name: A\nactive:\nparallel: false', '## D (mon)\n'));
  fm.active = true;
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.strictEqual(count(out, 'active'), 1, `"active" appears ${count(out, 'active')}x: ${JSON.stringify(out.split('\n---')[0])}`);
  assert.deepStrictEqual(topKeys(out), ['name', 'active', 'parallel'], `key order:\n${out}`);
  assert.match(out, /^active: true$/m);
});

check('L2-02 write: an EMPTY key the plugin leaves alone (or re-sets empty) keeps its line', () => {
  const text = note('type: strength\nmynote:\nimage:\nunit: reps');
  assert.strictEqual(roundTrip(text), text.replace('\n---\nBody.', '\n---\n\nBody.'), `empty keys lost:\n${roundTrip(text)}`);
  const { fm, body } = parseFrontmatter(text);
  fm.image = '';
  fm.mynote = [];
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.deepStrictEqual(topKeys(out), ['type', 'mynote', 'image', 'unit'], `re-set empty dropped a key:\n${out}`);
});

check('L2-02 write: a key the plugin only knows as nested map / block scalar is replaced, not duplicated', () => {
  const { fm, body } = parseFrontmatter(note('cue: >\n  hold tight\ncoach:\n  name: X\nunit: reps'));
  fm.cue = 'brace';
  fm.coach = 'Y';
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.deepStrictEqual(topKeys(out), ['cue', 'coach', 'unit'], `keys:\n${out}`);
  assert.match(out, /^cue: brace$/m);
  assert.ok(!/hold tight|name: X/.test(out), `old continuation lines left under the new value:\n${out}`);
});

check('L2-02 write: a file ALREADY corrupted with a duplicate key is healed on the next save', () => {
  const { fm, body } = parseFrontmatter(note('muscles:\n  - chest\n  - triceps\nunit: reps\nmuscles: [chest, triceps]'));
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.strictEqual(count(out, 'muscles'), 1, `"muscles" appears ${count(out, 'muscles')}x:\n${out}`);
});

check('L2-02 write: the audit scenario end to end (Obsidian block list -> app Edit -> save) leaves unique keys', () => {
  const text = note('type: strength\nmuscles:\n  - chest\n  - triceps\nequipment:\n  - bench\nunit: reps\nimage:\n  - a.jpg\n  - b.jpg');
  const { fm, body } = parseFrontmatter(text);
  Object.assign(fm, { type: 'strength', muscles: ['chest', 'triceps'], equipment: ['bench'], unit: 'reps' });
  fm.motion_sensitivity = 'high';
  const out = serializeFrontmatter(fm) + '\n' + body;
  const keys = topKeys(out);
  assert.deepStrictEqual(keys, ['type', 'muscles', 'equipment', 'unit', 'image', 'motion_sensitivity'], `keys:\n${out}`);
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate keys');
  assert.match(out, /^image:\n {2}- a\.jpg\n {2}- b\.jpg$/m);
});

check('L2-02 write: save cycles are a fixpoint with block lists in the file', () => {
  let text = note('type: strength\nmuscles:\n  - chest\nactive:\ntags:\n  - gym\nunit: reps');
  const first = (() => { const { fm, body } = parseFrontmatter(text); fm.muscles = ['chest', 'back']; fm.active = true; return serializeFrontmatter(fm) + '\n' + body; })();
  assert.deepStrictEqual(topKeys(first), ['type', 'muscles', 'active', 'tags', 'unit'], `first save:\n${first}`);
  text = first;
  for (let i = 0; i < 3; i++) {
    const next = roundTrip(text);
    assert.strictEqual(next, first, `cycle ${i} drifted:\n${next}`);
    text = next;
  }
});

/* ---- L2-09: single-quoted scalars -------------------------------------- */

check("L2-09 read: 'seconds' reads as seconds; '' inside is one literal '", () => {
  const { fm } = parseFrontmatter(note("unit: 'seconds'\nvideo: 'https://example.test/hold.mp4'\nnote: 'it''s'\nempty: ''"));
  assert.strictEqual(fm.unit, 'seconds', `unit read as ${JSON.stringify(fm.unit)}`);
  assert.strictEqual(fm.video, 'https://example.test/hold.mp4', `video read as ${JSON.stringify(fm.video)}`);
  assert.strictEqual(fm.note, "it's", `note read as ${JSON.stringify(fm.note)}`);
  assert.strictEqual(fm.empty, '', `'' read as ${JSON.stringify(fm.empty)}`);
});

check('L2-09 read: a value that merely starts and ends with a quote keeps its delimiters', () => {
  const { fm } = parseFrontmatter(note("a: 'x' and 'y'\nb: '\nc: 'abc"));
  assert.strictEqual(fm.a, "'x' and 'y'", `a read as ${JSON.stringify(fm.a)}`);
  assert.strictEqual(fm.b, "'", `b read as ${JSON.stringify(fm.b)}`);
  assert.strictEqual(fm.c, "'abc", `c read as ${JSON.stringify(fm.c)}`);
});

check('L2-09 write: a single-quoted value does not grow quotes across save cycles', () => {
  let text = note("type: strength\nunit: 'seconds'\nnote: 'it''s'");
  for (let i = 0; i < 3; i++) {
    const { fm, body } = parseFrontmatter(text);
    assert.strictEqual(fm.unit, 'seconds', `cycle ${i}: unit read as ${JSON.stringify(fm.unit)}`);
    assert.strictEqual(fm.note, "it's", `cycle ${i}: note read as ${JSON.stringify(fm.note)}`);
    fm.motion_sensitivity = 'high';
    text = serializeFrontmatter(fm) + '\n' + body;
    assert.ok(!/"'/.test(text), `cycle ${i}: double-wrapped quotes:\n${text}`);
  }
});

check("L2-09 read: single-quoted items inside a block sequence are unquoted too", () => {
  const { fm } = parseFrontmatter(note("m:\n  - 'chest'\n  - 'it''s'"));
  assert.deepStrictEqual(fm.m, ['chest', "it's"], `m read as ${JSON.stringify(fm.m)}`);
});

if (failed) {
  console.log(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('frontmatter Obsidian lists OK (block sequences read + replaced in place, single quotes unquoted)');
