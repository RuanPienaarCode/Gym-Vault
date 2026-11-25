'use strict';
const { accentFor } = require('./constants');
/* Workout logging — the live session screen. The draft lives on
   ctx.state.logDraft and nothing touches the VAULT until Finish, so backing
   out never leaves a half-written session note. It is not memory-only any
   more: the controller keeps a device-local copy (src/draft-store.js) so a
   killed app offers the session back — see keepDraft below for the edits
   that have to ask for it. */

const { el, ico, fmtSeconds, numericInput } = require('./dom');
const { recapEl } = require('./recap');
const { todayISO, fmtShort, fromISO, toISO } = require('./dates');
const { setCounts, sameName, workoutDate } = require('./stats');
const { targetFirstNumber, targetWeight, targetIsDuration, targetDurationSeconds, itemSets } = require('./plan-parse');

const { FormModal, ConfirmModal, EndSessionModal } = require('./modals');
const { RepCounterModal } = require('./rep-counter-modal');
const { noteActivity, countedElapsedMs } = require('./draft-store');
const { secondsFromMinutes } = require('./timed-plan');
const { ROW_EXTRA } = require('./markdown');
const { markTyped } = require('./session-flow');
const { motionPref, setMotionPref } = require('./motion-count');
const rewardsFlow = require('./rewards-flow');
const { isOpenEnded } = require('./counter-target');

/* `opts.setsPerEntry` (an array, one count per day item) overrides the plan's
   prescribed set count. A TIMED guided session needs it: the schedule decides
   how many rounds fit the time you asked for, and that is what the draft must
   hold — give every entry the plan's 3 sets when the clock only ever plays 2
   and the log fills with empty sets nothing scheduled. A count of 0 still
   makes one set, because an entry with no sets is unreachable.

   `opts.date` (YYYY-MM-DD) logs the session on that day instead of today -
   the Running page's "Log" on a day earlier this week. A future or unreadable
   date is ignored (it logs today): a session cannot have happened tomorrow.

   `opts.pickDate` (History's "Log a past session", audit 25 Nov 2026 #21)
   opens the log with its date control focused. A one-shot flag on ctx.state,
   not on the draft: it is a screen instruction, not part of the session. */
function startDraft(ctx, plan, day, opts) {
  ctx.state.logPickDate = !!(opts && opts.pickDate);
  const perEntry = (opts && opts.setsPerEntry) || null;
  const entries = [];
  if (day) {
    day.items.forEach((it, i) => {
      const n = perEntry && Number.isFinite(perEntry[i]) ? perEntry[i] : itemSets(it);
      entries.push(makeEntry(ctx, it.exercise, n, it.target));
    });
  }
  ctx.state.logDraft = {
    date: pastDate(opts && opts.date) || todayISO(),
    plan: plan ? plan.name : '',
    day: day ? day.name : '',
    startedAt: Date.now(),
    entries,
  };
  /* Starting a session is the second chance for an award that failed to save (rewards-flow.js). */
  try { rewardsFlow.retryPending(ctx, 'start'); } catch (e) { /* never in the way of a session */ }
}

/* A timed circuit that gained time mid-session (timed-plan.giveTimeBack) has
   sets its draft does not hold yet. Fresh from the plan, so they are prefills
   like every other untouched set. A run stays one entry, as makeEntry has it:
   its later intervals already have no set to write to. */
function growToSchedule(ctx, draft, setsPerEntry) {
  draft.entries.forEach((entry, i) => {
    const missing = (setsPerEntry[i] || 0) - entry.sets.length;
    if (entry.distance || missing <= 0) return;
    entry.sets.push(...makeEntry(ctx, entry.exercise, missing, entry.target).sets);
  });
}

/* A figure typed into the draft changes it in place and must NOT re-render
   (the input would lose focus), so it cannot rely on ctx.rerender to write the
   device-local copy; it asks directly. A no-op under a ctx that has no
   controller behind it (the unit guards render these pages against a stub). */
function keepDraft(ctx) {
  /* An edit of a saved note is not the live session: nothing to keep on the
     device, and the live draft (if any) has not changed. */
  if (isEditing(ctx)) return;
  markActive(ctx);
  if (ctx && typeof ctx.persistDraft === 'function') ctx.persistDraft();
}

