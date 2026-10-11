'use strict';
/* `motion_counting` through the REAL vault layer (data.js saveExercise over
   the fake vault that copies Obsidian's write timing).

   What the user's tap on the motion toggle must do to the exercise note:
   change exactly that one line, keep every other key, the file's key order,
   the user's own block lists and the whole body — and never fight an outside
   edit made since the app loaded. Synthetic note. */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

const { makeIo } = loadSrc('data.js');
const { parseFrontmatter } = loadSrc('markdown.js');
const { setMotionPref, motionPref } = loadSrc('motion-count.js');

const EX = 'Gym/Exercises/Alpha Press.md';
const NOTE = '---\ntype: strength\nmuscles: [chest]\ntags:\n  - gym\nmotion_sensitivity: high\nunit: reps\n---\n\nHow-to: brace, press.\n\nMy own cue typed on the phone.\n';
const setup = (text = NOTE) => {
  const v = makeVault([[EX, text]]);
  return { v, io: makeIo(makePlugin(v)) };
};
const { check, run } = makeRunner();

check('ON adds exactly one line; every other key, the block list and the body are byte-identical', async () => {
  const { v, io } = setup();
  const ex = (await io.loadAll()).exercises[0];
  assert.strictEqual(motionPref(ex.fm), false);
  setMotionPref(ex.fm, true);
  await io.saveExercise(ex);
  assert.strictEqual(v._disk.get(EX), NOTE.replace('unit: reps\n---', 'unit: reps\nmotion_counting: true\n---'));
});

check('what was written reads back ON on the next load (the next session starts with motion on)', async () => {
  const { v, io } = setup();
  const ex = (await io.loadAll()).exercises[0];
  setMotionPref(ex.fm, true);
  await io.saveExercise(ex);
  const again = (await makeIo(makePlugin(v)).loadAll()).exercises[0];
  assert.strictEqual(motionPref(again.fm), true);
  assert.strictEqual(again.fm.motion_sensitivity, 'high');
});

check('OFF removes exactly that line: the note is byte-identical to before the key ever existed', async () => {
  const { v, io } = setup();
  let ex = (await io.loadAll()).exercises[0];
  setMotionPref(ex.fm, true); await io.saveExercise(ex);
  ex = (await makeIo(makePlugin(v)).loadAll()).exercises[0];
  setMotionPref(ex.fm, false);
  await makeIo(makePlugin(v)).saveExercise(ex);
  assert.strictEqual(v._disk.get(EX), NOTE);
});

check('a hand-written `motion_counting: false` is OFF, and turning ON replaces it in place', async () => {
  const text = NOTE.replace('unit: reps', 'unit: reps\nmotion_counting: false');
  const { v, io } = setup(text);
  const ex = (await io.loadAll()).exercises[0];
  assert.strictEqual(motionPref(ex.fm), false);
  setMotionPref(ex.fm, true);
  await io.saveExercise(ex);
  assert.strictEqual(v._disk.get(EX), text.replace('motion_counting: false', 'motion_counting: true'));
});

check('saving ANOTHER key (the sensitivity picker) keeps motion_counting, and vice versa', async () => {
  const text = NOTE.replace('unit: reps', 'unit: reps\nmotion_counting: true');
  const { v, io } = setup(text);
  const ex = (await io.loadAll()).exercises[0];
  ex.fm.motion_sensitivity = 'low';
  await io.saveExercise(ex);
  assert.strictEqual(v._disk.get(EX), text.replace('motion_sensitivity: high', 'motion_sensitivity: low'));
  setMotionPref(ex.fm, false);
  await io.saveExercise(ex);
  assert.strictEqual(v._disk.get(EX), NOTE.replace('motion_sensitivity: high', 'motion_sensitivity: low'));
});

check('an outside edit made after the app loaded survives the preference save', async () => {
  const { v, io } = setup();
  const ex = (await io.loadAll()).exercises[0];
  v.externalWrite(EX, NOTE.replace('type: strength', 'type: skill') + '\nAdded on the desktop.\n');
  setMotionPref(ex.fm, true);
  await io.saveExercise(ex);
  const disk = v._disk.get(EX);
  assert.strictEqual(parseFrontmatter(disk).fm.type, 'skill', `outside change to type was reverted:\n${disk}`);
  assert.ok(disk.includes('Added on the desktop.'), 'outside body edit lost');
  assert.strictEqual(motionPref(parseFrontmatter(disk).fm), true);
});

check('rapid toggles (ON, OFF, ON / ON, OFF) never overlap writes and end on the LAST choice', async () => {
  for (const [seq, want] of [[[true, false, true], true], [[true, false], false]]) {
    const v = makeVault([[EX, NOTE]], { delay: 5 });
    const io = makeIo(makePlugin(v));
    const ex = (await io.loadAll()).exercises[0];
    const saves = [];
    for (const on of seq) { setMotionPref(ex.fm, on); saves.push(io.saveExercise(ex)); }
    await Promise.all(saves);
    assert.deepStrictEqual(v.overlaps, [], 'saves of one note must be serialised');
    assert.strictEqual(motionPref(parseFrontmatter(v._disk.get(EX)).fm), want, `sequence ${seq} ended wrong:\n${v._disk.get(EX)}`);
    if (!want) assert.strictEqual(v._disk.get(EX), NOTE);
  }
});

run('motion preference saves');
