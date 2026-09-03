'use strict';
/* A TEXT SETTING IS NOT COMMITTED UNTIL YOU STOP TYPING (issue #21).

   THE BUG THIS REPRODUCES. Setting.addText's onChange fires on every
   KEYSTROKE, and the Gym folder field saved and reloaded the open view on
   each one. Typing "Training" over "Gym" persisted gymFolder as "T", then
   "Tr", then "Tra" — reloading the view against folders that do not exist
   each time — and closing the dialog mid-word left one of those persisted,
   so the next launch opened a gym that was not there.

   The Plan library box had the milder half of it: no reload, but a
   half-typed "https://gith" written to data.json per character.

   There were no settings tests at all. This one drives the real
   GymSettingTab against a stub of Obsidian's Setting/PluginSettingTab, so it
   counts the saves an actual sequence of keystrokes produces. */
const assert = require('node:assert');
const Module = require('node:module');

/* ---- a Setting/PluginSettingTab stub with real listener plumbing ---- */

const inputs = [];
const mkInput = () => {
  const listeners = {};
  return {
    listeners,
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    blur() { (listeners.blur || []).forEach(fn => fn()); },
    fire(ev, e) { (listeners[ev] || []).forEach(fn => fn(e)); },
  };
};

class Setting {
  constructor() { this.name = ''; }
  setName(n) { this.name = n; return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  addText(fn) {
    const inputEl = mkInput();
    const t = {
      inputEl, value: '',
      setValue(v) { this.value = String(v); return this; },
      setPlaceholder() { return this; },
      onChange(f) { this._change = f; return this; },
      /* What a keystroke does: the box's value moves, then onChange fires. */
      type(text) { for (let i = 1; i <= text.length; i++) { this.value = text.slice(0, i); this._change(this.value); } return this; },
    };
    inputs.push({ name: this.name, t });
    fn(t);
    return this;
  }
  addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(fn) { fn({ setValue() { return this; }, setDisabled() { return this; }, onChange() { return this; } }); return this; }
  addButton(fn) { fn({ setButtonText() { return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, onClick() { return this; } }); return this; }
  addExtraButton(fn) { fn({ setIcon() { return this; }, setTooltip() { return this; }, onClick() { return this; } }); return this; }
}

const el = () => {
  const node = {
    empty() {}, createDiv: () => el(), createEl: () => el(), createSpan: () => el(),
    addClass() {}, setText() {}, appendChild() {}, append() {},
    addEventListener() {}, style: {}, textContent: '',
  };
  return node;
};

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? {
    Setting,
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = el(); } },
    Notice: class {}, setIcon: () => {}, normalizePath: p => p, Platform: { isMobile: false },
  }
  : origLoad(req, ...rest));
const { GymSettingTab } = require('../src/settings-tab');
Module._load = origLoad;

global.window = global.window || {};

/* A plugin that RECORDS rather than does. */
function makePlugin() {
  return {
    settings: {
      gymFolder: 'Gym', planRepo: 'https://old.example', weekStart: 'mon',
      skin: 'floor', accent: 'lime', musicApp: 'spotify', musicUrl: '', musicSaved: [],
      countBack: 'off', voice: 'default', guideMinutes: 30,
    },
    saves: 0, reloads: 0,
    async saveSettings() { this.saves++; },
    refreshViews() { this.reloads++; },
    hasGymData: () => true,
    app: { vault: {}, workspace: { getLeavesOfType: () => [] } },
  };
}

const build = () => {
  inputs.length = 0;
  const plugin = makePlugin();
  const tab = new GymSettingTab({ vault: {}, workspace: {} }, plugin);
  tab.display();
  return { plugin, tab };
};

/* The commit handler awaits saveSettings() before refreshViews(), so the
   reload lands on a later microtask. That ordering is correct — the view
   should reload against a SAVED setting — so the test waits for it rather
   than asserting the reload never happens. */
const flush = () => new Promise(r => setImmediate(r));

const field = label => {
  const hit = inputs.find(i => i.name === label);
  assert.ok(hit, `no text field named "${label}" — this guard must be renamed with it`);
  return hit.t;
};

