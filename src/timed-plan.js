'use strict';
/* Builds the interval schedule for a TIMED guided session. Pure — no DOM, no
   obsidian import, no clock — so every edge (odd durations, a circuit longer
   than the session, one exercise, none at all) is unit-testable without a
   browser. Same discipline as session-flow.js: this module decides WHAT
   happens and in what order; page-session.js owns rendering and side effects.

   THE SHAPE: a timed session is a flat list of intervals played in order.

     lead-in → [ transition → work ] × n → cool-down

   `work` intervals are the only ones that touch the draft. Each carries the
   {entryIndex, setIndex} of the set it completes, so a finished interval
   writes into the exact same draft.entries[i].sets[j] object the log overview
   shows — ONE DRAFT, TWO VIEWS holds in timed mode too, and Finish, history,
   records and goals all work unchanged.

   Warm-up, cool-down, lead-in and transition intervals carry entryIndex:null
   and are NOT logged. They are the app's suggestion, not the plan's
   prescription: the plan note stays the source of truth for what the session
   WAS, and a generic warm-up the user never chose has no business appearing
   in their history.

   HOW LONG IS ONE EXERCISE? A duration target answers for itself — a plan
   that says `Plank | 1 x 90s` gets a 90-second interval, because that IS the
   prescription. Everything else gets config.workSeconds, and its rep target
   rides along on the interval as guidance the screen can show ("~15 reps").
   A timer cannot count your push-ups; it can tell you how long to keep
   doing them. */

const { targetFirstNumber, targetDurationSeconds } = require('./plan-parse');

/* Every duration below is seconds. These are the defaults a fresh install
   uses; the setup screen persists whatever the user picks over them. */
const TIMED_DEFAULTS = {
  minutes: 30,
  warmup: false,
  cooldown: false,
  shuffle: false,
  transitions: true,
  workSeconds: 45,       // one interval of an exercise with no duration target
  transitionSeconds: 10, // the "next up" breather between exercises
  leadInSeconds: 5,      // always present — starting cold on rep one is hostile
  warmupSeconds: 180,
  cooldownSeconds: 120,
};

/* No interval is ever shorter than this. Guards against a hand-written
   `| 1 x 2s` (and against a config someone edited to zero) turning the
   session into a strobe. */
const MIN_INTERVAL_S = 5;
/* Backstop only — a 60-minute session of 5-second intervals is ~720. Nothing
   legitimate approaches this; it exists so a bad `workSeconds` can never spin
   the loop forever. */
const MAX_INTERVALS = 2000;

/* Deterministic shuffle. Math.random() would make the shuffle untestable and
   this module unreproducible; the caller passes a seed (the page uses the
   clock, tests use a constant) and identical inputs always give an identical
   session. */
function rng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* Fisher-Yates over INDICES, never over the items themselves: a work
   interval's entryIndex must keep pointing at the item's original position,
   because that is what indexes draft.entries. Shuffling the items would
   silently log every exercise against the wrong set. */
function shuffledIndices(n, next) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

/* How long one interval of this exercise runs. A duration prescription wins
   over the generic default — `Plank | 1 x 90s` means 90 seconds, and quietly
   replacing that with 45 would be the app overruling the plan.

   This test is deliberately looser than page-log's makeEntry, which only
   falls back to the target when the exercise has NO unit. The two answer
   different questions and are allowed to disagree: makeEntry decides which
   BOXES the set shows, this decides how long the CLOCK runs. An exercise
   logged in reps whose plan line says `30s` should still run for 30 seconds
   — the author wrote a duration, so honour it — while still offering a rep
   box, because reps are what gets logged. Don't "fix" this into agreement. */
function workSecondsFor(item, config) {
  const target = (item && item.target) || '';
  /* A WRITTEN unit wins over the note's `unit:` field: "30 min easy" is
     thirty minutes however the exercise note is filled in, and this used to
     read it as thirty SECONDS. */
  const written = targetDurationSeconds(target);
  if (written) return Math.max(MIN_INTERVAL_S, written);
  /* No unit written, but the note says this exercise is measured in seconds
     — then the bare number is seconds, as it always was. */
  if (item && item.unit === 'seconds') {
    const n = targetFirstNumber(target);
    if (Number.isFinite(n) && n > 0) return Math.max(MIN_INTERVAL_S, Math.round(n));
  }
  return Math.max(MIN_INTERVAL_S, Math.round(config.workSeconds));
}

/* Spread a fixed budget across a handful of named moves, never below the
   floor. Used for both warm-up and cool-down; an empty list schedules
   nothing at all rather than an empty block of dead time. */
function blockIntervals(names, totalSeconds, kind) {
  const list = (names || []).filter(Boolean);
  if (!list.length || totalSeconds <= 0) return [];
  const each = Math.max(MIN_INTERVAL_S, Math.round(totalSeconds / list.length));
  return list.map(exercise => ({
    kind, exercise, seconds: each, entryIndex: null, setIndex: null, round: null, target: '', unit: null,
  }));
}

/* items: [{exercise, target, unit}] — plan items enriched with the unit from
   the vault's own exercise note (the caller resolves that; this module never
   touches ctx.data).
   Returns {intervals, rounds, setsPerEntry, totalSeconds, workTotalSeconds}. */
