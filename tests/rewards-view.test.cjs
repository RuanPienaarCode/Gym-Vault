'use strict';
/* THE REWARDS VIEW-MODELS (src/rewards-view.js): every figure the rewards UI prints,
   as a pure function of what the engine (src/rewards.js) already returns. No DOM.

   The contract (written before the code, see the module header):
     groupDigits(n)                          2700 -> '2,700'
     xpChipFor(day, settings)                null | {xp, sets, label, title}
     levelRow(levelFor-result)               {level, rank, rankIndex, pct, fill, xpInto, xpForNext, toNext, nextLevel, intoText, toText, title, aria}
     questCard(quest)                        null | {state:'open'|'done'|'paid', doneText, toGoText, xpText, pct, ...}
     medalsSection(medals)                   {total, earned, countText, tiles[9], next}
     xpCard({awards, totalBefore, medalsBefore, medalsAfter})   null | {gained, before, after, leveledUp, lines, medals, announce, ...}
     rankLadder(level)                       5 steps, one 'current'
     profileModel({summary, medals, sessionCount})
     recordsKicker(rows, today)              {newToday, text}

   Named cases:
     V1  groupDigits
     V2  the XP chip rule: session + 5 per PLANNED set, nothing speculative; off / empty day -> null; says what it counted
     V3  levelRow is levelFor with words: mockup numbers, level 1, and the rank
     V4  questCard states: open / done (complete, unpaid: claims no XP) / paid; sets and reps units
     V5  medalsSection: nine tiles in engine order, tier + earned date text, locked ones carry a percentage, the count
     V6  "Next:" is the unfinished medal nearest its next tier (ties: engine order); none when every medal is complete
     V7  xpCard lines: only what was earned, in the engine's order, the sum equals the gained XP
     V8  xpCard bar: base + gain on one level; a level-up starts the new level's bar from 0 and says "Level n!"
     V9  xpCard medal-unlocked: only a tier GAINED; carries tier, name and "x% to next"; the announcement is one sentence per event
     V10 xpCard is null when nothing was awarded
     V11 rankLadder: five steps, the current one lit, earlier ones done, later ones ahead
     V12 profileModel and levelRow(today) print the same total (one rule per number)
     V13 recordsKicker counts records BEATEN today (a baseline is not a record) */
const assert = require('node:assert');
const V = require('../src/rewards-view');
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const F = require('./rewards-fixtures');
const { fmtShort } = require('../src/dates');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();

const TODAY = '2026-10-14';           // a Wednesday
const state = lines => L.parseLedger(['| Date | Kind | Key | XP | Note |', '| --- | --- | --- | --- | --- |', ...lines].join('\n'));
const entry = (date, kind, key, xp) => `| ${date} | ${kind} | ${key} | ${xp} | |`;

check('V1 groupDigits', () => {
  assert.strictEqual(V.groupDigits(0), '0');
  assert.strictEqual(V.groupDigits(999), '999');
  assert.strictEqual(V.groupDigits(1000), '1,000');
  assert.strictEqual(V.groupDigits(2700), '2,700');
  assert.strictEqual(V.groupDigits(1234567), '1,234,567');
  assert.strictEqual(V.groupDigits(-1500), '-1,500');
  assert.strictEqual(V.groupDigits(NaN), '0');
  assert.strictEqual(V.groupDigits(undefined), '0');
});

check('V2 the XP chip rule: session + 5 per planned set; off / empty -> null; says what it counted', () => {
  const day = F.day('Push', [['Bench Press', 4, '8-12'], ['Dips', 3, 'AMRAP'], ['Cable Fly', 2, '12']]);
  const chip = V.xpChipFor(day, {});
  assert.strictEqual(chip.sets, 9);
  assert.strictEqual(chip.xp, R.XP.session + R.XP.set * 9, 'XP.session + XP.set * planned sets');
  assert.strictEqual(chip.xp, 145);
  assert.strictEqual(chip.label, 'From +145 XP');
  assert.ok(/100/.test(chip.title) && /5/.test(chip.title) && /9/.test(chip.title), `the title names what it counted: ${chip.title}`);
  assert.ok(/personal best|streak|quest/i.test(chip.title) && /extra|more|on top/i.test(chip.title), 'and says the rest pays extra, nothing speculative included');
  /* an item with no set count is the plan's default of three, the same rule the hero's "N sets" chip uses */
  assert.strictEqual(V.xpChipFor(F.day('X', [['Push-ups', undefined, '10']]), {}).sets, 3);
  assert.strictEqual(V.xpChipFor(day, { rewards: false }), null, 'rewards off: no chip');
  assert.strictEqual(V.xpChipFor(day, { rewards: 'false' }), null);
  assert.strictEqual(V.xpChipFor(null, {}), null);
  assert.strictEqual(V.xpChipFor(F.day('Empty', []), {}), null, 'a day with no sets pays nothing');
  assert.strictEqual(V.xpChipFor(day, undefined).xp, 145, 'absent settings = rewards on');
});

