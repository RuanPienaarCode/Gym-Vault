'use strict';
/* Full-screen tap-to-count modal — phone flat on the floor, nose touches the
   screen at the bottom of each rep. Exercise-agnostic: same counter serves
   push-ups (nose), sit-ups/squats (finger), or a freestyle count from the
   command palette. The counting rule itself lives in rep-counter.js, pure
   and unit-tested; wake-lock and the tap-zone wiring live in
   rep-counter-shared.js (shared with the guided view's embedded counter);
   how a rep is ANNOUNCED — voice, beep, buzz or nothing — lives in sound.js,
   which the guided counter uses too so the two never sound different; this
   module owns only its own DOM and the modal chrome. */

const { Modal } = require('obsidian');
const { el, ico, clear, segmented } = require('./dom');
const { createCounter, tap, undo } = require('./rep-counter');
const { holdWakeLock, attachTapZone, attachFillMeter, attachPowerUp, punch, typeCountButton } = require('./rep-counter-shared');
const counterTarget = require('./counter-target');
const { helpButton } = require('./explainer');
const sound = require('./sound');
const countdown = require('./countdown');
const { motionAvailable, startMotionCounter } = require('./motion-source');
const { sensitivityKey } = require('./motion-count');
const { Notice } = require('obsidian');

const FLASH_MS = 180;

class RepCounterModal extends Modal {
  /* opts: { exerciseName, skin, accent, settings, onDone(count) }. onDone fires only
     on the deliberate "Done" button — Cancel and any other dismissal
     (Escape, backdrop) discard the count silently, same as backing out of
     an unsaved form elsewhere in the app. */
  constructor(app, opts) {
    super(app);
    opts = opts || {};
    this.exerciseName = opts.exerciseName || '';
    this.skin = opts.skin || 'floor';
    this.accent = opts.accent || 'lime';
    /* The whole settings object, not a copy of soundMode: sound.js reads
       both soundMode and voiceURI, and a modal holding a snapshot of one of
       them is a modal that ignores the other. */
    this.settings = opts.settings || {};
    this.onDone = typeof opts.onDone === 'function' ? opts.onDone : () => {};
    /* The exercise's own motion sensitivity, and the way back to the note it
       came from. Sensitivity is a property of the MOVEMENT, not of the app —
       a sit-up double-bumps the accelerometer whoever is doing it — so the
       value lives on the exercise note and a change here is remembered for
       next time rather than for this set only. */
    this.sensitivity = sensitivityKey(opts.sensitivity);
    this.onSensitivity = typeof opts.onSensitivity === 'function' ? opts.onSensitivity : () => {};

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
    this._stopCountIn = null;
    /* What this count is FOR. null is open-ended — a real choice, offered
       first on the picker, not a missing value. Set once, before the
       counter arms, and never afterwards: a target that could move
       mid-set would make the fill bar meaningless. */
    this.target = null;
    this._meter = null;
    this._powerup = null;
  }

