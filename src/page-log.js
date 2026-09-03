'use strict';
/* Workout logging — the live session screen. The draft lives in memory on
   ctx.state.logDraft and nothing touches disk until Finish, so backing out
   never leaves a half-written session note. */

const { el, ico, fmtSeconds, numericInput } = require('./dom');
const { todayISO, fmtShort } = require('./dates');
const { setCounts, sameName } = require('./stats');
const { targetFirstNumber, targetWeight, targetIsDuration, targetDurationSeconds, itemSets } = require('./plan-parse');

const { FormModal, ConfirmModal, EndSessionModal } = require('./modals');
const { RepCounterModal } = require('./rep-counter-modal');

/* `opts.setsPerEntry` (an array, one count per day item) overrides the plan's
   prescribed set count. A TIMED guided session needs it: the schedule decides
   how many rounds fit the time you asked for, and that is what the draft must
   hold — give every entry the plan's 3 sets when the clock only ever plays 2
   and the log fills with empty sets nothing scheduled. A count of 0 still
   makes one set, because an entry with no sets is unreachable. */
function startDraft(ctx, plan, day, opts) {
  const perEntry = (opts && opts.setsPerEntry) || null;
  const entries = [];
  if (day) {
    day.items.forEach((it, i) => {
      const n = perEntry && Number.isFinite(perEntry[i]) ? perEntry[i] : itemSets(it);
      entries.push(makeEntry(ctx, it.exercise, n, it.target));
    });
  }
  ctx.state.logDraft = {
    date: todayISO(),
    plan: plan ? plan.name : '',
    day: day ? day.name : '',
    startedAt: Date.now(),
    entries,
  };
}

function makeEntry(ctx, exercise, sets, target) {
  const ex = ctx.data.exercises.find(e => sameName(e.name, exercise));
  const unit = ex ? ex.fm.unit : null;
  const distance = unit === 'km';
  const duration = !distance && (unit === 'seconds' || (!unit && targetIsDuration(target || '')));
  const weighted = unit === 'kg' || targetWeight(target || '') !== null;
  const prefReps = duration ? '' : (targetFirstNumber(target || '') ?? '');
  /* Seconds, honouring a written "min" — the prefill for `30 min easy` used
     to be 30, so a manually logged run banked half a minute. */
  const prefSecs = duration ? (targetDurationSeconds(target || '') ?? targetFirstNumber(target || '') ?? '') : '';
  const prefW = targetWeight(target || '') ?? '';
  return {
    exercise, target: target || '', duration, weighted, distance,
    /* touched: false marks these as PREFILLS — they don't count until the
       user ticks the set or edits a field (see stats.setCounts). */
    /* A run is one entry, not three sets — and nothing is prefilled, since
       the distance you actually covered is the whole point of logging it. */
    sets: Array.from({ length: distance ? 1 : Math.max(1, sets) }, () => (distance
      ? { distance_km: '', minutes: '', done: false, touched: false }
      : { reps: prefReps, weight_kg: prefW, seconds: prefSecs, done: false, touched: false })),
  };
}

