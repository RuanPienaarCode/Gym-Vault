'use strict';
/* Audit 25 Nov 2026, finding 5 (integration): a count put aside with Later is
   parked on its set (page-session.js). The stored copy of a draft keeps only
   listed fields, so without this a kill between Later and coming back lost the
   reps already counted. */
const assert = require('node:assert');
const { snapshotDraft, restoreDraft } = require('../src/draft-store');

const draft = (parked) => ({
  date: '2026-11-25', plan: 'P', day: 'D', startedAt: Date.now(),
  entries: [{ exercise: 'Dips', target: '3 x 12', sets: [{ reps: '', parked }, { reps: '' }] }],
});
const roundTrip = d => {
  const snap = snapshotDraft(d, Date.now());
  if (!snap) return [{}, {}];
  const back = restoreDraft(JSON.parse(JSON.stringify(snap)), Date.now());
  return back ? back.entries[0].sets : [{}, {}];
};

let sets = roundTrip(draft({ reps: 12 }));
assert.deepStrictEqual(sets[0].parked, { reps: 12 }, 'a parked rep count survives the stored copy');
assert.strictEqual(sets[1].parked, undefined, 'a set that never had one stays without');

sets = roundTrip(draft({ seconds: 41, away: true, targetHit: true }));
assert.deepStrictEqual(sets[0].parked, { seconds: 41, away: true, targetHit: true }, 'a parked hold keeps its seconds and flags');

for (const junk of [{ reps: 0 }, { reps: 'x' }, { seconds: -3 }, 'twelve', [12], null, { away: true }]) {
  sets = roundTrip(draft(junk));
  assert.strictEqual(sets[0].parked, undefined, `junk is dropped, not kept: ${JSON.stringify(junk)}`);
}
console.log('parked count survives the draft store OK');
