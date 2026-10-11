'use strict';
/* XP, levels, ranks, the award rules and the ledger summary (src/rewards.js).
   Drives the REAL modules - stats, records, plan-parse - through
   awardsForSession; only the data is synthetic.

   Named cases:
     L1  rewardsEnabled defaults ON; only an explicit false turns it off
     L2  xpToReach equals the stated curve (150 + 50n) summed, to level 300
     L3  level boundaries: one below / exact / one above every threshold
     L4  huge and junk totals never break the curve
     L5  the rank ladder boundaries (5 steps) and rankFor
     L6  pct is a floor and never 100
     A1  each XP rule alone (session, sets, pb, streak, quest)
     A2  the mockup's session: 14 sets + 1 PB + kept streak = 100+70+50+20
     A3  idempotent by key: a key in the ledger is never paid again
     A4  nothing saved -> nothing awarded; unreadable date -> nothing
     A5  rewards off -> nothing awarded
     A6  the streak: needs 2 weeks, pays once per week, follows weekStart
     A7  records: one line per record, a repeated record key pays once
     A8  history that already holds this workout (same path) is not counted twice
     A9  quest pays in the session that completes it, once, and not for a quest already complete
     S1  summarise: empty / garbage / duplicates / negative adjustments
     S2  summarise: this week follows weekStart; lastAwards is the last session's lines */
const assert = require('node:assert');
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const stats = require('../src/stats');
const F = require('./rewards-fixtures');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();

/* ---------- settings, curve, ranks ---------- */

check('L1 rewardsEnabled defaults ON; only an explicit false turns it off', () => {
  assert.strictEqual(R.rewardsEnabled(undefined), true);
  assert.strictEqual(R.rewardsEnabled(null), true);
  assert.strictEqual(R.rewardsEnabled({}), true);
  assert.strictEqual(R.rewardsEnabled({ rewards: true }), true);
  assert.strictEqual(R.rewardsEnabled({ rewards: false }), false);
  assert.strictEqual(R.rewardsEnabled({ rewards: 'false' }), false);
  assert.strictEqual(R.rewardsEnabled({ rewards: undefined }), true);
});

check('L2 xpToReach equals the stated curve (150 + 50n) summed, to level 300', () => {
  let sum = 0;
  assert.strictEqual(R.xpToReach(1), 0);
  assert.strictEqual(R.xpToReach(0), 0);
  assert.strictEqual(R.xpToReach(-4), 0);
  for (let n = 1; n < 300; n++) {
    sum += 150 + 50 * n;
    assert.strictEqual(R.xpToReach(n + 1), sum, `level ${n + 1}`);
  }
  assert.strictEqual(R.xpToReach(2), 200, 'L1 -> L2 is 200');
  assert.strictEqual(R.xpToReach(11) - R.xpToReach(10), 650, 'L10 -> L11 is 650');
});

check('L3 level boundaries: one below / exact / one above every threshold', () => {
  assert.strictEqual(R.levelFor(0).level, 1);
  for (let lvl = 2; lvl <= 120; lvl++) {
    const t = R.xpToReach(lvl);
    assert.strictEqual(R.levelFor(t - 1).level, lvl - 1, `${t - 1} xp must still be level ${lvl - 1}`);
    const at = R.levelFor(t);
    assert.strictEqual(at.level, lvl, `${t} xp must be level ${lvl}`);
    assert.strictEqual(at.xpInto, 0);
    assert.strictEqual(R.levelFor(t + 1).level, lvl);
  }
  const l = R.levelFor(199);
  assert.deepStrictEqual({ level: l.level, xpInto: l.xpInto, xpForNext: l.xpForNext, toNext: l.toNext }, { level: 1, xpInto: 199, xpForNext: 200, toNext: 1 });
  const m = R.levelFor(450 + 100);
  assert.deepStrictEqual({ level: m.level, xpInto: m.xpInto, xpForNext: m.xpForNext, toNext: m.toNext }, { level: 3, xpInto: 100, xpForNext: 300, toNext: 200 });
});

