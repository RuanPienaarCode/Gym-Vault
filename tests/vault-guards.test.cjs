'use strict';
/* Guards for the quieter vault-IO defects — the ones that produce a WRONG
   result rather than an error, which is why none of them had a test. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

class TFile {
  constructor(p) {
    this.path = p;
    this.extension = p.split('.').pop();
    this.basename = p.split('/').pop().replace(/\.md$/, '');
    this.parent = null;
  }
}
class TFolder {
  constructor(p) { this.path = p; this.children = []; }
}

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { TFile, TFolder, normalizePath: p => p, requestUrl: async () => ({}) }
  : origLoad(req, ...rest));
const { makeIo } = require('../src/data');
Module._load = origLoad;

global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };

function makeVault(files = []) {
  const byPath = new Map();
  const contents = new Map();
  const folders = new Map();
  const mkFolder = p => {
    if (folders.has(p)) return folders.get(p);
    const f = new TFolder(p);
    folders.set(p, f); byPath.set(p, f);
    const slash = p.lastIndexOf('/');
    if (slash > 0) mkFolder(p.slice(0, slash)).children.push(f);
    return f;
  };
  mkFolder('Gym');
  for (const [p, text] of files) {
    const dir = mkFolder(p.slice(0, p.lastIndexOf('/')));
    const f = new TFile(p);
    f.parent = dir; dir.children.push(f);
    byPath.set(p, f); contents.set(p, text);
  }
  const created = [];
  const v = {
    getAbstractFileByPath: p => byPath.get(p) || null,
    getFileByPath: p => (byPath.get(p) instanceof TFile ? byPath.get(p) : null),
    getFolderByPath: p => (byPath.get(p) instanceof TFolder ? byPath.get(p) : null),
    cachedRead: async f => {
      if (contents.get(f.path) === null) throw new Error('not indexed yet');
      return contents.get(f.path) ?? '';
    },
    createFolder: async p => { mkFolder(p); },
    async create(p, text) {
      created.push(p);
      const dir = mkFolder(p.slice(0, p.lastIndexOf('/')));
      const f = new TFile(p); f.parent = dir; dir.children.push(f);
      byPath.set(p, f); contents.set(p, text);
    },
    async modify(f, text) { contents.set(f.path, text); },
  };
  return { v, created, contents };
}

const ioFor = v => makeIo({ app: { vault: v }, settings: { gymFolder: 'Gym' }, _lastWrite: 0 });

(async () => {
  /* --- H2: a case-only clash must not overwrite a hand-written note ---
     macOS and iOS are case-insensitive, but getFileByPath is an exact-key
     lookup. Creating `bench press.md` beside `Bench Press.md` wrote to the
     same inode and replaced the user's note body with a bare stub. */
  {
    const { v, created } = makeVault([
      ['Gym/Exercises/Bench Press.md', '---\ntype: strength\n---\nMy own coaching notes.\n'],
    ]);
    const madeIt = await ioFor(v).createExercise({ name: 'bench press', type: 'strength' });
    assert.strictEqual(madeIt, false, 'a case-only filename clash was treated as absent');
    assert.deepStrictEqual(created, [], `it created a colliding file: ${created.join(', ')}`);
  }
  /* ...but a genuinely new name still gets created. */
  {
    const { v, created } = makeVault([['Gym/Exercises/Bench Press.md', '---\n---\n']]);
    assert.strictEqual(await ioFor(v).createExercise({ name: 'Overhead Press', type: 'strength' }), true);
    assert.deepStrictEqual(created, ['Gym/Exercises/Overhead Press.md']);
  }

  /* --- L7: safeName must not produce an unopenable or invisible file --- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'data.js'), 'utf8');
    const m = src.match(/const safeName = s => \{[\s\S]*?\n\};/);
    assert.ok(m, 'safeName not found — renamed?');
    const safeName = eval(`(${m[0].replace('const safeName = ', '').replace(/;$/, '')})`);
    assert.ok(safeName('a'.repeat(300)).length <= 200, 'a 300-char name exceeds the filesystem limit');
    assert.strictEqual(safeName('   '), '-', 'a whitespace-only name would create an invisible dotfile');
    assert.strictEqual(safeName(''), '-', 'an empty name would create an invisible dotfile');
    // '###' folds to '---', which is a perfectly visible filename — the guard
    // only has to catch results that would be EMPTY.
    assert.ok(safeName('###').length > 0 && !safeName('###').startsWith('.'));
    assert.strictEqual(safeName('Bench Press'), 'Bench Press', 'an ordinary name must be untouched');
  }

  /* --- L4: comparators must return 0 on equality ---
     Two sessions on the same day are explicitly supported by saveWorkout;
     a comparator returning 1 for equal keys makes their order unstable. */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'data.js'), 'utf8')
      + fs.readFileSync(path.join(__dirname, '..', 'src', 'stats.js'), 'utf8');
    assert.ok(!/\?\s*-1\s*:\s*1\s*\)/.test(src),
      'a comparator still returns 1 for equal keys — return 0 so the sort is stable');
  }

  /* --- L8: appendBodyRow must not mutate the caller's live object ---
     `row` is the open modal's values object; deleting keys out of it under
     the caller is a landmine once anyone reads it after the await. */
  {
    const { v } = makeVault([]);
    const values = { date: '2026-08-29', weight_kg: '83.1', chest_cm: '', note: '' };
    await ioFor(v).appendBodyRow(values);
    assert.deepStrictEqual(Object.keys(values).sort(), ['chest_cm', 'date', 'note', 'weight_kg'],
      'the caller\'s object had keys deleted out from under it');
  }

  /* --- M7: an unreadable file must be NAMED, not just counted --- */
  {
    const { v, contents } = makeVault([['Gym/Exercises/Broken.md', '---\n---\n']]);
    contents.set('Gym/Exercises/Broken.md', null);      // read throws
    const data = await ioFor(v).loadAll();
    assert.strictEqual(data.unreadable, 1, 'the failed read was not counted');
    assert.deepStrictEqual(data.unreadablePaths, ['Gym/Exercises/Broken.md'],
      '"N files could not be read" gives the user nothing to act on — record which');
  }

  /* --- L2: a duplicate exercise basename must not stay silent ---
     readNotesIn walks subfolders but identity is the basename, so the second
     Bench.md is unreachable via .find(). Identity is deliberately NOT
     restructured here; the clash is surfaced instead of hidden. */
  {
    const { v } = makeVault([
      ['Gym/Exercises/Push/Bench.md', '---\ntype: strength\n---\n'],
      ['Gym/Exercises/Pull/Bench.md', '---\ntype: strength\n---\n'],
    ]);
    const data = await ioFor(v).loadAll();
    assert.strictEqual(data.duplicateExercises.length, 1,
      'a shadowed duplicate exercise was not reported');
    assert.match(data.duplicateExercises[0], /Bench\.md$/);
  }

  console.log('vault guards OK (case clash, name limits, stable sorts, no caller mutation, failures named)');
})().catch(e => { console.error(e); process.exit(1); });
