'use strict';
/* AUDIT 25 NOV 2026 — lane L5, the Plans pages (src/page-plans.js).

   9   (JS half) "+ Plan" is a quiet button on the search row; on the In use strip
       only the MAIN plan's card has the lime Start, and "Log manually" is a text
       link under the plan name, not a second slab button.
   10  (JS half) the role dropdown on a list card prints the chosen role's one-line
       meaning under it, and it follows the select.
   34  an Add-on whose start day is an `(any)` day is "Any day" on the In use strip,
       and its Active switch says it does not appear on Today.
   36  Backup says exactly "Only shows on days your other plans have no workout".
   37  "How plans work" says a starred plan leads when two add-ons share a day.
   41  the card counts distinct real weekdays; a plan page calls `(any)` "Any day".
   44  a switched-off plan's page says "Not on Today" and keeps its Start card; a
       Backup that is ON gets an In use card whose action is "Log recovery".
   45  a plan line whose exercise has no note says so, by data.findMissingExercises'
       own rule (so "90/90 Hip Switch" with a note "90-90 Hip Switch" is NOT flagged).
   46  changing the role of the plan Today follows passes { on: true }.
   6   a failed save says so, and the page is reloaded either way.

   Drives the real page-plans.js over the shared DOM stub. */
const assert = require('node:assert');
const Module = require('node:module');
const { makeDocument, fire, flat, byTag, hasClass, obsidianStub } = require('./plans-dom-stub');
const fake = require('./gym-fake-vault');

global.document = makeDocument();
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? { ...obsidianStub, ...fake.obsidianStub } : origLoad(req, ...rest));
const P = require('../src/plan-parse');
const plansPage = require('../src/page-plans');
const { todayISO, weekdayKey } = require('../src/dates');
Module._load = origLoad;
const { check, run } = fake.makeRunner();
console.error = () => {};   // the failure paths below log on purpose

const TODAY = weekdayKey(todayISO());
const OTHER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].find(d => d !== TODAY);

const mkDay = (name, weekday, items) => ({
  name, weekday, notes: [], parts: [],
  items: (items === undefined ? ['Push-ups'] : items).map(exercise => ({ exercise, sets: 3, target: '10' })),
});
const plan = (name, fm, days) => ({
  name, file: { path: `Gym/Plans/${name}.md` }, fm: { ...fm }, model: { intro: [], days },
});
const isMain = p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true';
const flush = () => new Promise(r => setImmediate(r));
const stopEvt = () => ({ target: { closest: () => null }, stopPropagation() { this.stopped = true; } });

function makeCtx(plans, params, extra) {
  const calls = { active: [], paused: [], role: [], nav: [], notices: [], reload: 0, startLog: [], start: [], startAlt: [] };
  const ctx = {
    data: { plans, exercises: [] }, app: {}, state: { params: params || {} }, settings: {},
    io: {
      setActivePlan: async (list, target) => { calls.active.push([list.map(p => p.name), target && target.name]); },
      setPaused: async (p, on) => { calls.paused.push([p.name, on]); return true; },
      setPlanRole: async (...a) => { calls.role.push(a.length === 3 ? [a[0].name, a[1], a[2]] : [a[0].name, a[1]]); return true; },
      setFavourite: async () => true, savePlan: async () => true,
    },
    nav: (...a) => calls.nav.push(a), rerender: () => {}, reload: () => { calls.reload++; },
    notice: m => calls.notices.push(m), openFile: () => {}, backTo: f => f, back: () => {},
    startLog: (p, d) => calls.startLog.push([p.name, d.name]),
    start: (p, d) => calls.start.push([p.name, d.name]),
    startAlt: (p, d) => calls.startAlt.push([p.name, d.name]),
    activePlan: () => P.activePlanOf(plans), mainPlans: () => plans.filter(isMain),
    ...(extra || {}),
  };
  const root = global.document.createElement('div');
  plansPage.render(ctx, root);
  return { root, calls, ctx };
}
const text = n => n.textContent.replace(/\s+/g, ' ').trim();
const withClass = (root, c) => flat(root).filter(n => n.nodeType === 1 && hasClass(n, c));
const startCards = root => withClass(root, 'gv-plan-start');
const cardOf = (root, name) => withClass(root, 'gv-plan-card').find(n => new RegExp(`^Open ${name}`).test(n.attrs['aria-label']));
const selectIn = n => flat(n).find(x => x.tag === 'select');

/* A small fixture: a main plan on, an add-on on, a backup on. */
const MAIN = plan('Main', { active: true }, [mkDay('Push', TODAY)]);
const ADDON = plan('Add', { parallel: true }, [mkDay('Extra', TODAY)]);
const BACKUP = plan('Spare', { fallback: true }, [mkDay('Walk', OTHER)]);

