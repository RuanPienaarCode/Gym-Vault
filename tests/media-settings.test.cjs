'use strict';
/* THE ANIMATE-IMAGES SWITCH (Settings > "Animate exercise images").
     M1  the row exists, says what it does, and shows the setting's real state (default ON, missing key ON)
     M2  it shows OFF for animateMedia:false and for the string 'false'
     M3  flipping it writes settings.animateMedia, saves, and refreshes the open views
     M4  animateMedia is ON in DEFAULT_SETTINGS */
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
  new GymSettingTab({}, plugin).display();
  return { row: rows.find(r => r.name === 'Animate exercise images'), plugin, log };
};

(async () => {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const a = show({});
  ok(a.row, 'M1 an "Animate exercise images" row');
  ok(/start\/finish frames as an animation/.test(a.row.desc) && /still step through them/.test(a.row.desc), `M1 says what it does: ${a.row.desc}`);
  ok(a.row.toggle && a.row.toggle.value === true, 'M1 ON by default');
  const missing = show({}); delete missing.plugin.settings.animateMedia;
  rows.length = 0; new GymSettingTab({}, missing.plugin).display();
  ok(rows.find(r => r.name === 'Animate exercise images').toggle.value === true, 'M1 a missing key reads ON');
  ok(show({ animateMedia: false }).row.toggle.value === false, 'M2 OFF for false');
  ok(show({ animateMedia: 'false' }).row.toggle.value === false, "M2 OFF for 'false'");
  await a.row.toggle.change(false);
  ok(a.plugin.settings.animateMedia === false && a.log.saved === 1 && a.log.refreshed === 1, 'M3 off: written, saved, views refreshed');
  await a.row.toggle.change(true);
  ok(a.plugin.settings.animateMedia === true && a.log.saved === 2 && a.log.refreshed === 2, 'M3 on again');
  ok(DEFAULT_SETTINGS.animateMedia === true, 'M4 default ON');
  console.log(`media settings OK (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
