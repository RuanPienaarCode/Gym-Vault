'use strict';
const assert = require('node:assert');
const tp = require('../src/timed-plan');

const item = (exercise, target, unit) => ({ exercise, target: target || '', unit: unit || null });

/* Three plain rep exercises — nothing carries its own duration. */
const THREE = [item('Push-ups', '15'), item('Squats', '25'), item('Lunges', '30')];

const kinds = s => s.intervals.map(i => i.kind);
const works = s => s.intervals.filter(i => i.kind === 'work');

/* ---------- shape ---------- */

/* A session always opens with a lead-in and alternates transition/work. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  assert.strictEqual(s.intervals[0].kind, 'transition');
  assert.strictEqual(s.intervals[0].leadIn, true, 'the first interval is the get-ready lead-in');
  assert.strictEqual(s.intervals[1].kind, 'work');
  assert.strictEqual(s.intervals[1].exercise, 'Push-ups');
  assert.ok(!kinds(s).includes('warmup'), 'no warm-up unless asked for');
  assert.ok(!kinds(s).includes('cooldown'));
}

/* The lead-in names the exercise about to start, so the screen can show it. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, seed: 1 });
  assert.strictEqual(s.intervals[0].exercise, 'Push-ups');
  assert.strictEqual(s.intervals[0].entryIndex, null, 'a lead-in is never logged');
}

/* AND IT NAMES THE RIGHT ONE WITH SHUFFLE ON (issue #14).

   THE BUG THIS REPRODUCES: the lead-in was written from list[0] BEFORE the
   shuffle loop chose round 0's order, so with shuffle on the screen, the
   demo media and the spoken "Starting with Push-ups" all set you up for an
   exercise the session was not about to do. Measured against 0.10.2 this
   was 27 of 40 seeds on a five-move day.

   The fixture above has shuffle OFF, where list[0] is accidentally right —
   which is exactly why it passed. So this sweeps seeds instead of trusting
   one: a lead-in that happens to match on seed 1 is not a fixed lead-in. */
{
  const FIVE = ['Push-ups', 'Squats', 'Plank', 'Dips', 'Lunges']
    .map(exercise => ({ exercise, target: '30s', sets: 3 }));

  const mismatched = [];
  for (let seed = 1; seed <= 40; seed++) {
    const s = tp.buildSchedule(FIVE, { minutes: 10, shuffle: true, seed });
    const lead = s.intervals.find(i => i.leadIn);
    const firstWork = s.intervals.find(i => i.kind === 'work');
    assert.ok(lead && firstWork, `seed ${seed}: expected a lead-in and a work interval`);
    if (lead.exercise !== firstWork.exercise) mismatched.push(`seed ${seed}: "${lead.exercise}" vs "${firstWork.exercise}"`);
  }
  assert.deepStrictEqual(mismatched, [],
    `the lead-in must name the exercise the session actually starts with: ${mismatched.slice(0, 3).join('; ')}`);

  /* The lead-in is still interval 0 when there is no warm-up, so
     announcementFor's "Starting with X" reads the same object. */
  const s = tp.buildSchedule(FIVE, { minutes: 10, shuffle: true, seed: 7 });
  assert.strictEqual(s.intervals[0].leadIn, true);
  assert.strictEqual(s.intervals[0].exercise, s.intervals.find(i => i.kind === 'work').exercise);
}

/* Shuffle must still actually shuffle — a lead-in that agrees with the first
   work interval is trivially satisfiable by disabling the shuffle, and that
   would be a worse bug wearing this one's fix. */
{
  const FIVE = ['Push-ups', 'Squats', 'Plank', 'Dips', 'Lunges']
    .map(exercise => ({ exercise, target: '30s', sets: 3 }));
  const firsts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const s = tp.buildSchedule(FIVE, { minutes: 10, shuffle: true, seed });
    firsts.add(s.intervals.find(i => i.kind === 'work').exercise);
  }
  assert.ok(firsts.size > 1,
    `shuffle must still vary which exercise opens the session — got only ${[...firsts]}`);
}

/* ---------- the draft mapping ---------- */

