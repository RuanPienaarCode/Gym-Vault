'use strict';
/* Full-screen tap-to-count modal — phone flat on the floor, nose touches the
   screen at the bottom of each rep. Exercise-agnostic: same counter serves
   push-ups (nose), sit-ups/squats (finger), or a freestyle count from the
   command palette. The counting rule itself lives in rep-counter.js, pure
   and unit-tested; speech, wake-lock and the tap-zone wiring live in
   rep-counter-shared.js (shared with the guided view's embedded counter);
   this module owns only its own DOM and the modal chrome. */

const { Modal } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { createCounter, tap, undo } = require('./rep-counter');
const { speechAvailable, speak, cancelSpeech, holdWakeLock, attachTapZone } = require('./rep-counter-shared');
const { motionAvailable, startMotionCounter } = require('./motion-source');
const { Notice } = require('obsidian');

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
    this._wakeLock = null;
    this._flashTimer = null;
    this._detachTapZone = null;
    /* Motion is OFF until asked for. It costs a permission prompt on iOS and
       it cannot count a movement the phone is not attached to, so the tap
       zone stays the default and this is the opt-in. */
    this.motion = false;
    this._stopMotion = null;
  }

  onOpen() {
    this.modalEl.addClass('gv-app');
    this.modalEl.addClass('gv-repcounter-modal');
    this.modalEl.addClass(`gv-skin-${this.skin}`);
    this.modalEl.addClass(`gv-accent-${this.accent}`);

    const c = this.contentEl;
    const label = el('div', { class: 'gv-rc-label' }, this.exerciseName || 'Freestyle');

    const speechOk = speechAvailable();
    this.muteBtn = el('button', {
      class: 'gv-icon-btn', type: 'button',
      'aria-label': speechOk ? 'Mute count-back' : 'Speech not available on this device',
    }, ico(this.muted ? 'volume-x' : 'volume-2'));
    if (!speechOk) this.muteBtn.disabled = true;
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      if (this.muted) cancelSpeech();
      this.syncMuteButton();
    });

    this.motionBtn = el('button', {
      class: 'gv-icon-btn', type: 'button', 'aria-pressed': 'false',
      'aria-label': motionAvailable() ? 'Count reps from movement' : 'No motion sensor on this device',
    }, ico('activity'));
    if (!motionAvailable()) this.motionBtn.disabled = true;
    /* The click handler is the user gesture iOS requires — startMotionCounter
       calls requestPermission() synchronously inside it. Anything that
       awaited first (a confirm dialog, a settings read) would lose the
       gesture and be refused without a prompt ever appearing. */
    this.motionBtn.addEventListener('click', () => this.toggleMotion());

    const undoBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Undo last rep' },
      ico('minus'), el('span', {}, '1'));
    undoBtn.addEventListener('click', () => { this.state = undo(this.state); this.renderCount(); });

    const doneBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Done'));
    doneBtn.addEventListener('click', () => { this._committed = true; this.close(); });

    const cancelBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Cancel' }, ico('x'));
    cancelBtn.addEventListener('click', () => { this._committed = false; this.close(); });

    const bar = el('div', { class: 'gv-rc-bar' },
      label,
      el('div', { class: 'gv-rc-controls' }, this.motionBtn, this.muteBtn, undoBtn, doneBtn, cancelBtn));

    /* aria-live so a screen-reader user hears each new count — speech
       synthesis (speak(), below) is a nicety, not a substitute: it's user-
       mutable, not available on every platform, and it FIGHTS the user's
       own screen reader rather than working with it. Announcements are
       naturally rate-limited by how fast a human can actually tap. */
    this.countEl = el('div', { class: 'gv-rc-count', 'aria-live': 'polite', 'aria-atomic': 'true' }, '0');
    /* One line of state under the number: what is counting right now. In tap
       mode it is empty rather than telling you to tap the thing you are
       already looking at. */
    this.hintEl = el('div', { class: 'gv-rc-hint', 'aria-live': 'polite' }, '');
    this.zone = el('div', { class: 'gv-rc-zone', role: 'button', tabindex: '0', 'aria-label': 'Tap to count a rep' }, this.countEl, this.hintEl);
    this._detachTapZone = attachTapZone(this.zone, () => this.registerTap());

    c.append(bar, this.zone);

    this._wakeLock = holdWakeLock();
  }

  onClose() {
    this.stopMotion();
    if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; }
    cancelSpeech();
    if (this._detachTapZone) { this._detachTapZone(); this._detachTapZone = null; }
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

  registerTap() {
    const now = Date.now();
    const result = tap(this.state, now);
    this.state = result.state;
    if (!result.counted) return; // inside the debounce window — not a new rep
    this.commitRep();
  }

  /* A motion-detected rep skips the tap debounce entirely — motion-count.js
     applies its own refractory window, and running both would silently drop
     any rep that landed in the gap between the two. Taps still work while
     motion is on: a rep the sensor misses is added by hand rather than lost. */
  registerMotionRep() {
    this.state = tap(this.state, Date.now(), 0).state;
    this.commitRep();
  }

  commitRep() {
    this.renderCount();
    this.flash();
    if (!this.muted) speak(this.state.count);
  }

  toggleMotion() {
    if (this.motion) { this.stopMotion(); this.syncMotionButton(); this.setHint(''); return; }
    this.motion = true;
    this.syncMotionButton();
    this.setHint('Asking for the motion sensor…');
    startMotionCounter({
      onRep: () => this.registerMotionRep(),
      onStatus: status => {
        if (status === 'listening') { this.setHint('Counting your movement — taps still work'); return; }
        /* Anything else means no samples are coming. Fall back to tap mode
           rather than leaving a dead toggle lit, and say why once. */
        this.motion = false;
        this.syncMotionButton();
        this.setHint('');
        new Notice(status === 'denied'
          ? 'Gym: motion access was declined — counting by tap instead. Enable Motion & Orientation for Obsidian in iOS Settings to use it.'
          : 'Gym: this device has no motion sensor available — counting by tap instead.', 6000);
      },
    }).then(stop => {
      /* The toggle may have been switched off while the prompt was up. */
      if (!this.motion) { stop(); return; }
      this._stopMotion = stop;
    });
  }

  stopMotion() {
    this.motion = false;
    if (this._stopMotion) { this._stopMotion(); this._stopMotion = null; }
  }

  setHint(text) { if (this.hintEl) this.hintEl.textContent = text; }

  syncMotionButton() {
    if (!this.motionBtn) return;
    this.motionBtn.setAttribute('aria-pressed', this.motion ? 'true' : 'false');
    this.motionBtn.classList.toggle('gv-icon-btn-on', this.motion);
    this.motionBtn.setAttribute('aria-label', this.motion ? 'Stop counting from movement' : 'Count reps from movement');
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

  syncMuteButton() {
    clear(this.muteBtn);
    this.muteBtn.append(ico(this.muted ? 'volume-x' : 'volume-2'));
    this.muteBtn.setAttribute('aria-label', this.muted ? 'Unmute count-back' : 'Mute count-back');
  }
}

module.exports = { RepCounterModal };