/* SOMETHING HAPPENED IN THE SESSION (audit 16 Nov 2026, #8): stamps the live draft
   so a stale gap between two activities is left out of the workout's length - the
   same rule restoreDraft applies after a kill (draft-store.noteActivity). Every
   edit that changes the draft calls this, directly or through keepDraft. Typing
   into an EDIT of a saved note is not activity in the live session. */
function markActive(ctx) {
  if (isEditing(ctx)) return;
  const d = ctx && ctx.state && ctx.state.logDraft;
  if (d) noteActivity(d, Date.now());
}

/* A canonical YYYY-MM-DD that is not in the future, or null. */
function pastDate(iso) {
  const d = typeof iso === 'string' ? fromISO(iso) : null;
  if (!d) return null;
  const canon = toISO(d);
  return canon <= todayISO() ? canon : null;
}

/* EDITING A SAVED SESSION (audit 25 Nov 2026, #27). History's "Edit" opens this
   same page over a draft built from the note, and saving rewrites that note
   through io.updateWorkout - never saveWorkout (a second note), never the XP
   award (the note already earned it).

   THE EDIT DRAFT IS NOT ctx.state.logDraft. That accessor is the live session:
   every write to it is kept on the device (draft-store.js), Today offers it as
   "Session in progress", and the stored copy is a whitelist that would drop
   `editing` - so an edit kept there would come back after a kill as a plain
   session and Save session would save the note a second time and pay its XP again.
   It lives on ctx.state.editDraft instead, a plain field nothing keeps or
   offers, and the route says which one is on screen (`editing` param = the
   note's path). A live session open at the time is left exactly as it was. */
const cell = v => String(v === null || v === undefined ? '' : v).trim();

function isEditing(ctx) {
  const p = ctx && ctx.state && ctx.state.params;
  return !!(p && p.editing);
}

/* The draft this page draws: the edit named by the route, else the live one. */
function shownDraft(ctx) {
  if (!isEditing(ctx)) return ctx.state.logDraft;
  const d = ctx.state.editDraft;
  return d && d.editing === ctx.state.params.editing ? d : null;
}

/* Whole seconds back to the minutes box a distance set is typed in. Two decimals
   are enough for buildRows' secondsFromMinutes to give the same whole seconds
   back (the error is under 0.3 s), so an untouched run row saves unchanged. */
function minutesOf(seconds) {
  const n = parseFloat(seconds);
  return Number.isFinite(n) ? String(Math.round((n / 60) * 100) / 100) : '';
}

/* What makes an edit worth asking about before it is thrown away. */
const editSignature = draft => JSON.stringify([draft.date, buildRows(draft)]);

/* A saved note as a draft this page can draw and buildRows can save, or null for
   a note this app cannot date (it would have to guess which day to write back).
   Rows are grouped the way History shows them (consecutive rows of one exercise).
   An entry's kind is read from what its rows HOLD, so saving writes every figure
   back: buildRows blanks reps and weight on a duration or distance entry, so a
   group holding either is never made one of those. Every set is ticked and
   touched - these are things that happened. */
function editDraftFrom(ctx, w) {
  const date = w ? workoutDate(w) : null;
  if (!w || !w.file || !w.file.path || !date) return null;
  const fm = w.fm || {};
  const groups = [];
  for (const r of w.rows || []) {
    const name = cell(r && r.exercise);
    if (!name) continue;
    const last = groups[groups.length - 1];
    if (last && last.exercise === name) last.rows.push(r);
    else groups.push({ exercise: name, rows: [r] });
  }
  const entries = groups.map(g => {
    const ex = ctx.data.exercises.find(e => sameName(e.name, g.exercise));
    const unit = ex && ex.fm ? ex.fm.unit : null;
    const has = k => g.rows.some(r => cell(r[k]) !== '');
    const lifts = has('reps') || has('weight_kg');
    const distance = !lifts && (has('distance_km') || unit === 'km');
    const duration = !distance && !lifts && (has('seconds') || unit === 'seconds');
    const weighted = !distance && !duration && (has('weight_kg') || unit === 'kg');
    return {
      exercise: g.exercise, target: '', duration, weighted, distance,
      sets: g.rows.map(r => {
        const set = distance
          ? { distance_km: cell(r.distance_km), minutes: minutesOf(r.seconds) }
          : { reps: cell(r.reps), weight_kg: cell(r.weight_kg), seconds: cell(r.seconds), distance_km: cell(r.distance_km) };
        set.done = true;
        set.touched = true;
        if (cell(r.note)) set.note = cell(r.note);
        /* Columns the user added to the table by hand ride on the row as
           ROW_EXTRA (data.tableByHeader). Carried on the set, or Save changes
           kept their headings and blanked every value under them. */
        if (Array.isArray(r[ROW_EXTRA]) && r[ROW_EXTRA].length) set.extra = r[ROW_EXTRA].slice();
        return set;
      }),
    };
  });
  const draft = {
    editing: w.file.path, editingName: w.name,
    date, plan: cell(fm.plan), day: cell(fm.day),
    /* The note's own length: time spent editing is not training time. */
    duration_min: fm.duration_min,
    startedAt: Date.now(),
    entries,
  };
  if (typeof fm.kind === 'string' && fm.kind.trim()) draft.kind = fm.kind.trim();
  draft.original = editSignature(draft);
  return draft;
}