function render(ctx, root) {
  const draft = ctx.state.logDraft;
  if (!draft) { ctx.nav('dashboard'); return; }

  /* Leaving this page is a FORK, so the sheet names both ways out rather
     than assuming the destructive one. The back arrow used to be labelled
     "Discard session" and open a "Discard session?" confirm — which made
     every route off this page, including the one people take to KEEP a
     workout, read as throwing it away. */
  const endSheet = () => new EndSessionModal(ctx.app, {
    onSave: () => finishSession(ctx, draft),
    onDiscard: () => { ctx.state.logDraft = null; ctx.nav('dashboard'); },
  }).open();

  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'End session' }, ico('arrow-left'));
  back.addEventListener('click', endSheet);

  /* Enters guided mode over THIS SAME draft at the first incomplete set —
     no new session, just a second renderer over the one draft (see
     controller.js ctx.enterGuided). */
  const guidedBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small gv-logtop-guided', type: 'button' },
    ico('play'), el('span', { class: 'gv-btn-guided-label' }, 'Guided'));
  guidedBtn.addEventListener('click', () => ctx.enterGuided());

  root.append(el('div', { class: 'gv-logtop' },
    el('div', { class: 'gv-logtop-lead' },
      back,
      el('div', {},
        /* A real heading, not a styled div: this is the page's title, and
           without it the log page had none at all — nothing for a screen
           reader's rotor to land on, and ctx.nav's focus-move silently
           no-opped here. */
        el('h2', { class: 'gv-logtop-title' }, draft.day || 'Freestyle session'),
        el('div', { class: 'gv-logtop-sub' }, [draft.plan, fmtShort(draft.date)].filter(Boolean).join(' · ')))),
    guidedBtn,
    el('div', { class: 'gv-log-clock' }, ico('timer'), el('span', { class: 'gv-log-elapsed' }, elapsed(draft)))));

  // Tick the elapsed label without re-rendering the whole page (inputs would
  // lose focus). The interval dies with the page via ctx.pageInterval.
  ctx.setPageInterval(() => {
    const t = elapsed(ctx.state.logDraft || draft);
    for (const s of root.querySelectorAll('.gv-log-elapsed')) s.textContent = t;
  }, 30000);

  draft.entries.forEach((entry, ei) => root.append(entryCard(ctx, draft, entry, ei)));

  const addEx = el('button', { class: 'gv-add-line', type: 'button', onclick: () => openAddExercise(ctx, draft) },
    ico('plus'), el('span', {}, 'Add exercise'));
  root.append(addEx);

  /* Tally — recomputed on every rerender, so ticking a set updates it.
     Counts by stats.setCounts, the SAME rule finishSession saves by. */
  let doneSets = 0, doneReps = 0;
  for (const entry of draft.entries) for (const set of entry.sets) {
    if (!setCounts(set)) continue;
    doneSets++;
    const r = parseFloat(set.reps);
    if (Number.isFinite(r)) doneReps += r;
  }
  root.append(el('div', { class: 'gv-log-tally' },
    el('span', {}, 'Sets', el('b', {}, String(doneSets))),
    el('span', {}, 'Reps', el('b', {}, String(doneReps))),
    el('span', {}, 'Elapsed', el('b', { class: 'gv-log-elapsed' }, elapsed(draft)))));

  const finish = el('button', { class: 'gv-btn-finish', type: 'button', onclick: () => finishSession(ctx, draft) },
    el('span', {}, 'Bank it'));
  /* This button IS the destructive route, so its own confirm may say so —
     what was wrong was the SHEET that every exit shared being titled that
     way. Kept as a ConfirmModal for that reason: there is no fork here. */
  const discard = el('button', { class: 'gv-btn-discard', type: 'button', onclick: () => new ConfirmModal(ctx.app, {
    title: 'Discard session?', message: 'Nothing you logged will be saved.', confirmLabel: 'Discard',
    onConfirm: () => { ctx.state.logDraft = null; ctx.nav('dashboard'); },
  }).open() }, 'Discard');
  root.append(el('div', { class: 'gv-log-foot' }, finish, discard,
    el('p', { class: 'gv-microcopy' }, "The bar isn't going to climb itself.")));
}

function elapsed(draft) {
  const min = Math.max(0, Math.round((Date.now() - draft.startedAt) / 60000));
  return `${min} min`;
}

function entryCard(ctx, draft, entry, ei) {
  /* Says so, rather than leaving a column of the plan's own numbers to be
     read as work. setCounts is the SAME rule finishSession saves by, so this
     label and the note that lands can never disagree. */
  const logged = entry.sets.some(setCounts);
  const card = el('div', { class: `gv-card gv-log-card${logged ? '' : ' unlogged'}` });
  card.append(el('div', { class: 'gv-log-ex-head' },
    el('div', {},
      el('div', { class: 'gv-log-ex-name' }, entry.exercise),
      el('div', { class: 'gv-log-ex-target' },
        [entry.target ? `target ${entry.target}` : '', logged ? '' : 'not logged yet']
          .filter(Boolean).join(' · '))),
    removeBtn(ctx, draft, ei)));

  const rows = el('div', { class: 'gv-log-sets' });
  entry.sets.forEach((set, si) => rows.append(setRow(ctx, entry, set, si)));
  card.append(rows);

  const addSet = el('button', { class: 'gv-add-line gv-add-set', type: 'button' }, ico('plus'), el('span', {}, 'Set'));
  addSet.addEventListener('click', () => {
    const prev = entry.sets[entry.sets.length - 1] || {};
    // Copied values are prefills too — the new set must not count untouched.
    entry.sets.push(entry.distance
      ? { distance_km: '', minutes: '', done: false, touched: false }
      : { reps: prev.reps ?? '', weight_kg: prev.weight_kg ?? '', seconds: prev.seconds ?? '', done: false, touched: false });
    ctx.rerender();
  });
  card.append(addSet);
  return card;
}

