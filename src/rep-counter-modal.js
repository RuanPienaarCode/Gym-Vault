'use strict';
/* Full-screen tap-to-count modal — phone flat on the floor, nose touches the
   screen at the bottom of each rep. Exercise-agnostic: same counter serves
   push-ups (nose), sit-ups/squats (finger), or a freestyle count from the
   command palette. The counting rule itself lives in rep-counter.js, pure
   and unit-tested; this module owns the DOM, speech and wake-lock side
   effects only. */

const { Modal } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { createCounter, tap, undo } = require('./rep-counter');

/* A touch gesture that gets preventDefault()'d can still leave a browser's
   ~300ms touch->mouse compatibility window primed on some engines; this
   guard window comfortably outlasts it so a real tap never double-fires as
   a mousedown too. */
const TOUCH_MOUSE_GUARD_MS = 800;
const FLASH_MS = 180;

class RepCounterModal extends Modal {
  /* opts: { exerciseName, skin, accent, onDone(count) }. onDone fires only
     on the deliberate "Done" button — Cancel and any other dismissal
     (Escape, backdrop) discard the count silently, same as backing out of
     an unsaved form elsewhere in the app. */
  constructor(app, opts) {
    super(app);
    opts = opts || {};
    this.exerciseName = opts.exerciseName || '';
    this.skin = opts.skin || 'floor';
    this.accent = opts.accent || 'lime';
    this.onDone = typeof opts.onDone === 'function' ? opts.onDone : () => {};

    this.state = createCounter();
    this.muted = false;
    this._committed = false;
    this._wakeLockSentinel = null;
    this._flashTimer = null;
    this._activeTouchId = null;
    this._touchGuardUntil = 0;
    this._onVisibility = null;
  }

