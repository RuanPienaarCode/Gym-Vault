'use strict';
const assert = require('node:assert');
const flow = require('../src/session-flow');

/* Fixture: 2 exercises, sets each (2 + 2), none handled yet. */
function freshDraft() {
  return {
    entries: [
      { exercise: 'Pull-ups', sets: [{ reps: '', done: false, touched: false }, { reps: '', done: false, touched: false }] },
      { exercise: 'Push-ups', sets: [{ reps: '', done: false, touched: false }, { reps: '', done: false, touched: false }] },
    ],
  };
}

/* initialPosition + advance: a fresh draft starts at set 0 of entry 0, and
   advance rolls set->set, then exercise->exercise. */
{
  const draft = freshDraft();
  const start = flow.initialPosition(draft);
  assert.deepStrictEqual(start, { entryIndex: 0, setIndex: 0 });

  const p1 = flow.advance(draft, start);
  assert.deepStrictEqual(p1, { entryIndex: 0, setIndex: 1 }, 'advance moves to the next set in the same exercise');

  const p2 = flow.advance(draft, p1);
  assert.deepStrictEqual(p2, { entryIndex: 1, setIndex: 0 }, 'advance rolls into the next exercise once the current one is exhausted');

  const p3 = flow.advance(draft, p2);
  assert.deepStrictEqual(p3, { entryIndex: 1, setIndex: 1 });

  assert.strictEqual(flow.isDone(draft, p3), false, 'the last real set is not yet done');
  const p4 = flow.advance(draft, p3);
  assert.strictEqual(flow.isDone(draft, p4), true, 'advancing past the last set reaches isDone');
  assert.strictEqual(flow.currentSet(draft, p4), null);
}

/* advance/skip never mutate the draft or the position object passed in. */
{
  const draft = freshDraft();
  const start = flow.initialPosition(draft);
  const frozen = { ...start };
  flow.advance(draft, start);
  assert.deepStrictEqual(start, frozen, 'advance must not mutate the position it was given');
  assert.strictEqual(draft.entries[0].sets[0].done, false, 'advance must not mark anything done');
}

/* skipSet: moves on WITHOUT marking the skipped set handled (it stays a
   prefill-only set, same as leaving it alone on the overview). */
{
  const draft = freshDraft();
  const start = flow.initialPosition(draft);
  const after = flow.skipSet(draft, start);
  assert.deepStrictEqual(after, { entryIndex: 0, setIndex: 1 });
  assert.strictEqual(draft.entries[0].sets[0].done, false);
  assert.strictEqual(draft.entries[0].sets[0].touched, false);
}

/* skipExercise: jumps straight to the first set of the NEXT entry, wherever
   in the current exercise it was called from. */
{
  const draft = freshDraft();
  const mid = { entryIndex: 0, setIndex: 0 };
  const after = flow.skipExercise(draft, mid);
  assert.deepStrictEqual(after, { entryIndex: 1, setIndex: 0 });
}

/* skipExercise on the LAST exercise reaches isDone. */
{
  const draft = freshDraft();
  const after = flow.skipExercise(draft, { entryIndex: 1, setIndex: 0 });
  assert.strictEqual(flow.isDone(draft, after), true);
}

/* Mid-draft resume: sets already ticked (done) or typed into (touched) on
   the overview are skipped when guided mode starts, whether or not they
   actually hold a savable figure — see session-flow.js's isHandled comment
   for why this is deliberately looser than stats.setCounts. */
{
  const draft = freshDraft();
  draft.entries[0].sets[0].done = true; // ticked on the overview
  draft.entries[0].sets[1].touched = true; // typed into, even with no figure — still "dealt with"
  const start = flow.initialPosition(draft);
  assert.deepStrictEqual(start, { entryIndex: 1, setIndex: 0 }, 'resume skips past every already-handled set, straight into the next exercise');
}

/* Mid-draft resume when EVERY set is already handled: isDone immediately. */
{
  const draft = freshDraft();
  for (const entry of draft.entries) for (const set of entry.sets) set.done = true;
  const start = flow.initialPosition(draft);
  assert.strictEqual(flow.isDone(draft, start), true);
}

/* advance also skips over anything the user ticked ahead on the overview
   mid-session (not just at resume time). */
{
  const draft = freshDraft();
  draft.entries[1].sets[0].done = true; // ticked on the overview while guided mode was elsewhere
  const after = flow.advance(draft, { entryIndex: 0, setIndex: 1 });
  assert.deepStrictEqual(after, { entryIndex: 1, setIndex: 1 }, 'advance rolls past an already-handled set instead of landing on it');
}

/* progress(): counts handled vs total sets across the whole draft. */
{
  const draft = freshDraft();
  assert.deepStrictEqual(flow.progress(draft), { done: 0, total: 4 });
  draft.entries[0].sets[0].done = true;
  draft.entries[1].sets[1].touched = true;
  assert.deepStrictEqual(flow.progress(draft), { done: 2, total: 4 });
}

/* isDone on an empty draft (defensive — should never happen in practice, a
   plan day always yields at least one entry with at least one set). */
{
  assert.strictEqual(flow.isDone({ entries: [] }, { entryIndex: 0, setIndex: 0 }), true);
  assert.strictEqual(flow.isDone(null, { entryIndex: 0, setIndex: 0 }), true);
}

