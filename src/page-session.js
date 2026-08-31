'use strict';
/* Guided session — a SECOND RENDERER over the same draft src/page-log.js
   edits (ONE DRAFT, TWO VIEWS). Completing a set here writes into the exact
   same draft.entries[i].sets[j] object the overview shows; nothing here ever
   creates draft state of its own, and switching to the overview mid-session
   (via the exit button, or the persistent nav bar) is lossless in both
   directions — Finish still goes through page-log.js's finishSession.

   Navigation position is a pure step machine (session-flow.js); this module
   owns rendering, the embedded tap-counter / hold-timer / weight+distance
   inputs, and the side effects (wake lock, speech, confetti) that go with
   them. Ephemeral UI state (position, phase, per-set counter/timer, mute,
   record/goal tallies) lives on ctx.state.session — a fresh object every
   time guided mode is (re-)entered via ctx.enterGuided(). */

const { Notice } = require('obsidian');
const { el, ico, clear, fmtSeconds, segmented } = require('./dom');
const { todayISO } = require('./dates');
const { setCounts, goalCurrent, goalProgress, sameName } = require('./stats');
const flow = require('./session-flow');
const records = require('./records');
const confetti = require('./confetti');
const { createCounter, tap, undo } = require('./rep-counter');
const { speechAvailable, speak, cancelSpeech, holdWakeLock, attachTapZone } = require('./rep-counter-shared');
const { motionAvailable, startMotionCounter } = require('./motion-source');
const { sensitivityKey } = require('./motion-count');
const { resolveExerciseImages } = require('./page-exercise-detail');
const { buildRows, finishSession } = require('./page-log');
const { nextFrameIndex } = require('./media-cycle');
const { musicButton } = require('./music-picker');
const timedPlan = require('./timed-plan');

const FLASH_MS = 180;
const HOLD_CHECKPOINT_S = 15;
const MEDIA_CYCLE_MS = 1100; // time each frame holds before crossfading to the next
/* Most notes hold a start/finish pair, so 2 was the whole animation. Notes
   sourced from a real photo SEQUENCE (the burpee and the kettlebell front
   squat carry four frames each) animate properly at 4 — and a note with two
   frames is unchanged, because slice() takes what is there. Beyond four the
   cycle outlasts a working set and starts reading as a slideshow. */
const MEDIA_MAX_FRAMES = 4;

function render(ctx, root) {
  const draft = ctx.state.logDraft;
  if (!draft) { ctx.nav('dashboard'); return; }

  if (!ctx.state.session) {
    ctx.state.session = {
      pos: flow.initialPosition(draft),
      phase: 'active',
      pendingPos: null,
      restStartedAt: null,
      muted: false,
      counter: null, counterFor: null,
      /* Motion counting is per-SESSION, not per-render: the toggle must
         survive the re-render that every completed set causes. stopMotion is
         the live subscription's teardown, replaced on each render. */
      motionOn: false, stopMotion: null,
      hold: null, holdFor: null,
      workoutsAtStart: ctx.data.workouts, // snapshot: never includes THIS session's own rows (they aren't saved until Finish)
      metGoals: new Set(),
      recordCount: 0,
      goalCount: 0,
      confettiStop: null,
      completionCelebrated: false,
      mediaCycleTimer: null,
      /* Timed mode only (draft.timed holds the schedule). `index` walks the
         interval list; the clock is kept as a start stamp plus the seconds
         banked before the last pause, so a pause is exact rather than
         drifting by however long the tick happened to be. */
      timed: draft.timed ? {
        index: timedPlan.initialIndex(draft.timed, draft, flow.isHandled),
        startedAt: Date.now(),
        bankedSeconds: 0,
        paused: false,
        spokenAt: null,
        announcedFor: null,
      } : null,
    };
  }
  const sess = ctx.state.session;

  /* The media-cycle timer (guidedImageBlock, below) is deliberately NOT
     ctx.setPageInterval — that single slot belongs to the hold-timer / rest
     stopwatch, and a duration exercise can have both a running hold AND a
     cycling image live at once. Every full render rebuilds the frame DOM
     from scratch (renderActive is called fresh on each position change), so
     any interval from the PREVIOUS render must die here before this render
     creates its own (or none) — otherwise it keeps ticking against detached
     nodes and a second one stacks on top of it next render. */
  if (sess.mediaCycleTimer) { window.clearInterval(sess.mediaCycleTimer); sess.mediaCycleTimer = null; }

  ctx.state.pageCleanup = () => {
    if (sess.wakeLock) { sess.wakeLock.release(); sess.wakeLock = null; }
    if (sess.confettiStop) { sess.confettiStop(); sess.confettiStop = null; }
    if (sess.mediaCycleTimer) { window.clearInterval(sess.mediaCycleTimer); sess.mediaCycleTimer = null; }
    if (sess.stopMotion) { sess.stopMotion(); sess.stopMotion = null; }
    cancelSpeech();
    ctx.state.session = null;
  };
  if (!sess.wakeLock) sess.wakeLock = holdWakeLock();

  /* One wrapping container per render — lets styles.css lay the phase out as
     a flex column (the tap zone flexes to fill whatever's left of the
     viewport) and gives the bottom controls a single, phase-independent
     place to clear Obsidian mobile's floating navbar from, instead of
     chasing every phase's own last element. */
  const page = el('div', { class: 'gv-session-page' });
  root.append(page);

  /* Timed mode is a THIRD renderer over the same draft, not a different
     session: it walks an interval schedule instead of the set-by-set step
     machine, but every completed interval writes into the same
     draft.entries[i].sets[j] object, and Finish is still page-log's. */
  if (draft.timed && sess.timed) { renderTimed(ctx, page, draft, sess); return; }

  if (flow.isDone(draft, sess.pos)) { renderComplete(ctx, page, draft, sess); return; }
  if (sess.phase === 'resting') { renderRest(ctx, page, draft, sess); return; }
  renderActive(ctx, page, draft, sess);
}

/* ---------- shared chrome ---------- */