/* ---- 9 ------------------------------------------------------------------- */
check('9: "+ Plan" is a quiet (ghost) button on the same row as the search box', () => {
  const { root } = makeCtx([MAIN, ADDON]);
  const bar = withClass(root, 'gv-toolbar')[0];
  const add = byTag(bar, 'button').find(b => /Plan$/.test(text(b)) && !/Browse/.test(text(b)));
  assert.ok(add, 'the Plan button is in the search toolbar');
  assert.ok(hasClass(add, 'gv-btn-ghost'), `class: ${add.className}`);
  assert.ok(byTag(bar, 'input').length === 1, 'and the search box shares the row');
});
check('9: only the MAIN plan\'s In use card has the lime Start; add-on and backup get a ghost Start', () => {
  const backup = plan('Spare', { fallback: true }, [mkDay('Walk', TODAY)]);
  const { root } = makeCtx([MAIN, ADDON, backup]);
  const cards = startCards(root);
  assert.strictEqual(cards.length, 3);
  const goOf = c => withClass(c, 'gv-plan-go')[0];
  const byName = n => cards.find(c => text(c).includes(n));
  assert.ok(!hasClass(goOf(byName('Push')), 'gv-btn-ghost'), 'main plan: lime Start');
  assert.ok(hasClass(goOf(byName('Extra')), 'gv-btn-ghost'), 'add-on: ghost Start');
  assert.ok(hasClass(goOf(byName('Walk')), 'gv-btn-ghost'), 'backup: ghost Start');
});
check('9: on an In use card "Log manually" is a text link under the plan name, not in the button pair', () => {
  const { root } = makeCtx([MAIN, ADDON]);
  for (const card of startCards(root)) {
    const main = withClass(card, 'gv-alsotoday-main')[0];
    const link = withClass(main, 'gv-start-alt')[0];
    assert.ok(link && hasClass(link, 'gv-start-link'), 'the alternative sits in the text block as a link');
    assert.ok(!hasClass(link, 'gv-btn'), 'and is not a slab button');
    const pair = withClass(card, 'gv-start-pair')[0];
    assert.strictEqual(byTag(pair, 'button').length, 1, 'the pair holds only Start');
  }
});
check('9: the alternative link still starts the same day (and does not open the plan)', () => {
  const { root, calls } = makeCtx([MAIN]);
  const link = withClass(startCards(root)[0], 'gv-start-alt')[0];
  const e = stopEvt(); fire(link, 'click', e);
  assert.deepStrictEqual(calls.startAlt, [['Main', 'Push']]);
  assert.ok(e.stopped);
});
check('9: the plan page keeps its single lime Start with both buttons', () => {
  const { root } = makeCtx([MAIN], { plan: 'Main' });
  const card = startCards(root)[0];
  assert.ok(!hasClass(withClass(card, 'gv-plan-go')[0], 'gv-btn-ghost'));
  assert.ok(hasClass(withClass(card, 'gv-start-pair')[0], 'gv-start-pair') && byTag(withClass(card, 'gv-start-pair')[0], 'button').length === 2);
});

/* ---- 10 ------------------------------------------------------------------ */
check('10: the role select has its meaning printed under it, and it follows the select', () => {
  const { root } = makeCtx([MAIN, ADDON, BACKUP]);
  const card = cardOf(root, 'Add');
  const desc = withClass(card, 'gv-plan-role-desc')[0];
  assert.ok(desc, 'a description line exists');
  assert.ok(/on top of your main plan/.test(text(desc)), text(desc));
  const sel = selectIn(card);
  sel.value = 'fallback';
  fire(sel, 'change', stopEvt());
  assert.ok(/Only shows on days/.test(text(desc)), `after the change: ${text(desc)}`);
});

/* ---- 34 ------------------------------------------------------------------ */
const ANYADD = plan('Anytime Add', { parallel: true }, [mkDay('Express', 'any'), mkDay('Primer', 'any')]);
const ANYMAIN = plan('Anytime Main', { active: true }, [mkDay('Express', 'any')]);
check('34: an add-on made of any-day sessions is "Add-on · Any day" on the In use strip, not Today', () => {
  const { root } = makeCtx([ANYMAIN, ANYADD]);
  const card = startCards(root).find(c => text(c).includes('Anytime Add'));
  const kicker = text(withClass(card, 'gv-kicker')[0]);
  assert.strictEqual(kicker, 'Add-on · Any day');
});
check('34: a MAIN plan\'s any-day session does fill Today, so it still says Today', () => {
  const { root } = makeCtx([ANYMAIN]);
  assert.strictEqual(text(withClass(startCards(root)[0], 'gv-kicker')[0]), 'Main plan · Today');
});
check('34: the add-on\'s Active switch says it does not appear on Today', () => {
  const { root } = makeCtx([ANYMAIN, ANYADD], { plan: 'Anytime Add' });
  assert.ok(text(root).includes('Start it from here on any day. It does not appear on Today.'), 'switch line');
  assert.ok(!/Its days are added to Today/.test(text(root)));
});
check('34: an add-on with a real weekday keeps "Its days are added to Today."', () => {
  const { root } = makeCtx([MAIN, ADDON], { plan: 'Add' });
  assert.ok(text(root).includes('Its days are added to Today.'));
});

