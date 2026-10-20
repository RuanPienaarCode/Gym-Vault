'use strict';
/* C-06 / R2-10: a session saved at a path that was already paid still earns XP.

   Delete a logged session and log it again the same day and saveWorkout reuses the
   freed path. The award keys were `session:<path>` / `sets:<path>`, which the ledger
   already held, so the session and set XP were never paid while the Session-complete
   preview had promised them (+170 promised, +50 paid). Contract K3: existing ledger
   lines are never re-keyed; a NEW session at an already-awarded path gets a key with
   a disambiguator from the draft's startedAt, and a retry of that same session pays
   nothing twice. */
const assert = require('node:assert');
const flow = require('../src/rewards-flow');
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const realErr = console.error; console.error = () => {};
const TODAY = '2026-10-21';
const PATH = 'Gym/Workouts/2026-10-21 Push.md';
const daysOn = F.daysOnFrom({ wed: [F.day('Push', [['Push-ups', 5, '20']])] });

function mkCtx(text) {
  const box = { text: text || null };
  const ctx = {
    settings: { weekStart: 'mon' }, state: {}, daysOn,
    data: { exercises: F.EXERCISES, workouts: [] },
    io: {
      readRewards: async () => L.parseLedger(box.text),
      appendRewards: async entries => { const r = L.appendToText(box.text, entries); box.text = r.text; return { appended: r.appended }; },
    },
  };
  return { ctx, box };
}
const draft = startedAt => ({ date: TODAY, plan: 'P', day: 'Push', startedAt });
const rows = n => F.sets('Push-ups', n, { reps: 12 });
const total = xs => xs.reduce((n, a) => n + a.xp, 0);
const previewTotal = async (ctx, d, r) => {
  const sess = { records: [], workoutsAtStart: [] };
  const p = flow.preview(ctx, d, sess, r);
  await p.promise;
  return total(p.value.awards);
};

check('C06a a new session at an already-paid path is paid session + sets XP, equal to its preview', async () => {
  const { ctx, box } = mkCtx();
  const first = await flow.awardFinished(ctx, draft(1000), rows(3), PATH);
  assert.strictEqual(first.xp, 100 + 15);
  const d2 = draft(2000);
  const promised = await previewTotal(ctx, d2, rows(4));
  const again = await flow.awardFinished(ctx, d2, rows(4), PATH);
  assert.ok(again, 'awards were worked out');
  const kinds = again.awards.map(a => a.kind);
  assert.ok(kinds.includes('session') && kinds.includes('sets'), `paid kinds: ${kinds.join(',') || 'nothing'} (preview promised ${promised} XP)`);
  assert.strictEqual(again.xp, promised, `paid ${again.xp} XP, the preview promised ${promised}`);
  assert.ok(L.parseLedger(box.text).entries.length >= 4);
});

check('C06b existing ledger lines are never re-keyed: the first session keeps session:<path>', async () => {
  const { ctx, box } = mkCtx();
  await flow.awardFinished(ctx, draft(1000), rows(3), PATH);
  await flow.awardFinished(ctx, draft(2000), rows(4), PATH);
  const keys = L.parseLedger(box.text).entries.map(e => e.key);
  assert.ok(keys.includes(`session:${PATH}`) && keys.includes(`sets:${PATH}`), keys.join('\n'));
  assert.ok(keys.includes(`session:${PATH}#2000`), 'the second session is keyed by its startedAt');
});

check('C06c a retry of the disambiguated session never pays twice', async () => {
  const { ctx, box } = mkCtx();
  await flow.awardFinished(ctx, draft(1000), rows(3), PATH);
  const d2 = draft(2000);
  let fail = 1;
  const append = ctx.io.appendRewards;
  ctx.io.appendRewards = async e => { if (fail-- > 0) throw new Error('vault busy'); return append(e); };
  assert.strictEqual(await flow.awardFinished(ctx, d2, rows(4), PATH), null, 'the write failed and was queued');
  await flow.retryPending(ctx, 'today');
  const once = L.parseLedger(box.text);
  await flow.retryPending(ctx, 'start');
  const twice = L.parseLedger(box.text);
  assert.strictEqual(twice.entries.length, once.entries.length);
  assert.ok(once.keys.has(`session:${PATH}#2000`), 'the retry paid the new session');
  assert.strictEqual(once.entries.filter(e => e.kind === 'session').length, 2);
});

check('C06d awarding the disambiguated session a second time (double tap) is paid once', async () => {
  const { ctx, box } = mkCtx();
  await flow.awardFinished(ctx, draft(1000), rows(3), PATH);
  const d2 = draft(2000);
  await flow.awardFinished(ctx, d2, rows(4), PATH);
  const n = L.parseLedger(box.text).entries.length;
  d2.rewardsAwarded = false;
  await flow.awardFinished(ctx, d2, rows(4), PATH);
  assert.strictEqual(L.parseLedger(box.text).entries.length, n);
});

check('C06e a session whose first read threw is retried under the suffix when its path was already paid', async () => {
  const { ctx, box } = mkCtx();
  await flow.awardFinished(ctx, draft(1000), rows(3), PATH);
  const read = ctx.io.readRewards;
  let boom = 1;
  ctx.io.readRewards = async () => { if (boom-- > 0) throw new Error('offline'); return read(); };
  assert.strictEqual(await flow.awardFinished(ctx, draft(2000), rows(4), PATH), null);
  await flow.retryPending(ctx, 'today');
  assert.ok(L.parseLedger(box.text).keys.has(`session:${PATH}#2000`));
});

run('f1-relogged-session').then(() => { console.error = realErr; });
