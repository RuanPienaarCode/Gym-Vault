'use strict';
/* PLANS LIST: plans in use first, and a search box (0.13.0).

   Two complaints from real use: the plan running ALONGSIDE the active one
   (a parallel plan — "the 2nd active plan") was buried in a list of ~35, and
   there was no way to search for a plan by name.

   CONTRACT (written before the code):
     planRole(p, activePlan)        -> 'active' | 'alongside' | 'fills-gaps' | ''
       'active'     : p IS the plan Today runs (ctx.activePlan(), which is
                      main-and-flagged, else the first main plan)
       'alongside'  : parallel and not fallback (ctx.parallelPlans())
       'fills-gaps' : fallback (ctx.fallbackPlans())
     orderPlans(plans, activePlan)  -> new array: active, alongside, fills-gaps,
                                       then the rest — STABLE within a group
     planMatches(p, q)              -> case-insensitive substring on the plan
                                       name OR any day name; blank q matches all

   The role rules restate controller.js's isParallel/isFallback split on
   purpose and are pinned against it below, so the list cannot badge a plan
   "alongside" that Today does not actually merge in. */
const assert = require('node:assert');
const Module = require('node:module');
const { makeDocument, fire, flat, byTag, hasClass, obsidianStub } = require('./plans-dom-stub');

global.document = makeDocument();
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? obsidianStub : origLoad(req, ...rest));
const plansPage = require('../src/page-plans');
const { resolveDaysOn } = require('../src/controller');
Module._load = origLoad;

const { planRole, orderPlans, planMatches, render } = plansPage;

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

function makePlan(name, fmExtra, days) {
  return { name, file: { path: `Gym/Plans/${name}.md` }, fm: { active: false, ...fmExtra }, model: { intro: [], days: days || [] } };
}
function makeDay(name, weekday, items) {
  return { name, weekday, notes: [], items: items || [], parts: (items || []).map(item => ({ kind: 'item', item })) };
}

/* The real vault's shape: ~35 plans, the active one in the middle, two
   parallel plans and one parallel+fallback plan scattered through it. */
const A = makePlan('9 Foundations', {}, [makeDay('Foundations', 'mon')]);
const B = makePlan('Get Over The Bar', {}, [makeDay('Pull Priority', 'mon')]);
const LUNCH = makePlan('Midday Circuit', { active: true }, [makeDay('Circuit', 'mon'), makeDay('Circuit', 'wed')]);
const GTG = makePlan('Pull-up · Grease the Groove', { parallel: true }, [makeDay('Grease the Groove', 'tue')]);
const REST = makePlan('Rest & Recovery', { parallel: true, fallback: true }, [makeDay('Rest & Recovery', 'any')]);
const C = makePlan('Run · 5km', {}, [makeDay('Easy Run', 'tue')]);
const TRAIL = makePlan('Run Base · 10km', { parallel: true }, [makeDay('Swim', 'tue'), makeDay('Long Trail Run', 'sat')]);
const ALL = [A, B, LUNCH, GTG, REST, C, TRAIL];

/* ---- planRole ------------------------------------------------------------ */
eq(planRole(LUNCH, LUNCH), 'active', 'planRole: the plan Today runs is "active"');
eq(planRole(GTG, LUNCH), 'alongside', 'planRole: a parallel plan is "alongside"');
eq(planRole(TRAIL, LUNCH), 'alongside', 'planRole: a second parallel plan is also "alongside"');
eq(planRole(REST, LUNCH), 'fills-gaps', 'planRole: parallel+fallback is "fills-gaps", not "alongside" (fallback wins, as in controller.js)');
eq(planRole(A, LUNCH), '', 'planRole: an unused main plan has no role');
/* Implicit active: nothing flagged, so Today runs the first main plan —
   the list must badge THAT plan, not nothing. */
eq(planRole(A, A), 'active', 'planRole: the IMPLICIT active plan (no flag, first main) is still "active"');
eq(planRole(LUNCH, A), '', 'planRole: a flagged plan that is not the one Today runs is not "active"');

/* Pinned against the rule Today actually uses: every plan badged
   "alongside" is merged into the day by resolveDaysOn, and no other. */
{
  const parallel = ALL.filter(p => String(p.fm.parallel) === 'true' && String(p.fm.fallback) !== 'true');
  const merged = new Set(resolveDaysOn('tue', LUNCH, parallel, [REST]).map(x => x.plan.name));
  for (const p of ALL) {
    if (planRole(p, LUNCH) === 'alongside') ok(merged.has(p.name), `planRole parity: "${p.name}" badged alongside must be merged into Today`);
  }
}