/* Every work interval points at a real {entryIndex, setIndex}, and setIndex
   climbs once per round for each exercise. This is what keeps a completed
   interval writing into the right draft set. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  const w = works(s);
  assert.ok(w.length >= 6, 'a 5-minute session fits at least two rounds of three 30s exercises');
  assert.deepStrictEqual(
    w.slice(0, 6).map(i => [i.entryIndex, i.setIndex]),
    [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    'round 2 is setIndex 1 of the same three entries');
  assert.deepStrictEqual(w.slice(0, 6).map(i => i.round), [0, 0, 0, 1, 1, 1]);
}

/* setsPerEntry counts the work intervals actually scheduled — the log draft
   is built from this, so an entry must never be given a set nothing plays. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  const counted = [0, 0, 0];
  for (const w of works(s)) counted[w.entryIndex]++;
  assert.deepStrictEqual(s.setsPerEntry, counted, 'setsPerEntry equals the real interval count per entry');
}

/* A part-finished last round leaves entries with different set counts, and
   setsPerEntry has to reflect that rather than assuming a square grid. */
{
  const s = tp.buildSchedule(THREE, { minutes: 2, workSeconds: 30, transitionSeconds: 10, leadInSeconds: 0, seed: 1 });
  const counted = [0, 0, 0];
  for (const w of works(s)) counted[w.entryIndex]++;
  assert.deepStrictEqual(s.setsPerEntry, counted);
  assert.ok(s.setsPerEntry[0] >= s.setsPerEntry[2], 'the circuit fills from the front');
}

/* ---------- duration targets ---------- */

/* A duration prescription beats the generic work interval: the plan said 90
   seconds, so the interval is 90 seconds. */
{
  const items = [item('Plank', '90s', 'seconds'), item('Push-ups', '15')];
  const s = tp.buildSchedule(items, { minutes: 10, workSeconds: 45, seed: 1 });
  const w = works(s);
  assert.strictEqual(w[0].seconds, 90, 'the plan\'s own 90s wins over workSeconds');
  assert.strictEqual(w[1].seconds, 45, 'a rep target falls back to workSeconds');
}

/* Same when the unit says seconds but the target is a range. */
{
  assert.strictEqual(tp.workSecondsFor(item('Dead Hang', '30-45s', 'seconds'), tp.TIMED_DEFAULTS), 30,
    'a range takes its first number, like the log prefill does');
}

/* The floor holds even against a hostile prescription or config. */
{
  assert.strictEqual(tp.workSecondsFor(item('Blink', '1s', 'seconds'), tp.TIMED_DEFAULTS), tp.MIN_INTERVAL_S);
  assert.strictEqual(tp.workSecondsFor(item('Push-ups', '15'), { workSeconds: 0 }), tp.MIN_INTERVAL_S);
}

/* A rep target rides along on the interval so the screen can show it. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, seed: 1 });
  assert.strictEqual(works(s)[0].target, '15');
}

/* ---------- the time budget ---------- */

/* The session fits inside the minutes asked for. */
{
  for (const minutes of [5, 10, 20, 30, 45]) {
    const s = tp.buildSchedule(THREE, { minutes, workSeconds: 40, transitionSeconds: 10, seed: 7 });
    assert.ok(s.totalSeconds <= minutes * 60,
      `${minutes} min: scheduled ${s.totalSeconds}s, budget ${minutes * 60}s`);
  }
}

/* Warm-up and cool-down come OUT of the budget, not on top of it — "30
   minutes" has to mean 30 minutes with the toggles on. */
{
  const cfg = {
    minutes: 20, workSeconds: 40, transitionSeconds: 10, seed: 3,
    warmup: true, cooldown: true,
    warmupItems: ['Shoulder Circles', 'Cat-Cow'], cooldownItems: ['Hamstring Stretch'],
  };
  const s = tp.buildSchedule(THREE, cfg);
  assert.ok(s.totalSeconds <= 20 * 60, `warm-up + cool-down must fit inside the budget (${s.totalSeconds}s)`);
  assert.strictEqual(s.intervals[0].kind, 'warmup');
  assert.strictEqual(s.intervals[s.intervals.length - 1].kind, 'cooldown');
  const warm = s.intervals.filter(i => i.kind === 'warmup');
  assert.strictEqual(warm.length, 2, 'one interval per warm-up move');
  assert.deepStrictEqual(warm.map(i => i.entryIndex), [null, null], 'warm-ups are never logged');
}

/* Toggles on with nothing to schedule adds no dead time. */
{
  const s = tp.buildSchedule(THREE, { minutes: 10, warmup: true, cooldown: true, warmupItems: [], seed: 1 });
  assert.ok(!kinds(s).includes('warmup'), 'no mobility moves in the vault means no empty warm-up block');
  assert.ok(!kinds(s).includes('cooldown'));
}

/* Nothing is ever clipped to use up the last few seconds: half a 90-second
   plank is a different exercise. */
{
  const items = [item('Plank', '90s', 'seconds')];
  const s = tp.buildSchedule(items, { minutes: 4, leadInSeconds: 0, transitions: false, seed: 1 });
  for (const w of works(s)) assert.strictEqual(w.seconds, 90, 'every interval is whole');
  assert.strictEqual(works(s).length, 2, 'two whole planks fit in four minutes; the third would not');
}