/* History's Edit. Replaces only an earlier, unsaved EDIT (a note is the truth,
   so reopening one starts from it again); the live session is untouched. */
function startEdit(ctx, w) {
  const draft = editDraftFrom(ctx, w);
  if (!draft) { ctx.notice('This session has no date the app can read, so it can only be edited in its note.'); return; }
  ctx.state.editDraft = draft;
  ctx.nav('log', { editing: draft.editing });
}

function leaveEdit(ctx, draft) {
  if (ctx.state.editDraft === draft) ctx.state.editDraft = null;
  ctx.back('history');
}

/* Back arrow and Discard: an unchanged edit just leaves; a changed one asks. */
function discardEdit(ctx, draft) {
  if (editSignature(draft) === draft.original) { leaveEdit(ctx, draft); return; }
  new ConfirmModal(ctx.app, {
    title: 'Discard changes?', message: 'The saved session stays as it was.', confirmLabel: 'Discard changes',
    onConfirm: () => leaveEdit(ctx, draft),
  }).open();
}

async function saveEdit(ctx, draft) {
  const rows = buildRows(draft);
  if (!rows.length) { ctx.notice('Keep at least one set. To remove the whole session, delete it in History.'); return; }
  if (draft.finishing) return;
  draft.finishing = true;
  /* Looked up by path now, not held: a reload since Edit replaced ctx.data. */
  const w = ctx.data.workouts.find(x => x.file && x.file.path === draft.editing);
  if (!w) { draft.finishing = false; ctx.notice('That session note was moved or deleted, so nothing was changed.'); return; }
  const session = { date: draft.date, plan: draft.plan, day: draft.day, duration_min: draft.duration_min, rows };
  if (draft.kind) session.kind = draft.kind;
  try {
    await ctx.io.updateWorkout(w.file, session);
  } catch (e) {
    draft.finishing = false;
    ctx.notice(`could not save the changes (${e.message || e})`);
    return;
  }
  ctx.notice('Changes saved.');
  leaveEdit(ctx, draft);
  ctx.reload();
}

/* THE DAY THIS SESSION IS SAVED ON (audit 25 Nov 2026, #21). A native date
   control, today or earlier: `max` keeps the picker from offering a later day,
   and pastDate - the one validator, the same one startDraft uses - refuses
   anything else typed in. An emptied control (iOS has a Reset button) puts the
   day back. Changing the day changes nothing else in the draft. */
function dateControl(ctx, draft) {
  const input = el('input', {
    class: 'gv-log-date', type: 'date', max: todayISO(), value: draft.date,
    'aria-label': 'Day of this session',
  });
  input.value = draft.date;
  input.addEventListener('change', () => {
    const raw = String(input.value || '');
    const iso = pastDate(raw);
    if (!iso) {
      input.value = draft.date;
      if (raw) ctx.notice('Pick today or an earlier day.');
      return;
    }
    if (iso === draft.date) return;
    draft.date = iso;
    ctx.rerender();
  });
  return input;
}

/* Focus the date control once it is on screen: after the route change has
   moved focus to the page heading (controller.focusPageHeading runs after the
   render). showPicker opens it where the engine has it (not iOS 15); focus
   alone is the fallback. Never throws. */
function focusDate(input) {
  const setT = (typeof window !== 'undefined' && window.setTimeout) || setTimeout;
  setT(() => {
    try {
      if (input.isConnected === false) return;
      input.focus();
      if (typeof input.showPicker === 'function') input.showPicker();
    } catch (e) { /* focus is enough */ }
  }, 0);
}