check('V3 levelRow is levelFor with words', () => {
  const lvl = R.levelFor(R.xpToReach(14) + 800);                       // 800 into level 14
  const row = V.levelRow(lvl);
  assert.strictEqual(row.level, 14);
  assert.strictEqual(row.rank, 'Challenger');
  assert.strictEqual(row.rankIndex, 2);
  assert.strictEqual(row.xpForNext, 150 + 50 * 14);
  assert.strictEqual(row.xpInto, 800);
  assert.strictEqual(row.toNext, 850 - 800);
  assert.strictEqual(row.nextLevel, 15);
  assert.strictEqual(row.title, 'Level 14');
  assert.strictEqual(row.intoText, '800 / 850 XP');
  assert.strictEqual(row.toText, '50 XP to Level 15');
  assert.strictEqual(row.pct, lvl.pct, 'the percent is the engine\'s, not re-derived');
  assert.ok(Math.abs(row.fill - (800 / 850) * 100) < 0.11, 'the bar fill is the exact fraction');
  assert.strictEqual(row.aria, `Level 14, Challenger, 800 of 850 XP, ${lvl.pct} percent`);
  const first = V.levelRow(R.levelFor(0));
  assert.deepStrictEqual([first.level, first.rank, first.intoText, first.toText, first.fill], [1, 'Rookie', '0 / 200 XP', '200 XP to Level 2', 0]);
  assert.strictEqual(V.levelRow(null), null);
});

check('V4 questCard states', () => {
  const base = { key: 'quest:2026-10-12', kind: 'reps', target: 100, done: 62, toGo: 38, pct: 62, complete: false, xp: 120, title: 'Do 100 reps of Push Day', paid: false };
  const open = V.questCard(base);
  assert.deepStrictEqual([open.state, open.doneText, open.unit, open.toGoText, open.xpText, open.pct], ['open', '62 / 100', 'reps', '38 to go', '+120 XP', 62]);
  assert.strictEqual(open.title, 'Do 100 reps of Push Day');
  assert.ok(open.aria.indexOf('62') !== -1 && open.aria.indexOf('100') !== -1 && /120/.test(open.aria));
  const sets = V.questCard({ ...base, kind: 'sets', target: 12, done: 3, toGo: 9, pct: 25, title: 'Do 12 sets this week' });
  assert.deepStrictEqual([sets.unit, sets.doneText, sets.toGoText], ['sets', '3 / 12', '9 to go']);
  const paid = V.questCard({ ...base, done: 104, toGo: 0, pct: 100, complete: true, paid: true });
  assert.deepStrictEqual([paid.state, paid.toGoText, paid.xpText], ['paid', 'Done', '+120 XP']);
  assert.strictEqual(paid.pct, 100);
  const done = V.questCard({ ...base, done: 104, toGo: 0, pct: 100, complete: true, paid: false });
  assert.deepStrictEqual([done.state, done.toGoText, done.xpText], ['done', 'Done', ''], 'complete but never paid: it claims no XP');
  assert.strictEqual(V.questCard(null), null, 'no quest, no card');
});

/* a history with a first PB and some volume, built with the real engine */
const HIST = [
  F.wk('2026-10-01', F.sets('Pull-ups', 3, { reps: 8 })),
  F.wk('2026-10-03', F.sets('Pull-ups', 3, { reps: 10 })),   // beats 8: first PB
  F.wk('2026-10-08', F.sets('Bench Press', 4, { reps: 8, kg: 80 })),
];
const medalsNow = () => R.medals({ workouts: HIST, exercises: F.EXERCISES, weekStart: 'mon' });

