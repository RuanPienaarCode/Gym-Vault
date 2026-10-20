'use strict';
/* R2-12 follow-up (integration): a set the user SKIPPED in guided mode carries
   `skipped: true` so re-entering resumes past it (tests/w2-skip-memory). The
   device draft is a whitelist (draft-store plainSet), and it dropped the mark,
   so after iOS closed Obsidian a resumed session landed back on the skipped set.
   The mark is plain data and rides the snapshot; an unset or junk value stays off. */
const assert = require('node:assert');
const { snapshotDraft, restoreDraft } = require('../src/draft-store');

const draft = {
  date: '2026-10-20', plan: 'P', day: 'D', startedAt: Date.now() - 60000,
  entries: [{ exercise: 'Push-ups', target: '10', sets: [
    { reps: '10', weight_kg: '', seconds: '', done: true },
    { reps: '', weight_kg: '', seconds: '', done: false, skipped: true },
    { reps: '', weight_kg: '', seconds: '', done: false, skipped: 'yes' },
  ] }],
};
const back = restoreDraft(JSON.parse(JSON.stringify(snapshotDraft(draft))));
assert.ok(back && back.entries && back.entries[0], 'the draft restores');
const sets = back.entries[0].sets;
assert.strictEqual(sets[1].skipped, true, 'a skipped set is still skipped after the app was closed and reopened');
assert.ok(sets[2].skipped !== true, 'only a real boolean true is kept');
assert.ok(sets[0].skipped !== true, 'an unskipped set stays unskipped');
console.log('skip survives kill OK');