/* HOW MANY SETS A DRAFT ENTRY HOLDS - the ONE rule, makeEntry builds by it and the
   setup screen's reps-mode preview counts by it. A run is a single continuous
   effort, so it is one set whatever the plan wrote (`6 x 3 min hard` is one run of
   six efforts, logged as one row with one distance); every other exercise holds
   one set per planned set, never fewer than one. */
function setsInDraft(ctx, exercise, sets) {
  const ex = ctx.data.exercises.find(e => sameName(e.name, exercise));
  return ex && ex.fm && ex.fm.unit === 'km' ? 1 : Math.max(1, sets);
}

function makeEntry(ctx, exercise, sets, target) {
  const ex = ctx.data.exercises.find(e => sameName(e.name, exercise));
  const unit = ex ? ex.fm.unit : null;
  const distance = unit === 'km';
  /* A WRITTEN duration wins over the note's unit, same as the clock
     (timed-plan.js workSecondsFor): `Strides | 4 x 20s` is a duration entry
     even under `unit: reps`, and `Farmer's Carry | 2 x 40s` is one even
     under `unit: kg` — both are real plan lines in the shared library. This
     used to require EITHER `unit: seconds` OR no unit at all before it would
     read the target as a duration, so a plain tick on either line banked the
     written seconds as reps instead — timed mode read the same target
     correctly and manual mode didn't, which is the two-rules-for-one-figure
     bug this codebase keeps shipping. `km` is the one unit that still wins
     outright: a run is measured in distance, not time, however its target
     reads. */
  const duration = !distance && (unit === 'seconds' || targetIsDuration(target || ''));
  const weighted = unit === 'kg' || targetWeight(target || '') !== null;
  /* "65% max" is open-ended (counter-target.isOpenEnded): its 65 is a
     percentage, so nothing is prefilled - not 65 reps, not 65 seconds. */
  const open = isOpenEnded(target);
  const prefReps = duration || open ? '' : (targetFirstNumber(target || '') ?? '');
  /* Seconds, honouring a written "min" — the prefill for `30 min easy` used
     to be 30, so a manually logged run banked half a minute. */
  const prefSecs = duration ? (targetDurationSeconds(target || '') ?? (open ? '' : targetFirstNumber(target || '')) ?? '') : '';
  const prefW = targetWeight(target || '') ?? '';
  return {
    exercise, target: target || '', duration, weighted, distance,
    /* touched: false marks these as PREFILLS — they don't count until the
       user ticks the set or edits a field (see stats.setCounts). */
    /* A run is one entry, not three sets — and nothing is prefilled, since
       the distance you actually covered is the whole point of logging it. */
    sets: Array.from({ length: setsInDraft(ctx, exercise, sets) }, () => (distance
      ? { distance_km: '', minutes: '', done: false, touched: false }
      : { reps: prefReps, weight_kg: prefW, seconds: prefSecs, done: false, touched: false })),
  };
}

