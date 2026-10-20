'use strict';
/* L1-10 — Export "Everything" dropped notes without a readable date, while
   History lists them and sessionCount counts them. With no date window there is
   nothing to place them against, so they are included, after the dated ones. */
const assert = require('node:assert');
const { makeRunner } = require('./gym-fake-vault');
const { buildSummary, buildCsv, buildJson } = require('../src/export');
const { check, run } = makeRunner();

const row = (ex, reps) => [{ exercise: ex, set: '1', reps }];
const data = {
  profile: { fm: {}, body: '' }, body: [], exercises: [], plans: [], goals: [],
  workouts: [
    { name: 'nodate', fm: { day: 'Mystery' }, rows: row('Mystery Lift', '3') },
    { name: 'old', fm: { date: '2026-01-05', day: 'Old' }, rows: row('Old Lift', '5') },
    { name: 'new', fm: { date: '2026-08-26', day: 'New' }, rows: row('New Lift', '8') },
  ],
};
const today = '2026-08-28';

check('L1-10 "Everything" (days: 0) keeps the undated note in the CSV, after the dated ones', () => {
  const lines = buildCsv(data, { today, days: 0 }).trim().split('\n').slice(1);
  assert.deepStrictEqual(lines.map(l => l.split(',')[2]), ['Old', 'New', 'Mystery']);
});

check('L1-10 "Everything" keeps it in the JSON, last', () => {
  const j = JSON.parse(buildJson(data, { today, days: 0 }));
  assert.deepStrictEqual(j.workouts.map(w => w.day), ['Old', 'New', 'Mystery']);
});

check('L1-10 "Everything" lists it in the summary after the dated sessions, and the count includes it', () => {
  const out = buildSummary(data, { today, days: 0 });
  assert.ok(out.includes('3 sessions'), out.slice(0, 200));
  assert.ok(out.includes('Mystery Lift'), 'undated session missing');
  assert.ok(out.indexOf('New Lift') < out.indexOf('Old Lift') && out.indexOf('Old Lift') < out.indexOf('Mystery Lift'), 'order: newest first, undated last');
  assert.ok(/### Undated — Mystery/.test(out), 'the heading must say it has no date');
});

check('L1-10 a date window still excludes undated notes (they cannot be placed)', () => {
  assert.strictEqual(buildCsv(data, { today, days: 90 }).trim().split('\n').length, 2);
  assert.ok(!buildSummary(data, { today, days: 90 }).includes('Mystery'));
});

check('L1-10 an unreadable date string is undated too, and is shown as written', () => {
  const d = { ...data, workouts: [{ name: 'x', fm: { date: '2026-8-6', day: 'Sloppy' }, rows: row('Sloppy Lift', '4') }] };
  assert.ok(buildCsv(d, { today, days: 0 }).includes('Sloppy'));
  assert.ok(/### 2026-8-6 — Sloppy/.test(buildSummary(d, { today, days: 0 })));
});

run('w1-export-undated');
