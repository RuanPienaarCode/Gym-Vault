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

/* Time each frame holds before crossfading to the next. ONE value for the live
   set's thumbnail (page-session.js) and the full-screen viewer
   (media-viewer.js), so the same exercise animates at the same speed in both. */
const MEDIA_CYCLE_MS = 1100;

/* The same walk, backwards: the previous live frame, wrapping from the first
   to the last. */
function prevFrameIndex(total, failed, current) {
  if (!total || total <= 0) return null;
  for (let step = 1; step <= total; step++) {
    const idx = (((current - step) % total) + total) % total;
    if (!failed.has(idx)) return idx;
  }
  return null;
}

/* The frame the viewer opens on: `wanted` (clamped into range; anything that is
   not a number is the first frame), or the next live frame when that one has
   already failed. null when nothing can be shown. */
function firstFrameIndex(total, failed, wanted) {
  if (!total || total <= 0) return null;
  const w = Number.isFinite(wanted) ? Math.min(total - 1, Math.max(0, Math.floor(wanted))) : 0;
  if (!failed.has(w)) return w;
  return nextFrameIndex(total, failed, w);
}

/* "n of m" over the frames still showing, so a dropped frame renumbers the
   rest instead of leaving a gap ("1 / 3" then "3 / 3"). */
function framePosition(total, failed, current) {
  let n = 0, of = 0;
  for (let i = 0; i < total; i++) {
    if (failed.has(i)) continue;
    of++;
    if (i <= current) n++;
  }
  return { n, of };
}

/* What a frame is called: the start/finish pair keeps those words, a longer
   sequence is "view 2". resolveExerciseImages tags a pair "start"/"finish" and
   anything else with its 1-based number. */
function frameLabel(frames, i) {
  const f = frames[i];
  if (!f) return '';
  return f.tag === 'start' || f.tag === 'finish' ? f.tag : `view ${f.tag}`;
}

/* Do instruction images animate by themselves? The ONE rule, asked by the live
   set's thumbnail (page-session.js), the full-screen viewer (media-viewer.js) and,
   for an exercise with a motion, the Muscle Map in all three places (it is
   `autoPlay` there: muscle-map.js).
   Settings -> "Animate exercise images" (`animateMedia`) is ON unless it says
   otherwise (a missing key, or no settings at all, is ON; a hand-edited string
   "false" is OFF, as rewardsEnabled reads `rewards`). Reduced motion forces
   paused whatever the setting says. Stepping by hand and the viewer's Play
   button are never gated by this: it only decides what happens WITHOUT a tap. */
function autoPlayMedia(settings, reducedMotion) {
  if (reducedMotion) return false;
  const v = settings ? settings.animateMedia : undefined;
  return !(v === false || String(v) === 'false');
}

const SWIPE_MIN_PX = 40;
/* A swipe is a mostly-horizontal drag of at least SWIPE_MIN_PX: left (dx < 0)
   steps to the NEXT frame, right to the previous. Anything shorter is a tap and
   anything steeper than 1.5:1 vertical-to-horizontal is the user scrolling. */
function swipeDirection(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) <= Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

module.exports = { nextFrameIndex, prevFrameIndex, firstFrameIndex, framePosition, frameLabel, swipeDirection, autoPlayMedia, MEDIA_CYCLE_MS, SWIPE_MIN_PX };
