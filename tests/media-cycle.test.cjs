'use strict';
const assert = require('node:assert');
const { nextFrameIndex } = require('../src/media-cycle');

/* Two frames, nothing failed: cycles back and forth. */
{
  assert.strictEqual(nextFrameIndex(2, new Set(), 0), 1);
  assert.strictEqual(nextFrameIndex(2, new Set(), 1), 0, 'wraps back to the start');
}

/* Three-plus frames cycle in order, wrapping at the end. */
{
  assert.strictEqual(nextFrameIndex(3, new Set(), 0), 1);
  assert.strictEqual(nextFrameIndex(3, new Set(), 1), 2);
  assert.strictEqual(nextFrameIndex(3, new Set(), 2), 0, 'wraps from the last frame to the first');
}

/* A failed (offline/dead-link) frame is skipped, never shown. */
{
  assert.strictEqual(nextFrameIndex(3, new Set([1]), 0), 2, 'skips the failed middle frame');
  assert.strictEqual(nextFrameIndex(3, new Set([0]), 2), 1, 'skips the failed frame even wrapping past it');
}

/* Every frame failed: nothing left to show. */
{
  assert.strictEqual(nextFrameIndex(3, new Set([0, 1, 2]), 0), null);
}

/* No frames at all. */
{
  assert.strictEqual(nextFrameIndex(0, new Set(), 0), null);
}

/* NEGATIVE CONTROL — prove the test actually exercises the skip rule: a
   version that ignores `failed` entirely would wrongly return the failed
   index, which the assertion above must catch. */
{
  const naiveNext = (total, _failed, current) => (current + 1) % total; // no skip logic
  assert.notStrictEqual(naiveNext(3, new Set([1]), 0), nextFrameIndex(3, new Set([1]), 0),
    'sanity: the naive (non-skipping) implementation must disagree with nextFrameIndex here');
}

console.log('media-cycle OK (frame order + skip-on-error)');
