'use strict';
/* BACK RETURNS TO WHERE YOU CAME FROM (issue #22).

   THE BUG THIS REPRODUCES. Nested pages hardcoded their destination.
   page-run-records always did ctx.nav('running'); page-exercise-detail always
   ctx.nav('exercises'). So:

     Records -> Running records -> Back            landed on Running, not Records
     Records -> exercise detail -> Back            landed on the Exercises library,
                                                   which you had never opened

   There was no route stack to consult, so Back could only ever guess, and it
   guessed the same way however you arrived. And `browse` was not mapped in
   renderNavState, so opening it left NO primary tab lit at all.

   The stack is deliberately shallow: a tap on a PRIMARY tab is a fresh start
   and clears it, or Back would eventually walk you backwards through an
   entire session's browsing.

   nav.test.cjs only ever checked that six primary tabs exist and that the
   bar is laid out for a thumb. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

/* The stack is a closure inside mountApp, which needs a plugin, a vault and a
   real view to build. So the RULES are exercised against a faithful
   reimplementation of the two functions under test, and the fact that the
   controller is wired that way is pinned in source below. If the source pin
   fails, this model is describing code that no longer exists. */
function makeRouter() {
  const MAX_BACK = 10;
  const state = { page: 'dashboard', params: {} };
  const stack = [];
  const applyNav = (page, params) => { state.page = page; state.params = params || {}; };
  return {
    state, stack,
    nav(page, params, opts) {
      if (opts && opts.reset) stack.length = 0;
      else if (page !== state.page) {
        stack.push({ page: state.page, params: state.params || {} });
        if (stack.length > MAX_BACK) stack.shift();
      }
      applyNav(page, params);
    },
    backTo: fallback => (stack.length ? stack[stack.length - 1].page : fallback),
    back(fallback) {
      const prev = stack.pop();
      if (prev) applyNav(prev.page, prev.params);
      else applyNav(fallback, null);
    },
  };
}

/* ---------- 1. THE REPORTED ROUTE: Records -> Running records ---------- */
{
  const r = makeRouter();
  r.nav('history', null, { reset: true });   // a primary tab
  r.nav('records');                          // History -> Records
  r.nav('run-records');                      // Records -> Running records

  assert.strictEqual(r.backTo('running'), 'records',
    'Back must name the caller, so its label can say where it will land');
  r.back('running');
  assert.strictEqual(r.state.page, 'records',
    'Records -> Running records -> Back must return to RECORDS, not to Running');

  r.back('history');
  assert.strictEqual(r.state.page, 'history', 'and again, out to History');
}

/* ---------- 2. the fallback is for a FIRST visit ---------- */
{
  const r = makeRouter();
  r.nav('running', null, { reset: true });
  r.nav('run-records');
  r.back('running');
  assert.strictEqual(r.state.page, 'running',
    'arriving from Running still returns to Running — the fallback is not being replaced, it is being consulted last');

  /* Nothing remembered at all: the fallback is the whole answer. */
  const fresh = makeRouter();
  fresh.stack.length = 0;
  fresh.back('exercises');
  assert.strictEqual(fresh.state.page, 'exercises');
  assert.strictEqual(fresh.backTo('exercises'), 'exercises');
}

/* ---------- 3. an exercise opened from a record goes back to the record --- */
{
  const r = makeRouter();
  r.nav('history', null, { reset: true });
  r.nav('records');
  r.nav('exercise', { exercise: 'Pull-ups' });
  r.back('exercises');
  assert.strictEqual(r.state.page, 'records',
    'an exercise reached from Records must not drop you in a library you never opened');
}

/* ---------- 4. params are restored, not just the page ---------- */
{
  const r = makeRouter();
  r.nav('plans', null, { reset: true });
  r.nav('plans', { plan: 'Get Over The Bar' });   // same page, new params
  r.nav('exercise', { exercise: 'Pull-ups' });
  r.back('exercises');
  assert.strictEqual(r.state.page, 'plans');
  assert.deepStrictEqual(r.state.params, { plan: 'Get Over The Bar' },
    'returning to a plan detail must return to THAT plan, not to the plan list');
}

/* ---------- 5. a primary tab is a fresh start ---------- */
{
  const r = makeRouter();
  r.nav('history', null, { reset: true });
  r.nav('records');
  r.nav('run-records');
  assert.strictEqual(r.stack.length, 2);

  r.nav('exercises', null, { reset: true });     // a nav-bar tap
  assert.strictEqual(r.stack.length, 0,
    'a primary tab clears the stack — Back must not walk you through everywhere you have been');

  r.nav('exercise', { exercise: 'Dips' });
  r.back('exercises');
  assert.strictEqual(r.state.page, 'exercises');
}

/* ---------- 6. a re-nav to the same page is a refresh, not a step -------- */
{
  const r = makeRouter();
  r.nav('history', null, { reset: true });
  r.nav('records');
  r.nav('records');            // a rerender-driven re-nav
  r.nav('records');
  assert.strictEqual(r.stack.length, 1,
    'pushing a same-page nav would make Back land where you already are');
  r.back('history');
  assert.strictEqual(r.state.page, 'history');
}