/* ---- orderPlans ---------------------------------------------------------- */
eq(orderPlans(ALL, LUNCH).map(p => p.name), [
  'Midday Circuit',
  'Pull-up · Grease the Groove', 'Run Base · 10km',
  'Rest & Recovery',
  '9 Foundations', 'Get Over The Bar', 'Run · 5km',
], 'orderPlans: active first, then alongside, then fills-gaps, then the rest — each group in its original order');
eq(ALL.map(p => p.name)[0], '9 Foundations', 'orderPlans: does not mutate its input');
eq(orderPlans(ALL, null).map(p => p.name).slice(0, 3),
  ['Pull-up · Grease the Groove', 'Run Base · 10km', 'Rest & Recovery'],
  'orderPlans: with no active plan, plans in use still lead');

/* ---- planMatches --------------------------------------------------------- */
ok(planMatches(TRAIL, ''), 'planMatches: blank query matches everything');
ok(planMatches(TRAIL, '   '), 'planMatches: whitespace query matches everything');
ok(planMatches(TRAIL, 'run base'), 'planMatches: name substring, case-insensitive');
ok(planMatches(TRAIL, 'RUN BASE'), 'planMatches: upper-case query');
ok(planMatches(TRAIL, 'swim'), 'planMatches: matches a DAY name inside the plan');
ok(!planMatches(TRAIL, 'kettlebell'), 'planMatches: no match is false');
ok(planMatches(LUNCH, 'midday circuit'), 'planMatches: multi-word query');

/* ---- render: order, badges, search -------------------------------------- */
function makeCtx(plans, active) {
  return {
    data: { plans, exercises: [] },
    app: {},
    state: { params: {} },
    io: {}, nav: () => {}, rerender: () => {}, reload: () => {}, notice: () => {},
    activePlan: () => active,
    mainPlans: () => plans.filter(p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true'),
    backTo: f => f, back: () => {},
  };
}
const nameOf = card => flat(card).find(x => hasClass(x, 'gv-plan-name')).children[0].textContent;
const cardNames = root => flat(root).filter(nd => hasClass(nd, 'gv-plan-card')).map(nameOf);
const badgeOf = (root, name) => {
  const card = flat(root).filter(nd => hasClass(nd, 'gv-plan-card')).find(c => nameOf(c) === name);
  return flat(card).filter(x => hasClass(x, 'gv-badge')).map(x => x.textContent);
};

{
  const ctx = makeCtx(ALL, LUNCH);
  const root = global.document.createElement('div');
  render(ctx, root);
  eq(cardNames(root).slice(0, 4),
    ['Midday Circuit', 'Pull-up · Grease the Groove', 'Run Base · 10km', 'Rest & Recovery'],
    'render: the list opens with the plans in use, active first');
  eq(badgeOf(root, 'Midday Circuit'), ['active'], 'render: active plan carries the "active" badge');
  eq(badgeOf(root, 'Run Base · 10km'), ['alongside'], 'render: a parallel plan carries an "alongside" badge');
  eq(badgeOf(root, 'Rest & Recovery'), ['fills gaps'], 'render: a fallback plan carries a "fills gaps" badge');
  eq(badgeOf(root, 'Run · 5km'), [], 'render: an unused plan carries no badge');

  const search = byTag(root, 'input').find(i => hasClass(i, 'gv-search'));
  ok(search, 'render: the plans list has a .gv-search box');
  ok(search.attrs['aria-label'], 'render: the search box is labelled');

  search.value = 'run base';
  fire(search, 'input', { target: search });
  eq(cardNames(root), ['Run Base · 10km'], 'search: typing filters the list in place');
  ok(byTag(root, 'input').find(i => hasClass(i, 'gv-search')) === search,
    'search: the SAME input node survives (focus is not lost on each keystroke)');
  eq(ctx.state.plansListUi.q, 'run base', 'search: the query is kept in plansListUi so it survives a re-render');

  search.value = 'zzz';
  fire(search, 'input', { target: search });
  eq(cardNames(root), [], 'search: no match shows no cards');
  ok(flat(root).some(x => hasClass(x, 'gv-empty-line') && /zzz/.test(x.textContent)), 'search: no match says so, naming the query');

  search.value = '';
  fire(search, 'input', { target: search });
  eq(cardNames(root).length, ALL.length, 'search: clearing the box restores every plan');
}

/* A query survives a full re-render (ctx.rerender after a filter chip). */
{
  const ctx = makeCtx(ALL, LUNCH);
  ctx.state.plansListUi = { kit: '', focus: '', q: 'grease' };
  const root = global.document.createElement('div');
  render(ctx, root);
  eq(cardNames(root), ['Pull-up · Grease the Groove'], 'render: a saved query is applied on the next render');
  eq(byTag(root, 'input').find(i => hasClass(i, 'gv-search')).value, 'grease', 'render: the box shows the saved query');
}

console.log(`plans list order + search OK (${n} checks)`);
