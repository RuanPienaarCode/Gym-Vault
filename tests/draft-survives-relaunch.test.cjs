'use strict';
/* A WORKOUT IN PROGRESS SURVIVES THE APP BEING KILLED (0.12.1, audit L3-01).

   THE BUG THIS LOCKS. The live session lived ONLY on ctx.state.logDraft, in
   memory. Nothing touches the vault until Finish, so iOS evicting Obsidian
   while it sat in the background (the session's own Music button sends you to
   Spotify; so does a phone call), closing the Gym tab, a plugin update or
   quitting threw away every finished set — the only trace was a Notice in
   onClose saying so.

   The fix keeps the draft on the DEVICE (app.saveLocalStorage where it
   exists, else window.localStorage; never the vault, never data.json, which
   syncs and would be overwritten by another device) and offers it back
   through the Today "Session in progress" card that already existed.

   Everything below drives the REAL controller.mountApp and the real guided
   session through tests/live-session-harness.js (fake DOM and clock, Obsidian's
   own storage semantics). "Relaunch" is a process kill: no stop(), no
   onClose, no flush — only what was already written survives. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const KEY = 'gym-app-draft';
const results = [];
const check = async (name, fn) => {
  /* A clean process for every case: listeners an earlier case left on the
     document or window would otherwise make the "removed on stop" count lie. */
  H.killProcess();
  H.document.visibilityState = 'visible';
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

/* Two sets of push-ups, 10 taps each, through the real guided screen. */
async function twoSets(opts) {
  const b = await H.boot(Object.assign({ settings: { guideRestSeconds: 0 } }, opts));
  const { ctx } = b;
  const plan = ctx.activePlan(); ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  for (let set = 0; set < 2; set++) {
    H.advance(6000);
    const zone = H.page(ctx).querySelector('.gv-session-zone');
    for (let i = 0; i < 10; i++) { H.tapZone(zone); H.advance(800); }
    H.click(H.byText(H.page(ctx), 'Done'));
  }
  return b;
}
const clone = o => JSON.parse(JSON.stringify(o));
const sessionCard = ctx => /Session in progress/.test(H.page(ctx).textContent);

