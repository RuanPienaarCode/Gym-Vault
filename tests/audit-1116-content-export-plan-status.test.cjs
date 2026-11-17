'use strict';
/* AUDIT 16 NOV 2026, finding #40 (Low): the export labelled plans from raw flags
   and disagreed with the Plans page and Today.

   - the plan Today runs IMPLICITLY (no `active: true` anywhere) exported as
     "inactive";
   - a fallback plan exported as "inactive";
   - the seeded Rest & Recovery (parallel AND fallback) exported as "runs
     alongside" while Plans badges it "fills gaps";
   - the JSON had no `fallback` field.

   The export now labels a plan by the Plans page's own rule (plan-parse.planRole,
   the function page-plans.js re-exports, with activePlanOf = ctx.activePlan's
   rule). The last check pins activePlanOf and planRole against controller.js and
   the Plans page so a change to either reaches the export.

   Pure: drives export.js (no DOM, no obsidian) over synthetic plans. */
const assert = require('node:assert');
const Module = require('node:module');
const { buildSummary, buildJson } = require('../src/export');
const P = require('../src/plan-parse');

let failed = 0;
const queue = [];
const check = (name, fn) => queue.push([name, fn]);

const day = [{ weekday: 'mon', name: 'D', items: [{ exercise: 'Pull-ups', sets: 5, target: 'submax' }] }];
const mk = (name, fm) => ({ name, fm, model: { intro: [], days: day } });
const dataOf = plans => ({ profile: { fm: {}, body: '' }, body: [], exercises: [], goals: [], workouts: [], plans });
const opts = { today: '2026-11-16', days: 0 };
const tagOf = (plans, name) => {
  const m = buildSummary(dataOf(plans), opts).match(new RegExp(`^### ${name.replace(/[&]/g, '\\$&')} \\((.+)\\)$`, 'm'));
  return m ? m[1] : null;
};
const jsonOf = (plans, name) => JSON.parse(buildJson(dataOf(plans), opts)).plans.find(p => p.name === name);

/* Nothing carries `active: true`: the first main plan is the one Today runs. */
const IMPLICIT = () => [mk('Today Plan', {}), mk('Other Plan', {}), mk('Gap Filler', { fallback: true }),
  mk('Rest & Recovery', { parallel: true, fallback: true }), mk('Side Run', { parallel: true })];

check('the plan Today runs implicitly (no active flag anywhere) is "active", not "inactive"', () => {
  assert.strictEqual(tagOf(IMPLICIT(), 'Today Plan'), 'active');
  assert.strictEqual(tagOf(IMPLICIT(), 'Other Plan'), 'inactive', 'control: the other main plan is inactive');
});

check('a fallback plan is "fills gaps", not "inactive"', () => {
  assert.strictEqual(tagOf(IMPLICIT(), 'Gap Filler'), 'fills gaps');
});

check('parallel + fallback (the seeded Rest & Recovery) says "fills gaps", as the Plans badge does', () => {
  assert.strictEqual(tagOf(IMPLICIT(), 'Rest & Recovery'), 'fills gaps');
});

check('control: a parallel plan still says "runs alongside"; an explicitly active plan is "active"', () => {
  assert.strictEqual(tagOf(IMPLICIT(), 'Side Run'), 'runs alongside');
  const flagged = [mk('First', {}), mk('Chosen', { active: true })];
  assert.strictEqual(tagOf(flagged, 'Chosen'), 'active');
  assert.strictEqual(tagOf(flagged, 'First'), 'inactive');
});

check('a paused alongside plan keeps saying so, in its own kind\'s words', () => {
  const plans = [mk('Main', { active: true }), mk('Paused Run', { parallel: true, paused: true }), mk('Paused Gap', { fallback: true, paused: true })];
  assert.strictEqual(tagOf(plans, 'Paused Run'), 'runs alongside, paused');
  assert.strictEqual(tagOf(plans, 'Paused Gap'), 'fills gaps, paused');
});

