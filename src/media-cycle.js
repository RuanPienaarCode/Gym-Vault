'use strict';
/* Pure order logic for the guided view's media-cycle (src/page-session.js
   guidedImageBlock). Given a frame count and the set of indices that have
   errored (offline / dead links), picks the next frame to show — skipping
   failed ones and wrapping. This is the one piece of the cycling behaviour
   worth pulling out of the DOM/timer plumbing, so frame order and
   skip-on-error can be tested without a browser. */

/* Returns the next INDEX to display after `current`, skipping any index in
   `failed`. Returns null when every frame has failed (nothing left to show)
   or total is 0. */
function nextFrameIndex(total, failed, current) {
  if (!total || total <= 0) return null;
  for (let step = 1; step <= total; step++) {
    const idx = (current + step) % total;
    if (!failed.has(idx)) return idx;
  }
  return null;
}

module.exports = { nextFrameIndex };