function progressBar(draft) {
  const { done, total } = flow.progress(draft);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return el('div', { class: 'gv-bar gv-session-bar' }, el('div', { class: 'gv-bar-fill', style: `width:${pct}%` }));
}

function exitButton(ctx) {
  const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Exit to overview' }, ico('x'));
  b.addEventListener('click', () => ctx.nav('log'));
  return b;
}

/* Jump out to change the song (or start a saved playlist), then back — shown
   in BOTH active and resting phases, since music changes happen mostly
   during rest but gating it there would only make it harder to find
   mid-set. The button and its menu live in music-picker.js so the setup
   screen offers exactly the same list. */

function topBar(ctx, draft, extra) {
  return el('div', { class: 'gv-session-top' },
    el('div', { class: 'gv-session-top-row' }, exitButton(ctx), extra || '', musicButton(ctx) || ''),
    progressBar(draft));
}

function resetActiveState(sess) {
  sess.counter = null; sess.counterFor = null;
  sess.hold = null; sess.holdFor = null;
}

function setKey(pos) { return `${pos.entryIndex}:${pos.setIndex}`; }

function findExercise(ctx, name) {
  return ctx.data.exercises.find(e => sameName(e.name, name));
}

/* ---------- active state ---------- */

function renderActive(ctx, root, draft, sess) {
  const cur = flow.currentSet(draft, sess.pos);
  if (!cur) { ctx.rerender(); return; } // isDone should already have caught this
  const { entry, set, entryIndex, setIndex } = cur;

  const skipSetBtn = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Skip this set' }, ico('skip-forward'));
  skipSetBtn.addEventListener('click', () => {
    sess.pos = flow.skipSet(draft, sess.pos);
    resetActiveState(sess);
    ctx.rerender();
  });
  const skipExBtn = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Skip this exercise' }, ico('chevrons-right'));
  skipExBtn.addEventListener('click', () => {
    sess.pos = flow.skipExercise(draft, sess.pos);
    resetActiveState(sess);
    ctx.rerender();
  });

  const ord = el('div', { class: 'gv-session-ord' },
    `Exercise ${entryIndex + 1}/${draft.entries.length} · Set ${setIndex + 1}/${entry.sets.length}`);
  const extra = el('div', { class: 'gv-session-top-extra' }, ord, el('div', { class: 'gv-session-skips' }, skipSetBtn, skipExBtn));

  root.append(topBar(ctx, draft, extra));
  root.append(exerciseBlock(ctx, sess, entry));

  if (entry.distance) root.append(distanceBody(ctx, draft, sess, entry, set));
  else if (entry.duration) root.append(durationBody(ctx, draft, sess, entry, set));
  else if (entry.weighted) root.append(weightedBody(ctx, draft, sess, entry, set));
  else root.append(repsBody(ctx, draft, sess, entry, set));
}

function exerciseBlock(ctx, sess, entry) {
  const ex = findExercise(ctx, entry.exercise);
  const head = el('div', { class: 'gv-session-exhead' },
    el('h2', { class: 'gv-display gv-session-exname' }, entry.exercise),
    entry.target ? el('div', { class: 'gv-session-target' }, entry.target) : '');
  /* Guided view only ever animates a start->finish pair — cap BEFORE error
     handling wires up, so a dropped frame 1 never promotes a frame 3 that
     was never even resolved for this view (the detail page still shows
     everything; this cap is guided-view only). */
  const img = ex ? guidedImageBlock(sess, ex, resolveExerciseImages(ctx, ex).slice(0, MEDIA_MAX_FRAMES)) : null;
  return el('div', { class: 'gv-session-exblock' }, head, img || '');
}

/* One compact media frame with every resolved image stacked absolutely
   inside it, auto-crossfading between them so a start->finish pair reads as
   the movement animating (session-flow.js has no say here — this is pure
   presentation over whatever frames resolved). A single image is static; a
   dead/offline image is dropped from the rotation the moment it errors and
   never gets a chance to flash on screen; once everything has failed the
   whole block disappears, same graceful-degrade rule as page-exercise-
   detail.js's mediaBlock. The interval this starts is registered on `sess`
   (not ctx.setPageInterval — see render()'s comment) and is always cleared
   before a new one is created. */
function guidedImageBlock(sess, ex, frames) {
  if (!frames.length) return null;
  const wrap = el('div', { class: 'gv-session-media' });
  const frame = el('div', { class: 'gv-media-frame gv-session-frame' });
  const imgs = frames.map(({ src, tag }) =>
    el('img', { class: 'gv-session-cycle-img', src, alt: `${ex.name} — ${tag}`, loading: 'lazy' }));
  imgs.forEach(img => frame.append(img));
  wrap.append(frame);

  const failed = new Set();
  let current = 0;
  imgs[0].classList.add('gv-session-cycle-on');

  const showFrame = idx => {
    imgs.forEach((img, i) => img.classList.toggle('gv-session-cycle-on', i === idx));
    current = idx;
  };

  imgs.forEach((img, i) => {
    img.addEventListener('error', () => {
      failed.add(i);
      img.remove();
      if (failed.size >= imgs.length) { // nothing left — vanish quietly, and stop cycling nothing
        wrap.remove();
        if (sess.mediaCycleTimer) { window.clearInterval(sess.mediaCycleTimer); sess.mediaCycleTimer = null; }
        return;
      }
      if (current === i) {
        const next = nextFrameIndex(imgs.length, failed, i);
        if (next !== null) showFrame(next);
      }
      if (imgs.length - failed.size <= 1 && sess.mediaCycleTimer) { // one frame left — static, no need to keep ticking
        window.clearInterval(sess.mediaCycleTimer);
        sess.mediaCycleTimer = null;
      }
    });
  });

  if (imgs.length <= 1) return wrap; // static — no timer, nothing to cycle

  if (confetti.prefersReducedMotion()) {
    /* No auto-cycle, no transition (the CSS drops the opacity transition
       under the same media query) — frame 1 holds until tapped. */
    frame.classList.add('gv-session-frame-tap');
    frame.setAttribute('role', 'button');
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('aria-label', `${ex.name} — tap to see the next position`);
    attachTapZone(frame, () => {
      const next = nextFrameIndex(imgs.length, failed, current);
      if (next !== null) showFrame(next);
    });
    return wrap;
  }

  sess.mediaCycleTimer = window.setInterval(() => {
    const next = nextFrameIndex(imgs.length, failed, current);
    if (next !== null && next !== current) showFrame(next);
  }, MEDIA_CYCLE_MS);

  return wrap;
}

