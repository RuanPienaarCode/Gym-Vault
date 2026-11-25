'use strict';
/* AUDIT 25 NOV 2026, finding 31 (Low): Settings were ~25 rows with no
   headings. Accent color sat five rows below Style, sound hid under
   "Count-back", and "Calm motion" read as part of the Calm style although it
   applies to every style.

   What this pins (drives the REAL GymSettingTab against a Setting stub):
     L1  Obsidian's own heading rows, in this order: Look, Workouts, Sound and
         voice, Files.
     L2  Under Look: Style, then Calm colour DIRECTLY under it (only while the
         style is Calm; Ruan has moved it three times, it stays there), then
         Accent color, then the device-only switch, then the motion and visual
         rows.
     L3  Labels renamed, setting keys unchanged: "Calm motion" is "Less motion"
         (still writes quietMotion) and "Count-back" is "Sound and voice"
         (still writes soundMode).
     L4  The Style description is one short line.
     L5  Every row sits under the heading it belongs to. */
const assert = require('node:assert');
const Module = require('node:module');
const { DEFAULT_SETTINGS } = require('../src/constants');

const rows = [];
class Setting {
  constructor() { this.row = { name: '', desc: '', heading: false }; rows.push(this.row); }
  setName(n) { this.row.name = n; return this; }
  setDesc(d) { this.row.desc = d; return this; }
  setHeading() { this.row.heading = true; return this; }
  addText(fn) { fn({ inputEl: { addEventListener() {} }, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
  addDropdown(fn) { const row = this.row; fn({ addOption() { return this; }, setValue() { return this; }, onChange(f) { row.change = f; return this; }, selectEl: { empty() {} } }); return this; }
  addToggle(fn) { const row = this.row; fn({ setValue() { return this; }, setDisabled() { return this; }, onChange(f) { row.change = f; return this; } }); return this; }
  addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, onClick() { return this; } }); return this; }
  addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; }
}
const node = () => ({ empty() {}, createDiv: () => node(), createEl: () => node(), createSpan: () => node(), addClass() {}, setText() {}, appendChild() {}, append() {}, addEventListener() {}, style: {} });
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { Setting, PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = node(); } }, Notice: class {}, setIcon: () => {}, normalizePath: p => p, Platform: { isMobile: false } }
  : origLoad(req, ...rest));
const { GymSettingTab } = require('../src/settings-tab');
Module._load = origLoad;
global.window = global.window || {};

const open = settings => {
  const calls = [];
  const plugin = { settings: Object.assign({}, DEFAULT_SETTINGS, settings), deviceLook: null, async saveSettings() { calls.push(['save']); }, refreshViews() {} };
  plugin.setLook = async (f, v) => { calls.push([f, v]); plugin.settings[f] = v; };
  const tab = new GymSettingTab({}, plugin);
  tab.display = (real => () => { rows.length = 0; return real(); })(tab.display.bind(tab));
  tab.display();
  return { plugin, calls, rows: rows.slice() };
};
/* The rows between heading `h` and the next heading. */
const section = (list, h) => {
  const at = list.findIndex(r => r.heading && r.name === h);
  if (at < 0) return null;
  const out = [];
  for (let i = at + 1; i < list.length && !list[i].heading; i++) out.push(list[i].name);
  return out;
};
const DEVICE = 'Look and feel on this device only';

const failures = [];
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
};

(async () => {
  await test('L1 four headings, Obsidian heading rows, in order', () => {
    const { rows: r } = open({ skin: 'apex' });
    assert.deepStrictEqual(r.filter(x => x.heading).map(x => x.name), ['Look', 'Workouts', 'Sound', 'Files']);
  });
  await test('L2 Look: Style, Accent color, the device switch, then the motion and visual rows', () => {
    const look = section(open({ skin: 'apex' }).rows, 'Look');
    assert.ok(look, 'no Look heading');
    assert.deepStrictEqual(look.slice(0, 3), ['Style', 'Accent color', DEVICE], `Look starts ${look.slice(0, 3).join(', ')}`);
    const i = look.indexOf('Less motion');
    assert.ok(i > 2, 'Less motion is not under Look after the device switch');
    assert.deepStrictEqual(look.slice(i, i + 4), ['Less motion', 'Animate exercise images', 'Exercise visual', 'Muscle map body']);
  });
  await test('L2 Calm colour sits directly under Style, only while Calm is on', () => {
    const calm = section(open({ skin: 'calm' }).rows, 'Look');
    assert.deepStrictEqual(calm.slice(0, 4), ['Style', 'Calm colour', 'Accent color', DEVICE]);
    assert.ok(!section(open({ skin: 'floor' }).rows, 'Look').includes('Calm colour'));
  });
  await test('L3 "Less motion" replaces "Calm motion" and still writes quietMotion', async () => {
    const t = open({ skin: 'apex' });
    assert.ok(!t.rows.some(r => r.name === 'Calm motion'), 'the old label is still there');
    await t.rows.find(r => r.name === 'Less motion').change(true);
    assert.deepStrictEqual(t.calls, [['quietMotion', true]]);
  });
  await test('L3 "Sound and voice" replaces "Count-back" and still writes soundMode', async () => {
    const t = open({ skin: 'apex', soundMode: 'silent' });
    assert.ok(!t.rows.some(r => r.name === 'Count-back'), 'the old label is still there');
    const row = t.rows.find(r => !r.heading && r.name === 'Sound and voice');
    assert.ok(row, 'no Sound and voice row');
    await row.change('beep');
    assert.strictEqual(t.plugin.settings.soundMode, 'beep');
  });
  await test('L4 the Style description is one short line', () => {
    const style = open({ skin: 'apex' }).rows.find(r => r.name === 'Style');
    assert.ok(style.desc.length <= 80, `${style.desc.length} characters: "${style.desc}"`);
  });
  await test('L5 every row is under its heading', () => {
    const r = open({ skin: 'apex', soundMode: 'voice' }).rows;
    const want = {
      Workouts: ['Start opens', 'Week starts on', 'Rest between sets', 'Open on startup'],
      'Sound': ['Sound and voice', 'Music app', 'Playlists'],
      Files: ['Gym folder', 'Use a different Gym folder on this phone', 'Plan library', 'Download images for offline', 'Refresh starter media', 'Starter files'],
      Look: ['Rewards'],
    };
    for (const [h, names] of Object.entries(want)) {
      const got = section(r, h) || [];
      for (const n of names) assert.ok(got.includes(n), `"${n}" is not under ${h} (${got.join(', ')})`);
    }
  });
  if (failures.length) { console.log(`audit-1125 settings layout: ${failures.length} FAILED`); process.exit(1); }
  console.log('audit-1125 settings layout OK');
})();