check('L4 huge and junk totals never break the curve', () => {
  for (const xp of [1e6, 1e9, 1e12, 1e15, Number.MAX_SAFE_INTEGER]) {
    const l = R.levelFor(xp);
    assert.ok(R.xpToReach(l.level) <= xp && xp < R.xpToReach(l.level + 1), `xp ${xp} -> level ${l.level} is not its own bracket`);
    assert.ok(l.xpInto >= 0 && l.xpInto < l.xpForNext);
  }
  for (const junk of [-50, NaN, Infinity, -Infinity, 'abc', null, undefined, {}]) {
    const l = R.levelFor(junk);
    assert.strictEqual(l.level, 1, String(junk));
    assert.strictEqual(l.xp, 0);
  }
  assert.strictEqual(R.levelFor(250.9).level, 2, 'fractions floor');
  assert.strictEqual(R.levelFor('450').level, 3, 'a numeric string is a number');
});

check('L5 the rank ladder boundaries (5 steps) and rankFor', () => {
  const at = lvl => R.rankFor(lvl).name;
  assert.deepStrictEqual(R.RANKS.map(r => r.name), ['Rookie', 'Contender', 'Challenger', 'Elite', 'Apex']);
  assert.deepStrictEqual([at(0), at(1), at(4)], ['Rookie', 'Rookie', 'Rookie']);
  assert.deepStrictEqual([at(5), at(9)], ['Contender', 'Contender']);
  assert.deepStrictEqual([at(10), at(19)], ['Challenger', 'Challenger']);
  assert.deepStrictEqual([at(20), at(29)], ['Elite', 'Elite']);
  assert.deepStrictEqual([at(30), at(31), at(5000)], ['Apex', 'Apex', 'Apex']);
  assert.strictEqual(R.rankFor(30).index, 4);
  const l = R.levelFor(R.xpToReach(20));
  assert.deepStrictEqual([l.rank, l.rankIndex], ['Elite', 3]);
});

check('L6 pct is a floor and never 100', () => {
  assert.strictEqual(R.levelFor(0).pct, 0);
  assert.strictEqual(R.levelFor(199).pct, 99, '199 of 200 is 99.5% -> 99, the 100 is the next level');
  assert.strictEqual(R.levelFor(100).pct, 50);
  for (let xp = 0; xp < 5000; xp += 7) assert.ok(R.levelFor(xp).pct <= 99);
});

/* ---------- awards ---------- */

const DATE = '2026-10-12';           // a Monday
const KEY = 'Gym/Workouts/2026-10-12 Push.md';
const rowsN = n => F.sets('Bench Press', n, { reps: 8, kg: 50 });
const noDays = () => [];
const base = over => ({
  workoutKey: KEY, date: DATE, sets: rowsN(3), records: [], workouts: [], daysOn: noDays,
  exercises: F.EXERCISES, weekStart: 'mon', settings: {}, ledgerState: L.parseLedger(''), ...over,
});
const byKind = a => a.reduce((o, x) => { (o[x.kind] = o[x.kind] || []).push(x); return o; }, {});
const total = a => a.reduce((n, x) => n + x.xp, 0);
/* history giving a kept streak for a session on DATE: a session last week. */
const lastWeek = [F.wk('2026-10-06', rowsN(2))];

