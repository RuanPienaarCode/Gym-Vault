'use strict';
/* AN EXISTING BUT EMPTY GYM FOLDER OFFERS SETUP ONCE INDEXING IS DONE
   (0.12.1, audit L2-06).

   THE BUG THIS LOCKS. Point Settings -> Gym folder at a folder that already
   exists and has no gym in it yet (an empty "Training" folder, say) and the
   page said "Waiting for the vault ... this usually clears itself in a few
   seconds" forever. The controller reads "folder exists, nothing loaded" as
   "Obsidian has not finished indexing" and never asked whether it HAD
   finished, so there was no setup button, only a "Try again" that could never
   succeed.

   The rule now: that state shows the waiting card only while the metadata
   cache is genuinely still indexing; once it is done it is a fresh start and
   shows the setup card. Files that could not be read still wait (a sync is
   landing), and a folder that does not exist at all was always a fresh start.
   Obsidian's own signals are `app.metadataCache.initialized` (false until the
   first pass completes; undocumented, so only an explicit `false` counts as
   "still indexing") and the `resolved` event (the code already reloads on it).

   Drives the REAL controller and reads what it actually renders. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

const EMPTY_BUT_THERE = { present: false, rootExists: true, unreadable: 0, unreadablePaths: [], exercises: [], plans: [], goals: [], workouts: [] };
const text = b => H.page(b.ctx).textContent;
const hasCreate = b => H.page(b.ctx).querySelectorAll('button').some(x => /Create my gym/.test(x.textContent));

async function boot(metadataCache, data, extra) {
  const cacheHandlers = {};
  const cache = Object.assign({ on: (evt, fn) => { cacheHandlers[evt] = fn; return {}; } }, metadataCache);
  const b = await H.boot(Object.assign({ data: Object.assign({}, EMPTY_BUT_THERE, data || {}), app: { metadataCache: cache } }, extra || {}));
  b.cache = cache; b.cacheHandlers = cacheHandlers;
  return b;
}

(async () => {
  await check('1. folder exists, nothing in it, indexing finished -> the setup card with its button', async () => {
    const b = await boot({ initialized: true });
    assert.ok(hasCreate(b), `has "Create my gym" button: ${hasCreate(b)} — page says: "${text(b).slice(0, 90)}"`);
    assert.ok(!/Waiting for the vault/.test(text(b)));
  });

  await check('2. the host does not say it is still indexing (no flag at all) -> setup, not an endless wait', async () => {
    const b = await boot({});
    assert.ok(hasCreate(b), `page says: "${text(b).slice(0, 90)}"`);
  });

  await check('3. still indexing (initialized === false) -> keep the waiting card, no setup button', async () => {
    const b = await boot({ initialized: false });
    assert.ok(/Waiting for the vault/.test(text(b)), text(b).slice(0, 90));
    assert.ok(!hasCreate(b), 'offering "create my gym" mid-index would be wrong and alarming');
  });

  await check('4. ... and when the cache finishes (resolved event) the same view turns into the setup card by itself', async () => {
    const b = await boot({ initialized: false });
    assert.ok(/Waiting for the vault/.test(text(b)), 'precondition: waiting');
    b.cache.initialized = true;
    b.cacheHandlers.resolved();
    await H.flush(); await H.flush();
    assert.ok(hasCreate(b), `after resolved: ${text(b).slice(0, 90)}`);
  });

  await check('5. a resolved event settles it even if the flag lags behind', async () => {
    const b = await boot({ initialized: false });
    b.cacheHandlers.resolved();                      // flag still false
    await H.flush(); await H.flush();
    assert.ok(hasCreate(b), `after resolved with a stale flag: ${text(b).slice(0, 90)}`);
  });

  await check('6. files that could not be read still wait, even after indexing (a sync is landing)', async () => {
    const b = await boot({ initialized: true }, { unreadable: 2, unreadablePaths: ['Gym/Profile.md', 'Gym/Body Log.md'] });
    assert.ok(/could not be read yet/.test(text(b)), text(b).slice(0, 120));
    assert.ok(!hasCreate(b));
  });

  await check('7. a folder that does not exist is still a plain fresh start, flag or no flag', async () => {
    for (const flag of [false, true, undefined]) {
      const b = await boot({ initialized: flag }, { rootExists: false });
      assert.ok(hasCreate(b), `initialized=${flag}: ${text(b).slice(0, 90)}`);
    }
  });

  await check('8. a load error still shows the waiting card with the reason', async () => {
    const b = await H.boot({ app: { metadataCache: { initialized: true, on: () => ({}) } }, data: EMPTY_BUT_THERE });
    b.ctx.loadError = 'boom';
    b.ctx.rerender();
    assert.ok(/Could not read the gym folder \(boom\)/.test(text(b)), text(b).slice(0, 120));
  });

  await check('9. an existing gym is untouched by any of this', async () => {
    const b = await H.boot({ app: { metadataCache: { initialized: false, on: () => ({}) } } });
    assert.ok(!/Waiting for the vault/.test(text(b)) && !hasCreate(b), 'loaded data renders the app, whatever the flag says');
  });

  await check('10. the setup button actually runs setup and reloads', async () => {
    const b = await boot({ initialized: true });
    const before = b.loads();
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Create my gym/.test(x.textContent)));
    await H.flush(); await H.flush();
    assert.strictEqual(b.scaffolds(), 1, 'scaffold must run');
    assert.ok(b.loads() > before, 'and the view reloads afterwards');
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n')[0]}` : ''}`);
  if (failed.length) { console.error(`${failed.length} of ${results.length} gym-folder checks failed`); process.exit(1); }
  console.log(`gym folder setup offer OK (${results.length} checks: empty existing folder offers setup once indexed; still waits while indexing or unreadable)`);
})();