/* The guided view's motion toggle. Unlike the modal's, the ON/OFF state
   lives on `sess` so it survives the re-render that every completed set
   triggers — a counter that switched itself back to tap mode between set 2
   and set 3 would be worse than never offering motion at all. The subscription
   itself is torn down and restarted by that re-render, which is cheap and
   keeps this out of the page-cleanup slot the wake lock owns.

   The click IS the user gesture iOS demands for requestPermission(); nothing
   here may await before startMotionCounter is called. */
/* The exercise note is the home of `motion_sensitivity`, so the picker reads
   from it and writes back to it: a value corrected once during a set is right
   the next time that exercise comes round, in any plan, on any screen. */
function exerciseSensitivity(ctx, name) {
  const ex = findExercise(ctx, name);
  return sensitivityKey(ex && ex.fm ? ex.fm.motion_sensitivity : null);
}

function saveExerciseSensitivity(ctx, name, value) {
  const ex = findExercise(ctx, name);
  if (!ex || !ex.file) return; // a plan line with no note behind it — nothing to write to
  ex.fm.motion_sensitivity = value;
  Promise.resolve(ctx.io.saveExercise(ex)).catch(e => console.error('gym-vault sensitivity', e));
}

function motionButton(ctx, sess, entry, onRep, hintEl, sensEl) {
  const btn = el('button', {
    class: `gv-icon-btn${sess.motionOn ? ' gv-icon-btn-on' : ''}`, type: 'button',
    'aria-pressed': sess.motionOn ? 'true' : 'false',
    'aria-label': motionAvailable()
      ? (sess.motionOn ? 'Stop counting from movement' : 'Count reps from movement')
      : 'No motion sensor on this device',
  }, ico('activity'));
  if (!motionAvailable()) { btn.disabled = true; return btn; }

  const stop = () => {
    if (sess.stopMotion) { sess.stopMotion(); sess.stopMotion = null; }
  };
  let sensitivity = exerciseSensitivity(ctx, entry.exercise);
  const sync = () => {
    btn.classList.toggle('gv-icon-btn-on', !!sess.motionOn);
    btn.setAttribute('aria-pressed', sess.motionOn ? 'true' : 'false');
    btn.setAttribute('aria-label', sess.motionOn ? 'Stop counting from movement' : 'Count reps from movement');
    if (hintEl) hintEl.textContent = sess.motionOn ? 'Counting your movement — taps still work' : '';
    if (!sensEl) return;
    clear(sensEl);
    if (!sess.motionOn) return;
    sensEl.append(segmented(
      [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']],
      sensitivity,
      value => {
        sensitivity = sensitivityKey(value);
        saveExerciseSensitivity(ctx, entry.exercise, sensitivity);
        sync();
        /* Restart rather than retune: the thresholds are baked into the
           detector at creation, and half a set counted each way is a number
           nobody can interpret afterwards. Reps already banked stay. */
        if (!sess.motionOn) return;
        stop();
        if (hintEl) hintEl.textContent = 'Restarting at ' + sensitivity + ' sensitivity…';
        begin();
      },
      { label: 'Sensitivity' },
    ));
  };
  const begin = () => {
    startMotionCounter({
      onRep,
      sensitivity,
      onStatus: status => {
        if (status === 'listening') return;
        sess.motionOn = false;
        stop();
        sync();
        new Notice(status === 'denied'
          ? 'Gym: motion access was declined — counting by tap instead. Enable Motion & Orientation for Obsidian in iOS Settings to use it.'
          : 'Gym: this device has no motion sensor available — counting by tap instead.', 6000);
      },
    }).then(fn => { if (sess.motionOn) sess.stopMotion = fn; else fn(); });
  };

  /* A re-render lands here with motion already ON and no live subscription
     (the previous render's was torn down with its DOM). Pick it back up. */
  if (sess.motionOn && !sess.stopMotion) begin();

  btn.addEventListener('click', () => {
    if (sess.motionOn) { sess.motionOn = false; stop(); sync(); return; }
    sess.motionOn = true;
    sync();
    if (hintEl) hintEl.textContent = 'Asking for the motion sensor…';
    begin();
  });
  return btn;
}

function muteButton(sess, onToggle) {
  const speechOk = speechAvailable();
  const btn = el('button', {
    class: 'gv-icon-btn', type: 'button',
    'aria-label': speechOk ? (sess.muted ? 'Unmute count-back' : 'Mute count-back') : 'Speech not available on this device',
  }, ico(sess.muted ? 'volume-x' : 'volume-2'));
  if (!speechOk) btn.disabled = true;
  btn.addEventListener('click', () => {
    sess.muted = !sess.muted;
    if (sess.muted) cancelSpeech();
    clear(btn);
    btn.append(ico(sess.muted ? 'volume-x' : 'volume-2'));
    btn.setAttribute('aria-label', sess.muted ? 'Unmute count-back' : 'Mute count-back');
    if (onToggle) onToggle();
  });
  return btn;
}

/* Plain reps: an embedded tap zone (same rules as rep-counter-modal.js, via
   rep-counter-shared.js) plus a small control bar. `extraTop` lets
   weightedBody prepend a weight field above the SAME zone/bar instead of
   duplicating the tap-counter markup. */
function repsBody(ctx, draft, sess, entry, set, extraTop) {
  if (!sess.counter || sess.counterFor !== setKey(sess.pos)) {
    sess.counter = createCounter();
    sess.counterFor = setKey(sess.pos);
  }

  /* aria-live: see rep-counter-modal.js's countEl for why speech isn't
     enough on its own. */
  const countEl = el('div', { class: 'gv-rc-count gv-session-count', 'aria-live': 'polite', 'aria-atomic': 'true' }, String(sess.counter.count));
  const zone = el('div', { class: 'gv-rc-zone gv-session-zone', role: 'button', tabindex: '0', 'aria-label': `Tap to count a rep for ${entry.exercise}` }, countEl);

  let flashTimer = null;
  const showRep = () => {
    countEl.textContent = String(sess.counter.count);
    zone.classList.add('gv-rc-flash');
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { zone.classList.remove('gv-rc-flash'); flashTimer = null; }, FLASH_MS);
    if (!sess.muted) speak(sess.counter.count);
  };
  const registerTap = () => {
    const result = tap(sess.counter, Date.now());
    sess.counter = result.state;
    if (!result.counted) return;
    showRep();
  };
  /* Motion-detected reps bypass the tap debounce — motion-count.js runs its
     own refractory window, and stacking the two would drop any rep landing in
     the gap between them. */
  const registerMotionRep = () => { sess.counter = tap(sess.counter, Date.now(), 0).state; showRep(); };
  attachTapZone(zone, registerTap);

  const hintEl = el('div', { class: 'gv-rc-hint', 'aria-live': 'polite' }, sess.motionOn ? 'Counting your movement — taps still work' : '');
  const sensEl = el('div', { class: 'gv-rc-sens' });
  zone.append(hintEl, sensEl);

  const undoBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Undo last rep' },
    ico('minus'), el('span', {}, '1'));
  undoBtn.addEventListener('click', () => { sess.counter = undo(sess.counter); countEl.textContent = String(sess.counter.count); });

  const doneBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Done'));
  doneBtn.addEventListener('click', () => completeSet(ctx, draft, sess, set, entry, { reps: String(sess.counter.count) }));

  const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' },
    motionButton(ctx, sess, entry, registerMotionRep, hintEl, sensEl), muteButton(sess), undoBtn, doneBtn);
  return el('div', { class: 'gv-session-body' }, extraTop || '', zone, bar);
}