(async () => {
  /* ---------- 1. THE REPORTED ROUTE: two sets, kill, relaunch ---------- */
  const storage = H.makeStorage();
  let before;
  await check('1. after a kill, a fresh controller over the same device offers the session back with identical entries', async () => {
    const a = await twoSets({ storage });
    before = clone(a.ctx.state.logDraft);
    assert.strictEqual(before.entries[0].sets.filter(s => s.done).length, 2, 'fixture: two sets done on screen');
    assert.strictEqual(a.saved.length, 0, 'fixture: nothing has reached the vault');
    H.killProcess();

    const b = await H.boot({ storage });
    assert.strictEqual(b.ctl.hasDraft(), true,
      `after relaunch: hasDraft = ${b.ctl.hasDraft()} — the finished sets were lost with the process`);
    assert.strictEqual(sessionCard(b.ctx), true, 'Today must show the "Session in progress" card');
    assert.deepStrictEqual(b.ctx.state.logDraft.entries, before.entries, 'every entry and set must come back exactly');
    for (const k of ['date', 'plan', 'day', 'startedAt']) {
      assert.strictEqual(b.ctx.state.logDraft[k], before[k], `draft.${k} must come back unchanged`);
    }
  });

  /* ---------- 2. Resume -> Finish saves what was done, then clears --------- */
  await check('2. Resume opens the log, Bank it saves the same rows, and storage is empty afterwards', async () => {
    H.killProcess();
    const b = await H.boot({ storage });
    assert.ok(b.ctl.hasDraft(), 'precondition: the draft is offered back');
    b.ctx.resumeDraft();
    assert.strictEqual(b.ctx.state.page, 'log');
    H.click(H.byText(H.page(b.ctx), 'Bank it'));
    await H.flush();
    assert.strictEqual(b.saved.length, 1, 'the restored session must save through the normal Finish');
    assert.deepStrictEqual(b.saved[0].rows.filter(r => r.exercise === 'Push-ups').map(r => r.reps), ['10', '10']);
    assert.strictEqual(storage.raw.has(KEY), false, 'Finish must clear the stored draft');
    H.killProcess();
    const c = await H.boot({ storage });
    assert.strictEqual(c.ctl.hasDraft(), false, 'a finished session must not come back after the next relaunch');
  });

  /* ---------- 3. Discard clears -------------------------------------------- */
  await check('3. the log page Discard clears the stored draft', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    assert.ok(s.raw.has(KEY), 'precondition: the draft is stored');
    a.ctx.resumeDraft();
    H.click(H.page(a.ctx).querySelectorAll('button').find(x => x.textContent.trim() === 'Discard'));
    H.modals.at(-1).opts.onConfirm();
    assert.strictEqual(a.ctx.state.logDraft, null);
    assert.strictEqual(s.raw.has(KEY), false, 'Discard must clear the stored draft');
  });
  await check('3b. the End session sheet Discard clears the stored draft', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    assert.ok(s.raw.has(KEY), 'precondition: the draft is stored');
    H.click(H.byLabel(H.page(a.ctx), 'End session'));
    H.modals.at(-1).opts.onDiscard();
    assert.strictEqual(s.raw.has(KEY), false, 'the sheet\'s Discard must clear the stored draft');
  });
  await check('3c. replacing a draft ("Discard and start") stores the NEW draft, not the old one', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    assert.ok(s.raw.has(KEY), 'precondition: the old draft is stored');
    const plan = a.ctx.activePlan();
    a.ctx.startLog(plan, plan.model.days[0]);       // asks first
    const modal = H.modals.at(-1);
    assert.ok(modal.opts.onConfirm, 'precondition: replacing a live draft asks');
    modal.opts.onConfirm();
    const stored = s.loadLocalStorage(KEY);
    assert.strictEqual(a.ctx.state.logDraft.entries.flatMap(e => e.sets).filter(x => x.done).length, 0, 'fixture: the new draft is empty');
    assert.strictEqual(stored, null, 'a fresh draft with nothing logged keeps nothing — the old draft must not linger');
  });

  /* ---------- 4. a corrupt or foreign stored value is ignored safely ------- */
  const junk = {
    'not JSON at all': '{not json',
    'JSON null': 'null',
    'a bare number': '42',
    'an array': '[1,2,3]',
    'an empty object': '{}',
    /* shapes that would restore fine if the version were ignored */
    'a future version': JSON.stringify({ v: 99, savedAt: Date.now(), draft: { date: '2026-01-01', entries: [{ exercise: 'Push-ups', sets: [{ reps: '5', done: true, touched: true }] }] } }),
    'an older version': JSON.stringify({ v: 0, savedAt: Date.now(), draft: { date: '2026-01-01', entries: [{ exercise: 'Push-ups', sets: [{ reps: '5', done: true, touched: true }] }] } }),
    'no version at all': JSON.stringify({ savedAt: Date.now(), draft: { date: '2026-01-01', entries: [{ exercise: 'Push-ups', sets: [{ reps: '5', done: true, touched: true }] }] } }),
    'logged work under a nameless exercise': JSON.stringify({ v: 1, savedAt: Date.now(), draft: { date: '2026-01-01', entries: [{ exercise: '  ', sets: [{ reps: '5', done: true, touched: true }] }] } }),
    'entries that are not a list': JSON.stringify({ v: 1, savedAt: Date.now(), draft: { date: '2026-01-01', entries: 'oops' } }),
    'an entry with no sets': JSON.stringify({ v: 1, savedAt: Date.now(), draft: { date: '2026-01-01', entries: [{ exercise: 'Push-ups', sets: [] }] } }),
    'an unreadable date': JSON.stringify({ v: 1, savedAt: Date.now(), draft: { date: 'yesterday', entries: [{ exercise: 'Push-ups', sets: [{ reps: '5', done: true, touched: true }] }] } }),
  };
  for (const [what, text] of Object.entries(junk)) {
    await check(`4. ${what}: no crash, no draft`, async () => {
      const s = H.makeStorage();
      s.raw.set(KEY, text);
      H.killProcess();
      const b = await H.boot({ storage: s });
      assert.strictEqual(b.ctl.hasDraft(), false);
      assert.ok(H.page(b.ctx).textContent.length > 0, 'Today must still render');
    });
  }

  /* ---------- 5. only plain data comes back — never a half-state ----------- */
  await check('5. timed schedule, finishing flag, functions and nodes are never stored or restored', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    const d = a.ctx.state.logDraft;
    d.timed = { intervals: [{ kind: 'work', entryIndex: 0, setIndex: 0, seconds: 30 }], totalSeconds: 30 };
    d.finishing = true;                              // would block Finish forever if restored
    d.hook = () => {};                               // a function can't be JSON
    d.entries[0].node = H.document.createElement('div');
    a.ctx.rerender();                                // any change writes the snapshot
    const text = s.raw.get(KEY);
    assert.ok(text, 'precondition: stored');
    for (const k of ['timed', 'finishing', 'hook', 'node']) {
      assert.ok(!text.includes(`"${k}"`), `the stored draft must not carry "${k}": ${text.slice(0, 160)}`);
    }
    H.killProcess();
    const b = await H.boot({ storage: s });
    const r = b.ctx.state.logDraft;
    assert.ok(r, 'the logged sets still come back');
    assert.strictEqual(r.timed, undefined, 'a timed session returns as a plain LOG draft');
    assert.strictEqual(r.finishing, undefined, 'the finishing flag must not survive');
    assert.deepStrictEqual(Object.keys(r).sort(), ['date', 'day', 'entries', 'plan', 'startedAt']);
    b.ctx.resumeDraft();
    assert.strictEqual(b.ctx.state.page, 'log');
    H.click(H.byText(H.page(b.ctx), 'Bank it'));
    await H.flush();
    assert.strictEqual(b.saved.length, 1, 'and Finish works on it (a restored finishing flag would have swallowed this tap)');
  });

  /* ---------- 6. every change that matters is written, not just rerenders --- */
  await check('6a. assigning logDraft writes it; clearing it removes it', async () => {
    const s = H.makeStorage();
    const b = await H.boot({ storage: s });
    b.ctx.state.logDraft = { date: '2026-01-02', plan: '', day: '', startedAt: Date.now(), entries: [
      { exercise: 'Push-ups', target: '', duration: false, weighted: false, distance: false, sets: [{ reps: '8', weight_kg: '', seconds: '', done: true, touched: true }] }] };
    assert.ok(s.raw.has(KEY), 'an assignment must write');
    b.ctx.state.logDraft = null;
    assert.ok(!s.raw.has(KEY), 'a clear must remove');
  });
  await check('6b. a typed figure on the log page is written with no rerender', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    a.ctx.resumeDraft();
    const input = H.page(a.ctx).querySelectorAll('input').find(i => /^Reps/.test(i.getAttribute('aria-label') || ''));
    input.value = '17';
    H.fire(input, 'input');
    assert.strictEqual(a.ctx.state.logDraft.entries[0].sets[0].reps, '17', 'precondition: the figure reached the draft');
    assert.ok(s.raw.get(KEY).includes('"17"'), `the typed 17 must be on the device already: ${s.raw.get(KEY).slice(0, 200)}`);
  });
  await check('6b2. a typed weight on the guided screen is written with no rerender', async () => {
    const s = H.makeStorage();
    const b = await H.boot({ storage: s, planBody: '## D (any)\n\n- Goblet Squat | 3 x 10 @ 20kg\n', settings: { guideRestSeconds: 0 } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    const input = H.page(b.ctx).querySelectorAll('input').find(i => (i.getAttribute('aria-label') || '').startsWith('Weight in kilograms'));
    assert.ok(input, 'fixture: the guided weight box');
    input.value = '22.5';
    H.fire(input, 'input');
    assert.ok((s.raw.get(KEY) || '').includes('22.5'), `the typed 22.5 must be on the device already: ${s.raw.get(KEY)}`);
  });
  await check('6b3. a typed run distance and minutes on the guided screen are written with no rerender', async () => {
    const s = H.makeStorage();
    const b = await H.boot({ storage: s, exercises: [H.ex('Run', { unit: 'km' })], planBody: '## D (any)\n\n- Run | 1 x 30 min\n', settings: { guideRestSeconds: 0 } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    const find = label => H.page(b.ctx).querySelectorAll('input').find(i => (i.getAttribute('aria-label') || '').startsWith(label));
    const km = find('Distance in kilometres'), min = find('Minutes');
    assert.ok(km && min, 'fixture: the run boxes');
    km.value = '4.3'; H.fire(km, 'input');
    assert.ok((s.raw.get(KEY) || '').includes('4.3'), `typed km must be on the device already: ${s.raw.get(KEY)}`);
    min.value = '27'; H.fire(min, 'input');
    assert.ok((s.raw.get(KEY) || '').includes('"27"'), `typed minutes must be on the device already: ${s.raw.get(KEY)}`);
  });
  await check('6b4. a figure typed during a timed interval is written with no rerender', async () => {
    const s = H.makeStorage();
    const b = await H.boot({ storage: s, settings: { guideMode: 'timed', guideMinutes: 5, guideTransitions: true } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    H.advance(5100);
    let input = H.page(b.ctx).querySelectorAll('input').find(i => (i.getAttribute('aria-label') || '').startsWith('Reps'));
    for (let guard = 0; !input && guard < 8; guard++) {   // walk to the first work interval
      H.click(H.byLabel(H.page(b.ctx), 'Skip ahead') || H.byLabel(H.page(b.ctx), 'Skip this interval'));
      input = H.page(b.ctx).querySelectorAll('input').find(i => (i.getAttribute('aria-label') || '').startsWith('Reps'));
    }
    assert.ok(input, 'fixture: a timed work interval with a reps box');
    input.value = '31'; H.fire(input, 'input');
    assert.ok((s.raw.get(KEY) || '').includes('"31"'), `the typed 31 must be on the device already: ${s.raw.get(KEY)}`);
  });
  await check('6c. backgrounding the page (visibilitychange hidden, pagehide) flushes in-place edits', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    const set = a.ctx.state.logDraft.entries[0].sets[0];
    set.reps = '41';                                 // in place: no setter, no rerender
    H.document.visibilityState = 'visible';
    for (const fn of (H.docListeners.visibilitychange || [])) fn({});
    assert.ok(!s.raw.get(KEY).includes('"41"'), 'a page that is still visible is not a flush point');
    H.document.visibilityState = 'hidden';
    for (const fn of (H.docListeners.visibilitychange || [])) fn({});
    assert.ok(s.raw.get(KEY).includes('"41"'), 'hidden is the last chance before iOS may kill the app');
    set.reps = '42';
    for (const fn of (H.windowListeners.pagehide || [])) fn({});
    assert.ok(s.raw.get(KEY).includes('"42"'), 'pagehide must flush as well');
    H.document.visibilityState = 'visible';
  });
  await check('6d. stop() removes both listeners and flushes once more', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    assert.ok((H.docListeners.visibilitychange || []).length >= 1, 'precondition: registered');
    a.ctx.state.logDraft.entries[0].sets[0].reps = '55';
    a.ctl.stop();
    assert.strictEqual((H.docListeners.visibilitychange || []).length, 0, 'visibilitychange listener must be removed on stop');
    assert.strictEqual((H.windowListeners.pagehide || []).length, 0, 'pagehide listener must be removed on stop');
    assert.ok(s.raw.get(KEY).includes('"55"'), 'closing the view keeps the latest state');
  });
  await check('6e. every nav writes (Today -> History keeps the draft current)', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    a.ctx.state.logDraft.entries[0].sets[1].reps = '33';
    a.ctx.nav('history', null, { reset: true });
    assert.ok(s.raw.get(KEY).includes('"33"'));
  });

  /* ---------- 7. where it is kept ----------------------------------------- */
  await check('7a. without app.saveLocalStorage it uses window.localStorage, keyed by the vault', async () => {
    const m = new Map();
    H.win.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
    try {
      const noHost = { saveLocalStorage: undefined, loadLocalStorage: undefined, appId: 'vault-A' };
      const a = await twoSets({ app: noHost });
      const keys = [...m.keys()];
      assert.strictEqual(keys.length, 1, `exactly one key expected, got ${JSON.stringify(keys)}`);
      assert.ok(keys[0].includes('vault-A'), `the key must carry the vault id so two vaults never share a draft: ${keys[0]}`);
      H.killProcess();
      const b = await H.boot({ app: { saveLocalStorage: undefined, loadLocalStorage: undefined, appId: 'vault-A' } });
      assert.strictEqual(b.ctl.hasDraft(), true, 'and it comes back through that route too');
      H.killProcess();
      const other = await H.boot({ app: { saveLocalStorage: undefined, loadLocalStorage: undefined, appId: 'vault-B' } });
      assert.strictEqual(other.ctl.hasDraft(), false, "another vault must not be offered this vault's session");
      void a;
    } finally { delete H.win.localStorage; }
  });
  await check('7b. storage that throws never breaks the session, and the close notice does not claim it was kept', async () => {
    const boom = { saveLocalStorage() { throw new Error('quota'); }, loadLocalStorage() { throw new Error('denied'); } };
    const a = await twoSets({ app: boom });
    assert.strictEqual(a.ctx.state.logDraft.entries[0].sets.filter(s => s.done).length, 2, 'the session itself carries on');
    const { GymView } = require('../src/view');
    H.notices.length = 0;
    await GymView.prototype.onClose.call({ appCtl: a.ctl });
    assert.strictEqual(H.notices.length, 1, 'closing mid-workout still says something');
    assert.ok(!/kept|offered back/i.test(H.notices[0]), `must not claim the session was kept when it was not: "${H.notices[0]}"`);
  });
  await check('7b2. storage that swallows its own failure (Obsidian\'s wrapper catches quota errors) is read back, not trusted', async () => {
    const swallow = { saveLocalStorage() { /* the wrapper's try/catch ate the error */ }, loadLocalStorage() { return null; } };
    const a = await twoSets({ app: swallow });
    const { GymView } = require('../src/view');
    H.notices.length = 0;
    await GymView.prototype.onClose.call({ appCtl: a.ctl });
    assert.strictEqual(H.notices.length, 1);
    assert.ok(!/kept|offered back/i.test(H.notices[0]), `a write that did not land must not be reported as kept: "${H.notices[0]}"`);
  });
  await check('7c. when it WAS kept, the close notice says so (and no longer says "not saved")', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    const { GymView } = require('../src/view');
    H.notices.length = 0;
    await GymView.prototype.onClose.call({ appCtl: a.ctl });
    assert.strictEqual(H.notices.length, 1);
    assert.ok(/kept/i.test(H.notices[0]) && !/not saved/i.test(H.notices[0]), `copy: "${H.notices[0]}"`);
  });

  /* ---------- 8. two Gym views --------------------------------------------- */
  await check('8. a second view does not restore a copy of a draft another view is holding, and never clears it', async () => {
    const s = H.makeStorage();
    const a = await twoSets({ storage: s });
    const sibling = { ctx: a.ctx, hasDraft: () => a.ctl.hasDraft() };
    const b = await H.boot({ storage: s, plugin: { forEachView: fn => fn(sibling) } });
    assert.strictEqual(b.ctl.hasDraft(), false, 'two live copies of one session would double-save it');
    b.ctx.rerender();
    assert.ok(s.raw.has(KEY), 'a view with no draft must never clear the other one\'s');
    b.ctx.state.logDraft = null;                    // a stale Discard/Finish path in the view that holds nothing
    assert.ok(s.raw.has(KEY), 'not even by assigning null — only a controller that HELD a draft may clear it');
  });

  /* ---------- 9. the pure rules (src/draft-store.js) ---------------------- */
  await check('9. draft-store: whitelist, nothing-logged, stale-gap clock, scalar coercion', async () => {
    const store = require('../src/draft-store');
    const NOW = 1_800_000_000_000;
    const sets = (...s) => s;
    const draft = {
      date: '2026-01-02', plan: 'P', day: 'D', startedAt: NOW - 20 * 60000, finishing: true, timed: { intervals: [] },
      entries: [{ exercise: 'Push-ups', target: '3 x 10', duration: false, weighted: false, distance: false, extra: 1,
        sets: sets({ reps: 10, weight_kg: '', seconds: '', done: true, touched: true, secret: 'x' }, { reps: {}, weight_kg: NaN, seconds: '', done: false, touched: false }) }],
    };
    const snap = store.snapshotDraft(draft, NOW);
    assert.deepStrictEqual(Object.keys(snap.draft).sort(), ['date', 'day', 'entries', 'plan', 'startedAt']);
    assert.strictEqual(snap.v, store.STORE_VERSION);
    assert.strictEqual(snap.savedAt, NOW);
    assert.deepStrictEqual(snap.draft.entries[0].sets[0], { reps: 10, weight_kg: '', seconds: '', done: true, touched: true }, 'a numeric prefill stays a number; unknown keys are dropped');
    assert.deepStrictEqual(snap.draft.entries[0].sets[1], { reps: '', weight_kg: '', seconds: '', done: false, touched: false }, 'objects and NaN become blank, never a crash');
    assert.strictEqual(store.snapshotDraft({ date: '2026-01-02', entries: [{ exercise: 'X', sets: [{ reps: '5', done: false, touched: false }] }] }, NOW), null,
      'a draft with nothing logged is not worth keeping — a zombie card with nothing in it');
    assert.strictEqual(store.snapshotDraft(null, NOW), null);
    /* short gap: the clock keeps running through the time away */
    const soon = store.restoreDraft(JSON.parse(JSON.stringify(snap)), NOW + 10 * 60000);
    assert.strictEqual(soon.startedAt, draft.startedAt, 'a ten-minute gap is part of the session');
    /* long gap: the clock resumes from where it stopped, so Finish does not log a 15-hour workout */
    const next = NOW + 15 * 3600000;
    const late = store.restoreDraft(JSON.parse(JSON.stringify(snap)), next);
    assert.strictEqual(next - late.startedAt, 20 * 60000, 'elapsed after a long gap is what the session had when it stopped');
    assert.strictEqual(late.entries[0].sets[0].done, true);
  });

  /* ---------- report ------------------------------------------------------- */
  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n')[0]}` : ''}`);
  if (failed.length) { console.error(`${failed.length} of ${results.length} draft-persistence checks failed`); process.exit(1); }
  console.log(`draft survives relaunch OK (${results.length} checks: kill and relaunch, Finish/Discard clear, corrupt values ignored, plain data only, every change written, device-local)`);
})();
