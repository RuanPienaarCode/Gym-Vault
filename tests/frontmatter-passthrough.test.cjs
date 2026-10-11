'use strict';
/* The frontmatter layer must not destroy what it cannot model.

   markdown.js's own header promises "frontmatter parsing keeps unknown keys
   so a serializer can write them back verbatim." That held for flat scalars
   only. Obsidian's Properties panel writes `tags`, `aliases` and `cssclasses`
   as BLOCK SEQUENCES, and users hand-write nested maps and block scalars —
   none of which the flat `key: value` parser could represent. Those keys
   parsed to '' and the serializer dropped them, so a single plugin save
   silently deleted the user's tags; a nested map was worse, hoisting its
   children to the top level where `active: true` could hijack the plan.

   The contract these tests pin: anything the parser cannot MODEL, it must
   PASS THROUGH byte-for-byte, in its original position. */
const assert = require('node:assert');
const { parseFrontmatter, serializeFrontmatter } = require('../src/markdown');

const roundTrip = text => {
  const { fm, body } = parseFrontmatter(text);
  return serializeFrontmatter(fm) + '\n' + body;
};

/* Block-sequence list properties (Obsidian's own native format) survive. */
{
  const text = '---\ntype: strength\ntags:\n  - gym\n  - push\naliases:\n  - Bench\n---\nMy own notes about form.\n';
  const out = roundTrip(text);
  assert.match(out, /tags:\n {2}- gym\n {2}- push/, `tags block sequence lost:\n${out}`);
  assert.match(out, /aliases:\n {2}- Bench/, `aliases block sequence lost:\n${out}`);
  assert.match(out, /type: strength/, 'modelled key dropped');
  assert.match(out, /My own notes about form\./, 'body lost');
}

/* A nested map keeps its parent and its indentation, and does NOT leak its
   children to the top level. `archive.active` must never become `active`. */
{
  const text = '---\ntype: strength\narchive:\n  active: true\n  parallel: true\n---\nbody\n';
  const { fm } = parseFrontmatter(text);
  assert.strictEqual(fm.active, undefined, 'nested `active` was hoisted to the top level');
  assert.strictEqual(fm.parallel, undefined, 'nested `parallel` was hoisted to the top level');

  const out = roundTrip(text);
  assert.match(out, /archive:\n {2}active: true\n {2}parallel: true/, `nested map mangled:\n${out}`);
  assert.ok(!/^active: true$/m.test(out), `nested key surfaced at top level:\n${out}`);
}

/* Block scalars (`>` and `|`) keep their continuation lines. */
{
  for (const marker of ['>', '|']) {
    const text = `---\ncue: ${marker}\n  keep the chest up\n  and brace\n---\n`;
    const out = roundTrip(text);
    assert.match(out, /keep the chest up/, `block scalar (${marker}) content lost:\n${out}`);
    assert.match(out, /and brace/, `block scalar (${marker}) continuation lost:\n${out}`);
  }
}

/* Repeated saves must be a fixpoint for unmodelled structure too — one lost
   line per cycle is how a slow corruption hides from a single-pass test. */
{
  let text = '---\ntype: strength\ntags:\n  - gym\ncoach:\n  name: Ruan\ncue: >\n  brace hard\n---\nBody.\n';
  const first = roundTrip(text);
  for (let i = 0; i < 3; i++) {
    const next = roundTrip(text);
    assert.strictEqual(next, first, `cycle ${i}: frontmatter drifted`);
    text = next;
  }
}

/* A plugin-owned key still updates in place, without disturbing neighbours. */
{
  const text = '---\ntags:\n  - gym\nactive: false\naliases:\n  - Bench\n---\nBody.\n';
  const { fm, body } = parseFrontmatter(text);
  fm.active = true;
  const out = serializeFrontmatter(fm) + '\n' + body;
  assert.match(out, /active: true/, 'plugin key did not update');
  assert.ok(!/active: false/.test(out), 'stale value left behind');
  assert.match(out, /tags:\n {2}- gym/, 'neighbouring block sequence disturbed');
  assert.match(out, /aliases:\n {2}- Bench/, 'trailing block sequence disturbed');
}

/* An unrecognised line (comment, blank, stray text) is not silently eaten. */
{
  const text = '---\n# a comment the user wrote\ntype: strength\n---\nBody.\n';
  const out = roundTrip(text);
  assert.match(out, /# a comment the user wrote/, `comment line eaten:\n${out}`);
}

/* Serializing a plain object built by the plugin is unchanged behaviour:
   optional keys with empty values simply don't appear. This is the ONE case
   where dropping an empty key is correct — the key is plugin-owned and was
   never in the user's file. */
{
  const out = serializeFrontmatter({ a: '', b: null, c: undefined, active: true, n: 0 });
  assert.ok(out.includes('active: true'));
  assert.ok(out.includes('n: 0'));
  assert.ok(!out.includes('a:'), 'plugin-owned empty key should be omitted');
}

/* ...but an empty-valued key that came FROM THE FILE is the user's, and
   deleting it is data loss. This is the distinction the old test missed. */
{
  const text = '---\ntype: strength\nmynote:\n---\nBody.\n';
  const out = roundTrip(text);
  assert.match(out, /mynote:/, `user's empty-valued key was deleted:\n${out}`);
}

/* `motion_counting` (motion counting remembered per exercise) is a plugin key
   that lives in a USER's note, next to keys the plugin cannot model. Turning
   it ON appends exactly one line; OFF removes exactly one line; a note that
   already carries it round-trips untouched; nothing else moves. */
{
  const { setMotionPref, motionPref } = require('../src/motion-count');
  const text = '---\ntype: strength\ntags:\n  - gym\n  - push\nmotion_sensitivity: high\ncue: >\n  brace hard\n# keep this\nunit: reps\n---\n\nMy own notes about form.\n';
  /* (a blank line after the frontmatter is how the app itself writes a note;
     the writer adds one to a note that lacks it on its FIRST save of any key,
     which is older than this key and not what is under test.) */
  const ser = fm => serializeFrontmatter(fm);

  const on = parseFrontmatter(text);
  assert.strictEqual(motionPref(on.fm), false, 'a note without the key is OFF');
  setMotionPref(on.fm, true);
  const outOn = ser(on.fm) + '\n' + on.body;
  assert.strictEqual(outOn, text.replace('unit: reps\n---', 'unit: reps\nmotion_counting: true\n---'),
    `ON must add exactly one line and change nothing else:\n${outOn}`);

  const again = parseFrontmatter(outOn);
  assert.strictEqual(motionPref(again.fm), true, 'and it reads back ON');
  assert.strictEqual(ser(again.fm) + '\n' + again.body, outOn, 'ON is a fixpoint');

  setMotionPref(again.fm, false);
  assert.strictEqual(ser(again.fm) + '\n' + again.body, text, 'OFF removes exactly that line: the note is byte-identical to the original');
}

/* ...and in its original position when the user put it in the middle. */
{
  const { setMotionPref } = require('../src/motion-count');
  const text = '---\ntype: strength\nmotion_counting: true\ntags:\n  - gym\nunit: reps\n---\n\nBody.\n';
  const rt = roundTrip(text);
  assert.strictEqual(rt, text, 'a note that already has the key round-trips byte for byte');
  const { fm, body } = parseFrontmatter(text);
  setMotionPref(fm, false);
  assert.strictEqual(serializeFrontmatter(fm) + '\n' + body, '---\ntype: strength\ntags:\n  - gym\nunit: reps\n---\n\nBody.\n');
}

console.log('frontmatter pass-through OK (block lists, nested maps, block scalars, comments survive a save)');