/* placeholder text alone ('reps', 'kg', 'sec'…) is not an accessible name —
   it disappears the moment a value is typed, and screen readers don't treat
   it as a label to begin with. Each input's aria-label carries the same
   information a sighted user gets from the placeholder PLUS which exercise
   and which set it belongs to, since a session has many of these in a row. */
const INPUT_LABELS = {
  reps: 'Reps', weight_kg: 'Weight in kilograms', seconds: 'Seconds',
  distance_km: 'Distance in kilometres', minutes: 'Minutes',
};

function setRow(ctx, entry, set, si) {
  /* A PREFILL IS THE PLAN TALKING, NOT YOU. These boxes are seeded from the
     day's prescription and marked `touched: false`; until you type or tick,
     nothing here has happened. They rendered identically to a figure you had
     entered, so a session where two sets were logged and the rest skipped
     read back as five sets of submax that were never done — reported from a
     first-run smoke test, where it looked like an 18-set day had been
     credited. The saved note was always honest; this screen was not.

     Dimmed rather than emptied, because ticking a prefilled set is a real
     and useful action — "I did exactly what the plan said" — and stats.
     setCounts has always honoured it. Emptying the box would take that away
     to fix a display problem. */
  const isPrefill = !set.touched && !set.done;
  const row = el('div', { class: `gv-log-set${set.done ? ' done' : ''}${isPrefill ? ' prefill' : ''}` });
  row.append(el('span', { class: 'gv-set-num' }, String(si + 1).padStart(2, '0')));

  /* dom.numericInput, not a bare type="number": a 4.3 km run could not be
     entered, and "4,3" was discarded to an empty string outright. */
  const numInput = (key, placeholder, cls) => numericInput({
    class: `gv-set-input${cls ? ' ' + cls : ''}`,
    placeholder, value: set[key] ?? '',
    /* A screen reader gets told it is a suggestion too — dimming it says
       nothing to anyone not looking at the colour. */
    'aria-label': `${INPUT_LABELS[key] || placeholder} — ${entry.exercise}, set ${si + 1}`
      + (isPrefill && String(set[key] ?? '').trim() ? ', from the plan, not yet logged' : ''),
  }, v => { set[key] = v; set.touched = true; });

  if (entry.distance) {
    /* Two inputs in one row — narrower so km + min + the 48px tick still
       fit a 390px phone without wrapping. */
    row.append(numInput('distance_km', 'km', 'gv-set-input-narrow'), el('span', { class: 'gv-set-unit' }, 'km'));
    row.append(numInput('minutes', 'min', 'gv-set-input-narrow'), el('span', { class: 'gv-set-unit' }, 'min'));
  } else if (entry.duration) {
    row.append(numInput('seconds', 'sec'), el('span', { class: 'gv-set-unit' }, 's'));
  } else {
    /* Weighted rows carry two inputs + counter + the 48px tick — same
       narrow-input rule as the distance branch, or they overflow 390px. */
    const repsCls = entry.weighted ? 'gv-set-input-narrow' : '';
    row.append(numInput('reps', 'reps', repsCls), el('span', { class: 'gv-set-unit' }, '×'));
    if (entry.weighted) row.append(numInput('weight_kg', 'kg', 'gv-set-input-narrow'), el('span', { class: 'gv-set-unit' }, 'kg'));
    row.append(counterBtn(ctx, entry, set));
  }

  const done = el('button', { class: 'gv-set-done', type: 'button', 'aria-label': set.done ? 'Mark not done' : 'Mark done' }, ico('check'));
  done.addEventListener('click', () => { set.done = !set.done; ctx.rerender(); });
  row.append(done);
  return row;
}

/* Hands-free rep counting for a single set: phone flat on the floor, nose
   taps the screen at the bottom of each rep. Opens seeded with the exercise
   name; on Done the count overwrites this set's reps and marks it touched
   (the same rule everything else in the log obeys — see stats.setCounts). */
