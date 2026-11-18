'use strict';
/* A LATER MARK SURVIVES A KILL (issue #28, review round 1). The draft is
   persisted through draft-store's field whitelist; `entry.later` has to be on
   it, or a reload forgets which exercise was waiting for its machine. */
const assert = require('node:assert');
const ds = require('../src/draft-store');
const flow = require('../src/session-flow');

const now = Date.parse('2026-11-18T10:00:00');
const draft = {
  date: '2026-11-18', plan: 'P', day: 'B', startedAt: now - 600000,
  entries: [
    { exercise: 'Leg Press', target: '10', weighted: true, sets: [{ reps: '10', weight_kg: '120', done: true, touched: true }, { reps: '', weight_kg: '', done: false, touched: false }] },
    { exercise: 'Row', target: '10', sets: [{ reps: '10', done: true, touched: true }] },
  ],
};
flow.markLater(draft, { entryIndex: 0, setIndex: 1 });
const back = ds.restoreDraft(JSON.parse(JSON.stringify(ds.snapshotDraft(draft, now))), now + 1000);
assert.ok(back, 'fixture: the draft restores');
assert.strictEqual(back.entries[0].later, true, 'the mark comes back');
assert.ok(!('later' in back.entries[1]), 'an unmarked entry gains nothing');
/* and it does its job after the restore: Row done, so the walk returns to Leg Press set 2 */
assert.deepStrictEqual(flow.advance(back, { entryIndex: 1, setIndex: 0 }), { entryIndex: 0, setIndex: 1 });
console.log('later-survives-relaunch OK');