function lastWeightForExercise(ctx, name) {
  for (let i = ctx.data.workouts.length - 1; i >= 0; i--) {
    const rows = ctx.data.workouts[i].rows || [];
    for (let j = rows.length - 1; j >= 0; j--) {
      const r = rows[j];
      if (!sameName(r.exercise, name)) continue;
      const wt = String(r.weight_kg ?? '').trim();
      if (wt) return wt;
    }
  }
  return null;
}

function weightedBody(ctx, draft, sess, entry, set) {
  if (String(set.weight_kg ?? '').trim() === '') {
    const last = lastWeightForExercise(ctx, entry.exercise);
    if (last !== null) set.weight_kg = last; // prefill only — not touched, same as a plan-target prefill
  }
  const weightInput = el('input', {
    class: 'gv-set-input gv-session-weight', type: 'number', inputmode: 'decimal', placeholder: 'kg', value: set.weight_kg ?? '',
    'aria-label': `Weight in kilograms — ${entry.exercise}`,
  });
  weightInput.addEventListener('input', () => { set.weight_kg = weightInput.value; set.touched = true; });
  const weightRow = el('div', { class: 'gv-session-weightrow' }, weightInput, el('span', { class: 'gv-set-unit' }, 'kg'));
  return repsBody(ctx, draft, sess, entry, set, weightRow);
}

/* Duration/holds: tap to start, tap to stop — stop IS the completion action
   (it records the elapsed seconds and advances), no separate Done button. */
