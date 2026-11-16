'use strict';
/* STYLE ON THIS DEVICE ONLY.

   Settings live in data.json inside the vault, and the vault syncs, so two
   people sharing one vault share one Style and one Accent: whoever picks last
   repaints the other phone. A device look ({ skin, accent, rewards,
   quietMotion }, any subset) is kept in
   Obsidian's per-vault LOCAL storage (never synced). When one is set it wins
   on this device, and saving still writes the SHARED values to data.json, so the
   other devices never see it.

   Pure helpers + a tiny store; the plugin (main.js) owns the state. */

const { SKINS, ACCENTS, CALM_PALETTES } = require('./constants');

const LOOK_KEY = 'gym-app-device-look';
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

/* What goes to data.json: the device look's fields put back to the shared ones. */
function sharedForSave(settings, shared, look) {
  const out = Object.assign({}, settings);
  if (look) for (const f of FIELDS) if (f in look) out[f] = shared[f];
  return out;
}

function makeLookStore(app) {
  const hasHost = () => !!app && typeof app.saveLocalStorage === 'function' && typeof app.loadLocalStorage === 'function';
  /* The host pair already prefixes the vault id; the fallback must too. */
  const webKey = () => `${String((app && app.appId)
    || (app && app.vault && typeof app.vault.getName === 'function' && app.vault.getName()) || '')}-${LOOK_KEY}`;
  const web = () => {
    try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; }
    catch (e) { return null; }
  };
  return {
    read() {
      try {
        if (hasHost()) return cleanLook(app.loadLocalStorage(LOOK_KEY));
        const ls = web();
        const text = ls ? ls.getItem(webKey()) : null;
        return text ? cleanLook(JSON.parse(text)) : null;
      } catch (e) { return null; }
    },
    /* null clears. */
    write(look) {
      try {
        if (hasHost()) { app.saveLocalStorage(LOOK_KEY, look || null); return true; }
        const ls = web();
        if (!ls) return false;
        if (look) ls.setItem(webKey(), JSON.stringify(look)); else ls.removeItem(webKey());
        return true;
      } catch (e) { return false; }
    },
  };
}

module.exports = { LOOK_KEY, LOOK_FIELDS: FIELDS, cleanLook, applyLook, sharedForSave, makeLookStore };
