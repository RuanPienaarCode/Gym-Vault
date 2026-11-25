'use strict';
/* Audit 25 Nov 2026, lane L1 "data" — finding #27, io half.

   io.updateWorkout(file, session) is the writer behind editing a saved
   workout in the app (lane L6 calls it). It rewrites ONLY the workout table
   and the frontmatter keys date / plan / day / duration_min (+ kind when the
   note had one or the session names one). Every other frontmatter line, and
   all text above and below the table, stays byte for byte. It never renames
   or moves the note, writes through exclusive + vault.process, returns the
   path, and throws a clear error when the note is gone.
   Everything is synthetic. */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

const { makeIo } = loadSrc('data.js');
const { parseFrontmatter, tableToObjects } = loadSrc('markdown.js');
const { WORKOUT_COLUMNS } = loadSrc('constants.js');
const { check, run } = makeRunner();

const P = 'Gym/Workouts/2026-11-20 Upper.md';
const ABOVE = 'Felt strong today. Shoulder fine.\n\n> quote block, kept\n\n';
const BELOW = '\n\nNotes after the table — **kept** exactly.\n\n## Later heading\n\n- a list item\n';
const NOTE = [
  '---',
  'date: 2026-11-20',
  'plan: Lunch',
  'day: Upper',
  'mood: "good # really"',
  'duration_min: 30',
  'tags:',
  '  - gym',
  '  - lunch',
  'rpe: 7',
  '---',
  '',
  ABOVE + '| Exercise | Set | Reps | Weight (kg) | Time (s) | Note |',
  '|---|---|---|---|---|---|',
  '| Bench | 1 | 8 | 60 |  | left \\| right felt off |',
  '| Bench | 2 | 8 | 60 |  |  |' + BELOW,
].join('\n');

const rig = async (text = NOTE) => {
  const v = makeVault([[P, text]], { delay: 2 });
  const io = makeIo(makePlugin(v));
  const data = await io.loadAll();
  return { v, io, w: data.workouts.find(x => x.file.path === P) };
};

const edited = (w, extra) => ({
  date: '2026-11-21', plan: 'Lunch', day: 'Upper', duration_min: 35,
  rows: w.rows.map((r, i) => (i === 1 ? { ...r, reps: '10' } : r)),
  ...extra,
});

check('#27 updateWorkout exists on the io object', async () => {
  const { io } = await rig();
  assert.strictEqual(typeof io.updateWorkout, 'function');
});

check('#27 rewrites the table and the four keys; extra keys, above/below text and the Note column survive byte for byte', async () => {
  const { v, io, w } = await rig();
  const out = await io.updateWorkout(w.file, edited(w));
  assert.strictEqual(out, P, 'returns the path');
  const text = v._disk.get(P);
  /* frontmatter: changed keys changed, others the file's own lines */
  for (const line of ['mood: "good # really"', 'tags:\n  - gym\n  - lunch', 'rpe: 7', 'plan: Lunch', 'day: Upper']) {
    assert.ok(text.includes(line), `lost "${line}":\n${text}`);
  }
  const fm = parseFrontmatter(text).fm;
  assert.strictEqual(String(fm.date), '2026-11-21');
  assert.strictEqual(String(fm.duration_min), '35');
  assert.ok(!('kind' in fm), 'grew a kind line');
  /* key order kept: date, plan, day, mood, duration_min, tags, rpe */
  const head = text.slice(0, text.indexOf('\n---\n'));
  const order = ['date:', 'plan:', 'day:', 'mood:', 'duration_min:', 'tags:', 'rpe:'].map(k => head.indexOf(k));
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, `key order changed:\n${head}`);
  /* the body around the table, byte for byte */
  const afterFm = text.slice(text.indexOf('\n---\n') + 5);
  assert.ok(afterFm.startsWith('\n' + ABOVE + '| Exercise |'), `text above the table changed:\n${JSON.stringify(afterFm.slice(0, 120))}`);
  assert.ok(text.endsWith(BELOW), `text below the table changed:\n${JSON.stringify(text.slice(-120))}`);
  /* the table */
  const rows = tableToObjects(afterFm, WORKOUT_COLUMNS);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].note, 'left | right felt off', 'Note column value lost');
  assert.strictEqual(rows[1].reps, '10');
  /* never renamed or moved */
  assert.ok(v.getFileByPath(P));
  assert.deepStrictEqual([...v._disk.keys()].filter(k => k.startsWith('Gym/Workouts/')), [P]);
});

check('#27 the same edit applied twice is stable (no drift in blank lines)', async () => {
  const { v, io, w } = await rig();
  await io.updateWorkout(w.file, edited(w));
  const once = v._disk.get(P);
  await io.updateWorkout(w.file, edited(w));
  assert.strictEqual(v._disk.get(P), once);
});

