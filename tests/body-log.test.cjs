'use strict';
/* Body Log.md is a file the USER may have written in.

   THE BUG THIS REPRODUCES: appendBodyRow rebuilt the whole file as
   `frontmatter + one table`. tableToObjects reads only the FIRST table, so
   everything else in the note — headings, prose, a second section, any
   column the plugin's schema doesn't know — was not in `rows` and was never
   written back. One tap of "Log measurement" deleted it.

   Worse: if the user had ANY other table above the log table, that one was
   read as the body rows and the real log was replaced with garbage.

   The contract these tests pin: the plugin owns its table's lines and
   nothing else in the file. If it can't find its own table, it refuses to
   write rather than overwriting something it doesn't understand. */
const assert = require('node:assert');
const Module = require('node:module');

class TFile {
  constructor(path) {
    this.path = path;
    this.extension = path.split('.').pop();
    this.basename = path.split('/').pop().replace(/\.md$/, '');
    this.parent = null;
  }
}
class TFolder {
  constructor(path) { this.path = path; this.children = []; }
}

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { TFile, TFolder, normalizePath: p => p, requestUrl: async () => ({}) }
  : origLoad(req, ...rest));
const { makeIo } = require('../src/data');
Module._load = origLoad;

global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };

function makeVault(bodyLogText) {
  const byPath = new Map();
  const contents = new Map();
  const gym = new TFolder('Gym');
  byPath.set('Gym', gym);
  if (bodyLogText !== null) {
    const f = new TFile('Gym/Body Log.md');
    f.parent = gym;
    gym.children.push(f);
    byPath.set(f.path, f);
    contents.set(f.path, bodyLogText);
  }
  const v = {
    getAbstractFileByPath: p => byPath.get(p) || null,
    getFileByPath: p => (byPath.get(p) instanceof TFile ? byPath.get(p) : null),
    getFolderByPath: p => (byPath.get(p) instanceof TFolder ? byPath.get(p) : null),
    cachedRead: async f => contents.get(f.path) ?? '',
    createFolder: async () => {},
    async create(p, text) {
      const f = new TFile(p); f.parent = gym; gym.children.push(f);
      byPath.set(p, f); contents.set(p, text);
    },
    async modify(f, text) { contents.set(f.path, text); },
  };
  return { v, read: () => contents.get('Gym/Body Log.md') };
}

const makeIoFor = v => makeIo({ app: { vault: v }, settings: { gymFolder: 'Gym' }, _lastWrite: 0 });

const HAND_WRITTEN = `---
cssclasses:
  - wide-table
---
# My body log

I started tracking on the 1st. Doctor said watch the BP.

| Date | Weight (kg) |
|---|---|
| 2026-08-01 | 84.2 |

## Blood test results (Aug)

Cholesterol trending down. Next check-up 2026-11-02.
`;

/* --- the regression: everything but the table must survive --- */
(async () => {
  {
    const { v, read } = makeVault(HAND_WRITTEN);
    await makeIoFor(v).appendBodyRow({ date: '2026-08-29', weight_kg: '83.1' });
    const out = read();

    assert.match(out, /# My body log/, `heading destroyed:\n${out}`);
    assert.match(out, /Doctor said watch the BP\./, `user prose destroyed:\n${out}`);
    assert.match(out, /## Blood test results \(Aug\)/, `second section destroyed:\n${out}`);
    assert.match(out, /Cholesterol trending down\./, `trailing prose destroyed:\n${out}`);
    assert.match(out, /cssclasses:\n {2}- wide-table/, `frontmatter property destroyed:\n${out}`);

    // and the row it was actually asked to add is there, with the old one kept
    assert.match(out, /\| 2026-08-01 \| 84\.2 \|/, 'existing row lost');
    assert.match(out, /\| 2026-08-29 \| 83\.1 \|/, 'new row not written');

    // the table stays where the user had it — above the second section
    assert.ok(out.indexOf('2026-08-29') < out.indexOf('## Blood test results'),
      `table moved out of position:\n${out}`);
  }

  /* --- logging twice on one date updates in place, not appends --- */
  {
    const { v, read } = makeVault(HAND_WRITTEN);
    const io = makeIoFor(v);
    await io.appendBodyRow({ date: '2026-08-29', weight_kg: '83.1' });
    await io.appendBodyRow({ date: '2026-08-29', resting_hr: '58' });
    const out = read();
    assert.strictEqual((out.match(/2026-08-29/g) || []).length, 1, `date duplicated:\n${out}`);
    assert.match(out, /83\.1/, 'earlier value in the same row was erased by the second write');
    assert.match(out, /58/, 'second value not merged');
  }

  /* --- a column the plugin's schema doesn't know is not deleted --- */
  {
    const withExtra = `| Date | Weight (kg) | Body fat % | Chest (cm) | Waist (cm) | Hips (cm) | Arm (cm) | Thigh (cm) | Resting HR | Note | Systolic (mmHg) | Diastolic (mmHg) | Cholesterol (mmol/L) | Glucose (mmol/L) | Sleep hrs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 | 84.2 |  |  |  |  |  |  |  |  |  |  |  |  | 7.5 |
`;
    const { v, read } = makeVault(withExtra);
    await makeIoFor(v).appendBodyRow({ date: '2026-08-29', weight_kg: '83.1' });
    const out = read();
    assert.match(out, /Sleep hrs/, `user-added column header deleted:\n${out}`);
    assert.match(out, /7\.5/, `user-added column data deleted:\n${out}`);
  }

  /* --- a foreign table above the log must NOT be overwritten --- */
  {
    const foreignFirst = `# Targets

| Target | Value |
|---|---|
| Weight | 80 |

## Log

| Date | Weight (kg) |
|---|---|
| 2026-08-01 | 84.2 |
`;
    const { v, read } = makeVault(foreignFirst);
    const before = read();
    let threw = null;
    try { await makeIoFor(v).appendBodyRow({ date: '2026-08-29', weight_kg: '83.1' }); }
    catch (e) { threw = e; }

    assert.ok(threw, 'a foreign first table was accepted as the body log — it should refuse');
    assert.match(threw.message, /Body Log/i, 'the refusal must name the file so the notice is useful');
    assert.strictEqual(read(), before, `refused write still modified the file:\n${read()}`);
  }

  /* --- a fresh file is still created normally --- */
  {
    const { v, read } = makeVault(null);
    await makeIoFor(v).appendBodyRow({ date: '2026-08-29', weight_kg: '83.1' });
    assert.match(read(), /\| 2026-08-29 \| 83\.1 \|/, 'new body log not created');
  }

  console.log('body log OK (prose, headings, extra columns and foreign tables all survive a measurement)');
})().catch(e => { console.error(e); process.exit(1); });
