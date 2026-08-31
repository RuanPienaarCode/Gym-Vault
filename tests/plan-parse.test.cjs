'use strict';
/* The plan grammar: seed parses, prose survives, serialization is stable. */
const assert = require('node:assert');
const { parsePlanBody, serializePlanBody, parsePrescription, targetWeight, targetFirstNumber, targetIsDuration, isRestDay } = require('../src/plan-parse');
const { SEED_PLAN, SEED_RUN_PLAN, SEED_REST_PLAN } = require('../src/seed');

/* Strength and running are SEPARATE plans: the running one is `parallel`,
   so it runs alongside rather than replacing the strength programme. */
{
  const m = parsePlanBody(SEED_PLAN.body);
  assert.strictEqual(m.days.length, 3);
  assert.deepStrictEqual(m.days.map(d => d.weekday), ['mon', 'wed', 'thu']);
  assert.ok(!m.days.some(isRestDay), 'rest lives in the fallback plan, not here');
  const byDay = Object.fromEntries(m.days.map(d => [d.weekday, d]));
  assert.strictEqual(byDay.mon.items.length, 6);
  assert.strictEqual(byDay.mon.items[0].exercise, 'Pull-ups');
  assert.strictEqual(byDay.mon.items[0].sets, 5);
  assert.strictEqual(byDay.mon.items[0].target, 'submax');
  assert.ok(m.intro.join(' ').includes('muscle-up'));
  assert.ok(byDay.thu.notes.join(' ').includes('Superset'));
  assert.ok(!m.days.some(d => d.items.some(i => /Run/.test(i.exercise))), 'running must not live in the strength plan');
}

/* The running plan: parallel, 3 days, and a ladder that is DATA (so the
   Running page can say which week you are in) ending at the 15km goal. */
{
  const r = parsePlanBody(SEED_RUN_PLAN.body);
  assert.strictEqual(SEED_RUN_PLAN.fm.parallel, true);
  assert.deepStrictEqual(r.days.map(d => d.weekday), ['tue', 'sat']);
  assert.strictEqual(r.days[0].items[0].exercise, 'Easy Run');
  assert.strictEqual(r.days[1].items[0].exercise, 'Long Trail Run');
  const ladder = SEED_RUN_PLAN.fm.ladder;
  assert.strictEqual(ladder.length, 12);
  assert.strictEqual(ladder[ladder.length - 1], 15);
  assert.ok(ladder[3] < ladder[2] && ladder[7] < ladder[6], 'weeks 4 and 8 must step down');
  assert.strictEqual(serializePlanBody(parsePlanBody(serializePlanBody(r))), serializePlanBody(r));
}

/* Serialize → parse is a fixpoint (stable round trip). */
{
  const m1 = parsePlanBody(SEED_PLAN.body);
  const s1 = serializePlanBody(m1);
  const m2 = parsePlanBody(s1);
  const s2 = serializePlanBody(m2);
  assert.strictEqual(s1, s2);
  assert.strictEqual(m2.days.length, 3);
  assert.deepStrictEqual(
    m2.days.map(d => d.items.map(i => `${i.exercise}|${i.sets}|${i.target}`)),
    m1.days.map(d => d.items.map(i => `${i.exercise}|${i.sets}|${i.target}`)));
}

/* Prescription grammar corners. */
assert.deepStrictEqual(parsePrescription('5 x submax'), { sets: 5, target: 'submax' });
assert.deepStrictEqual(parsePrescription('3 × 8-12'), { sets: 3, target: '8-12' });
assert.deepStrictEqual(parsePrescription('just move'), { sets: null, target: 'just move' });
assert.strictEqual(targetWeight('8-10 @ 22.5kg'), 22.5);
assert.strictEqual(targetWeight('8-10'), null);
assert.strictEqual(targetFirstNumber('8-12'), 8);
assert.strictEqual(targetFirstNumber('30-45s'), 30);
assert.strictEqual(targetFirstNumber('submax'), null);
assert.strictEqual(targetFirstNumber('8 @ 60kg'), 8);
assert.ok(targetIsDuration('30-45s'));
assert.ok(targetIsDuration('2 min'));
assert.ok(!targetIsDuration('8-12'));

