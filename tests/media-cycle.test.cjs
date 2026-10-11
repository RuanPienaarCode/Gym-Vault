'use strict';
const assert = require('node:assert');
const { nextFrameIndex, prevFrameIndex, firstFrameIndex, framePosition, frameLabel, swipeDirection, autoPlayMedia, MEDIA_CYCLE_MS } = require('../src/media-cycle');

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

/* ===== THE FULL-SCREEN VIEWER'S STEPPING (src/media-viewer.js) =====
   The same order rules, run backwards and from a chosen frame, plus the two
   figures the viewer prints ("2 / 3", "view 3") and the swipe rule. Kept here,
   pure, so none of it needs a browser. */

/* The session thumbnail and the viewer share one dwell time. */
assert.strictEqual(MEDIA_CYCLE_MS, 1100, 'one cycle time for the thumbnail and the viewer');

/* prev: back one, wrapping from the first to the last, skipping failed frames. */
{
  assert.strictEqual(prevFrameIndex(3, new Set(), 2), 1);
  assert.strictEqual(prevFrameIndex(3, new Set(), 0), 2, 'wraps from the first frame to the last');
  assert.strictEqual(prevFrameIndex(2, new Set(), 0), 1);
  assert.strictEqual(prevFrameIndex(3, new Set([1]), 2), 0, 'skips the failed middle frame going back');
  assert.strictEqual(prevFrameIndex(3, new Set([2]), 0), 1, 'skips the failed last frame when wrapping');
  assert.strictEqual(prevFrameIndex(3, new Set([0, 1, 2]), 1), null, 'every frame failed');
  assert.strictEqual(prevFrameIndex(0, new Set(), 0), null);
  /* next then prev is the identity whenever nothing is failed or the failed set is the same */
  for (const failed of [new Set(), new Set([1]), new Set([0, 3])]) {
    for (const cur of [0, 2, 4].filter(c => !failed.has(c))) {
      assert.strictEqual(prevFrameIndex(5, failed, nextFrameIndex(5, failed, cur)), cur, `next/prev round trip from ${cur}`);
    }
  }
}

/* first: the frame the viewer opens on. Tapping frame 2 opens frame 2. */
{
  assert.strictEqual(firstFrameIndex(3, new Set(), 1), 1, 'opens on the frame that was tapped');
  assert.strictEqual(firstFrameIndex(3, new Set(), 0), 0);
  assert.strictEqual(firstFrameIndex(3, new Set([1]), 1), 2, 'a failed frame is never opened on; the next live one is');
  assert.strictEqual(firstFrameIndex(3, new Set([2]), 2), 0, 'wraps to find a live frame');
  assert.strictEqual(firstFrameIndex(3, new Set(), 9), 2, 'out of range clamps to the last frame');
  assert.strictEqual(firstFrameIndex(3, new Set(), -4), 0, 'negative clamps to the first');
  assert.strictEqual(firstFrameIndex(3, new Set(), undefined), 0, 'no start index opens on the first');
  assert.strictEqual(firstFrameIndex(3, new Set(), NaN), 0);
  assert.strictEqual(firstFrameIndex(2, new Set([0, 1]), 0), null, 'nothing to show');
  assert.strictEqual(firstFrameIndex(0, new Set(), 0), null);
}

/* position: "n / of" counts only the frames still showing. */
{
  assert.deepStrictEqual(framePosition(3, new Set(), 0), { n: 1, of: 3 });
  assert.deepStrictEqual(framePosition(3, new Set(), 2), { n: 3, of: 3 });
  assert.deepStrictEqual(framePosition(3, new Set([0]), 1), { n: 1, of: 2 }, 'a dropped first frame renumbers the rest');
  assert.deepStrictEqual(framePosition(3, new Set([1]), 2), { n: 2, of: 2 });
  assert.deepStrictEqual(framePosition(0, new Set(), 0), { n: 0, of: 0 });
}

/* label: what the tag says. Matches the words the session/detail alt text already uses. */
{
  const pair = [{ src: 'a', tag: 'start' }, { src: 'b', tag: 'finish' }];
  assert.strictEqual(frameLabel(pair, 0), 'start');
  assert.strictEqual(frameLabel(pair, 1), 'finish');
  const seq = [{ src: 'a', tag: '1' }, { src: 'b', tag: '2' }, { src: 'c', tag: '3' }];
  assert.strictEqual(frameLabel(seq, 1), 'view 2');
  assert.strictEqual(frameLabel(seq, 5), '', 'no such frame, no label');
}

/* swipe: a mostly-horizontal drag of at least 40px steps; left is NEXT (the finger drags the next frame in). */
{
  assert.strictEqual(swipeDirection(-80, 5), 'next');
  assert.strictEqual(swipeDirection(80, -5), 'prev');
  assert.strictEqual(swipeDirection(-39, 0), null, 'too short is a tap, not a swipe');
  assert.strictEqual(swipeDirection(-40, 0), 'next', 'exactly the threshold counts');
  assert.strictEqual(swipeDirection(-60, 50), null, 'a diagonal drag is a scroll, not a swipe');
  assert.strictEqual(swipeDirection(0, -120), null);
  assert.strictEqual(swipeDirection(NaN, 0), null);
}

/* autoPlayMedia: the ONE rule for "do instruction images animate by themselves"
   (the live set's thumbnail and the viewer both ask it). The Settings switch
   `animateMedia` is on unless it says otherwise; reduced motion wins over it. */
{
  assert.strictEqual(autoPlayMedia({ animateMedia: true }, false), true, 'ON animates');
  assert.strictEqual(autoPlayMedia({ animateMedia: false }, false), false, 'OFF does not');
  assert.strictEqual(autoPlayMedia({}, false), true, 'a missing key means ON');
  assert.strictEqual(autoPlayMedia(undefined, false), true, 'no settings at all means ON');
  assert.strictEqual(autoPlayMedia(null, false), true);
  assert.strictEqual(autoPlayMedia({ animateMedia: 'false' }, false), false, 'a hand-edited data.json string "false" is OFF');
  assert.strictEqual(autoPlayMedia({ animateMedia: true }, true), false, 'reduced motion forces paused even when ON');
  assert.strictEqual(autoPlayMedia({}, true), false, 'and with the key missing');
  assert.strictEqual(autoPlayMedia({ animateMedia: false }, true), false);
}

console.log('media-cycle OK (frame order + skip-on-error)');
