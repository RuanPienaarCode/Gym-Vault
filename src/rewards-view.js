'use strict';
/* REWARDS VIEW-MODELS - the words and numbers the rewards UI prints, as pure
   functions of what the engine (src/rewards.js) already returns. No DOM, no
   obsidian import, no vault: src/rewards-ui.js draws these, tests/rewards-view
   .test.cjs pins them.

   ONE RULE PER NUMBER. Nothing here re-derives a figure. Levels, XP, quests,
   medals and the awards themselves are the engine's; this file only formats
   them (thousands separators, "38 to go") and picks between them (which medal is
   "Next"). The only arithmetic is presentation: a bar's width is xpInto /
   xpForNext of the engine's own levelFor, and a medal's remaining distance is its
   own next threshold minus its own value.

   CONTRACT
     groupDigits(n)                        2700 -> '2,700' (no locale: Intl differs by engine)
     xpChipFor(day, settings)              null when rewards are off or the day has no planned sets, else
                                           {xp, sets, label:'Up to +145 XP', title}.
                                           THE RULE: what a session could pay today = XP.session + XP.set x the
                                           sets the plan asks for (progress.itemSets, the same count the hero's
                                           "N sets" chip prints). Nothing speculative: no PB, no streak week, no
                                           quest - the title says they pay extra.
     levelRow(levelFor-result)             null | {level, rank, rankIndex, pct, fill, xpInto, xpForNext, toNext,
                                           nextLevel, title:'Level 14', intoText:'800 / 850 XP', toText:'50 XP to
                                           Level 15', aria}. pct is the engine's (floor, never 100); fill is the
                                           exact 0..100 width of the bar.
     questCard(quest)                      null | {state:'open'|'done'|'paid', title, unit, doneText:'62 / 100',
                                           toGoText:'38 to go'|'Done', xpText:'+120 XP'|'', pct, aria}.
                                           'paid' = the ledger holds the quest's key. 'done' = target reached but never
                                           paid (rewards were off, or it was met before XP existed): it claims no XP.
     medalsSection(medals)                 {total, earned, countText:'4 of 9', tiles:[...], next}
       tile = {key, name, tier, tierLabel, state:'earned'|'locked', icon, pct, pctText, complete, earnedText,
               detail, aria}
       next = null | {key, name, pctText, detail:'2,800 kg to go', text:'Next: 10K Club', tile}:
               the unfinished medal nearest its next tier (highest progress.pct; a tie keeps the engine's order).
     xpCard({awards, totalBefore, medalsBefore, medalsAfter})
                                           null when nothing was awarded, else {gained, gainedText:'+240', lines,
                                           before, after, leveledUp, rankUp, levelUpText:'Level 15!'|'', baseFill, gainFill,
                                           toNextText:'300 to Level 15', medals, announce, aria}.
                                           lines = only what was earned, in the engine's order:
                                           {key, label, xp, text:'+100', detail}.
                                           medals = newMedals(before, after) enriched: {key, name, tier, tierLabel, icon,
                                           nextText:'72% to next'|'Top tier'}.
                                           baseFill/gainFill: the bar after the session. On one level the bar holds what
                                           it had (base) plus what this session added (gain); after a level-up the new
                                           level's bar starts from empty and holds only what spilled over.
     rankLadder(levelFor-result)           the five ranks [{name, from, state:'done'|'current'|'ahead'}]
     profileModel({summary, medals, sessionCount})
                                           {hero:levelRow, ladder, totalText:'220 XP', counts:{sessions, pbs, medalsText}}
                                           PBs = the Personal Best Hunter figure (personal bests broken, from history).
     recordsKicker(rows, today)            {newToday, text:'1 new today'|''}: records BEATEN today (times >= 2). */

const R = require('./rewards');
const { fmtShort } = require('./dates');
const { itemSets } = require('./plan-parse');

const { XP } = R;