/* An exercise name containing an escaped pipe survives. */
{
  const s = serializePlanBody({ intro: [], days: [{ name: 'D', weekday: 'mon', notes: [], items: [{ exercise: 'Odd | Name', sets: 3, target: '10' }] }] });
  const m = parsePlanBody(s);
  assert.strictEqual(m.days[0].items[0].exercise, 'Odd | Name');
}

/* Prose written BETWEEN two exercise lines keeps its position across a
   save (the notes-then-items model used to hoist it above the list). */
{
  const body = '## D (mon)\n\n- Pull-ups | 3 x 5\nRest 90s here.\n- Dips | 3 x 8\n';
  const m = parsePlanBody(body);
  const s = serializePlanBody(m);
  const lines = s.split('\n').filter(l => l.trim());
  assert.deepStrictEqual(lines, ['## D (mon)', '- Pull-ups | 3 x 5', 'Rest 90s here.', '- Dips | 3 x 8']);
  assert.strictEqual(serializePlanBody(parsePlanBody(s)), s); // still a fixpoint
}

/* A hand-written item with extra pipes keeps its whole tail. */
{
  const m = parsePlanBody('## D (mon)\n\n- Superset: rows \\| dips | 3 x 5 | slow\n');
  assert.strictEqual(m.days[0].items[0].exercise, 'Superset: rows | dips');
  assert.strictEqual(m.days[0].items[0].target, '5 | slow');
  const s = serializePlanBody(m);
  assert.strictEqual(serializePlanBody(parsePlanBody(s)), s);
}

/* Structural edit helpers keep parts and items in lockstep. */
{
  const { addItem, removeItemAt } = require('../src/plan-parse');
  const m = parsePlanBody('## D (mon)\n\nCue line.\n\n- A | 3 x 5\n- B | 3 x 8\n');
  const day = m.days[0];
  addItem(day, { exercise: 'C', sets: 2, target: '10' });
  removeItemAt(day, 0); // drop A
  const s = serializePlanBody(m);
  assert.ok(s.includes('Cue line.'));
  assert.ok(!s.includes('- A |'));
  assert.ok(s.indexOf('- B | 3 x 8') < s.indexOf('- C | 2 x 10'));
  assert.strictEqual(day.items.length, day.parts.filter(p => p.kind === 'item').length);
}

/* The week must never put a leg session the day before the long trail run
   — that pairing is what the Thursday move exists to prevent. */
{
  const { isRestDay } = require('../src/plan-parse');
  const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const strength = parsePlanBody(SEED_PLAN.body).days;
  const running = parsePlanBody(SEED_RUN_PLAN.body).days;
  const longRun = running.find(d => /long/i.test(d.name));
  const legs = strength.find(d => /legs/i.test(d.name));
  const dayBefore = WD[(WD.indexOf(longRun.weekday) + 6) % 7];
  assert.notStrictEqual(legs.weekday, dayBefore, 'legs must not sit the day before the long run');
  /* Nothing trains that day at all, so the fallback rest plan covers it. */
  const training = [...strength, ...running].filter(d => d.weekday === dayBefore);
  assert.strictEqual(training.length, 0, 'the day before the long run must be free for rest');
  assert.strictEqual(SEED_REST_PLAN.fm.fallback, true, 'a fallback rest plan must exist to fill it');
}

/* `(any)` is a wildcard weekday for fallback plans — a rest & recovery
   plan fills whatever day training leaves empty, whichever plan is active,
   so rest days never have to be maintained per-plan. */
{
  const body = '## Rest & Recovery (any)\n\n- Cat-Cow | 1 x 8\n\n## Rest & Recovery · after the long run (sun)\n\n- Calf Stretch | 1 x 30s\n';
  const m = parsePlanBody(body);
  assert.deepStrictEqual(m.days.map(d => d.weekday), ['any', 'sun']);
  assert.ok(m.days.every(isRestDay), 'both should read as rest days');
  // `any` must survive serialization rather than collapsing to Monday
  const s2 = serializePlanBody(m);
  assert.ok(s2.includes('(any)'), 'the any wildcard must round-trip');
  assert.strictEqual(serializePlanBody(parsePlanBody(s2)), s2);

  // resolution order: exact weekday beats the wildcard
  const pick = wk => m.days.find(d => d.weekday === wk) || m.days.find(d => d.weekday === 'any');
  assert.strictEqual(pick('sun').name, 'Rest & Recovery · after the long run');
  assert.strictEqual(pick('thu').name, 'Rest & Recovery');
}


