'use strict';
/* Guided-session setup — the one screen between "Get after it" and the
   session itself. It answers three questions before you are standing on a
   mat: how am I being guided, how long have I got, and what do I need to
   fetch.

   Nothing here writes to disk and nothing creates a draft until Start: back
   out and the vault is untouched. The choices are remembered in settings, so
   a regular taps straight through.

   TWO WAYS TO BE GUIDED, and they are genuinely different sessions:
     - reps  — the original. One set at a time, you decide when it is done.
               The draft is the plan's own prescription.
     - timed — a circuit on the clock (see timed-plan.js). The schedule
               decides how many rounds fit the time you asked for, so the
               DRAFT is built to match the schedule rather than the plan's
               set counts (startDraft's setsPerEntry). Get that backwards and
               the log fills with empty sets nothing ever played. */

const { el, ico, clickableCard, toggleRow } = require('./dom');
const { GUIDE_MODES, GUIDE_MINUTES, DEFAULT_SETTINGS } = require('./constants');
const { equipmentFor } = require('./equipment');
const { buildSchedule, workIntervals } = require('./timed-plan');
const { musicRow } = require('./music-picker');
const { sameName } = require('./stats');
const { itemSets } = require('./plan-parse');
const { startDraft } = require('./page-log');
const sound = require('./sound');

/* How many moves a warm-up / cool-down block is built from. timed-plan.js
   splits its seconds budget evenly across them, so these are really "how
   many things do you want to be told to do", not durations. */
const WARMUP_MOVES = 4;
const COOLDOWN_MOVES = 3;

/* Mobility work that needs no kit — a warm-up that sends you hunting for a
   resistance band is not a warm-up. Empty equipment counts: a note that
   never filled the field is not thereby a banded exercise. */
const NO_KIT = new Set(['', 'bodyweight', 'none']);

/* Which end of a session a mobility move belongs at. A heuristic over the
   NAME, deliberately: there is no frontmatter that distinguishes "loosen up"
   from "wind down", and inventing one would mean re-authoring every note in
   the shared library. Wrong guesses cost the user a stretch in the warm-up
   rather than anything that matters, and either list falls back to the whole
   pool when the split leaves it empty. */
const WINDS_DOWN = /stretch|pose|twist|breathing/i;

function clampMinutes(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.guideMinutes;
  return Math.min(GUIDE_MINUTES.max, Math.max(GUIDE_MINUTES.min, v));
}

/* Seeded from settings once per visit. `seed` is fixed here rather than at
   Start so the preview below and the session you actually get are the same
   shuffle — a preview that lies about the order is worse than no preview. */
function uiState(ctx) {
  if (!ctx.state.setupUi) {
    const s = ctx.settings || {};
    ctx.state.setupUi = {
      mode: s.guideMode === 'timed' ? 'timed' : 'reps',
      minutes: clampMinutes(s.guideMinutes),
      warmup: !!s.guideWarmup,
      cooldown: !!s.guideCooldown,
      shuffle: !!s.guideShuffle,
      transitions: s.guideTransitions !== false,
      seed: Date.now(),
      /* Per-exercise SET overrides for this session only, keyed by the day
         item's index. Deliberately not persisted and deliberately not
         written back to the plan: "three rounds today because my shoulder
         is sore" is a fact about today, not an edit to the programme. The
         plan note stays the source of truth; editing it is a different
         action on a different screen. */
      sets: {},
    };
  }
  return ctx.state.setupUi;
}

/* HOW MANY SETS OF THIS EXERCISE TODAY — the one answer, used by the
   stepper, the preview line, and the draft that Start actually builds.

   Split out the moment there was more than one caller. The preview saying
   "9 sets" while the session hands you 12 is precisely the "two figures
   derived by different rules" failure this codebase keeps finding, and a
   preview is the one place it would go unnoticed longest. */
function setsForItem(ui, item, index) {
  const override = ui && ui.sets ? ui.sets[index] : null;
  return override == null ? itemSets(item) : override;
}

function setsPerEntryFor(day, ui) {
  return ((day && day.items) || []).map((it, i) => setsForItem(ui, it, i));
}

/* THE LEVELLING RULES, kept pure and exported for the guard test. All the
   edge cases in "one field for every exercise" live here — a mixed plan
   must not be flattened before anyone touches the control, and one set is
   the floor — and none of them need a DOM to be wrong. */

