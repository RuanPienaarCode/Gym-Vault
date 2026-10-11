'use strict';
/* THE REWARDS SCREENS, drawn by the real modules (rewards-ui over rewards-flow over the
   engine) into a stub DOM, against a real ledger parse. The look is the browser harness's
   job; this file pins what is on the screen and when it is not.

   Named cases:
     U1  Today: slots are empty on the first paint and filled when the ledger lands (level row, XP chip, quest)
     U2  Today: one ledger read per render cycle; the second render fills at once; new data re-reads
     U3  Today: rewards off draws nothing and reads nothing
     U4  Today: a failing / unreadable / absent ledger leaves the slots empty and throws nothing
     U5  Today and Profile print the same level state and the same total
     U6  Session complete: the XP card previews exactly what finishing then writes
     U7  Session complete: "Level n!" and the medal card appear only when earned
     U8  Session complete: rewards off (no slot, no read); nothing earned (no card)
     U9  accessibility: progress bars say their value; the live region exists first and speaks once; medals have names
     U10 Records: nine medals with text names; off draws none; the page mounts them (and the "N new today" kicker)
     U11 Profile: ladder with the current rank lit, counts, empty when the ledger fails
     U12 the real Today page hands its own slots to the fill (level row first, XP chip in the hero chips, quest after the week strip), and a rest day gets no chip */
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
const R = require('../src/rewards');
const L = require('../src/rewards-ledger');
const V = require('../src/rewards-view');
const flow = require('../src/rewards-flow');
const { todayISO, startOfWeek, addDays } = require('../src/dates');
const F = require('./rewards-fixtures');

const { check, run } = makeRunner();
const realErr = console.error; console.error = () => {};
const flush = () => new Promise(r => setImmediate(r));
const clsOf = n => String(n.className).split(/\s+/).filter(Boolean);
const findAll = (n, cls, out = []) => { for (const c of n.children || []) { if (c.nodeType !== 1) continue; if (clsOf(c).includes(cls)) out.push(c); findAll(c, cls, out); } return out; };
const first = (n, cls) => findAll(n, cls)[0] || null;
const text = n => (n ? n.textContent : '');

const TODAY = todayISO();
const ledgerOf = xp => {
  const lines = [];
  let left = xp, i = 0;
  while (left >= 100) { lines.push(`| ${TODAY} | session | session:seed-${i} | 100 | |`); left -= 100; i++; }
  if (left > 0) lines.push(`| ${TODAY} | sets | sets:seed | ${left} | |`);
  return Object.assign(L.parseLedger(['| Date | Kind | Key | XP | Note |', '| --- | --- | --- | --- | --- |', ...lines].join('\n')), { exists: true, disabled: false, unreadable: false });
};
const DAY = F.day('Push', [['Pull-ups', 4, 'submax'], ['Dips', 3, '8'], ['Plank', 2, '60s']]);
const HIST = [F.wk('2026-10-01', F.sets('Pull-ups', 3, { reps: 8 })), F.wk('2026-10-03', F.sets('Pull-ups', 3, { reps: 10 }))];
function mkCtx(o = {}) {
  const calls = { read: 0 };
  const ctx = {
    settings: Object.assign({ weekStart: 'mon' }, o.settings || {}),
    data: { workouts: o.workouts || HIST, exercises: F.EXERCISES },
    daysOn: () => [{ plan: { name: 'P', fm: {} }, day: DAY }],
    state: { page: 'dashboard' },
    io: o.noIo ? undefined : { readRewards: async () => { calls.read++; if (o.throws) throw new Error('boom'); return o.ledger === undefined ? ledgerOf(o.xp == null ? 7200 : o.xp) : o.ledger; } },
  };
  return { ctx, calls };
}
const slots = () => ({ level: mkNode('div'), quest: mkNode('div'), chip: mkNode('span'), stage: mkNode('div') });