/* Indented sub-bullets are the user's own annotations, not exercises.

   THE BUG: `t.startsWith('- ')` was tested on the TRIMMED line, so
   indentation was invisible. `  - grip: overhand` under an exercise became a
   first-class plan item — it appeared in the day's exercise list, got logged
   as an exercise and inflated the dashboard's set count — and the write-back
   flattened the user's nesting on disk. */
{
  const src = '## Pull (mon)\n\n- Pull-ups | 5 x submax\n  - grip: overhand\n  - tempo 2-1-2\n- Rows | 3 x 8\n';
  const model = parsePlanBody(src);
  const names = model.days[0].items.map(i => i.exercise);
  assert.deepStrictEqual(names, ['Pull-ups', 'Rows'],
    `indented annotations became exercises: ${JSON.stringify(names)}`);

  const out = serializePlanBody(model);
  assert.match(out, /\n {2}- grip: overhand/, `indentation destroyed on write:\n${out}`);
  assert.match(out, /\n {2}- tempo 2-1-2/, `indentation destroyed on write:\n${out}`);
}

/* Deeper indentation under a heading is preserved verbatim too. */
{
  const src = '## Pull (mon)\n\nSuperset:\n    - Pull-ups | 3 x 8\n    - Dips | 3 x 8\n';
  const out = serializePlanBody(parsePlanBody(src));
  assert.match(out, /\n {4}- Pull-ups \| 3 x 8/, `4-space indent lost:\n${out}`);
}

/* A day heading inside a fenced code block is an EXAMPLE, not a day. */
{
  const src = '## Push (mon)\n\n- Bench | 3 x 5\n\n```\n## Fake (tue)\n- Ghost | 1 x 1\n```\n\n- Real Row | 3 x 8\n';
  const model = parsePlanBody(src);
  const days = model.days.map(d => d.name);
  assert.deepStrictEqual(days, ['Push'], `fenced heading became a real day: ${JSON.stringify(days)}`);
  const pushItems = model.days[0].items.map(i => i.exercise);
  assert.ok(pushItems.includes('Real Row'),
    `an exercise below the fence was re-parented into the fake day: ${JSON.stringify(pushItems)}`);
}

console.log('plan grammar OK');

/* ============================================================================
   EDITING A PLAN — reorder and re-prescribe, without eating the author's own
   words.

   The plan note is the source of truth and it holds hand-written coaching
   prose interleaved with the exercise lines. Every guard below exists
   because the cheap implementation of "move this exercise down" is to move
   its LINE, and that quietly drags an exercise across a note, rewriting what
   the note appears to be about.
   ============================================================================ */

const { moveItem, updateItem } = require('../src/plan-parse');

const EDIT_BODY = [
  'Nine exercises, back to back.',
  '',
  '## The Circuit (any)',
  '',
  'Rest between exercises only as long as it takes to get into position.',
  '',
  '- Push-ups | 1 x 15',
  '- Bodywweight Squat | 1 x 25',
  '',
  'Keep the plank honest — stop when the hips drop.',
  '',
  '- Plank | 1 x 45s',
  '- Tricep Dips | 1 x 15',
  '',
].join('\n');

/* ---- reordering ---- */
{
  const m = parsePlanBody(EDIT_BODY);
  const day = m.days[0];
  assert.deepStrictEqual(day.items.map(i => i.exercise),
    ['Push-ups', 'Bodywweight Squat', 'Plank', 'Tricep Dips']);

  assert.strictEqual(moveItem(day, 0, 1), 1, 'moving returns the new index');
  assert.deepStrictEqual(day.items.map(i => i.exercise),
    ['Bodywweight Squat', 'Push-ups', 'Plank', 'Tricep Dips']);

  const out = serializePlanBody(m);

  /* THE POINT: the author's two prose lines are still there, still in the
     same places, and the blank-line shape is unchanged. */
  assert.ok(out.includes('Rest between exercises only as long as it takes to get into position.'),
    'the day note must survive a reorder');
  assert.ok(out.includes('Keep the plank honest — stop when the hips drop.'),
    'a note BETWEEN two exercises must survive a reorder');
  assert.ok(out.includes('Nine exercises, back to back.'), 'the plan intro must survive');

  /* The note stays between the second and third exercise slots — it did not
     travel with the exercise that moved. */
  const lines = out.split('\n').filter(l => l.trim() !== '');
  const noteAt = lines.indexOf('Keep the plank honest — stop when the hips drop.');
  const plankAt = lines.findIndex(l => l.startsWith('- Plank'));
  const pushAt = lines.findIndex(l => l.startsWith('- Push-ups'));
  assert.ok(pushAt < noteAt && noteAt < plankAt, 'the note must stay where it was written');

  /* Exactly the two moved lines differ from the original — nothing else in
     the file was rewritten. */
  const before = EDIT_BODY.split('\n').filter(l => l.trim() !== '');
  const changed = lines.filter((l, i) => l !== before[i]);
  assert.strictEqual(changed.length, 2, `a swap must change exactly two lines, changed: ${JSON.stringify(changed)}`);
}

