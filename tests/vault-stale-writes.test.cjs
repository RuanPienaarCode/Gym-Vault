'use strict';
/* L2-04 / L2-13 — a save must be applied to the file's CURRENT text, never to
   the copy the app loaded earlier.

   saveExercise / saveGoal / saveProfile / savePlan used to vault.modify() the
   record loaded at the last reload, so anything another device or an editor
   pane had written to the same note since then was silently erased by the
   next save (and a note deleted outside the app was re-created by a
   sensitivity save). They now run through vault.process():
     - exercise / goal / profile patch ONLY the frontmatter keys the app
       changed since it loaded, and keep the file's current body;
     - a plan (whose body the app regenerates) refuses to overwrite a note
       that changed outside the app: file left alone, Notice, returns false;
     - updating a record whose note is gone never creates a file;
     - every write is recorded per path in plugin._ownWrites so the vault
       watcher can tell our echo from somebody else's edit (cross-lane
       contract #1) — and trash() still is NOT (see vault-io.test.cjs). */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner, notices } = require('./gym-fake-vault');

const { makeIo } = loadSrc('data.js');
const { parseFrontmatter } = loadSrc('markdown.js');

const EX = 'Gym/Exercises/Alpha Hold.md';
const GOAL = 'Gym/Goals/Hold 60.md';
const PLAN = 'Gym/Plans/Core.md';
const PROFILE = 'Gym/Profile.md';
const base = () => [
  [PROFILE, '---\nname: Test\nheight_cm: 170\n---\nTraining context: original.\n'],
  [EX, '---\ntype: strength\nunit: seconds\n---\nAlpha how-to.\n'],
  [GOAL, '---\nmetric: exercise-duration\nexercise: Alpha Hold\ntarget: 60\n---\nGoal note.\n'],
  [PLAN, '---\nactive: true\n---\nIntro.\n\n## Core (mon)\n\n- Alpha Hold | 3 x 30s\n'],
];
const setup = (files = base()) => {
  const v = makeVault(files);
  const plugin = makePlugin(v);
  return { v, plugin, io: makeIo(plugin) };
};
const noticeCount = () => notices.length;

const { check, run } = makeRunner();

check('L2-04 saveExercise keeps an outside edit to the BODY made after the app loaded', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const ex = data.exercises[0];
  v.externalWrite(EX, '---\ntype: strength\nunit: seconds\n---\nAlpha how-to.\n\nMy new coaching cue typed on the phone.\n');
  ex.fm.motion_sensitivity = 'high';
  await io.saveExercise(ex);
  const disk = v._disk.get(EX);
  assert.ok(disk.includes('My new coaching cue typed on the phone.'), `the outside edit to the body was erased:\n${disk}`);
  assert.strictEqual(parseFrontmatter(disk).fm.motion_sensitivity, 'high', `the app's own change is missing:\n${disk}`);
});

check('L2-04 saveExercise keeps an outside edit to ANOTHER frontmatter key', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const ex = data.exercises[0];
  v.externalWrite(EX, '---\ntype: skill\nunit: seconds\nmuscles: [core]\n---\nAlpha how-to.\n');
  ex.fm = { ...ex.fm, motion_sensitivity: 'low' };      // what the Edit form does: spread, then set
  await io.saveExercise(ex);
  const fm = parseFrontmatter(v._disk.get(EX)).fm;
  assert.strictEqual(fm.type, 'skill', `outside change to type was reverted to "${fm.type}"`);
  assert.deepStrictEqual(fm.muscles, ['core'], `outside-added muscles was dropped: ${JSON.stringify(fm.muscles)}`);
  assert.strictEqual(fm.motion_sensitivity, 'low');
});

check('L2-04 a key the app DID change wins over an outside edit of that same key', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const ex = data.exercises[0];
  v.externalWrite(EX, '---\ntype: strength\nunit: reps\n---\nAlpha how-to.\n');
  ex.fm = { ...ex.fm, unit: 'km' };
  await io.saveExercise(ex);
  assert.strictEqual(parseFrontmatter(v._disk.get(EX)).fm.unit, 'km');
});

check('L2-04 two saves from one record both land (the baseline advances after a write)', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const ex = data.exercises[0];
  ex.fm.motion_sensitivity = 'high';
  await io.saveExercise(ex);
  ex.fm.motion_sensitivity = 'low';
  await io.saveExercise(ex);
  assert.strictEqual(parseFrontmatter(v._disk.get(EX)).fm.motion_sensitivity, 'low');
});