/* LATER (issue #28): the machine is taken, so the exercise goes to the back
   of the queue instead of being skipped. Nothing is marked; the walk simply
   wraps around, so the exercise comes back once everything after it is dealt
   with. A ticked or skipped set never comes back. */
const three = () => ({
  entries: ['Leg Press', 'Row', 'Chest Press'].map(exercise => ({
    exercise, sets: [{ reps: '', done: false, touched: false }, { reps: '', done: false, touched: false }],
  })),
});
{
  const draft = three();
  const pos = flow.later(draft, { entryIndex: 0, setIndex: 0 });
  flow.markLater(draft, { entryIndex: 0, setIndex: 0 });
  assert.deepStrictEqual(pos, { entryIndex: 1, setIndex: 0 }, 'Later goes to the next exercise');
  assert.strictEqual(draft.entries[0].later, true, 'the exercise is marked');
  assert.strictEqual(draft.entries[0].sets.some(s => s.skipped || s.touched || s.done), false, 'its sets are not');
  /* Row and Chest Press done: the walk wraps back to Leg Press. */
  for (const e of [1, 2]) for (const s of draft.entries[e].sets) s.done = true;
  assert.deepStrictEqual(flow.advance(draft, { entryIndex: 2, setIndex: 1 }), { entryIndex: 0, setIndex: 0 }, 'the deferred exercise comes back at the end');
  assert.strictEqual(flow.isDone(draft, flow.advance(draft, { entryIndex: 2, setIndex: 1 })), false, 'not done while it waits');
  for (const s of draft.entries[0].sets) s.done = true;
  assert.strictEqual(flow.isDone(draft, flow.advance(draft, { entryIndex: 0, setIndex: 1 })), true, 'done once it is done too');
}
{ /* Later halfway through an exercise resumes on the set it left */
  const draft = three();
  draft.entries[0].sets[0].done = true;
  const pos = flow.later(draft, { entryIndex: 0, setIndex: 1 });
  flow.markLater(draft, { entryIndex: 0, setIndex: 1 });
  assert.deepStrictEqual(pos, { entryIndex: 1, setIndex: 0 });
  for (const e of [1, 2]) for (const s of draft.entries[e].sets) s.done = true;
  assert.deepStrictEqual(flow.advance(draft, { entryIndex: 2, setIndex: 1 }), { entryIndex: 0, setIndex: 1 }, 'back to the set it left, not set 1 again');
}
{ /* the last exercise left has nowhere to go: null, and the button hides */
  const draft = three();
  for (const e of [0, 1]) for (const s of draft.entries[e].sets) s.done = true;
  assert.strictEqual(flow.later(draft, { entryIndex: 2, setIndex: 0 }), null);
  /* Later from the last exercise wraps to an earlier one still waiting. */
  const d2 = three();
  for (const s of d2.entries[1].sets) s.done = true;
  assert.deepStrictEqual(flow.later(d2, { entryIndex: 2, setIndex: 0 }), { entryIndex: 0, setIndex: 0 }, 'wraps to the front');
  assert.strictEqual(flow.later(d2, { entryIndex: 9, setIndex: 0 }), null, 'past the end: nothing to defer');
}
{ /* skipped and ticked sets stay gone after a wrap */
  const draft = three();
  flow.markExerciseSkipped(draft, { entryIndex: 0, setIndex: 0 });
  flow.markLater(draft, { entryIndex: 0, setIndex: 0 });
  flow.markLater(draft, { entryIndex: 1, setIndex: 0 });
  draft.entries[1].sets[0].done = true;
  assert.deepStrictEqual(flow.advance(draft, { entryIndex: 2, setIndex: 0 }), { entryIndex: 2, setIndex: 1 });
  assert.deepStrictEqual(flow.advance(draft, { entryIndex: 2, setIndex: 1 }), { entryIndex: 1, setIndex: 1 }, 'wraps only to the unhandled set');
  draft.entries[1].sets[1].done = true;
  draft.entries[2].sets.forEach(s => { s.done = true; });
  assert.strictEqual(flow.isDone(draft, flow.advance(draft, { entryIndex: 2, setIndex: 1 })), true, 'skipped Leg Press never comes back');
}

{ /* the "up next" peek asks before the set is ticked: the last set left is
     never its own next, so the slab says "Then you're done" */
  const draft = three();
  flow.markLater(draft, { entryIndex: 0, setIndex: 0 });
  for (const e of [1, 2]) for (const s of draft.entries[e].sets) s.done = true;
  draft.entries[0].sets[0].done = true;
  assert.strictEqual(flow.isDone(draft, flow.advance(draft, { entryIndex: 0, setIndex: 1 })), true, 'not handed back to itself');
  /* an UNMARKED set behind the walk is not revisited: the old meaning holds */
  const d2 = three();
  for (const s of d2.entries[2].sets) s.done = true;
  assert.strictEqual(flow.isDone(d2, flow.advance(d2, { entryIndex: 2, setIndex: 1 })), true);
}

console.log('session-flow OK');