const groupDigits = n => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const neg = v < 0;
  const s = String(Math.floor(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${s}` : s;
};
const round1 = x => Math.round(x * 10) / 10;
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---- Today ---- */

function xpChipFor(day, settings) {
  if (!R.rewardsEnabled(settings)) return null;
  const items = day && Array.isArray(day.items) ? day.items : [];
  const sets = items.reduce((n, it) => n + itemSets(it), 0);
  if (!(sets > 0)) return null;
  const xp = XP.session + XP.set * sets;
  return {
    xp, sets,
    label: `Up to +${groupDigits(xp)} XP`,
    title: `Up to ${groupDigits(xp)} XP today: ${XP.session} for finishing the session and ${XP.set} for each of the ${sets} planned sets. `
      + 'A personal best, a streak week and the weekly quest pay extra on top of that.',
  };
}

function levelRow(lvl) {
  if (!lvl || !Number.isFinite(lvl.level)) return null;
  const nextLevel = lvl.level + 1;
  return {
    level: lvl.level, rank: lvl.rank, rankIndex: lvl.rankIndex, pct: lvl.pct,
    fill: lvl.xpForNext > 0 ? round1((lvl.xpInto / lvl.xpForNext) * 100) : 0,
    xpInto: lvl.xpInto, xpForNext: lvl.xpForNext, toNext: lvl.toNext, nextLevel,
    title: `Level ${lvl.level}`,
    intoText: `${groupDigits(lvl.xpInto)} / ${groupDigits(lvl.xpForNext)} XP`,
    toText: `${groupDigits(lvl.toNext)} XP to Level ${nextLevel}`,
    aria: `Level ${lvl.level}, ${lvl.rank}, ${groupDigits(lvl.xpInto)} of ${groupDigits(lvl.xpForNext)} XP, ${lvl.pct} percent`,
  };
}

function questCard(q) {
  if (!q || !Number.isFinite(q.target)) return null;
  const unit = q.kind === 'sets' ? 'sets' : 'reps';
  const state = q.complete ? (q.paid ? 'paid' : 'done') : 'open';
  const doneText = `${groupDigits(q.done)} / ${groupDigits(q.target)}`;
  const toGoText = q.complete ? 'Done' : `${groupDigits(q.toGo)} to go`;
  const xpText = state === 'done' ? '' : `+${q.xp} XP`;
  return {
    state, key: q.key, title: q.title, unit, doneText, toGoText, xpText, pct: q.pct,
    aria: `Weekly quest: ${q.title}. ${doneText} ${unit}, ${q.pct} percent. ${q.complete ? 'Done.' : toGoText + '.'}${xpText ? ` ${xpText}.` : ''}`,
  };
}

/* ---- medals ---- */

const MEDAL_ICONS = {
  'first-pb': 'trophy', 'iron-week': 'dumbbell', 'week-streak': 'flame', '10k-club': 'weight', century: 'award',
  'rep-machine': 'repeat-2', 'distance-club': 'footprints', consistency: 'calendar-check', 'pb-hunter': 'target',
};
const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', locked: 'Locked' };
const iconFor = key => MEDAL_ICONS[key] || 'award';

function toGoDetail(m) {
  const p = m.progress || {};
  if (p.next === null || p.next === undefined) return '';
  const left = Math.max(0, round1(p.next - p.value));
  return `${groupDigits(left)} ${m.unit || 'to go'}${m.unit ? ' to go' : ''}`;
}

function medalTile(m) {
  const earned = m.tierIndex >= 0;
  const tier = earned ? m.tier : 'locked';
  const pct = m.progress ? m.progress.pct : 0;
  const tierLabel = TIER_LABEL[tier] || cap(tier);
  const earnedText = earned && m.earnedOn ? `earned ${fmtShort(m.earnedOn)}` : '';
  const detail = toGoDetail(m);
  return {
    key: m.key, name: m.name, tier, tierLabel, state: earned ? 'earned' : 'locked', icon: iconFor(m.key),
    pct, pctText: `${pct}%`, complete: !!m.complete, earnedText, detail,
    aria: earned
      ? `${m.name}, ${tier} medal${earnedText ? `, ${earnedText}` : ''}${m.complete ? ', top tier' : `, ${pct} percent to the next tier`}`
      : `${m.name}, locked, ${pct} percent`,
  };
}

function medalsSection(medals) {
  const list = Array.isArray(medals) ? medals.filter(Boolean) : [];
  const tiles = list.map(medalTile);
  const earned = tiles.filter(t => t.state === 'earned').length;
  let pick = null;
  list.forEach((m, i) => {
    if (m.complete) return;
    if (!pick || tiles[i].pct > pick.tile.pct) pick = { m, tile: tiles[i] };
  });
  return {
    total: tiles.length, earned, countText: `${earned} of ${tiles.length}`, tiles,
    next: pick ? { key: pick.m.key, name: pick.m.name, pctText: pick.tile.pctText, detail: pick.tile.detail, text: `Next: ${pick.m.name}`, tile: pick.tile } : null,
  };
}

/* ---- the XP card on Session complete ---- */

const LINE_ORDER = ['session', 'sets', 'pb', 'streak', 'quest'];
function lineFor(a) {
  const xp = a.xp;
  const base = { key: a.kind, xp, text: `+${groupDigits(xp)}`, detail: '' };
  switch (a.kind) {
    case 'session': return { ...base, label: 'Session complete' };
    case 'sets': {
      const n = Math.round(xp / XP.set);
      return { ...base, label: `${plural(n, 'set', 'sets')} logged`, detail: `${XP.set} × ${n}` };
    }
    case 'pb': return { ...base, label: 'New personal best', detail: String(a.note || '').replace(/^New best:\s*/, '') };
    case 'streak': return { ...base, label: 'Weekly streak', detail: '' };
    case 'quest': return { ...base, label: 'Weekly quest', detail: '' };
    default: return { ...base, label: cap(String(a.kind || 'bonus')) };
  }
}

function xpCard(o) {
  const opt = o || {};
  const awards = (Array.isArray(opt.awards) ? opt.awards : []).filter(a => a && Number.isFinite(a.xp) && a.xp > 0);
  if (!awards.length) return null;
  const gained = awards.reduce((n, a) => n + a.xp, 0);
  const start = Math.max(0, Math.floor(Number(opt.totalBefore) || 0));
  const before = R.levelFor(start);
  const after = R.levelFor(start + gained);
  const b = levelRow(before), a = levelRow(after);
  const leveledUp = after.level > before.level;
  const rankUp = after.rankIndex > before.rankIndex;
  const baseFill = leveledUp ? 0 : b.fill;
  const gainFill = round1(Math.max(0, a.fill - baseFill));
  const lines = awards.map(lineFor).sort((x, y) => {
    const i = LINE_ORDER.indexOf(x.key), j = LINE_ORDER.indexOf(y.key);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
  });
  const afterMedals = Array.isArray(opt.medalsAfter) ? opt.medalsAfter : [];
  const medals = R.newMedals(opt.medalsBefore, opt.medalsAfter).map(n => {
    const m = afterMedals.find(x => x.key === n.key) || {};
    const top = !m.progress || m.progress.next === null || m.progress.next === undefined;
    return {
      key: n.key, name: n.name, tier: n.tier, tierLabel: TIER_LABEL[n.tier] || cap(n.tier), icon: iconFor(n.key),
      nextText: top ? 'Top tier' : `${m.progress.pct}% to next`,
    };
  });
  const sentences = [];
  if (leveledUp) sentences.push(`Level up. You reached level ${after.level}${rankUp ? `, rank ${after.rank}` : ''}.`);
  for (const m of medals) sentences.push(`Medal unlocked: ${m.name}, ${m.tier}.`);
  return {
    gained, gainedText: `+${groupDigits(gained)}`, lines, before: b, after: a, leveledUp, rankUp,
    levelUpText: leveledUp ? `Level ${after.level}!` : '',
    baseFill, gainFill,
    toNextText: `${groupDigits(a.toNext)} to Level ${a.nextLevel}`,
    medals, announce: sentences.join(' '),
    aria: `${groupDigits(gained)} XP earned. ${a.aria}.`,
  };
}

/* ---- profile ---- */

function rankLadder(lvl) {
  const idx = lvl && Number.isFinite(lvl.rankIndex) ? lvl.rankIndex : 0;
  return R.RANKS.map((r, i) => ({ name: r.name, from: r.from, state: i < idx ? 'done' : i === idx ? 'current' : 'ahead' }));
}

function profileModel(o) {
  const opt = o || {};
  const summary = opt.summary || R.summarise(null, null, {});
  const medals = Array.isArray(opt.medals) ? opt.medals : [];
  const hunter = medals.find(m => m.key === 'pb-hunter');
  const sec = medalsSection(medals);
  return {
    hero: levelRow(summary.level),
    ladder: rankLadder(summary.level),
    totalText: `${groupDigits(summary.totalXp)} XP`,
    counts: { sessions: opt.sessionCount || 0, pbs: hunter ? hunter.progress.value : 0, medals: sec.earned, medalsTotal: sec.total, medalsText: sec.countText },
  };
}

/* ---- Records ---- */

function recordsKicker(rows, today) {
  const n = (Array.isArray(rows) ? rows : []).filter(r => r && r.date === today && r.times >= 2).length;
  return { newToday: n, text: n ? `${n} new today` : '' };
}

module.exports = {
  groupDigits, xpChipFor, levelRow, questCard, medalsSection, xpCard, rankLadder, profileModel, recordsKicker, iconFor,
};