/* One set is the floor: zero sets is not a lighter session, it is a missing
   exercise, and skipping one already has its own control inside the
   session. Ten is a ceiling against a stuck thumb. */
const SETS_MIN = 1;
const SETS_MAX = 10;
const nextSetsValue = (base, delta) => Math.max(SETS_MIN, Math.min(SETS_MAX, base + delta));

/* The count every exercise currently resolves to, or null when they differ.
   The single source for what the one field is allowed to claim: showing a
   number over a plan that varies is the "two figures derived by different
   rules" failure this codebase keeps finding, and the preview total
   underneath would contradict it. */
function uniformSets(items, ui) {
  const list = items || [];
  if (!list.length) return null;
  const first = setsForItem(ui, list[0], 0);
  return list.every((it, i) => setsForItem(ui, it, i) === first) ? first : null;
}

/* Stepping out of a mixed plan has to start somewhere the user recognises:
   the count most of the exercises already carry. Ties break high — of "some
   3s and some 1s", 3 is the session you were more nearly going to do. */
function mostCommonSets(planned) {
  const tally = new Map();
  for (const n of planned || []) tally.set(n, (tally.get(n) || 0) + 1);
  if (!tally.size) return SETS_MIN;
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/* Writes one count across every index. Keyed by index because that is what
   setsPerEntryFor reads and what startDraft receives — one path from "how
   many sets" to a draft, not two. */
function levelSets(ui, count, n) {
  for (let i = 0; i < count; i++) ui.sets[i] = n;
  return ui.sets;
}

function unitOf(ctx, name) {
  const ex = (ctx.data.exercises || []).find(e => sameName(e.name, name));
  return ex && ex.fm ? ex.fm.unit || null : null;
}

/* Every mobility move in the library that needs no kit, ORDERED BY HOW
   RELEVANT IT IS TO THIS USER: moves their own plans already prescribe come
   first, then the rest of the library.

   That ordering is the whole point. A vault holding both a kettlebell plan
   and a postpartum rehab plan has "Pelvic Floor Activation" and "Heel
   Slides" sitting in the same mobility bucket as "Cat-Cow", and offering
   those as the warm-up for a kettlebell session is the kind of detail that
   makes a feature feel like it was not thinking. Preferring what the user's
   own programmes use costs one pass over the plans and fixes it. */
function mobilityPool(ctx) {
  const pool = (ctx.data.exercises || []).filter(e => {
    const fm = e.fm || {};
    if (String(fm.type || '').toLowerCase() !== 'mobility') return false;
    return NO_KIT.has(String(fm.equipment || '').trim().toLowerCase());
  });
  const inPlans = new Set();
  for (const p of (ctx.data.plans || [])) {
    for (const d of ((p.model && p.model.days) || [])) {
      for (const it of (d.items || [])) inPlans.add(String(it.exercise || '').trim().toLowerCase());
    }
  }
  const known = e => inPlans.has(e.name.trim().toLowerCase());
  return pool.filter(known).concat(pool.filter(e => !known(e)));
}

function splitPool(pool) {
  const loosen = pool.filter(e => !WINDS_DOWN.test(e.name));
  const wind = pool.filter(e => WINDS_DOWN.test(e.name));
  const warmup = (loosen.length ? loosen.concat(wind) : wind).slice(0, WARMUP_MOVES).map(e => e.name);
  /* Only keep warm-up and cool-down apart when the library is big enough to
     afford it — with three mobility notes, repeating one beats scheduling
     nothing. */
  const rest = pool.length > WARMUP_MOVES + 1 ? pool.filter(e => !warmup.includes(e.name)) : pool;
  const restWind = rest.filter(e => WINDS_DOWN.test(e.name));
  const restLoosen = rest.filter(e => !WINDS_DOWN.test(e.name));
  const cooldown = (restWind.length ? restWind.concat(restLoosen) : restLoosen).slice(0, COOLDOWN_MOVES).map(e => e.name);
  return { warmup, cooldown };
}

function scheduleFor(ctx, day, ui) {
  const items = ((day && day.items) || []).map(it => ({
    exercise: it.exercise, target: it.target, unit: unitOf(ctx, it.exercise),
  }));
  const blocks = splitPool(mobilityPool(ctx));
  return buildSchedule(items, {
    minutes: ui.minutes,
    warmup: ui.warmup, cooldown: ui.cooldown,
    shuffle: ui.shuffle, transitions: ui.transitions,
    seed: ui.seed,
    warmupItems: blocks.warmup, cooldownItems: blocks.cooldown,
  });
}

const mins = secs => Math.max(1, Math.round(secs / 60));

/* ---------- render ---------- */

/* Re-resolve the plan and day from ctx.data on every render (controller.js's
   ctx.startGuided stores names, not references). A vault change while the
   user is choosing replaces ctx.data wholesale, and this screen must follow
   it rather than act on a snapshot. A plan that has since been deleted or
   renamed resolves to nothing, and the screen bows out to the dashboard —
   which is the right answer, not an error. */
function resolveSetup(ctx) {
  const setup = ctx.state.setup;
  if (!setup) return null;
  const plan = (ctx.data.plans || []).find(p => p.name === setup.plan) || null;
  if (!plan) return null;
  const days = (plan.model && plan.model.days) || [];
  const day = days.find(d => d.name === setup.day)
    || (setup.dayIndex >= 0 ? days[setup.dayIndex] : null)
    || null;
  return day ? { plan, day } : null;
}

function render(ctx, root) {
  const resolved = resolveSetup(ctx);
  if (!resolved) { ctx.state.setup = null; ctx.nav('dashboard'); return; }
  const { plan, day } = resolved;
  const ui = uiState(ctx);

  ctx.state.pageCleanup = () => { ctx.state.setupUi = null; };

  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Back' }, ico('arrow-left'));
  back.addEventListener('click', () => { ctx.state.setup = null; ctx.nav('dashboard'); });
  root.append(el('div', { class: 'gv-toolbar' },
    back,
    el('h2', { class: 'gv-toolbar-title' }, day.name || 'Session')));
  if (plan) root.append(el('p', { class: 'gv-hero-sub gv-setup-lede' }, plan.name));

  root.append(equipmentBlock(ctx, day));

  /* Reps mode only. In a timed circuit the CLOCK decides how many rounds
     fit, so a set count typed here would be overwritten by the schedule the
     moment it was built — offering it would be offering a control that does
     nothing. */
  /* Assigned below, once the preview element exists. The stepper is built
     before it and needs to poke it, so the indirection is the cheap way to
     keep both in one render pass. */
  let refreshPreview = () => {};
  if (ui.mode === 'reps') root.append(setsBlock(ctx, day, ui, () => refreshPreview()));

  /* How you want to be guided. */
  root.append(el('div', { class: 'gv-section-title' }, ico('play'), el('span', {}, 'Guide')));
  const modes = el('div', { class: 'gv-card-list' });
  for (const [key, name, desc] of GUIDE_MODES) {
    const on = ui.mode === key;
    modes.append(clickableCard(
      { class: `gv-card gv-optrow${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': name },
      () => { ui.mode = key; ctx.rerender(); },
      el('div', { class: 'gv-optrow-main' },
        el('div', { class: 'gv-optrow-name' }, name),
        el('div', { class: 'gv-optrow-desc' }, desc || '')),
      on ? ico('circle-check', 'gv-optrow-tick') : ''));
  }
  modes.setAttribute('role', 'radiogroup');
  modes.setAttribute('aria-label', 'How to be guided');
  root.append(modes);

  /* NOT .gv-microcopy: the Editorial skin hides that class outright
     (styles.css), and this line is the only place the screen says how many
     rounds you are about to do. Flourish can be hidden; the answer cannot. */
  const preview = el('p', { class: 'gv-setup-preview', 'aria-live': 'polite' });
  const start = el('button', { class: 'gv-btn-go', type: 'button' });

  /* The dial updates in place rather than re-rendering (a re-render mid-drag
     loses the slider), so everything that quotes the minutes has to be
     refreshed from here — including the Start button, which otherwise still
     offers "Start 30 minutes" after you have dialled it to 45. */
  const refresh = () => {
    while (preview.firstChild) preview.removeChild(preview.firstChild);
    preview.append(previewText(ctx, day, ui));
    start.textContent = ui.mode === 'timed' ? `Start ${ui.minutes} minutes` : 'Start session';
  };
  refreshPreview = refresh;

  if (ui.mode === 'timed') {
    root.append(minutesBlock(ctx, ui, refresh));
    root.append(togglesBlock(ctx, ui));
  }

  const music = musicRow(ctx);
  if (music) {
    root.append(el('div', { class: 'gv-section-title' }, ico('music'), el('span', {}, 'Sound')));
    root.append(music);
  }

  refresh();
  root.append(preview);

  start.addEventListener('click', () => beginSession(ctx, plan, day, ui));
  root.append(el('div', { class: 'gv-hero-action gv-setup-start' }, start));
}

/* TODAY'S SETS — ONE FIELD FOR THE WHOLE SESSION.

   This was nine steppers, one per exercise, and on a nine-move circuit it
   filled the screen with a column of near-identical rows that all said the
   same number. Nobody sets a different count per exercise on the way into a
   circuit; they decide how many times round they are going today. So it is
   one control that levels every exercise.

   Nothing here writes to disk and nothing exists until Start — same promise
   the rest of this screen makes, and the same reason `ui.sets` is not a plan
   edit: "two rounds today because my shoulder is sore" is a fact about
   today. Per-exercise counts are still expressible; they live in the plan's
   own EDIT mode, which is where the programme is authored.

   MIXED PLANS ARE NOT FLATTENED ON SIGHT. A plan may legitimately ask for 3
   of the squats and 1 of the plank. Until this control is touched, every
   exercise keeps its own count and the field reads "Mixed" — showing a
   single number over a plan that varies would be the "two figures derived by
   different rules" failure this codebase keeps finding, and the total in the
   preview line underneath would contradict it. The first press levels them,
   and says so before it does. */
function setsBlock(ctx, day, ui, onChange) {
  const items = (day && day.items) || [];
  if (!items.length) return el('div', {});

  const planned = items.map(it => itemSets(it));
  const uniformNow = () => uniformSets(items, ui);
  const overridden = () => Object.keys(ui.sets || {}).length > 0;

  const wrap = el('div', {});
  wrap.append(el('div', { class: 'gv-section-title' }, ico('list'), el('span', {}, 'Sets')));

  const countEl = el('div', { class: 'gv-setsrow-n', 'aria-live': 'polite' });
  const noteEl = el('div', { class: 'gv-setsrow-target' });
  const reset = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small gv-setsall-reset', type: 'button' }, 'Back to the plan');

  const draw = () => {
    const n = uniformNow();
    countEl.textContent = n === null ? 'Mixed' : String(n);
    /* The figure is the display face when it is a number, and ordinary text
       when it is the word — "Mixed" in the condensed display face at 22px
       reads as a heading, not a value. */
    countEl.classList.toggle('word', n === null);
    noteEl.textContent = n === null
      ? `The plan varies — this levels all ${items.length}`
      : `${items.length} exercise${items.length === 1 ? '' : 's'}, ${n} each`;
    row.classList.toggle('changed', overridden());
    /* BOTH ends, and both against the constants nextSetsValue clamps to —
       plus used to stay live at SETS_MAX because only the floor was wired.
       The number was never wrong (the clamp held); the control was, which
       is worse on a phone: a thumb keeps pressing a button that looks like
       it is doing something. A literal here would drift from the clamp the
       first time either bound moves. */
    minus.disabled = n !== null && n <= SETS_MIN;
    plus.disabled = n !== null && n >= SETS_MAX;
    reset.hidden = !overridden();
  };

  const step = delta => {
    const base = uniformNow() ?? mostCommonSets(planned);
    levelSets(ui, items.length, nextSetsValue(base, delta));
    draw();
    /* The preview quotes the total, so it has to move with the stepper —
       otherwise the line under the button contradicts the button. */
    if (onChange) onChange();
  };

  const minus = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'One fewer set of every exercise' }, ico('minus'));
  minus.addEventListener('click', () => step(-1));
  const plus = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'One more set of every exercise' }, ico('plus'));
  plus.addEventListener('click', () => step(1));

  /* Levelling a mixed plan is otherwise a one-way door inside this screen:
     once every index carries an override there is no way back to the plan's
     own counts without leaving and coming back. */
  reset.addEventListener('click', () => {
    ui.sets = {};
    draw();
    if (onChange) onChange();
  });

  const row = el('div', { class: 'gv-card gv-setsrow gv-setsall' },
    el('div', { class: 'gv-setsrow-main' },
      el('div', { class: 'gv-setsrow-name' }, 'Every exercise'),
      noteEl),
    el('div', { class: 'gv-setsrow-stepper' },
      minus,
      el('div', { class: 'gv-setsrow-count' }, countEl, el('div', { class: 'gv-setsrow-unit' }, 'sets')),
      plus));

  draw();
  wrap.append(row, reset);
  return wrap;
}

/* The Sworkit "Equipment" tile, and the first thing this app has ever done
   with the equipment field every exercise note has always carried. */
function equipmentBlock(ctx, day) {
  const names = ((day && day.items) || []).map(it => it.exercise);
  const kit = equipmentFor(ctx.data.exercises, names);
  const wrap = el('div', { class: 'gv-setup-kit' },
    el('div', { class: 'gv-kicker' }, 'Equipment'));
  if (!kit.length) {
    wrap.append(el('div', { class: 'gv-setup-kit-none' }, ico('user'), el('span', {}, 'No equipment — just you and the floor')));
    return wrap;
  }
  const chips = el('div', { class: 'gv-chips gv-setup-kit-chips' });
  for (const item of kit) chips.append(el('span', { class: 'gv-tag' }, item.label));
  wrap.append(chips);
  return wrap;
}

/* Big number, two buttons and a slider. All three drive the same value, and
   all three update the label and the preview IN PLACE rather than
   re-rendering — a slider that rebuilds the page mid-drag loses the drag. */
function minutesBlock(ctx, ui, refreshPreview) {
  const value = el('div', { class: 'gv-dial-value' }, String(ui.minutes));
  const live = el('div', { class: 'gv-sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const range = el('input', {
    class: 'gv-dial-range', type: 'range',
    min: String(GUIDE_MINUTES.min), max: String(GUIDE_MINUTES.max), step: String(GUIDE_MINUTES.step),
    value: String(ui.minutes), 'aria-label': 'Session length in minutes',
  });

  const apply = next => {
    ui.minutes = clampMinutes(next);
    value.textContent = String(ui.minutes);
    range.value = String(ui.minutes);
    live.textContent = `${ui.minutes} minutes`;
    refreshPreview();
  };

  const step = (delta, label) => {
    const b = el('button', { class: 'gv-dial-step', type: 'button', 'aria-label': label }, ico(delta < 0 ? 'minus' : 'plus'));
    b.addEventListener('click', () => apply(ui.minutes + delta));
    return b;
  };
  range.addEventListener('input', () => apply(range.value));

  return el('div', { class: 'gv-setup-dial' },
    el('div', { class: 'gv-dial-row' },
      step(-GUIDE_MINUTES.step, 'Five minutes less'),
      el('div', { class: 'gv-dial-readout' }, value, el('div', { class: 'gv-dial-unit' }, 'minutes')),
      step(GUIDE_MINUTES.step, 'Five minutes more')),
    range, live);
}

function togglesBlock(ctx, ui) {
  const pool = mobilityPool(ctx);
  const noMobility = pool.length === 0;
  const blocks = splitPool(pool);
  const why = 'No mobility exercises in your library yet — add one and this switches on.';
  /* Name the moves rather than promising "a warm-up". The app is choosing
     from the user's own library on a heuristic, and a heuristic the user can
     read is one they can disagree with — which beats being surprised by
     someone else's rehab drill halfway through a warm-up. */
  const names = list => (list.length ? list.join(', ') : '');

  const list = el('div', { class: 'gv-card-list' });
  list.append(toggleRow('Warm-up',
    noMobility ? why : `${names(blocks.warmup)}. Guidance only — not logged.`,
    ui.warmup && !noMobility,
    v => { ui.warmup = v; ctx.rerender(); },
    { disabled: noMobility }));
  list.append(toggleRow('Cool-down',
    noMobility ? why : `${names(blocks.cooldown)}. Guidance only — not logged.`,
    ui.cooldown && !noMobility,
    v => { ui.cooldown = v; ctx.rerender(); },
    { disabled: noMobility }));
  list.append(toggleRow('Shuffle exercises',
    'A different order every round, so the same circuit does not go stale.',
    ui.shuffle, v => { ui.shuffle = v; ctx.rerender(); }));
  list.append(toggleRow('Transitions',
    'A short breather between exercises that names the next one.',
    ui.transitions, v => { ui.transitions = v; ctx.rerender(); }));
  return list;
}

/* What you are about to get, in one line. Says "scheduled" rather than the
   number you dialled in, because whole intervals are never clipped to fill
   the last few seconds — a 28-minute session from a 30-minute dial is
   correct, and quietly printing "30" would be the screen lying. */
function previewText(ctx, day, ui) {
  const count = ((day && day.items) || []).length;
  if (!count) return 'Nothing on this day yet — add an exercise to the plan first.';
  if (ui.mode !== 'timed') {
    const sets = setsPerEntryFor(day, ui).reduce((n, v) => n + v, 0);
    return `${count} exercise${count === 1 ? '' : 's'} · ${sets} sets · you set the pace`;
  }
  const schedule = scheduleFor(ctx, day, ui);
  const work = workIntervals(schedule).length;
  if (!work) return 'Nothing scheduled — try a longer session.';
  const rounds = schedule.rounds;
  const parts = [
    `${rounds} round${rounds === 1 ? '' : 's'}`,
    `${work} interval${work === 1 ? '' : 's'}`,
    `${mins(schedule.totalSeconds)} min scheduled`,
  ];
  return parts.join(' · ');
}

/* ---------- start ---------- */

/* SYNCHRONOUS, ALL THE WAY INTO THE SESSION — and it has to stay that way.

   iOS only permits speech and audio once a page has used them from inside a
   real user-gesture call stack. Every other announcement in this app is made
   straight out of a tap handler, so it has always been fine. Timed mode is
   the first place speech fires on a TIMER (the interval announcement and the
   spoken "3, 2, 1"), which means the Start tap is the only gesture that can
   ever unlock it. An earlier version awaited saveSettings() — real disk I/O —
   before entering the session, which resolves on a later task and breaks the
   gesture chain: the whole session would then have run silently on a phone,
   with no error and nothing in the console to explain it.

   So: build the draft and enter guided mode in the click's own stack, and
   let the settings save happen afterwards on its own. Remembering the dial
   position is a convenience; the countdown you can hear is the feature. */
function beginSession(ctx, plan, day, ui) {
  /* FIRST LINE, SYNCHRONOUSLY — this call is the whole reason the comment
     above insists on an unbroken gesture stack. iOS unlocks BOTH
     speechSynthesis and AudioContext only for a page that has used them
     from inside a real user gesture, and timed mode is the one place this
     app makes a noise on a timer rather than on a tap. Do this before any
     of the work below, so an early `return` on an empty schedule cannot
     skip it. */
  sound.unlock();

  if (ui.mode === 'timed') {
    const schedule = scheduleFor(ctx, day, ui);
    if (!workIntervals(schedule).length) {
      ctx.notice('nothing to schedule — add an exercise to this day, or pick a longer session.');
      return;
    }
    /* The draft is built to the SCHEDULE's set counts, not the plan's. */
    startDraft(ctx, plan, day, { setsPerEntry: schedule.setsPerEntry });
    /* The schedule rides on the DRAFT, not on session UI state: leaving
       guided mode for the log overview and coming back must resume the same
       timed session, and ctx.enterGuided() throws session state away by
       design. */
    ctx.state.logDraft.timed = schedule;
  } else {
    /* Today's overrides, resolved against the plan for anything untouched.
       An empty object still produces a full array rather than undefined, so
       startDraft takes one code path whether or not anything was changed. */
    startDraft(ctx, plan, day, { setsPerEntry: setsPerEntryFor(day, ui) });
  }
  ctx.state.setup = null;
  ctx.enterGuided();

  /* Fire-and-forget, deliberately after the navigation above. A failure here
     costs the user a remembered dial position, nothing more, so it must
     never be allowed to delay — or fail — the session itself. */
  rememberSetup(ctx, ui);
}

function rememberSetup(ctx, ui) {
  try {
    Object.assign(ctx.plugin.settings, {
      guideMode: ui.mode,
      guideMinutes: ui.minutes,
      guideWarmup: ui.warmup,
      guideCooldown: ui.cooldown,
      guideShuffle: ui.shuffle,
      guideTransitions: ui.transitions,
    });
    ctx.settings = ctx.plugin.settings;
    Promise.resolve(ctx.plugin.saveSettings())
      .catch(e => console.error('gym-vault save guide settings', e));
  } catch (e) { console.error('gym-vault save guide settings', e); }
}

/* The levelling rules are exported alongside render for tests/session-sets
   .test.cjs — the screen itself needs a DOM, these do not. setsBlock goes
   with them so _preview/setsrow.html can render the REAL control: it used
   to hand-build a replica of this markup, which is a harness that silently
   stops matching what ships. */
module.exports = { render, setsBlock, setsForItem, setsPerEntryFor, uniformSets, mostCommonSets, nextSetsValue, levelSets, SETS_MIN, SETS_MAX };