function durationBody(ctx, draft, sess, entry, set) {
  if (!sess.hold || sess.holdFor !== setKey(sess.pos)) {
    const prefilled = parseFloat(set.seconds);
    sess.hold = { running: false, startedAt: null, frozenSeconds: Number.isFinite(prefilled) ? prefilled : 0, lastAnnounced: -1, lastLiveAnnounced: -1 };
    sess.holdFor = setKey(sess.pos);
  }
  const hold = sess.hold;

  const countEl = el('div', { class: 'gv-rc-count gv-session-count' }, fmtSeconds(hold.frozenSeconds || 0));
  const zone = el('div', {
    class: 'gv-rc-zone gv-session-zone', role: 'button', tabindex: '0',
    'aria-label': hold.running ? 'Tap to stop the hold' : 'Tap to start the hold',
  }, countEl);
  /* countEl above ticks every second (below) — an aria-live region there
     would read out every single second, which is noise, not help. This is
     a SEPARATE, visually-hidden region that only gets new text at the same
     15s checkpoints speak() already announces, so a screen-reader user gets
     the same cadence a hearing/sighted+speech user does, independent of
     whether count-back speech is muted (aria-live is not a substitute for
     THIS app's own speech, and must not be gated by the app's own mute
     toggle — a screen-reader user isn't necessarily using it). Needs
     .gv-sr-only (visually-hidden-but-AT-visible) in styles.css. */
  const checkpointEl = el('div', { class: 'gv-sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });

  const currentSeconds = () => (hold.running ? Math.max(0, (Date.now() - hold.startedAt) / 1000) : hold.frozenSeconds);

  const startStop = () => {
    if (!hold.running) {
      hold.running = true;
      hold.startedAt = Date.now();
      zone.setAttribute('aria-label', 'Tap to stop the hold');
      zone.classList.add('gv-session-zone-live');
    } else {
      const secs = Math.round(currentSeconds());
      hold.running = false;
      hold.frozenSeconds = secs;
      completeSet(ctx, draft, sess, set, entry, { seconds: String(secs) });
    }
  };
  attachTapZone(zone, startStop);

  ctx.setPageInterval(() => {
    if (!hold.running) return;
    const secs = currentSeconds();
    countEl.textContent = fmtSeconds(secs);
    const whole = Math.floor(secs);
    const atCheckpoint = whole > 0 && whole % HOLD_CHECKPOINT_S === 0;
    if (atCheckpoint && whole !== hold.lastLiveAnnounced) {
      hold.lastLiveAnnounced = whole;
      checkpointEl.textContent = `${fmtSeconds(whole)} held`;
    }
    if (atCheckpoint && whole !== hold.lastAnnounced && !sess.muted) {
      hold.lastAnnounced = whole;
      speak(whole);
    }
  }, 1000);

  const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' }, muteButton(sess));
  return el('div', { class: 'gv-session-body' }, zone, checkpointEl, bar);
}

function lastRunForExercise(ctx, name) {
  for (let i = ctx.data.workouts.length - 1; i >= 0; i--) {
    const rows = ctx.data.workouts[i].rows || [];
    for (let j = rows.length - 1; j >= 0; j--) {
      const r = rows[j];
      if (!sameName(r.exercise, name)) continue;
      if (String(r.distance_km ?? '').trim() === '') continue;
      const secs = parseFloat(r.seconds);
      return {
        distance_km: String(r.distance_km).trim(),
        minutes: Number.isFinite(secs) ? String(Math.round((secs / 60) * 10) / 10) : '',
      };
    }
  }
  return null;
}

function distanceBody(ctx, draft, sess, entry, set) {
  if (String(set.distance_km ?? '').trim() === '' && String(set.minutes ?? '').trim() === '') {
    const last = lastRunForExercise(ctx, entry.exercise);
    if (last) { set.distance_km = last.distance_km; set.minutes = last.minutes; }
  }
  const kmInput = el('input', {
    class: 'gv-set-input gv-session-distance', type: 'number', inputmode: 'decimal', placeholder: 'km', value: set.distance_km ?? '',
    'aria-label': `Distance in kilometres — ${entry.exercise}`,
  });
  kmInput.addEventListener('input', () => { set.distance_km = kmInput.value; set.touched = true; });
  const minInput = el('input', {
    class: 'gv-set-input gv-session-distance', type: 'number', inputmode: 'decimal', placeholder: 'min', value: set.minutes ?? '',
    'aria-label': `Minutes — ${entry.exercise}`,
  });
  minInput.addEventListener('input', () => { set.minutes = minInput.value; set.touched = true; });

  const row = el('div', { class: 'gv-session-runrow' },
    el('div', { class: 'gv-session-runfield' }, kmInput, el('span', { class: 'gv-set-unit' }, 'km')),
    el('div', { class: 'gv-session-runfield' }, minInput, el('span', { class: 'gv-set-unit' }, 'min')));

  const doneBtn = el('button', { class: 'gv-btn gv-session-donebtn', type: 'button' }, ico('check'), el('span', {}, 'Log run'));
  doneBtn.addEventListener('click', () => completeSet(ctx, draft, sess, set, entry, {}));

  return el('div', { class: 'gv-session-body gv-session-body-plain' }, row, doneBtn);
}

/* ---------- completing a set: write, celebrate, transition ---------- */

function classifyKind(entry) {
  if (entry.distance) return null; // no record concept for runs (v1)
  if (entry.duration) return 'seconds';
  if (entry.weighted) return 'weight';
  return 'reps';
}

function valueForKind(set, kind) {
  if (kind === 'seconds') return set.seconds;
  if (kind === 'weight') return set.weight_kg;
  if (kind === 'reps') return set.reps;
  return null;
}

function describeRecord(kind, val, prev) {
  if (kind === 'reps') return `${val} reps (was ${prev})`;
  if (kind === 'weight') return `${val} kg (was ${prev} kg)`;
  if (kind === 'seconds') return `${fmtSeconds(val)} hold (was ${fmtSeconds(prev)})`;
  return '';
}

/* Newly-met goals since the session started: compares the goal's progress
   using ONLY history from before this session (sess.workoutsAtStart) against
   history PLUS everything completed in this draft so far — a synthetic,
   never-saved workout built with the exact same row rule finishSession uses
   (page-log.js's buildRows), so "would this session, saved right now, meet
   the goal" can never disagree with what Finish actually saves. */
function checkGoalReached(ctx, sess, draft) {
  const hits = [];
  if (!ctx.data.goals || !ctx.data.goals.length) return hits;
  const today = todayISO();
  const syntheticWorkout = { fm: { date: draft.date, day: draft.day }, rows: buildRows(draft) };
  const before = { workouts: sess.workoutsAtStart, body: ctx.data.body, weekStart: ctx.settings.weekStart, today };
  const after = { workouts: sess.workoutsAtStart.concat([syntheticWorkout]), body: ctx.data.body, weekStart: ctx.settings.weekStart, today };
  for (const g of ctx.data.goals) {
    if (sess.metGoals.has(g.name)) continue;
    const wasMet = goalProgress(g, goalCurrent(g, before)) === 1;
    const nowMet = goalProgress(g, goalCurrent(g, after)) === 1;
    if (!wasMet && nowMet) { sess.metGoals.add(g.name); hits.push(g); }
  }
  return hits;
}

function celebrate(ctx, sess, spokenWords) {
  try {
    if (sess.confettiStop) sess.confettiStop();
    const host = ctx.view && ctx.view.contentEl;
    sess.confettiStop = confetti.burst(host);
    if (!sess.muted && spokenWords) speak(spokenWords);
  } catch (e) { console.error('gym-vault celebrate', e); }
}

/* Write the figures into the set, then work out whether that just broke a
   record or met a goal. Shared by both guided renderers — the set-by-set one
   below and the timed one — so "what counts as a record" can never come to
   mean two different things depending on which screen you were looking at.
   Returns the callout lines to show on the way to the next thing.

   `opts.measured` says whether the figures are OBSERVED or merely PREFILLED.
   The set-by-set screen always observes: a rep count came off the tap
   counter, a hold came off the stopwatch. A timed interval observes the
   clock, but a rep or weight figure it did not watch you produce is the
   plan's target sitting in the box — and celebrating a "new best" for a
   number nobody measured is exactly the kind of wrong figure this codebase
   keeps having to dig out. So a timed interval passes measured:false for
   reps and weight, and those records are simply not claimed unless the user
   typed the figure themselves. */
function applyCompletion(ctx, draft, sess, set, entry, values, opts) {
  const measured = !opts || opts.measured !== false;
  const typedByUser = !!set.touched;

  Object.assign(set, values);
  set.done = true;
  set.touched = true;

  const callouts = [];
  try {
    const kind = classifyKind(entry);
    /* seconds are always measured — the clock genuinely ran that long. */
    const trustworthy = measured || kind === 'seconds' || typedByUser;
    if (kind && trustworthy) {
      const prev = records.previousBest(sess.workoutsAtStart, entry.exercise, kind);
      const val = valueForKind(set, kind);
      if (records.isRecord(prev, val)) {
        sess.recordCount++;
        callouts.push(`NEW BEST · ${describeRecord(kind, val, prev)}`);
        celebrate(ctx, sess, 'new record');
      }
    }
  } catch (e) { console.error('gym-vault records', e); }

  try {
    for (const g of checkGoalReached(ctx, sess, draft)) {
      sess.goalCount++;
      callouts.push(`GOAL HIT · ${g.name}`);
      celebrate(ctx, sess, 'goal met');
    }
  } catch (e) { console.error('gym-vault goals', e); }

  return callouts;
}

function completeSet(ctx, draft, sess, set, entry, values) {
  const callouts = applyCompletion(ctx, draft, sess, set, entry, values);

  const peek = flow.advance(draft, sess.pos);
  resetActiveState(sess);
  if (flow.isDone(draft, peek)) {
    sess.pos = peek;
    sess.phase = 'active';
    sess.pendingPos = null;
  } else {
    sess.pendingPos = peek;
    sess.phase = 'resting';
    sess.restStartedAt = Date.now();
    sess.pendingCallouts = callouts;
  }
  ctx.rerender();
}

/* ---------- rest state ---------- */

function renderRest(ctx, root, draft, sess) {
  const nextInfo = flow.currentSet(draft, sess.pendingPos);

  const elapsedEl = el('div', { class: 'gv-session-rest-clock' }, '0:00');
  ctx.setPageInterval(() => {
    const secs = Math.max(0, Math.round((Date.now() - sess.restStartedAt) / 1000));
    elapsedEl.textContent = fmtSeconds(secs);
  }, 1000);

  const nextLabel = nextInfo
    ? el('div', { class: 'gv-session-rest-next' },
        el('span', { class: 'gv-kicker' }, 'Next'),
        el('div', { class: 'gv-session-rest-nextname' }, nextInfo.entry.exercise),
        el('div', { class: 'gv-session-rest-nextset' }, `Set ${nextInfo.setIndex + 1}/${nextInfo.entry.sets.length}`))
    : '';

  const callouts = (sess.pendingCallouts || []).length
    ? el('div', { class: 'gv-session-callouts' }, ...(sess.pendingCallouts || []).map(line => el('div', { class: 'gv-session-callout' }, line)))
    : '';

  const nextBtn = el('button', { class: 'gv-btn-go', type: 'button' }, 'Next');
  nextBtn.addEventListener('click', () => {
    sess.pos = sess.pendingPos;
    sess.pendingPos = null;
    sess.pendingCallouts = [];
    sess.phase = 'active';
    sess.restStartedAt = null;
    resetActiveState(sess);
    ctx.rerender();
  });

  root.append(topBar(ctx, draft, null));
  root.append(el('div', { class: 'gv-session-rest' },
    /* The rest phase is a whole route with no other title — a heading here
       is what tells a screen-reader user the session moved on, and what
       ctx.nav's focus-move needs to find. */
    el('h2', { class: 'gv-kicker gv-session-rest-title' }, 'Rest'),
    el('div', { class: 'gv-session-rest-clock-wrap' }, ico('timer'), elapsedEl),
    callouts,
    nextLabel,
    el('div', { class: 'gv-hero-action gv-session-nextwrap' }, nextBtn),
    el('p', { class: 'gv-microcopy' }, "Rest, don't scroll.")));
}

/* ---------- timed mode ---------- */

/* Faster than once a second so the ring sweeps rather than jerks; the spoken
   count-in and the digits are both gated on whole seconds regardless, so the
   extra ticks cost nothing but a little arithmetic. */
const TICK_MS = 200;
/* "3, 2, 1" over the last three seconds of every interval. */
const COUNT_IN_FROM = 3;

/* Elapsed is derived from a start stamp plus whatever was banked before the
   last pause, never accumulated tick by tick: a counter incremented on a
   200ms timer drifts, and iOS throttles background timers hard enough that
   the drift is visible within one session. */
function timedElapsed(tp) {
  if (tp.paused) return tp.bankedSeconds;
  return tp.bankedSeconds + Math.max(0, (Date.now() - tp.startedAt) / 1000);
}

function startInterval(sess, index) {
  const tp = sess.timed;
  tp.index = index;
  tp.startedAt = Date.now();
  tp.bankedSeconds = 0;
  tp.paused = false;
  tp.spokenAt = null;
  tp.announcedFor = null;
}

/* A countdown ring. Decorative on purpose (aria-hidden): the seconds
   themselves are in a real element beside it, and a screen reader gets the
   meaningful moments from the live region in renderTimedInterval rather than
   a per-tick stream of numbers. Built with createElementNS — no innerHTML,
   same rule as dom.js. */
function countdownRing(size) {
  const NS = 'http://www.w3.org/2000/svg';
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'gv-count-ring');
  svg.setAttribute('aria-hidden', 'true');
  const arc = cls => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', size / 2); c.setAttribute('cy', size / 2); c.setAttribute('r', r);
    c.setAttribute('class', cls);
    svg.appendChild(c);
    return c;
  };
  arc('gv-count-ring-track');
  const fill = arc('gv-count-ring-fill');
  fill.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  return {
    svg,
    set(p) {
      const clamped = Math.max(0, Math.min(1, p || 0));
      fill.setAttribute('stroke-dasharray', `${(circumference * clamped).toFixed(2)} ${circumference.toFixed(2)}`);
    },
  };
}

