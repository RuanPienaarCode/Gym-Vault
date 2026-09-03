'use strict';
/* counter-target.js — what a counter is counting towards.

   THE LINE THIS GUARDS: a target is an INTENTION, never a result. The
   codebase already keeps prefilled figures out of saved sets (`set.touched`,
   applyCompletion's `measured`) because a prefill that got logged as if it
   were observed is this project's recurring bug. Targets are a new source of
   exactly that kind of number, so the rules about what counts as one —
   and what reads as "no target at all" — are pinned here. */
const assert = require('node:assert');
const t = require('../src/counter-target');
const { resumeSeconds, targetFromEntry } = t;

/* ---------- makeTarget ---------- */

assert.deepStrictEqual(t.makeTarget('reps', 12), { kind: 'reps', value: 12 });
assert.deepStrictEqual(t.makeTarget('reps', '12'), { kind: 'reps', value: 12 }, 'it comes from a text box');
assert.deepStrictEqual(t.makeTarget('seconds', 45), { kind: 'seconds', value: 45 });

/* A fractional rep does not exist; a fractional second does (a 2.5-minute
   hold is 150s, and rounding that would be arbitrary). */
assert.deepStrictEqual(t.makeTarget('reps', 12.6), { kind: 'reps', value: 13 });
assert.deepStrictEqual(t.makeTarget('seconds', 45.5), { kind: 'seconds', value: 45.5 });

/* EVERY bad value reads as open-ended (null), never as an error and never as
   zero. This arrives from a keyboard mid-workout: the worst outcome of a
   fumbled entry must be a counter that simply counts. */
for (const bad of [0, -5, NaN, Infinity, '', '  ', 'abc', null, undefined, {}]) {
  assert.strictEqual(t.makeTarget('reps', bad), null, `reps ${JSON.stringify(bad)} must read as open-ended`);
}
assert.strictEqual(t.makeTarget('kilometres', 5), null, 'only the two counted kinds exist');
assert.strictEqual(t.makeTarget(undefined, 12), null);

/* ---------- targetFromEntry: the plan already answered this ---------- */

/* `entry.target` IS THE RIGHT-HAND SIDE ONLY. plan-parse splits a
   prescription before a draft entry ever sees it — "4 x 12" arrives as
   {sets: 4, target: "12"}, and the set COUNT lives on the entry's sets
   array, not in this string. Getting this backwards reads the sets count as
   the rep target (a "4 x 12" set would fill at 4 reps), which is exactly the
   mistake this file caught while it was being written. The fixtures below
   are therefore what parsePrescription actually emits, not what the user
   typed into the plan note. */
assert.deepStrictEqual(t.targetFromEntry({ target: '12' }), { kind: 'reps', value: 12 });          // from "4 x 12"
assert.deepStrictEqual(t.targetFromEntry({ target: '45s' }), { kind: 'seconds', value: 45 });      // from "3 x 45s"
assert.deepStrictEqual(t.targetFromEntry({ target: '30 sec hold' }), { kind: 'seconds', value: 30 });

/* Reads through plan-parse's own helpers, the same two page-log.js already
   uses to prefill a set — so the fill bar and the prefilled rep box cannot
   disagree about what a line asks for. */
assert.deepStrictEqual(
  t.targetFromEntry({ target: require('../src/plan-parse').parsePrescription('4 x 12').target }),
  { kind: 'reps', value: 12 },
  'end to end: what a real plan line becomes must target its reps, not its set count',
);

/* An entry already classified as a hold is a hold, whatever its prose says —
   the unit on the exercise note outranks a guess at the target string. */
assert.deepStrictEqual(t.targetFromEntry({ target: '60', duration: true }), { kind: 'seconds', value: 60 });

/* A weight is not a count. "@ 60kg" must not become a 60-rep target — the
   number nearest the front is the reps, and plan-parse already strips the
   weight before looking. */
assert.deepStrictEqual(t.targetFromEntry({ target: '5 @ 60kg' }), { kind: 'reps', value: 5 }); // from "5 x 5 @ 60kg"
assert.deepStrictEqual(t.targetFromEntry({ target: '@ 60kg' }), null, 'a weight alone is not a count target');

/* A run is measured, not counted — no fill bar, ever. */
assert.strictEqual(t.targetFromEntry({ target: '5', distance: true }), null);

/* Prose with no number is open-ended, which is a legitimate prescription
   ("submax", "as many as good form allows"). */
assert.strictEqual(t.targetFromEntry({ target: 'submax' }), null);
assert.strictEqual(t.targetFromEntry({ target: '' }), null);
assert.strictEqual(t.targetFromEntry(null), null);

/* ---------- fillFraction ---------- */

assert.strictEqual(t.fillFraction(6, { kind: 'reps', value: 12 }), 0.5);
assert.strictEqual(t.fillFraction(12, { kind: 'reps', value: 12 }), 1);

/* NOT clamped at 1. Beating the target is the good outcome, and the screen
   deciding how to celebrate needs to tell 1.0 from 1.4. */