function render(ctx, root) {
  /* The live session, or the edit of a saved note the route names (#27). */
  const draft = shownDraft(ctx);
  const editing = !!(draft && draft.editing);
  if (!draft) { ctx.nav(isEditing(ctx) ? 'history' : 'dashboard'); return; }

  /* Leaving this page is a FORK, so the sheet names both ways out rather
     than assuming the destructive one. The back arrow used to be labelled
     "Discard session" and open a "Discard session?" confirm — which made
     every route off this page, including the one people take to KEEP a
     workout, read as throwing it away. An edit has no session to end: its
     back arrow leaves, asking first only when something was changed. */
  /* DISCARD ASKS, WHEREVER IT IS FOUND (audit 25 Nov 2026, #23): the foot
     button below always did; this sheet cleared the session in one tap. One
     question, one wording (page-session.js uses the same). */
  const askDiscard = () => new ConfirmModal(ctx.app, {
    title: 'Discard session?', message: 'Nothing you logged will be saved.', confirmLabel: 'Discard',
    onConfirm: () => { ctx.state.logDraft = null; ctx.nav('dashboard'); },
  }).open();
  const endSheet = () => (editing ? discardEdit(ctx, draft) : new EndSessionModal(ctx.app, {
    onSave: () => finishSession(ctx, draft),
    onDiscard: askDiscard,
  }).open());

  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': editing ? 'Back to History' : 'End session' }, ico('arrow-left'));
  back.addEventListener('click', endSheet);

  /* Enters guided mode over THIS SAME draft at the first incomplete set —
     no new session, just a second renderer over the one draft (see
     controller.js ctx.enterGuided). Not for an edit: guided mode runs the
     live draft, and a saved session is not one to train through again. */
  const guidedBtn = editing ? null : el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small gv-logtop-guided', type: 'button' },
    ico('play'), el('span', { class: 'gv-btn-guided-label' }, 'Guided'));
  if (guidedBtn) guidedBtn.addEventListener('click', () => ctx.enterGuided());

  /* The day is a control (#21). A live session on another day says so in words
     under it, the way Today names the day of a draft left open from earlier. An
     edit already names its day in the title. */
  const dateInput = dateControl(ctx, draft);
  const otherDay = !editing && draft.date !== todayISO();
  root.append(el('div', { class: `gv-logtop${editing ? ' gv-logtop-editing' : ''}` },
    el('div', { class: 'gv-logtop-lead' },
      back,
      el('div', {},
        /* A real heading, not a styled div: this is the page's title, and
           without it the log page had none at all — nothing for a screen
           reader's rotor to land on, and ctx.nav's focus-move silently
           no-opped here. */
        el('h2', { class: 'gv-logtop-title' }, editing
          ? `Editing ${fmtShort(draft.date)} · ${draft.day || 'Freestyle session'}`
          : draft.day || 'Freestyle session'),
        el('div', { class: 'gv-logtop-sub' }, draft.plan ? `${draft.plan} · ` : '', dateInput),
        otherDay ? el('div', { class: 'gv-logtop-when' }, `This session will be saved on ${fmtShort(draft.date)}.`) : null)),
    guidedBtn,
    /* Editing is not training time: no running clock. */
    editing ? null : el('div', { class: 'gv-log-clock' }, ico('timer'), el('span', { class: 'gv-log-elapsed' }, elapsed(draft)))));
  if (!editing && ctx.state.logPickDate) {
    ctx.state.logPickDate = false;
    focusDate(dateInput);
  }

  // Tick the elapsed label without re-rendering the whole page (inputs would
  // lose focus). The interval dies with the page via ctx.pageInterval.
  if (!editing) {
    ctx.setPageInterval(() => {
      const t = elapsed(ctx.state.logDraft || draft);
      for (const s of root.querySelectorAll('.gv-log-elapsed')) s.textContent = t;
    }, 30000);
  }

  /* The tally's two figures are painted by this function, so a typed figure can
     refresh them in place (see below) without a re-render. Declared here, filled
     when the tally is built. */
  let paintTally = () => {};
  draft.entries.forEach((entry, ei) => root.append(entryCard(ctx, draft, entry, ei, () => paintTally())));

  const addEx = el('button', { class: 'gv-add-line', type: 'button', onclick: () => openAddExercise(ctx, draft) },
    ico('plus'), el('span', {}, 'Add exercise'));
  root.append(addEx);

  /* Tally — recomputed on every rerender, so ticking a set updates it, AND
     repainted in place by every typed figure (audit 16 Nov 2026, #49): typing
     changes the draft without a re-render (the input would lose focus), so the
     tally used to sit stale until something else redrew the page although the row
     already counted and saved. Counts by setWorthSaving, the SAME rule buildRows
     saves by (setCounts alone isn't enough here — see that function's comment). */
  const setsNum = el('b', {}, '0');
  const repsNum = el('b', {}, '0');
  paintTally = () => {
    let doneSets = 0, doneReps = 0;
    for (const entry of draft.entries) for (const set of entry.sets) {
      if (!setWorthSaving(entry, set)) continue;
      doneSets++;
      const r = parseFloat(set.reps);
      if (Number.isFinite(r)) doneReps += r;
    }
    setsNum.textContent = String(doneSets);
    repsNum.textContent = String(doneReps);
  };
  paintTally();
  /* An edit shows the note's saved minutes, which it keeps; never a clock. */
  const saved = cell(draft.duration_min);
  root.append(el('div', { class: 'gv-log-tally' },
    el('span', {}, 'Sets', setsNum),
    el('span', {}, 'Reps', repsNum),
    editing
      ? el('span', {}, 'Minutes', el('b', {}, saved || '—'))
      : el('span', {}, 'Elapsed', el('b', { class: 'gv-log-elapsed' }, elapsed(draft)))));

  if (editing) {
    const save = el('button', { class: 'gv-btn-finish', type: 'button', onclick: () => saveEdit(ctx, draft) },
      el('span', {}, 'Save changes'));
    const drop = el('button', { class: 'gv-btn-discard', type: 'button', onclick: () => discardEdit(ctx, draft) }, 'Discard changes');
    root.append(el('div', { class: 'gv-log-foot' }, save, drop,
      el('p', { class: 'gv-microcopy' }, 'Saving rewrites this session\'s note. Its XP stays as it was.')));
    return;
  }

  const finish = el('button', { class: 'gv-btn-finish', type: 'button', onclick: () => finishSession(ctx, draft) },
    el('span', {}, 'Save session'));
  /* This button IS the destructive route, so its own confirm may say so —
     what was wrong was the SHEET that every exit shared being titled that
     way. Kept as a ConfirmModal for that reason: there is no fork here. */
  const discard = el('button', { class: 'gv-btn-discard', type: 'button', onclick: askDiscard }, 'Discard');
  root.append(el('div', { class: 'gv-log-foot' }, finish, discard,
    el('p', { class: 'gv-microcopy' }, "The bar isn't going to climb itself.")));
}

