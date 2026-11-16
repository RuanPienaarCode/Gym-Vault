'use strict';
/* AUDIT 16 NOV 2026, LANE SHELL: the plugin entry and the settings tab
   (main.js, settings-tab.js).

   #28  "Log today's workout" on a vault with no gym called ctx.startLog(null,
        null) behind the "Set up your gym" card: a phantom Freestyle draft that
        Today then showed as "Session in progress" after "Create my gym". With no
        gym yet the command only opens the view.
   #18a "Open the recorder" in Settings called openPage('voice') but the
        settings window stayed on top, so the button looked dead. The settings
        window is closed first, through the untyped app.setting, every hop
        guarded.
   #18b activateView() did not await revealLeaf, and a background Gym tab
        restored at startup is DEFERRED (no view yet), so forEachView skipped it
        and the commands only brought the tab forward. Both branches await
        revealLeaf and, where it exists, leaf.loadIfDeferred().
   #10  a settings change synced from another device was overwritten by this
        device's next save: settings were read once. onExternalSettingsChange
        re-reads data.json through the same load path (per-device look wins and
        stays out of data.json) and refreshes the open views. */
const assert = require('node:assert');
const Module = require('node:module');
require('./f3-stub');

/* ---- the settings tab, with a recording Setting stub (same shape as f5) ---- */
const buttons = [];
class Setting {
  setName() { return this; } setDesc() { return this; } setHeading() { return this; }
  addText() { return this; } addDropdown() { return this; } addToggle() { return this; } addExtraButton() { return this; }
  addButton(fn) {
    const b = { setButtonText(x) { this.label = x; return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, onClick(f) { this._click = f; return this; } };
    fn(b); buttons.push(b); return this;
  }
}
const el = () => ({ empty() {}, createDiv: () => el(), createEl: () => el(), createSpan: () => el(), addClass() {}, setText() {}, appendChild() {}, append() {}, addEventListener() {}, style: {}, textContent: '' });
const origLoad = Module._load;
const settingsTabModule = (() => {
  Module._load = (req, ...rest) => (req === 'obsidian'
    ? { Setting, PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = el(); } }, Notice: class {}, setIcon: () => {}, normalizePath: p => p, Platform: { isMobile: false } }
    : origLoad(req, ...rest));
  try { return require('../src/settings-tab'); } finally { Module._load = origLoad; }
})();
const GymPlugin = require('../src/main');

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const tick = () => new Promise(r => setImmediate(r));

/* A plugin shell good enough to run the real onload() and real methods. */
function makePlugin(extra) {
  const commands = {};
  const p = Object.create(GymPlugin.prototype);
  const store = new Map();
  Object.assign(p, {
    app: Object.assign({
      saveLocalStorage: (k, v) => { if (v) store.set(k, JSON.stringify(v)); else store.delete(k); },
      loadLocalStorage: k => (store.has(k) ? JSON.parse(store.get(k)) : null),
      vault: { getFileByPath: () => null, getFolderByPath: () => null },
      workspace: { onLayoutReady() {}, getLeavesOfType: () => [], getLeaf: () => null, revealLeaf: async () => {} },
    }, (extra && extra.app) || {}),
    manifest: { id: 'gym-app' },
    registerView() {}, addRibbonIcon() {}, addSettingTab() {},
    addCommand(c) { commands[c.id] = c; },
    loadData: async () => ({}),
    saveData: async () => {},
  }, (extra && extra.plugin) || {});
  p._store = store; p._commands = commands;
  return p;
}
/* A leaf whose view is not there until loadIfDeferred() finishes. */
function deferredLeaf(log, ctx) {
  const leaf = {
    view: {},
    async loadIfDeferred() { await tick(); leaf.view = { appCtl: { ctx } }; log.push('loaded'); },
  };
  return leaf;
}

