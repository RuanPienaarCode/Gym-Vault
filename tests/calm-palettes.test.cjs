'use strict';
/* CALM COLOURS (16 Nov 2026). Settings > Style > Calm, then Calm colour: eight complete palettes
   for the Calm style, each a paper AND its own accent, in light and dark:
   Sage + your accent (the default, what Calm always was), Oat, Sea glass,
   Blush, Lavender, Honey, Sky, and Lagoon, built from the ten colours Ruan
   supplied (lime cream through Yale blue).

   A palette is a Calm-only accent: the app root wears gv-accent-<key> in place
   of the user's accent while the style is Calm, so everything that already
   follows the accent class (modals, the cascade tests) follows the palette.
     P1  the list, and the default that changes nothing
     P2  accentFor: the palette only while the style is Calm
     P3  every palette declares its full light and dark token blocks
     P4  palettes are Calm-only: no rule names one without .gv-skin-calm
     P5  nothing in src/ puts the raw accent on a root (accentFor is the door)
     P6  Lagoon carries all ten supplied colours
     P7  Style lists Calm once; a Calm colour dropdown sits right under it while
         the style is Calm (per device)
   Readability and "never white" for each palette live in contrast.test.cjs,
   light-paper.test.cjs and rc-zone-stages.test.cjs, which iterate them. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CALM_PALETTES, DEFAULT_SETTINGS, ACCENTS, accentFor } = require('../src/constants');
const { cleanLook, LOOK_FIELDS } = require('../src/device-look');

const SRC = path.join(__dirname, '..', 'src');
const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let failed = 0;
const pending = [];
const fail = (name, e) => { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); };
const check = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => console.log('  ok   ' + name), e => fail(name, e)));
    else console.log('  ok   ' + name);
  } catch (e) { fail(name, e); }
};
const KEYS = CALM_PALETTES.map(p => p[0]);
const OWN = KEYS.filter(k => k !== 'accent');
const block = sel => { const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : null; };

check('P1 eight palettes; the default is "your accent" and changes nothing', () => {
  assert.deepStrictEqual(KEYS, ['accent', 'oat', 'sea', 'blush', 'lavender', 'honey', 'sky', 'lagoon']);
  assert.strictEqual(DEFAULT_SETTINGS.calmPalette, 'accent');
  for (const [, label] of CALM_PALETTES) assert.ok(label && label.length > 3);
  for (const k of OWN) assert.ok(!ACCENTS.some(a => a[0] === k), `${k} must not collide with an accent key`);
});

check('P2 accentFor: the palette while the style is Calm, the accent otherwise', () => {
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive', calmPalette: 'sea' }), 'sea');
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive', calmPalette: 'accent' }), 'olive');
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive' }), 'olive');
  assert.strictEqual(accentFor({ skin: 'apex', accent: 'blaze', calmPalette: 'sea' }), 'blaze', 'another style never wears a Calm palette');
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive', calmPalette: 'neon' }), 'olive', 'an unknown palette is ignored');
  assert.strictEqual(accentFor({ skin: 'calm' }), 'lime');
  assert.strictEqual(accentFor(null), 'lime');
});

check('P3 every palette declares its light and dark tokens', () => {
  const LIGHT = ['bg', 'surface', 'line', 'line-2', 'ink', 'ink-dim', 'accent-solid', 'lime', 'lime-hi', 'lime-deep', 'lime-ghost', 'flood-dim'];
  const DARK = ['bg', 'surface', 'line', 'line-2', 'ink', 'ink-dim', 'lime', 'lime-ghost'];
  for (const k of OWN) {
    const l = block(`.gv-app.gv-skin-calm.gv-accent-${k}`), d = block(`.theme-dark .gv-app.gv-skin-calm.gv-accent-${k}`);
    assert.ok(l, `${k}: no light block`); assert.ok(d, `${k}: no dark block`);
    for (const t of LIGHT) assert.ok(new RegExp(`--gv-${t}:\\s*#[0-9a-fA-F]{6}`).test(l), `${k} light: --gv-${t}`);
    for (const t of DARK) assert.ok(new RegExp(`--gv-${t}:\\s*#[0-9a-fA-F]{6}`).test(d), `${k} dark: --gv-${t}`);
  }
});

check('P4 palettes are Calm-only', () => {
  const sels = [...css.matchAll(/([^{}]+)\{/g)].flatMap(m => m[1].split(',')).map(s => s.trim());
  for (const k of OWN) for (const s of sels) if (new RegExp(`gv-accent-${k}\\b`).test(s)) assert.ok(/gv-skin-calm/.test(s), `\`${s}\` names ${k} outside Calm`);
});

check('P5 the raw accent never reaches a root: accentFor is the only door', () => {
  const allowed = new Set(['constants.js', 'settings-tab.js', 'device-look.js', 'main.js']);
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!allowed.has(f)) assert.ok(!/\b(settings|st)\.accent\b/.test(text), `${f} reads the raw accent; use accentFor(settings)`);
  }
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  assert.ok(!/accent:\s*this\.settings\.accent/.test(main), 'main.js hands the rep counter the raw accent');
});

check('P6 Lagoon carries all ten supplied colours', () => {
  const both = (block('.gv-app.gv-skin-calm.gv-accent-lagoon') || '') + (block('.theme-dark .gv-app.gv-skin-calm.gv-accent-lagoon') || '');
  for (const hex of ['#d9ed92', '#b5e48c', '#99d98c', '#76c893', '#52b69a', '#34a0a4', '#168aad', '#1a759f', '#1e6091', '#184e77']) assert.ok(both.toLowerCase().includes(hex), `${hex} is not in Lagoon`);
});

check('P7 Style lists Calm once; a Calm colour dropdown sits right under it, per device', async () => {
  /* 17 Nov 2026 (Ruan): "the calm theme rather add another drop down to select the colour".
     History: a "Calm colours" row far down the tab was missed (16 Nov), then every
     palette was a Style entry (too long a list). Now: Style > Calm, and the
     colour list appears directly below it, only while the style is Calm. */
  const constants = require('../src/constants');
  for (const gone of ['styleChoices', 'styleValue', 'parseStyle']) assert.strictEqual(constants[gone], undefined, `${gone} is the retired one-list design`);
  const Module = require('node:module');
  const rows = [];
  class Setting {
    constructor() { this.row = { name: '', desc: '', options: [], value: undefined, change: null }; rows.push(this.row); }
    setName(n) { this.row.name = n; return this; }
    setDesc(d) { this.row.desc = d; return this; }
    setHeading() { return this; }
    addText(fn) { fn({ inputEl: { addEventListener() {} }, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
    addDropdown(fn) {
      const row = this.row;
      fn({ addOption(v, l) { row.options.push([v, l]); return this; }, setValue(v) { row.value = v; return this; }, onChange(f) { row.change = f; return this; } });
      return this;
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
  const open = settings => {
    const calls = [];
    const plugin = { settings: Object.assign({}, DEFAULT_SETTINGS, settings), saveSettings: async () => {}, refreshViews() {} };
    plugin.setLook = async (field, value) => { calls.push([field, value]); plugin.settings[field] = value; };
    const tab = new GymSettingTab({}, plugin);
    /* every draw starts from an empty row list, as the real tab empties its container */
    const realDisplay = tab.display.bind(tab);
    let redraws = 0;
    tab.display = () => { redraws++; rows.length = 0; return realDisplay(); };
    const draw = () => { tab.display(); return rows.map(r => r.name); };
    return { plugin, calls, draw, row: n => rows.find(r => r.name === n), redraws: () => redraws };
  };

  /* Style: the five styles, Calm once */
  const apex = open({ skin: 'apex', calmPalette: 'lagoon' });
  let names = apex.draw();
  assert.deepStrictEqual(apex.row('Style').options.map(o => o[0]), constants.SKINS.map(s => s[0]));
  assert.strictEqual(apex.row('Style').value, 'apex');
  assert.ok(!names.includes('Calm colour'), 'no Calm colour row while another style is on');

  /* Calm: the colour row is the very next row, lists all eight, shows the current one */
  const calm = open({ skin: 'calm', calmPalette: 'lagoon' });
  names = calm.draw();
  assert.strictEqual(names[names.indexOf('Style') + 1], 'Calm colour', 'the colour list sits directly under Style');
  assert.deepStrictEqual(calm.row('Calm colour').options.map(o => o[0]), KEYS);
  assert.strictEqual(calm.row('Calm colour').value, 'lagoon');
  assert.strictEqual(open({ skin: 'calm' }).draw() && rows.find(r => r.name === 'Calm colour').value, 'accent', 'Sage by default');
  assert.strictEqual(open({ skin: 'calm', calmPalette: 'neon' }).draw() && rows.find(r => r.name === 'Calm colour').value, 'accent', 'an unknown stored palette shows Sage');

  /* picking a colour writes only calmPalette, through setLook (so it is per device) */
  calm.draw();
  await calm.row('Calm colour').change('sea');
  assert.deepStrictEqual(calm.calls, [['calmPalette', 'sea']]);

  /* picking Calm in Style writes only the skin, redraws the tab, and the row appears with the remembered colour */
  apex.draw();
  const before = apex.redraws();
  await apex.row('Style').change('calm');
  assert.deepStrictEqual(apex.calls, [['skin', 'calm']], 'Style never touches the Calm colour');
  assert.ok(apex.redraws() > before, 'the tab redraws so the colour list appears');
  assert.ok(rows.some(r => r.name === 'Calm colour'), 'the colour list is there after picking Calm');
  assert.strictEqual(rows.find(r => r.name === 'Calm colour').value, 'lagoon', 'the colour chosen earlier is kept');
  /* and away again: the row goes */
  await rows.find(r => r.name === 'Style').change('apex');
  assert.ok(!rows.some(r => r.name === 'Calm colour'));

  assert.ok(LOOK_FIELDS.includes('calmPalette'));
  assert.deepStrictEqual(cleanLook({ calmPalette: 'sea' }), { calmPalette: 'sea' });
  assert.strictEqual(cleanLook({ calmPalette: 'neon' }), null);
});

Promise.all(pending).then(() => { if (failed) { console.error(`calm-palettes: ${failed} failed`); process.exit(1); } });
