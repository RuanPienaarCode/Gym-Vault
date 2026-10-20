'use strict';
/* L1-09 — exerciseBests().lastDate compared and returned the RAW frontmatter
   string, so a sloppy `2026-8-6` beat `2026-09-01` and a `T09:00` date printed
   as a different day than every other surface (workoutDate is the one rule).
   L1-11 — two sessions on the same day were ordered by file name alone, so
   "last session" was whichever name sorted last, not the one done last. */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const { exerciseBests, workoutDate } = require('../src/stats');
const { makeIo } = loadSrc('data.js');
const { check, run } = makeRunner();

const w = (date, rows = [{ exercise: 'Press', reps: '5', weight_kg: '20' }]) => ({ fm: { date }, rows });

check('L1-09 lastDate is the canonical day, compared as a day', () => {
  const b = exerciseBests([w('2026-09-01'), w('2026-8-6')], 'Press');
  assert.strictEqual(b.lastDate, '2026-09-01', `lastDate ${b.lastDate}`);
});

check('L1-09 a date with a time is reported as the same day workoutDate gives', () => {
  const b = exerciseBests([w('2026-08-26T09:00')], 'Press');
  assert.strictEqual(b.lastDate, workoutDate(w('2026-08-26T09:00')));
  assert.strictEqual(b.lastDate, '2026-08-26');
});

check('L1-09 a workout with no readable date contributes no lastDate', () => {
  assert.strictEqual(exerciseBests([w('not a date')], 'Press').lastDate, null);
  assert.strictEqual(exerciseBests([w('2026-01-02'), w('garbage')], 'Press').lastDate, '2026-01-02');
});

const fm = (date, extra = '') => `---\ndate: ${date}\n${extra}---\n| Exercise | Set | Reps | Weight (kg) | Time (s) | Note | Distance (km) |\n|---|---|---|---|---|---|---|\n| Press | 1 | 5 | 20 |  |  |  |\n`;
const order = async files => (await makeIo(makePlugin(makeVault(files))).loadAll()).workouts.map(x => x.name);

check('L1-11 same-day sessions with a time in frontmatter are ordered by it (not by file name)', async () => {
  const names = await order([
    ['Gym/Workouts/2026-10-20 Aaa.md', fm('2026-10-20', 'time: "18:30"\n')],
    ['Gym/Workouts/2026-10-20 Zzz.md', fm('2026-10-20', 'time: "07:15"\n')],
  ]);
  assert.deepStrictEqual(names, ['2026-10-20 Zzz', '2026-10-20 Aaa']);
});

check('L1-11 a time inside the date field counts too', async () => {
  const names = await order([
    ['Gym/Workouts/2026-10-20 Aaa.md', fm('2026-10-20T18:30')],
    ['Gym/Workouts/2026-10-20 Zzz.md', fm('2026-10-20T07:15')],
  ]);
  assert.deepStrictEqual(names, ['2026-10-20 Zzz', '2026-10-20 Aaa']);
});

check('L1-11 with no time, the numbered second session stays after the first, and 10 sorts after 9', async () => {
  const names = await order([
    ['Gym/Workouts/2026-10-20 Push 10.md', fm('2026-10-20')],
    ['Gym/Workouts/2026-10-20 Push 2.md', fm('2026-10-20')],
    ['Gym/Workouts/2026-10-20 Push.md', fm('2026-10-20')],
    ['Gym/Workouts/2026-10-20 Push 9.md', fm('2026-10-20')],
  ]);
  assert.deepStrictEqual(names, ['2026-10-20 Push', '2026-10-20 Push 2', '2026-10-20 Push 9', '2026-10-20 Push 10']);
});

check('L1-11 the date still decides first, and the order is the same however the files arrive', async () => {
  const a = [['Gym/Workouts/b.md', fm('2026-10-21', 'time: "06:00"\n')], ['Gym/Workouts/a.md', fm('2026-10-20', 'time: "22:00"\n')], ['Gym/Workouts/c.md', fm('2026-10-20', 'time: "08:00"\n')]];
  const n1 = await order(a), n2 = await order(a.slice().reverse());
  assert.deepStrictEqual(n1, ['c', 'a', 'b']);
  assert.deepStrictEqual(n2, n1);
});

run('w1-last-date-order');
