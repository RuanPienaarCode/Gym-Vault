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

const { el, ico, clear, fmtSeconds } = require('./dom');
const { todayISO } = require('./dates');
const { setCounts, goalCurrent, goalProgress } = require('./stats');
const flow = require('./session-flow');
const records = require('./records');
const confetti = require('./confetti');
const { createCounter, tap, undo } = require('./rep-counter');
const { speechAvailable, speak, cancelSpeech, holdWakeLock, attachTapZone } = require('./rep-counter-shared');
const { resolveExerciseImages } = require('./page-exercise-detail');
const { buildRows, finishSession } = require('./page-log');
const { nextFrameIndex } = require('./media-cycle');

const FLASH_MS = 180;
const HOLD_CHECKPOINT_S = 15;
const MEDIA_CYCLE_MS = 1100; // time each frame holds before crossfading to the next
const MEDIA_MAX_FRAMES = 2; // guided view only ever animates start->finish, never the detail page's extras

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
      hold: null, holdFor: null,
      workoutsAtStart: ctx.data.workouts, // snapshot: never includes THIS session's own rows (they aren't saved until Finish)
      metGoals: new Set(),
      recordCount: 0,
      goalCount: 0,
      confettiStop: null,
      completionCelebrated: false,
      mediaCycleTimer: null,
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

function topBar(ctx, draft, extra) {
  return el('div', { class: 'gv-session-top' },
    el('div', { class: 'gv-session-top-row' }, exitButton(ctx), extra || ''),
    progressBar(draft));
}

function resetActiveState(sess) {
  sess.counter = null; sess.counterFor = null;
  sess.hold = null; sess.holdFor = null;
}

function setKey(pos) { return `${pos.entryIndex}:${pos.setIndex}`; }

function findExercise(ctx, name) {
  return ctx.data.exercises.find(e => e.name.toLowerCase() === (name || '').toLowerCase());
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

  const countEl = el('div', { class: 'gv-rc-count gv-session-count' }, String(sess.counter.count));
  const zone = el('div', { class: 'gv-rc-zone gv-session-zone', role: 'button', tabindex: '0', 'aria-label': `Tap to count a rep for ${entry.exercise}` }, countEl);

  let flashTimer = null;
  const registerTap = () => {
    const now = Date.now();
    const result = tap(sess.counter, now);
    sess.counter = result.state;
    if (!result.counted) return;
    countEl.textContent = String(sess.counter.count);
    zone.classList.add('gv-rc-flash');
    if (flashTimer) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { zone.classList.remove('gv-rc-flash'); flashTimer = null; }, FLASH_MS);
    if (!sess.muted) speak(sess.counter.count);
  };
  attachTapZone(zone, registerTap);

  const undoBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Undo last rep' },
    ico('minus'), el('span', {}, '1'));
  undoBtn.addEventListener('click', () => { sess.counter = undo(sess.counter); countEl.textContent = String(sess.counter.count); });

  const doneBtn = el('button', { class: 'gv-btn gv-btn-small', type: 'button' }, ico('check'), el('span', {}, 'Done'));
  doneBtn.addEventListener('click', () => completeSet(ctx, draft, sess, set, entry, { reps: String(sess.counter.count) }));

  const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' }, muteButton(sess), undoBtn, doneBtn);
  return el('div', { class: 'gv-session-body' }, extraTop || '', zone, bar);
}

function lastWeightForExercise(ctx, name) {
  const key = (name || '').toLowerCase();
  for (let i = ctx.data.workouts.length - 1; i >= 0; i--) {
    const rows = ctx.data.workouts[i].rows || [];
    for (let j = rows.length - 1; j >= 0; j--) {
      const r = rows[j];
      if ((r.exercise || '').toLowerCase() !== key) continue;
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
    sess.hold = { running: false, startedAt: null, frozenSeconds: Number.isFinite(prefilled) ? prefilled : 0, lastAnnounced: -1 };
    sess.holdFor = setKey(sess.pos);
  }
  const hold = sess.hold;

  const countEl = el('div', { class: 'gv-rc-count gv-session-count' }, fmtSeconds(hold.frozenSeconds || 0));
  const zone = el('div', {
    class: 'gv-rc-zone gv-session-zone', role: 'button', tabindex: '0',
    'aria-label': hold.running ? 'Tap to stop the hold' : 'Tap to start the hold',
  }, countEl);

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
    if (whole > 0 && whole % HOLD_CHECKPOINT_S === 0 && whole !== hold.lastAnnounced && !sess.muted) {
      hold.lastAnnounced = whole;
      speak(whole);
    }
  }, 1000);

  const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' }, muteButton(sess));
  return el('div', { class: 'gv-session-body' }, zone, bar);
}

function lastRunForExercise(ctx, name) {
  const key = (name || '').toLowerCase();
  for (let i = ctx.data.workouts.length - 1; i >= 0; i--) {
    const rows = ctx.data.workouts[i].rows || [];
    for (let j = rows.length - 1; j >= 0; j--) {
      const r = rows[j];
      if ((r.exercise || '').toLowerCase() !== key) continue;
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
  const kmInput = el('input', { class: 'gv-set-input gv-session-distance', type: 'number', inputmode: 'decimal', placeholder: 'km', value: set.distance_km ?? '' });
  kmInput.addEventListener('input', () => { set.distance_km = kmInput.value; set.touched = true; });
  const minInput = el('input', { class: 'gv-set-input gv-session-distance', type: 'number', inputmode: 'decimal', placeholder: 'min', value: set.minutes ?? '' });
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

function completeSet(ctx, draft, sess, set, entry, values) {
  Object.assign(set, values);
  set.done = true;
  set.touched = true;

  const callouts = [];
  try {
    const kind = classifyKind(entry);
    if (kind) {
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
    el('div', { class: 'gv-kicker' }, 'Rest'),
    el('div', { class: 'gv-session-rest-clock-wrap' }, ico('timer'), elapsedEl),
    callouts,
    nextLabel,
    el('div', { class: 'gv-hero-action gv-session-nextwrap' }, nextBtn),
    el('p', { class: 'gv-microcopy' }, "Rest, don't scroll.")));
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