  onOpen() {
    this.modalEl.addClass('gv-app');
    this.contentEl.addClass('gv-xp-host');
    this.modalEl.addClass('gv-repcounter-modal');
    this.modalEl.addClass(`gv-skin-${this.skin}`);
    this.modalEl.addClass(`gv-accent-${this.accent}`);

    const c = this.contentEl;
    const label = el('div', { class: 'gv-rc-label' }, this.exerciseName || 'Freestyle');

    /* Nothing to mute when the mode is already silent (by choice, or
       because this device can do none of the things that make a noise). A
       control that silences silence is a control that lies. */
    const canHear = sound.audible(this.settings);
    this.muteBtn = el('button', {
      class: 'gv-icon-btn', type: 'button',
      'aria-label': canHear ? 'Mute count-back' : 'Count-back is off in settings',
    }, ico(this.muted ? 'volume-x' : 'volume-2'));
    if (!canHear) this.muteBtn.disabled = true;
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      if (this.muted) sound.cancel();
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
    undoBtn.addEventListener('click', () => {
      this.state = undo(this.state);
      this.renderCount();
      if (this._meter) this._meter.set(this.state.count);
    });

    const doneBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Done'));
    doneBtn.addEventListener('click', () => { this._committed = true; this.close(); });

    const cancelBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Cancel' }, ico('x'));
    cancelBtn.addEventListener('click', () => { this._committed = false; this.close(); });

    const controls = el('div', { class: 'gv-rc-controls' },
      this.motionBtn, this.muteBtn, helpButton(() => this.contentEl), undoBtn, doneBtn, cancelBtn);
    const bar = el('div', { class: 'gv-rc-bar' }, label, controls);

    /* aria-live so a screen-reader user hears each new count — speech
       synthesis (sound.announce, below) is a nicety, not a substitute: it's user-
       mutable, not available on every platform, and it FIGHTS the user's
       own screen reader rather than working with it. Announcements are
       naturally rate-limited by how fast a human can actually tap. */
    this.countEl = el('div', { class: 'gv-rc-count', 'aria-live': 'polite', 'aria-atomic': 'true' }, '0');
    /* One line of state under the number: what is counting right now. In tap
       mode it is empty rather than telling you to tap the thing you are
       already looking at. */
    this.hintEl = el('div', { class: 'gv-rc-hint', 'aria-live': 'polite' }, '');
    /* Sensitivity only appears while motion is running: in tap mode it would
       be a control over nothing. */
    this.sensEl = el('div', { class: 'gv-rc-sens' });
    /* Built after countEl because it edits it in place. lastTapAt rides
       through unchanged — see the twin in page-session.js repsBody. */
    const typeBtn = typeCountButton(this.countEl, {
      label: 'Reps',
      get: () => this.state.count,
      set: n => {
        this.state = { count: n, lastTapAt: this.state.lastTapAt };
        if (this._meter) this._meter.set(n);
      },
    });
    controls.insertBefore(typeBtn, undoBtn);

    this.zone = el('div', { class: 'gv-rc-zone', role: 'button', tabindex: '0', 'aria-label': 'Tap to count a rep' }, this.countEl, this.hintEl, this.sensEl);
    this._detachTapZone = attachTapZone(this.zone, () => this.registerTap());

    c.append(bar);

    /* BEFORE anything can make a sound: onOpen runs in the stack of whatever
       opened the modal — a ribbon click, a command, a button — which is the
       user gesture iOS wants, and both the count-in and the counter speak
       off timers a fraction of a second later, by which time that stack is
       gone. */
    sound.unlock();

    /* Undo and Type act on a count that does not exist yet, and Type edits
       the count element IN PLACE — which is still detached until the zone
       is attached, so its number box would open somewhere nobody can see.
       Both come back with the zone. */
    typeBtn.disabled = true;
    undoBtn.disabled = true;

    this._armZone = () => {
      typeBtn.disabled = false;
      undoBtn.disabled = false;
      /* The meter is built HERE, not in onOpen, because it needs the target
         the picker has just chosen. Open-ended returns null and the zone
         renders exactly as it always did. */
      this._meter = attachFillMeter(this.zone, this.target);
      /* The detonation the meter charges towards; fired once by the
         _targetHit guard in commitRep. The freestyle counter can be aimed
         at reps or seconds — the badge names whichever was reached. */
      this._powerup = this._meter
        ? attachPowerUp(this.zone, this.target && this.target.kind === 'seconds' ? 'Time reached' : 'Reps reached')
        : null;
      if (this.target) {
        this.zone.append(el('div', { class: 'gv-rc-target' }, `Target ${counterTarget.describeTarget(this.target)}`));
      }
      c.append(this.zone);
      this.zone.focus();
    };

    /* THREE STEPS, ONE TAP EACH: what are you going for, 3-2-1, count.
       The picker's tap is also what starts the countdown, so choosing costs
       nothing extra — and "Just count" is first, so the person who does not
       want a target is not made to answer a question. */
    this.renderTargetStep(c, () => this.startCountIn(c));

    this._wakeLock = holdWakeLock();
  }

