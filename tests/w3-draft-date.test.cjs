'use strict';
/* R2-13: a draft left open from yesterday looked like today's - the Today
   "Session in progress" card showed no date. It now names the draft's date when
   that is not today, in the app's own short date style (fmtShort). */
const assert = require('node:assert');
const T = require('./f3-stub');
const dashboard = require('../src/page-dashboard');
const { describeDraft } = require('../src/controller');
const { todayISO, addDays, fmtShort } = require('../src/dates');

const plan = {
  name: 'Plan', fm: { active: 'true' },
  model: { days: [{ name: 'A', weekday: 'mon', items: [{ exercise: 'Pull-ups', sets: 3, target: '8' }], notes: [] }], intro: [] },
};
function slabText(draftDate) {
  const ctx = {
    app: {}, data: { workouts: [], exercises: [{ name: 'Pull-ups', fm: { unit: 'reps' } }], goals: [], body: [] },
    settings: { weekStart: 'mon' },
    state: { logDraft: { plan: 'Plan', day: 'A', date: draftDate, startedAt: Date.now(), entries: [] } },
    io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {}, resumeDraft() {},
    activePlan: () => plan, activePlanIsImplicit: () => false,
    mainPlans: () => [plan], parallelPlans: () => [], fallbackPlans: () => [],
    daysOn: () => [{ plan, day: plan.model.days[0] }],
  };
  ctx.describeDraft = () => describeDraft(ctx.state.logDraft);
  const root = T.render(dashboard, ctx);
  const card = T.findAll(root, 'gv-alsotoday').find(c => /Session in progress/.test(c.textContent));
  assert.ok(card, 'the Session in progress card renders');
  return card.textContent.replace(/\s+/g, ' ');
}

const failures = [];
const test = (name, fn) => { try { fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

test('R2-13 a draft from an earlier day names its date', () => {
  const day = addDays(todayISO(), -1);
  const t = slabText(day);
  assert.ok(t.includes(fmtShort(day)), `expected ${fmtShort(day)} in: ${t}`);
});
test('R2-13 control: today\'s draft shows no date', () => {
  const t = slabText(todayISO());
  assert.ok(!t.includes(fmtShort(todayISO())), `today's date must not be printed: ${t}`);
});
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 draft date OK');
