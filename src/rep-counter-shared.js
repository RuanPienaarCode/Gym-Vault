'use strict';
/* Side-effect helpers shared by every tap-to-count surface: the full-screen
   freestyle modal (rep-counter-modal.js) AND the guided view's embedded
   counter/hold-timer (page-session.js). Speech, wake lock and the touch/
   mouse tap-zone wiring live here ONCE so a debounce or a guard fix lands in
   both places at the same time. The actual counting rule (debounce, undo,
   floor-at-zero) stays pure in rep-counter.js — this module only touches the
   DOM and browser device APIs. */

/* A touch gesture that gets preventDefault()'d can still leave a browser's
   ~300ms touch->mouse compatibility window primed on some engines; this
   guard window comfortably outlasts it so a real tap never double-fires as
   a mousedown too. */
const TOUCH_MOUSE_GUARD_MS = 800;

/* ---------- speech ---------- */

function speechAvailable() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }

function speak(text) {
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel(); // fast reps must not queue a backlog of utterances
    const u = new window.SpeechSynthesisUtterance(String(text));
    window.speechSynthesis.speak(u);
  } catch (e) { /* speech is a nicety — degrade silently, the count still lands */ }
}

function cancelSpeech() {
  if (!speechAvailable()) return;
  try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
}

/* ---------- wake lock ---------- */

/* Holds a screen wake lock for as long as the caller wants (one freestyle
   counter session, or a whole guided workout). Re-acquires on
   visibilitychange since iOS silently drops the lock when the app
   backgrounds and the taps/timers themselves keep resetting the idle timer.
   Callers must call .release() exactly once when they're done; it's safe to
   call more than once. */
function holdWakeLock() {
  let sentinel = null;
  let released = false;

  const acquire = async () => {
    if (released || !(navigator && 'wakeLock' in navigator)) return;
    try {
      const s = await navigator.wakeLock.request('screen');
      /* release() may have run while the request was in flight — a lock
         landing after that would be live and orphaned. */
      if (released) { try { s.release(); } catch (e) { /* ignore */ } return; }
      sentinel = s;
    } catch (e) {
      // Unsupported, denied, or the tab lost focus mid-request.
      sentinel = null;
    }
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') acquire(); };
  document.addEventListener('visibilitychange', onVisibility);
  acquire();

  return {
    release() {
      if (released) return;
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel) { try { sentinel.release(); } catch (e) { /* ignore */ } sentinel = null; }
    },
  };
}

/* ---------- tap zone ---------- */

/* Wires touchstart/touchend/touchcancel/mousedown/keydown onto `zone` so a
   flat-phone nose-tap (or a click, or Enter/Space) calls `onTap()` exactly
   once per gesture. Guards: a touch gesture is tracked by identifier so
   extra fingers landing mid-gesture are ignored; a guard window after any
   touch swallows the synthetic mousedown some engines still fire. Returns a
   teardown function that removes all the listeners it added — the caller
   still owns (and removes, if needed) the DOM node itself. */
function attachTapZone(zone, onTap) {
  let activeTouchId = null;
  let touchGuardUntil = 0;

  /* The zone is a container, and it now contains real controls (the
     sensitivity picker). A press that starts ON one of those is that
     control's press, not a rep — without this guard, changing sensitivity
     mid-set silently adds a rep every time you touch it. Same rule
     clickableCard() applies for the same reason. */
  const nested = e => !!(e.target && e.target.closest && e.target.closest('button'));

  const onTouchStart = e => {
    if (nested(e)) return;
    e.preventDefault(); // stop scroll/rubber-band under a full-screen tap zone
    if (activeTouchId !== null) return; // a gesture is already down — ignore extra fingers
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    activeTouchId = e.changedTouches[0].identifier;
    touchGuardUntil = Date.now() + TOUCH_MOUSE_GUARD_MS;
    onTap();
  };
  const releaseTouch = e => {
    if (!e.changedTouches) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId) activeTouchId = null;
    }
  };
  const onMouseDown = e => {
    if (e.button !== 0) return;
    if (nested(e)) return;
    if (Date.now() < touchGuardUntil) return; // real touch's synthetic mousedown echo
    onTap();
  };
  const onKeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (nested(e)) return; // Enter on the sensitivity picker picks; it does not count
    e.preventDefault();
    onTap();
  };

  zone.addEventListener('touchstart', onTouchStart, { passive: false });
  zone.addEventListener('touchend', releaseTouch, { passive: true });
  zone.addEventListener('touchcancel', releaseTouch, { passive: true });
  zone.addEventListener('mousedown', onMouseDown);
  zone.addEventListener('keydown', onKeydown);

  return () => {
    zone.removeEventListener('touchstart', onTouchStart);
    zone.removeEventListener('touchend', releaseTouch);
    zone.removeEventListener('touchcancel', releaseTouch);
    zone.removeEventListener('mousedown', onMouseDown);
    zone.removeEventListener('keydown', onKeydown);
  };
}

module.exports = { speechAvailable, speak, cancelSpeech, holdWakeLock, attachTapZone, TOUCH_MOUSE_GUARD_MS };
