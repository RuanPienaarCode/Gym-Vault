'use strict';
/* THE MUSCLE MAP'S TWO SETTINGS (Settings > "Exercise visual" and "Muscle map body").
     S1  both rows exist, offer exactly Basic / Detailed and Male / Female, and show the
         setting's real state (defaults basic + male)
     S2  an old settings file with neither key shows the defaults; a hand-edited garbage
         value shows the default too, and never throws
     S3  changing a row writes the flat key, saves once, and refreshes the open views
     S4  the row sits with the other media rows (after "Animate exercise images"), so the
         visual's settings are found together
     S5  the on-visual switch (rememberDetail) and this row are ONE setting: a change made
         on the visual is what the row shows next time the tab opens */
const assert = require('node:assert');
const Module = require('node:module');

const rows = [];
class Setting {
  constructor() { this.row = { name: '', desc: '', dropdown: null }; rows.push(this.row); }
  setName(n) { this.row.name = n; return this; }
  setDesc(d) { this.row.desc = d; return this; }
  setHeading() { return this; }
  addText(fn) { fn({ inputEl: { addEventListener() {} }, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
  addDropdown(fn) {
    const d = { options: [], value: null, addOption(k, l) { this.options.push([k, l]); return this; }, setValue(v) { this.value = v; return this; }, onChange(f) { this.change = f; return this; } };
    fn(d); this.row.dropdown = d; return this;
  }
  addToggle(fn) { fn({ setValue() { return this; }, onChange() { return this; }, setDisabled() { return this; } }); return this; }
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
const { rememberDetail, visualPrefs } = require('../src/motion-library');

const show = settings => {
  rows.length = 0;
  const log = { saved: 0, refreshed: 0 };
  const plugin = { settings: Object.assign({}, DEFAULT_SETTINGS, settings), saveSettings: async () => { log.saved++; }, refreshViews: () => { log.refreshed++; } };
  new GymSettingTab({}, plugin).display();
  return { visual: rows.find(r => r.name === 'Exercise visual'), body: rows.find(r => r.name === 'Muscle map body'), plugin, log };
};

(async () => {
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; };
  const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

  const a = show({});
  ok(a.visual && a.body, 'S1 both rows exist');
  eq(a.visual.dropdown.options, [['basic', 'Basic'], ['detailed', 'Detailed']], 'S1 Basic / Detailed');
  eq(a.body.dropdown.options, [['male', 'Male'], ['female', 'Female']], 'S1 Male / Female');
  eq([a.visual.dropdown.value, a.body.dropdown.value], ['basic', 'male'], 'S1 defaults basic + male');
  ok(/Detailed adds their names, the load and the steps/.test(a.visual.desc) && /switch on the map itself/.test(a.visual.desc), `S1 says what it does: ${a.visual.desc}`);
  eq([DEFAULT_SETTINGS.exerciseVisual, DEFAULT_SETTINGS.exerciseBody], ['basic', 'male'], 'S1 DEFAULT_SETTINGS');

  /* S2: a settings file written before this feature, and a corrupt one */
  const legacy = show({}); delete legacy.plugin.settings.exerciseVisual; delete legacy.plugin.settings.exerciseBody;
  rows.length = 0; new GymSettingTab({}, legacy.plugin).display();
  const lv = rows.find(r => r.name === 'Exercise visual'), lb = rows.find(r => r.name === 'Muscle map body');
  eq([lv.dropdown.value, lb.dropdown.value], ['basic', 'male'], 'S2 an old settings file shows the defaults');
  const junk = show({ exerciseVisual: 'LOUD', exerciseBody: 7 });
  eq([junk.visual.dropdown.value, junk.body.dropdown.value], ['basic', 'male'], 'S2 garbage shows the defaults');
  const set = show({ exerciseVisual: 'detailed', exerciseBody: 'female' });
  eq([set.visual.dropdown.value, set.body.dropdown.value], ['detailed', 'female'], 'S2 saved values are shown');

  /* S3 */
  await a.visual.dropdown.change('detailed');
  ok(a.plugin.settings.exerciseVisual === 'detailed' && a.log.saved === 1 && a.log.refreshed === 1, 'S3 visual: written, saved once, views refreshed');
  await a.body.dropdown.change('female');
  ok(a.plugin.settings.exerciseBody === 'female' && a.log.saved === 2 && a.log.refreshed === 2, 'S3 body: written, saved once, views refreshed');

  /* S4 */
  const names = (() => { rows.length = 0; new GymSettingTab({}, { settings: Object.assign({}, DEFAULT_SETTINGS), saveSettings: async () => {}, refreshViews() {} }).display(); return rows.map(r => r.name); })();
  const i = names.indexOf('Animate exercise images');
  eq(names.slice(i + 1, i + 3), ['Exercise visual', 'Muscle map body'], 'S4 next to the other media setting');

  /* S5: one setting, two ways to change it */
  const ctx = { settings: Object.assign({}, DEFAULT_SETTINGS), plugin: { saveSettings: async () => { ctx.saved = (ctx.saved || 0) + 1; } } };
  rememberDetail(ctx, 'detailed');
  eq(visualPrefs(ctx.settings).detail, 'detailed', 'S5 the on-visual switch writes the setting the row reads');
  const after = (() => { rows.length = 0; new GymSettingTab({}, { settings: ctx.settings, saveSettings: async () => {}, refreshViews() {} }).display(); return rows.find(r => r.name === 'Exercise visual').dropdown.value; })();
  eq(after, 'detailed', 'S5 and the row shows it when the tab next opens');
  rememberDetail(ctx, 'nonsense');
  eq(ctx.settings.exerciseVisual, 'basic', 'S5 a bad value never gets saved');
  /* a failing save must never throw out of a tap on the visual */
  const failing = { settings: Object.assign({}, DEFAULT_SETTINGS), plugin: { saveSettings: async () => { throw new Error('disk full'); } } };
  const realErr = console.error; console.error = () => {};
  try { rememberDetail(failing, 'detailed'); await new Promise(r => setImmediate(r)); } finally { console.error = realErr; }
  eq(failing.settings.exerciseVisual, 'detailed', 'S5 a failed save leaves the choice in place for this session');
  console.log(`muscle map settings OK (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