function counterBtn(ctx, entry, set) {
  const b = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Tap-count reps for ${entry.exercise}` }, ico('repeat-2'));
  b.addEventListener('click', () => {
    /* Motion sensitivity belongs to the movement, so it is read from and
       written back to the exercise note — the same value the guided view
       uses, not a second copy that can disagree with it. */
    const ex = ctx.data.exercises.find(e => sameName(e.name, entry.exercise));
    new RepCounterModal(ctx.app, {
      exerciseName: entry.exercise,
      skin: ctx.settings.skin,
      accent: ctx.settings.accent,
      settings: ctx.settings,
      sensitivity: ex && ex.fm ? ex.fm.motion_sensitivity : null,
      onSensitivity: value => {
        if (!ex || !ex.file) return;
        ex.fm.motion_sensitivity = value;
        Promise.resolve(ctx.io.saveExercise(ex)).catch(e => console.error('gym-vault sensitivity', e));
      },
      onDone: count => {
        set.reps = String(count);
        set.touched = true;
        ctx.rerender();
      },
    }).open();
  });
  return b;
}

function removeBtn(ctx, draft, ei) {
  const b = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Remove exercise' }, ico('x'));
  b.addEventListener('click', () => { draft.entries.splice(ei, 1); ctx.rerender(); });
  return b;
}

function openAddExercise(ctx, draft) {
  const options = ctx.data.exercises.map(e => [e.name, e.name]);
  new FormModal(ctx.app, {
    title: 'Add exercise',
    fields: [
      options.length
        ? { key: 'exercise', label: 'Exercise', kind: 'dropdown', options, value: options[0][0] }
        : { key: 'exercise', label: 'Exercise', kind: 'text', placeholder: 'e.g. Pull-ups' },
      { key: 'sets', label: 'Sets', kind: 'number', value: '3' },
    ],
    submitLabel: 'Add',
    validate: v => (!String(v.exercise).trim() ? 'Pick an exercise.' : null),
    onSubmit: v => {
      const sets = parseInt(v.sets, 10);
      draft.entries.push(makeEntry(ctx, String(v.exercise).trim(), Number.isFinite(sets) && sets > 0 ? sets : 3, ''));
      ctx.rerender();
    },
  }).open();
}

/* The one rows-shaping rule, shared by finishSession (which SAVES it) and
   page-session.js (which builds a synthetic in-memory workout from it to
   check goal progress mid-session, without ever writing to disk) — two
   copies of "what a saved row looks like" is exactly how this codebase
   grows wrong numbers (see stats.js's header comment). */
function buildRows(draft) {
  const rows = [];
  for (const entry of draft.entries) {
    let n = 0;
    for (const set of entry.sets) {
      if (!setCounts(set)) continue;
      n++;
      if (entry.distance) {
        /* The ONLY minutes->seconds conversion: the column is seconds, the
           input is minutes because nobody logs a 30-minute run as 1800. */
        const mins = parseFloat(set.minutes);
        rows.push({
          exercise: entry.exercise, set: n, reps: '', weight_kg: '',
          seconds: Number.isFinite(mins) ? String(Math.round(mins * 60)) : '',
          note: '', distance_km: String(set.distance_km ?? '').trim(),
        });
      } else {
        /* seconds is written whenever the set HAS them, not only for
           duration entries. For every pre-existing path this changes
           nothing — makeEntry leaves seconds empty on a reps entry and no
           screen ever filled it. What it buys: a timed circuit (see
           timed-plan.js) measures real time on a rep exercise too, so a
           push-up interval can log "15 reps, 45 s" instead of throwing away
           the one figure the clock actually knew. */
        rows.push({
          exercise: entry.exercise, set: n,
          reps: entry.duration ? '' : String(set.reps).trim(),
          weight_kg: entry.duration ? '' : String(set.weight_kg).trim(),
          seconds: String(set.seconds ?? '').trim(),
          note: '', distance_km: '',
        });
      }
    }
  }
  return rows;
}

async function finishSession(ctx, draft) {
  /* stats.setCounts is the one rule for what gets saved: ticked done OR
     holding any typed figure — sweaty thumbs forget ticks, and silently
     dropping three typed sets is worse than saving an untucked one. The
     tally above uses the same rule, so what you see is what lands. */
  const rows = buildRows(draft);
  if (!rows.length) { ctx.notice('Tick a set (or type a figure) before finishing.'); return; }
  /* Double-tap guard: the save can take a beat on a syncing vault, and a
     second tap mid-await would write "<date> 2.md" with identical rows. */
  if (draft.finishing) return;
  draft.finishing = true;
  const duration_min = Math.max(1, Math.round((Date.now() - draft.startedAt) / 60000));
  try {
    await ctx.io.saveWorkout({ date: draft.date, plan: draft.plan, day: draft.day, duration_min, rows });
  } catch (e) {
    draft.finishing = false;
    ctx.notice(`could not save the session (${e.message || e})`);
    return;
  }
  ctx.state.logDraft = null;
  ctx.notice('Session logged. Strong work.');
  ctx.nav('dashboard');
  ctx.reload();
}

module.exports = { render, startDraft, buildRows, finishSession };
