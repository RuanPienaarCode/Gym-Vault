'use strict';
/* WHAT TODAY IS DRIVING, AND WHAT IT REFUSES TO THROW AWAY.

   Three findings from the 0.11.2 journey audit, all on the Today screen:

   1. AN `(any)`-ONLY ACTIVE PLAN SCHEDULED NOTHING. daysOn honoured the
      `any` wildcard for FALLBACK plans only. Ten plans in the shared library
      (9 Foundations, the five body-part days, the kettlebell full-body, the
      tap-counter circuit, mobility, the post-run stretch) have nothing but
      `(any)` days and no fallback flag, and their own prose promises they
      "fill whatever day is otherwise empty". Make one active and every
      weekday resolved to Rest & Recovery instead, with every Start button on
      the plan's own page ghosted — the plan was unusable.

   2. NO PLAN FLAGGED ACTIVE WAS INVISIBLE. activePlan() falls back to the
      first main plan, and every downloaded plan arrives `active: false`, so
      deleting the seeded plan left Today confidently driving a programme the
      Plans list did not badge, with nothing on screen admitting it.

   3. A DRAFT HAD NO NAME TO SHOW. Leaving mid-session kept the draft in
      memory but nothing ever offered it back, so the next Start overwrote it
      silently. The Today screen now carries a Resume slab, which needs one
      rule for what that slab is called.

   These exercise the REAL exported rules, not a model of them — resolveDaysOn
   used to be a closure inside mountApp, and the only way to test a closure is
   to write a second copy of it, which is how a guard quietly stops describing
   the shipping code. */
const assert = require('node:assert');
const Module = require('node:module');

/* controller.js pulls in the whole page graph and several of those modules
   import obsidian at load time. Same stub trick the other suites use. */
const origLoad = Module._load;
const stub = {
  setIcon: () => {},
  Notice: class {}, Modal: class {}, Plugin: class {}, ItemView: class {},
  PluginSettingTab: class {}, Setting: class {},
  TFile: class {}, TFolder: class {},
  normalizePath: p => p,
  requestUrl: () => {},
};
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));

const { resolveDaysOn, isImplicitActive, describeDraft } = require('../src/controller');

const plan = (name, days, fm) => ({
  name,
  fm: fm || {},
  model: { days: days.map(d => ({ name: d.name, weekday: d.weekday, items: d.items || [], notes: [] })) },
});

/* ---- PROMISE 1: an `(any)`-only active plan fills every weekday ---- */

const foundations = plan('9 Foundations', [{ name: 'Foundations', weekday: 'any' }]);
const restPlan = plan('Rest & Recovery', [{ name: 'Rest & Recovery', weekday: 'any' }], { fallback: 'true' });

for (const wd of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
  const got = resolveDaysOn(wd, foundations, [], [restPlan]);
  assert.ok(
    got.length && got[0].plan.name === '9 Foundations',
    `an active plan whose only day is (any) must fill ${wd}: its own prose promises it "fills whatever day ` +
    `is otherwise empty", and honouring the wildcard for fallback plans alone made ten library plans ` +
    `unusable — every weekday fell through to the rest plan. Got: ` +
    (got.length ? got.map(g => g.plan.name).join(', ') : 'nothing scheduled'),
  );
}

/* ---- PROMISE 2: an exact weekday still beats the wildcard ---- */

const mixed = plan('Mixed', [
  { name: 'Pull Priority', weekday: 'mon' },
  { name: 'Anything', weekday: 'any' },
]);

const monday = resolveDaysOn('mon', mixed, [], [restPlan]);
assert.deepStrictEqual(
  monday.map(g => g.day.name), ['Pull Priority'],
  'a named weekday must win over the same plan\'s (any) day, or a plan with three real days plus a ' +
  'wildcard would run two sessions on each of them. Got: ' + monday.map(g => g.day.name).join(', '),
);

const tuesday = resolveDaysOn('tue', mixed, [], [restPlan]);
assert.deepStrictEqual(
  tuesday.map(g => g.day.name), ['Anything'],
  'on a weekday the plan does not name, its (any) day stands in. Got: ' + tuesday.map(g => g.day.name).join(', '),
);

/* ---- PROMISE 3: the wildcard does not swallow the fallback plan's job ---- */

const weekdayOnly = plan('Get Over The Bar', [{ name: 'A · Pull Priority', weekday: 'mon' }]);
const sunday = resolveDaysOn('sun', weekdayOnly, [], [restPlan]);
assert.deepStrictEqual(
  sunday.map(g => g.plan.name), ['Rest & Recovery'],
  'a plan with no (any) day of its own must still fall through to the rest plan on an empty weekday — ' +
  'the seeded plan is shaped exactly like this and must not change behaviour. Got: ' +
  sunday.map(g => g.plan.name).join(', '),
);