function buildSchedule(items, config) {
  const cfg = { ...TIMED_DEFAULTS, ...(config || {}) };
  const list = (items || []).filter(it => it && it.exercise);
  const intervals = [];
  const setsPerEntry = list.map(() => 0);

  if (!list.length) {
    return { intervals, rounds: 0, setsPerEntry, totalSeconds: 0, workTotalSeconds: 0 };
  }

  const budget = Math.max(MIN_INTERVAL_S, Math.round(cfg.minutes * 60));
  const warm = cfg.warmup ? blockIntervals(cfg.warmupItems, cfg.warmupSeconds, 'warmup') : [];
  const cool = cfg.cooldown ? blockIntervals(cfg.cooldownItems, cfg.cooldownSeconds, 'cooldown') : [];
  const spent = arr => arr.reduce((n, i) => n + i.seconds, 0);

  /* Warm-up and cool-down come out of the time the user asked for, not on
     top of it: "30 minutes" has to mean 30 minutes, or the toggles silently
     turn a lunch-break session into 35 minutes. */
  const leadIn = Math.max(0, Math.round(cfg.leadInSeconds));
  let remaining = budget - spent(warm) - spent(cool) - leadIn;

  intervals.push(...warm);
  if (leadIn > 0) {
    intervals.push({
      kind: 'transition', leadIn: true, exercise: list[0].exercise, seconds: leadIn,
      entryIndex: null, setIndex: null, round: null, target: '', unit: null,
    });
  }

  let round = 0;
  let placedWork = 0;
  /* Grow the session one interval at a time until the next one would not
     fit. Nothing is ever truncated to fill the last few seconds — half a
     90-second plank is a different exercise, and a session that ends 40
     seconds early is honest where a clipped hold is not. */
  outer:
  while (intervals.length < MAX_INTERVALS) {
    const order = cfg.shuffle
      ? shuffledIndices(list.length, rng((Number(cfg.seed) || 1) + round))
      : list.map((_, i) => i);

    for (const entryIndex of order) {
      const item = list[entryIndex];
      const work = workSecondsFor(item, cfg);
      const gap = (cfg.transitions && placedWork > 0) ? Math.max(0, Math.round(cfg.transitionSeconds)) : 0;

      /* Always place the FIRST work interval, whatever the budget says: a
         one-minute session still has to be a session, not an empty screen. */
      if (placedWork > 0 && work + gap > remaining) break outer;

      if (gap > 0) {
        intervals.push({
          kind: 'transition', leadIn: false, exercise: item.exercise, seconds: gap,
          entryIndex: null, setIndex: null, round, target: '', unit: null,
        });
      }
      intervals.push({
        kind: 'work', exercise: item.exercise, seconds: work,
        entryIndex, setIndex: setsPerEntry[entryIndex], round,
        target: item.target || '', unit: item.unit || null,
      });
      setsPerEntry[entryIndex]++;
      placedWork++;
      remaining -= work + gap;
    }
    round++;
  }

  intervals.push(...cool);

  /* Rounds STARTED, not rounds completed. `round` above only increments on a
     full pass, so a session of two full circuits plus five more exercises
     left it reading 2 — while the last of those five carries round:2 and the
     session header dutifully announced "Round 3". The preview and the live
     header have to agree, or the preview reads as a bug. */
  const lastWork = intervals.filter(i => i.kind === 'work').pop();
  return {
    intervals,
    rounds: lastWork ? lastWork.round + 1 : 0,
    setsPerEntry,
    totalSeconds: spent(intervals),
    workTotalSeconds: spent(intervals.filter(i => i.kind === 'work')),
  };
}

/* Only work intervals index the draft, and only they should be counted as
   "exercise 3 of 12" on screen. */
const workIntervals = schedule => (schedule.intervals || []).filter(i => i.kind === 'work');

/* Where the session should start or resume: the first work interval whose set
   has not already been handled, honouring anything ticked on the log overview
   before guided mode opened. Returns intervals.length once everything is
   done.

   Two different answers, deliberately:
     - NOTHING done yet → index 0, so the warm-up you switched on actually
       happens. Resuming "just before the first exercise" would silently eat
       the whole warm-up block on every fresh start.
     - Mid-session → the transition immediately before the target, so you get
       a run-up instead of landing cold on a live timer. It never rewinds
       further than that: a warm-up you already did is not repeated. */
function initialIndex(schedule, draft, isHandled) {
  const intervals = (schedule && schedule.intervals) || [];
  let firstWork = true;
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i];
    if (iv.kind !== 'work') continue;
    const entry = draft && draft.entries && draft.entries[iv.entryIndex];
    const set = entry && entry.sets && entry.sets[iv.setIndex];
    if (!set || !isHandled(set)) {
      if (firstWork) return 0;
      const prev = intervals[i - 1];
      return prev && prev.kind === 'transition' ? i - 1 : i;
    }
    firstWork = false;
  }
  return intervals.length;
}

module.exports = {
  TIMED_DEFAULTS, MIN_INTERVAL_S, buildSchedule, workSecondsFor, workIntervals, initialIndex,
};
