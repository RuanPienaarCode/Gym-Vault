'use strict';
/* THE VAULT WATCHER SKIPS ONLY OUR OWN WRITES, PATH BY PATH (0.12.1, audit
   L2-04).

   THE BUG THIS LOCKS. controller.js ignored EVERY gym-folder event for 1.5 s
   after ANY plugin write. Save note A, and an edit to a DIFFERENT note B that
   lands in that window — an iCloud edit arriving from the other device, an
   edit in another pane — was never reloaded. ctx.data kept the old B, and the
   next save of B wrote that stale copy over the edit.

   Contract (data.js records, the controller reads): plugin._ownWrites is a
   Map<vaultPath, msTimestamp> of every path the plugin itself wrote, renames
   under BOTH names. An event is skipped only when its path (or, on a rename,
   its old path) has an own write inside the last 1500 ms. With no map at all
   the old plugin._lastWrite rule still applies.

   Drives the REAL controller; the vault events are fired by hand. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const A = 'Gym/Exercises/Alpha Hold.md';
const B = 'Gym/Exercises/Beta Row.md';
const OUTSIDE = 'Notes/Elsewhere.md';

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

/* A controller with the vault handlers captured and reload() counted. */
async function boot(pluginOpts) {
  const handlers = {};
  const b = await H.boot({
    app: { vault: { on: (evt, fn) => { handlers[evt] = fn; return {}; } } },
    plugin: pluginOpts,
  });
  let reloads = 0;
  b.ctx.reload = async () => { reloads++; };
  return {
    b, reloads: () => reloads,
    /* fire an event, wait out the 400 ms debounce, report whether it reloaded */
    async event(evt, file, oldPath) {
      const before = reloads;
      handlers[evt](file, oldPath);
      H.advance(600);
      return reloads > before;
    },
  };
}
const file = p => ({ path: p });

(async () => {
  await check('1. own write to A, outside edit of B 300 ms later -> reload', async () => {
    const own = new Map([[A, H.clock.now]]);
    const t = await boot({ _ownWrites: own, _lastWrite: H.clock.now });
    H.advance(300);
    assert.strictEqual(await t.event('modify', file(B)), true,
      'loads after outside edit of ANOTHER note: no reload — the 1.5 s window swallowed it');
  });

  await check('2. own write to A, then the modify event for A itself -> skipped', async () => {
    const own = new Map([[A, H.clock.now]]);
    const t = await boot({ _ownWrites: own, _lastWrite: H.clock.now });
    H.advance(300);
    assert.strictEqual(await t.event('modify', file(A)), false, 'our own save must not trigger a reload storm');
  });

  await check('3. the same path again AFTER the window -> an outside edit, reload', async () => {
    const own = new Map([[A, H.clock.now]]);
    const t = await boot({ _ownWrites: own, _lastWrite: H.clock.now });
    H.advance(1600);
    assert.strictEqual(await t.event('modify', file(A)), true);
  });

  await check('4. every event kind is path-checked (create, delete)', async () => {
    const own = new Map([[A, H.clock.now]]);
    const t = await boot({ _ownWrites: own, _lastWrite: H.clock.now });
    assert.strictEqual(await t.event('create', file(A)), false, 'our own create is skipped');
    own.set(A, H.clock.now);
    assert.strictEqual(await t.event('delete', file(B)), true, 'someone else deleting B is not');
  });

  await check('5. rename: our rename (both names recorded) is skipped; an unrelated outside rename is not', async () => {
    const A2 = 'Gym/Exercises/Alpha Hold 2.md';
    const own = new Map([[A, H.clock.now], [A2, H.clock.now]]);
    const t = await boot({ _ownWrites: own, _lastWrite: H.clock.now });
    assert.strictEqual(await t.event('rename', file(A2), A), false, 'our own rename');
    own.set(A, H.clock.now); own.set(A2, H.clock.now);
    assert.strictEqual(await t.event('rename', file('Gym/Exercises/Delta.md'), B), true, 'an unrelated rename of B');
  });

  await check('6. a note dragged OUT of the gym folder is matched on its OLD path', async () => {
    const own = new Map();
    const t = await boot({ _ownWrites: own, _lastWrite: H.clock.now });
    assert.strictEqual(await t.event('rename', file(OUTSIDE), B), true, 'dragged out by the user: reload');
    own.set(B, H.clock.now);
    assert.strictEqual(await t.event('rename', file(OUTSIDE), B), false, 'dragged out by us (old path recorded): skip');
  });

  await check('7. events outside the gym folder are still ignored', async () => {
    const t = await boot({ _ownWrites: new Map(), _lastWrite: 0 });
    assert.strictEqual(await t.event('modify', file(OUTSIDE)), false);
  });

  await check('8. a fresh _lastWrite alone no longer hides an outside edit when the per-path map exists', async () => {
    const t = await boot({ _ownWrites: new Map(), _lastWrite: H.clock.now });
    assert.strictEqual(await t.event('modify', file(B)), true);
  });

  await check('9. the map is read when the event fires, not captured at mount (data.js creates it lazily)', async () => {
    const t = await boot({ _lastWrite: 0 });            // no _ownWrites yet
    H.advance(5000);
    t.b.plugin._ownWrites = new Map([[A, H.clock.now]]); // created by the first write
    assert.strictEqual(await t.event('modify', file(A)), false);
    assert.strictEqual(await t.event('modify', file(B)), true);
  });

  await check('10. no map at all -> the old _lastWrite rule (any path inside 1.5 s is skipped)', async () => {
    const plugin = { _lastWrite: H.clock.now };
    const t = await boot(plugin);
    H.advance(300);
    assert.strictEqual(await t.event('modify', file(B)), false, 'fallback: blanket skip');
    H.advance(1600);
    assert.strictEqual(await t.event('modify', file(B)), true, 'and it expires');
  });

  await check('11. onload creates the map beside _lastWrite', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const main = fs.readFileSync(path.join(H.SRC, 'main.js'), 'utf8');
    assert.ok(/this\._ownWrites\s*=\s*new Map\(\)/.test(main), 'main.js onload must initialise this._ownWrites = new Map()');
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n')[0]}` : ''}`);
  if (failed.length) { console.error(`${failed.length} of ${results.length} watcher checks failed`); process.exit(1); }
  console.log(`watcher own writes OK (${results.length} checks: skipped per path, renames on both names, old rule only when no map exists)`);
})();