check('L2-04 saveGoal keeps an outside edit to the goal note body', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const g = data.goals[0];
  v.externalWrite(GOAL, '---\nmetric: exercise-duration\nexercise: Alpha Hold\ntarget: 60\n---\nGoal note.\n\nAdded on the laptop.\n');
  g.fm = { ...g.fm, target: 90 };
  await io.saveGoal(g);
  const disk = v._disk.get(GOAL);
  assert.ok(disk.includes('Added on the laptop.'), `the outside edit to the goal body was erased:\n${disk}`);
  assert.strictEqual(String(parseFrontmatter(disk).fm.target), '90');
});

check('L2-04 saveProfile keeps an outside edit to the body and to a key the app did not change', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const fm = data.profile.fm;
  v.externalWrite(PROFILE, '---\nname: Test\nheight_cm: 175\n---\nTraining context: rewritten on the phone.\n');
  /* page-profile.js: next = { ...fm, name, birth_year, height_cm, sex } with every form field, changed or not. */
  const next = { ...fm, name: 'Renamed', height_cm: '170' };
  await io.saveProfile(next, data.profile.body);
  const disk = v._disk.get(PROFILE);
  const out = parseFrontmatter(disk);
  assert.strictEqual(out.fm.name, 'Renamed', `the app's own change is missing:\n${disk}`);
  assert.ok(out.body.includes('rewritten on the phone'), `the outside edit to the profile body was erased:\n${disk}`);
  assert.strictEqual(String(out.fm.height_cm), '175', `a key the app left alone was reverted to "${out.fm.height_cm}":\n${disk}`);
});

check('L2-13 updating an exercise whose note was deleted outside the app does NOT re-create it', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const ex = data.exercises[0];
  v.externalTrash(EX);
  ex.fm.motion_sensitivity = 'low';
  const before = noticeCount();
  const result = await io.saveExercise(ex);
  assert.ok(!v.getFileByPath(EX), `the deleted note was re-created (vault log tail ${JSON.stringify(v._log.slice(-2))})`);
  assert.strictEqual(result, false, 'saveExercise must report that nothing was saved');
  assert.ok(noticeCount() > before, 'the user must be TOLD (a visible Notice), not just a console error');
  assert.ok(/Alpha Hold/.test(notices[notices.length - 1]), `the Notice must name the note: "${notices[notices.length - 1]}"`);
});

check('L2-13 same for a goal and a plan', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  v.externalTrash(GOAL);
  v.externalTrash(PLAN);
  const g = data.goals[0], p = data.plans[0];
  g.fm = { ...g.fm, target: 70 };
  p.model.days[0].items[0].sets = 5;
  const rg = await io.saveGoal(g), rp = await io.savePlan(p);
  assert.strictEqual(rg, false, `saveGoal on a deleted note returned ${rg}, not false`);
  assert.strictEqual(rp, false, `savePlan on a deleted note returned ${rp}, not false`);
  assert.ok(!v.getFileByPath(GOAL), 'the deleted goal was re-created');
  assert.ok(!v.getFileByPath(PLAN), 'the deleted plan was re-created');
});

check('L2-04 savePlan REFUSES a note that changed outside the app: file untouched, Notice, false', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const p = data.plans[0];
  const outside = '---\nactive: true\n---\nIntro.\n\n## Core (mon)\n\n- Alpha Hold | 3 x 30s\n- Added on the phone | 1 x 5\n';
  v.externalWrite(PLAN, outside);
  p.model.days[0].items[0].sets = 5;
  const before = noticeCount();
  const result = await io.savePlan(p);
  assert.ok(v._disk.get(PLAN) === outside, `the outside edit was overwritten:\n${v._disk.get(PLAN)}`);
  assert.strictEqual(result, false, 'savePlan must report that it did not write');
  assert.ok(noticeCount() > before, 'the user must be told the plan changed outside the app');
  assert.ok(/changed outside the app/.test(notices[notices.length - 1]), `Notice wording: "${notices[notices.length - 1]}"`);
});

check('L2-04 savePlan on an unchanged note writes, and a second save from the same record also lands', async () => {
  const { v, io } = setup();
  const data = await io.loadAll();
  const p = data.plans[0];
  p.model.days[0].items[0].sets = 5;
  assert.strictEqual(await io.savePlan(p), true);
  p.model.days[0].items[0].target = '45s';
  assert.strictEqual(await io.savePlan(p), true, 'the second save was refused as if the note had changed outside');
  assert.ok(v._disk.get(PLAN).includes('- Alpha Hold | 5 x 45s'), `plan on disk:\n${v._disk.get(PLAN)}`);
});

