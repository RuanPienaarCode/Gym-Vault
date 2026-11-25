'use strict';
/* AUDIT 25 NOV 2026, finding 20 (High): two people, one vault, one data.json.
   Only the look was kept per phone, so both phones read and wrote ONE Gym
   folder: one set of plans, workouts, records, body log and photos.

   The fix: the Gym folder may be chosen PER PHONE, kept in Obsidian's local
   storage on the device (never synced), the same mechanism as the device look.

   What this pins:
     F1  THE OVERLAY: a stored device folder becomes plugin.settings.gymFolder at
         load, so every reader (data.js, controller.js, main.js) just works.
     F2  IT NEVER REACHES data.json: saving writes the SHARED folder back, so the
         other phone is never moved onto this phone's folder.
     F3  A SYNCED data.json FROM THE OTHER PHONE does not knock this phone off its
         own folder (onExternalSettingsChange), and the next save carries the
         other phone's shared folder, not a stale one.
     F4  JUNK FALLS BACK: an empty, root, hidden or dotted path is no folder, and
         the phone follows the shared one.
     F5  Switching it on/off and changing it reloads the views; off restores the
         shared folder; editing the shared row while on changes only data.json.
     F6  The device look behaves exactly as before alongside it.
     F7  Settings: the switch sits directly under "Gym folder" with the agreed
         wording; its folder box appears only while on and commits on blur. */
const assert = require('node:assert');
const Module = require('node:module');
require('./f3-stub');

const look = require('../src/device-look');

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const tick = () => new Promise(r => setImmediate(r));

/* ---- the plugin, real methods on a host shell (same shape as audit-1116-shell-host) ---- */
const GymPlugin = require('../src/main');
function makePlugin(disk, preset) {
  const p = Object.create(GymPlugin.prototype);
  const store = new Map();
  if (preset) for (const [k, v] of Object.entries(preset)) store.set(k, JSON.stringify(v));
  const saved = [];
  let refreshed = 0;
  Object.assign(p, {
    app: {
      saveLocalStorage: (k, v) => { if (v !== null && v !== undefined) store.set(k, JSON.stringify(v)); else store.delete(k); },
      loadLocalStorage: k => (store.has(k) ? JSON.parse(store.get(k)) : null),
      vault: { getFileByPath: () => null, getFolderByPath: () => null },
      workspace: { onLayoutReady() {}, getLeavesOfType: () => [] },
    },
    manifest: { id: 'gym-app' },
    loadData: async () => Object.assign({}, disk.data),
    saveData: async d => { saved.push(Object.assign({}, d)); disk.data = Object.assign({}, d); },
    refreshViews() { refreshed++; },
  });
  p._t = { store, saved, refreshed: () => refreshed };
  return p;
}

