'use strict';
/* WHERE XP IS WRITTEN: page-log.finishSession, through rewards-flow, driven for real
   (real data.js over the fake vault, real engine, real ledger file).

   Named cases:
     F1  a finished session writes its ledger lines, and a double tap writes them once
     F2  rewards off: the workout is saved, the ledger is never read, written or created
     F3  nothing saveable: nothing is saved and nothing is read or written
     F4  a failing appendRewards cannot fail the finish (saved, navigated, no XP in the notice)
     F5  a hanging append is waited for only AWARD_WAIT_MS; the finish goes on
     F6  an unreadable ledger cannot fail the finish
     F7  the records a guided session found become PB lines (live session, and the carry for the SAME draft only)
     F8  the notice carries the XP when it was paid
     F9  appendRewards is called from rewards-flow only, from the two places that can hold a SAVED session (the finish and the retry of a failed finish), so an abandoned session has nothing to write it
     F10 the same finish from the log page (no guided session): sets and session lines, no PB */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const { makeIo } = loadSrc('data.js');
const pageLog = loadSrc('page-log.js');
const flowMod = require('../src/rewards-flow');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');

const { check, run } = makeRunner();
const realErr = console.error; console.error = () => {};

const mkDraft = (nSets = 3) => ({
  date: '2026-10-14', plan: 'P', day: 'Push', startedAt: Date.now() - 600000,
  entries: [{ exercise: 'Pull-ups', target: '', duration: false, weighted: false, distance: false,
    sets: Array.from({ length: nSets }, () => ({ reps: '8', weight_kg: '', seconds: '', done: true, touched: true })) }],
});
function mkCtx(o = {}) {
  const v = makeVault([]);
  const plugin = makePlugin(v, Object.assign({ weekStart: 'mon' }, o.settings || {}));
  const io = makeIo(plugin);
  const calls = { read: 0, append: 0, save: 0 };
  const rr = io.readRewards, ar = io.appendRewards, sw = io.saveWorkout;
  io.readRewards = async () => { calls.read++; if (o.readThrows) throw new Error('boom'); return rr(); };
  io.appendRewards = async e => { calls.append++; if (o.appendThrows) throw new Error('vault write failed'); if (o.appendHangs) return new Promise(() => {}); return ar(e); };
  io.saveWorkout = async w => { calls.save++; return sw(w); };
  const draft = o.draft || mkDraft();
  const notices = [], navs = [];
  const ctx = {
    io, settings: plugin.settings, data: { workouts: [], exercises: F.EXERCISES }, daysOn: () => [],
    state: { logDraft: draft, session: o.session || null, sessionCarry: o.carry || null },
    notice: m => notices.push(m), nav: p => navs.push(p), reload: () => {},
  };
  return { v, ctx, draft, calls, notices, navs };
}
const ledgerText = v => v._disk.get('Gym/Rewards.md') || null;
const keysOf = v => (ledgerText(v) ? [...L.parseLedger(ledgerText(v)).keys] : []);

check('F1 a finished session writes its ledger lines; a double tap writes them once', async () => {
  const { v, ctx, draft, calls } = mkCtx();
  await Promise.all([pageLog.finishSession(ctx, draft), pageLog.finishSession(ctx, draft)]);
  await pageLog.finishSession(ctx, draft);
  assert.strictEqual(calls.save, 1, 'one workout note');
  assert.strictEqual(calls.append, 1, 'one ledger append');
  const led = L.parseLedger(ledgerText(v));
  assert.deepStrictEqual(led.entries.map(e => [e.kind, e.xp]), [['session', 100], ['sets', 15]]);
  const note = [...v._disk.keys()].find(k => k.startsWith('Gym/Workouts/'));
  assert.ok(note, 'the workout note exists');
  assert.deepStrictEqual(led.entries.map(e => e.key), [`session:${note}`, `sets:${note}`], 'keyed by the saved note\'s path');
  assert.strictEqual(draft.rewardsAwarded, true);
});

check('F2 rewards off: saved, but the ledger is never read, written or created', async () => {
  const { v, ctx, draft, calls, navs } = mkCtx({ settings: { rewards: false } });
  await pageLog.finishSession(ctx, draft);
  assert.strictEqual(calls.save, 1);
  assert.deepStrictEqual([calls.read, calls.append], [0, 0], 'no ledger call at all');
  assert.strictEqual(ledgerText(v), null);
  assert.ok(![...v._disk.keys()].some(k => /Rewards/i.test(k)));
  assert.deepStrictEqual(navs, ['dashboard']);
});

check('F3 nothing saveable: nothing is saved, read or written', async () => {
  const { v, ctx, draft, calls, notices } = mkCtx({ draft: mkDraft(0) });
  await pageLog.finishSession(ctx, draft);
  assert.deepStrictEqual([calls.save, calls.read, calls.append], [0, 0, 0]);
  assert.strictEqual(ledgerText(v), null);
  assert.ok(notices[0] && /Tick a set/.test(notices[0]));
  assert.ok(ctx.state.logDraft === draft, 'the draft is untouched');
});

check('F4 a failing appendRewards cannot fail the finish', async () => {
  const { v, ctx, draft, calls, notices, navs } = mkCtx({ appendThrows: true });
  await pageLog.finishSession(ctx, draft);
  assert.strictEqual(calls.save, 1);
  assert.strictEqual(calls.append, 1);
  assert.ok([...v._disk.keys()].some(k => k.startsWith('Gym/Workouts/')), 'the workout note is on disk');
  assert.strictEqual(ledgerText(v), null);
  assert.deepStrictEqual(navs, ['dashboard']);
  assert.strictEqual(ctx.state.logDraft, null);
  assert.deepStrictEqual(notices, ['Session logged. Strong work.'], 'no XP claimed that was not written');
});