check('U1 Today: empty on the first paint, filled when the ledger lands', async () => {
  const { ctx } = mkCtx();
  const s = slots();
  ui.mountToday(ctx, Object.assign({ day: DAY }, s));
  assert.deepStrictEqual([s.level.children.length, s.quest.children.length, s.chip.children.length], [0, 0, 0], 'nothing waits on the read');
  await flush();
  const lvl = first(s.level, 'gv-rw-level');
  assert.ok(lvl, 'the level row');
  const want = V.levelRow(R.levelFor(7200));
  assert.strictEqual(text(first(lvl, 'gv-rw-level-title')), want.title);
  assert.strictEqual(text(first(lvl, 'gv-rw-level-rank')), want.rank);
  assert.strictEqual(text(first(lvl, 'gv-rw-level-into')), want.intoText);
  assert.strictEqual(text(first(lvl, 'gv-rw-level-to')), want.toText);
  assert.strictEqual(text(first(lvl, 'gv-rw-hex-num')), String(want.level));
  assert.strictEqual(text(first(s.chip, 'gv-rw-xpchip')), 'Up to +145 XP', 'the XP chip rule: 100 + 5 x 9 planned sets');
  const q = first(s.quest, 'gv-rw-quest');
  assert.ok(q, 'the quest card');
  assert.strictEqual(text(first(q, 'gv-rw-quest-xp')), '+120 XP');
  assert.ok(/ to go$/.test(text(first(q, 'gv-rw-quest-togo'))));
  assert.ok(clsOf(s.stage).includes('has-xp'), 'the stage is told the chips column grew');
});

check('U2 Today: one read per render cycle; the second render fills at once; new data re-reads', async () => {
  const { ctx, calls } = mkCtx();
  const a = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, a));
  const b = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, b));
  await flush();
  assert.strictEqual(calls.read, 1, 'two mounts, one read');
  const c = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, c));
  assert.ok(first(c.level, 'gv-rw-level'), 'a render after the read has resolved fills SYNCHRONOUSLY (no flicker)');
  assert.strictEqual(calls.read, 1);
  ctx.data = Object.assign({}, ctx.data);       // a reload replaces ctx.data
  const d = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, d));
  await flush();
  assert.strictEqual(calls.read, 2, 'new data, new read');
  const e = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, e));
  flow.invalidate(ctx);
  ui.mountToday(ctx, Object.assign({ day: DAY }, slots()));
  await flush();
  assert.strictEqual(calls.read, 3, 'an append retires the cache');
});

check('U3 Today: rewards off draws nothing and reads nothing', async () => {
  const { ctx, calls } = mkCtx({ settings: { rewards: false } });
  const s = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, s));
  await flush();
  assert.deepStrictEqual([s.level.children.length, s.quest.children.length, s.chip.children.length, calls.read], [0, 0, 0, 0]);
  assert.ok(!clsOf(s.stage).includes('has-xp'));
});

check('U4 Today: a failing, unreadable or absent ledger leaves the slots empty', async () => {
  const cases = [
    mkCtx({ throws: true }), mkCtx({ noIo: true }),
    mkCtx({ ledger: Object.assign(L.parseLedger(''), { unreadable: true }) }),
    mkCtx({ ledger: null }),
  ];
  for (const { ctx } of cases) {
    const s = slots();
    assert.doesNotThrow(() => ui.mountToday(ctx, Object.assign({ day: DAY }, s)));
    await flush();
    assert.deepStrictEqual([s.level.children.length, s.quest.children.length, s.chip.children.length], [0, 0, 0]);
  }
  const { ctx } = mkCtx({ ledger: Object.assign(L.parseLedger(''), { exists: false, unreadable: false, disabled: false }) });
  const s = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, s)); await flush();
  assert.strictEqual(text(first(s.level, 'gv-rw-level-title')), 'Level 1', 'a ledger that does not exist yet is a fresh start, not a failure');
});

check('U5 Today and Profile print the same level state and the same total', async () => {
  const { ctx } = mkCtx({ xp: 7230 });
  const s = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, s));
  const root = mkNode('div'); ui.mountProfile(ctx, root);
  await flush();
  const lvl = first(s.level, 'gv-rw-level');
  const prof = first(root, 'gv-rw-profile');
  assert.ok(lvl && prof);
  const into = text(first(lvl, 'gv-rw-level-into'));
  assert.ok(text(first(prof, 'gv-rw-profile-nums')).indexOf(into.replace(' XP', '')) !== -1 || text(first(prof, 'gv-rw-profile-nums')).replace(/\s/g, '').indexOf(into.replace(/\s/g, '').replace('XP', '')) !== -1, `${into} vs ${text(first(prof, 'gv-rw-profile-nums'))}`);
  assert.strictEqual(text(first(prof, 'gv-rw-profile-total')), '7,230 XP in total');
  assert.strictEqual(text(first(prof, 'gv-rw-profile-level')), text(first(lvl, 'gv-rw-level-title')));
  assert.strictEqual(text(first(prof, 'gv-rw-hex-num')), text(first(lvl, 'gv-rw-hex-num')));
});