/* What gets said out loud as an interval opens. A transition already names
   what is coming, so the work interval that follows it stays quiet — being
   told "Push-ups" twice in ten seconds is noise. With transitions switched
   off there is no such announcement, so the work interval makes it itself. */
function announcementFor(schedule, index) {
  const iv = schedule.intervals[index];
  if (!iv) return null;
  if (iv.kind === 'transition') return iv.leadIn ? `Starting with ${iv.exercise}` : `Next, ${iv.exercise}`;
  if (iv.kind === 'work') {
    const prev = schedule.intervals[index - 1];
    return prev && prev.kind === 'transition' ? null : iv.exercise;
  }
  return iv.exercise;
}

function renderTimed(ctx, root, draft, sess) {
  const schedule = draft.timed;
  const intervals = (schedule && schedule.intervals) || [];
  const tp = sess.timed;
  if (!intervals.length || tp.index >= intervals.length) { renderComplete(ctx, root, draft, sess); return; }
  renderTimedInterval(ctx, root, draft, sess, intervals[tp.index]);
}

/* Move on. `opts.skip` leaves the set untouched and unticked — exactly what
   skipping a set means everywhere else in this app (see session-flow.js), so
   a skipped interval still counts only as a plan-target prefill.

   `tp.completed` guards the write: stepping BACK and forward again must not
   claim the same record twice. Back is position-only by design — it never
   un-ticks a set, because silently undoing logged work to let you re-watch
   an exercise is a worse surprise than the position moving. */
