'use strict';
/* R2-04, the last path (0.15.1 acceptance): a PB set in guided mode, then iOS
   closes Obsidian. On relaunch the device draft brings the records back on
   `draft.live.records`. Resuming THROUGH GUIDED restores ctx.state.session and
   pays the PB; resuming from Today's card (which opens the Log page) and tapping
   Bank it found neither a live session nor a carry, so sessionInputs returned no
   records and the PB went unpaid and uncelebrated. The restored draft's own
   records are the fallback. */
const assert = require('node:assert');
const flow = require('../src/rewards-flow');

const rec = { key: 'Dips|reps', exercise: 'Dips', kind: 'reps', val: 9, prev: 8 };
const history = [{ fm: { date: '2026-10-18' }, rows: [] }];
const draft = { date: '2026-10-20', entries: [], live: { records: [rec] } };

const relaunched = { state: {}, data: { workouts: history } };
const got = flow.sessionInputs(relaunched, draft);
assert.deepStrictEqual(got.records, [rec], `a relaunched draft resumed from the Log page keeps its PB (got ${JSON.stringify(got.records)})`);
assert.strictEqual(got.workouts, history, 'the loaded history is "before"');

/* a live guided session still wins over the draft's copy */
const live = { state: { session: { records: [], workoutsAtStart: history } }, data: { workouts: history } };
assert.deepStrictEqual(flow.sessionInputs(live, draft).records, [], 'a live session is the source when there is one');

/* a manual session (no live block) still has no records */
assert.deepStrictEqual(flow.sessionInputs(relaunched, { date: '2026-10-20', entries: [] }).records, [], 'a manual session has none');
assert.deepStrictEqual(flow.sessionInputs(relaunched, { date: '2026-10-20', entries: [], live: { records: 'junk' } }).records, [], 'junk is ignored');

console.log('PB after relaunch via the Log page OK');