  /* "What are you going for?" — the step before the counter. Reps only:
     this modal counts taps, and offering a time target would promise a
     stopwatch it does not have (guided duration sets are where a timed hold
     lives). */
  renderTargetStep(c, onChosen) {
    const choose = target => {
      this.target = target;
      step.remove();
      onChosen();
    };

    const chips = el('div', { class: 'gv-chips gv-rc-targetchips' });
    for (const n of counterTarget.QUICK_REPS) {
      const b = el('button', { class: 'gv-chip', type: 'button' }, String(n));
      b.addEventListener('click', () => choose(counterTarget.makeTarget('reps', n)));
      chips.append(b);
    }

    const custom = el('input', {
      class: 'gv-set-input gv-rc-targetinput', type: 'number', inputmode: 'numeric', min: '1', step: '1',
      placeholder: 'or type it', 'aria-label': 'Rep target',
    });
    const go = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Set'));
    /* An unreadable or empty box is open-ended, not zero — makeTarget already
       collapses every bad value to null, so this cannot produce a target of
       nothing that then fills instantly. */
    go.addEventListener('click', () => choose(counterTarget.makeTarget('reps', custom.value)));
    custom.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      choose(counterTarget.makeTarget('reps', custom.value));
    });

    const open = el('button', { class: 'gv-btn gv-btn-ghost gv-rc-targetopen', type: 'button' },
      ico('infinity'), el('span', {}, 'Just count'));
    open.addEventListener('click', () => choose(null));

    const step = el('div', { class: 'gv-rc-targetstep' },
      el('h2', { class: 'gv-kicker gv-rc-targettitle' }, this.exerciseName || 'Freestyle'),
      el('div', { class: 'gv-rc-targetask' }, 'How many?'),
      chips,
      el('div', { class: 'gv-rc-targetcustom' }, custom, go),
      open);
    c.append(step);
    return step;
  }

  startCountIn(c) {
    /* Count in before the zone arms — same 3, 2, 1, Begin the guided screen
       uses, from the same module. Without it the first tap of a set is the
       one that puts the phone on the floor, and every count starts a rep
       behind. The zone is held back rather than covered: a tap zone under an
       overlay is a tap zone that will eventually be tapped through. */
    this._stopCountIn = countdown.runCountIn(c, {
      label: this.exerciseName || 'Freestyle',
      muted: this.muted,
      settings: this.settings,
      onDone: () => {
        this._stopCountIn = null;
        if (!this.contentEl.isConnected) return; // modal closed mid-count
        const gate = this.contentEl.querySelector('.gv-countin');
        if (gate) gate.remove();
        this._armZone();
      },
    });
  }

  onClose() {
    if (this._stopCountIn) { this._stopCountIn(); this._stopCountIn = null; }
    this.stopMotion();
    if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; }
    sound.cancel();
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
    punch(this.countEl, this.state.count);
    this.flash();
    if (this._meter && this._meter.set(this.state.count) === 'done' && !this._targetHit) {
      /* Once, at the moment the target is met. The reps after it are bonus,
         not a second announcement. */
      this._targetHit = true;
      if (this._powerup) this._powerup.fire();
      if (!this.muted) sound.cue('go', 'target', this.settings);
    }
    if (!this.muted) sound.announce(this.state.count, this.settings);
  }

  toggleMotion() {
    if (this.motion) {
      this.stopMotion();
      this.syncMotionButton();
      this.renderSensitivity();
      this.setHint('');
      return;
    }
    this.motion = true;
    this.syncMotionButton();
    this.renderSensitivity();
    this.setHint('Asking for the motion sensor…');
    this.beginMotion();
  }

  beginMotion() {
    startMotionCounter({
      sensitivity: this.sensitivity,
      onRep: () => this.registerMotionRep(),
      onStatus: status => {
        if (status === 'listening') { this.setHint('Counting your movement — taps still work'); return; }
        /* Anything else means no samples are coming. Fall back to tap mode
           rather than leaving a dead toggle lit, and say why once. */
        this.motion = false;
        this.syncMotionButton();
        this.renderSensitivity();
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

  /* Rebuild the sensitivity picker. Empty when motion is off — see sensEl. */
  renderSensitivity() {
    if (!this.sensEl) return;
    clear(this.sensEl);
    if (!this.motion) return;
    this.sensEl.append(segmented(
      [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']],
      this.sensitivity,
      value => this.pickSensitivity(value),
      { label: 'Sensitivity' },
    ));
  }

  /* A change restarts the detector rather than adjusting it in place: the
     thresholds are baked into the detector's state at creation, and half a
     set counted at one sensitivity and half at another is a count nobody can
     interpret afterwards. The reps already banked are kept — only the
     detection restarts. */
  pickSensitivity(value) {
    this.sensitivity = sensitivityKey(value);
    this.renderSensitivity();
    try { this.onSensitivity(this.sensitivity); } catch (e) { console.error('gym-vault sensitivity', e); }
    if (!this.motion) return;
    this.stopMotion();
    this.motion = true;
    this.syncMotionButton();
    this.setHint('Restarting at ' + this.sensitivity + ' sensitivity…');
    this.beginMotion();
  }

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
