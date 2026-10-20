'use strict';
/* L6-03: the README says the Spotify `?si=` share token is stripped before a
   playlist is saved, but the settings tab stored `url: draftUrl.trim()` verbatim,
   so every copied link kept the token that identifies whoever shared it.
   S-08: the lone "Playlists" row was a heading; Obsidian's guideline is that a
   heading is for a page with more than one section. This drives the REAL
   GymSettingTab against a stub of Obsidian's Setting. */
const assert = require('node:assert');
const Module = require('node:module');

const headings = [];
const added = { texts: {}, buttons: [] };
class Setting {
  constructor() { this.name = ''; this.isHeading = false; }
  setName(n) { this.name = n; return this; }
  setDesc() { return this; }
  setHeading() { this.isHeading = true; headings.push(this.name); return this; }
  addText(fn) {
    const t = { inputEl: { addEventListener() {} }, setValue() { return this; }, setPlaceholder(p) { this.ph = p; return this; }, onChange(f) { this._change = f; return this; } };
    fn(t);
    added.texts[t.ph || this.name] = t;
    return this;
  }
  addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(fn) { fn({ setValue() { return this; }, setDisabled() { return this; }, onChange() { return this; } }); return this; }
  addButton(fn) {
    const b = { setButtonText(x) { this.label = x; return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled() { return this; }, onClick(f) { this._click = f; return this; } };
    fn(b);
    added.buttons.push(b);
    return this;
  }
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

const plugin = {
  settings: { gymFolder: 'Gym', planRepo: 'https://x.example', weekStart: 'mon', skin: 'floor', accent: 'lime', musicApp: 'spotify', playlists: [], countBack: 'off', voice: 'default', guideMinutes: 30 },
  async saveSettings() {}, refreshViews() {}, hasGymData: () => true,
  app: { vault: {}, workspace: { getLeavesOfType: () => [] } },
};
const tab = new GymSettingTab({ vault: {}, workspace: {} }, plugin);
tab.display();

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
};
const addPlaylist = async (name, url) => {
  plugin.settings.playlists = [];
  tab.display();   // a fresh render, as the user sees after any save
  added.texts.Name._change(name);
  added.texts['https://open.spotify.com/playlist/…']._change(url);
  const btn = added.buttons.filter(b => b.label === 'Add').pop();   // the latest render's button
  await btn._click();
  return plugin.settings.playlists[0];
};

(async () => {
  await check('L6-03 a Spotify link is saved without its ?si= share token', async () => {
    const saved = await addPlaylist('Run', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123def456');
    assert.ok(saved, 'the playlist was not saved');
    assert.ok(!/si=|\?/.test(saved.url), `saved url "${saved.url}" still carries the share token / query`);
  });
  await check('L6-03 the saved link still opens the same playlist (Spotify, localised, Apple Music)', async () => {
    const { parseMusicTarget } = require('../src/music-link');
    for (const url of [
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc&utm_source=copy-link',
      'https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy?si=zzz',
      'spotify:track:6rqhFgbbKwnb9MLmUQDhG6',
      'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb?l=en&utm_source=x',
    ]) {
      const want = parseMusicTarget(url);
      const saved = await addPlaylist('x', url);
      assert.ok(saved, `${url} was not saved`);
      assert.ok(!/[?&](si|utm_[a-z]+)=/.test(saved.url), `saved url "${saved.url}" keeps tracking parameters`);
      const got = parseMusicTarget(saved.url);
      assert.ok(got, `saved url "${saved.url}" no longer parses as a music link`);
      assert.strictEqual(got.https, want.https, `"${saved.url}" opens ${got.https}, the pasted link opened ${want.https}`);
      assert.strictEqual(got.app, want.app);
    }
  });
  await check('L6-03 a link that is not music is still refused, and nothing is saved', async () => {
    const saved = await addPlaylist('x', 'https://example.com/?si=1');
    assert.strictEqual(saved, undefined, 'a non-music link was saved');
  });
  await check('S-08 the settings page has no lone heading', () => {
    assert.deepStrictEqual(headings, [], `settings use setHeading() for: ${headings.join(', ')} (one section needs no heading)`);
  });
  if (failed) { console.log(`F5 settings tab: ${failed} guard(s) FAILED`); process.exit(1); }
  console.log('F5 settings tab OK');
})();