/* ---- 36 / 37 ------------------------------------------------------------- */
check('36: Backup says exactly "Only shows on days your other plans have no workout" (list help and plan page)', () => {
  const WORDS = 'Only shows on days your other plans have no workout';
  const list = makeCtx([MAIN, BACKUP]).root;
  const help = withClass(list, 'gv-plan-help')[0];
  assert.ok(text(help).includes(WORDS), text(help));
  const page = makeCtx([MAIN, BACKUP], { plan: 'Spare' }).root;
  assert.ok(withClass(page, 'gv-plan-roleopt').some(r => text(r).includes(WORDS)));
  assert.ok(!/your main plan has no workout/.test(text(list) + text(page)));
});
check('37: "How plans work" says a starred plan leads when two add-ons share a day', () => {
  const help = withClass(makeCtx([MAIN, ADDON]).root, 'gv-plan-help')[0];
  assert.ok(text(help).includes('If two add-ons land on the same day, a starred plan leads.'), text(help));
});

/* ---- 41 ------------------------------------------------------------------ */
const metaOf = (plans, name) => {
  const { root } = makeCtx(plans);
  return text(withClass(cardOf(root, name), 'gv-plan-meta')[0]);
};
check('41: six alternative any-day sessions are "6 sessions, any day", never "6 days / week"', () => {
  const six = plan('Mobility', { active: false }, ['a', 'b', 'c', 'd', 'e', 'f'].map(n => mkDay(n, 'any')));
  const meta = metaOf([six], 'Mobility');
  assert.ok(/^6 sessions, any day · /.test(meta), meta);
  assert.ok(!/days \/ week/.test(meta));
});
check('41: real weekdays are counted distinct; a mix says "N days / week + M any-day"', () => {
  const real = plan('Real', { active: false }, [mkDay('A', 'mon'), mkDay('B', 'mon'), mkDay('C', 'wed')]);
  assert.ok(/^2 days \/ week · /.test(metaOf([real], 'Real')), metaOf([real], 'Real'));
  const mix = plan('Mix', { active: false }, [mkDay('A', 'mon'), mkDay('B', 'wed'), mkDay('C', 'any'), mkDay('D', 'any')]);
  assert.ok(/^2 days \/ week \+ 2 any-day · /.test(metaOf([mix], 'Mix')), metaOf([mix], 'Mix'));
  const one = plan('One', { active: false }, [mkDay('A', 'any')]);
  assert.ok(/^1 session, any day · /.test(metaOf([one], 'One')), metaOf([one], 'One'));
  const solo = plan('Solo', { active: false }, [mkDay('A', 'fri')]);
  assert.ok(/^1 day \/ week · /.test(metaOf([solo], 'Solo')), metaOf([solo], 'Solo'));
});
check('41: on the plan page an any day is labelled "Any day"', () => {
  const { root } = makeCtx([ANYADD], { plan: 'Anytime Add' });
  const subs = withClass(root, 'gv-day-sub').map(text);
  assert.deepStrictEqual(subs, ['Any day', 'Any day']);
});