check('A1 each XP rule alone: session, sets, pb, streak, quest', () => {
  const plain = R.awardsForSession(base());
  assert.deepStrictEqual(plain.map(a => [a.kind, a.xp]), [['session', 100], ['sets', 15]], 'a bare session pays the session and its sets only');
  assert.strictEqual(plain[0].key, `session:${KEY}`);
  assert.strictEqual(plain[1].key, `sets:${KEY}`);
  assert.ok(plain.every(a => a.date === DATE && typeof a.note === 'string'));

  const sets1 = R.awardsForSession(base({ sets: rowsN(1) }));
  assert.strictEqual(sets1.find(a => a.kind === 'sets').xp, 5, 'one set is 5 xp');

  const pb = byKind(R.awardsForSession(base({ records: [{ key: 'Pull-ups/reps', exercise: 'Pull-ups', kind: 'reps', val: '14', prev: 12 }] })));
  assert.strictEqual(pb.pb.length, 1);
  assert.strictEqual(pb.pb[0].xp, 50);

  const st = byKind(R.awardsForSession(base({ workouts: lastWeek })));
  assert.strictEqual(st.streak.length, 1);
  assert.strictEqual(st.streak[0].xp, 20);
  assert.strictEqual(st.streak[0].key, 'week-streak:2026-10-12');

  const plan = F.daysOnFrom({ mon: [F.day('Day', [['Bench Press', 3, '8']])] });
  const q = byKind(R.awardsForSession(base({ daysOn: plan })));
  assert.strictEqual(q.quest.length, 1, '3 sets x 8 planned = 24 reps; 24 logged completes it');
  assert.strictEqual(q.quest[0].xp, 120);
  assert.strictEqual(q.quest[0].key, 'quest:2026-10-12');
});

check('A2 the mockup session: 14 sets + 1 PB + kept streak = 100+70+50+20', () => {
  const a = R.awardsForSession(base({
    sets: rowsN(14),
    records: [{ key: 'Pull-ups/reps', exercise: 'Pull-ups', kind: 'reps', val: '14', prev: 12 }],
    workouts: lastWeek,
  }));
  assert.deepStrictEqual(a.map(x => [x.kind, x.xp]), [['session', 100], ['sets', 70], ['pb', 50], ['streak', 20]]);
  assert.strictEqual(total(a), 240);
});

check('A3 idempotent by key: a key already in the ledger is never paid again', () => {
  const args = { sets: rowsN(14), records: [{ key: 'Pull-ups/reps', exercise: 'Pull-ups', kind: 'reps', val: '14', prev: 12 }], workouts: lastWeek };
  const first = R.awardsForSession(base(args));
  const text = L.appendToText(null, first).text;
  const again = R.awardsForSession(base({ ...args, ledgerState: L.parseLedger(text) }));
  assert.deepStrictEqual(again, [], 'the same session twice (double-tap, retry, other device) pays nothing');
  /* partial ledger: only the session line made it - the rest are still owed */
  const partial = L.parseLedger(L.appendToText(null, first.slice(0, 1)).text);
  assert.deepStrictEqual(R.awardsForSession(base({ ...args, ledgerState: partial })).map(x => x.kind), ['sets', 'pb', 'streak']);
  /* an entries array works as ledger state too */
  assert.deepStrictEqual(R.awardsForSession(base({ ...args, ledgerState: first })), []);
});

check('A4 nothing saved -> nothing awarded; an unreadable date -> nothing', () => {
  assert.deepStrictEqual(R.awardsForSession(base({ sets: [] })), []);
  assert.deepStrictEqual(R.awardsForSession(base({ sets: undefined })), []);
  assert.deepStrictEqual(R.awardsForSession(base({ date: 'yesterday' })), []);
  assert.deepStrictEqual(R.awardsForSession(base({ workoutKey: '' })), []);
});

check('A5 rewards off -> nothing awarded', () => {
  assert.deepStrictEqual(R.awardsForSession(base({ settings: { rewards: false }, sets: rowsN(14), workouts: lastWeek })), []);
  assert.ok(R.awardsForSession(base({ settings: { rewards: true } })).length > 0);
  assert.ok(R.awardsForSession(base({ settings: undefined })).length > 0, 'absent settings = on');
});