check('F4b awardFinished itself never rejects: a throwing append resolves null and leaves the cache retired', async () => {
  const { ctx, draft } = mkCtx({ appendThrows: true });
  ctx.state.rewardsCache = { data: ctx.data, done: true };
  const rows = pageLog.buildRows(draft);
  const got = await flowMod.awardFinished(ctx, draft, rows, 'Gym/Workouts/x.md');
  assert.strictEqual(got, null);
  assert.strictEqual(ctx.state.rewardsCache, null, 'the screens read the ledger again');
});

check('F5 a hanging append is waited for only AWARD_WAIT_MS', async () => {
  flowMod.flow.AWARD_WAIT_MS = 40;
  try {
    const { ctx, draft, navs, notices } = mkCtx({ appendHangs: true });
    const t0 = Date.now();
    /* a watchdog that keeps the loop alive: a finish that never returns must FAIL here, not let node exit quietly */
    let dog;
    await Promise.race([pageLog.finishSession(ctx, draft), new Promise((_, rej) => { dog = setTimeout(() => rej(new Error('finishSession never returned: it is waiting on the award')), 2500); })]);
    clearTimeout(dog);
    assert.ok(Date.now() - t0 < 1000, `finish took ${Date.now() - t0}ms`);
    assert.deepStrictEqual(navs, ['dashboard']);
    assert.deepStrictEqual(notices, ['Session logged. Strong work.']);
  } finally { flowMod.flow.AWARD_WAIT_MS = 1500; }
});

check('F6 an unreadable ledger cannot fail the finish', async () => {
  const { v, ctx, draft, calls, navs } = mkCtx({ readThrows: true });
  await pageLog.finishSession(ctx, draft);
  assert.strictEqual(calls.save, 1);
  assert.deepStrictEqual(navs, ['dashboard']);
  assert.strictEqual(ledgerText(v), null);
});

check('F7 records become PB lines: from the live session, and from the carry of the SAME draft only', async () => {
  const rec = [{ key: 'Pull-ups/reps', exercise: 'Pull-ups', kind: 'reps', val: '12', prev: 9 }];
  const a = mkCtx({ session: { records: rec, workoutsAtStart: [] } });
  await pageLog.finishSession(a.ctx, a.draft);
  assert.deepStrictEqual(L.parseLedger(ledgerText(a.v)).entries.map(e => e.kind), ['session', 'sets', 'pb']);
  const d = mkDraft();
  const b = mkCtx({ draft: d, carry: { draft: d, records: rec } });
  await pageLog.finishSession(b.ctx, b.draft);
  assert.ok(L.parseLedger(ledgerText(b.v)).entries.some(e => e.kind === 'pb'), 'the carry for this draft counts');
  const c = mkCtx({ carry: { draft: mkDraft(), records: rec } });
  await pageLog.finishSession(c.ctx, c.draft);
  assert.ok(!L.parseLedger(ledgerText(c.v)).entries.some(e => e.kind === 'pb'), 'another draft\'s carry never counts');
});

check('F8 the notice carries the XP when it was paid', async () => {
  const { ctx, draft, notices } = mkCtx();
  await pageLog.finishSession(ctx, draft);
  assert.deepStrictEqual(notices, ['Session logged. Strong work. +115 XP']);
});

check('F9 appendRewards is called only from rewards-flow, finish and retry', () => {
  const dir = path.join(__dirname, '..', 'src');
  const hits = fs.readdirSync(dir).filter(f => f.endsWith('.js') && /appendRewards\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.deepStrictEqual(hits.sort(), ['data.js', 'rewards-flow.js'], `appendRewards callers: ${hits}`);
  const src = fs.readFileSync(path.join(dir, 'rewards-flow.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.strictEqual((code.match(/appendRewards\(/g) || []).length, 2, 'two call sites in rewards-flow: the finish and the retry');
  /* the retry can only work on a job the finish queued, and the finish only queues once the workout note exists */
  const fin = code.slice(code.indexOf('async function awardFinished'), code.indexOf('async function retryOne'));
  assert.strictEqual((code.match(/queueRetry\(ctx, job\);/g) || []).length, (fin.match(/queueRetry\(ctx, job\);/g) || []).length, 'queueRetry is called from awardFinished only');
  assert.ok((fin.match(/appendRewards\(/g) || []).length === 1, 'the finish has the first call site');
  const log = fs.readFileSync(path.join(dir, 'page-log.js'), 'utf8');
  assert.ok(/saveWorkout\([\s\S]*?\}\);[\s\S]*?awardWithin\(/.test(log), 'finishSession awards AFTER the note is saved');
});

check('F10 the log page path (no guided session): session and sets lines, no PB', async () => {
  const { v, ctx, draft } = mkCtx({ draft: mkDraft(5) });
  await pageLog.finishSession(ctx, draft);
  assert.deepStrictEqual(L.parseLedger(ledgerText(v)).entries.map(e => [e.kind, e.xp]), [['session', 100], ['sets', 25]]);
  assert.deepStrictEqual(keysOf(v).length, 2);
});

run('rewards finish');
process.on('exit', () => { console.error = realErr; });