(async () => {
  /* ---------- #28 ---------- */
  await check('28a no gym yet (data.present false): the command opens the view and starts nothing', async () => {
    const started = [];
    const ctx = { data: { present: false, goals: [] }, daysOn: () => [], startLog: (...a) => started.push(a), nav() {} };
    const leaf = { view: { appCtl: { ctx } } };
    const revealed = [];
    const p = makePlugin({ app: { workspace: { onLayoutReady() {}, getLeavesOfType: () => [leaf], revealLeaf: async l => { revealed.push(l); } } } });
    await p.onload();
    await p._commands['log-workout'].callback();
    assert.deepStrictEqual(started, [], 'a phantom Freestyle draft was created behind the Set up your gym card');
    assert.strictEqual(revealed.length, 1, 'the view is still opened');
  });
  await check('28b nothing loaded yet (ctx.data null): the command only opens the view', async () => {
    const started = [];
    const ctx = { data: null, daysOn: () => [], startLog: (...a) => started.push(a), nav() {} };
    const leaf = { view: { appCtl: { ctx } } };
    const p = makePlugin({ app: { workspace: { onLayoutReady() {}, getLeavesOfType: () => [leaf], revealLeaf: async () => {} } } });
    await p.onload();
    await p._commands['log-workout'].callback();
    assert.deepStrictEqual(started, []);
  });
  await check('28c a gym that is there still starts today\'s log', async () => {
    const started = [];
    const ctx = { data: { present: true, goals: [] }, daysOn: () => [], startLog: (...a) => started.push(a), nav() {} };
    const leaf = { view: { appCtl: { ctx } } };
    const p = makePlugin({ app: { workspace: { onLayoutReady() {}, getLeavesOfType: () => [leaf], revealLeaf: async () => {} } } });
    await p.onload();
    await p._commands['log-workout'].callback();
    assert.strictEqual(started.length, 1);
    assert.deepStrictEqual(started[0], [null, null], 'nothing scheduled today: a plain freestyle log');
  });

  /* ---------- #18b ---------- */
  await check('18b a deferred background tab is loaded before the command acts on its view', async () => {
    const log = [];
    const started = [];
    const ctx = { data: { present: true, goals: [] }, daysOn: () => [], startLog: (...a) => started.push(a), nav() {} };
    const leaf = deferredLeaf(log, ctx);
    const p = makePlugin({ app: { workspace: { onLayoutReady() {}, getLeavesOfType: () => [leaf], revealLeaf: async () => { await tick(); log.push('revealed'); } } } });
    await p.onload();
    await p._commands['log-workout'].callback();
    assert.strictEqual(started.length, 1, 'the deferred tab was skipped: the command only brought it forward');
    assert.ok(log.includes('revealed') && log.includes('loaded'));
  });
  await check('18b "Record your own count-in" reaches a deferred tab too', async () => {
    const log = [];
    const navs = [];
    const ctx = { data: { present: true, goals: [] }, nav: (...a) => navs.push(a) };
    const leaf = deferredLeaf(log, ctx);
    const p = makePlugin({ app: { workspace: { onLayoutReady() {}, getLeavesOfType: () => [leaf], revealLeaf: async () => {} } } });
    await p.onload();
    await p._commands['record-voice'].callback();
    await tick();
    assert.deepStrictEqual(navs, [['voice', undefined]]);
  });
  await check('18b activateView awaits revealLeaf in the existing-leaf branch', async () => {
    const log = [];
    const leaf = { view: {} };
    const p = makePlugin({ app: { workspace: { getLeavesOfType: () => [leaf], revealLeaf: async () => { await tick(); log.push('revealed'); } } } });
    await p.activateView();
    assert.deepStrictEqual(log, ['revealed'], 'activateView returned before the leaf was revealed');
  });
  await check('18b activateView awaits revealLeaf in the new-leaf branch', async () => {
    const log = [];
    const leaf = { view: {}, async setViewState() { await tick(); log.push('state'); } };
    const p = makePlugin({ app: { workspace: { getLeavesOfType: () => [], getLeaf: () => leaf, revealLeaf: async () => { await tick(); log.push('revealed'); } } } });
    await p.activateView();
    assert.deepStrictEqual(log, ['state', 'revealed']);
  });
  await check('18b a host without loadIfDeferred (or one that throws) does not break activateView', async () => {
    const leaf = { view: {} };
    const p = makePlugin({ app: { workspace: { getLeavesOfType: () => [leaf], revealLeaf: async () => {} } } });
    await p.activateView();
    const bad = { view: {}, async loadIfDeferred() { throw new Error('boom'); } };
    const q = makePlugin({ app: { workspace: { getLeavesOfType: () => [bad], revealLeaf: async () => {} } } });
    const err = console.error; console.error = () => {};
    try { await q.activateView(); } finally { console.error = err; }
  });

  /* ---------- #18a ---------- */
  const recorderButton = async app => {
    buttons.length = 0;
    const calls = [];
    const plugin = {
      settings: { soundMode: 'custom' }, saveSettings: async () => {}, refreshViews() {},
      openPage: page => { calls.push(['openPage', page]); return Promise.resolve(); },
    };
    const tab = new settingsTabModule.GymSettingTab(app(calls), plugin);
    tab.renderSound(el());
    const b = buttons.find(x => /recorder|recording/i.test(x.label || ''));
    assert.ok(b, 'the recorder button is rendered in custom mode');
    await b._click();
    return calls;
  };
  await check('18a "Open the recorder" closes the settings window first, then opens the page', async () => {
    const calls = await recorderButton(c => ({ setting: { close: () => c.push(['close']) } }));
    assert.deepStrictEqual(calls, [['close'], ['openPage', 'voice']], 'the settings window stayed on top of the recorder');
  });
  await check('18a a host without app.setting.close (or one that throws) still opens the page', async () => {
    assert.deepStrictEqual(await recorderButton(() => ({})), [['openPage', 'voice']]);
    assert.deepStrictEqual(await recorderButton(() => ({ setting: {} })), [['openPage', 'voice']]);
    const err = console.error; console.error = () => {};
    try {
      assert.deepStrictEqual(await recorderButton(c => ({ setting: { close() { c.push(['close']); throw new Error('host'); } } })), [['close'], ['openPage', 'voice']]);
    } finally { console.error = err; }
  });

  /* ---------- #10 ---------- */
  await check('10a onExternalSettingsChange re-reads data.json and refreshes the views', async () => {
    let disk = { gymFolder: 'Gym', weekStart: 'mon', skin: 'apex', accent: 'lime' };
    let refreshed = 0;
    const p = makePlugin({ plugin: { loadData: async () => Object.assign({}, disk), refreshViews() { refreshed++; } } });
    await p.loadSettings();
    assert.strictEqual(p.settings.weekStart, 'mon');
    disk = { gymFolder: 'Training', weekStart: 'sat', skin: 'apex', accent: 'lime' };
    assert.strictEqual(typeof p.onExternalSettingsChange, 'function', 'the plugin never hears about a synced settings change');
    await p.onExternalSettingsChange();
    assert.strictEqual(p.settings.weekStart, 'sat');
    assert.strictEqual(p.settings.gymFolder, 'Training');
    assert.strictEqual(refreshed, 1, 'open views must refresh');
  });
  await check('10b per-device look still wins on this device and stays out of data.json', async () => {
    let disk = { gymFolder: 'Gym', skin: 'apex', accent: 'lime', rewards: true };
    const saved = [];
    const p = makePlugin({ plugin: { loadData: async () => Object.assign({}, disk), saveData: async d => { saved.push(d); }, refreshViews() {} } });
    p._store.set('gym-app-device-look', JSON.stringify({ skin: 'floor', rewards: false }));
    await p.loadSettings();
    assert.strictEqual(p.settings.skin, 'floor');
    disk = { gymFolder: 'Training', skin: 'lockin', accent: 'blue', rewards: true };
    await p.onExternalSettingsChange();
    assert.strictEqual(p.settings.skin, 'floor', 'this device\'s own Style must still win');
    assert.strictEqual(p.settings.rewards, false, 'this device\'s own Rewards choice must still win');
    assert.strictEqual(p.settings.accent, 'blue', 'a shared field not chosen per device follows the sync');
    assert.strictEqual(p.settings.gymFolder, 'Training');
    assert.strictEqual(p._sharedLook.skin, 'lockin', '_sharedLook must be refreshed to what data.json now holds');
    await p.saveSettings();
    const out = saved[saved.length - 1];
    assert.strictEqual(out.skin, 'lockin', 'the shared Style is what is written back, not this device\'s');
    assert.strictEqual(out.rewards, true, 'this device\'s Rewards choice must not leak into data.json');
    assert.strictEqual(out.gymFolder, 'Training', 'the synced change must survive this device\'s next save');
  });
  await check('10c a failed read keeps the settings this device has', async () => {
    const p = makePlugin({ plugin: { loadData: async () => ({ gymFolder: 'Gym', weekStart: 'mon' }), refreshViews() {} } });
    await p.loadSettings();
    p.loadData = async () => { throw new Error('disk'); };
    const err = console.error; console.error = () => {};
    try { await p.onExternalSettingsChange(); } finally { console.error = err; }
    assert.strictEqual(p.settings.weekStart, 'mon');
  });

  let failed = 0;
  for (const [name, e] of results) {
    if (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e && e.message).split('\n')[0]); }
    else console.log('  ok   ' + name);
  }
  if (failed) { console.error(`audit-1116-shell-host: ${failed} failed`); process.exit(1); }
  console.log('audit-1116-shell-host OK');
})();