/* ---- 44 ------------------------------------------------------------------ */
check('44: a switched-off plan\'s page says "Not on Today" and still has its Start card', () => {
  const off = plan('Off', { active: false }, [mkDay('Pull', TODAY)]);
  const { root } = makeCtx([MAIN, off], { plan: 'Off' });
  const card = startCards(root)[0];
  assert.ok(card, 'the Start card stays');
  assert.strictEqual(text(withClass(card, 'gv-kicker')[0]), 'Not on Today');
  assert.ok(!/Today ·/.test(text(withClass(card, 'gv-kicker')[0])));
});
check('44: an active plan\'s page still says "Today"', () => {
  const { root } = makeCtx([MAIN], { plan: 'Main' });
  assert.strictEqual(text(withClass(startCards(root)[0], 'gv-kicker')[0]), 'Today');
});
check('44: a Backup that is ON (all rest days) gets an In use card whose action is Log recovery', () => {
  const rest = plan('Rest & Recovery', { fallback: true }, [mkDay('Rest', 'any', [])]);
  const { root, calls } = makeCtx([MAIN, rest]);
  const card = startCards(root).find(c => text(c).includes('Rest & Recovery'));
  assert.ok(card, 'a card exists for the backup');
  const btn = byTag(card, 'button').find(b => /Log recovery/.test(text(b)));
  assert.ok(btn, 'its action is Log recovery');
  assert.ok(!byTag(card, 'button').some(b => /^Start$/.test(text(b))), 'no Start on a rest plan');
  fire(btn, 'click', stopEvt());
  assert.deepStrictEqual(calls.startLog, [['Rest & Recovery', 'Rest']]);
});
check('44: the backup\'s day for today is the one logged (a weekday rest day, not only any)', () => {
  const rest = plan('Rest B', { fallback: true }, [mkDay('Other rest', OTHER, []), mkDay('Today rest', TODAY, [])]);
  const { root, calls } = makeCtx([MAIN, rest]);
  const btn = byTag(startCards(root).find(c => text(c).includes('Rest B')), 'button').find(b => /Log recovery/.test(text(b)));
  fire(btn, 'click', stopEvt());
  assert.deepStrictEqual(calls.startLog, [['Rest B', 'Today rest']]);
});
check('44: a paused backup gets no card', () => {
  const rest = plan('Rest P', { fallback: true, paused: true }, [mkDay('Rest', 'any', [])]);
  const { root } = makeCtx([MAIN, rest]);
  assert.ok(!startCards(root).some(c => text(c).includes('Rest P')));
});

/* ---- 45 ------------------------------------------------------------------ */
check('45: a plan line with no exercise note says "No exercise note"; one with a note (even folded) does not', () => {
  const p = plan('Notes', { active: false }, [mkDay('A', 'mon', ['Push-ups', 'Ghost Move', '90/90 Hip Switch'])]);
  const { root } = makeCtx([p], { plan: 'Notes' }, {
    data: { plans: [p], exercises: [{ name: 'Push-ups', file: { path: 'x/Push-ups.md' }, fm: {} }, { name: '90-90 Hip Switch', file: { path: 'x/90.md' }, fm: {} }] },
  });
  const rows = withClass(root, 'gv-day-item');
  const flagged = rows.filter(r => /No exercise note/.test(text(r))).map(r => text(r).replace(/\s*No exercise note.*/, ''));
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(flagged.length, 1, `flagged: ${JSON.stringify(rows.map(text))}`);
  assert.ok(/^Ghost Move/.test(flagged[0]), flagged[0]);
});

/* ---- 46 ------------------------------------------------------------------ */
check('46: changing the role of the plan Today follows passes { on: true }', async () => {
  const { root, calls } = makeCtx([MAIN, ADDON]);
  const sel = selectIn(cardOf(root, 'Main'));
  sel.value = 'parallel';
  fire(sel, 'change', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.role, [['Main', 'parallel', { on: true }]]);
});
check('46: a plan Today is NOT following gets no { on } argument', async () => {
  const off = plan('Off', { active: false }, [mkDay('Pull', OTHER)]);
  const { root, calls } = makeCtx([MAIN, off]);
  const sel = selectIn(cardOf(root, 'Off'));
  sel.value = 'fallback';
  fire(sel, 'change', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.role, [['Off', 'fallback']]);
});

/* ---- 6 ------------------------------------------------------------------- */
check('6: a failed Active switch says so and still reloads', async () => {
  const off = plan('Off', { active: false }, [mkDay('Pull', OTHER)]);
  const { root, calls, ctx } = makeCtx([MAIN, off]);
  ctx.io.setActivePlan = async () => { throw new Error('disk full'); };
  const sw = flat(cardOf(root, 'Off')).find(x => x.attrs && x.attrs.role === 'switch');
  fire(sw, 'click', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.notices, ['Could not save that change. Try again.']);
  assert.strictEqual(calls.reload, 1);
});
check('6: a failed role change says so and still reloads', async () => {
  const { root, calls, ctx } = makeCtx([MAIN, ADDON]);
  ctx.io.setPlanRole = async () => { throw new Error('locked'); };
  const sel = selectIn(cardOf(root, 'Add'));
  sel.value = 'fallback';
  fire(sel, 'change', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.notices, ['Could not save that change. Try again.']);
  assert.strictEqual(calls.reload, 1);
});
check('6: a good change reloads once and says nothing', async () => {
  const { root, calls } = makeCtx([MAIN, ADDON]);
  fire(flat(cardOf(root, 'Add')).find(x => x.attrs && x.attrs.role === 'switch'), 'click', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.notices, []);
  assert.strictEqual(calls.reload, 1);
});

run('audit 1125 plans pages');
