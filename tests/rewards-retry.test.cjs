'use strict';
/* A FAILED OR SLOW AWARD IS TOLD ABOUT AND RETRIED (iOS-safety review, 0.14.0).

   page-log.finishSession waits up to AWARD_WAIT_MS for the XP to be written, silently, and
   draft.rewardsAwarded is set before the write, so an award that failed - the vault threw,
   or Rewards.md would not read yet on iCloud - was lost for good: the draft is gone once the
   session is saved. Now (rewards-flow.js):
     - a wait past FEEDBACK_MS shows "Saving rewards..." and takes it down when the wait ends;
     - a failed award is queued on ctx.state.rewardsRetry and tried once on the next Today
       render and once more at the next session start, each against a FRESH read, so nothing
       already in the ledger is paid twice.

   Named cases:
     W1  a slow award shows "Saving rewards..." once, and hides it when the wait ends
     W2  a fast award, and a wait shorter than the threshold, show nothing
     W3  a failed append is queued, then paid ONCE by the next Today render (queue empties, notice says so)
     W4  a ledger that will not read (undownloaded iCloud file) is refused, queued, never written over, and paid once it can be read
     W5  a retry that fails again waits for the session start (its second and last try), then is dropped
     W6  a success is never queued and a later Today render does not touch the ledger
     W7  a session that was never saved queues nothing and nothing is retried for it
     W8  rewards off: nothing queued, and a job already queued is not retried
     W9  an award that actually landed before the error is not paid twice by the retry
     W10 two Today renders in one go make ONE attempt (the in-flight and per-phase guards)
     W11 an award that finishes LATE and fails is queued too
     W12 a read that throws before any award is worked out is queued and paid from the snapshot
     W13 the retry list holds one job per workout, and a session start with an empty list does nothing */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

const mkNode = tag => {
  const n = {
    nodeType: 1, tag, className: '', children: [], attrs: {}, parent: null, _connected: true,
    classList: {
      add(...c) { const s = new Set(String(n.className).split(/\s+/).filter(Boolean)); c.forEach(x => s.add(x)); n.className = [...s].join(' '); },
      remove(c) { n.className = String(n.className).split(/\s+/).filter(x => x && x !== c).join(' '); },
      contains: c => String(n.className).split(/\s+/).includes(c),
    },
    style: {},
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === 'class') n.className = String(v); },
    getAttribute: k => (k in n.attrs ? n.attrs[k] : null),
    addEventListener() {},
    append(...kids) { for (const k of kids.flat()) { if (k == null) continue; if (k.nodeType === 1) k.parent = n; n.children.push(k); } },
    appendChild(k) { n.append(k); return k; },
    get firstChild() { return n.children[0] || null; },
    get lastChild() { return n.children[n.children.length - 1] || null; },
    removeChild(k) { const i = n.children.indexOf(k); if (i >= 0) n.children.splice(i, 1); return k; },
    get isConnected() { return n._connected; },
    get textContent() { return n.children.map(c => (c.nodeType === 3 ? c.text : c.textContent)).join(''); },
    set textContent(t) { n.children = [{ nodeType: 3, text: String(t), parent: n }]; },
    querySelector() { return null; },
  };
  return n;
};
global.document = { createElement: mkNode, createElementNS: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }), addEventListener() {}, removeEventListener() {} };
global.window = global.window || { setTimeout, clearTimeout };

const ui = loadSrc('rewards-ui.js');
const pageLog = loadSrc('page-log.js');
const { makeIo } = loadSrc('data.js');
const flow = require('../src/rewards-flow');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');

const { check, run } = makeRunner();
const realErr = console.error; console.error = () => {};
const flush = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PATH = 'Gym/Rewards.md';
const DAY = F.day('Push', [['Pull-ups', 4, 'submax']]);

const mkDraft = (nSets = 3) => ({
  date: '2026-10-14', plan: 'P', day: 'Push', startedAt: Date.now() - 600000,
  entries: [{ exercise: 'Pull-ups', target: '', duration: false, weighted: false, distance: false,
    sets: Array.from({ length: nSets }, () => ({ reps: '8', weight_kg: '', seconds: '', done: true, touched: true })) }],
});

