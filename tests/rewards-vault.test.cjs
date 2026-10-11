'use strict';
/* io.readRewards / io.appendRewards against the fake vault (it copies
   Obsidian 1.14.4's write timing: process() reads the file as it is on disk,
   two overlapping process() calls are NOT serialised unless the plugin does it).

   Named cases:
     V1  the path follows the configurable Gym folder
     V2  a missing ledger reads as empty (and creates nothing)
     V3  first append creates the note; the write is stamped in _ownWrites
     V4  later appends add ONLY the new lines (existing text is a prefix) through process(), never modify()
     V5  idempotent: the same key twice is one line, and the second call writes nothing at all
     V6  a stale file: a line synced in from another device is kept, ours lands after it
     V7  concurrent appends serialise (no overlap) and every line lands, creating or appending
     V8  a hand-made `rewards.md` (case-insensitive clash) is appended to, not duplicated
     V9  rewards off: nothing read, nothing written, no vault call at all
     V10 a garbage line in the file loses only itself through a read and an append
     V11 end to end: awardsForSession -> appendRewards -> readRewards -> summarise
     V12 loadAll ignores the ledger (Rewards.md never reads as a plan, workout or exercise)
     V13 the other device's line lands BETWEEN our read and our write: it is kept (the write applies to the current text)
     V14 two devices create the file at once: the loser appends to the winner's file
     V15 a failing vault write rejects with ITS error and does not wedge the queue
     V16 the file deleted mid-append: ours is created fresh, nothing is lost or thrown */
const assert = require('node:assert');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const { makeIo } = loadSrc('data.js');
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');

const PATH = 'Gym/Rewards.md';
const e = (key, xp, kind, date) => ({ date: date || '2026-10-12', kind: kind || 'session', key, xp, note: '' });
const setup = (files = [], opts = {}, settings = {}) => {
  const v = makeVault(files, opts);
  const plugin = makePlugin(v, settings);
  return { v, plugin, io: makeIo(plugin) };
};
const writes = v => v._log.filter(([op]) => op !== 'EXTERNAL-write' && op !== 'EXTERNAL-trash');

const { check, run } = makeRunner();

check('V1 the path follows the configurable Gym folder', async () => {
  assert.strictEqual(setup().io.paths.rewards(), 'Gym/Rewards.md');
  const { v, io, plugin } = setup([], {}, { gymFolder: 'Training/Gym' });
  assert.strictEqual(io.paths.rewards(), 'Training/Gym/Rewards.md');
  await io.appendRewards([e('session:a', 100)]);
  assert.ok(v._disk.has('Training/Gym/Rewards.md'), [...v._disk.keys()].join(','));
  assert.ok(!v._disk.has('Gym/Rewards.md'));
  assert.ok(plugin._ownWrites.has('Training/Gym/Rewards.md'));
});

check('V2 a missing ledger reads as empty and creates nothing', async () => {
  const { v, io } = setup();
  const r = await io.readRewards();
  assert.deepStrictEqual([r.entries, r.exists, r.disabled, r.unreadable], [[], false, false, false]);
  assert.strictEqual(r.keys.size, 0);
  assert.strictEqual(writes(v).length, 0);
  assert.ok(!v._disk.has(PATH));
});

check('V3 the first append creates the note and stamps it in _ownWrites', async () => {
  const { v, io, plugin } = setup();
  const res = await io.appendRewards([e('session:a', 100), e('sets:a', 70, 'sets')]);
  assert.strictEqual(res.created, true);
  assert.strictEqual(res.appended.length, 2);
  assert.ok(plugin._ownWrites instanceof Map && plugin._ownWrites.has(PATH), 'the watcher cannot tell this write is ours');
  assert.ok(Date.now() - plugin._ownWrites.get(PATH) < 1500);
  const text = v._disk.get(PATH);
  assert.ok(text.startsWith('---\ntype: rewards\nstarted: 2026-10-12\n---\n'), text);
  const back = await io.readRewards();
  assert.deepStrictEqual(back.entries.map(x => [x.key, x.xp]), [['session:a', 100], ['sets:a', 70]]);
  assert.strictEqual(back.exists, true);
  assert.strictEqual(back.started, '2026-10-12');
});