check('V5 medalsSection: nine tiles, tier text, earned date, locked percentage, count', () => {
  const m = medalsNow();
  const sec = V.medalsSection(m);
  assert.strictEqual(sec.total, 9);
  assert.strictEqual(sec.tiles.length, 9);
  assert.deepStrictEqual(sec.tiles.map(t => t.key), m.map(x => x.key), 'engine order');
  const earned = m.filter(x => x.tierIndex >= 0).length;
  assert.ok(earned >= 1, 'the fixture earns at least First PB');
  assert.strictEqual(sec.earned, earned);
  assert.strictEqual(sec.countText, `${earned} of 9`);
  const first = sec.tiles.find(t => t.key === 'first-pb');
  assert.strictEqual(first.state, 'earned');
  assert.strictEqual(first.tier, 'bronze');
  assert.strictEqual(first.tierLabel, 'Bronze');
  assert.strictEqual(first.earnedText, `earned ${fmtShort('2026-10-03')}`);
  assert.ok(first.aria.indexOf('First PB') !== -1 && /bronze/i.test(first.aria), 'the name and tier are words, not only colour');
  const locked = sec.tiles.find(t => t.key === '10k-club');
  assert.strictEqual(locked.state, 'locked');
  assert.strictEqual(locked.tier, 'locked');
  assert.strictEqual(locked.tierLabel, 'Locked');
  assert.strictEqual(locked.pctText, `${m.find(x => x.key === '10k-club').progress.pct}%`);
  assert.strictEqual(locked.earnedText, '');
  assert.ok(sec.tiles.every(t => typeof t.icon === 'string' && t.icon), 'every tile names an icon');
  assert.strictEqual(sec.tiles.find(t => t.key === 'first-pb').icon, 'trophy');
});

check('V6 "Next:" is the unfinished medal nearest its next tier', () => {
  const mk = (key, name, pct, complete, value, nextAt, unit) => ({ key, name, desc: '', unit: unit || 'kg', tier: 'locked', tierIndex: -1, progress: { value, next: complete ? null : nextAt, pct }, earned: { bronze: null, silver: null, gold: null }, earnedOn: null, complete: !!complete, tiers: [] });
  const list = [mk('a', 'Alpha', 40, false, 4, 10), mk('b', 'Bravo', 72, false, 7200, 10000), mk('c', 'Charlie', 72, false, 36, 50), mk('d', 'Delta', 100, true, 9, null)];
  const sec = V.medalsSection(list);
  assert.strictEqual(sec.next.key, 'b', 'highest percent wins; a tie keeps the engine order; a complete medal is never next');
  assert.strictEqual(sec.next.name, 'Bravo');
  assert.strictEqual(sec.next.pctText, '72%');
  assert.strictEqual(sec.next.detail, '2,800 kg to go');
  assert.strictEqual(sec.next.text, 'Next: Bravo');
  assert.strictEqual(V.medalsSection([mk('d', 'Delta', 100, true, 9, null)]).next, null);
  assert.strictEqual(V.medalsSection([]).next, null);
  assert.strictEqual(V.medalsSection(null).total, 0);
});

const AWARDS = [
  { date: TODAY, key: 'session:k', kind: 'session', xp: 100, note: 'Session finished' },
  { date: TODAY, key: 'sets:k', kind: 'sets', xp: 70, note: '14 sets logged' },
  { date: TODAY, key: 'pb:k#Dips/reps', kind: 'pb', xp: 50, note: 'New best: Dips 14 reps' },
  { date: TODAY, key: 'week-streak:2026-10-12', kind: 'streak', xp: 20, note: '3-week streak kept' },
];

check('V7 xpCard lines: only what was earned, in order, summing to the gain', () => {
  const card = V.xpCard({ awards: AWARDS, totalBefore: 1000 });
  assert.strictEqual(card.gained, 240);
  assert.deepStrictEqual(card.lines.map(l => l.key), ['session', 'sets', 'pb', 'streak']);
  assert.deepStrictEqual(card.lines.map(l => l.label), ['Session complete', '14 sets logged', 'New personal best', 'Weekly streak']);
  assert.deepStrictEqual(card.lines.map(l => l.text), ['+100', '+70', '+50', '+20']);
  assert.strictEqual(card.lines[1].detail, '5 × 14', 'the sets line shows its rule');
  assert.strictEqual(card.lines[2].detail, 'Dips 14 reps', 'the PB line says which');
  assert.strictEqual(card.lines.reduce((n, l) => n + l.xp, 0), card.gained);
  assert.strictEqual(card.gainedText, '+240');
  assert.ok(!card.lines.some(l => l.key === 'quest'), 'no quest line unless the quest paid');
  const withQuest = V.xpCard({ awards: AWARDS.concat([{ date: TODAY, key: 'quest:2026-10-12', kind: 'quest', xp: 120, note: 'Weekly quest done: Do 12 sets this week' }]), totalBefore: 1000 });
  assert.deepStrictEqual(withQuest.lines.map(l => l.label).slice(-1), ['Weekly quest']);
  assert.strictEqual(withQuest.gained, 360);
  const single = V.xpCard({ awards: [{ date: TODAY, key: 'sets:k', kind: 'sets', xp: 5, note: '1 set logged' }], totalBefore: 0 });
  assert.strictEqual(single.lines[0].label, '1 set logged', 'singular');
  const odd = V.xpCard({ awards: [{ date: TODAY, key: 'x:1', kind: 'bonus', xp: 7, note: '' }], totalBefore: 0 });
  assert.strictEqual(odd.lines[0].label, 'Bonus', 'an unknown kind is still a line, never dropped');
  const two = V.xpCard({ awards: [AWARDS[2], { ...AWARDS[2], key: 'pb:k#Plank/seconds', note: 'New best: Plank 50s' }], totalBefore: 0 });
  assert.deepStrictEqual(two.lines.map(l => l.detail), ['Dips 14 reps', 'Plank 50s'], 'one line per personal best');
});