function advanceTimed(ctx, draft, sess, opts) {
  const tp = sess.timed;
  const iv = draft.timed.intervals[tp.index];
  const skip = !!(opts && opts.skip);

  if (iv && iv.kind === 'work' && !skip) {
    if (!tp.completed) tp.completed = {};
    if (!tp.completed[tp.index]) {
      tp.completed[tp.index] = true;
      const entry = draft.entries[iv.entryIndex];
      const set = entry && entry.sets && entry.sets[iv.setIndex];
      if (entry && set) {
        /* The clock is the one figure this screen actually measured, so it is
           the one it writes. Reps and weight keep whatever is in their boxes —
           the plan's target, or what the user typed over it — and
           applyCompletion's measured:false stops an untyped target being
           celebrated as a personal best.

           A run is the exception, and it has to be: page-log's buildRows
           takes a distance entry's time from `minutes` and ignores `seconds`
           entirely, so writing seconds here would tick the set done and then
           save a row with no distance AND no time — a junk row that counts
           towards the session tally and says nothing. */
        const measured = entry.distance
          ? { minutes: String(Math.round((iv.seconds / 60) * 10) / 10) }
          : { seconds: String(Math.round(iv.seconds)) };
        sess.pendingCallouts = applyCompletion(ctx, draft, sess, set, entry, measured, { measured: false });
      }
    }
  }

  cancelSpeech();
  startInterval(sess, tp.index + 1);
  ctx.rerender();
}

function stepBack(ctx, sess) {
  cancelSpeech();
  startInterval(sess, Math.max(0, sess.timed.index - 1));
  ctx.rerender();
}

function timedTopBar(ctx, draft, sess, schedule, iv) {
  const tp = sess.timed;
  const workDone = schedule.intervals.slice(0, tp.index + 1).filter(i => i.kind === 'work').length;
  const workTotal = timedPlan.workIntervals(schedule).length;
  const label = iv.kind === 'work'
    ? `Interval ${workDone}/${workTotal}${iv.round != null ? ` · Round ${iv.round + 1}` : ''}`
    : iv.kind === 'transition' ? (iv.leadIn ? 'Get ready' : 'Next up')
      : iv.kind === 'warmup' ? 'Warm-up' : 'Cool-down';

  const ord = el('div', { class: 'gv-session-ord' }, label);
  const bar = el('div', { class: 'gv-bar gv-session-bar' }, el('div', { class: 'gv-bar-fill gv-timed-bar-fill' }));
  return {
    node: el('div', { class: 'gv-session-top' },
      el('div', { class: 'gv-session-top-row' },
        exitButton(ctx),
        el('div', { class: 'gv-session-top-extra' }, ord),
        musicButton(ctx) || ''),
      bar),
    fill: bar.firstChild,
  };
}