/* o.fail: number of appendRewards calls that throw first; o.slow: ms an append takes;
   o.vault: makeVault options (emptyRead ...). */
function mkCtx(o = {}) {
  const files = o.files || [];
  const v = makeVault(files, o.vault || {});
  const plugin = makePlugin(v, Object.assign({ weekStart: 'mon' }, o.settings || {}));
  const io = makeIo(plugin);
  const calls = { read: 0, append: 0, results: [] };
  const rr = io.readRewards, ar = io.appendRewards;
  let toFail = o.fail || 0, readFails = o.readFail || 0;
  io.readRewards = async () => {
    calls.read++;
    if (readFails > 0) { readFails--; throw new Error('read boom'); }
    const got = await rr();
    if (o.afterRead && o.afterRead.length) o.afterRead.shift()(v);          // the world changes right after a read
    return got;
  };
  io.appendRewards = async e => {
    calls.append++;
    if (o.slow) await sleep(o.slow);
    if (toFail > 0) { toFail--; if (o.landThenFail) await ar(e); throw new Error('vault write failed'); }
    const r = await ar(e); calls.results.push(r); return r;
  };
  const draft = o.draft || mkDraft();
  const shown = [], hidden = [], notices = [], navs = [];
  const ctx = {
    io, settings: plugin.settings, data: { workouts: [], exercises: F.EXERCISES }, daysOn: () => [],
    state: { logDraft: draft, session: null, sessionCarry: null, page: 'log' },
    notice: m => { notices.push(m); const n = { m, hide() { hidden.push(m); } }; shown.push(n); return n; },
    nav: p => navs.push(p), reload: () => {}, rerender: () => {},
  };
  return { v, ctx, draft, calls, notices, shown, hidden, navs, plugin };
}
const ledgerKeys = v => (v._disk.get(PATH) ? [...L.parseLedger(v._disk.get(PATH)).keys] : []);
const queue = ctx => ctx.state.rewardsRetry || [];
const slots = () => ({ level: mkNode('div'), quest: mkNode('div'), chip: mkNode('span'), stage: mkNode('div') });
const todayRender = async ctx => { ui.mountToday(ctx, Object.assign({ day: DAY }, slots())); await flush(); await flush(); await sleep(5); };
const startSession = async ctx => { pageLog.startDraft(ctx, { name: 'P' }, { name: 'Push', items: [] }); await flush(); await flush(); await sleep(5); };
const withWait = async (ms, fb, fn) => {
  const was = [flow.flow.AWARD_WAIT_MS, flow.flow.FEEDBACK_MS];
  flow.flow.AWARD_WAIT_MS = ms; flow.flow.FEEDBACK_MS = fb;
  try { await fn(); } finally { [flow.flow.AWARD_WAIT_MS, flow.flow.FEEDBACK_MS] = was; }
};

check('W1 a slow award shows "Saving rewards…" once, and hides it when the wait ends', () => withWait(600, 30, async () => {
  const t = mkCtx({ slow: 150 });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.deepStrictEqual(t.notices.filter(m => /Saving/.test(m)), ['Saving rewards…']);
  assert.deepStrictEqual(t.hidden, ['Saving rewards…'], 'taken down when the award finished');
  assert.ok(/^Session logged\. Strong work\. \+115 XP$/.test(t.notices[t.notices.length - 1]), t.notices.join(' | '));
  assert.strictEqual(ledgerKeys(t.v).length, 2);
}));

check('W2 a fast award, and a wait shorter than the threshold, show nothing', () => withWait(600, 200, async () => {
  const t = mkCtx();
  await pageLog.finishSession(t.ctx, t.draft);
  assert.ok(!t.notices.some(m => /Saving/.test(m)), t.notices.join(' | '));
  /* a wait that is not longer than the threshold can never reach it */
  await withWait(40, 400, async () => {
    const u = mkCtx({ slow: 100 });
    await pageLog.finishSession(u.ctx, u.draft);
    assert.ok(!u.notices.some(m => /Saving/.test(m)));
  });
}));