async function main() {

/* ---------- 1. TYPING SAVES NOTHING AND RELOADS NOTHING ---------- */
{
  const { plugin } = build();
  const t = field('Gym folder');

  t.type('Training');
  assert.strictEqual(plugin.saves, 0,
    'eight keystrokes must not be eight saves — "T", "Tr", "Tra" are not folder names anyone meant');
  assert.strictEqual(plugin.reloads, 0,
    'and must not reload the open view against folders that do not exist');
  assert.strictEqual(plugin.settings.gymFolder, 'Gym',
    'the setting must not move until the edit is finished');
}

/* ---------- 2. BLUR COMMITS, ONCE ---------- */
{
  const { plugin } = build();
  const t = field('Gym folder');

  t.type('Training');
  t.inputEl.blur();
  await flush();
  assert.strictEqual(plugin.settings.gymFolder, 'Training', 'the finished name is what lands');
  assert.strictEqual(plugin.saves, 1, 'one save');
  assert.strictEqual(plugin.reloads, 1, 'one reload, on the finished folder name');

  /* Blurring again with nothing typed must not save again. */
  t.inputEl.blur();
  await flush();
  assert.strictEqual(plugin.saves, 1, 'a second blur with no edit is a no-op');
}

/* ---------- 3. ENTER COMMITS TOO ---------- */
{
  const { plugin } = build();
  const t = field('Gym folder');
  t.type('Training');
  t.inputEl.fire('keydown', { key: 'Enter' });
  await flush();
  assert.strictEqual(plugin.settings.gymFolder, 'Training',
    'pressing Enter is finishing the edit — it must not need a click elsewhere as well');
  assert.strictEqual(plugin.saves, 1);

  /* Enter also blurs, and that blur must not double-save. */
  assert.strictEqual(plugin.reloads, 1, 'Enter then its own blur is still one commit');

  /* Any other key is just typing. */
  const other = build();
  const t2 = field('Gym folder');
  t2.type('Tra');
  t2.inputEl.fire('keydown', { key: 'a' });
  await flush();
  assert.strictEqual(other.plugin.saves, 0, 'an ordinary key does not commit');
}

/* ---------- 4. CLOSING THE DIALOG COMMITS WHAT WAS TYPED ---------- */
{
  const { plugin, tab } = build();
  field('Gym folder').type('Training');
  tab.hide();
  await flush();
  assert.strictEqual(plugin.settings.gymFolder, 'Training',
    'typing into a box and closing the dialog is still an edit');
  assert.strictEqual(plugin.saves, 1);
}

/* ---------- 5. AN EMPTY BOX STILL MEANS Gym ---------- */
{
  const { plugin } = build();
  const t = field('Gym folder');
  t.type('   ');
  t.inputEl.blur();
  await flush();
  assert.strictEqual(plugin.settings.gymFolder, 'Gym',
    'blanking the field must fall back, not persist an empty folder name');
}

/* ---------- 6. the Plan library box shares the rule ---------- */
{
  const { plugin } = build();
  const t = field('Plan library');
  t.type('https://github.com/x/y');
  assert.strictEqual(plugin.saves, 0, 'a half-typed URL is not a plan library');
  assert.strictEqual(plugin.settings.planRepo, 'https://old.example');
  t.inputEl.blur();
  await flush();
  assert.strictEqual(plugin.settings.planRepo, 'https://github.com/x/y');
  assert.strictEqual(plugin.saves, 1);
  assert.strictEqual(plugin.reloads, 0,
    'this one never reloaded the view and must not start now');
}

/* ---------- 7. reopening the tab does not stack stale commits ---------- */
{
  const { plugin, tab } = build();
  field('Gym folder').type('Training');
  tab.display();          // reopened; every control is rebuilt
  tab.hide();
  await flush();
  assert.strictEqual(plugin.saves, 0,
    'display() rebuilds the inputs, so commits from the previous pass must not fire against them');
}

}

main().then(
  () => console.log('settings commit OK (typing saves nothing; blur, Enter and closing the dialog each commit once)'),
  e => { console.error(e); process.exit(1); },
);