/* ---- Session complete ---- */
const rowsOf = n => Array.from({ length: n }, (_, i) => ({ exercise: 'Pull-ups', set: i + 1, reps: '8', weight_kg: '', seconds: '', note: '', distance_km: '' }));
const mkDraft = () => ({ date: '2026-10-14', startedAt: 1_700_000_000_000 });
const sessOf = (o = {}) => ({ records: o.records || [], workoutsAtStart: o.workouts || HIST });

check('U6 Session complete: the card previews exactly what finishing then writes', async () => {
  const v = makeVault([]);
  const plugin = makePlugin(v, { weekStart: 'mon' });
  const io = makeIo(plugin);
  const ctx = { io, settings: plugin.settings, data: { workouts: HIST, exercises: F.EXERCISES }, daysOn: () => [], state: { page: 'session' }, notice() {}, nav() {}, reload() {} };
  const draft = Object.assign(mkDraft(), { plan: 'P', day: 'Push', entries: [{ exercise: 'Pull-ups', duration: false, weighted: false, distance: false, sets: rowsOf(3).map(() => ({ reps: '8', weight_kg: '', seconds: '', done: true, touched: true })) }] });
  const sess = sessOf({ records: [{ key: 'Pull-ups/reps', exercise: 'Pull-ups', kind: 'reps', val: '12', prev: 10 }] });
  ctx.state.session = sess; ctx.state.logDraft = draft;
  const slot = ui.completeSlot(ctx);
  ui.mountComplete(ctx, slot, { draft, sess, rows: pageLog.buildRows(draft) });
  await flush();
  const card = first(slot, 'gv-rw-xp');
  assert.ok(card, 'the XP card');
  const lines = findAll(card, 'gv-rw-xp-line').map(l => [clsOf(l).find(c => /^is-/.test(c)), text(first(l, 'gv-rw-xp-amount'))]);
  assert.deepStrictEqual(lines, [['is-session', '+100'], ['is-sets', '+15'], ['is-pb', '+50']]);
  await pageLog.finishSession(ctx, draft);
  const written = L.parseLedger(v._disk.get('Gym/Rewards.md'));
  const total = written.entries.reduce((n, e) => n + e.xp, 0);
  assert.strictEqual(total, 165);
  assert.ok(text(first(card, 'gv-rw-xp-big')).indexOf('+165') === 0, `the card says ${text(first(card, 'gv-rw-xp-big'))}, the ledger holds ${total}`);
  assert.deepStrictEqual(written.entries.map(e => e.kind), lines.map(l => l[0].slice(3)), 'the same lines, in the same order');
});

check('U7 Session complete: "Level n!" and the medal card appear only when earned', async () => {
  const draft = mkDraft(), rows = rowsOf(3);
  /* far from a boundary: no level-up line, no medal card */
  const a = mkCtx({ xp: 500, workouts: [] });
  const sa = sessOf({ workouts: [] });
  const slotA = ui.completeSlot(a.ctx); ui.mountComplete(a.ctx, slotA, { draft, sess: sa, rows }); await flush();
  assert.ok(first(slotA, 'gv-rw-xp'), 'a card');
  assert.strictEqual(first(slotA, 'gv-rw-levelup'), null, 'no level-up');
  assert.strictEqual(first(slotA, 'gv-rw-unlock'), null, 'no medal');
  /* 20 XP short of level 2: this session crosses it */
  const b = mkCtx({ xp: 180 });
  const slotB = ui.completeSlot(b.ctx); ui.mountComplete(b.ctx, slotB, { draft, sess: sessOf({ workouts: [] }), rows }); await flush();
  assert.strictEqual(text(first(slotB, 'gv-rw-levelup')), 'Level 2!');
  /* a first personal best earns the First PB medal: the history before has 1 workout, the session beats it */
  const before = [F.wk('2026-10-01', F.sets('Pull-ups', 3, { reps: 4 }))];
  const c = mkCtx({ xp: 500, workouts: before });
  const slotC = ui.completeSlot(c.ctx);
  ui.mountComplete(c.ctx, slotC, { draft, sess: { records: [], workoutsAtStart: before }, rows });
  await flush();
  const unlock = first(slotC, 'gv-rw-unlock');
  assert.ok(unlock, 'First PB unlocks: the session\'s 8 reps beat the earlier 4');
  assert.ok(/First PB/.test(text(unlock)) && /Bronze/.test(text(unlock)));
  assert.ok(/Top tier|% to next/.test(text(first(unlock, 'gv-rw-unlock-next'))));
});