check('W3 a failed append is queued, then paid once by the next Today render', async () => {
  const t = mkCtx({ fail: 1 });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(ledgerKeys(t.v).length, 0, 'nothing was written');
  assert.strictEqual(queue(t.ctx).length, 1, 'queued');
  assert.ok(/^Gym\/Workouts\//.test(queue(t.ctx)[0].path), 'with the workout path');
  assert.deepStrictEqual(t.notices, ['Session logged. Strong work.'], 'no XP claimed that was not written');
  t.notices.length = 0;
  await todayRender(t.ctx);
  const note = [...t.v._disk.keys()].find(k => k.startsWith('Gym/Workouts/'));
  assert.deepStrictEqual(ledgerKeys(t.v), [`session:${note}`, `sets:${note}`], 'paid, keyed by the saved note');
  assert.strictEqual(queue(t.ctx).length, 0, 'queue empty');
  assert.deepStrictEqual(t.notices, ['Rewards saved for your last session. +115 XP']);
  assert.strictEqual(t.ctx.state.rewardsLast.entries.length, 2, 'and Today has the new total at once');
});

check('W4 an unreadable ledger is refused, queued, never written over, and paid once it can be read', async () => {
  const prior = L.appendToText(null, [{ date: '2026-10-01', kind: 'session', key: 'session:old', xp: 100, note: '' }]).text;
  const t = mkCtx({ files: [[PATH, prior]], vault: { emptyRead: [PATH] } });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(t.v._disk.get(PATH), prior, 'the unreadable ledger was not replaced');
  assert.strictEqual(queue(t.ctx).length, 1);
  assert.strictEqual(t.calls.append, 0, 'never even asked to append against a ledger that would not read');
  assert.deepStrictEqual(t.notices, ['Session logged. Strong work.']);
  t.v.download(PATH);
  await todayRender(t.ctx);
  const keys = ledgerKeys(t.v);
  assert.strictEqual(keys.length, 3, keys.join(','));
  assert.strictEqual(keys[0], 'session:old', 'their line is still first');
  assert.strictEqual(queue(t.ctx).length, 0);
});

check('W5 a retry that fails again waits for the session start (its last try), then is dropped', async () => {
  const t = mkCtx({ fail: 3 });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(t.calls.append, 1);
  await todayRender(t.ctx);
  assert.strictEqual(t.calls.append, 2, 'one retry on Today');
  assert.strictEqual(queue(t.ctx).length, 1, 'still queued: it has one try left');
  await todayRender(t.ctx); await todayRender(t.ctx);
  assert.strictEqual(t.calls.append, 2, 'Today never retries twice');
  await startSession(t.ctx);
  assert.strictEqual(t.calls.append, 3, 'one more at the next session start');
  assert.strictEqual(queue(t.ctx).length, 0, 'both tries spent: dropped, not held for ever');
  await todayRender(t.ctx); await startSession(t.ctx);
  assert.strictEqual(t.calls.append, 3, 'and never again');
  assert.strictEqual(ledgerKeys(t.v).length, 0);
});

check('W5b the session-start retry pays it when Today never got a chance', async () => {
  const t = mkCtx({ fail: 1 });
  await pageLog.finishSession(t.ctx, t.draft);
  await startSession(t.ctx);
  assert.strictEqual(ledgerKeys(t.v).length, 2);
  assert.strictEqual(queue(t.ctx).length, 0);
});

check('W6 a success is never queued, and a later Today render does not touch the ledger', async () => {
  const t = mkCtx();
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(queue(t.ctx).length, 0);
  const before = [t.calls.append, t.v._disk.get(PATH)];
  await todayRender(t.ctx); await startSession(t.ctx);
  assert.deepStrictEqual([t.calls.append, t.v._disk.get(PATH)], before);
});

check('W7 a session that was never saved queues nothing, and nothing is retried', async () => {
  const empty = mkCtx({ draft: mkDraft(0) });
  await pageLog.finishSession(empty.ctx, empty.draft);                 // nothing saveable: nothing saved
  assert.strictEqual(queue(empty.ctx).length, 0);
  const t = mkCtx();
  await startSession(t.ctx);                                           // started, then abandoned
  t.ctx.state.logDraft = null;
  await todayRender(t.ctx); await startSession(t.ctx);
  assert.deepStrictEqual([t.calls.append, queue(t.ctx).length, ledgerKeys(t.v).length], [0, 0, 0]);
});

check('W8 rewards off: nothing queued; a queued job is not retried', async () => {
  const off = mkCtx({ settings: { rewards: false }, fail: 5 });
  await pageLog.finishSession(off.ctx, off.draft);
  assert.deepStrictEqual([off.calls.read, off.calls.append, queue(off.ctx).length], [0, 0, 0]);
  const t = mkCtx({ fail: 1 });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(queue(t.ctx).length, 1);
  t.ctx.settings.rewards = false;
  const reads = t.calls.read;
  await todayRender(t.ctx); await startSession(t.ctx);
  assert.deepStrictEqual([t.calls.read, t.calls.append], [reads, 1], 'no vault call at all while rewards are off');
  assert.strictEqual(ledgerKeys(t.v).length, 0);
});

check('W9 an award that landed before the error is not paid twice by the retry', async () => {
  const t = mkCtx({ fail: 1, landThenFail: true });
  await pageLog.finishSession(t.ctx, t.draft);
  const text = t.v._disk.get(PATH);
  assert.strictEqual(ledgerKeys(t.v).length, 2, 'fixture: it did land');
  assert.strictEqual(queue(t.ctx).length, 1, 'but the caller saw an error');
  const appendsBefore = t.calls.append;
  await todayRender(t.ctx);
  assert.strictEqual(t.v._disk.get(PATH), text, 'the ledger is byte-identical: nothing paid twice');
  assert.strictEqual(t.calls.append, appendsBefore, 'a fresh read showed every key present, so there was nothing to append');
  assert.strictEqual(queue(t.ctx).length, 0, 'and the job is done');
  assert.ok(!t.notices.some(m => /Rewards saved/.test(m)), 'no "+XP" claimed for XP that was already there');
});

check('W10 two Today renders in one go make one attempt', async () => {
  const t = mkCtx({ fail: 1, slow: 20 });
  await pageLog.finishSession(t.ctx, t.draft);
  const before = t.calls.append;
  ui.mountToday(t.ctx, Object.assign({ day: DAY }, slots()));
  ui.mountToday(t.ctx, Object.assign({ day: DAY }, slots()));
  await sleep(120);
  assert.strictEqual(t.calls.append - before, 1);
  assert.strictEqual(ledgerKeys(t.v).length, 2, 'paid once, not twice');
});

check('W11 an award that finishes LATE and fails is queued too', () => withWait(30, 1000, async () => {
  const t = mkCtx({ fail: 1, slow: 120 });
  await pageLog.finishSession(t.ctx, t.draft);                        // gave up waiting after 30 ms
  assert.strictEqual(queue(t.ctx).length, 0, 'not failed yet when the finish moved on');
  await sleep(250);
  assert.strictEqual(queue(t.ctx).length, 1, 'queued when it did fail');
  await todayRender(t.ctx); await sleep(250);                         // the retry's own append takes 120 ms
  assert.strictEqual(ledgerKeys(t.v).length, 2);
}));

check('W12 a read that throws before any award is worked out is queued, and paid from the snapshot', async () => {
  const rec = [{ key: 'Pull-ups/reps', exercise: 'Pull-ups', kind: 'reps', val: '12', prev: 9 }];
  const t = mkCtx({ readFail: 1 });
  t.ctx.state.session = { records: rec, workoutsAtStart: [] };
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(ledgerKeys(t.v).length, 0);
  assert.strictEqual(queue(t.ctx).length, 1);
  t.ctx.state.session = null;                                          // the live session is long gone by the retry
  await todayRender(t.ctx);
  assert.deepStrictEqual([...L.parseLedger(t.v._disk.get(PATH)).entries].map(e => e.kind), ['session', 'sets', 'pb'], 'the PB the session found is in the snapshot');
});

check('W13 one job per workout; an empty list costs a session start nothing', async () => {
  const t = mkCtx();
  const calls0 = [t.calls.read, t.calls.append];
  await startSession(t.ctx);
  assert.deepStrictEqual([t.calls.read, t.calls.append], calls0);
  const s = mkCtx({ fail: 2 });
  const d2 = mkDraft();
  await flow.awardFinished(s.ctx, s.draft, [{ exercise: 'x', set: 1, reps: '1' }], 'Gym/Workouts/a.md');
  await flow.awardFinished(s.ctx, d2, [{ exercise: 'x', set: 1, reps: '1' }], 'Gym/Workouts/a.md');
  assert.strictEqual(queue(s.ctx).length, 1, 'the same workout twice is one job');
});

const PRIOR = L.appendToText(null, [{ date: '2026-10-01', kind: 'session', key: 'session:old', xp: 100, note: '' }]).text;

check('W14 the ledger read fine, then turned unreadable before the write: refused, queued, paid later', async () => {
  const hooks = [v => v.undownload(PATH)];
  const t = mkCtx({ files: [[PATH, PRIOR]], afterRead: hooks });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(t.v._disk.get(PATH), PRIOR, 'not written over');
  assert.strictEqual(t.calls.append, 1, 'the append was asked, and refused');
  assert.strictEqual(t.calls.results.length, 1);
  assert.strictEqual(t.calls.results[0].unreadable, true);
  assert.strictEqual(queue(t.ctx).length, 1, 'a refusal is a failure: queued');
  assert.deepStrictEqual(t.notices, ['Session logged. Strong work.']);
  /* the Today retry is refused the same way: the job stays, with its session-start try to come */
  t.v.download(PATH);
  hooks.push(v => v.undownload(PATH));
  t.notices.length = 0;
  await todayRender(t.ctx);
  assert.strictEqual(t.v._disk.get(PATH), PRIOR);
  assert.strictEqual(queue(t.ctx).length, 1, 'a refused retry is not a success');
  assert.deepStrictEqual(t.notices, [], 'and says nothing about XP');
  t.v.download(PATH);
  await startSession(t.ctx);
  assert.strictEqual(ledgerKeys(t.v).length, 3);
  assert.strictEqual(queue(t.ctx).length, 0);
});

check('W15 an unindexed ledger the adapter then cannot read: unavailable, queued, paid later', async () => {
  const t = mkCtx({ vault: { unindexed: [[PATH, PRIOR]] }, afterRead: [v => v.undownload(PATH)] });
  await pageLog.finishSession(t.ctx, t.draft);
  assert.strictEqual(t.v._disk.get(PATH), PRIOR);
  assert.strictEqual(t.calls.results[0].unavailable, true, JSON.stringify(t.calls.results));
  assert.strictEqual(queue(t.ctx).length, 1);
  t.v.download(PATH);
  await todayRender(t.ctx);
  assert.strictEqual(ledgerKeys(t.v).length, 3);
  assert.ok(t.v._disk.get(PATH).startsWith(PRIOR));
});

check('W16 a session start while the Today retry is still in flight does not append again', async () => {
  const t = mkCtx({ fail: 1 });
  await pageLog.finishSession(t.ctx, t.draft);
  const slowAppend = t.ctx.io.appendRewards;
  const before = t.calls.append;
  t.ctx.io.appendRewards = async e => { await sleep(80); return slowAppend(e); };
  ui.mountToday(t.ctx, Object.assign({ day: DAY }, slots()));         // retry 1 starts and is slow
  await sleep(10);
  pageLog.startDraft(t.ctx, { name: 'P' }, { name: 'Push', items: [] });  // the other phase arrives mid-flight
  await sleep(250);
  assert.strictEqual(t.calls.append - before, 1, 'one append for one job');
  assert.strictEqual(ledgerKeys(t.v).length, 2);
});

run('rewards retry');
process.on('exit', () => { console.error = realErr; });
