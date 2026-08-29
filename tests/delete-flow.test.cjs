'use strict';
/* The delete flow, against a vault that updates its two indexes out of step.

   THE BUG THIS REPRODUCES: deleting a plan took you back to the plan list
   with the plan still on it. trash() waited for the note to disappear from
   the vault's PATH MAP, but loadAll() enumerates notes by walking the parent
   folder's CHILDREN array (see readNotesIn). Those are not updated in
   lockstep. The map cleared first, the wait returned immediately, and the
   reload that followed walked a children array that still held the note.

   The fake vault below models exactly that skew: the path map clears on
   delete, the children array catches up a few ticks later. A trash() that
   waits on the wrong structure fails this test. */
const assert = require('node:assert');
const Module = require('node:module');

class TFile {
  constructor(path) {
    this.path = path;
    this.extension = path.split('.').pop();
    this.basename = path.split('/').pop().replace(/\.md$/, '');
    this.parent = null;
  }
}
class TFolder {
  constructor(path) { this.path = path; this.children = []; }
}

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { TFile, TFolder, normalizePath: p => p, requestUrl: async () => ({}) }
  : origLoad(req, ...rest));
const { makeIo } = require('../src/data');
Module._load = origLoad;

global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };

/* A vault whose children array lags the path map by `lagTicks` polls. */
function makeVault(lagTicks) {
  const byPath = new Map();
  const add = node => { byPath.set(node.path, node); return node; };

  const gym = add(new TFolder('Gym'));
  const plansFolder = add(new TFolder('Gym/Plans'));
  gym.children.push(plansFolder);

  for (const name of ['Keeper', 'Test Plan']) {
    const f = add(new TFile(`Gym/Plans/${name}.md`));
    f.parent = plansFolder;
    plansFolder.children.push(f);
  }

  const contents = new Map([
    ['Gym/Plans/Keeper.md', '---\nactive: true\n---\n\n## A (mon)\n\n- Pull-ups | 5 x submax\n'],
    ['Gym/Plans/Test Plan.md', '---\nactive: false\n---\n\n## A (mon)\n\n- Pull-ups | 3 x 8\n'],
  ]);

  let pending = null;
  const v = {
    getAbstractFileByPath: p => byPath.get(p) || null,
    getFileByPath: p => (byPath.get(p) instanceof TFile ? byPath.get(p) : null),
    getFolderByPath: p => (byPath.get(p) instanceof TFolder ? byPath.get(p) : null),
    cachedRead: async f => contents.get(f.path) ?? '',
    create: async () => {}, createBinary: async () => {}, createFolder: async () => {}, modify: async () => {},
    /* The skew: drop from the map now, from children after a delay. */
    async trash(file) {
      byPath.delete(file.path);
      let ticks = 0;
      pending = setInterval(() => {
        if (++ticks < lagTicks) return;
        clearInterval(pending); pending = null;
        const i = plansFolder.children.indexOf(file);
        if (i !== -1) plansFolder.children.splice(i, 1);
      }, 10);
    },
  };
  return { v, plansFolder, cleanup: () => pending && clearInterval(pending) };
}

const makePlugin = v => ({
  app: { vault: v },                     // no fileManager: exercises the vault.trash fallback
  settings: { gymFolder: 'Gym' },
  _lastWrite: 0,
});

/* --- the regression: children lags the map --- */
{
  const { v, cleanup } = makeVault(6);          // children ~60ms behind the map
  const io = makeIo(makePlugin(v));

  (async function run() {
    const start = (await io.loadAll()).plans.map(p => p.name);
    assert.deepStrictEqual(start.sort(), ['Keeper', 'Test Plan'], 'both plans present to begin with');

    const victim = v.getFileByPath('Gym/Plans/Test Plan.md');
    await io.trash(victim);

    const after = (await io.loadAll()).plans.map(p => p.name);
    cleanup();
    assert.deepStrictEqual(
      after, ['Keeper'],
      'after trash() resolves, a reload must NOT still list the deleted plan — trash() has to wait ' +
      'for the children array loadAll() walks, not just the path map',
    );

    /* deleting something already gone must be loud, not a silent no-op */
    let threw = false;
    try { await io.trash(new TFile('Gym/Plans/Ghost.md')); } catch (e) { threw = true; }
    assert.ok(threw, 'trashing a note that is not in the vault must throw, not quietly succeed');

    console.log('delete flow OK (waits for the children array; missing note throws)');
  })().catch(e => { cleanup(); console.error(e); process.exit(1); });
}
