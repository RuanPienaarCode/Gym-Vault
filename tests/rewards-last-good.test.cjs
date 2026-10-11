'use strict';
/* THE LEVEL ROW AND THE XP CARD DO NOT POP IN AFTER A RELOAD (iOS-safety review, 0.14.0).

   The ledger is read once per ctx.data, and every vault change replaces ctx.data, so
   every reload re-read it and drew Today's level row / quest empty for a beat before
   filling them in; Session complete's XP card did the same, a beat after "Finish &
   save" had already been drawn. The last good ledger now lives on ctx.state
   (rewardsLast), the screens paint from it AT ONCE and swap only if the fresh read
   differs.

   Named cases:
     L1  first render with a last-good ledger paints SYNCHRONOUSLY (level row and quest, before any await)
     L2  the last good ledger survives a reload (ctx.data replaced): the next render still paints at once
     L3  a changed ledger updates the drawn rows; an unchanged one leaves the very same nodes (no flicker)
     L4  a failed read keeps what was drawn; an unreadable one too; neither blanks nor overwrites the cache
     L5  with no last-good ledger the first-ever render is still empty until the read lands (and a failed one leaves it empty)
     L6  the quest and level are worked out against the CURRENT workouts, not frozen with the cache
     L7  rewards off draws nothing from the cache
     L8  Session complete: with a last-good ledger the XP card is drawn synchronously
     L9  Session complete: a changed ledger replaces the card, an unchanged one keeps it, a failed read keeps it, and it announces once
     L10 a finished session's own award updates the last-good ledger, so the next Today shows the new XP at once
     L11 a read retired by an append cannot put an older ledger back as the last good
     L12 the chip is drawn once, with the first paint */
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
/* A ctx whose ledger can be changed, broken and counted from the test. */
function mkCtx(o = {}) {
  const box = { ledger: o.ledger === undefined ? ledgerOf(o.xp == null ? 7200 : o.xp) : o.ledger, mode: 'ok', reads: 0, gate: null };
  const ctx = {
    settings: Object.assign({ weekStart: 'mon' }, o.settings || {}),
    data: { workouts: o.workouts || HIST, exercises: F.EXERCISES },
    daysOn: () => [{ plan: { name: 'P', fm: {} }, day: DAY }],
    state: { page: 'dashboard' },
    io: {
      readRewards: async () => {
        box.reads++;
        if (box.gate) await box.gate;
        if (box.mode === 'throw') throw new Error('boom');
        if (box.mode === 'unreadable') return Object.assign(L.parseLedger(''), { exists: true, unreadable: true, disabled: false });
        return box.ledger;
      },
    },
  };
  return { ctx, box };
}
const slots = () => ({ level: mkNode('div'), quest: mkNode('div'), chip: mkNode('span'), stage: mkNode('div') });


const reload = ctx => { ctx.data = Object.assign({}, ctx.data); };      // what every vault change does
const mountToday = (ctx, s) => ui.mountToday(ctx, Object.assign({ day: DAY }, s));
const levelTitle = s => text(first(s.level, 'gv-rw-level-title'));

check('L1 first render with a last-good ledger paints synchronously', async () => {
  const { ctx } = mkCtx();
  const warm = slots(); mountToday(ctx, warm); await flush();
  assert.ok(ctx.state.rewardsLast, 'a good read is kept on ctx.state');
  reload(ctx);
  const s = slots(); mountToday(ctx, s);
  /* NO await: this is the very first paint after the reload */
  assert.ok(first(s.level, 'gv-rw-level'), 'the level row is there before the read lands');
  assert.ok(first(s.quest, 'gv-rw-quest'), 'the quest is there before the read lands');
  assert.strictEqual(text(first(s.level, 'gv-rw-level-into')), V.levelRow(R.levelFor(7200)).intoText);
  assert.ok(clsOf(s.stage).includes('has-xp'), 'and the chip, so the hero does not grow a beat later');
});

check('L2 the last good ledger survives several reloads (the read is still done each time)', async () => {
  const { ctx, box } = mkCtx();
  mountToday(ctx, slots()); await flush();
  for (let i = 0; i < 3; i++) {
    reload(ctx);
    const s = slots(); mountToday(ctx, s);
    assert.ok(first(s.level, 'gv-rw-level'), `reload ${i + 1}: painted at once`);
    await flush();
  }
  assert.strictEqual(box.reads, 4, 'one read per ctx.data: the cache only paints, it never replaces the read');
});