check('U8 Session complete: rewards off draws no slot and reads nothing; nothing earned draws no card', async () => {
  const off = mkCtx({ settings: { rewards: false } });
  assert.strictEqual(ui.completeSlot(off.ctx), null);
  ui.mountComplete(off.ctx, null, { draft: mkDraft(), sess: sessOf(), rows: rowsOf(3) });
  await flush();
  assert.strictEqual(off.calls.read, 0);
  const none = mkCtx();
  const slot = ui.completeSlot(none.ctx);
  ui.mountComplete(none.ctx, slot, { draft: mkDraft(), sess: sessOf(), rows: [] });
  await flush();
  assert.strictEqual(slot.children.length, 1, 'only the live region: no saved sets, nothing earned, no card');
});

check('U9 accessibility: bars say their value; the live region exists first and speaks once; medals have names', async () => {
  const { ctx } = mkCtx({ xp: 180 });
  const s = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, s));
  const bars = [];
  await flush();
  bars.push(...findAll(s.level, 'gv-rw-bar'), ...findAll(s.quest, 'gv-rw-bar'));
  assert.ok(bars.length === 2);
  for (const b of bars) {
    assert.strictEqual(b.attrs.role, 'progressbar');
    assert.ok(b.attrs['aria-valuenow'] !== undefined && b.attrs['aria-valuemin'] === '0' && b.attrs['aria-valuemax'] === '100');
    assert.ok(b.attrs['aria-valuetext'] || b.attrs['aria-label'], 'a value in words');
  }
  const draft = mkDraft(), rows = rowsOf(3), sess = sessOf({ workouts: [] });
  const slot = ui.completeSlot(ctx);
  const live = slot.firstChild;
  assert.deepStrictEqual([live.attrs.role, live.attrs['aria-live'], text(live)], ['status', 'polite', ''], 'the polite region exists BEFORE it has text');
  ui.mountComplete(ctx, slot, { draft, sess, rows }); await flush();
  assert.strictEqual(text(live), 'Level up. You reached level 2.');
  const slot2 = ui.completeSlot(ctx);
  ui.mountComplete(ctx, slot2, { draft, sess, rows }); await flush();
  assert.strictEqual(text(slot2.firstChild), '', 'a re-render of the same screen does not announce again');
  assert.ok(first(slot2, 'gv-rw-levelup'), 'but the line is still drawn');
});

check('U10 Records: nine medals with text names; off draws none; the page mounts them', async () => {
  const { ctx } = mkCtx();
  const root = mkNode('div');
  const node = ui.mountRecords(ctx, root);
  assert.ok(node && root.children.includes(node));
  const tiles = findAll(node, 'gv-rw-medal');
  assert.strictEqual(tiles.length, 9);
  for (const t of tiles) assert.ok(t.attrs['aria-label'] && text(first(t, 'gv-rw-medal-name')), 'a name in words, not only a colour');
  const bars = findAll(node, 'gv-rw-bar');
  assert.ok(bars.every(b => b.attrs.role === 'progressbar'));
  assert.strictEqual(text(first(node, 'gv-rw-sec-count')), `${V.medalsSection(flow.medalsFor(ctx)).earned} of 9`);
  const off = mkCtx({ settings: { rewards: false } });
  assert.strictEqual(ui.mountRecords(off.ctx, mkNode('div')), null);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-records.js'), 'utf8');
  assert.strictEqual((src.match(/rewardsUi\.mountRecords\(ctx, root\)/g) || []).length, 2, 'mounted after the list AND when there are no records yet');
  assert.ok(/recordsKicker\(rows, todayISO\(\)\)/.test(src), 'the kicker reads the one rule');
});