/* ---------- 7. the stack is capped ---------- */
{
  const r = makeRouter();
  r.nav('dashboard', null, { reset: true });
  for (let i = 0; i < 40; i++) r.nav(i % 2 ? 'records' : 'history');
  assert.ok(r.stack.length <= 10,
    'an uncapped stack is one nobody can predict, and it grows for as long as the view is open');
}

/* ---------- 7b. A LATERAL MOVE IS NOT A STEP (found in the real host) ----

   Plan detail and the plan LIST are the same page id with different params,
   so opening a plan is a lateral move and the stack deliberately does not
   push it. That is what makes an empty stack land you back on the list.

   Plan detail's Back was still hardcoded to ctx.nav('plans'), so reaching a
   plan from RUNNING — its "Plan" button navigates straight here — dropped
   you on the Plans list instead of returning you to Running. The same defect
   #22 fixed for records and exercise detail, on a route that issue did not
   name, and found by driving the real app rather than by any test here. */
{
  /* From the list: nothing to pop, and the fallback IS the list. */
  const a = makeRouter();
  a.nav('plans', null, { reset: true });
  a.nav('plans', { plan: '9 Foundations' });
  assert.strictEqual(a.stack.length, 0, 'opening a plan is lateral — it must not push');
  assert.strictEqual(a.backTo('plans'), 'plans', 'so the label reads "Back to Plans"');
  a.back('plans');
  assert.strictEqual(a.state.page, 'plans');
  assert.deepStrictEqual(a.state.params, {}, 'and Back lands on the list, via the fallback');

  /* From Running: the page DID change, so it pushed, and Back must honour it. */
  const b = makeRouter();
  b.nav('running', null, { reset: true });
  b.nav('plans', { plan: 'Trail Base' });
  assert.strictEqual(b.backTo('plans'), 'running',
    'reached from Running, Back must say — and mean — Running');
  b.back('plans');
  assert.strictEqual(b.state.page, 'running',
    'this is the bug: Back used to drop you on the Plans list from here');

  /* Leaving a plan detail for a real page still records THAT plan. */
  const c = makeRouter();
  c.nav('plans', null, { reset: true });
  c.nav('plans', { plan: '9 Foundations' });
  c.nav('exercise', { exercise: 'Push-ups' });
  c.back('exercises');
  assert.deepStrictEqual(c.state.params, { plan: '9 Foundations' },
    'a lateral move is not pushed, but leaving the page is — back to THAT plan, not the list');

  /* And the lateral rule is what keeps History's expand/collapse from
     filling the stack, since it re-navs the same page with new params. */
  const d = makeRouter();
  d.nav('history', null, { reset: true });
  d.nav('history', { session: 'a' });
  d.nav('history', {});
  d.nav('history', { session: 'b' });
  assert.strictEqual(d.stack.length, 0,
    'expanding a session must not become a back step, or leaving History takes four presses');
}

/* ---------- 8. THE SOURCE IS WIRED THAT WAY ---------- */
{
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const ctl = read('controller.js');
  assert.match(ctl, /ctx\.back = fallback =>/, 'ctx.back must exist');
  assert.match(ctl, /ctx\.backTo = fallback =>/, 'and ctx.backTo, so a label can name its destination');
  assert.match(ctl, /const prev = ctx\._backStack\.pop\(\);\s*\n\s*if \(prev\) applyNav\(/,
    'back() must use applyNav, not ctx.nav — going back must not push the page you just left, or Back becomes a toggle');
  assert.match(ctl, /ctx\.nav\(item\.id, null, \{ reset: true \}\)/,
    'a primary tab tap must clear the stack');
  assert.match(ctl, /'browse' \? 'plans'/,
    'browse hangs off Plans; unmapped it lit no primary tab at all');

  /* Every nested page uses the shared button rather than a hardcoded nav. */
  for (const [file, fallback] of [
    ['page-run-records.js', 'running'],
    ['page-exercise-detail.js', 'exercises'],
    ['page-records.js', 'history'],
    ['page-browse.js', 'plans'],
    ['page-plans.js', 'plans'],
  ]) {
    const src = read(file);
    assert.ok(src.includes(`backButton(ctx, '${fallback}')`),
      `${file} must use the shared back button with '${fallback}' as its first-visit fallback`);
    assert.ok(!src.includes(`back.addEventListener('click', () => ctx.nav('${fallback}'))`),
      `${file} must not keep a hardcoded destination — that is the whole defect`);
  }

  /* And the button consults the stack for its label. */
  const dom = read('dom.js');
  assert.match(dom, /const to = ctx\.backTo\(fallback\);/,
    'the label must name where Back will actually land, since that now varies with how you arrived');
  assert.match(dom, /ctx\.back\(fallback\)/, 'and the click must go through the stack');
}

console.log('back stack OK (Back returns to the caller, primary tabs reset it, browse lights Plans)');