check('V4 later appends add only the new lines, through process(), never modify()', async () => {
  const { v, io } = setup();
  await io.appendRewards([e('session:a', 100)]);
  const before = v._disk.get(PATH);
  v._log.length = 0;
  const res = await io.appendRewards([e('sets:a', 70, 'sets')]);
  const after = v._disk.get(PATH);
  assert.strictEqual(res.created, false);
  assert.ok(after.startsWith(before), 'existing text was rewritten');
  assert.strictEqual(after.slice(before.length).split('\n').filter(Boolean).length, 1, 'exactly one new line');
  assert.deepStrictEqual(writes(v), [['process', PATH]], JSON.stringify(writes(v)));
});

check('V5 idempotent: the same key twice is one line, and the second call writes nothing', async () => {
  const { v, io, plugin } = setup();
  await io.appendRewards([e('session:a', 100)]);
  const text = v._disk.get(PATH);
  v._log.length = 0;
  plugin._ownWrites.clear();
  const again = await io.appendRewards([e('session:a', 100)]);
  assert.deepStrictEqual(again.appended, []);
  assert.deepStrictEqual(again.skipped, [{ key: 'session:a', why: 'present' }]);
  assert.strictEqual(v._disk.get(PATH), text);
  assert.strictEqual(writes(v).length, 0, 'a no-op append must not touch the file (sync churn)');
  assert.strictEqual(plugin._ownWrites.size, 0);
  const dup = await io.appendRewards([e('x:1', 5), e('x:1', 5)]);
  assert.strictEqual(dup.appended.length, 1);
  assert.strictEqual((await io.readRewards()).entries.filter(x => x.key === 'x:1').length, 1);
});

check('V6 a stale file: a line synced in from another device is kept, ours lands after it', async () => {
  const { v, io } = setup();
  await io.appendRewards([e('session:a', 100)]);
  const read = await io.readRewards();                       // what the app "knew"
  assert.strictEqual(read.entries.length, 1);
  /* the other device's append arrives (iCloud) after our read */
  const theirs = L.appendToText(v._disk.get(PATH), [e('session:phone', 100, 'session', '2026-10-12')]).text;
  v.externalWrite(PATH, theirs);
  await io.appendRewards([e('sets:a', 70, 'sets')]);
  const keys = L.parseLedger(v._disk.get(PATH)).entries.map(x => x.key);
  assert.deepStrictEqual(keys, ['session:a', 'session:phone', 'sets:a'], 'the newer file content must be the base');
  /* and a key the other device already paid is not paid again from our stale view */
  const dupe = await io.appendRewards([e('session:phone', 100)]);
  assert.deepStrictEqual(dupe.appended, []);
});

check('V7 concurrent appends serialise and every line lands (creating, then appending)', async () => {
  for (const delay of [0, 5]) {
    const { v, io } = setup([], { delay });
    const batch = i => [e(`session:${i}`, 100), e(`sets:${i}`, 5 * i, 'sets')];
    await Promise.all([1, 2, 3, 4, 5, 6].map(i => io.appendRewards(batch(i))));
    const keys = L.parseLedger(v._disk.get(PATH)).entries.map(x => x.key).sort();
    assert.strictEqual(keys.length, 12, `delay ${delay}: ${keys.join(',')}`);
    assert.deepStrictEqual(v.overlaps, [], 'two writes of Rewards.md overlapped');
    assert.strictEqual(writes(v).filter(([op]) => op === 'create').length, 1, 'created more than once');
  }
  /* the same session finishing twice at once pays once */
  const { v, io } = setup([], { delay: 5 });
  await Promise.all([io.appendRewards([e('session:z', 100)]), io.appendRewards([e('session:z', 100)])]);
  assert.strictEqual(L.parseLedger(v._disk.get(PATH)).entries.length, 1);
});

