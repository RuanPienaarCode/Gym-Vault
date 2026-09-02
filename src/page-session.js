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
const { holdWakeLock, attachTapZone, attachCountIn, attachFillMeter, attachPowerUp, punch, typeCountButton } = require('./rep-counter-shared');
const counterTarget = require('./counter-target');
const { helpButton } = require('./explainer');
const { counterSettingsButton } = require('./counter-settings');
const sound = require('./sound');
const countdown = require('./countdown');
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
      /* [{key, exercise, kind, val, prev}] — every best broken this session,
         with what it beat.

         sess.records IS the count — there is no separate recordCount. There
         was, and it incremented on every record INCLUDING beating the same
         best twice in one session, which sess.records deliberately collapses
         into one row. Two figures derived by different rules, in the same
         object, three lines apart. */
      records: [],
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
    if (sess.stopCountIn) { sess.stopCountIn(); sess.stopCountIn = null; }
    if (sess.stopMotion) { sess.stopMotion(); sess.stopMotion = null; }
    sound.cancel();
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
  /* countedIn is NOT cleared here. It is keyed by position, and every caller
     of this function is moving to a DIFFERENT position — so the key stops
     matching on its own, and the next set counts in. Clearing it as well
     would be harmless today and wrong the first time something resets state
     without moving. */
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

  /* The count-in is NOT a screen of its own any more — it happens inside the
     counter (see repsBody / durationBody, via attachCountIn). What used to be
     here was a full-bleed ring that replaced the whole body, counted down,
     and only then revealed the thing you were about to use. */
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

/* Mute is "silence right now", for this session only — a different thing
   from ctx.settings.soundMode, which is "when this app does speak, how". So
   the button is disabled rather than hidden when the MODE is already silent:
   there is nothing to mute, and a live-looking control that does nothing is
   worse than a visibly inert one. */