/* Whole minutes of the workout so far, by the ONE gap rule (draft-store.
   countedElapsedMs): the clock label here, the complete tile and the saved note
   (sessionMinutes below) all read it. A session left open for 15 hours after its
   last tick must not read 900. */
function elapsedMinutes(draft, now = Date.now()) {
  return Math.max(0, Math.round(countedElapsedMs(draft, now) / 60000));
}

function elapsed(draft) {
  return `${elapsedMinutes(draft)} min`;
}

function entryCard(ctx, draft, entry, ei, onFigure) {
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
  /* Last time, best set, most reps (issue #28): what you need sitting down
     at the machine, without leaving the log. */
  /* An edit's own note is not "last time" for itself. */
  const history = draft.editing ? ctx.data.workouts.filter(w => !(w.file && w.file.path === draft.editing)) : ctx.data.workouts;
  const recap = recapEl(history, entry, 'gv-log-recap');
  if (recap) card.append(recap);

  const rows = el('div', { class: 'gv-log-sets' });
  entry.sets.forEach((set, si) => rows.append(setRow(ctx, entry, set, si, onFigure)));
  card.append(rows);

  const addSet = el('button', { class: 'gv-add-line gv-add-set', type: 'button' }, ico('plus'), el('span', {}, 'Set'));
  addSet.addEventListener('click', () => {
    const prev = entry.sets[entry.sets.length - 1] || {};
    // Copied values are prefills too — the new set must not count untouched.
    entry.sets.push(entry.distance
      ? { distance_km: '', minutes: '', done: false, touched: false }
      : { reps: prev.reps ?? '', weight_kg: prev.weight_kg ?? '', seconds: prev.seconds ?? '', done: false, touched: false });
    markActive(ctx);
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

function setRow(ctx, entry, set, si, onFigure) {
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
  }, v => { set[key] = v; set.touched = true; markTyped(set, key); keepDraft(ctx); if (onFigure) onFigure(); });

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
  done.addEventListener('click', () => { set.done = !set.done; markActive(ctx); ctx.rerender(); });
  row.append(done);
  return row;
}

/* Remember (or forget) that motion counting is ON for an exercise, on its
   note. Written only when it changes — the toggle reports every tap, the note
   should only be touched when it actually differs. A plan line with no note
   behind it has nothing to write to (the guided screen still honours the
   toggle for the session; the log's counter simply starts fresh next time).
   Shared with the guided screen so the two cannot disagree. */
function saveMotionPref(ctx, ex, on) {
  if (!ex || !ex.file) return;
  if (motionPref(ex.fm) === !!on) return;
  setMotionPref(ex.fm, !!on);
  Promise.resolve(ctx.io.saveExercise(ex)).catch(e => console.error('gym-vault motion preference', e));
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
      accent: accentFor(ctx.settings),
      settings: ctx.settings,
      sensitivity: ex && ex.fm ? ex.fm.motion_sensitivity : null,
      onSensitivity: value => {
        if (!ex || !ex.file) return;
        ex.fm.motion_sensitivity = value;
        Promise.resolve(ctx.io.saveExercise(ex)).catch(e => console.error('gym-vault sensitivity', e));
      },
      /* Whether motion counting is ON is remembered per exercise the same
         way (`motion_counting` on the note). */
      motionPref: motionPref(ex && ex.fm),
      onMotionPref: on => saveMotionPref(ctx, ex, on),
      onDone: count => {
        set.reps = String(count);
        set.touched = true;
        markTyped(set, 'reps');
        markActive(ctx);
        ctx.rerender();
      },
    }).open();
  });
  return b;
}

