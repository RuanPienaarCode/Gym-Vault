'use strict';
/* R1-05 / L4-14: with no active plan Today said "Rest day" on every weekday and
   the kicker ended in a dangling " · ". It now says there is no plan yet, with a
   button to Plans, and the kicker only carries a separator when a plan name
   follows it. */
const assert = require('node:assert');
const T = require('./f3-stub');
const dashboard = require('../src/page-dashboard');

const mkCtx = plan => {
  const navs = [];
  const ctx = {
    app: {}, data: { workouts: [], exercises: [], goals: [], body: [], plans: plan ? [plan] : [] }, settings: { weekStart: 'mon' }, state: {}, io: {},
    nav: (...a) => navs.push(a), notice() {}, reload() {}, startGuided() {}, startLog() {},
    activePlan: () => plan || null, activePlanIsImplicit: () => false, mainPlans: () => (plan ? [plan] : []), parallelPlans: () => [], fallbackPlans: () => [], daysOn: () => [],
  };
  return { ctx, navs };
};
const norm = s => s.replace(/\s+/g, ' ').trim();

{
  const { ctx, navs } = mkCtx(null);
  const root = T.render(dashboard, ctx);
  const text = norm(root.textContent);
  assert.ok(!/Rest\s+day/.test(text), `no plan must not read as a rest day: "${text.slice(0, 160)}"`);
  assert.ok(/No\s+plan\s+yet/.test(text), `says there is no plan yet: "${text.slice(0, 160)}"`);
  const kicker = norm(T.findAll(root, 'gv-hero-head')[0].children[0].textContent);
  assert.ok(!/[·]\s*$/.test(kicker), `the kicker ends in a dangling separator: "${kicker}"`);
  const go = T.findAll(root, 'gv-btn-hero-ghost').concat(T.findAll(root, 'gv-btn')).find(b => /Plans/.test(b.textContent));
  assert.ok(go, 'a button to Plans');
  go.click();
  assert.deepStrictEqual(navs.pop(), ['plans'], 'it opens Plans');
}
{
  /* control: a plan with nothing scheduled today is still a rest day, kicker carries its name */
  const plan = { name: 'My Plan', fm: { active: 'true' }, model: { days: [], intro: [] } };
  const { ctx } = mkCtx(plan);
  const root = T.render(dashboard, ctx);
  assert.ok(/Rest\s+day/.test(root.textContent), 'control: with a plan and nothing scheduled it is a rest day');
  assert.ok(/My Plan/.test(norm(T.findAll(root, 'gv-hero-head')[0].children[0].textContent)), 'control: kicker names the plan');
}
console.log('f3 no-plan Today OK');
