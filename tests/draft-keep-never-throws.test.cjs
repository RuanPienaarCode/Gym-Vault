'use strict';
/* THE SAFETY COPY CAN NEVER BREAK THE WORKOUT (0.12.1, audit L3-01 follow-up).

   Keeping the session on the device runs on every re-render, every nav and
   every assignment of ctx.state.logDraft (controller.js keepDraft). The store
   catches its own storage failures, but snapshotting the draft ran OUTSIDE
   those try blocks — so a draft the snapshot could not read would have thrown
   out of ctx.rerender and out of the logDraft setter, taking the live screen
   with it. draft-store.js's own promise is that a workout must never fail
   because its safety copy did; this pins it at the controller, where the copy
   is taken. A draft whose `entries` cannot be read stands in for "anything the
   snapshot did not expect". */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

(async () => {
  const { ctx } = await H.boot();
  const poisoned = {
    date: '2026-01-05', plan: 'Synthetic Plan', day: 'A', startedAt: Date.now(),
    get entries() { throw new Error('snapshot could not read this draft'); },
  };
  let threw = null;
  try { ctx.state.logDraft = poisoned; } catch (e) { threw = e; }
  assert.strictEqual(threw, null,
    `assigning a draft the safety copy cannot read threw out of the logDraft setter: ${threw && threw.message}`);
  try { ctx.rerender(); } catch (e) { threw = e; }
  assert.strictEqual(threw, null,
    `a re-render with a draft the safety copy cannot read threw out of ctx.rerender: ${threw && threw.message}`);
  assert.strictEqual(ctx.state.logDraft, poisoned, 'the draft itself must still be the live one');
  console.log('draft keep never throws OK (an unreadable draft never breaks the setter or a re-render)');
})().catch(e => { console.error(e); process.exit(1); });