check('L3 a changed ledger updates the rows; an unchanged one keeps the very same nodes', async () => {
  const { ctx, box } = mkCtx({ xp: 7200 });
  mountToday(ctx, slots()); await flush();
  reload(ctx);
  const s = slots(); mountToday(ctx, s);
  const node = first(s.level, 'gv-rw-level');
  const before = levelTitle(s);
  await flush();
  assert.strictEqual(first(s.level, 'gv-rw-level'), node, 'unchanged ledger: no redraw (the row is the same node)');
  assert.strictEqual(s.level.children.length, 1);
  box.ledger = ledgerOf(180);                     // another device synced: far fewer XP
  reload(ctx);
  const t = slots(); mountToday(ctx, t);
  assert.strictEqual(levelTitle(t), before, 'painted from the cache first');
  const stale = first(t.level, 'gv-rw-level');
  await flush();
  assert.strictEqual(t.level.children.length, 1, 'replaced, not added to');
  assert.notStrictEqual(first(t.level, 'gv-rw-level'), stale, 'redrawn');
  assert.strictEqual(levelTitle(t), V.levelRow(R.levelFor(180)).title);
  assert.strictEqual(t.chip.children.length, 1, 'the chip is not doubled by the redraw');
});

check('L4 a failed or unreadable read keeps what was drawn and never blanks or poisons the cache', async () => {
  for (const mode of ['throw', 'unreadable']) {
    const { ctx, box } = mkCtx({ xp: 7200 });
    mountToday(ctx, slots()); await flush();
    const good = ctx.state.rewardsLast;
    box.mode = mode;
    reload(ctx);
    const s = slots(); mountToday(ctx, s);
    const drawn = levelTitle(s);
    assert.ok(drawn, `${mode}: painted from the cache`);
    await flush();
    assert.strictEqual(levelTitle(s), drawn, `${mode}: the failed read left the row alone`);
    assert.ok(first(s.quest, 'gv-rw-quest'));
    assert.strictEqual(ctx.state.rewardsLast, good, `${mode}: the cache is untouched`);
    /* and the next render still has it to paint */
    reload(ctx);
    const t = slots(); mountToday(ctx, t);
    assert.ok(first(t.level, 'gv-rw-level'), `${mode}: still there on the next reload`);
    await flush();
  }
});

check('L5 with nothing cached, the first render is empty until the read lands; a failed first read stays empty', async () => {
  const { ctx } = mkCtx();
  const s = slots(); mountToday(ctx, s);
  assert.deepStrictEqual([s.level.children.length, s.quest.children.length, s.chip.children.length], [0, 0, 0]);
  await flush();
  assert.ok(first(s.level, 'gv-rw-level'));
  const bad = mkCtx(); bad.box.mode = 'throw';
  const t = slots(); mountToday(bad.ctx, t); await flush();
  assert.deepStrictEqual([t.level.children.length, t.quest.children.length, t.chip.children.length], [0, 0, 0]);
  assert.ok(!bad.ctx.state.rewardsLast, 'a failed read caches nothing');
});

check('L6 the cache holds the LEDGER, so the quest follows the current workouts', async () => {
  const { ctx } = mkCtx({ workouts: HIST });
  mountToday(ctx, slots()); await flush();
  const a = slots(); reload(ctx); mountToday(ctx, a);
  const doneBefore = text(first(a.quest, 'gv-rw-quest-done'));
  await flush();
  ctx.data = { workouts: HIST.concat([F.wk(TODAY, F.sets('Pull-ups', 3, { reps: 8 }), `${TODAY} Push`)]), exercises: F.EXERCISES };
  const b = slots(); mountToday(ctx, b);                                       // cached ledger, NEW workouts
  const doneNow = text(first(b.quest, 'gv-rw-quest-done'));
  assert.notStrictEqual(doneNow, doneBefore, `the quest figure moved with the workouts (${doneBefore} -> ${doneNow})`);
});

check('L7 rewards off draws nothing, even with a cache on ctx.state', async () => {
  const { ctx, box } = mkCtx({ settings: { rewards: false } });
  ctx.state.rewardsLast = ledgerOf(7200);
  const s = slots(); mountToday(ctx, s); await flush();
  assert.deepStrictEqual([s.level.children.length, s.quest.children.length, s.chip.children.length, box.reads], [0, 0, 0, 0]);
});

const rowsOf = n => Array.from({ length: n }, (_, i) => ({ exercise: 'Pull-ups', set: i + 1, reps: '8', weight_kg: '', seconds: '', note: '', distance_km: '' }));
const mkDraft = () => ({ date: '2026-10-14', startedAt: 1_700_000_000_000 });
const sessOf = (workouts = HIST) => ({ records: [], workoutsAtStart: workouts });

check('L8 Session complete: the XP card is drawn synchronously from the last good ledger', async () => {
  const { ctx } = mkCtx({ xp: 500, workouts: [] });
  const warm = ui.completeSlot(ctx);
  ui.mountComplete(ctx, warm, { draft: mkDraft(), sess: sessOf([]), rows: rowsOf(3) }); await flush();
  assert.ok(first(warm, 'gv-rw-xp'), 'fixture: the card the slow way');
  reload(ctx);
  const slot = ui.completeSlot(ctx);
  ui.mountComplete(ctx, slot, { draft: mkDraft(), sess: sessOf([]), rows: rowsOf(3) });
  assert.ok(first(slot, 'gv-rw-xp'), 'the card is on the screen when Finish & save is: no await');
  assert.strictEqual(slot.children.length, 2, 'the live region and the card');
});