check('V8 a hand-made rewards.md (case-insensitive clash) is appended to, not duplicated', async () => {
  const hand = '---\ntype: rewards\n---\n# mine\n\n| Date | Kind | Key | XP | Note |\n| --- | --- | --- | --- | --- |\n| 2026-10-01 | session | session:old | 100 | x |\n';
  const { v, io } = setup([['Gym/rewards.md', hand]]);
  const res = await io.appendRewards([e('session:new', 100)]);
  assert.strictEqual(res.created, false);
  assert.ok(!v._disk.has(PATH), 'a second file was created beside the hand-made one');
  assert.deepStrictEqual(L.parseLedger(v._disk.get('Gym/rewards.md')).entries.map(x => x.key), ['session:old', 'session:new']);
  assert.ok(v._disk.get('Gym/rewards.md').startsWith(hand));
  assert.deepStrictEqual((await io.readRewards()).entries.map(x => x.key), ['session:old', 'session:new']);
});

check('V9 rewards off: nothing read, nothing written, no vault call at all', async () => {
  const { v, io } = setup([[PATH, L.appendToText(null, [e('session:a', 100)]).text]], {}, { rewards: false });
  v._log.length = 0;
  const before = v._disk.get(PATH);
  const r = await io.readRewards();
  assert.deepStrictEqual([r.entries.length, r.disabled], [0, true]);
  const w = await io.appendRewards([e('session:b', 100)]);
  assert.deepStrictEqual([w.appended.length, w.disabled], [0, true]);
  assert.strictEqual(v._disk.get(PATH), before);
  assert.strictEqual(v._log.length, 0, `vault was touched: ${JSON.stringify(v._log)}`);
  /* absent setting = on */
  const on = setup();
  assert.strictEqual((await on.io.appendRewards([e('session:a', 100)])).appended.length, 1);
});

check('V10 a garbage line loses only itself through a read and an append', async () => {
  const text = L.appendToText(null, [e('session:a', 100)]).text + 'total garbage\n| 2026-10-12 | session | | xx |\n| 2026-10-12 | bonus-x | b:1 | 25 | future kind |\n';
  const { v, io } = setup([[PATH, text]]);
  const r = await io.readRewards();
  assert.deepStrictEqual(r.entries.map(x => x.key), ['session:a', 'b:1']);
  assert.strictEqual(r.bad.length, 1);
  assert.strictEqual(r.unknown, 1);
  await io.appendRewards([e('sets:a', 70, 'sets')]);
  assert.ok(v._disk.get(PATH).startsWith(text), 'existing lines (even broken ones) must never be rewritten');
  assert.deepStrictEqual((await io.readRewards()).entries.map(x => x.key), ['session:a', 'b:1', 'sets:a']);
});

check('V11 end to end: awards -> appendRewards -> readRewards -> summarise', async () => {
  const { io } = setup();
  const common = { daysOn: () => [], exercises: F.EXERCISES, weekStart: 'mon', settings: {} };
  let history = [F.wk('2026-10-06', F.sets('Squat', 3, { reps: 5, kg: 60 }), 'prev')];
  for (const [date, n] of [['2026-10-12', 14], ['2026-10-14', 6]]) {
    const key = `Gym/Workouts/${date} Push.md`;
    const sets = F.sets('Squat', n, { reps: 5, kg: 60 });
    const awards = R.awardsForSession({ ...common, workoutKey: key, date, sets, records: date === '2026-10-12' ? [{ key: 'Squat/weight', exercise: 'Squat', kind: 'weight', val: '60', prev: 55 }] : [], workouts: history, ledgerState: await io.readRewards() });
    await io.appendRewards(awards);
    history = history.concat([F.wk(date, sets, `${date} Push`)]);
  }
  const state = await io.readRewards();
  const sum = R.summarise(state, '2026-10-14', { weekStart: 'mon' });
  /* session 1: 100 + 70 + 50 + 20 (streak: last week had a session); session 2: 100 + 30 (streak already paid this week) */
  assert.strictEqual(sum.totalXp, 240 + 130);
  assert.strictEqual(sum.sessions, 2);
  assert.strictEqual(sum.thisWeek.streakKept, true);
  assert.deepStrictEqual(sum.lastAwards.items.map(i => i.kind), ['session', 'sets']);
  assert.strictEqual(sum.lastAwards.xp, 130);
  /* finishing the same session again pays nothing */
  const again = R.awardsForSession({ ...common, workoutKey: 'Gym/Workouts/2026-10-14 Push.md', date: '2026-10-14', sets: F.sets('Squat', 6, { reps: 5, kg: 60 }), records: [], workouts: history, ledgerState: state });
  assert.deepStrictEqual(again, []);
});