function muteButton(ctx, sess, onToggle) {
  const canHear = sound.audible(ctx.settings);
  const btn = el('button', {
    class: 'gv-icon-btn', type: 'button',
    'aria-label': canHear ? (sess.muted ? 'Unmute count-back' : 'Mute count-back') : 'Count-back is off in settings',
  }, ico(sess.muted ? 'volume-x' : 'volume-2'));
  if (!canHear) btn.disabled = true;
  btn.addEventListener('click', () => {
    sess.muted = !sess.muted;
    if (sess.muted) sound.cancel();
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

  /* The plan already said what this set is for, so nothing has to be asked:
     "4 x 12" fills towards 12. An open-ended line ("submax") gets no meter
     at all rather than an empty one that never fills. */
  const target = counterTarget.targetFromEntry(entry);
  const meter = attachFillMeter(zone, target);
  /* The detonation the meter charges towards — only exists when the meter
     does, and fires once via markHit's own guard. */
  const powerUp = meter ? attachPowerUp(zone, 'Reps reached') : null;
  /* "TARGET 15 REPS", not "of 15 reps". The label sits under a giant
     numeral, and a fragment starting with "of" reads as the tail of a
     sentence whose head is a digit — fine in prose, wrong as a standalone
     line you glance at mid-set. Naming the thing is shorter AND clearer. */
  const targetEl = target
    ? el('div', { class: 'gv-rc-target' }, `Target ${counterTarget.describeTarget(target)}`)
    : '';

  let flashTimer = null;
  /* Fires once, when the target is first met — not on every rep past it.
     Beating your own target is the moment worth marking; the eight reps
     after it are not eight more moments. */
  const markHit = () => {
    if (sess.targetHitFor === setKey(sess.pos)) return;
    sess.targetHitFor = setKey(sess.pos);
    if (powerUp) powerUp.fire();
    if (!sess.muted) sound.cue('go', 'target', ctx.settings);
  };
  const showRep = () => {
    countEl.textContent = String(sess.counter.count);
    punch(countEl, sess.counter.count);
    zone.classList.add('gv-rc-flash');
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { zone.classList.remove('gv-rc-flash'); flashTimer = null; }, FLASH_MS);
    if (meter && meter.set(sess.counter.count) === 'done') markHit();
    if (!sess.muted) sound.announce(sess.counter.count, ctx.settings);
  };
  /* THE TAP THAT SAYS "READY" IS NOT REP ONE. While the count-in is running
     a tap skips it; only once armed does a tap count. Without this the
     gesture that dismisses the countdown lands as the first rep and every
     set starts one ahead. */
  const registerTap = () => {
    if (countIn && !countIn.armed()) { countIn.skip(); return; }
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
  zone.append(targetEl, hintEl, sensEl);

  /* Count in, in the counter's own display. Keyed by POSITION so the screen
     can re-render for any of the reasons it does — a mute toggle, motion
     switched on, a typed weight — without restarting the count. Any
     sequencer still running from a previous render of this same set is torn
     down first, or two of them speak over each other and the earlier one
     arms the counter behind the later. */
  const countInKey = setKey(sess.pos);
  let countIn = null;
  if (sess.countedIn !== countInKey) {
    if (sess.stopCountIn) { sess.stopCountIn(); sess.stopCountIn = null; }
    countIn = attachCountIn(zone, countEl, {
      muted: sess.muted,
      settings: ctx.settings,
      hintEl,
      hint: sess.motionOn ? 'Counting your movement — taps still work' : '',
      onDone: () => {
        sess.countedIn = countInKey;
        countEl.textContent = String(sess.counter.count);
      },
    });
    sess.stopCountIn = countIn.stop;
  } else {
    sess.stopCountIn = null;
  }
  /* Catches up a counter that already has reps on it — resuming a set, or a
     re-render after a typed count — so the bar is never behind the number
     above it. */
  if (meter) meter.set(sess.counter.count);

  const undoBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Undo last rep' },
    ico('minus'), el('span', {}, '1'));
  undoBtn.addEventListener('click', () => {
    sess.counter = undo(sess.counter);
    countEl.textContent = String(sess.counter.count);
    if (meter) meter.set(sess.counter.count);
  });

  /* Typed counts are for the sets the sensor and the taps both missed — a
     machine you cannot put the phone on, a set you counted in your head.
     lastTapAt is carried through unchanged so typing does not open a fresh
     debounce window that eats the next real tap, which is the same reason
     undo() leaves it alone. */
  const typeBtn = typeCountButton(countEl, {
    label: `Reps for ${entry.exercise}`,
    get: () => sess.counter.count,
    set: n => {
      sess.counter = { count: n, lastTapAt: sess.counter.lastTapAt };
      if (meter) meter.set(n);
    },
  });

  const doneBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Done'));
  doneBtn.addEventListener('click', () => completeSet(ctx, draft, sess, set, entry, { reps: String(sess.counter.count) }));

  /* SIX BUTTONS BECAME FOUR. Motion, Type and the explainer are decisions
     made once, at the start of a set — they sat at thumb height for the
     whole set next to the two that are used mid-rep, and a row of six
     identical buttons makes the eye read all of them every time it comes
     back from the number. What stays is what you reach for without looking
     up: mute, undo, done. */
  const motionBtn = motionButton(ctx, sess, entry, registerMotionRep, hintEl, sensEl);
  const helpBtn = helpButton(() => body);
  const settingsBtn = counterSettingsButton(() => body, () => [
    { label: 'Motion counting', hint: 'Let the phone count the movement itself', node: motionBtn },
    { label: 'Type the count', hint: 'For the reps the taps and the sensor both missed', node: typeBtn, closeOnUse: true },
    { label: 'How this counts', hint: 'Tapping, tilting and sensitivity', node: helpBtn, closeOnUse: true },
  ]);

  const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' },
    settingsBtn, muteButton(ctx, sess), undoBtn, doneBtn);
  /* Both sheets host on the BODY, not the zone: they have to cover the
     controls as well, or the button stays visible under its own panel. */
  const body = el('div', { class: 'gv-session-body gv-xp-host' }, extraTop || '', zone, bar);
  focusMode(ctx);
  return body;
}

/* FOCUS MODE. The brand bar and the tab strip are ~116px of chrome that
   nothing inside a set uses, and on a phone they push the counter down far
   enough that the number and the Done button compete for the same thumb.
   Adding the class here rather than in the controller keeps the decision
   with the screens that actually count something; ctx.rerender clears it at
   the top of every render, so it can never outlive the counter. The session
   bar keeps its X, which is the way out. */