check('L2-04 setActivePlan keeps the plan savable afterwards (no false "changed outside")', async () => {
  const { v, io } = setup([...base(), ['Gym/Plans/Other.md', '---\nactive: false\n---\n## D (tue)\n\n- X | 1 x 1\n']]);
  const data = await io.loadAll();
  const [core, other] = [data.plans.find(p => p.name === 'Core'), data.plans.find(p => p.name === 'Other')];
  await io.setActivePlan(data.plans, other);
  core.model.days[0].items[0].sets = 4;
  assert.strictEqual(await io.savePlan(core), true, 'setActivePlan rewrote the note and the app then read its own write as an outside edit');
  assert.strictEqual(String(parseFrontmatter(v._disk.get(PLAN)).fm.active), 'false');
});

check('L2-04 saves of one note never overlap (a save sees the previous one land, not race it)', async () => {
  const v = makeVault(base(), { delay: 10 });
  const io = makeIo(makePlugin(v));
  const data = await io.loadAll();
  const p = data.plans[0], ex = data.exercises[0];
  p.model.days[0].items[0].sets = 5;
  ex.fm.motion_sensitivity = 'high';
  const results = await Promise.all([io.savePlan(p), io.savePlan(p), io.savePlan(p), io.saveExercise(ex), io.saveExercise(ex)]);
  assert.deepStrictEqual(v.overlaps, [], `process() ran twice at once on: ${v.overlaps.join(', ')}`);
  assert.deepStrictEqual(results, [true, true, true, true, true], `a queued save was refused as an outside edit: ${JSON.stringify(results)}`);
  assert.ok(v._disk.get(PLAN).includes('- Alpha Hold | 5 x 30s'));
});

check('contract #1 every write is recorded per path in plugin._ownWrites (and _lastWrite is still set)', async () => {
  const { v, plugin, io } = setup();
  const data = await io.loadAll();
  const recent = p => { const t = plugin._ownWrites && plugin._ownWrites.get(p); return typeof t === 'number' && Date.now() - t < 1500; };
  const fresh = async fn => { plugin._ownWrites = new Map(); plugin._lastWrite = 0; await fn(); };

  const ex = data.exercises[0]; ex.fm.motion_sensitivity = 'high';
  await fresh(() => io.saveExercise(ex));
  assert.ok(recent(EX), 'process write (saveExercise) not recorded under its path');
  assert.ok(plugin._lastWrite > 0, '_lastWrite must still be set');

  await fresh(() => io.createExercise({ name: 'New Move', type: 'strength', muscles: [], equipment: '', unit: 'reps' }));
  assert.ok(recent('Gym/Exercises/New Move.md'), 'create (createExercise) not recorded under its path');

  await fresh(() => io.appendBodyRow({ date: '2026-01-01', weight_kg: '80' }));
  assert.ok(recent('Gym/Body Log.md'), 'create/modify (appendBodyRow) not recorded under its path');
  await fresh(() => io.appendBodyRow({ date: '2026-01-02', weight_kg: '79' }));
  assert.ok(recent('Gym/Body Log.md'), 'modify (appendBodyRow, existing file) not recorded under its path');

  await fresh(() => io.savePhoto('standing', '2026-01-01', new ArrayBuffer(2), 'jpg'));
  assert.ok([...plugin._ownWrites.keys()].some(k => /Progress Photos/.test(k) && /\.jpg$/.test(k)), 'createBinary (savePhoto) not recorded under its path');

  await fresh(() => io.saveVoiceClip('seven', new ArrayBuffer(2)));
  const clip = [...plugin._ownWrites.keys()].find(k => /Voice\//.test(k));
  assert.ok(clip, 'createBinary (saveVoiceClip) not recorded');
  await fresh(() => io.saveVoiceClip('seven', new ArrayBuffer(3)));
  assert.ok(plugin._ownWrites.has(clip), 'modifyBinary (saveVoiceClip, existing file) not recorded');

  await fresh(() => io.saveWorkout({ date: '2026-01-01', plan: 'P', day: 'D', duration_min: 5, rows: [] }));
  assert.ok([...plugin._ownWrites.keys()].some(k => /Workouts\//.test(k)), 'create (saveWorkout) not recorded');
});

check('contract #1 trash() stays UNrecorded: the watcher must still see the delete event', async () => {
  const { plugin, io } = setup();
  const data = await io.loadAll();
  plugin._ownWrites = new Map(); plugin._lastWrite = 0;
  await io.trash(data.exercises[0].file);
  assert.strictEqual(plugin._ownWrites.has(EX), false, 'trash() recorded an own-write: the vault delete event would be suppressed (see the comment above trash() in data.js)');
  assert.strictEqual(plugin._lastWrite, 0, 'trash() stamped _lastWrite');
});

run('vault stale writes');