check('U11 Profile: ladder with the current rank lit, counts, empty when the ledger fails', async () => {
  const { ctx } = mkCtx({ xp: R.xpToReach(10) + 5 });
  const root = mkNode('div'); ui.mountProfile(ctx, root); await flush();
  const prof = first(root, 'gv-rw-profile');
  const rungs = findAll(prof, 'gv-rw-rung');
  assert.deepStrictEqual(rungs.map(r => text(r)), ['Rookie', 'Contender', 'Challenger', 'Elite', 'Apex']);
  assert.deepStrictEqual(rungs.map(r => clsOf(r).find(c => /^is-/.test(c))), ['is-done', 'is-done', 'is-current', 'is-ahead', 'is-ahead']);
  assert.strictEqual(rungs[2].attrs['aria-current'], 'step');
  const stats = first(prof, 'gv-rw-stats');
  assert.deepStrictEqual(stats.children.map(c => text(c.children[1])), ['sessions', 'PBs', 'medals']);
  assert.strictEqual(text(stats.children[0].children[0]), String(HIST.length), 'sessions = the History count');
  assert.ok(/^\d+ of 9$/.test(text(stats.children[2].children[0]).replace(/\s+/g, ' ').trim()), text(stats.children[2].children[0]));
  const bad = mkCtx({ throws: true });
  const r2 = mkNode('div'); const slot = ui.mountProfile(bad.ctx, r2); await flush();
  assert.strictEqual(slot.children.length, 0, 'a failed read leaves the slot empty');
  const off = mkCtx({ settings: { rewards: false } });
  assert.strictEqual(ui.mountProfile(off.ctx, mkNode('div')), null);
  assert.strictEqual(off.calls.read, 0);
});

const dashboard = loadSrc('page-dashboard.js');
check('U12 the real Today page fills its own slots; a rest day has no chip', async () => {
  const mk = (d, o = {}) => {
    const pl = { name: 'P', fm: { active: 'true' }, model: { days: [d], intro: [] } };
    const base = mkCtx(o).ctx;
    return Object.assign(base, {
      app: {}, data: { workouts: HIST, exercises: F.EXERCISES, goals: [], body: [] }, state: { logDraft: null, page: 'dashboard' },
      nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
      activePlan: () => pl, activePlanIsImplicit: () => false, mainPlans: () => [pl], parallelPlans: () => [], fallbackPlans: () => [],
      daysOn: () => [{ plan: pl, day: d }],
    });
  };
  const ctx = mk(DAY);
  const root = mkNode('div'); dashboard.render(ctx, root);
  const page = first(root, 'gv-today');
  assert.ok(clsOf(page.children[0]).includes('gv-slot-level'), 'the level slot is the first child');
  assert.strictEqual(page.children[0].children.length, 0, 'empty on the first paint');
  await flush();
  assert.ok(first(page.children[0], 'gv-rw-level'), 'filled when the ledger lands');
  assert.strictEqual(text(first(first(root, 'gv-hero-chips'), 'gv-rw-xpchip')), 'Up to +145 XP', 'the chip sits in the hero chips');
  const quest = first(root, 'gv-slot-quest');
  assert.ok(first(quest, 'gv-rw-quest'));
  const order = page.children.map(c => clsOf(c).find(x => /^gv-(week|slot-quest)$/.test(x)) || '').filter(Boolean);
  assert.deepStrictEqual(order, ['gv-week', 'gv-slot-quest'], 'the quest follows the week strip');
  const rest = mk({ name: 'Rest & recovery', weekday: 'mon', items: [], notes: [] });
  const r2 = mkNode('div'); dashboard.render(rest, r2); await flush();
  assert.ok(first(r2, 'gv-rw-level'), 'a rest day still shows the level row');
  assert.strictEqual(first(r2, 'gv-rw-xpchip'), null, 'but no chip: nothing is planned to pay');
  const off = mk(DAY, { settings: { rewards: false } });
  const r3 = mkNode('div'); dashboard.render(off, r3); await flush();
  assert.strictEqual(findAll(r3, 'gv-rw-level').length + findAll(r3, 'gv-rw-quest').length + findAll(r3, 'gv-rw-xpchip').length, 0, 'rewards off: nothing');
});

run('rewards ui');
process.on('exit', () => { console.error = realErr; });
