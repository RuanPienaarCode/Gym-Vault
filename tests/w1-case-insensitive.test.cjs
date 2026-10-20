'use strict';
/* L2-10 / L2-11 / L2-17 — macOS and iOS volumes are case-INsensitive, and
   Obsidian's Vault.create refuses a path that differs from an existing one
   only in case ("File already exists."). getFileByPath is an exact-key lookup
   and misses the clash, so every "pick a free name" loop and every "already
   there?" check that used it either threw at the user or reported the wrong
   thing. The fake vault copies Vault.create's rule. */
const assert = require('node:assert');
const { obsidianStub, notices, loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

let handler = async () => ({ text: '---\ntype: strength\n---\n', arrayBuffer: new ArrayBuffer(4) });
const urls = [];
obsidianStub.requestUrl = async req => { urls.push(req.url); return handler(req); };
const { makeIo } = loadSrc('data.js');
const { todayISO } = require('../src/dates');
const { check, run } = makeRunner();
const mk = files => { const v = makeVault(files); return { v, io: makeIo(makePlugin(v, { planRepo: 'https://raw.example/x' })) }; };

check('L2-10 a workout whose file name differs only in case gets a free name instead of throwing', async () => {
  const { v, io } = mk([['Gym/Workouts/2026-10-20 push.md', '---\ndate: 2026-10-20\n---\n']]);
  const path = await io.saveWorkout({ date: '2026-10-20', day: 'Push', plan: 'P', duration_min: 30, rows: [] });
  assert.strictEqual(path, 'Gym/Workouts/2026-10-20 Push 2.md');
  assert.ok(v.getFileByPath(path));
});

check('L2-10 a same-day export whose name differs only in case gets a free name', async () => {
  const day = todayISO();
  const { io } = mk([[`Gym/Exports/${day} GYM summary.md`, 'old']]);
  const path = await io.saveExport('new', 'summary', 'md');
  assert.strictEqual(path, `Gym/Exports/${day} gym summary 2.md`);
});

check('L2-10 a progress photo whose path differs only in case gets a free name', async () => {
  const { photoPath } = require('../src/progress-photos');
  const clash = photoPath('Gym', 'standing', '2026-10-20', 'jpg').replace(/\.jpg$/, '.JPG');
  const { io } = mk([[clash, 'x']]);
  const path = await io.savePhoto('standing', '2026-10-20', new ArrayBuffer(2), 'jpg');
  assert.ok(/ 2\.jpg$/.test(path), path);
});

check('L2-11 installing a plan that exists under a different case is "already there", not an error', async () => {
  urls.length = 0;
  const { io } = mk([['Gym/Plans/9 foundations.md', '---\n---\n']]);
  const out = await io.installPlan({ name: '9 Foundations', file: 'plans/9.md', exercises: [] });
  assert.strictEqual(out.planSkipped, true);
  assert.strictEqual(urls.length, 0);
});

check('L2-11 an exercise that exists under a different case is skipped, not re-created', async () => {
  urls.length = 0;
  const { io } = mk([['Gym/Exercises/bench press.md', '---\n---\n']]);
  const out = await io.installPlan({ name: 'Solo', file: 'plans/s.md', exercises: ['Bench Press'] });
  assert.strictEqual(out.exercisesSkipped, 1);
  assert.strictEqual(out.exercisesAdded, 0);
  assert.deepStrictEqual(out.failed, []);
});

check('L2-17 two exercise notes whose names differ only in case are reported as duplicates', async () => {
  const { io } = mk([
    ['Gym/Exercises/Push/Bench.md', '---\n---\n'],
    ['Gym/Exercises/Pull/bench.md', '---\n---\n'],
    ['Gym/Exercises/Squat.md', '---\n---\n'],
  ]);
  const d = await io.loadAll();
  assert.strictEqual(d.duplicateExercises.length, 1, JSON.stringify(d.duplicateExercises));
});

check('L2-17 an exact-case duplicate is still reported (unchanged)', async () => {
  const { io } = mk([['Gym/Exercises/Push/Bench.md', '---\n---\n'], ['Gym/Exercises/Pull/Bench.md', '---\n---\n']]);
  assert.strictEqual((await io.loadAll()).duplicateExercises.length, 1);
});

check('L2-10 downloadMedia reuses an image already stored under a folder that differs only in case', async () => {
  const { v, io } = mk([['Gym/Exercises/Bench.md', '---\nimage: https://img.example/a.jpg\n---\nbody\n']]);
  const first = await io.downloadMedia();
  assert.strictEqual(first.saved, 1);
  /* The note is renamed in Obsidian to a different case: same files on disk, different path string. */
  const note = v.getFileByPath('Gym/Exercises/Bench.md');
  const text = '---\nimage: https://img.example/a.jpg\n---\nbody\n';
  v.externalTrash('Gym/Exercises/Bench.md');
  v.externalWrite('Gym/Exercises/bench.md', text);
  const second = await io.downloadMedia();
  assert.strictEqual(second.failed, 0, JSON.stringify(second));
  assert.strictEqual(second.saved, 0);
});

run('w1-case-insensitive');