  onOpen() {
    this.modalEl.addClass('gv-app');
    this.modalEl.addClass('gv-repcounter-modal');
    this.modalEl.addClass(`gv-skin-${this.skin}`);
    this.modalEl.addClass(`gv-accent-${this.accent}`);

    const c = this.contentEl;
    const label = el('div', { class: 'gv-rc-label' }, this.exerciseName || 'Freestyle');

    const speechOk = this.speechAvailable();
    this.muteBtn = el('button', {
      class: 'gv-icon-btn', type: 'button',
      'aria-label': speechOk ? 'Mute count-back' : 'Speech not available on this device',
    }, ico(this.muted ? 'volume-x' : 'volume-2'));
    if (!speechOk) this.muteBtn.disabled = true;
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      if (this.muted) this.cancelSpeech();
      this.syncMuteButton();
    });

    const undoBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Undo last rep' },
      ico('minus'), el('span', {}, '1'));
    undoBtn.addEventListener('click', () => { this.state = undo(this.state); this.renderCount(); });

    const doneBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Done'));
    doneBtn.addEventListener('click', () => { this._committed = true; this.close(); });

    const cancelBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Cancel' }, ico('x'));
    cancelBtn.addEventListener('click', () => { this._committed = false; this.close(); });

    const bar = el('div', { class: 'gv-rc-bar' },
      label,
      el('div', { class: 'gv-rc-controls' }, this.muteBtn, undoBtn, doneBtn, cancelBtn));

    this.countEl = el('div', { class: 'gv-rc-count' }, '0');
    this.zone = el('div', { class: 'gv-rc-zone', role: 'button', tabindex: '0', 'aria-label': 'Tap to count a rep' }, this.countEl);
    this.attachTapZone();

    c.append(bar, this.zone);

    this.acquireWakeLock();
    this._onVisibility = () => { if (document.visibilityState === 'visible') this.acquireWakeLock(); };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  onClose() {
    this.releaseWakeLock();
    this.cancelSpeech();
    if (this._onVisibility) { document.removeEventListener('visibilitychange', this._onVisibility); this._onVisibility = null; }
    if (this._flashTimer) { window.clearTimeout(this._flashTimer); this._flashTimer = null; }
    this.contentEl.empty();
    if (this._committed) {
      /* onDone may be synchronous (log-page rerender) — a sync throw here
         would otherwise escape Obsidian's Modal.close() uncaught. */
      try {
        Promise.resolve(this.onDone(this.state.count)).catch(e => console.error('gym-vault rep counter', e));
      } catch (e) {
        console.error('gym-vault rep counter', e);
      }
    }
  }

  /* ---------- tap zone ---------- */

  attachTapZone() {
    const zone = this.zone;

    const registerTap = () => {
      const now = Date.now();
      const result = tap(this.state, now);
      this.state = result.state;
      if (!result.counted) return; // inside the debounce window — not a new rep
      this.renderCount();
      this.flash();
      this.speak(this.state.count);
    };

    zone.addEventListener('touchstart', e => {
      e.preventDefault(); // stop scroll/rubber-band under a full-screen tap zone
      if (this._activeTouchId !== null) return; // a gesture is already down — ignore extra fingers
      if (!e.changedTouches || e.changedTouches.length === 0) return;
      this._activeTouchId = e.changedTouches[0].identifier;
      this._touchGuardUntil = Date.now() + TOUCH_MOUSE_GUARD_MS;
      registerTap();
    }, { passive: false });

    const releaseTouch = e => {
      if (!e.changedTouches) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this._activeTouchId) this._activeTouchId = null;
      }
    };
    zone.addEventListener('touchend', releaseTouch, { passive: true });
    zone.addEventListener('touchcancel', releaseTouch, { passive: true });

    /* Desktop fallback only. Guarded against the synthetic mousedown a real
       touch gesture can still trigger, so a nose-tap on a touchscreen
       laptop never counts twice. */
    zone.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (Date.now() < this._touchGuardUntil) return;
      registerTap();
    });

    // Keyboard: the zone carries tabindex/role=button for a11y, but the
    // primary use is a physical tap — Enter/Space is a bonus path, not the
    // one the debounce budget was tuned for.
    zone.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      registerTap();
    });
  }

  renderCount() { this.countEl.textContent = String(this.state.count); }

  flash() {
    this.zone.classList.add('gv-rc-flash');
    if (this._flashTimer) window.clearTimeout(this._flashTimer);
    this._flashTimer = window.setTimeout(() => {
      this.zone.classList.remove('gv-rc-flash');
      this._flashTimer = null;
    }, FLASH_MS);
  }

  /* ---------- speech ---------- */

  speechAvailable() { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); }

  speak(n) {
    if (this.muted || !this.speechAvailable()) return;
    try {
      window.speechSynthesis.cancel(); // fast reps must not queue a backlog of utterances
      const u = new window.SpeechSynthesisUtterance(String(n));
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech is a nicety — degrade silently, the count still lands */ }
  }

  cancelSpeech() {
    if (!this.speechAvailable()) return;
    try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }

  syncMuteButton() {
    clear(this.muteBtn);
    this.muteBtn.append(ico(this.muted ? 'volume-x' : 'volume-2'));
    this.muteBtn.setAttribute('aria-label', this.muted ? 'Unmute count-back' : 'Mute count-back');
  }

  /* ---------- wake lock ---------- */

  async acquireWakeLock() {
    if (!(navigator && 'wakeLock' in navigator)) return;
    try {
      this._wakeLockSentinel = await navigator.wakeLock.request('screen');
    } catch (e) {
      // Unsupported, denied, or the tab lost focus mid-request — the taps
      // themselves keep resetting the iOS idle timer during a live set.
      this._wakeLockSentinel = null;
    }
  }

  releaseWakeLock() {
    if (!this._wakeLockSentinel) return;
    try { this._wakeLockSentinel.release(); } catch (e) { /* ignore */ }
    this._wakeLockSentinel = null;
  }
}

module.exports = { RepCounterModal };
