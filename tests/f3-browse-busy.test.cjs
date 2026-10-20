'use strict';
/* R1-02: Browse "Add" double-tap. `busy` was declared and never used, so a
   second tap while the first install was in flight ran installPlan again and
   reported "could not add ... (File already exists.)" right after a success.
   Re-entry is refused; the buttons show the busy state; they come back after. */
const assert = require('node:assert');
const T = require('./f3-stub');
const browse = require('../src/page-browse');

const plan = (name, extra) => Object.assign({ name, days: 3, exercises: ['a', 'b'], summary: 's' }, extra);
const index = { plans: [plan('Solo'), plan('Prog 1 · Base', { series: 'Prog', phase: 1 }), plan('Prog 2 · Build', { series: 'Prog', phase: 2 })] };

function setup() {
  const calls = []; let release = null; const notices = []; let reloads = 0;
  const ctx = {
    app: {}, data: { plans: [] }, state: { browseUi: { index, error: null, loading: false, busy: null } },
    backTo: f => f, back() {}, nav() {},
    notice: m => notices.push(m), reload: async () => { reloads++; },
    io: { fetchPlanIndex: async () => index, installPlan: e => { calls.push(e.name); return new Promise(res => { release = () => res({ exercisesAdded: 0, exercisesSkipped: 0, failed: [] }); }); } },
  };
  return { ctx, calls, notices, release: () => release(), reloads: () => reloads };
}
const btns = root => T.findAll(root, 'gv-btn').filter(b => /Add/.test(b.textContent) || /Adding/.test(b.textContent));
const tick = () => new Promise(r => setTimeout(r, 0));

(async () => {
  const s = setup();
  const root = T.render(browse, s.ctx);
  await tick();
  const solo = btns(root).find(b => /^\s*Add\s*$/.test(b.textContent.replace(/\s+/g, ' ')) || /Add/.test(b.textContent));
  solo.click(); solo.click(); solo.click();
  await tick();
  assert.strictEqual(s.calls.length, 1, `a double tap ran installPlan ${s.calls.length} times: ${JSON.stringify(s.calls)}`);
  assert.ok(btns(root).some(b => /Adding/.test(b.textContent)), 'the tapped button shows the busy state');
  assert.ok(btns(root).every(b => b.disabled), 'and every Add is disabled while one install runs');
  s.release(); await tick(); await tick();
  assert.strictEqual(s.ctx.state.browseUi.busy, null, 'busy is released when the add finishes');
  assert.strictEqual(s.reloads(), 1);
  assert.ok(s.notices.length === 1 && /added/.test(s.notices[0]) && !/could not/.test(s.notices[0]), `notice: ${s.notices}`);

  /* a failed add releases the buttons so the user can retry */
  const f = setup();
  f.ctx.io.installPlan = async () => { throw new Error('boom'); };
  const r2 = T.render(browse, f.ctx); await tick();
  btns(r2)[0].click(); await tick(); await tick();
  assert.strictEqual(f.ctx.state.browseUi.busy, null, 'busy released after a failure');
  assert.ok(/could not add/.test(f.notices[0]), 'failure is still reported');
  assert.ok(btns(r2).every(b => !b.disabled), 'buttons usable again');
  console.log('f3 browse busy OK');
})().catch(e => { console.error(e); process.exit(1); });
