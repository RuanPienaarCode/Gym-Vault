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
    };
  }
  return ctx.state.setupUi;
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
    const sets = day.items.reduce((n, it) => n + itemSets(it), 0);
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

   iOS only permits speechSynthesis once a page has spoken from inside a
   real user-gesture call stack. Every other speak() in this app is called
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
    startDraft(ctx, plan, day);
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

module.exports = { render };