check('A6 the streak needs 2 weeks, pays once a week, and follows weekStart', () => {
  assert.ok(!R.awardsForSession(base({ workouts: [] })).some(a => a.kind === 'streak'), 'week 1 of a streak is not "kept"');
  assert.ok(!R.awardsForSession(base({ workouts: [F.wk('2026-09-22', rowsN(1))] })).some(a => a.kind === 'streak'), 'a gap week breaks it');
  const two = [F.wk('2026-09-29', rowsN(1)), F.wk('2026-10-06', rowsN(1))];
  assert.ok(R.awardsForSession(base({ workouts: two })).some(a => a.kind === 'streak'));
  /* second session the same week: the week key is already in the ledger */
  const first = R.awardsForSession(base({ workouts: lastWeek }));
  const ledgerState = L.parseLedger(L.appendToText(null, first).text);
  const second = R.awardsForSession(base({ workoutKey: 'Gym/Workouts/second.md', date: '2026-10-14', workouts: lastWeek.concat([F.wk('2026-10-12', rowsN(3))]), ledgerState }));
  assert.ok(!second.some(a => a.kind === 'streak'), 'one streak payment per week');
  assert.ok(second.some(a => a.kind === 'session'), 'but the second session still pays');
  /* weekStart: a Sunday session and a Monday session are one week for 'mon', two for 'sun' */
  const sun = base({ date: '2026-10-11', workoutKey: 'k', workouts: [F.wk('2026-10-05', rowsN(1))] });
  assert.ok(!R.awardsForSession({ ...sun, weekStart: 'mon' }).some(a => a.kind === 'streak'), 'Mon-start: same week');
  const asSun = R.awardsForSession({ ...sun, weekStart: 'sun' }).find(a => a.kind === 'streak');
  assert.ok(asSun, 'Sun-start: the Monday is last week');
  assert.strictEqual(asSun.key, 'week-streak:2026-10-11');
});

check('A7 one line per record; a repeated record key pays once', () => {
  const rec = (key, ex) => ({ key, exercise: ex, kind: 'reps', val: '10', prev: 8 });
  const a = R.awardsForSession(base({ records: [rec('Pull-ups/reps', 'Pull-ups'), rec('Push-ups/reps', 'Push-ups'), rec('Pull-ups/reps', 'Pull-ups')] }));
  const pbs = a.filter(x => x.kind === 'pb');
  assert.strictEqual(pbs.length, 2);
  assert.strictEqual(new Set(pbs.map(p => p.key)).size, 2);
  assert.ok(pbs.every(p => p.key.startsWith(`pb:${KEY}#`)));
  assert.ok(pbs[0].note.includes('Pull-ups'));
});

check('A8 history that already holds this workout (same path) is not counted twice', () => {
  const plan = F.daysOnFrom({ mon: [F.day('Day', [['Bench Press', 6, '8']])] });
  const saved = F.wk(DATE, rowsN(3), '2026-10-12 Push');          // path = KEY
  assert.strictEqual(saved.file.path, KEY);
  const withSaved = R.awardsForSession(base({ daysOn: plan, workouts: [saved] }));
  const without = R.awardsForSession(base({ daysOn: plan, workouts: [] }));
  assert.deepStrictEqual(withSaved, without);
  assert.ok(!withSaved.some(a => a.kind === 'quest'), '3 sets of a 6-set quest: not complete (it was 6 if the session counted twice)');
});

check('A9 the quest pays in the session that completes it, once, and not when it was already complete', () => {
  const plan = F.daysOnFrom({ mon: [F.day('Day', [['Bench Press', 4, '8']])] });
  const history = [F.wk('2026-10-12', rowsN(3), 'earlier today')];
  /* 3 done + this session's 2 = 5 >= 4: completes now */
  const s1 = R.awardsForSession(base({ daysOn: plan, workouts: history, sets: rowsN(2), workoutKey: 'k1' }));
  assert.strictEqual(s1.filter(a => a.kind === 'quest').length, 1);
  const ledgerState = L.parseLedger(L.appendToText(null, s1).text);
  /* the next session the same week: already paid (key) */
  const s2 = R.awardsForSession(base({ daysOn: plan, workouts: history.concat([F.wk('2026-10-12', rowsN(2), 'k1')]), sets: rowsN(2), workoutKey: 'k2', ledgerState }));
  assert.ok(!s2.some(a => a.kind === 'quest'));
  /* even with an empty ledger it is not THIS session's quest: the week was already over the line before it */
  const s3 = R.awardsForSession(base({ daysOn: plan, workouts: history.concat([F.wk('2026-10-12', rowsN(2), 'k1')]), sets: rowsN(2), workoutKey: 'k3' }));
  assert.ok(!s3.some(a => a.kind === 'quest'), 'already complete before this session -> not earned by it');
  /* a session that falls short pays no quest */
  const s4 = R.awardsForSession(base({ daysOn: plan, workouts: [], sets: rowsN(3), workoutKey: 'k4' }));
  assert.ok(!s4.some(a => a.kind === 'quest'));
});