check('V8 xpCard bar: base + gain on one level; a level-up restarts the bar and says Level n!', () => {
  const start = R.xpToReach(14) + 800;                                  // 800 / 850 into level 14
  const same = V.xpCard({ awards: [{ date: TODAY, key: 'session:k', kind: 'session', xp: 20, note: '' }], totalBefore: start });
  assert.strictEqual(same.leveledUp, false);
  assert.strictEqual(same.levelUpText, '');
  assert.strictEqual(same.before.level, 14);
  assert.strictEqual(same.after.level, 14);
  assert.ok(Math.abs(same.baseFill - (800 / 850) * 100) < 0.11);
  assert.ok(Math.abs(same.baseFill + same.gainFill - (820 / 850) * 100) < 0.11, 'base + gain = where the bar ends');
  assert.strictEqual(same.toNextText, '30 to Level 15');
  const up = V.xpCard({ awards: [{ date: TODAY, key: 'session:k', kind: 'session', xp: 100, note: '' }], totalBefore: start });
  assert.strictEqual(up.leveledUp, true);
  assert.strictEqual(up.after.level, 15);
  assert.strictEqual(up.levelUpText, 'Level 15!');
  assert.strictEqual(up.baseFill, 0, 'a new level starts its bar from empty');
  assert.ok(Math.abs(up.gainFill - (50 / 900) * 100) < 0.11, `the new level's bar holds only what spilled over (${up.gainFill})`);
  assert.strictEqual(up.toNextText, '850 to Level 16');
  assert.strictEqual(up.rankUp, false);
  /* a rank change is said once, with the level */
  const rk = V.xpCard({ awards: [{ date: TODAY, key: 'session:k', kind: 'session', xp: 100, note: '' }], totalBefore: R.xpToReach(5) - 40 });
  assert.strictEqual(rk.after.rank, 'Contender');
  assert.strictEqual(rk.rankUp, true);
  assert.strictEqual(rk.levelUpText, 'Level 5!');
  assert.ok(rk.announce.indexOf('Contender') !== -1);
  assert.strictEqual(same.aria.indexOf('Level 14') !== -1, true);
});

check('V9 xpCard medals: only a tier GAINED, with tier, name and % to next; one announcement sentence per event', () => {
  const before = R.medals({ workouts: HIST.slice(0, 2), exercises: F.EXERCISES, weekStart: 'mon' });
  const later = HIST.concat([F.wk('2026-10-09', F.sets('Bench Press', 3, { reps: 8, kg: 90 }))]);
  const none = V.xpCard({ awards: AWARDS, totalBefore: 0, medalsBefore: before, medalsAfter: before });
  assert.deepStrictEqual(none.medals, [], 'nothing gained, no unlock card');
  const gained = V.xpCard({ awards: AWARDS, totalBefore: 0, medalsBefore: [], medalsAfter: medalsNow() });
  const keys = R.newMedals([], medalsNow()).map(m => m.key);
  assert.deepStrictEqual(gained.medals.map(m => m.key), keys);
  const m = gained.medals.find(x => x.key === 'first-pb');
  assert.strictEqual(m.tier, 'bronze');
  assert.strictEqual(m.tierLabel, 'Bronze');
  assert.strictEqual(m.name, 'First PB');
  assert.strictEqual(m.nextText, 'Top tier', 'First PB has one tier, so reaching it leaves nowhere to go');
  /* a medal with tiers left says how far it is from the next one */
  const mid = { key: 'iron-week', name: 'Iron Week', desc: '', unit: 'sessions', tier: 'bronze', tierIndex: 0, progress: { value: 3, next: 4, pct: 75 }, earned: {}, earnedOn: null, complete: false, tiers: [] };
  const midCard = V.xpCard({ awards: AWARDS, totalBefore: 0, medalsBefore: [{ ...mid, tier: 'locked', tierIndex: -1 }], medalsAfter: [mid] });
  assert.strictEqual(midCard.medals[0].nextText, '75% to next');
  assert.ok(midCard.announce.indexOf('Medal unlocked: Iron Week, bronze.') !== -1);
  assert.ok(gained.announce.indexOf('Medal unlocked: First PB, bronze.') !== -1, gained.announce);
  /* a medal already at the top has nowhere to go */
  const top = { key: 'x', name: 'X', desc: '', unit: 'u', tier: 'gold', tierIndex: 2, progress: { value: 9, next: null, pct: 100 }, earned: {}, earnedOn: null, complete: true, tiers: [] };
  const topCard = V.xpCard({ awards: AWARDS, totalBefore: 0, medalsBefore: [{ ...top, tier: 'silver', tierIndex: 1 }], medalsAfter: [top] });
  assert.strictEqual(topCard.medals[0].nextText, 'Top tier');
  assert.ok(later.length > 0);
});

