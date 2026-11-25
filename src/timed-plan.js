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
const { isOpenEnded } = require('./counter-target');

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
  extraSeconds: 0,       // handed back by skips during the session (giveTimeBack)
};

/* No interval is ever shorter than this. Guards against a hand-written
   `| 1 x 2s` (and against a config someone edited to zero) turning the
   session into a strobe. */
const MIN_INTERVAL_S = 5;
/* The last set may be cut to fit the clock, but not to less than this: below
   it the leftover goes on the set before instead of starting a new exercise
   for a few seconds. */
const MIN_CUT_SET_S = 15;
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

/* A RUN WRITTEN AS ONE SET IS NOT A STATION. `Easy Run | 1 x 5 min easy` on a
   circuit day is the warm-up: it plays in the first round and the laps fill the
   rest of the clock. The draft already holds a run as one entry (page-log's
   makeEntry), so a repeat had nowhere to log anyway. `6 x 3 min hard` is the
   session itself and comes back every round.

   A DAY OF NOTHING BUT ONE-SET RUNS IS NOT A CIRCUIT AT ALL (audit 25 Nov 2026,
   #38). "Long Trail Run | 1 x per the ladder" on a 15-minute dial used to be
   played as 17 laps of 45 seconds with a "next up" between each. Such a day is
   placed by continuousRuns below instead: each run one unbroken interval. */
const isRun = item => item.unit === 'km';
const isOneOffRun = item => isRun(item) && item.sets === 1;

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
  const written = writtenSecondsFor(item);
  return written !== null ? written : Math.max(MIN_INTERVAL_S, Math.round(config.workSeconds));
}

/* The time the plan itself prescribes for this exercise, or null when it
   prescribes none (and the clock would use the generic config.workSeconds).
   workSecondsFor and continuousRuns both read it, so "what did the plan
   write" is answered once. */
function writtenSecondsFor(item) {
  const target = (item && item.target) || '';
  /* A WRITTEN unit wins over the note's `unit:` field: "30 min easy" is
     thirty minutes however the exercise note is filled in, and this used to
     read it as thirty SECONDS. */
  const written = targetDurationSeconds(target);
  if (written) return Math.max(MIN_INTERVAL_S, written);
  /* No unit written, but the note says this exercise is measured in seconds
     — then the bare number is seconds, as it always was. */
  if (item && item.unit === 'seconds' && !isOpenEnded(target)) {
    const n = targetFirstNumber(target);
    if (Number.isFinite(n) && n > 0) return Math.max(MIN_INTERVAL_S, Math.round(n));
  }
  return null;
}

/* Split `total` whole seconds over `n` slots: equal shares, the rounding on
   the last one, so the parts always add back up to the total. */
function shares(total, n) {
  const each = Math.floor(total / n);
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? total - each * (n - 1) : each));
}

/* A RUN-ONLY DAY (every item a one-set run): one continuous work interval per
   run, in round 0, with a "next up" only between two DIFFERENT runs. The time
   left on the dial is shared between them:
     - a run with a written time keeps it, never cut (the first interval of a
       session never was; audit 16 Nov 2026 #37: `1 x 30 min` on a 10-minute
       dial is a 30-minute session);
     - the runs with no written time ("per the ladder", "5 km") share what the
       written ones leave;
     - when every run has a written time and the dial is longer, the spare is
       shared across them, so the clock is still filled - as one longer run,
       not a second lap of the same run.
   Returns the intervals; the caller pushes them and counts one set per run. */