function renderTimedInterval(ctx, root, draft, sess, iv) {
  const schedule = draft.timed;
  const tp = sess.timed;
  const isWork = iv.kind === 'work';
  const entry = isWork ? draft.entries[iv.entryIndex] : null;
  const set = entry && entry.sets ? entry.sets[iv.setIndex] : null;

  const top = timedTopBar(ctx, draft, sess, schedule, iv);
  root.append(top.node);

  const body = el('div', { class: `gv-session-body gv-timed gv-timed-${iv.kind}` });

  /* The exercise block is the same one the set-by-set screen uses, so the
     demonstration media animates here too. A warm-up or transition has no
     draft entry — it passes the interval's own name and target instead,
     which is all exerciseBlock reads. */
  root.append(exerciseBlock(ctx, sess, entry || { exercise: iv.exercise, target: iv.target || '' }));

  const ring = countdownRing(200);
  const digits = el('div', { class: 'gv-timed-count' }, String(Math.ceil(iv.seconds)));
  /* Announced at the START of the interval and again over the count-in, not
     every second: a live region that fires once a second is noise, not help
     (same rule as the hold timer's checkpoint region above). */
  const live = el('div', { class: 'gv-sr-only', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  const dial = el('div', { class: 'gv-timed-dial' }, ring.svg, digits);
  body.append(dial);

  /* Rep and weight boxes for a work interval that has them. A timer cannot
     count your push-ups, so the plan's target sits in the box as a starting
     point and this is where you correct it — typing marks the set touched,
     which is also what makes a personal best claimable (see
     applyCompletion). */
  if (isWork && set && !entry.duration) {
    body.append(timedFigures(ctx, entry, set, iv));
  } else if (iv.target) {
    body.append(el('div', { class: 'gv-timed-target' }, iv.target));
  }

  const backBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Previous interval' }, ico('skip-back'));
  backBtn.addEventListener('click', () => stepBack(ctx, sess));

  const playBtn = el('button', {
    class: 'gv-timed-play', type: 'button',
    'aria-label': tp.paused ? 'Resume' : 'Pause',
  }, ico(tp.paused ? 'play' : 'pause'));
  playBtn.addEventListener('click', () => {
    if (tp.paused) { tp.startedAt = Date.now(); tp.paused = false; }
    else { tp.bankedSeconds = timedElapsed(tp); tp.paused = true; cancelSpeech(); }
    ctx.rerender();
  });

  const skipBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': isWork ? 'Skip this interval' : 'Skip ahead' }, ico('skip-forward'));
  skipBtn.addEventListener('click', () => advanceTimed(ctx, draft, sess, { skip: true }));

  body.append(el('div', { class: 'gv-timed-controls' }, backBtn, playBtn, skipBtn));
  body.append(el('div', { class: 'gv-rc-bar gv-session-rcbar' }, muteButton(sess)));

  const callouts = (sess.pendingCallouts || []).length
    ? el('div', { class: 'gv-session-callouts' }, ...(sess.pendingCallouts || []).map(line => el('div', { class: 'gv-session-callout' }, line)))
    : '';
  if (callouts) { body.append(callouts); }

  root.append(body, live);

  /* Announce once per interval, not once per render — a mute toggle or a
     typed rep re-renders this screen and must not re-announce. */
  if (tp.announcedFor !== tp.index) {
    tp.announcedFor = tp.index;
    const words = announcementFor(schedule, tp.index);
    if (words) {
      live.textContent = `${words}, ${Math.round(iv.seconds)} seconds`;
      if (!sess.muted) speak(words);
    } else {
      live.textContent = `${iv.exercise}, ${Math.round(iv.seconds)} seconds`;
    }
    sess.pendingCallouts = [];
  }

  const totalBefore = schedule.intervals.slice(0, tp.index).reduce((n, i) => n + i.seconds, 0);
  const tick = () => {
    const elapsed = timedElapsed(tp);
    const remaining = Math.max(0, iv.seconds - elapsed);
    digits.textContent = String(Math.ceil(remaining));
    ring.set(iv.seconds ? remaining / iv.seconds : 0);
    if (schedule.totalSeconds) {
      top.fill.style.width = `${Math.min(100, ((totalBefore + elapsed) / schedule.totalSeconds) * 100).toFixed(1)}%`;
    }

    if (tp.paused) return;

    /* "3, 2, 1" into the next thing. Math.ceil means 3 is spoken as the
       display flips to 3, which is where a human expects to hear it. */
    const whole = Math.ceil(remaining);
    if (whole >= 1 && whole <= COUNT_IN_FROM && whole !== tp.spokenAt) {
      tp.spokenAt = whole;
      live.textContent = String(whole);
      if (!sess.muted) speak(whole);
    }

    if (remaining <= 0) advanceTimed(ctx, draft, sess);
  };
  tick();
  ctx.setPageInterval(tick, TICK_MS);
}

/* The reps (and weight) boxes shown during a timed work interval. Deliberately
   small and off to the side: the countdown is what you are looking at, and
   this is only there for the moment you notice you managed twelve rather than
   the fifteen the plan asked for. */
function timedFigures(ctx, entry, set, iv) {
  const row = el('div', { class: 'gv-timed-figures' });

  if (entry.weighted && String(set.weight_kg ?? '').trim() === '') {
    const last = lastWeightForExercise(ctx, entry.exercise);
    if (last !== null) set.weight_kg = last; // prefill only — not touched, same as a plan-target prefill
  }

  const field = (key, placeholder, unit, label) => {
    const input = el('input', {
      class: 'gv-set-input gv-timed-input', type: 'number', inputmode: 'decimal',
      placeholder, value: set[key] ?? '',
      'aria-label': `${label} — ${entry.exercise}`,
    });
    input.addEventListener('input', () => { set[key] = input.value; set.touched = true; });
    return el('div', { class: 'gv-timed-field' }, input, el('span', { class: 'gv-set-unit' }, unit));
  };

  /* A run logs the distance you covered; the clock supplies the time on its
     own when the interval ends, so there is no minutes box here. */
  if (entry.distance) {
    row.append(field('distance_km', 'km', 'km', 'Distance in kilometres'));
  } else {
    row.append(field('reps', 'reps', '×', 'Reps'));
    if (entry.weighted) row.append(field('weight_kg', 'kg', 'kg', 'Weight in kilograms'));
  }
  if (iv.target) row.append(el('div', { class: 'gv-timed-target' }, `target ${iv.target}`));
  return row;
}

/* ---------- completion state ---------- */

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

function renderComplete(ctx, root, draft, sess) {
  const totalMin = Math.max(0, Math.round((Date.now() - draft.startedAt) / 60000));
  let doneSets = 0;
  for (const entry of draft.entries) for (const set of entry.sets) if (setCounts(set)) doneSets++;

  const wins = [];
  if (sess.recordCount) wins.push(`${sess.recordCount} record${sess.recordCount === 1 ? '' : 's'} broken`);
  if (sess.goalCount) wins.push(`${sess.goalCount} goal${sess.goalCount === 1 ? '' : 's'} hit`);

  /* Celebration stays scarce on purpose (editorial register) — an ordinary
     session finishing is calm, never a confetti burst; fires once even if
     this screen re-renders (e.g. a mute toggle elsewhere) while it's up. */
  if (wins.length && !sess.completionCelebrated) {
    sess.completionCelebrated = true;
    celebrate(ctx, sess, null);
  }

  root.append(el('div', { class: 'gv-session-complete' },
    el('div', { class: 'gv-session-complete-ico' }, ico('trophy')),
    el('h2', { class: 'gv-display gv-session-complete-title' }, 'Session done'),
    wins.length ? el('div', { class: 'gv-session-wins' }, wins.join(' · ')) : '',
    el('div', { class: 'gv-tiles gv-session-complete-tiles' },
      tile(ico('check'), String(doneSets), 'sets done'),
      tile(ico('timer'), `${totalMin} min`, 'elapsed')),
    el('div', { class: 'gv-hero-action gv-session-nextwrap' },
      el('button', { class: 'gv-btn-go', type: 'button', onclick: () => finishSession(ctx, draft) }, 'Finish & save')),
    el('button', { class: 'gv-btn gv-btn-ghost gv-session-review', type: 'button', onclick: () => ctx.nav('log') },
      ico('list'), el('span', {}, 'Review in log')),
    el('p', { class: 'gv-microcopy' }, 'No zero days.')));
}

module.exports = { render };
