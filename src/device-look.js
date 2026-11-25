'use strict';
/* STYLE ON THIS DEVICE ONLY.

   Settings live in data.json inside the vault, and the vault syncs, so two
   people sharing one vault share one Style and one Accent: whoever picks last
   repaints the other phone. A device look ({ skin, accent, rewards,
   quietMotion }, any subset) is kept in
   Obsidian's per-vault LOCAL storage (never synced). When one is set it wins
   on this device, and saving still writes the SHARED values to data.json, so the
   other devices never see it.

   THE GYM FOLDER ON THIS DEVICE ONLY (25 Nov 2026, audit finding 20). The
   look was the only thing kept per phone, so both people read and wrote one
   Gym folder: one set of plans, workouts, records, body log and photos. A
   device folder is kept the same way, under its OWN key (it is not a look:
   switching the device look off must not move anyone's training data). When
   one is set it is plugin.settings.gymFolder at runtime, so every reader just
   works, and saving still writes the SHARED folder to data.json.

   Pure helpers + two tiny stores; the plugin (main.js) owns the state. */

const { SKINS, ACCENTS, CALM_PALETTES } = require('./constants');

const LOOK_KEY = 'gym-app-device-look';
const FOLDER_KEY = 'gym-app-device-folder';
/* What a device may choose for itself: how it looks (Style, Accent) and how
   loud it is (Calm colours, Rewards, Calm motion). Everything else stays shared. */
const FIELDS = ['skin', 'accent', 'calmPalette', 'rewards', 'quietMotion'];
const BOOL = [true, false];
const VALID = { skin: SKINS.map(s => s[0]), accent: ACCENTS.map(a => a[0]), calmPalette: CALM_PALETTES.map(p => p[0]), rewards: BOOL, quietMotion: BOOL };

/* Only known keys survive, field by field; nothing valid = null (no look). */
function cleanLook(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const f of FIELDS) if (VALID[f].indexOf(raw[f]) >= 0) out[f] = raw[f];
  return Object.keys(out).length ? out : null;
}

/* The settings this device shows. */
function applyLook(settings, look) {
  return look ? Object.assign({}, settings, look) : Object.assign({}, settings);
}

/* A device folder, or null. The rule Obsidian's normalizePath applies (one
   slash between parts, none at either end, NFC, no non-breaking spaces), plus
   what makes a path no gym folder at all: the vault root, a `.` or `..` part
   (it would point somewhere else), and a part starting with a dot (a hidden
   folder such as .obsidian is not indexed by the vault, so the gym would
   never load). Written out here because this module stays free of the
   obsidian import, so the guard suite can run it in plain node. */
function cleanFolder(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\u00A0\u202F]/g, ' ').trim().replace(/[\\/]+/g, '/');
  while (p.charAt(0) === '/') p = p.slice(1);
  while (p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
  if (typeof p.normalize === 'function') p = p.normalize('NFC');
  const parts = p.split('/').map(x => x.trim());
  if (!p || parts.some(x => !x || x.charAt(0) === '.')) return null;
  return parts.join('/');
}

/* The settings this device uses: the shared ones with this device's folder. */
function applyFolder(settings, folder) {
  return folder ? Object.assign({}, settings, { gymFolder: folder }) : Object.assign({}, settings);
}

/* What goes to data.json: the device look's fields put back to the shared
   ones, and with a device folder the SHARED gymFolder (`shared.gymFolder`). */
function sharedForSave(settings, shared, look, folder) {
  const out = Object.assign({}, settings);
  if (look) for (const f of FIELDS) if (f in look) out[f] = shared[f];
  if (folder) out.gymFolder = shared.gymFolder;
  return out;
}

/* One local-storage value under `key`, read back through `clean`. */
function makeStore(app, key, clean) {
  const hasHost = () => !!app && typeof app.saveLocalStorage === 'function' && typeof app.loadLocalStorage === 'function';
  /* The host pair already prefixes the vault id; the fallback must too. */
  const webKey = () => `${String((app && app.appId)
    || (app && app.vault && typeof app.vault.getName === 'function' && app.vault.getName()) || '')}-${key}`;
  const web = () => {
    try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; }
    catch (e) { return null; }
  };
  return {
    read() {
      try {
        if (hasHost()) return clean(app.loadLocalStorage(key));
        const ls = web();
        const text = ls ? ls.getItem(webKey()) : null;
        return text ? clean(JSON.parse(text)) : null;
      } catch (e) { return null; }
    },
    /* null clears. */
    write(value) {
      try {
        if (hasHost()) { app.saveLocalStorage(key, value || null); return true; }
        const ls = web();
        if (!ls) return false;
        if (value) ls.setItem(webKey(), JSON.stringify(value)); else ls.removeItem(webKey());
        return true;
      } catch (e) { return false; }
    },
  };
}

const makeLookStore = app => makeStore(app, LOOK_KEY, cleanLook);
const makeFolderStore = app => makeStore(app, FOLDER_KEY, cleanFolder);

module.exports = {
  LOOK_KEY, FOLDER_KEY, LOOK_FIELDS: FIELDS,
  cleanLook, applyLook, sharedForSave, makeLookStore,
  cleanFolder, applyFolder, makeFolderStore,
};