function continuousRuns(list, order, remaining, cfg) {
  const gap = cfg.transitions ? Math.max(0, Math.round(cfg.transitionSeconds)) : 0;
  const written = order.map(i => writtenSecondsFor(list[i]));
  const fixed = written.reduce((n, w) => n + (w || 0), 0);
  const spare = remaining - gap * (order.length - 1) - fixed;
  const open = written.map((w, k) => (w === null ? k : -1)).filter(k => k >= 0);
  const seconds = written.map(w => w || 0);
  if (open.length) {
    shares(Math.max(0, spare), open.length).forEach((v, j) => { seconds[open[j]] = Math.max(MIN_CUT_SET_S, v); });
  } else if (spare > 0) {
    shares(spare, order.length).forEach((v, k) => { seconds[k] += v; });
  }
  const out = [];
  order.forEach((entryIndex, k) => {
    const item = list[entryIndex];
    if (k > 0 && gap > 0) {
      out.push({
        kind: 'transition', leadIn: false, exercise: item.exercise, seconds: gap,
        entryIndex: null, setIndex: null, round: 0, target: '', unit: null,
      });
    }
    out.push({
      kind: 'work', exercise: item.exercise, seconds: seconds[k],
      entryIndex, setIndex: 0, round: 0,
      target: item.target || '', unit: item.unit || null,
    });
  });
  return out;
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

/* items: [{exercise, target, unit, sets}] — plan items enriched with the unit
   from the vault's own exercise note (the caller resolves that; this module
   never touches ctx.data).
   Returns {intervals, rounds, setsPerEntry, totalSeconds, workTotalSeconds}. */
function buildSchedule(items, config) {
  const cfg = { ...TIMED_DEFAULTS, ...(config || {}) };
  const list = (items || []).filter(it => it && it.exercise);
  const intervals = [];
  const setsPerEntry = list.map(() => 0);

  if (!list.length) {
    return { intervals, rounds: 0, setsPerEntry, totalSeconds: 0, workTotalSeconds: 0 };
  }

  const budget = Math.max(MIN_INTERVAL_S, Math.round(cfg.minutes * 60) + Math.round(cfg.extraSeconds));
  const warm = cfg.warmup ?blockIntervals(cfg.warmupItems, cfg.warmupSeconds, 'warmup') : [];
  const cool = cfg.cooldown ? blockIntervals(cfg.cooldownItems, cfg.cooldownSeconds, 'cooldown') : [];
  const spent = arr => arr.reduce((n, i) => n + i.seconds, 0);

  /* Warm-up and cool-down come out of the time the user asked for, not on
     top of it: "30 minutes" has to mean 30 minutes, or the toggles silently
     turn a lunch-break session into 35 minutes. */
  const leadIn = Math.max(0, Math.round(cfg.leadInSeconds));
  let remaining = budget - spent(warm) - spent(cool) - leadIn;

  intervals.push(...warm);

  /* Round 0's order is settled BEFORE the lead-in is written, because the
     lead-in names the exercise you are about to do — and with shuffle on it
     used to name list[0] while the first work interval was somebody else.
     The screen, the demo media and the spoken "Starting with Push-ups" then
     set you up for the wrong movement. The loop below always places
     order[0] first (see "Always place the FIRST work interval"), so this is
     the same exercise the schedule actually starts with. */
  const hasLaps = list.some(it => !isOneOffRun(it));
  const orderFor = r => {
    const order = cfg.shuffle
      ? shuffledIndices(list.length, rng((Number(cfg.seed) || 1) + r))
      : list.map((_, i) => i);
    return r > 0 && hasLaps ? order.filter(i => !isOneOffRun(list[i])) : order;
  };

  if (leadIn > 0) {
    intervals.push({
      kind: 'transition', leadIn: true, exercise: list[orderFor(0)[0]].exercise, seconds: leadIn,
      entryIndex: null, setIndex: null, round: null, target: '', unit: null,
    });
  }

  const continuous = list.every(isOneOffRun);
  if (continuous) {
    for (const iv of continuousRuns(list, orderFor(0), remaining, cfg)) {
      intervals.push(iv);
      if (iv.kind === 'work') setsPerEntry[iv.entryIndex] = 1;
    }
  }

  let round = 0;
  let placedWork = 0;
  /* Grow the session one interval at a time until the clock is used up. The
     dial is the promise, so the last set is cut to the time left rather than
     dropped: a circuit stops because the time ran out, never because the next
     set was longer than what remained. */
  outer:
  while (!continuous && intervals.length < MAX_INTERVALS) {
    const order = orderFor(round);

    for (const entryIndex of order) {
      const item = list[entryIndex];
      const work = workSecondsFor(item, cfg);
      const gap = (cfg.transitions && placedWork > 0) ? Math.max(0, Math.round(cfg.transitionSeconds)) : 0;
      let seconds = work;

      /* Always place the FIRST work interval, whatever the budget says: a
         one-minute session still has to be a session, not an empty screen. */
      if (placedWork > 0) {
        const room = remaining - gap;
        if (room < Math.min(work, MIN_CUT_SET_S)) {
          if (remaining > 0) intervals.filter(i => i.kind === 'work').pop().seconds += remaining;
          break outer;
        }
        seconds = Math.min(work, room);
      }

      if (gap > 0) {
        intervals.push({
          kind: 'transition', leadIn: false, exercise: item.exercise, seconds: gap,
          entryIndex: null, setIndex: null, round, target: '', unit: null,
        });
      }
      intervals.push({
        kind: 'work', exercise: item.exercise, seconds,
        entryIndex, setIndex: setsPerEntry[entryIndex], round,
        target: item.target || '', unit: item.unit || null,
      });
      setsPerEntry[entryIndex]++;
      placedWork++;
      remaining -= seconds + gap;
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
    continuous,
    source: { items: list, config: cfg },
  };
}

/* A SKIP HANDS ITS TIME BACK. The schedule is worked out before the session
   starts, so without this a skipped interval is simply time lost: skip the
   run in two rounds of a 30-minute circuit and it is over at 19. The same
   inputs with a bigger budget rebuild the same list and carry on past the old
   end, so every position already played stays valid (only the old last set
   can change, when it was cut or stretched to fit).

   `index` is the interval being skipped. When that IS the last set, the
   rebuild puts it back to full length, and without `refit` the freed seconds
   would go on the very set you just left instead of after it. */
function giveTimeBack(schedule, seconds, index) {
  const freed = Math.round(seconds);
  if (!schedule || !schedule.source || !(freed > 0)) return schedule;
  const { items, config } = schedule.source;
  /* A run-only day has no laps to grow: a rebuild would share the freed time
     over every run, the one just left included. It goes to the runs still to
     come instead, and skipping the last run simply ends it. */
  if (schedule.continuous) {
    const from = Number.isInteger(index) ? index : -1;
    const ahead = [];
    schedule.intervals.forEach((iv, i) => { if (i > from && iv.kind === 'work') ahead.push(i); });
    if (!ahead.length) return schedule;
    const intervals = schedule.intervals.map(iv => Object.assign({}, iv));
    shares(freed, ahead.length).forEach((v, j) => { intervals[ahead[j]].seconds += v; });
    const total = arr => arr.reduce((n, i) => n + i.seconds, 0);
    return Object.assign({}, schedule, {
      intervals,
      totalSeconds: total(intervals),
      workTotalSeconds: total(intervals.filter(i => i.kind === 'work')),
      source: { items, config: Object.assign({}, config, { extraSeconds: config.extraSeconds + freed }) },
    });
  }
  const iv = schedule.intervals[index];
  const refit = iv && iv === workIntervals(schedule).pop()
    ? workSecondsFor(items[iv.entryIndex], config) - iv.seconds
    : 0;
  return buildSchedule(items, { ...config, extraSeconds: config.extraSeconds + freed + refit });
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

/* A run's time as the run screen's MINUTES box holds it - the ONE
   seconds->minutes conversion (secondsFromMinutes below is the way back, and
   page-log.buildRows saves through it). It used to round to 0.1 min, so 45 s
   became "0.8" and was saved as 48 s. Two decimals give every whole second back
   exactly (the error is at most 0.3 s) and a whole number of minutes still
   prints plain. */
function minutesText(seconds) {
  const s = Math.round(Number(seconds));
  if (!Number.isFinite(s)) return '';
  return String(Math.round((s / 60) * 100) / 100);
}

/* The way back: whole seconds from a MINUTES box's text, or null when it holds no
   number. The only minutes->seconds conversion - page-log.buildRows saves a run's
   time through it, and timedSetValues adds a run's intervals through it, so the
   saved row and the running total can never be worked out two ways. */
function secondsFromMinutes(text) {
  const mins = parseFloat(text);
  return Number.isFinite(mins) ? Math.round(mins * 60) : null;
}

/* WHICH SET AN INTERVAL WRITES INTO. A run is ONE set however many intervals the
   schedule plays it as (page-log.makeEntry: `distance` -> one set; every row of a
   run is a single continuous effort), so every interval of a run entry - not just
   the first - belongs to that one set. Every other entry keeps one set per
   interval, indexed by the interval's own setIndex. The screen's figure boxes,
   the write on completion and the skip mark all go through these two, so they
   cannot point at different sets. */
function positionFor(draft, iv) {
  const entry = draft && draft.entries && iv ? draft.entries[iv.entryIndex] : null;
  if (!entry) return null;
  return { entryIndex: iv.entryIndex, setIndex: entry.distance ? 0 : iv.setIndex };
}

function setFor(draft, iv) {
  const at = positionFor(draft, iv);
  const entry = at ? draft.entries[at.entryIndex] : null;
  return (entry && entry.sets && entry.sets[at.setIndex]) || null;
}

/* WHAT A FINISHED INTERVAL IS ENTITLED TO WRITE.

   A TARGET IS NOT A RESULT. makeEntry prefills reps and weight from the plan
   and marks them `touched: false` — they are the day's prescription sitting
   in the boxes, not anything anybody did. When a timed interval ended,
   advanceTimed wrote the clock and applyCompletion set done/touched, so the
   prefill was promoted to observed work and buildRows saved it. You did 8
   push-ups in 45 seconds and your history said 15.

   applyCompletion's `measured: false` only ever suppressed the RECORD toast.
   It never stopped the save, which is the half that outlives the session.

   So: the clock is written, because the clock is what this screen measured.
   Anything the user typed is kept, because they typed it. An untouched
   prefill is cleared, because nobody did it. Weight goes with reps — "8 x
   60kg" is one prescription, and keeping half of it would be a figure with
   no set behind it.

   A distance entry has no prefills to clear (makeEntry leaves a run empty —
   the distance covered is the whole point of logging it) and takes `minutes`
   rather than `seconds`, because buildRows reads a run's time from minutes
   and ignores seconds entirely. A run is ONE row that its intervals share, so
   each finished interval ADDS its seconds to the time the row already holds
   (read back through secondsFromMinutes) rather than replacing it: the row
   ends up holding the total time run. Reading the row, not a counter kept by
   the screen, is what lets a circuit that was left and re-entered carry on
   adding to the time it had. The caller guarantees an interval is written once
   (page-session's tp.completed), and a skipped interval is never written.

   THE DURATION CARVE-OUT. For every OTHER kind of entry, `seconds` is a side
   figure the clock alone gets to write (a push-up interval logging "15 reps,
   45s" — the reps are the user's, the seconds are just how long it took).
   For a DURATION entry, seconds IS the headline figure, and an interval that
   simply counts down to zero and ends is not proof anyone held the position
   the whole time — the schedule elapsing is not the same as the hold
   lasting. So timedFigures now offers a seconds box on a duration entry, and
   here that changes the rule for seconds alone: a TOUCHED duration set is
   left with whatever the user typed — the clock is not written over it, same
   as it never overwrites a typed rep count. Untouched, the interval ran its
   schedule end to end with nothing to contradict it, so the schedule length
   is exactly what was measured, same as before this carve-out existed. */
function timedSetValues(entry, set, seconds) {
  if (entry && entry.distance) {
    const before = set ? secondsFromMinutes(set.minutes) : null;
    return { minutes: minutesText((before || 0) + Math.round(Number(seconds))) };
  }
  if (entry && entry.duration) {
    if (set && set.touched) return {}; // the typed figure wins; don't write over it
    return { seconds: String(Math.round(seconds)) };
  }
  const values = { seconds: String(Math.round(seconds)) };
  if (!(set && set.touched)) {
    values.reps = '';
    values.weight_kg = '';
  }
  return values;
}

module.exports = {
  timedSetValues, minutesText, secondsFromMinutes, positionFor, setFor,
  TIMED_DEFAULTS, MIN_INTERVAL_S, buildSchedule, giveTimeBack, workSecondsFor, workIntervals, initialIndex,
};