/* Moving off either end is a no-op, not a wrap-around and not a crash — the
   buttons are disabled at the ends, but a keyboard repeat must not slip
   past them. */
{
  const day = parsePlanBody(EDIT_BODY).days[0];
  const names = day.items.map(i => i.exercise);
  assert.strictEqual(moveItem(day, 0, -1), 0);
  assert.strictEqual(moveItem(day, 3, 1), 3);
  assert.strictEqual(moveItem(day, -1, 1), -1);
  assert.strictEqual(moveItem(day, 99, -1), 99);
  assert.deepStrictEqual(day.items.map(i => i.exercise), names, 'a refused move must change nothing');
}

/* Up then down returns the file to exactly what it was. */
{
  const m = parsePlanBody(EDIT_BODY);
  moveItem(m.days[0], 2, -1);
  moveItem(m.days[0], 1, 1);
  assert.strictEqual(serializePlanBody(m), serializePlanBody(parsePlanBody(EDIT_BODY)),
    'moving an item down and back must be a round trip');
}

/* ---- re-prescribing ---- */
{
  const m = parsePlanBody(EDIT_BODY);
  const day = m.days[0];

  updateItem(day, 0, { sets: 3, target: '20' });
  assert.strictEqual(serializePlanBody(m).includes('- Push-ups | 3 x 20'), true);

  /* Sets cleared reverts to a bare target line — which itemSets() reads as
     the default. `- Push-ups | 12` and `- Push-ups | 3 x 12` are genuinely
     different lines and both must be writable. */
  updateItem(day, 0, { sets: '' });
  assert.strictEqual(day.items[0].sets, null);
  assert.ok(serializePlanBody(m).includes('- Push-ups | 20'), 'no set count writes a bare target');

  /* Garbage and zero clear the count rather than writing "0 x 20", which
     would parse back as a day with no sets in it. */
  for (const bad of ['abc', '0', '-2', null, undefined]) {
    updateItem(day, 0, { sets: bad });
    assert.strictEqual(day.items[0].sets, null, `sets ${JSON.stringify(bad)} must clear, not write a broken line`);
  }

  /* A target cleared entirely leaves just the exercise. */
  updateItem(day, 0, { sets: '', target: '' });
  assert.ok(serializePlanBody(m).includes('- Push-ups\n'), 'an empty prescription writes the exercise alone');

  /* THE NAME IS NOT EDITABLE HERE. Plans, goals and every logged row
     reference an exercise by name, so a rename would orphan its history —
     updateItem must ignore an exercise key even if a caller passes one. */
  updateItem(day, 1, { exercise: 'Something else', target: '30' });
  assert.strictEqual(day.items[1].exercise, 'Bodywweight Squat', 'updateItem must never rename an exercise');

  assert.strictEqual(updateItem(day, 99, { target: 'x' }), null, 'a missing index returns null, not a throw');
}

/* An edit still round-trips through the parser: what was written reads back
   as the same model. */
{
  const m = parsePlanBody(EDIT_BODY);
  updateItem(m.days[0], 2, { sets: 2, target: '60s' });
  moveItem(m.days[0], 3, -1);
  const reparsed = parsePlanBody(serializePlanBody(m));
  assert.deepStrictEqual(
    reparsed.days[0].items.map(i => `${i.exercise}|${i.sets}|${i.target}`),
    m.days[0].items.map(i => `${i.exercise}|${i.sets}|${i.target}`),
    'an edited plan must reparse to the same items',
  );
}

console.log('plan editing OK (reorder keeps the author\'s prose in place; prescriptions round-trip; no renames)');