assert.strictEqual(t.fillFraction(18, { kind: 'reps', value: 12 }), 1.5);

assert.strictEqual(t.fillFraction(5, null), 0, 'no target draws nothing, it does not throw');
assert.strictEqual(t.fillFraction(-3, { kind: 'reps', value: 12 }), 0);
assert.strictEqual(t.fillFraction('x', { kind: 'reps', value: 12 }), 0);

/* ---------- fillStage: the escalation thresholds ---------- */

assert.strictEqual(t.fillStage(0), 'idle');
assert.strictEqual(t.fillStage(0.01), 'warm');
assert.strictEqual(t.fillStage(0.49), 'warm');
assert.strictEqual(t.fillStage(0.5), 'hot');
assert.strictEqual(t.fillStage(0.79), 'hot');
assert.strictEqual(t.fillStage(0.8), 'peak');
assert.strictEqual(t.fillStage(0.99), 'peak');
assert.strictEqual(t.fillStage(1), 'done');
assert.strictEqual(t.fillStage(2.5), 'done', 'overshoot is still done — beating it is the story, not by how much');
assert.strictEqual(t.fillStage(NaN), 'idle', 'junk draws nothing rather than throwing mid-set');

/* The stages must be strictly ordered and every one reachable, or the
   escalation skips a step and the bar jumps. */
{
  const order = ['idle', 'warm', 'hot', 'peak', 'done'];
  const seen = [];
  for (let f = 0; f <= 1.2; f += 0.01) {
    const st = t.fillStage(f);
    if (seen[seen.length - 1] !== st) seen.push(st);
  }
  assert.deepStrictEqual(seen, order, 'the fill must pass through every stage exactly once, in order');
}

/* ---------- describeTarget ---------- */

assert.strictEqual(t.describeTarget({ kind: 'reps', value: 12 }), '12 reps');
/* Seconds read as you typed them. "0:45" for a thing you entered as 45 reads
   as a conversion rather than an echo. */
assert.strictEqual(t.describeTarget({ kind: 'seconds', value: 45 }), '45s');
assert.strictEqual(t.describeTarget(null), '', 'open-ended has nothing to say');

/* ---------- the quick picks ---------- */

for (const [name, list] of [['QUICK_REPS', t.QUICK_REPS], ['QUICK_SECONDS', t.QUICK_SECONDS]]) {
  assert.ok(list.length >= 4 && list.length <= 8, `${name}: a picker longer than a glance is a keyboard with extra steps`);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i] > list[i - 1], `${name} must ascend — a picker whose options move around is one you re-read every time`);
  }
  for (const v of list) {
    assert.deepStrictEqual(
      t.makeTarget(name === 'QUICK_REPS' ? 'reps' : 'seconds', v).value, v,
      `${name}: every offered pick must survive makeTarget unchanged`,
    );
  }
}

/* ---------- THE HOLD'S STOPWATCH STARTS AT ZERO (issue #18) ---------- */

/* THE BUG THIS REPRODUCES. makeEntry prefills a duration entry's `seconds`
   from the plan ("60s" -> 60) and marks it untouched. durationBody seeded the
   stopwatch with that number, so after Begin the big numeral read 0:30 while
   elapsed was zero — until the first one-second tick caught up. A tap-to-stop
   inside that window logged about 0s against a display that had just said
   0:30.

   Two figures derived by different rules, from the same prefill that made a
   timed interval save the plan's target as your reps. A target is not a
   result, and it is not elapsed time either. */
{
  /* The prefill: the plan asked for 60s and nobody has held anything yet. */
  assert.strictEqual(resumeSeconds({ seconds: 60, touched: false }), 0,
    'the plan\'s target must not seed the stopwatch — the clock has not run');
  assert.strictEqual(resumeSeconds({ seconds: '30', touched: false }), 0,
    'a string prefill is still a prefill');

  /* A RESUME is different: the user measured that, so counting on from it is
     right. This is what stops the fix eating real data. */
  assert.strictEqual(resumeSeconds({ seconds: '47', touched: true }), 47,
    'a figure the user actually measured is a time to count on from');
  assert.strictEqual(resumeSeconds({ seconds: 12.4, touched: true }), 12.4);

  /* Nothing to resume from, in every shape the draft can hand over. */
  for (const set of [null, undefined, {}, { touched: true }, { seconds: '', touched: true },
                     { seconds: 'abc', touched: true }, { seconds: 0, touched: true },
                     { seconds: -5, touched: true }]) {
    assert.strictEqual(resumeSeconds(set), 0,
      `no measured time means start at zero: ${JSON.stringify(set)}`);
  }

  /* And the prefill keeps its real job — the meter still fills towards 60. */
  assert.deepStrictEqual(targetFromEntry({ target: '60s' }), { kind: 'seconds', value: 60 },
    'the target is unchanged; only the stopwatch stopped borrowing it');
}

console.log('counter-target OK (a target is an intention; bad input reads as open-ended, never as zero; stages escalate in order)');