/* A session too short for even one interval still IS a session. */
{
  const items = [item('Plank', '120s', 'seconds')];
  const s = tp.buildSchedule(items, { minutes: 1, seed: 1 });
  assert.strictEqual(works(s).length, 1, 'the first work interval is always placed');
  assert.strictEqual(works(s)[0].seconds, 120);
}

/* No exercises at all is an empty schedule, not a crash. */
{
  const s = tp.buildSchedule([], { minutes: 30 });
  assert.deepStrictEqual(s.intervals, []);
  assert.strictEqual(s.rounds, 0);
  assert.deepStrictEqual(s.setsPerEntry, []);
  assert.deepStrictEqual(tp.buildSchedule(null, null).intervals, []);
}

/* Entries missing an exercise name are dropped before anything is scheduled. */
{
  const s = tp.buildSchedule([item('Push-ups', '15'), { target: '10' }, null], { minutes: 5, seed: 1 });
  assert.ok(works(s).every(w => w.exercise === 'Push-ups'));
  assert.strictEqual(s.setsPerEntry.length, 1);
}

/* ---------- transitions ---------- */

/* Transitions sit BETWEEN work intervals, never before the first (the
   lead-in already covers that) and never after the last. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  const seq = kinds(s);
  assert.strictEqual(seq[seq.length - 1], 'work', 'a session ends on work, not a dangling transition');
  for (let i = 1; i < s.intervals.length; i++) {
    if (s.intervals[i].kind !== 'transition') continue;
    assert.strictEqual(s.intervals[i - 1].kind, 'work', 'every non-lead-in transition follows a work interval');
    assert.strictEqual(s.intervals[i + 1].kind, 'work', 'and is followed by one');
  }
}

/* A between-transition names the exercise COMING UP, which is the whole
   point of showing it. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  for (let i = 1; i < s.intervals.length - 1; i++) {
    if (s.intervals[i].kind !== 'transition') continue;
    assert.strictEqual(s.intervals[i].exercise, s.intervals[i + 1].exercise);
  }
}

/* Transitions off means back-to-back work, but the lead-in survives — it is
   not a transition in the toggle's sense. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, transitions: false, seed: 1 });
  const gaps = s.intervals.filter(i => i.kind === 'transition' && !i.leadIn);
  assert.strictEqual(gaps.length, 0);
  assert.strictEqual(s.intervals[0].leadIn, true, 'the lead-in is unconditional');
}

/* Turning transitions off buys more work in the same budget. */
{
  const on = tp.buildSchedule(THREE, { minutes: 10, workSeconds: 30, transitionSeconds: 15, transitions: true, seed: 1 });
  const off = tp.buildSchedule(THREE, { minutes: 10, workSeconds: 30, transitionSeconds: 15, transitions: false, seed: 1 });
  assert.ok(works(off).length > works(on).length, 'no transitions means more sets in the same time');
}

/* ---------- shuffle ---------- */

/* Shuffle reorders within a round but keeps entryIndex pointing at the
   ORIGINAL item — otherwise every exercise logs against the wrong set. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, shuffle: true, seed: 42 });
  for (const w of works(s)) {
    assert.strictEqual(w.exercise, THREE[w.entryIndex].exercise,
      'entryIndex must still address the item it names');
  }
  const firstRound = works(s).filter(w => w.round === 0).map(w => w.entryIndex).sort();
  assert.deepStrictEqual(firstRound, [0, 1, 2], 'a shuffled round still contains every exercise exactly once');
}

/* Deterministic: same seed, same session. */
{
  const a = tp.buildSchedule(THREE, { minutes: 8, shuffle: true, seed: 99 });
  const b = tp.buildSchedule(THREE, { minutes: 8, shuffle: true, seed: 99 });
  assert.deepStrictEqual(a.intervals, b.intervals);
}

/* Different rounds are shuffled differently — otherwise it is just one fixed
   reorder repeated, which is not what "shuffle" promises. */
{
  const s = tp.buildSchedule(
    [item('A'), item('B'), item('C'), item('D'), item('E')],
    { minutes: 30, workSeconds: 30, shuffle: true, seed: 5 });
  const roundOrder = r => works(s).filter(w => w.round === r).map(w => w.entryIndex).join('');
  const orders = new Set([roundOrder(0), roundOrder(1), roundOrder(2)]);
  assert.ok(orders.size > 1, 'rounds do not all share one order');
}

/* ---------- resume ---------- */

const handled = set => !!(set && (set.done || set.touched));