check('V12 loadAll ignores the ledger', async () => {
  const { io } = setup([[PATH, L.appendToText(null, [e('session:a', 100)]).text]]);
  const data = await io.loadAll();
  assert.deepStrictEqual([data.plans.length, data.workouts.length, data.exercises.length, data.goals.length, data.unreadable], [0, 0, 0, 0, 0]);
});

/* Run `after` once, right after the next v.read() resolves - i.e. between the
   append's own read of the file and its write. */
const afterNextRead = (v, after) => {
  const orig = v.read.bind(v);
  let armed = true;
  v.read = async f => { const text = await orig(f); if (armed) { armed = false; after(); } return text; };
};

check('V13 a line synced in BETWEEN our read and our write is kept', async () => {
  const { v, io } = setup();
  await io.appendRewards([e('session:a', 100)]);
  afterNextRead(v, () => v.externalWrite(PATH, L.appendToText(v._disk.get(PATH), [e('session:phone', 100)]).text));
  const res = await io.appendRewards([e('sets:a', 70, 'sets')]);
  assert.deepStrictEqual(res.appended.map(x => x.key), ['sets:a']);
  assert.deepStrictEqual(L.parseLedger(v._disk.get(PATH)).entries.map(x => x.key), ['session:a', 'session:phone', 'sets:a']);
});

check('V14 two devices create the file at once: the loser appends to the winner\'s file', async () => {
  const { v, io } = setup();
  const create = v.create.bind(v);
  v.create = async (p, text) => {
    v.create = create;
    v.externalWrite(p, L.appendToText(null, [e('session:phone', 100)]).text);   // the other device got there first
    return create(p, text);                                                    // -> "File already exists."
  };
  const res = await io.appendRewards([e('session:a', 100)]);
  assert.strictEqual(res.created, false);
  assert.deepStrictEqual(L.parseLedger(v._disk.get(PATH)).entries.map(x => x.key), ['session:phone', 'session:a']);
});

check('V15 a failing vault write rejects with its own error and does not wedge the queue', async () => {
  const { v, io } = setup();
  const create = v.create.bind(v);
  v.create = async () => { throw new Error('disk full'); };
  await assert.rejects(() => io.appendRewards([e('session:a', 100)]), /disk full/);
  v.create = create;
  const ok = await io.appendRewards([e('session:a', 100)]);
  assert.strictEqual(ok.appended.length, 1, 'the queue stayed wedged after one failure');
});

check('V16 the file deleted mid-append: ours is created fresh, nothing thrown', async () => {
  const { v, io } = setup();
  await io.appendRewards([e('session:a', 100)]);
  afterNextRead(v, () => v.externalTrash(PATH));
  const res = await io.appendRewards([e('sets:a', 70, 'sets')]);
  assert.deepStrictEqual(res.appended.map(x => x.key), ['sets:a']);
  assert.strictEqual(res.created, true);
  assert.deepStrictEqual(L.parseLedger(v._disk.get(PATH)).entries.map(x => x.key), ['sets:a']);
});

run('rewards-vault');