check('JSON: every plan carries fallback; the active flag is the one Today uses; paused/favourite appear when true', () => {
  const plans = [...IMPLICIT()];
  plans.push(mk('Starred', { favourite: true }));
  const j = name => jsonOf(plans, name);
  assert.strictEqual(j('Gap Filler').fallback, true);
  assert.strictEqual(j('Today Plan').fallback, false);
  assert.strictEqual(j('Rest & Recovery').fallback, true);
  assert.strictEqual(j('Today Plan').active, true, 'the plan Today runs is active in the JSON too');
  assert.strictEqual(j('Other Plan').active, false);
  assert.strictEqual(j('Starred').favourite, true);
  assert.ok(!('favourite' in j('Other Plan')), 'an unstarred plan gets no new key');
  const paused = jsonOf([mk('M', { active: true }), mk('P', { parallel: true, paused: true })], 'P');
  assert.strictEqual(paused.paused, true);
});

check('a count with no target is not printed as a dangling "5×"', () => {
  const md = buildSummary(dataOf([{ name: 'P', fm: { active: true }, model: { intro: [], days: [
    { weekday: 'mon', name: 'D', items: [{ exercise: 'Pull-ups', sets: 5, target: '' }, { exercise: 'Dips', sets: 3, target: '8' }] }] } }]), opts);
  assert.ok(/Pull-ups 5 sets/.test(md), `summary: ${md.split('\n').find(l => /Pull-ups/.test(l))}`);
  assert.ok(!/5×(;|$)/m.test(md), 'no dangling "5×"');
  assert.ok(/Dips 3×8/.test(md), 'control: a normal line is unchanged');
});

check('one rule: activePlanOf agrees with controller.ctx.activePlan / isImplicitActive, and the Plans page re-exports planRole', () => {
  const stub = require('./plans-dom-stub');
  stub.makeDocument();
  global.document = stub.makeDocument();
  const orig = Module._load;
  Module._load = (req, ...rest) => (req === 'obsidian' ? stub.obsidianStub : orig(req, ...rest));
  let controller, plansPage;
  try { controller = require('../src/controller'); plansPage = require('../src/page-plans'); } finally { Module._load = orig; }
  assert.strictEqual(plansPage.planRole, P.planRole, 'page-plans must hand out plan-parse.planRole');
  const sets = [IMPLICIT(), [mk('A', {}), mk('B', { active: true })], [mk('Solo Par', { parallel: true })], [mk('G', { fallback: true }), mk('H', {})], []];
  /* ONE implementation, not two that agree: controller.js imports these from
     plan-parse.js. (This check used to hold a hand-copied model of the
     controller's rule, and went on passing while the controller's own rule
     moved on to exclude fallback plans.) */
  assert.strictEqual(controller.activePlanOf, P.activePlanOf, 'controller.js must use plan-parse.activePlanOf itself');
  assert.strictEqual(controller.mainPlansOf, P.mainPlansOf, 'controller.js must use plan-parse.mainPlansOf itself');
  const [g, h] = sets[3];
  assert.strictEqual(P.activePlanOf(sets[3]), h, 'a fallback plan that sorts first is not the plan Today runs');
  assert.strictEqual(P.planRole(h, P.activePlanOf(sets[3])), 'active', 'the main plan is the one badged active in the export');
  assert.strictEqual(P.planRole(g, P.activePlanOf(sets[3])), 'fills-gaps');
  for (const plans of sets) {
    const main = P.mainPlansOf(plans);
    const implicit = !!P.activePlanOf(plans) && !main.some(p => String(p.fm.active) === 'true');
    assert.strictEqual(controller.isImplicitActive(main), implicit, 'the implicit-active reading disagrees with controller.isImplicitActive');
  }
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
  }
  if (failed) { console.error(`audit-1116 content export plan status: ${failed} of ${queue.length} check(s) FAILED`); process.exit(1); }
  console.log('audit-1116 content export plan status OK');
})();
