'use strict';
/* Side-effect helpers shared by every tap-to-count surface: the full-screen
   freestyle modal (rep-counter-modal.js) AND the guided view's embedded
   counter/hold-timer (page-session.js). Wake lock and the touch/mouse
   tap-zone wiring live here ONCE so a debounce or a guard fix lands in both
   places at the same time. The actual counting rule (debounce, undo,
   floor-at-zero) stays pure in rep-counter.js — this module only touches the
   DOM and browser device APIs.

   SPEECH USED TO LIVE HERE and now lives in sound.js. It moved because
   speaking is no longer the only way this app can answer a rep: voice,
   beeps, vibration and silence are one decision made once, and leaving a
   bare speak() reachable from here is how half the call sites would have
   kept using it. */

const { el, ico } = require('./dom');
const { fillFraction, fillStage } = require('./counter-target');

/* A touch gesture that gets preventDefault()'d can still leave a browser's
   ~300ms touch->mouse compatibility window primed on some engines; this
   guard window comfortably outlasts it so a real tap never double-fires as
   a mousedown too. */
const TOUCH_MOUSE_GUARD_MS = 800;

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
     sensitivity picker, and the number box "Type" swaps the count for). A
     press that starts ON one of those is that control's press, not a rep —
     without this guard, changing sensitivity mid-set silently adds a rep
     every time you touch it, and placing the caret in the number box adds
     one before you have typed anything. Same rule clickableCard() applies
     for the same reason. */
  const nested = e => !!(e.target && e.target.closest && e.target.closest('button, input, select, textarea'));

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

/* ---------- the punch ---------- */

/* Retrigger the landing animation on `node`. A CSS animation only replays
   if the class actually goes away and comes back, and removing then adding
   it in the same frame is coalesced by the style system into no change at
   all — so the class is dropped, layout is READ to force a flush, and only
   then re-added. Reading offsetWidth is the cheapest reliable flush and is
   the standard idiom for exactly this.

   Cheaper than it looks: one forced style recalc on a node that is about to
   animate anyway, versus a rep that visibly does not register. */
function punch(node) {
  if (!node) return;
  node.classList.remove('gv-punch');
  void node.offsetWidth;
  node.classList.add('gv-punch');
}

/* ---------- the fill meter ---------- */

/* The tap zone charging up towards a target. Shared so the freestyle counter
   and the guided set screen fill at the same rate, escalate at the same
   points, and celebrate at the same moment — three things that would drift
   apart within a release if each screen owned its own bar.

   THE WHOLE THING IS TWO CSS CUSTOM PROPERTIES AND AN ATTRIBUTE. No
   per-frame JS, no rAF loop: this runs while someone is doing push-ups with
   the phone on the floor, and a JS animation competing with the tap handler
   is how a rep gets dropped. The stylesheet owns every pixel; this owns only
   "how full" and "which stage".

   Returns null for an OPEN-ENDED counter (target === null) so callers can
   skip the whole thing with one check — a progress bar with no destination
   is a lie, and drawing an empty one that never fills is worse than drawing
   nothing. */
function attachFillMeter(zone, target) {
  if (!target) return null;
  let lastStage = null;

  const set = count => {
    const f = fillFraction(count, target);
    const stage = fillStage(f);
    /* Clamped HERE, not in fillFraction: the fraction has to stay honest
       about overshoot for anything that wants to know by how much, but a
       bar taller than its own track just paints outside the zone. */
    zone.style.setProperty('--gv-fill', String(Math.min(1, f)));
    if (stage !== lastStage) {
      lastStage = stage;
      zone.setAttribute('data-fill', stage);
    }
    return stage;
  };

  zone.setAttribute('data-fill', 'idle');
  zone.style.setProperty('--gv-fill', '0');
  return { set, target };
}

/* ---------- typing the count in by hand ---------- */

/* "Type it" — set the count directly instead of tapping it out. Wired here
   rather than in each counter so the freestyle modal and the guided view get
   the same control with the same rules; they only supply the getter, the
   setter and the label.

   INLINE, NOT A DIALOG. A modal on top of the counter modal is a fight with
   Obsidian's own stack, and on a phone the useful thing is the number pad,
   which an input gets on its own. So the count display becomes an input in
   place, and turns back into the count when it commits.

   Commits on Enter and on blur; Escape abandons. Blur committing is
   deliberate: on iOS the keyboard's "done" and a tap anywhere else both blur
   without ever firing a key event, and a number typed and then lost is worse
   than one committed a moment early. */
function typeCountButton(countEl, opts) {
  const o = opts || {};
  const get = typeof o.get === 'function' ? o.get : () => 0;
  const set = typeof o.set === 'function' ? o.set : () => {};

  /* Icon only. The control bar already carries motion, mute, help, undo and
     Done; a sixth with a word on it is the one that pushes the row into
     wrapping on a phone. The aria-label carries the meaning that the missing
     word would have. */
  const btn = el('button', {
    class: 'gv-icon-btn gv-rc-type', type: 'button',
    'aria-label': o.label ? `Type the count — ${o.label}` : 'Type the count',
  }, ico('pencil'));

  btn.addEventListener('click', () => {
    if (countEl.querySelector('input')) return; // already editing
    const before = String(get());
    const input = el('input', {
      class: 'gv-rc-typein', type: 'number', inputmode: 'numeric', min: '0', step: '1',
      value: before, 'aria-label': o.label || 'Count',
    });

    let settled = false;
    const restore = value => {
      if (settled) return;
      settled = true;
      input.remove();
      countEl.textContent = String(value);
    };
    const commit = () => {
      const n = parseInt(input.value, 10);
      /* Reps do not go negative and a blank box is not zero — an abandoned
         edit keeps what was there, same rule undo() already applies. */
      const next = Number.isFinite(n) && n >= 0 ? n : get();
      restore(next);
      set(next);
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); restore(get()); }
      /* The counter's tap zone listens for Enter and Space as a rep. Typing
         inside it must not also count one. */
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
    /* The input sits INSIDE the tap zone, so a tap to place the caret would
       otherwise register as a rep. attachTapZone already ignores presses on
       a <button>; this covers the input. */
    for (const ev of ['touchstart', 'mousedown', 'click']) {
      input.addEventListener(ev, e => e.stopPropagation());
    }

    countEl.textContent = '';
    countEl.append(input);
    input.focus();
    input.select();
  });

  return btn;
}

module.exports = { holdWakeLock, attachTapZone, attachFillMeter, punch, typeCountButton, TOUCH_MOUSE_GUARD_MS };