function focusMode(ctx) {
  if (ctx.view && ctx.view.contentEl) ctx.view.contentEl.classList.add('gv-focus');
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
    sess.hold = { running: false, startedAt: null, frozenSeconds: Number.isFinite(prefilled) ? prefilled : 0, lastAnnounced: -1, lastLiveAnnounced: -1, targetHit: false };
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

  /* A hold fills against the CLOCK, not against taps — same meter, same
     stages, driven by the tick below. "3 x 45s" fills towards 45. */
  const target = counterTarget.targetFromEntry(entry);
  const meter = attachFillMeter(zone, target);
  /* A hold's target moment gets the same detonation a rep target does —
     the clock reaching the goal is no less of a reward than a tap. A hold
     is not reps, so the badge says what was actually reached. */
  const powerUp = meter ? attachPowerUp(zone, 'Time reached') : null;
  if (target) zone.append(el('div', { class: 'gv-rc-target' }, `Target ${counterTarget.describeTarget(target)}`));

  const currentSeconds = () => (hold.running ? Math.max(0, (Date.now() - hold.startedAt) / 1000) : hold.frozenSeconds);

  let holdCountIn = null;

  const beginHold = () => {
    hold.running = true;
    hold.startedAt = Date.now();
    zone.setAttribute('aria-label', 'Tap to stop the hold');
    zone.classList.add('gv-session-zone-live');
  };

  const startStop = () => {
    if (holdCountIn && !holdCountIn.armed()) { holdCountIn.skip(); return; }
    if (!hold.running) {
      beginHold();
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
    if (meter && meter.set(secs) === 'done' && hold.targetHit !== true) {
      /* Once, at the moment the hold reaches its target — the seconds after
         it are bonus, not a second announcement. */
      hold.targetHit = true;
      if (powerUp) powerUp.fire();
      if (!sess.muted) sound.cue('go', 'target', ctx.settings);
    }
    const whole = Math.floor(secs);
    const atCheckpoint = whole > 0 && whole % HOLD_CHECKPOINT_S === 0;
    if (atCheckpoint && whole !== hold.lastLiveAnnounced) {
      hold.lastLiveAnnounced = whole;
      checkpointEl.textContent = `${fmtSeconds(whole)} held`;
    }
    if (atCheckpoint && whole !== hold.lastAnnounced && !sess.muted) {
      hold.lastAnnounced = whole;
      sound.announce(whole, ctx.settings);
    }
  }, 1000);

  /* Count in inside the clock's own display, then START it — "Begin" has to
     mean something. The reps counter arms and waits for you; a hold that
     said Begin and then sat there asking for a second tap would lose the
     seconds between reading the word and finding the button.

     Keyed by position for the same reason as the rep counter's: this
     function runs again on every render of the set. */
  const holdKey = setKey(sess.pos);
  if (sess.countedIn !== holdKey) {
    if (sess.stopCountIn) { sess.stopCountIn(); sess.stopCountIn = null; }
    const countIn = attachCountIn(zone, countEl, {
      muted: sess.muted,
      settings: ctx.settings,
      onDone: () => {
        sess.countedIn = holdKey;
        countEl.textContent = fmtSeconds(hold.frozenSeconds || 0);
        if (!hold.running) beginHold();
      },
    });
    sess.stopCountIn = countIn.stop;
    /* A tap during the count-in means "now", not "start the hold" — the
       hold's own start is what onDone does a beat later. */
    holdCountIn = countIn;
  } else {
    sess.stopCountIn = null;
  }

  const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' }, muteButton(ctx, sess));
  focusMode(ctx);
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

/* BY HOW MUCH — the number the completion screen leads with, because "21
   reps" only means something next to "was 14". Rounded to one decimal: a
   2.5kg jump is real, a 2.4999999999 one is a float artifact.

   Same three-kind switch as describeRecord, deliberately extending it rather
   than starting a fourth formatter somewhere else. */
function describeMargin(kind, val, prev) {
  const d = Math.round((parseFloat(val) - parseFloat(prev)) * 10) / 10;
  if (!Number.isFinite(d)) return '';
  if (kind === 'reps') return `+${d} rep${d === 1 ? '' : 's'}`;
  if (kind === 'weight') return `+${d} kg`;
  if (kind === 'seconds') return `+${fmtSeconds(d)}`;
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

/* `cue` is a sound.js event kind ('record' | 'goal') or null for confetti
   with no announcement. Not a plain string any more: a beep or a buzz cannot
   say "new record", so the EVENT has to travel, not just the words — the
   words are what the voice mode reads out, the kind is what the other modes
   turn into their own shape. */
function celebrate(ctx, sess, cueKind, words) {
  try {
    if (sess.confettiStop) sess.confettiStop();
    const host = ctx.view && ctx.view.contentEl;
    sess.confettiStop = confetti.burst(host);
    if (!sess.muted && cueKind) sound.cue(cueKind, words, ctx.settings);
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
        /* Keep the DETAIL, not just the tally. The completion screen used to
           print "2 records broken" because that was all that survived to it —
           the exercise, the figure and the margin were all computed here and
           thrown away one line later.

           Keyed by exercise+kind so beating the same best twice in one
           session shows ONE row against the real previous best, not two rows
           racing each other. previousBest already reads from
           sess.workoutsAtStart for exactly this reason; the display has to
           honour the same snapshot rule or it would contradict it. */
        const key = `${entry.exercise}/${kind}`;
        const existing = sess.records.find(r => r.key === key);
        if (existing) existing.val = val;
        else sess.records.push({ key, exercise: entry.exercise, kind, val, prev });
        callouts.push(`NEW BEST · ${describeRecord(kind, val, prev)}`);
        celebrate(ctx, sess, 'record', 'new record');
      }
    }
  } catch (e) { console.error('gym-vault records', e); }

  try {
    for (const g of checkGoalReached(ctx, sess, draft)) {
      sess.goalCount++;
      callouts.push(`GOAL HIT · ${g.name}`);
      celebrate(ctx, sess, 'goal', 'goal met');
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
   extra ticks cost nothing but a little arithmetic. Both numbers come from
   countdown.js — the set-by-set gate and this interval clock count in with
   the same cadence because they are the same countdown. */
const TICK_MS = countdown.TICK_MS;

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

  sound.cancel();
  startInterval(sess, tp.index + 1);
  ctx.rerender();
}

function stepBack(ctx, sess) {
  sound.cancel();
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
  focusMode(ctx);
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

  const ring = countdown.countdownRing(200);
  const digits = el('div', { class: 'gv-timed-count' }, String(Math.ceil(iv.seconds)));
  /* Announced at the START of the interval and again over the count-in, not
     every second: a live region that fires once a second is noise, not help
     (same rule as the hold timer's checkpoint region above). */
  const live = el('div', { class: 'gv-sr-only', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  /* Urgency lives on the dial as an attribute, not as a class toggle per
     tick: one attribute write when the BAND changes, and the stylesheet owns
     every colour. Bands rather than a continuous gradient because the point
     is to be readable at arm's length mid-set — a colour creeping by one
     percent a tick tells you nothing, a colour that changes tells you the
     interval is nearly out. */
  const dial = el('div', { class: 'gv-timed-dial', 'data-urgency': 'calm' }, ring.svg, digits);
  let urgency = 'calm';
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
    else { tp.bankedSeconds = timedElapsed(tp); tp.paused = true; sound.cancel(); }
    ctx.rerender();
  });

  const skipBtn = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': isWork ? 'Skip this interval' : 'Skip ahead' }, ico('skip-forward'));
  skipBtn.addEventListener('click', () => advanceTimed(ctx, draft, sess, { skip: true }));

  body.append(el('div', { class: 'gv-timed-controls' }, backBtn, playBtn, skipBtn));
  body.append(el('div', { class: 'gv-rc-bar gv-session-rcbar' }, muteButton(ctx, sess)));

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
      if (!sess.muted) sound.cue('begin', words, ctx.settings);
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
    const left = iv.seconds ? remaining / iv.seconds : 0;
    ring.set(left);
    /* Under 40% it warms; under 15% it goes urgent and the digits get a
       heartbeat. Both thresholds are on the FRACTION, not on seconds, so a
       20-second interval and a 3-minute one feel the same shape. */
    const band = left <= 0.15 ? 'urgent' : left <= 0.4 ? 'warn' : 'calm';
    if (band !== urgency) { urgency = band; dial.setAttribute('data-urgency', band); }
    if (schedule.totalSeconds) {
      top.fill.style.width = `${Math.min(100, ((totalBefore + elapsed) / schedule.totalSeconds) * 100).toFixed(1)}%`;
    }

    if (tp.paused) return;

    /* "3, 2, 1" into the next thing — countdown.countInNumber owns the
       ceil-vs-floor rule so this clock and the set-by-set gate cannot come
       to disagree about when 3 is 3. */
    const whole = countdown.countInNumber(remaining);
    if (whole !== null && whole !== tp.spokenAt) {
      tp.spokenAt = whole;
      live.textContent = String(whole);
      if (!sess.muted) sound.announce(whole, ctx.settings, 'count');
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

  const broken = sess.records || [];
  const wins = [];
  if (broken.length) wins.push(`${broken.length} record${broken.length === 1 ? '' : 's'} broken`);
  if (sess.goalCount) wins.push(`${sess.goalCount} goal${sess.goalCount === 1 ? '' : 's'} hit`);

  /* The records themselves, not just how many. Each row leads with the
     MARGIN — "+3 reps" is the thing you did; "21" is only the number it
     landed on, and it means nothing without the 18 underneath it. */
  const recordList = broken.length
    ? el('div', { class: 'gv-card-list gv-session-records' },
        ...broken.map(r => el('div', { class: 'gv-card gv-recrow' },
          el('div', { class: 'gv-recrow-main' },
            el('div', { class: 'gv-recrow-name' }, r.exercise),
            el('div', { class: 'gv-recrow-was' }, describeRecord(r.kind, r.val, r.prev))),
          el('div', { class: 'gv-recrow-margin' }, describeMargin(r.kind, r.val, r.prev)))))
    : '';

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
    recordList,
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