check('L9 Session complete: changed replaces, unchanged keeps, failed keeps; announced once', async () => {
  const { ctx, box } = mkCtx({ xp: 500, workouts: [] });
  const warm = ui.completeSlot(ctx);
  ui.mountComplete(ctx, warm, { draft: mkDraft(), sess: sessOf([]), rows: rowsOf(3) }); await flush();
  /* unchanged */
  reload(ctx);
  let sess = sessOf([]);
  let slot = ui.completeSlot(ctx);
  ui.mountComplete(ctx, slot, { draft: mkDraft(), sess, rows: rowsOf(3) });
  const card = first(slot, 'gv-rw-xp');
  await flush();
  assert.strictEqual(first(slot, 'gv-rw-xp'), card, 'same ledger: the card is not redrawn');
  assert.strictEqual(slot.children.length, 2);
  /* failed */
  box.mode = 'throw'; reload(ctx);
  sess = sessOf([]); slot = ui.completeSlot(ctx);
  ui.mountComplete(ctx, slot, { draft: mkDraft(), sess, rows: rowsOf(3) });
  const kept = first(slot, 'gv-rw-xp');
  await flush();
  assert.strictEqual(first(slot, 'gv-rw-xp'), kept, 'a failed read leaves the card');
  /* changed: 20 XP short of level 2 -> this session levels up */
  box.mode = 'ok'; box.ledger = ledgerOf(180); reload(ctx);
  sess = sessOf([]); slot = ui.completeSlot(ctx);
  ui.mountComplete(ctx, slot, { draft: mkDraft(), sess, rows: rowsOf(3) });
  const old = first(slot, 'gv-rw-xp');
  assert.strictEqual(first(slot, 'gv-rw-levelup'), null, 'fixture: the stale card says no level-up');
  await flush();
  assert.notStrictEqual(first(slot, 'gv-rw-xp'), old, 'the fresh read replaced the card');
  assert.strictEqual(text(first(slot, 'gv-rw-levelup')), 'Level 2!');
  assert.strictEqual(findAll(slot, 'gv-rw-xp').length, 1, 'replaced, never stacked');
  assert.strictEqual(slot.children[0].attrs.role, 'status', 'the live region is still first');
  assert.strictEqual(text(slot.children[0]), 'Level up. You reached level 2.', 'the level-up the fresh card found is announced, once');
});

check('L10 a finished session\'s own award updates the last-good ledger', async () => {
  const v = makeVault([]);
  const plugin = makePlugin(v, { weekStart: 'mon' });
  const io = makeIo(plugin);
  const draft = { date: '2026-10-14', plan: 'P', day: 'Push', startedAt: Date.now() - 600000, entries: [{ exercise: 'Pull-ups', target: '', duration: false, weighted: false, distance: false, sets: Array.from({ length: 3 }, () => ({ reps: '8', weight_kg: '', seconds: '', done: true, touched: true })) }] };
  const ctx = { io, settings: plugin.settings, data: { workouts: [], exercises: F.EXERCISES }, daysOn: () => [], state: { logDraft: draft, page: 'log' }, notice() {}, nav() {}, reload() {} };
  const warm = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, warm)); await flush();
  assert.strictEqual(ctx.state.rewardsLast.entries.length, 0, 'fixture: a fresh ledger');
  await pageLog.finishSession(ctx, draft);
  const last = ctx.state.rewardsLast;
  assert.deepStrictEqual(last.entries.map(e => e.kind), ['session', 'sets'], 'the new lines are in the cached ledger');
  assert.strictEqual(R.summarise(last, '2026-10-14', { weekStart: 'mon' }).totalXp, 115);
  reload(ctx);
  const s = slots(); ui.mountToday(ctx, Object.assign({ day: DAY }, s));
  assert.strictEqual(text(first(s.level, 'gv-rw-level-into')), V.levelRow(R.levelFor(115)).intoText, 'the first paint after finishing already shows the new XP');
});

check('L11 a read retired by an append cannot put an older ledger back as the last good', async () => {
  const { ctx, box } = mkCtx({ xp: 7200 });
  let release; box.gate = new Promise(r => { release = r; });
  mountToday(ctx, slots());                         // read in flight
  const newer = ledgerOf(7300);
  ctx.state.rewardsLast = newer; flow.invalidate(ctx);   // an append landed and retired it
  release(); await flush();
  assert.strictEqual(ctx.state.rewardsLast, newer, 'the in-flight older read did not overwrite it');
});

check('L12 the chip is drawn once, with the first paint', async () => {
  const { ctx, box } = mkCtx({ xp: 7200 });
  mountToday(ctx, slots()); await flush();
  box.ledger = ledgerOf(180); reload(ctx);
  const s = slots(); mountToday(ctx, s);
  assert.strictEqual(s.chip.children.length, 1);
  await flush();
  assert.strictEqual(s.chip.children.length, 1);
});

run('rewards last good');
process.on('exit', () => { console.error = realErr; });
