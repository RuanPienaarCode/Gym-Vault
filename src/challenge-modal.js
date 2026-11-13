'use strict';
/* The weekly challenge counter — phone flat on the floor, nose taps the
   screen at the bottom of each rep, exactly like the rep counter. Three
   steps: pick how (Max or Sets), count, then a summary you save or discard.

   What is different from the rep counter is the SET RULE: a rest longer than
   the challenge's limit (5 s unless the note says otherwise) ends the set,
   and the next rep starts a new one. challenge.js owns that rule (pure,
   tested); this module owns the DOM, the timers and the sounds. The tap
   debounce, tap zone, count-in, fill meter and voice are the rep counter's
   own helpers, so the two counters cannot feel different.

   The score is the best UNBROKEN set. Sets mode is training toward it: its
   biggest set still counts, its total never does.

   HOLDS (status.kind === 'seconds' — a plank, a wall sit) swap the rep count
   for a stopwatch: the count-in starts the first hold, a tap ends it, the
   next tap starts the next. There is no rest rule for a hold — stopping IS
   the end of the set. */

const { Modal } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { createCounter, tap } = require('./rep-counter');
const { holdWakeLock, attachTapZone, attachCountIn, attachFillMeter, attachPowerUp, punch } = require('./rep-counter-shared');
const counterTarget = require('./counter-target');
const sound = require('./sound');
const ch = require('./challenge');
const { skinClasses } = require('./constants');

const TICK_MS = 250;
const FLASH_MS = 180;
/* "Set ends in 3…" only appears once a pause is clearly a pause — a breath
   at the top of a rep is not news. */
const WARN_AFTER_MS = 2000;

const fmtClock = ms => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

class ChallengeModal extends Modal {
  /* opts: { title, exercise, status (challenge.challengeStatus), shape,
     restSeconds, skin, accent, settings, onSave(sets, mode, startedAt) →
     Promise<boolean> }. Nothing is written unless Save is pressed. */
  constructor(app, opts) {
    super(app);
    const o = opts || {};
    this.title = o.title || 'Weekly challenge';
    this.exercise = o.exercise || '';
    this.status = o.status || {};
    this.shape = o.shape || ch.DEFAULT_SHAPE;
    this.restMs = (o.restSeconds || ch.DEFAULT_REST_S) * 1000;
    this.skin = o.skin || 'apex';
    this.accent = o.accent || 'lime';
    this.settings = o.settings || {};
    this.onSave = typeof o.onSave === 'function' ? o.onSave : async () => false;

    this.phase = 'pick';
    this.mode = null;
    this.plan = [];
    this.run = ch.createRun(this.restMs);
    this.tapState = createCounter();
    this.muted = false;
    this.startedAt = Date.now();
    this._beatFired = false;
    this._setHit = new Set();
    this._timers = [];
    this.kind = this.status.kind === 'seconds' ? 'seconds' : 'reps';
    /* Hold state: finished holds in whole seconds, and when the open one
       began (null while resting). */
    this.holds = [];
    this.holdStart = null;
  }

  get holding() { return this.kind === 'seconds'; }

  score(n) { return ch.fmtScore(n, this.kind); }

  /* Every set so far, whichever kind: reps sets from the run, or holds (the
     open hold included, in whole seconds). */
  setsNow(now) {
    if (!this.holding) return ch.runSets(this.run);
    const t = now || Date.now();
    return this.holdStart === null ? this.holds.slice() : [...this.holds, Math.floor((t - this.holdStart) / 1000)];
  }

  /* This week's target in one set, or null in a test week. */
  get target() { return this.status.target ?? null; }

  /* What Sets mode splits: this week's target, or the goal in a test week
     (there is no target yet, and the goal is what the training is for). */
  get splitOf() { return this.target ?? this.status.goal ?? null; }