/* ---------- summary ---------- */

const E = (date, kind, key, xp) => ({ date, kind, key, xp, note: '' });

check('S1 summarise: empty / garbage / duplicates / negative adjustments', () => {
  const empty = R.summarise(L.parseLedger(''), '2026-10-12', { weekStart: 'mon' });
  assert.strictEqual(empty.totalXp, 0);
  assert.strictEqual(empty.level.level, 1);
  assert.strictEqual(empty.lastAwards, null);
  assert.strictEqual(empty.sessions, 0);
  assert.strictEqual(R.summarise(null, '2026-10-12').totalXp, 0);

  const text = [
    L.formatEntry(E('2026-10-12', 'session', 'session:a', 100)),
    'garbage | line',
    '| 2026-10-12 | sets | sets:a | 70 | x |',
    L.formatEntry(E('2026-10-13', 'session', 'session:a', 100)),     // same key from the other device
    L.formatEntry(E('2026-10-13', 'pb', 'pb:a#x', 50)),
  ].join('\n');
  const s = R.summarise(L.parseLedger(text), '2026-10-13', { weekStart: 'mon' });
  assert.strictEqual(s.totalXp, 220, 'the duplicated key counts once');
  assert.strictEqual(s.sessions, 1);
  assert.strictEqual(s.pbs, 1);
  const neg = R.summarise([E('2026-10-12', 'session', 'a', 100), E('2026-10-12', 'quest', 'adj', -500)], '2026-10-12');
  assert.strictEqual(neg.totalXp, 0, 'floored at 0');
  assert.strictEqual(R.summarise(L.parseLedger(text), '2026-10-13').level.level, R.levelFor(220).level);
});

check('S2 summarise: this week follows weekStart; lastAwards is the last session\'s lines', () => {
  const entries = [
    E('2026-10-09', 'session', 'session:old', 100), E('2026-10-09', 'sets', 'sets:old', 40),
    E('2026-10-11', 'session', 'session:sun', 100), E('2026-10-11', 'sets', 'sets:sun', 50), E('2026-10-11', 'pb', 'pb:sun#a', 50),
    E('2026-10-12', 'session', 'session:mon', 100), E('2026-10-12', 'sets', 'sets:mon', 30), E('2026-10-12', 'streak', 'week-streak:2026-10-12', 20), E('2026-10-12', 'quest', 'quest:2026-10-12', 120),
  ];
  const mon = R.summarise(entries, '2026-10-12', { weekStart: 'mon' });
  assert.strictEqual(mon.thisWeek.start, '2026-10-12');
  assert.strictEqual(mon.thisWeek.xp, 270);
  assert.strictEqual(mon.thisWeek.sessions, 1);
  assert.strictEqual(mon.thisWeek.streakKept, true);
  assert.strictEqual(mon.thisWeek.questPaid, true);
  const sun = R.summarise(entries, '2026-10-12', { weekStart: 'sun' });
  assert.strictEqual(sun.thisWeek.start, '2026-10-11');
  assert.strictEqual(sun.thisWeek.xp, 100 + 50 + 50 + 270, 'Sun-start: the Sunday session is in the same week');
  assert.strictEqual(sun.thisWeek.sessions, 2);
  assert.deepStrictEqual(mon.lastAwards.items.map(i => i.kind), ['session', 'sets', 'streak', 'quest']);
  assert.strictEqual(mon.lastAwards.xp, 270);
  assert.strictEqual(mon.lastAwards.date, '2026-10-12');
  const none = R.summarise(entries, '2026-12-01', { weekStart: 'mon' });
  assert.strictEqual(none.thisWeek.xp, 0);
  assert.strictEqual(none.thisWeek.questPaid, false);
});

run('rewards-engine');
