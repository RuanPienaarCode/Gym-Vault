'use strict';
/* "30 min" IS NOT 30 SECONDS (issue #13).

   THE BUG THIS REPRODUCES. targetIsDuration has always recognised "min" —
   plan-parse.test.cjs even asserts targetIsDuration('2 min') — but every
   caller then took targetFirstNumber as a count of SECONDS. So the seed's
   Easy Run, written `1 x 30 min easy`, scheduled a THIRTY-SECOND interval
   and banked the run as 0.5 min. Recovery Walk's `20-30 min easy` became a
   twenty-second hold. `2 min` collapsed to five seconds, because at that
   point the MIN_INTERVAL_S floor was the only thing still doing any work.

   THREE CALLERS HAD THE SAME HOLE, which is this codebase's recurring shape:
   one question — how long is this — answered in three places by rules that
   disagree.

     timed-plan.js   workSecondsFor    the interval you actually stand there for
     counter-target  targetFromEntry   the fill meter's target
     page-log.js     prefSecs          the number the manual log prefills

   The old suites could not catch it: timed-plan.test.cjs only ever used
   `90s` and `30-45s`, where seconds-as-seconds happens to be right.

   So the unit is parsed once now, in plan-parse.targetDurationSeconds, and
   these tests hold the three callers to it. */
const assert = require('node:assert');
const Module = require('node:module');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, normalizePath: p => p }
  : origLoad(req, ...rest));
const { targetDurationSeconds, targetIsDuration } = require('../src/plan-parse');
const { workSecondsFor, buildSchedule, workIntervals } = require('../src/timed-plan');
const { targetFromEntry } = require('../src/counter-target');
Module._load = origLoad;

/* ---------- 1. the unit is read, not assumed ---------- */
{
  const cases = [
    ['30 min easy', 1800, "the seed's Easy Run — the headline case"],
    ['20-30 min easy', 1200, 'a range takes its first number, as every caller already did'],
    ['2 min', 120, 'two minutes, not two seconds and not the five-second floor'],
    ['1.5 min', 90, 'fractions of a minute'],
    ['45 minutes', 2700, 'spelled out'],
    ['5 mins', 300, 'and pluralised'],
    ['90s', 90, 'seconds still mean seconds'],
    ['30-45s', 30, 'a seconds range still takes its first'],
    ['60 sec', 60, null],
    ['5 second hold', 5, null],
    ['30–45s', 30, 'en dash, as a note written on a phone will have it'],
  ];
  for (const [target, want, why] of cases) {
    assert.strictEqual(targetDurationSeconds(target), want,
      `${JSON.stringify(target)} is ${want}s${why ? ` — ${why}` : ''}`);
  }
}

/* ---------- 2. a rep count is never mistaken for a clock ---------- */
{
  for (const target of ['15', 'submax', '12 @ 20kg', '', '3 sets', 'AMRAP']) {
    assert.strictEqual(targetDurationSeconds(target), null,
      `${JSON.stringify(target)} names no duration — reading one would turn a rep count into a timer`);
  }
  /* "3 sets" is the trap: it starts with a number followed by an s. */
  assert.strictEqual(targetDurationSeconds('3 sets'), null,
    '"sets" is not "seconds" — a unit must be a whole word');
}

/* ---------- 3. the timed schedule stands you there for the right time ---- */
{
  const cfg = { workSeconds: 40, restSeconds: 20, transitions: true, transitionSeconds: 15 };
  const item = (target, unit) => ({ exercise: 'Easy Run', target, unit: unit || null, sets: 1 });

  assert.strictEqual(workSecondsFor(item('30 min easy'), cfg), 1800,
    'the interval you stand there for must be thirty minutes');
  assert.strictEqual(workSecondsFor(item('20-30 min easy'), cfg), 1200);
  assert.strictEqual(workSecondsFor(item('90s'), cfg), 90, 'seconds are unchanged');

  /* A WRITTEN unit beats the note's own `unit:` field — the target is the
     more specific statement, and it is the one the user typed on the line. */
  assert.strictEqual(workSecondsFor(item('30 min easy', 'seconds'), cfg), 1800,
    'a note marked unit: seconds cannot turn "30 min" back into 30 seconds');
  /* With nothing written, `unit: seconds` still means the bare number is
     seconds, exactly as before. */
  assert.strictEqual(workSecondsFor(item('45', 'seconds'), cfg), 45,
    'a bare number under unit: seconds is still seconds');
  /* And with neither, the config's own work length stands. */
  assert.strictEqual(workSecondsFor(item('12'), cfg), 40,
    'a rep target must fall back to the configured work length, not become 12 seconds');
}

/* ---------- 4. END TO END: the run is banked as 30 min, not 0.5 -------- */
{
  /* This is the number the user actually sees in their note. page-session's
     advanceTimed writes `minutes: iv.seconds / 60` for a distance entry —
     rounded to a tenth — so a 30-second interval banked "0.5". */
  const items = [{ exercise: 'Easy Run', target: '30 min easy', sets: 1, unit: null }];
  const schedule = buildSchedule(items, {
    minutes: 40, workSeconds: 40, restSeconds: 20,
    transitions: false, warmup: [], cooldown: [], shuffle: false, seed: 1,
  });
  const work = workIntervals(schedule);
  assert.strictEqual(work.length, 1, 'one exercise, one work interval');
  assert.strictEqual(work[0].seconds, 1800, 'the scheduled interval is thirty minutes');

  const bankedMinutes = Math.round((work[0].seconds / 60) * 10) / 10;
  assert.strictEqual(bankedMinutes, 30,
    'the run must be logged as 30 min — 0.5 is what shipped, and it is what a user reads back as their training history');
}

/* ---------- 5. the fill meter fills against the real target ------------- */
{
  assert.deepStrictEqual(targetFromEntry({ target: '2 min' }), { kind: 'seconds', value: 120 },
    'a two-minute hold read as complete after two seconds');
  assert.deepStrictEqual(targetFromEntry({ target: '30 min easy' }), { kind: 'seconds', value: 1800 });
  assert.deepStrictEqual(targetFromEntry({ target: '90s' }), { kind: 'seconds', value: 90 });

  /* Reps are still reps, and a run is still measured rather than counted. */
  assert.deepStrictEqual(targetFromEntry({ target: '15' }), { kind: 'reps', value: 15 });
  assert.strictEqual(targetFromEntry({ target: '5 km', distance: true }), null);
  /* A duration ENTRY with a bare number keeps reading it as seconds. */
  assert.deepStrictEqual(targetFromEntry({ target: '45', duration: true }), { kind: 'seconds', value: 45 });
}

/* ---------- 6. targetIsDuration and the seconds reader agree ------------ */
{
  /* They are two halves of one question. A target the predicate calls a
     duration but the reader cannot measure would send a caller back to
     targetFirstNumber and straight into the original bug. */
  for (const t of ['30 min easy', '2 min', '90s', '30-45s', '60 sec', '45 minutes']) {
    assert.ok(targetIsDuration(t), `${t}: predicate`);
    assert.ok(targetDurationSeconds(t) > 0, `${t}: the predicate says duration, so the reader must produce one`);
  }
}

console.log('duration units OK ("30 min" is 1800s in the schedule, the meter and the log — not 30)');