check('#27 an unchanged session round-trips the note to the same frontmatter and prose', async () => {
  const { v, io, w } = await rig();
  await io.updateWorkout(w.file, { date: '2026-11-20', plan: 'Lunch', day: 'Upper', duration_min: 30, rows: w.rows });
  const text = v._disk.get(P);
  assert.strictEqual(text.slice(0, text.indexOf('| Exercise')), NOTE.slice(0, NOTE.indexOf('| Exercise')));
  assert.ok(text.endsWith(BELOW));
});

check('#27 kind: kept when the note had one, written when the session names one, absent otherwise', async () => {
  const withKind = NOTE.replace('day: Upper\n', 'day: Upper\nkind: challenge\n');
  {
    const { v, io, w } = await rig(withKind);
    await io.updateWorkout(w.file, edited(w));
    assert.strictEqual(parseFrontmatter(v._disk.get(P)).fm.kind, 'challenge');
  }
  {
    const { v, io, w } = await rig();
    await io.updateWorkout(w.file, edited(w, { kind: 'challenge' }));
    assert.strictEqual(parseFrontmatter(v._disk.get(P)).fm.kind, 'challenge');
  }
});

check('#27 a user column of their own on the end of the table is kept', async () => {
  const own = NOTE
    .replace('| Note |\n|---|---|---|---|---|---|', '| Note | Distance (km) | Tempo |\n|---|---|---|---|---|---|---|---|')
    .replace('| left \\| right felt off |', '| left \\| right felt off |  | 3-1-1 |')
    .replace('| 60 |  |  |\n', '| 60 |  |  |  | 2-0-2 |\n');
  const { v, io, w } = await rig(own);
  await io.updateWorkout(w.file, edited(w));
  const text = v._disk.get(P);
  assert.match(text, /\| Tempo \|/, `user column header dropped:\n${text}`);
  assert.match(text, /\| 3-1-1 \|/); assert.match(text, /\| 2-0-2 \|/);
});

check('#27 an edit made elsewhere to the prose since load survives (process on current text)', async () => {
  const { v, io, w } = await rig();
  v.externalWrite(P, v._disk.get(P).replace('Felt strong today.', 'Felt strong today. Added from phone.'));
  await io.updateWorkout(w.file, edited(w));
  assert.match(v._disk.get(P), /Added from phone\./);
});

check('#27 two overlapping edits of one note never overlap in vault.process', async () => {
  const { v, io, w } = await rig();
  await Promise.all([io.updateWorkout(w.file, edited(w)), io.updateWorkout(w.file, edited(w, { duration_min: 40 }))]);
  assert.deepStrictEqual(v.overlaps, []);
  assert.strictEqual(String(parseFrontmatter(v._disk.get(P)).fm.duration_min), '40');
});

check('#27 the note is gone: a clear error, nothing created', async () => {
  const { v, io, w } = await rig();
  v.externalTrash(P);
  await assert.rejects(io.updateWorkout(w.file, edited(w)), /not in the vault|deleted|moved/i);
  assert.ok(!v._disk.has(P));
  assert.ok(![...v._disk.keys()].some(k => k.startsWith('Gym/Workouts/')));
});

check('#27 a note with no table gets one appended below its prose', async () => {
  const bare = '---\ndate: 2026-11-20\nday: Upper\nduration_min: 20\n---\n\nJust a line.\n';
  const { v, io, w } = await rig(bare);
  await io.updateWorkout(w.file, { date: '2026-11-20', day: 'Upper', duration_min: 20, plan: '', rows: [{ exercise: 'Plank', set: 1, seconds: 60 }] });
  const text = v._disk.get(P);
  assert.ok(text.includes('\nJust a line.\n'), text);
  assert.strictEqual(tableToObjects(text, WORKOUT_COLUMNS)[0].exercise, 'Plank');
});

check('#27 light fuzz: random extra keys and prose round-trip untouched', async () => {
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const vals = ['x', '"quoted: yes"', '007', 'a # comment', '[1, 2]', "'single'", '3.5', 'true', ''];
  for (let t = 0; t < 40; t++) {
    const extras = [];
    for (let i = 0; i < 1 + rnd(4); i++) extras.push(`k${i}_${rnd(99)}: ${vals[rnd(vals.length)]}`);
    const above = rnd(2) ? `Para ${rnd(1000)}\n\n` : '';
    const below = rnd(2) ? `\n\nAfter ${rnd(1000)}\n` : '\n';
    const text = `---\ndate: 2026-11-20\n${extras.join('\n')}\nplan: P\nday: D\nduration_min: 10\n---\n\n${above}| Exercise | Set |\n|---|---|\n| A | 1 |${below}`;
    const { v, io, w } = await rig(text);
    await io.updateWorkout(w.file, { date: '2026-11-20', plan: 'P', day: 'D', duration_min: 12, rows: w.rows });
    const out = v._disk.get(P);
    for (const line of extras) assert.ok(out.includes(line + '\n'), `case ${t}: lost "${line}"\n${out}`);
    assert.ok(out.includes('\n\n' + above + '| Exercise |'), `case ${t}: prose above changed\n${out}`);
    assert.ok(out.endsWith(below), `case ${t}: prose below changed\n${out}`);
  }
});

run('audit-1125-data-update-workout');