/* A timed schedule's intervals hold a POSITIONAL entryIndex into
   draft.entries (see timed-plan.js), not a reference to the entry itself.
   Splicing draft.entries during a timed session leaves every interval after
   the removed one pointing at the WRONG entry — remove entry 0 and an
   interval still named "Push-ups" writes its reps into Squats, while the
   last interval indexes past the end and is silently dropped. Re-keying the
   schedule to match belongs to the lane that owns timed-plan.js; this side
   only has to refuse the removal while a timed draft is live. */
function removeBtn(ctx, draft, ei) {
  const locked = !!draft.timed;
  const b = el('button', {
    class: 'gv-icon-btn gv-icon-btn-small', type: 'button',
    'aria-label': locked ? 'Remove exercise — finish or discard the timed session first' : 'Remove exercise',
  }, ico('x'));
  if (locked) b.disabled = true;
  b.addEventListener('click', () => {
    if (locked) { ctx.notice('Finish or discard the timed session first — removing an exercise mid-clock would log the rest against the wrong one.'); return; }
    draft.entries.splice(ei, 1);
    markActive(ctx);
    ctx.rerender();
  });
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
      markActive(ctx);
      ctx.rerender();
    },
  }).open();
}

/* setCounts alone says "this set was ticked or holds a typed figure" — it
   does not ask whether a DISTANCE set's own two fields (km, min) are both
   still empty. Ticking "done" on a run entry with neither filled in used to
   sail straight through, so an accidental tap saved a row of nothing:
   `distance_km: ''`, `seconds: ''` — junk history with no distance and no
   time. A plain reps entry is deliberately NOT touched by this: `reps: '0'`
   is a real "I failed the set" signal Ruan has not decided to discard, and
   setCounts already treats it as worth saving. Shared by buildRows (which
   SAVES rows) and the on-screen tally, so what you see before Finish and
   what lands on disk still agree. */
function setWorthSaving(entry, set) {
  if (!setCounts(set)) return false;
  if (entry.distance && !String(set.distance_km ?? '').trim() && !String(set.minutes ?? '').trim()) return false;
  return true;
}

/* The one rows-shaping rule, shared by finishSession (which SAVES it) and
   page-session.js (which builds a synthetic in-memory workout from it to
   check goal progress mid-session, without ever writing to disk) — two
   copies of "what a saved row looks like" is exactly how this codebase
   grows wrong numbers (see stats.js's header comment). */
/* A row for the table, with the hand-added columns its set was loaded with (an
   edit of a saved note; a live set has none). */
const withExtra = (set, row) => {
  if (Array.isArray(set.extra) && set.extra.length) row[ROW_EXTRA] = set.extra.slice();
  return row;
};

function buildRows(draft) {
  const rows = [];
  for (const entry of draft.entries) {
    let n = 0;
    for (const set of entry.sets) {
      if (!setWorthSaving(entry, set)) continue;
      n++;
      if (entry.distance) {
        /* The ONLY minutes->seconds conversion (timed-plan.secondsFromMinutes,
           the same one a timed run adds its intervals through): the column is
           seconds, the input is minutes because nobody logs a 30-minute run as
           1800. */
        const secs = secondsFromMinutes(set.minutes);
        rows.push(withExtra(set, {
          exercise: entry.exercise, set: n, reps: '', weight_kg: '',
          seconds: secs !== null ? String(secs) : '',
          note: rowNote(set), distance_km: String(set.distance_km ?? '').trim(),
        }));
      } else {
        /* seconds is written whenever the set HAS them, not only for
           duration entries. For every pre-existing path this changes
           nothing — makeEntry leaves seconds empty on a reps entry and no
           screen ever filled it. What it buys: a timed circuit (see
           timed-plan.js) measures real time on a rep exercise too, so a
           push-up interval can log "15 reps, 45 s" instead of throwing away
           the one figure the clock actually knew. */
        /* note and distance_km: only a set built from a saved note (an edit,
           #27) carries either, so a live set still writes both empty. */
        rows.push(withExtra(set, {
          exercise: entry.exercise, set: n,
          reps: entry.duration ? '' : String(set.reps).trim(),
          weight_kg: entry.duration ? '' : String(set.weight_kg).trim(),
          seconds: String(set.seconds ?? '').trim(),
          note: rowNote(set), distance_km: String(set.distance_km ?? '').trim(),
        }));
      }
    }
  }
  return rows;
}