/* ---- PROMISE 4: parallel plans still run alongside, active plan first ---- */

const runPlan = plan('Half Marathon', [{ name: 'Easy Run', weekday: 'tue' }], { parallel: 'true' });
const withRun = resolveDaysOn('tue', foundations, [runPlan], [restPlan]);
assert.deepStrictEqual(
  withRun.map(g => g.plan.name), ['9 Foundations', 'Half Marathon'],
  'a parallel plan runs ALONGSIDE the active plan, active first — and the wildcard fill must not ' +
  'displace it. Got: ' + withRun.map(g => g.plan.name).join(', '),
);

/* ---- PROMISE 5: "no plan is marked active" is detectable ---- */

assert.strictEqual(
  isImplicitActive([plan('A', []), plan('B', [])]), true,
  'when nothing carries the active flag, activePlan() is silently falling back to the first main plan ' +
  'and the Today screen has to say so — every downloaded plan arrives active: false.',
);
assert.strictEqual(
  isImplicitActive([plan('A', [], { active: 'true' }), plan('B', [])]), false,
  'a plan flagged active is an explicit choice, not an implicit one — Today must not nag about it.',
);
assert.strictEqual(
  isImplicitActive([]), false,
  'no plans at all is the empty-vault case, not an unflagged one; the dashboard has its own copy for that.',
);
/* The flag is written to frontmatter as a STRING by data.setActivePlan, and
   read back through String(...) everywhere else in this file's neighbours.
   A boolean true must count too, because a hand-edited note can carry one. */
assert.strictEqual(
  isImplicitActive([plan('A', [], { active: true })]), false,
  'frontmatter active: true (a real boolean, from a hand-edited note) counts as flagged — the whole app ' +
  'compares String(fm.active) for exactly this reason.',
);

/* ---- PROMISE 6: an in-progress draft names itself ---- */

assert.strictEqual(
  describeDraft({ plan: 'Get Over The Bar', day: 'A · Pull Priority' }),
  'A · Pull Priority · Get Over The Bar',
  'the Resume slab names the day and the plan it belongs to, so a user who left mid-session knows what ' +
  'they are going back into.',
);
assert.strictEqual(
  describeDraft({ plan: '', day: '' }), 'Freestyle session',
  'a freestyle draft has neither plan nor day and must still be nameable — an unnamed Resume button is ' +
  'the same dead end the slab exists to remove.',
);
assert.strictEqual(describeDraft(null), '', 'no draft, nothing to name.');

/* ---- SOURCE PINS: the halves that live inside closures ----

   The Resume slab and the "ask before replacing a live draft" guard are both
   wired inside mountApp / render, which need a plugin, a vault and a real
   view to build. The RULES above are exercised directly; these pins are what
   stop the rules describing code that no longer calls them. */
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const controllerSrc = read('controller.js');
const dashboardSrc = read('page-dashboard.js');

for (const entry of ['ctx.startLog', 'ctx.startGuided']) {
  const line = controllerSrc.split('\n').find(l => l.indexOf(`${entry} = `) !== -1) || '';
  assert.ok(
    line.indexOf('replacingDraft') !== -1,
    `${entry} must route through replacingDraft. Both of them REPLACE ctx.state.logDraft outright, and ` +
    'the nav bar is visible during rest and on the completion screen — so one thumb-slip mid-session ' +
    `used to throw away every completed set with no warning. Got: ${line.trim() || '(not found)'}`,
  );
}

assert.ok(
  /new ConfirmModal\(/.test(controllerSrc) && /logDraft = null/.test(controllerSrc),
  'replacingDraft must ASK before discarding a live draft, and only then clear it — a silent overwrite ' +
  'is the bug this fixes, and a guard that only checks the call site would not notice it stopped asking.',
);

assert.ok(
  /ctx\.state\.logDraft/.test(dashboardSrc) && /ctx\.resumeDraft\(\)/.test(dashboardSrc),
  'the Today screen must read the live draft and offer it back. controller.js has promised since 0.5 that ' +
  '"coming back to Today offers the log page again"; nothing read the draft back until now, and a promise ' +
  'kept only in a comment is the finding this pins.',
);

console.log('today resolution OK (an (any)-only active plan fills the week, exact weekdays still win, ' +
  'an unflagged active plan is visible, a live draft names itself, Today offers it back, and nothing ' +
  'replaces it without asking)');