/* A fresh draft resumes at the very start, lead-in included. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, seed: 1 });
  const draft = { entries: THREE.map((_, i) => ({ sets: Array.from({ length: s.setsPerEntry[i] }, () => ({})) })) };
  assert.strictEqual(tp.initialIndex(s, draft, handled), 0);
}

/* A fresh draft starts at index 0 even with a warm-up block in front — the
   warm-up you switched on must actually run, not be skipped as "run-up". */
{
  const s = tp.buildSchedule(THREE, {
    minutes: 20, workSeconds: 30, seed: 1,
    warmup: true, warmupItems: ['Shoulder Circles', 'Cat-Cow'],
  });
  const draft = { entries: THREE.map((_, i) => ({ sets: Array.from({ length: s.setsPerEntry[i] }, () => ({})) })) };
  assert.strictEqual(s.intervals[0].kind, 'warmup');
  assert.strictEqual(tp.initialIndex(s, draft, handled), 0, 'a fresh session starts at the warm-up');
}

/* Resuming mid-session never rewinds into a warm-up already done. */
{
  const s = tp.buildSchedule(THREE, {
    minutes: 20, workSeconds: 30, transitionSeconds: 10, seed: 1,
    warmup: true, warmupItems: ['Shoulder Circles', 'Cat-Cow'],
  });
  const draft = { entries: THREE.map((_, i) => ({ sets: Array.from({ length: s.setsPerEntry[i] }, () => ({})) })) };
  draft.entries[0].sets[0].done = true;
  const idx = tp.initialIndex(s, draft, handled);
  assert.ok(s.intervals.slice(idx).every(i => i.kind !== 'warmup'), 'the warm-up is not replayed');
  const resumed = s.intervals.slice(idx).find(i => i.kind === 'work');
  assert.deepStrictEqual([resumed.entryIndex, resumed.setIndex], [1, 0]);
}

/* Sets already ticked on the log overview are skipped, and the transition
   before the resumed exercise comes along so you are not thrown straight in. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  const draft = { entries: THREE.map((_, i) => ({ sets: Array.from({ length: s.setsPerEntry[i] }, () => ({})) })) };
  draft.entries[0].sets[0].done = true;
  const idx = tp.initialIndex(s, draft, handled);
  const resumed = s.intervals.slice(idx).find(i => i.kind === 'work');
  assert.deepStrictEqual([resumed.entryIndex, resumed.setIndex], [1, 0], 'resumes at the next unhandled set');
  assert.strictEqual(s.intervals[idx].kind, 'transition', 'and keeps the run-up to it');
}

/* Everything handled means the session is over. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, workSeconds: 30, seed: 1 });
  const draft = { entries: THREE.map((_, i) => ({ sets: Array.from({ length: s.setsPerEntry[i] }, () => ({ done: true })) })) };
  assert.strictEqual(tp.initialIndex(s, draft, handled), s.intervals.length);
}

/* A draft that does not line up with the schedule resumes rather than
   throwing — the draft is the authority on what exists. */
{
  const s = tp.buildSchedule(THREE, { minutes: 5, seed: 1 });
  assert.strictEqual(typeof tp.initialIndex(s, { entries: [] }, handled), 'number');
  assert.strictEqual(typeof tp.initialIndex(s, null, handled), 'number');
}

/* ---------- reported totals ---------- */

/* `rounds` counts rounds STARTED, so the setup screen's preview and the live
   session header can never disagree: if any work interval carries round:2,
   the header says "Round 3" and the preview must say 3 rounds too. */
{
  const s = tp.buildSchedule(THREE, { minutes: 10, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  const highest = Math.max(...works(s).map(w => w.round));
  assert.strictEqual(s.rounds, highest + 1, 'rounds must cover the partial final round');
}

/* The exact shape that caught it: two full circuits and a part-finished
   third, where counting only completed passes under-reported by one. */
{
  const nine = Array.from({ length: 9 }, (_, i) => item(`Move ${i}`, '10'));
  const s = tp.buildSchedule(nine, { minutes: 15, workSeconds: 45, transitionSeconds: 10, seed: 1 });
  const counts = s.setsPerEntry;
  assert.ok(Math.max(...counts) > Math.min(...counts), 'this fixture must end mid-round to be the case under test');
  assert.strictEqual(s.rounds, Math.max(...counts), 'a part-finished round still counts as started');
}

/* A schedule with no work at all reports no rounds rather than NaN. */
{
  assert.strictEqual(tp.buildSchedule([], { minutes: 30 }).rounds, 0);
}

{
  const s = tp.buildSchedule(THREE, { minutes: 10, workSeconds: 30, transitionSeconds: 10, seed: 1 });
  const sum = s.intervals.reduce((n, i) => n + i.seconds, 0);
  assert.strictEqual(s.totalSeconds, sum);
  assert.strictEqual(s.workTotalSeconds, works(s).reduce((n, i) => n + i.seconds, 0));
  assert.ok(s.workTotalSeconds < s.totalSeconds, 'transitions are real time and counted');
  assert.strictEqual(tp.workIntervals(s).length, works(s).length);
}

console.log('timed-plan OK');
