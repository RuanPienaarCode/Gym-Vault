'use strict';
/* Pure rep-counting logic for the full-screen tap counter — no DOM, no
   obsidian import, so the debounce/count rules are unit-testable without a
   browser. rep-counter-modal.js is the only caller; it owns the DOM, speech
   and wake-lock side effects and leaves the actual counting to this module. */

/* A descending face registers nose, then chin, then forehead on the way down
   to a push-up floor — one rep must not become three. 700ms comfortably
   outlasts that whole gesture without feeling laggy on a fast set. */
const DEBOUNCE_MS = 700;

/* lastTapAt starts at -Infinity, not 0 — Date.now() is never 0 in
   production, but a fake clock in tests (or a tap at real epoch time) must
   still count as the first rep, not collide with the debounce window. */
function createCounter() {
  return { count: 0, lastTapAt: -Infinity };
}

/* Registers a tap at time `now` (ms, caller's clock — Date.now() in
   production, a fake clock in tests). Returns { state, counted }: `state` is
   a NEW object (never mutates the input), `counted` is false when the tap
   landed inside the debounce window, in which case `state` is the SAME
   object that was passed in (so callers can skip the flash/speech with a
   reference check if they want, though comparing `counted` is enough). */
function tap(state, now, debounceMs) {
  const window_ = debounceMs == null ? DEBOUNCE_MS : debounceMs;
  if (now - state.lastTapAt < window_) return { state, counted: false };
  return { state: { count: state.count + 1, lastTapAt: now }, counted: true };
}

/* Undo never counts as a tap and never touches lastTapAt — an undo right
   after a real rep must not open a fresh debounce window that eats the next
   genuine tap. Floored at 0: reps don't go negative. */
function undo(state) {
  return { count: Math.max(0, state.count - 1), lastTapAt: state.lastTapAt };
}

module.exports = { createCounter, tap, undo, DEBOUNCE_MS };