(async () => {
  /* ---------- the pure helpers ---------- */
  await check('F4 cleanFolder keeps a real folder, normalised', () => {
    assert.strictEqual(typeof look.cleanFolder, 'function', 'device-look has no cleanFolder');
    assert.strictEqual(look.cleanFolder('Gym Anna'), 'Gym Anna');
    assert.strictEqual(look.cleanFolder('  /Gym Anna/  '), 'Gym Anna', 'leading/trailing slashes and spaces go');
    assert.strictEqual(look.cleanFolder('Training//Anna\\Gym'), 'Training/Anna/Gym', 'doubled and back slashes collapse');
  });
  await check('F4 cleanFolder refuses the vault root, junk, hidden and dotted paths', () => {
    for (const bad of ['', '   ', '/', '//', null, undefined, 42, {}, ['Gym'], '.', '..', '../Gym', 'Gym/../x', 'Gym/./x', '.obsidian', 'Gym/.trash']) {
      assert.strictEqual(look.cleanFolder(bad), null, `${JSON.stringify(bad)} must not be a folder`);
    }
  });
  await check('F1 applyFolder overlays the device folder, never mutating its input', () => {
    const shared = { gymFolder: 'Gym', skin: 'apex' };
    const s = look.applyFolder(shared, 'Gym Anna');
    assert.strictEqual(s.gymFolder, 'Gym Anna');
    assert.strictEqual(s.skin, 'apex');
    assert.strictEqual(shared.gymFolder, 'Gym', 'input mutated');
    assert.deepStrictEqual(look.applyFolder(shared, null), shared);
  });
  await check('F2 sharedForSave never leaks the device folder', () => {
    const effective = { gymFolder: 'Gym Anna', skin: 'calm', weekStart: 'sat' };
    const out = look.sharedForSave(effective, { gymFolder: 'Gym', skin: 'apex' }, { skin: 'calm' }, 'Gym Anna');
    assert.strictEqual(out.gymFolder, 'Gym', 'the device folder reached data.json');
    assert.strictEqual(out.skin, 'apex', 'the device look reached data.json');
    assert.strictEqual(out.weekStart, 'sat', 'a shared setting must still save');
    const plain = look.sharedForSave({ gymFolder: 'Training' }, { gymFolder: 'Gym' }, null, null);
    assert.strictEqual(plain.gymFolder, 'Training', 'without a device folder the shown folder IS the shared one');
  });
  await check('F1 the folder store round-trips through local storage, and junk reads as none', () => {
    assert.strictEqual(typeof look.makeFolderStore, 'function', 'device-look has no makeFolderStore');
    const mem = {};
    const app = { saveLocalStorage: (k, v) => { if (v == null) delete mem[k]; else mem[k] = v; }, loadLocalStorage: k => (k in mem ? mem[k] : null) };
    const s = look.makeFolderStore(app);
    assert.strictEqual(s.read(), null);
    s.write('Gym Anna');
    assert.ok(look.FOLDER_KEY in mem && look.FOLDER_KEY !== look.LOOK_KEY, 'its own key, not the look record');
    assert.strictEqual(s.read(), 'Gym Anna');
    mem[look.FOLDER_KEY] = '/';
    assert.strictEqual(s.read(), null, 'a stored root is no folder');
    s.write(null);
    assert.ok(!(look.FOLDER_KEY in mem));
  });
  await check('F1 no host storage: the window fallback is scoped by vault', () => {
    const mem = {};
    const prev = global.window;
    global.window = { localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } } };
    try {
      const a = look.makeFolderStore({ appId: 'vault-a' });
      const b = look.makeFolderStore({ appId: 'vault-b' });
      a.write('Gym Anna');
      assert.strictEqual(a.read(), 'Gym Anna');
      assert.strictEqual(b.read(), null);
    } finally { global.window = prev; }
  });

  /* ---------- the plugin ---------- */
  await check('F1 load: a stored device folder is the folder this phone uses', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: 'Gym Anna' });
    await p.loadSettings();
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna');
    assert.strictEqual(p.deviceFolder, 'Gym Anna');
    assert.strictEqual(p.sharedGymFolder(), 'Gym');
  });
  await check('F2 save: data.json keeps the shared folder', async () => {
    const disk = { data: { gymFolder: 'Gym', weekStart: 'mon' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: 'Gym Anna' });
    await p.loadSettings();
    p.settings.weekStart = 'sat';
    await p.saveSettings();
    assert.strictEqual(disk.data.gymFolder, 'Gym', 'this phone pushed its own folder to the other phone');
    assert.strictEqual(disk.data.weekStart, 'sat');
  });
  await check('F3 a synced data.json keeps this phone on its own folder', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: 'Gym Anna' });
    await p.loadSettings();
    disk.data = { gymFolder: 'Training', weekStart: 'sat' };   // the other phone renamed the shared folder
    await p.onExternalSettingsChange();
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna', 'knocked off its own folder');
    assert.strictEqual(p.settings.weekStart, 'sat');
    await p.saveSettings();
    assert.strictEqual(disk.data.gymFolder, 'Training', 'the next save wrote a stale shared folder over the other phone');
  });
  await check('F4 a junk stored folder falls back to the shared one', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: '../elsewhere' });
    await p.loadSettings();
    assert.strictEqual(p.settings.gymFolder, 'Gym');
    assert.strictEqual(p.deviceFolder, null);
  });
  await check('F5 choosing a folder: used at once, reloads, kept out of data.json', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk);
    await p.loadSettings();
    assert.strictEqual(p.setDeviceFolder('/Gym Anna/'), true);
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna');
    assert.strictEqual(JSON.parse(p._t.store.get(look.FOLDER_KEY)), 'Gym Anna', 'not stored on the device');
    assert.strictEqual(p._t.refreshed(), 1, 'the views must reload on the new folder');
    await p.saveSettings();
    assert.strictEqual(disk.data.gymFolder, 'Gym');
    assert.strictEqual(p.setDeviceFolder('/'), false, 'the vault root is refused');
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna', 'a refused value changes nothing');
    assert.strictEqual(p._t.refreshed(), 1);
  });
  await check('F5 switching off: back to the shared folder, store cleared, reloads', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: 'Gym Anna' });
    await p.loadSettings();
    p.setDeviceFolder(null);
    assert.strictEqual(p.settings.gymFolder, 'Gym');
    assert.strictEqual(p.deviceFolder, null);
    assert.ok(!p._t.store.has(look.FOLDER_KEY));
    assert.strictEqual(p._t.refreshed(), 1);
  });
  await check('F5 editing the shared folder while this phone has its own changes only data.json', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: 'Gym Anna' });
    await p.loadSettings();
    await p.setSharedFolder('Training');
    assert.strictEqual(disk.data.gymFolder, 'Training');
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna');
    p.setDeviceFolder(null);
    assert.strictEqual(p.settings.gymFolder, 'Training', 'off must land on the shared folder as it is now');
  });
  await check('F5 a shared folder changed while following it is the one switching off returns to', async () => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk);
    await p.loadSettings();
    p.settings.gymFolder = 'Training';          // the shared row's plain path
    await p.saveSettings();
    p.setDeviceFolder('Gym Anna');
    p.setDeviceFolder(null);
    assert.strictEqual(p.settings.gymFolder, 'Training');
  });
  await check('F6 the device look is unchanged beside a device folder', async () => {
    const disk = { data: { gymFolder: 'Gym', skin: 'apex', accent: 'lime' } };
    const p = makePlugin(disk, { [look.FOLDER_KEY]: 'Gym Anna', [look.LOOK_KEY]: { skin: 'calm', accent: 'olive' } });
    await p.loadSettings();
    assert.strictEqual(p.settings.skin, 'calm');
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna');
    await p.setLook('accent', 'blaze');
    assert.strictEqual(p.settings.accent, 'blaze');
    await p.saveSettings();
    assert.deepStrictEqual([disk.data.skin, disk.data.accent, disk.data.gymFolder], ['apex', 'lime', 'Gym']);
    p.setDeviceLook(false);
    assert.strictEqual(p.settings.skin, 'apex');
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna', 'turning the device look off moved the folder');
  });

  /* ---------- the settings tab ---------- */
  const rows = [];
  const notices = [];
  const mkInput = () => {
    const ls = {};
    return { ls, addEventListener(ev, fn) { (ls[ev] || (ls[ev] = [])).push(fn); }, blur() { (ls.blur || []).forEach(f => f()); }, fire(ev, e) { (ls[ev] || []).forEach(f => f(e)); } };
  };
  class Setting {
    constructor() { this.row = { name: '', desc: '', heading: false }; rows.push(this.row); }
    setName(n) { this.row.name = n; return this; }
    setDesc(d) { this.row.desc = d; return this; }
    setHeading() { this.row.heading = true; return this; }
    addText(fn) {
      const row = this.row;
      const t = { inputEl: mkInput(), value: '', setValue(v) { this.value = String(v); return this; }, setPlaceholder() { return this; },
        onChange(f) { this._c = f; return this; }, type(s) { this.value = s; this._c(s); return this; } };
      row.text = t; fn(t); return this;
    }
    addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; }, selectEl: { empty() {} } }); return this; }
    addToggle(fn) { const row = this.row; const t = { setValue(v) { row.on = v; return this; }, setDisabled() { return this; }, onChange(f) { row.toggle = f; return this; } }; fn(t); return this; }
    addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, onClick() { return this; } }); return this; }
    addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; }
  }
  const node = () => ({ empty() {}, createDiv: () => node(), createEl: () => node(), createSpan: () => node(), addClass() {}, setText() {}, appendChild() {}, append() {}, addEventListener() {}, style: {} });
  const origLoad = Module._load;
  Module._load = (req, ...rest) => (req === 'obsidian'
    ? { Setting, PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = node(); } },
      Notice: class { constructor(m) { notices.push(m); } }, setIcon: () => {}, normalizePath: p => p, Platform: { isMobile: false } }
    : origLoad(req, ...rest));
  let GymSettingTab;
  try {
    for (const k of Object.keys(require.cache)) if (/src[\\/]settings-tab\.js$/.test(k)) delete require.cache[k];
    GymSettingTab = require('../src/settings-tab').GymSettingTab;
  } finally { Module._load = origLoad; }

  const SWITCH = 'Use a different Gym folder on this phone';
  const BOX = "This phone's Gym folder";
  const openTab = async preset => {
    const disk = { data: { gymFolder: 'Gym' } };
    const p = makePlugin(disk, preset);
    await p.loadSettings();
    const tab = new GymSettingTab(p.app, p);
    const draw = () => { rows.length = 0; tab.display(); return rows; };
    draw();
    return { p, tab, disk, draw, row: n => rows.find(r => r.name === n) };
  };

  await check('F7 the switch sits directly under Gym folder, with the agreed wording', async () => {
    const { draw } = await openTab();
    const names = draw().map(r => r.name);
    const at = names.indexOf('Gym folder');
    assert.ok(at >= 0, 'no Gym folder row');
    assert.strictEqual(names[at + 1], SWITCH, `the row under Gym folder is "${names[at + 1]}"`);
    assert.strictEqual(rows[at + 1].desc, 'For two people sharing one vault. This phone keeps its own plans, workouts and records in the folder below. Other devices are not changed.');
    assert.strictEqual(rows[at + 1].on, false);
    assert.ok(!names.includes(BOX), 'the folder box shows only while the switch is on');
  });
  await check('F7 switching on starts from the current folder and shows the box; off follows the shared folder', async () => {
    const { p, row, draw } = await openTab();
    row(SWITCH).toggle(true);
    assert.strictEqual(p.deviceFolder, 'Gym', 'on keeps the folder this phone shows now');
    draw();
    assert.ok(row(BOX), 'the folder box did not appear');
    assert.strictEqual(row(BOX).text.value, 'Gym');
    row(SWITCH).toggle(false);
    assert.strictEqual(p.deviceFolder, null);
    draw();
    assert.ok(!row(BOX));
  });
  await check('F7 the phone folder box commits on blur, once, and refuses the vault root', async () => {
    const { p, row } = await openTab({ [look.FOLDER_KEY]: 'Gym' });
    const t = row(BOX).text;
    t.type('Gym An');
    assert.strictEqual(p.settings.gymFolder, 'Gym', 'a keystroke must not move the folder');
    t.type('Gym Anna');
    t.inputEl.blur();
    await tick();
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna');
    assert.strictEqual(p._t.refreshed(), 1);
    t.inputEl.blur();
    await tick();
    assert.strictEqual(p._t.refreshed(), 1, 'a second blur is a no-op');
    t.type('/');
    t.inputEl.blur();
    await tick();
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna', 'the vault root was accepted');
    assert.ok(notices.some(m => /folder/i.test(m)), 'a refused folder must say so');
  });
  await check('F7 while on, the shared row shows and edits the shared folder only', async () => {
    const { p, row, disk } = await openTab({ [look.FOLDER_KEY]: 'Gym Anna' });
    const t = row('Gym folder').text;
    assert.strictEqual(t.value, 'Gym', 'the shared row must show the shared folder, not this phone\'s');
    t.type('Training');
    t.inputEl.blur();
    await tick(); await tick();
    assert.strictEqual(disk.data.gymFolder, 'Training');
    assert.strictEqual(p.settings.gymFolder, 'Gym Anna');
  });

  let failed = 0;
  for (const [name, e] of results) {
    if (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); } else console.log(`  ok   ${name}`);
  }
  if (failed) { console.log(`audit-1125 settings device folder: ${failed} FAILED`); process.exit(1); }
  console.log('audit-1125 settings device folder OK');
})();