check('V10 xpCard is null when nothing was awarded', () => {
  assert.strictEqual(V.xpCard({ awards: [], totalBefore: 500 }), null);
  assert.strictEqual(V.xpCard({ awards: null, totalBefore: 500 }), null);
  assert.strictEqual(V.xpCard({ awards: [{ key: 'a', kind: 'session', xp: 0 }], totalBefore: 0 }), null);
  assert.strictEqual(V.xpCard(undefined), null);
});

check('V11 rankLadder: five steps, current lit', () => {
  for (const [lvl, idx] of [[1, 0], [4, 0], [5, 1], [9, 1], [10, 2], [14, 2], [20, 3], [29, 3], [30, 4], [80, 4]]) {
    const l = V.rankLadder(R.levelFor(R.xpToReach(lvl)));
    assert.deepStrictEqual(l.map(s => s.name), ['Rookie', 'Contender', 'Challenger', 'Elite', 'Apex']);
    assert.strictEqual(l.length, 5);
    assert.deepStrictEqual(l.map(s => s.state), ['done', 'done', 'done', 'done', 'done'].map((_, i) => (i < idx ? 'done' : i === idx ? 'current' : 'ahead')), `level ${lvl}`);
  }
  assert.deepStrictEqual(V.rankLadder(R.levelFor(0)).map(s => s.from), [1, 5, 10, 20, 30]);
});

check('V12 the profile and the Today level row print the same total', () => {
  const ledger = state([entry('2026-10-12', 'session', 'session:a', 100), entry('2026-10-12', 'sets', 'sets:a', 70), entry('2026-10-13', 'pb', 'pb:a#x', 50)]);
  const summary = R.summarise(ledger, TODAY, { weekStart: 'mon' });
  const today = V.levelRow(summary.level);
  const prof = V.profileModel({ summary, medals: medalsNow(), sessionCount: 3 });
  assert.strictEqual(summary.totalXp, 220);
  assert.strictEqual(prof.hero.intoText, today.intoText);
  assert.strictEqual(prof.hero.toText, today.toText);
  assert.strictEqual(prof.totalText, '220 XP');
  assert.strictEqual(prof.counts.sessions, 3);
  assert.strictEqual(prof.counts.pbs, medalsNow().find(m => m.key === 'pb-hunter').progress.value, 'PBs come from the Personal Best Hunter figure');
  assert.strictEqual(prof.counts.medalsText, `${medalsNow().filter(m => m.tierIndex >= 0).length} of 9`);
  assert.strictEqual(prof.ladder.length, 5);
});

check('V13 recordsKicker counts records beaten today', () => {
  const rows = [
    { exercise: 'A', kind: 'reps', value: 14, date: TODAY, times: 3 },
    { exercise: 'B', kind: 'weight', value: 80, date: TODAY, times: 1 },    // first logged today: a baseline
    { exercise: 'C', kind: 'reps', value: 9, date: '2026-10-01', times: 4 },
    { exercise: 'D', kind: 'seconds', value: 60, date: TODAY, times: 2 },
  ];
  assert.deepStrictEqual(V.recordsKicker(rows, TODAY), { newToday: 2, text: '2 new today' });
  assert.deepStrictEqual(V.recordsKicker(rows.slice(0, 1), TODAY), { newToday: 1, text: '1 new today' });
  assert.deepStrictEqual(V.recordsKicker(rows.slice(1, 3), TODAY), { newToday: 0, text: '' });
  assert.deepStrictEqual(V.recordsKicker([], TODAY), { newToday: 0, text: '' });
  assert.deepStrictEqual(V.recordsKicker(null, TODAY), { newToday: 0, text: '' });
});

run('rewards view-models');
