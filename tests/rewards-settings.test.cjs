'use strict';
/* THE REWARDS SWITCH (Settings > "Rewards").
     S1  the row exists, says what it covers, and shows the setting's real state (default ON)
     S2  it shows OFF for rewards:false and for the string 'false' (the engine's own reading)
     S3  flipping it writes settings.rewards, saves, and refreshes the open views (Today redraws without a restart)
     S4  rewards is ON in DEFAULT_SETTINGS */
const assert = require('node:assert');
const Module = require('node:module');

const rows = [];
class Setting {
  constructor() { this.row = { name: '', desc: '', toggle: null }; rows.push(this.row); }
  setName(n) { this.row.name = n; return this; }
  setDesc(d) { this.row.desc = d; return this; }
  setHeading() { return this; }
  addText(fn) { fn({ inputEl: { addEventListener() {} }, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
  addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(fn) {
    const t = { value: null, setValue(v) { this.value = v; return this; }, onChange(f) { this.change = f; return this; }, setDisabled() { return this; } };
    fn(t); this.row.toggle = t; return this;
  }
  addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, onClick() { return this; } }); return this; }
  addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; }
}
const el = () => ({ empty() {}, createDiv: () => el(), createEl: () => el(), createSpan: () => el(), addClass() {}, setText() {}, appendChild() {}, append() {}, addEventListener() {}, style: {}, textContent: '' });
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { Setting, PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = el(); } }, Notice: class {}, setIcon: () => {}, normalizePath: p => p, Platform: { isMobile: false } }
  : origLoad(req, ...rest));
const { GymSettingTab } = require('../src/settings-tab');
Module._load = origLoad;
global.window = global.window || {};
const { DEFAULT_SETTINGS } = require('../src/constants');

const show = settings => {
  rows.length = 0;
  const log = { saved: 0, refreshed: 0 };
  const plugin = { settings: Object.assign({}, DEFAULT_SETTINGS, settings), saveSettings: async () => { log.saved++; }, refreshViews: () => { log.refreshed++; } };
  const tab = new GymSettingTab({}, plugin);
  tab.display();
  return { row: rows.find(r => r.name === 'Rewards'), plugin, log };
};

(async () => {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const a = show({});
  ok(a.row, 'S1 a "Rewards" row');
  ok(/XP, levels, a weekly quest and medals/.test(a.row.desc) && /Gym\/Rewards\.md/.test(a.row.desc) && /nothing is awarded, shown or written/.test(a.row.desc), `S1 says what it covers: ${a.row.desc}`);
  ok(a.row.toggle && a.row.toggle.value === true, 'S1 ON by default');
  ok(show({ rewards: false }).row.toggle.value === false, 'S2 OFF for false');
  ok(show({ rewards: 'false' }).row.toggle.value === false, "S2 OFF for 'false'");
  await a.row.toggle.change(false);
  ok(a.plugin.settings.rewards === false && a.log.saved === 1 && a.log.refreshed === 1, 'S3 off: written, saved, views refreshed');
  await a.row.toggle.change(true);
  ok(a.plugin.settings.rewards === true && a.log.saved === 2 && a.log.refreshed === 2, 'S3 on again');
  ok(DEFAULT_SETTINGS.rewards === true, 'S4 default ON');
  console.log(`rewards settings OK (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