  onOpen() {
    this.modalEl.addClass('gv-app');
    this.contentEl.addClass('gv-xp-host');
    this.modalEl.addClass('gv-repcounter-modal');
    this.modalEl.addClass('gv-challenge-modal');
    for (const cls of skinClasses(this.skin)) this.modalEl.addClass(cls);
    this.modalEl.addClass(`gv-accent-${this.accent}`);
    /* Inside the gesture that opened the modal — iOS will not let a timer
       make the first sound. Same reason as the rep counter. */
    sound.unlock();
    this._wakeLock = holdWakeLock();
    /* Escape mid-count goes to the summary, where Discard is one tap away.
       A long set lost to a stray key is the worst thing this screen could
       do. Returning false stops Obsidian closing the modal. */
    this.scope.register([], 'Escape', () => {
      if (this.phase === 'count' && this.setsNow().length) { this.finish(); return false; }
      return undefined;
    });
    this.renderPick();
  }

  onClose() {
    this.stopCounting();
    if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; }
    sound.cancel();
    this.contentEl.empty();
  }

  /* ---------- step 1: how ---------- */

  renderPick() {
    const c = this.contentEl;
    clear(c);
    const s = this.status;
    const goal = s.goal;
    const one = this.holding ? 'one unbroken hold' : 'one unbroken set';
    const headline = s.done ? `Goal reached — keep ${this.score(goal)}`
      : s.testWeek ? 'Test week'
      : `Beat ${this.score(this.target)}`;
    const sub = s.testWeek
      ? `${this.holding ? 'As long as you can' : 'As many as you can'} in ${one}. That sets next week's target.`
      : `${this.exercise} in ${one} this week.`;
    const facts = [];
    if (s.weekNo) facts.push(`Week ${s.weekNo}`);
    if (s.lastWeek) facts.push(`Last week ${this.score(s.lastWeek.best)}`);
    if (s.thisWeek) facts.push(`This week ${this.score(s.thisWeek.best)}`);
    if (s.best) facts.push(`Best ${this.score(s.best)}`);
    if (goal) facts.push(`Goal ${this.score(goal)}`);

    const plan = ch.splitSets(this.splitOf, this.shape);
    const rest = Math.round(this.restMs / 1000);

    const maxBtn = el('button', { class: 'gv-challenge-mode', type: 'button' },
      el('span', { class: 'gv-challenge-mode-name' }, ico('flame'), el('span', {}, 'Max')),
      el('span', { class: 'gv-challenge-mode-desc' }, this.holding
        ? 'One long hold. Tap the screen when you stop.'
        : `One big set. Rest more than ${rest} s and the set ends.`));
    maxBtn.addEventListener('click', () => this.begin('max', []));

    const setsBtn = el('button', { class: 'gv-challenge-mode', type: 'button' },
      el('span', { class: 'gv-challenge-mode-name' }, ico('layers'), el('span', {}, 'Sets')),
      el('span', { class: 'gv-challenge-mode-desc' },
        plan.length
          ? `${plan.map(n => this.score(n)).join(' · ')} — rest between ${this.holding ? 'holds' : 'sets'}. Your best still counts.`
          : 'Set a goal first.'));
    if (!plan.length) setsBtn.disabled = true;
    setsBtn.addEventListener('click', () => this.begin('sets', plan));

    const cancel = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' }, 'Not now');
    cancel.addEventListener('click', () => this.close());

    c.append(el('div', { class: 'gv-challenge-pick' },
      el('h2', { class: 'gv-kicker' }, this.title),
      el('div', { class: 'gv-challenge-headline' }, headline),
      el('p', { class: 'gv-challenge-sub' }, sub),
      facts.length ? el('div', { class: 'gv-challenge-facts' }, facts.join(' · ')) : '',
      el('div', { class: 'gv-challenge-modes' }, maxBtn, setsBtn),
      cancel));
  }

  /* ---------- step 2: count ---------- */

  begin(mode, plan) {
    this.mode = mode;
    this.plan = plan;
    this.phase = 'count';
    this.startedAt = Date.now();
    const c = this.contentEl;
    clear(c);

    const canHear = sound.audible(this.settings);
    this.muteBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': canHear ? 'Mute count-back' : 'Count-back is off in settings' }, ico('volume-2'));
    if (!canHear) this.muteBtn.disabled = true;
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      if (this.muted) sound.cancel();
      clear(this.muteBtn);
      this.muteBtn.append(ico(this.muted ? 'volume-x' : 'volume-2'));
      this.muteBtn.setAttribute('aria-label', this.muted ? 'Unmute count-back' : 'Mute count-back');
    });

    this.undoBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Undo last rep' }, ico('minus'), el('span', {}, 'Undo'));
    this.undoBtn.addEventListener('click', () => {
      /* A hold's undo drops the open hold, or else the last finished one. */
      if (this.holding) { if (this.holdStart !== null) this.holdStart = null; else this.holds.pop(); }
      else this.run = ch.undoRep(this.run);
      this.render();
    });
    this.undoBtn.disabled = true;

    const finishBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Finish'));
    finishBtn.addEventListener('click', () => this.finish());

    /* X with reps on the board goes to the summary, same as Escape; with
       none it simply closes. */
    const cancelBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Stop' }, ico('x'));
    cancelBtn.addEventListener('click', () => (this.setsNow().length ? this.finish() : this.close()));

    const label = el('div', { class: 'gv-rc-label' }, `${this.exercise} · ${mode === 'max' ? 'Max' : 'Sets'}`);
    c.append(el('div', { class: 'gv-rc-bar' }, label, el('div', { class: 'gv-rc-controls' }, this.muteBtn, this.undoBtn, finishBtn, cancelBtn)));

    this.countEl = el('div', { class: 'gv-rc-count', 'aria-live': 'polite', 'aria-atomic': 'true' }, '0');
    this.hintEl = el('div', { class: 'gv-rc-hint', 'aria-live': 'polite' }, '');
    this.goalEl = el('div', { class: 'gv-rc-target' }, '');
    this.ladderEl = el('div', { class: 'gv-challenge-ladder', 'aria-label': 'Sets so far' });
    this.zone = el('div', { class: 'gv-rc-zone', role: 'button', tabindex: '0', 'aria-label': this.holding ? 'Tap to start or stop a hold' : 'Tap to count a rep' },
      this.countEl, this.hintEl, this.goalEl, this.ladderEl);

    /* Max mode fills toward this week's target; a test week has none, and a
       bar with no destination would be a lie (see attachFillMeter). Sets
       mode's targets change set by set, so it shows the ladder instead. */
    if (mode === 'max' && this.target) {
      /* A hold's meter fills by whole seconds — the same 0..1 fill. */
      this._meter = attachFillMeter(this.zone, counterTarget.makeTarget(this.kind, this.target));
      this._powerup = attachPowerUp(this.zone, 'Beaten');
    }
    this._detachTapZone = attachTapZone(this.zone, () => this.registerTap());
    c.append(this.zone);
    this.zone.focus();
    this.render();

    this._countIn = attachCountIn(this.zone, this.countEl, {
      muted: () => this.muted,
      settings: this.settings,
      hintEl: this.hintEl,
      onDone: () => {
        if (!this.contentEl.isConnected || this.phase !== 'count') return;
        this.undoBtn.disabled = false;
        /* A hold starts on "Begin" — you are already in position. */
        if (this.holding) this.holdStart = Date.now();
        this.render();
      },
    });
    this._tick = window.setInterval(() => this.tick(), TICK_MS);
  }

  registerTap() {
    if (this.phase !== 'count') return;
    /* The tap that skips the count-in is not rep one (the rep counter's
       rule, audit L3-04): it is stamped so the debounce covers its echo. */
    if (this._countIn && !this._countIn.armed()) {
      this._countIn.skip();
      this.tapState = { count: this.tapState.count, lastTapAt: Date.now() };
      return;
    }
    const now = Date.now();
    const res = tap(this.tapState, now);
    this.tapState = res.state;
    if (!res.counted) return;
    if (this.holding) { this.toggleHold(now); return; }
    this.commitRep(now);
  }

  /* A tap mid-hold ends it; a tap while resting starts the next one. A hold
     under one second is a fumble, not a set, and is dropped. */
  toggleHold(now) {
    if (this.holdStart === null) {
      this.holdStart = now;
      this._holdCued = false;
      if (this._meter) this._meter.set(0);
      if (!this.muted) sound.cue('begin', 'begin', this.settings);
    } else {
      const secs = Math.floor((now - this.holdStart) / 1000);
      this.holdStart = null;
      if (secs >= 1) this.holds.push(secs);
      this.restFrom = now;
      if (!this.muted) sound.cue('begin', 'rest', this.settings);
    }
    this.flash();
    this.render(now);
  }

  commitRep(now) {
    const { run } = ch.addRep(this.run, now);
    this.run = run;
    const n = run.current;
    punch(this.countEl, n);
    this.flash();
    let cued = false;
    if (this.mode === 'max' && this._meter) {
      this._meter.set(n);
      if (this.target && n >= this.target && !this._beatFired) {
        this._beatFired = true;
        if (this._powerup) this._powerup.fire();
        if (!this.muted) sound.cue('go', 'target', this.settings, { hold: true });
        cued = true;
      }
    }
    if (this.mode === 'sets') {
      const i = run.sets.length;
      const want = this.plan[i];
      if (want && n === want && !this._setHit.has(i)) {
        this._setHit.add(i);
        if (!this.muted) sound.cue('go', 'target', this.settings, { hold: true });
        cued = true;
      }
    }
    if (!this.muted && !cued) sound.announce(n, this.settings);
    this.render(now);
  }

  /* Runs every TICK_MS while counting: closes a set the moment the rest runs
     out, and keeps the hint honest about how long you have been resting. */
  tick() {
    if (this.phase !== 'count' || (this._countIn && !this._countIn.armed())) return;
    const now = Date.now();
    if (this.holding) { this.tickHold(now); return; }
    const { run, closed } = ch.closeIfRested(this.run, now);
    if (closed !== null) {
      this.run = run;
      if (this._meter) this._meter.set(0);
      if (!this.muted) sound.cue('begin', 'rest', this.settings);
    }
    this.render(now);
  }

  tickHold(now) {
    if (this.holdStart !== null) {
      const secs = Math.floor((now - this.holdStart) / 1000);
      if (this._meter) this._meter.set(secs);
      const want = this.mode === 'max' ? this.target : this.plan[this.holds.length];
      if (want && secs >= want && !this._holdCued) {
        this._holdCued = true;
        if (this.mode === 'max' && !this._beatFired) { this._beatFired = true; if (this._powerup) this._powerup.fire(); }
        if (!this.muted) sound.cue('go', 'target', this.settings, { hold: true });
      } else if (secs !== this._lastSpoken && secs > 0 && secs % 10 === 0 && !this.muted) {
        /* Every ten seconds, said aloud: eyes are on the floor in a plank. */
        sound.announce(secs, this.settings);
      }
      this._lastSpoken = secs;
    }
    this.render(now);
  }

  render(now) {
    if (!this.countEl) return;
    if (this.holding) { this.renderHold(now); return; }
    const t = now || Date.now();
    const run = this.run;
    const armed = !this._countIn || this._countIn.armed();
    if (armed) this.countEl.textContent = String(run.current);
    const sets = ch.runSets(run);
    const best = ch.bestSet(sets);

    /* The line under the number. */
    let hint = '';
    if (armed) {
      const resting = ch.restingFor(run, t);
      if (run.current > 0 && resting !== null && resting > WARN_AFTER_MS) {
        hint = `Set ends in ${Math.max(1, Math.ceil((this.restMs - resting) / 1000))}…`;
      } else if (run.current === 0 && run.sets.length) {
        const last = run.sets[run.sets.length - 1];
        hint = `Set ${run.sets.length}: ${last}. Resting ${fmtClock(resting || 0)} — next rep starts set ${run.sets.length + 1}`;
      } else if (run.current === 0) {
        hint = 'Nose to the screen at the bottom of each rep';
      }
      this.hintEl.textContent = hint;
    }

    /* The target line. */
    if (this.mode === 'max') {
      this.goalEl.textContent = this.target
        ? (best >= this.target ? `Beaten — best set ${best} (target ${this.target})` : `Beat ${this.target} in one set`)
        : (best ? `Best set ${best} — keep going` : 'Test week: one big set');
    } else {
      const i = run.sets.length; // the open set, or the next one after a rest
      const want = this.plan[i];
      this.goalEl.textContent = want
        ? `Set ${i + 1} of ${this.plan.length} · ${want} reps`
        : `Plan done — extra sets still count · best ${best}`;
    }

    /* The ladder: Sets mode shows every planned set (done, current, to
       come); Max shows the sets the rests have split off so far. */
    clear(this.ladderEl);
    const chips = [];
    if (this.mode === 'sets') {
      const len = Math.max(this.plan.length, sets.length);
      for (let i = 0; i < len; i++) {
        const done = i < run.sets.length;
        const open = i === run.sets.length && run.current > 0;
        const state = done ? (sets[i] >= (this.plan[i] || 0) ? 'hit' : 'short') : open ? 'now' : 'next';
        const text = done || open ? String(sets[i]) : String(this.plan[i]);
        chips.push(el('span', { class: `gv-challenge-chip ${state}` }, text));
      }
    } else {
      sets.forEach((n, i) => {
        const open = i === sets.length - 1 && run.current > 0;
        chips.push(el('span', { class: `gv-challenge-chip ${open ? 'now' : n === best ? 'hit' : 'short'}` }, String(n)));
      });
    }
    this.ladderEl.append(...chips);
  }

  renderHold(now) {
    const t = now || Date.now();
    const armed = !this._countIn || this._countIn.armed();
    const sets = this.setsNow(t);
    const best = ch.bestSet(sets);
    const open = this.holdStart !== null;
    const i = this.holds.length;
    if (armed) {
      this.countEl.textContent = open ? this.score(Math.floor((t - this.holdStart) / 1000)) : this.score(0);
      this.hintEl.textContent = open ? 'Holding — tap the screen when you stop'
        : this.holds.length ? `Hold ${i}: ${this.score(this.holds[i - 1])}. Resting ${fmtClock(t - (this.restFrom || t))} — tap to start hold ${i + 1}`
        : 'Tap to start';
    }
    if (this.mode === 'max') {
      this.goalEl.textContent = this.target
        ? (best >= this.target ? `Beaten — best hold ${this.score(best)}` : `Beat ${this.score(this.target)} in one hold`)
        : (best ? `Best hold ${this.score(best)}` : 'Test week: one long hold');
    } else {
      const want = this.plan[i];
      this.goalEl.textContent = want ? `Hold ${i + 1} of ${this.plan.length} · ${this.score(want)}` : `Plan done — extra holds still count · best ${this.score(best)}`;
    }
    clear(this.ladderEl);
    const len = this.mode === 'sets' ? Math.max(this.plan.length, sets.length) : sets.length;
    for (let k = 0; k < len; k++) {
      const done = k < this.holds.length;
      const isOpen = k === this.holds.length && open;
      const state = this.mode === 'sets'
        ? (done ? (sets[k] >= (this.plan[k] || 0) ? 'hit' : 'short') : isOpen ? 'now' : 'next')
        : (isOpen ? 'now' : sets[k] === best ? 'hit' : 'short');
      this.ladderEl.append(el('span', { class: `gv-challenge-chip ${state}` }, this.score(done || isOpen ? sets[k] : this.plan[k])));
    }
  }

  flash() {
    this.zone.classList.add('gv-rc-flash');
    if (this._flashTimer) window.clearTimeout(this._flashTimer);
    this._flashTimer = window.setTimeout(() => { this.zone.classList.remove('gv-rc-flash'); this._flashTimer = null; }, FLASH_MS);
  }

  stopCounting() {
    if (this._countIn) { this._countIn.stop(); this._countIn = null; }
    if (this._tick) { window.clearInterval(this._tick); this._tick = null; }
    if (this._flashTimer) { window.clearTimeout(this._flashTimer); this._flashTimer = null; }
    if (this._detachTapZone) { this._detachTapZone(); this._detachTapZone = null; }
  }

  /* ---------- step 3: summary ---------- */

  finish() {
    const sets = this.setsNow().filter(n => n > 0);
    this.stopCounting();
    sound.cancel();
    if (!sets.length) { this.close(); return; }
    this.phase = 'summary';
    const best = ch.bestSet(sets);
    const total = sets.reduce((a, b) => a + b, 0);
    const one = this.holding ? 'one hold' : 'one set';
    const sc = n => this.score(n);
    const s = this.status;
    const goal = s.goal;

    let verdict;
    if (goal && best >= goal) verdict = `Goal reached: ${sc(best)} in ${one}!`;
    else if (s.testWeek) verdict = `Baseline: ${sc(best)} in ${one}. Next week, beat ${sc(ch.nextTarget(best, goal))}.`;
    else if (best >= this.target) verdict = `Beaten! ${sc(best)} in ${one} — the target was ${sc(this.target)}.`;
    else if (this.mode === 'sets') {
      /* A Sets day is training, not the attempt: say what was done, and
         where the weekly score comes from, rather than "12 short". */
      const planned = this.plan.reduce((a, b) => a + b, 0);
      verdict = `Sets done: ${sc(total)} of ${sc(planned)} planned. To beat ${sc(this.target)}, go for it in Max — only your best unbroken ${this.holding ? 'hold' : 'set'} counts.`;
    }
    else verdict = `${sc(best)} in ${one} — ${sc(this.target - best)} short of ${sc(this.target)}. Another go this week still counts.`;
    const earlier = s.thisWeek && s.thisWeek.best > best
      ? `Your best this week is still ${sc(s.thisWeek.best)}.` : '';

    const c = this.contentEl;
    clear(c);
    const save = el('button', { class: 'gv-btn', type: 'button' }, ico('check'), el('span', {}, 'Save'));
    const discard = el('button', { class: 'gv-btn gv-btn-ghost', type: 'button' }, 'Discard');
    save.addEventListener('click', async () => {
      if (save.disabled) return;
      save.disabled = true;
      discard.disabled = true;
      let ok = false;
      try { ok = await this.onSave(sets, this.mode, this.startedAt); } catch (e) { console.error('gym-vault challenge', e); }
      if (ok) { this.close(); return; }
      save.disabled = false;
      discard.disabled = false;
    });
    discard.addEventListener('click', () => this.close());

    c.append(el('div', { class: 'gv-challenge-summary' },
      el('h2', { class: 'gv-kicker' }, this.title),
      el('div', { class: 'gv-challenge-headline' }, sc(best)),
      el('div', { class: 'gv-challenge-sub' }, this.holding ? 'longest hold' : 'best unbroken set'),
      el('p', { class: 'gv-challenge-verdict' }, verdict),
      earlier ? el('p', { class: 'gv-challenge-sub' }, earlier) : '',
      el('div', { class: 'gv-challenge-ladder' }, ...sets.map(n => el('span', { class: `gv-challenge-chip ${n === best ? 'hit' : 'short'}` }, sc(n)))),
      el('div', { class: 'gv-challenge-facts' }, `${sets.length} ${this.holding ? 'hold' : 'set'}${sets.length === 1 ? '' : 's'} · ${sc(total)} total`),
      el('div', { class: 'gv-challenge-actions' }, discard, save)));
    if (goal && best >= goal && !this.muted) sound.cue('goal', 'goal', this.settings);
    save.focus();
  }
}

module.exports = { ChallengeModal };
