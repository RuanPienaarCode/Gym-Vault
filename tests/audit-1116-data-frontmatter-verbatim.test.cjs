'use strict';
/* Audit 16 Nov 2026, lane DATA, finding 43 (Low) — an app save rewrote
   properties it did not change, and could change what they MEAN.

   Star, pause, make-active, exercise edit and profile edit re-emitted every
   flat key from its PARSED value. The parser throws the notation away
   (quotes, escapes, a trailing comment), so the re-emit was a different text:

     note: "line one\nline two"   lost its quotes and its escape
     code: "007"                  became  code: 007   (a number to Obsidian)
     unit: kg # heavy             became  "kg # heavy" (the comment is now text)
     path: "C:\\gym\\"            became  "C:\gym\"   (not valid YAML at all)

   The contract: a flat key whose value the app did not change is re-emitted
   from its ORIGINAL line, byte for byte; only a changed or new key is
   serialised afresh, and when it is, the text is valid YAML that reads back to
   the same string (backslashes and double quotes escaped inside quotes). */
const assert = require('node:assert');
const { parseFrontmatter, serializeFrontmatter, yamlStr } = require('../src/markdown');
const { obsidianStub, loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const fenced = inner => `---\n${inner}\n---\n`;

/* The four lines from the audit, exactly as a file holds them. */
const FOUR = [
  'note: "line one\\nline two"',
  'code: "007"',
  'unit: kg # heavy',
  'path: "C:\\\\gym\\\\"',
];

/* An independent reader of a YAML double-quoted scalar, written from the spec
   (not from markdown.js), so "valid YAML" is not judged by the code under test.
   Throws on an unescaped quote or an escape YAML does not define. */
const ESC = { '\\': '\\', '"': '"', n: '\n', t: '\t', r: '\r', '0': '\0', '/': '/', ' ': ' ' };
function yamlDecodeDoubleQuoted(src) {
  if (src.length < 2 || src[0] !== '"' || src[src.length - 1] !== '"') throw new Error(`not double-quoted: ${src}`);
  let out = '';
  for (let i = 1; i < src.length - 1; i++) {
    const c = src[i];
    if (c === '"') throw new Error(`unescaped quote at ${i} in ${src}`);
    if (c === '\\') {
      const n = src[++i];
      if (i >= src.length - 1 || !(n in ESC)) throw new Error(`invalid escape \\${n === undefined ? '<end>' : n} in ${src}`);
      out += ESC[n];
    } else out += c;
  }
  return out;
}
/* A plain (unquoted) scalar YAML reads as exactly its own text. */
function plainIsSafe(s) {
  if (s === '' || /^\s|\s$/.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) && !/^[-?:][^\s]/.test(s)) return false;
  if (/:(\s|$)/.test(s) || /\s#/.test(s)) return false;
  return true;
}
/* What a strict YAML reader makes of one `key: value` line's value. */
function strictRead(valueText) {
  return valueText.startsWith('"') ? yamlDecodeDoubleQuoted(valueText) : (assert.ok(plainIsSafe(valueText), `plain scalar is not safe YAML: ${valueText}`), valueText);
}

/* ---- the round trip ------------------------------------------------- */

check('F43 parse -> serialise with nothing changed is byte-identical for each of the four lines', () => {
  for (const line of FOUR) {
    const inner = `type: strength\n${line}\nzzz: tail`;
    const { fm } = parseFrontmatter(fenced(inner));
    const out = serializeFrontmatter(fm);
    assert.strictEqual(out, fenced(inner), `line rewritten: ${JSON.stringify(line)}\n${out}`);
  }
});

check('F43 all four together, with flow lists, quoted lists and comments around them, are byte-identical', () => {
  const inner = ['# mine', 'type: strength', ...FOUR, 'muscles: [ chest,  triceps ]', "alias: 'it''s'", 'tags:', '  - gym', 'when: 2026-08-26  '].join('\n');
  const { fm } = parseFrontmatter(fenced(inner));
  assert.strictEqual(serializeFrontmatter(fm), fenced(inner));
});

check('F43 parse -> change ONE key -> serialise leaves every other line byte-identical', () => {
  const lines = ['type: strength', ...FOUR, 'muscles: [ chest,  triceps ]', 'reps: 05'];
  for (const [key, val, want] of [
    ['type', 'cardio', 'type: cardio'],
    ['note', 'fresh', 'note: fresh'],
    ['unit', 'lb', 'unit: lb'],
    ['reps', 8, 'reps: 8'],
  ]) {
    const { fm } = parseFrontmatter(fenced(lines.join('\n')));
    fm[key] = val;
    const out = serializeFrontmatter(fm);
    const expect = lines.map(l => (l.split(':')[0] === key ? want : l));
    assert.strictEqual(out, fenced(expect.join('\n')), `changing ${key} disturbed a neighbour:\n${out}`);
  }
});

check('F43 changing the list key rewrites that list only', () => {
  const lines = ['code: "007"', 'muscles: [ chest,  triceps ]', 'unit: kg # heavy'];
  const { fm } = parseFrontmatter(fenced(lines.join('\n')));
  fm.muscles = ['chest', 'back'];
  assert.strictEqual(serializeFrontmatter(fm), fenced(['code: "007"', 'muscles: [chest, back]', 'unit: kg # heavy'].join('\n')));
});

check('F43 an in-place edit of a parsed list counts as a change (the baseline is a copy)', () => {
  const { fm } = parseFrontmatter(fenced('muscles: [ chest,  triceps ]'));
  fm.muscles.push('back');
  assert.strictEqual(serializeFrontmatter(fm), fenced('muscles: [chest, triceps, back]'));
});

check('F43 a number re-saved over its own digit string is not an edit (`reps: 05` stays `05`)', () => {
  const { fm } = parseFrontmatter(fenced('reps: 05\nsets: 3'));
  fm.sets = 3;                                  // a form hands back the number
  assert.strictEqual(serializeFrontmatter(fm), fenced('reps: 05\nsets: 3'));
});

check('F43 a key the user left as "" is theirs and stays; one the app deletes is removed', () => {
  const { fm } = parseFrontmatter(fenced('type: strength\nblank: ""\nempty: []\nnote: x'));
  assert.strictEqual(serializeFrontmatter(fm), fenced('type: strength\nblank: ""\nempty: []\nnote: x'), 'user empty-valued keys were dropped');
  delete fm.blank;
  assert.strictEqual(serializeFrontmatter(fm), fenced('type: strength\nempty: []\nnote: x'), 'a deleted key must go');
});

check('F43 a duplicated key is still written once (the earlier save\'s heal is kept)', () => {
  const { fm } = parseFrontmatter(fenced('a: 1\nb: 2\na: 3'));
  assert.strictEqual(serializeFrontmatter(fm), fenced('a: 3\nb: 2'));
});

/* ---- a changed value is valid YAML that reads back to the same string -- */

const CORPUS = [
  'C:\\gym\\', 'C:\\gym', 'path\\to', 'a\\nb', 'say "hi"', 'say "hi" now', '"quoted"', 'back\\"slash', 'ends with\\',
  'kg # heavy', 'a: b', "it's", "'single'", '- dash', '% pct', '@ at', '`tick`', '[x]', '{x}', 'a, b', '? what', 'x | y', '> y', '& a', '* a', '! a',
  'two  spaces', 'plain words', 'unit: kg\\', '"', '\\', '\\\\', '\\"', 'a\\\\"b',
];

check('F43 a fresh string value is valid YAML and reads back as the same string (strict reader AND the plugin\'s own)', () => {
  for (const s of CORPUS) {
    const out = serializeFrontmatter({ k: s });
    const valueText = out.split('\n')[1].replace(/^k: /, '');
    assert.strictEqual(strictRead(valueText), s, `strict YAML reads ${valueText} as something else than ${JSON.stringify(s)}`);
    assert.strictEqual(parseFrontmatter(out).fm.k, s, `plugin read-back of ${valueText} is not ${JSON.stringify(s)}`);
  }
});

check('F43 backslashes and double quotes are escaped inside double-quoted output', () => {
  assert.strictEqual(yamlStr('C:\\gym\\'), '"C:\\\\gym\\\\"');
  assert.strictEqual(yamlStr('say "hi": ok'), '"say \\"hi\\": ok"');
  assert.strictEqual(yamlStr('a: b\\nc'), '"a: b\\\\nc"');
});

check('F43 a list item survives the same trip, including a trailing backslash before the comma', () => {
  for (const items of [['C:\\gym\\', 'b'], ['a\\', 'say "x"', 'c: d'], ['one', 'two']]) {
    const out = serializeFrontmatter({ k: items });
    assert.deepStrictEqual(parseFrontmatter(out).fm.k, items, `list read back wrong:\n${out}`);
  }
});

check('F43 a fresh digit string with a leading zero is quoted (plain, YAML reads it as the number 7)', () => {
  assert.strictEqual(yamlStr('007'), '"007"');
  assert.strictEqual(parseFrontmatter(serializeFrontmatter({ code: '007' })).fm.code, '007');
  /* ...but figures the app writes as numbers stay numbers. */
  assert.strictEqual(yamlStr('172'), '172');
  assert.strictEqual(yamlStr('82.5'), '82.5');
  assert.strictEqual(yamlStr('0'), '0');
  assert.strictEqual(yamlStr('0.5'), '0.5');
});

check('F43 a key whose value is changed to the four awkward strings round-trips as that string', () => {
  const { fm } = parseFrontmatter(fenced('a: 1\nb: 2'));
  fm.a = 'C:\\gym\\'; fm.b = 'say "hi"';
  const out = serializeFrontmatter(fm);
  const back = parseFrontmatter(out).fm;
  assert.strictEqual(back.a, 'C:\\gym\\');
  assert.strictEqual(back.b, 'say "hi"');
});

/* ---- through the real data.js saves ---------------------------------- */

const noteWithFour = type => fenced([`type: ${type}`, ...FOUR, 'muscles: [ chest,  triceps ]'].join('\n')) + '\nBody line.\n';
const planText = fenced(['type: plan', ...FOUR, 'favourite: false'].join('\n')) + '\n## Mon (mon)\n\n- Bench | 3 x 5\n';

check('F43 starring a plan through data.js changes ONLY the favourite line', async () => {
  const v = makeVault([['Gym/Plans/P.md', planText]]);
  const io = loadSrc('data.js').makeIo(makePlugin(v));
  const data = await io.loadAll();
  await io.setFavourite(data.plans[0], true);
  const out = v._disk.get('Gym/Plans/P.md');
  assert.strictEqual(out, planText.replace('favourite: false', 'favourite: true'), `the star rewrote another property:\n${out}`);
});

check('F43 pausing and make-active leave the four lines alone', async () => {
  const para = planText.replace('type: plan', 'type: plan\nparallel: true');
  const v = makeVault([['Gym/Plans/P.md', para]]);
  const io = loadSrc('data.js').makeIo(makePlugin(v));
  const data = await io.loadAll();
  await io.setPaused(data.plans[0], true);
  const out = v._disk.get('Gym/Plans/P.md');
  for (const l of FOUR) assert.ok(out.includes('\n' + l + '\n'), `line lost or rewritten: ${l}\n${out}`);
  await io.setActivePlan(data.plans, data.plans[0]);
  const out2 = v._disk.get('Gym/Plans/P.md');
  for (const l of FOUR) assert.ok(out2.includes('\n' + l + '\n'), `line lost or rewritten by make-active: ${l}\n${out2}`);
});

check('F43 an exercise edit changes only the edited keys', async () => {
  const text = noteWithFour('strength');
  const v = makeVault([['Gym/Exercises/Bench.md', text]]);
  const io = loadSrc('data.js').makeIo(makePlugin(v));
  const data = await io.loadAll();
  const ex = data.exercises[0];
  ex.fm.type = 'cardio';
  await io.saveExercise(ex);
  assert.strictEqual(v._disk.get('Gym/Exercises/Bench.md'), text.replace('type: strength', 'type: cardio'));
});

check('F43 a profile edit changes only the edited keys', async () => {
  const text = fenced(['name: Ruan', ...FOUR, 'height_cm: 180'].join('\n')) + '\nAbout me.\n';
  const v = makeVault([['Gym/Profile.md', text]]);
  const io = loadSrc('data.js').makeIo(makePlugin(v));
  const data = await io.loadAll();
  const next = { ...data.profile.fm, height_cm: '181' };
  await io.saveProfile(next, data.profile.body);
  assert.strictEqual(v._disk.get('Gym/Profile.md'), text.replace('height_cm: 180', 'height_cm: 181'));
});

/* ---- the seed notes: the layer must not touch what the app itself wrote ---- */

check('F43 every seed plan, exercise, goal and the profile round-trips byte for byte (frontmatter as data.js writes it)', () => {
  const seed = require('../src/seed');
  /* The frontmatter each seed note is created with — the same objects data.js
     createExercise / createPlan / createGoal / saveProfile serialise. */
  const fms = [];
  for (const e of seed.SEED_EXERCISES) fms.push([`exercise ${e.name}`, { type: e.type, muscles: e.muscles, equipment: e.equipment, unit: e.unit, motion_sensitivity: e.motion_sensitivity, image: e.image, video: e.video }]);
  for (const p of [seed.SEED_PLAN, seed.SEED_RUN_PLAN, seed.SEED_REST_PLAN]) fms.push([`plan ${p.name}`, p.fm]);
  for (const g of seed.SEED_GOALS) fms.push([`goal ${g.name}`, g.fm]);
  fms.push(['profile', seed.SEED_PROFILE.fm]);
  /* 75, not 80: audit 25 Nov 2026 #25 dropped three starter goals. */
  assert.ok(fms.length > 75, `only ${fms.length} seed notes found`);
  for (const [label, fm] of fms) {
    const written = serializeFrontmatter(fm);
    const again = parseFrontmatter(written + '\nbody\n');
    assert.strictEqual(serializeFrontmatter(again.fm), written, `${label} does not round-trip:\n${written}`);
    /* ...and one key changed leaves the rest alone. */
    const k = Object.keys(again.fm)[0];
    if (k) {
      const edited = { ...again.fm };
      Object.defineProperty(edited, Symbol.for('gv.fmLayout'), { value: again.fm[Symbol.for('gv.fmLayout')], enumerable: true });
      edited[k] = 'changed value';
      const lines = written.split('\n');
      const expect = lines.map(l => (l.startsWith(k + ':') ? `${k}: changed value` : l)).join('\n');
      assert.strictEqual(serializeFrontmatter(edited), expect, `${label}: changing ${k} disturbed another line`);
    }
  }
});

run('audit-1116-data-frontmatter-verbatim');