/* A row's Note column. The log has no box for it; a set read back from a saved
   note keeps the one it had, so editing other figures does not erase it. */
const rowNote = set => String(set.note ?? '').trim();

/* THE ONE MINUTES RULE FOR A FINISHED SESSION. duration_min used to be the
   time the log page had been open, so a 30-minute run entered afterwards
   saved `1` and History read "1 SET - 1 MIN". The work you entered is a floor:
   the sum of the counted sets' seconds (a run's minutes are already seconds in
   buildRows, the one shaping rule - so this cannot disagree with what is
   saved). It is never a REDUCTION: a live session whose clock ran longer than
   its entered work keeps the clock. page-session's completion tile calls this
   too, so the tile and the saved note agree. */
function sessionMinutes(draft, now = Date.now()) {
  /* The clock is the workout's length by the one gap rule (draft-store.
     countedElapsedMs), not the time since the draft was created: a session left
     open for 15 hours after its last tick is not a 900-minute workout (audit 16
     Nov 2026, #8). */
  const elapsedMin = countedElapsedMs(draft, now) / 60000;
  let workSec = 0;
  for (const r of buildRows(draft)) {
    const sec = parseFloat(r.seconds);
    if (Number.isFinite(sec) && sec > 0) workSec += sec;
  }
  return Math.max(1, Math.round(elapsedMin), Math.round(workSec / 60));
}

/* WHAT IS SAVED AS THE LENGTH. Today's session: sessionMinutes. A session logged
   for an EARLIER day (the date control, audit 25 Nov 2026 #21) has no clock -
   the minutes this page was open today are not how long that workout took, and
   saved a misleading `duration_min: 1`. It keeps only the time actually
   entered (holds, a run's minutes); with none, no length is written at all. */
function savedMinutes(draft, today = todayISO(), now = Date.now()) {
  if (draft.date === today) return sessionMinutes(draft, now);
  let workSec = 0;
  for (const r of buildRows(draft)) {
    const sec = parseFloat(r.seconds);
    if (Number.isFinite(sec) && sec > 0) workSec += sec;
  }
  const min = Math.round(workSec / 60);
  return min > 0 ? min : undefined;
}

async function finishSession(ctx, draft) {
  /* An edit of a saved note is an update, by whatever route it gets here: never
     a second note, never a second award. */
  if (draft && draft.editing) return saveEdit(ctx, draft);
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
  const duration_min = savedMinutes(draft);
  let path;
  try {
    path = await ctx.io.saveWorkout({ date: draft.date, plan: draft.plan, day: draft.day, duration_min, rows });
  } catch (e) {
    draft.finishing = false;
    ctx.notice(`could not save the session (${e.message || e})`);
    return;
  }
  /* THE ONE PLACE XP IS WRITTEN (rewards-flow.js). Here, after the note exists and
     under the finishing guard above, so a session abandoned without saving earns
     nothing and a second tap cannot pay twice. It never throws and is given a
     moment at most: a failed or slow award does not fail or hold up a finished
     session.

     THE NOTE EXISTS, SO THE DRAFT STOPS BEING RESUMABLE NOW (audit 25 Nov 2026,
     #4). It used to be cleared only after the award (up to 1.5 s): backgrounding
     the app in that window kept it on the device again, it came back as
     "Session in progress", and finishing it wrote a second note and paid XP
     twice. The award is STARTED first - awardFinished reads the records a guided
     session found (ctx.state.session / the carry for THIS draft) before its first
     await - and works from the local `draft` from then on. Clearing the accessor
     clears the stored copy, and with no live draft the controller's keepDraft
     has nothing to write back while the award runs. Only THIS draft is cleared:
     anything newer is not ours to drop. */
  const awarding = rewardsFlow.awardWithin(ctx, draft, rows, path, rewardsFlow.flow.AWARD_WAIT_MS);
  if (ctx.state.logDraft === draft) ctx.state.logDraft = null;
  const award = await awarding;
  ctx.notice(award && award.xp ? `Session logged. Strong work. +${award.xp} XP` : 'Session logged. Strong work.');
  ctx.nav('dashboard');
  ctx.reload();
}

module.exports = { render, startDraft, growToSchedule, setsInDraft, buildRows, finishSession, sessionMinutes, savedMinutes, elapsedMinutes, keepDraft, saveMotionPref, startEdit, editDraftFrom };
