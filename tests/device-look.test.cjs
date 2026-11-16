'use strict';
/* STYLE ON THIS DEVICE ONLY (16 Nov 2026). Two people share one vault, and so
   one data.json synced over iCloud. Ruan trains on Apex; his wife wants Calm +
   Olive on her phone. Without a device choice, whoever picks a style last
   repaints the other phone.

   What can go wrong silently, and what this pins:
     D1  THE DEVICE CHOICE WINS: a stored device look replaces skin + accent.
     D2  IT NEVER REACHES data.json: saving writes the SHARED skin/accent back,
         so the other phone never sees the device choice.
     D3  JUNK IS IGNORED: an unknown skin or accent in storage (a removed style,
         a hand edit) falls back to the shared value, field by field.
     D4  THE STORE ROUND-TRIPS through Obsidian's per-vault local storage, and
         null clears it.
     D5  NO HOST STORAGE: falls back to window.localStorage scoped by vault, so
         two vaults on one device never share a look.
     D6  SETTINGS ARE NOT MUTATED in place by applyLook/sharedForSave. */
const assert = require('node:assert');
const { cleanLook, applyLook, sharedForSave, makeLookStore, LOOK_KEY } = require('../src/device-look');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

const shared = { skin: 'apex', accent: 'lime', weekStart: 'mon' };

check('D1 device look replaces skin and accent', () => {
  const s = applyLook(shared, { skin: 'calm', accent: 'olive' });
  assert.strictEqual(s.skin, 'calm');
  assert.strictEqual(s.accent, 'olive');
  assert.strictEqual(s.weekStart, 'mon');
});

check('D1 no device look leaves settings as they are', () => {
  assert.deepStrictEqual(applyLook(shared, null), shared);
});

check('D2 saving writes the shared look, not the device look', () => {
  const effective = applyLook(shared, { skin: 'calm', accent: 'olive' });
  effective.weekStart = 'sat'; // a shared setting changed on this device still saves
  const out = sharedForSave(effective, { skin: 'apex', accent: 'lime' }, { skin: 'calm', accent: 'olive' });
  assert.strictEqual(out.skin, 'apex');
  assert.strictEqual(out.accent, 'lime');
  assert.strictEqual(out.weekStart, 'sat');
});

check('D2 without a device look, saving writes what is shown', () => {
  const out = sharedForSave({ ...shared, skin: 'lockin' }, { skin: 'apex', accent: 'lime' }, null);
  assert.strictEqual(out.skin, 'lockin');
});

check('D3 unknown values fall back field by field', () => {
  assert.deepStrictEqual(cleanLook({ skin: 'neon-disco', accent: 'olive' }), { accent: 'olive' });
  assert.deepStrictEqual(cleanLook({ skin: 'calm', accent: 42 }), { skin: 'calm' });
  assert.strictEqual(cleanLook({ skin: 'nope' }), null);
  assert.strictEqual(cleanLook('calm'), null);
  assert.strictEqual(cleanLook(null), null);
  const s = applyLook(shared, cleanLook({ skin: 'neon-disco', accent: 'olive' }));
  assert.strictEqual(s.skin, 'apex');
  assert.strictEqual(s.accent, 'olive');
});

check('D4 store round-trips through Obsidian local storage', () => {
  const mem = {};
  const app = {
    saveLocalStorage: (k, v) => { if (v == null) delete mem[k]; else mem[k] = v; },
    loadLocalStorage: k => (k in mem ? mem[k] : null),
  };
  const store = makeLookStore(app);
  assert.strictEqual(store.read(), null);
  store.write({ skin: 'calm', accent: 'olive' });
  assert.ok(LOOK_KEY in mem);
  assert.deepStrictEqual(store.read(), { skin: 'calm', accent: 'olive' });
  store.write(null);
  assert.strictEqual(store.read(), null);
});

check('D5 window.localStorage fallback is scoped by vault', () => {
  const mem = {};
  global.window = { localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  } };
  const a = makeLookStore({ appId: 'vault-a' });
  const b = makeLookStore({ appId: 'vault-b' });
  a.write({ skin: 'calm', accent: 'olive' });
  assert.deepStrictEqual(a.read(), { skin: 'calm', accent: 'olive' });
  assert.strictEqual(b.read(), null);
  a.write(null);
  assert.strictEqual(a.read(), null);
  delete global.window;
});

check('D6 inputs are not mutated', () => {
  const input = { ...shared };
  applyLook(input, { skin: 'calm', accent: 'olive' });
  sharedForSave(input, { skin: 'lockin', accent: 'blaze' }, { skin: 'calm' });
  assert.deepStrictEqual(input, shared);
});

/* D7 (16 Nov 2026): the device choice also covers Rewards and Calm motion, so one phone can
   go quiet without switching the other's XP or celebrations off. Booleans only. */
check('D7 rewards and calm motion are device choices too', () => {
  const look = cleanLook({ skin: 'calm', rewards: false, quietMotion: true });
  assert.deepStrictEqual(look, { skin: 'calm', rewards: false, quietMotion: true });
  const s = applyLook({ skin: 'apex', accent: 'lime', rewards: true, quietMotion: false }, look);
  assert.strictEqual(s.rewards, false);
  assert.strictEqual(s.quietMotion, true);
  const out = sharedForSave(s, { skin: 'apex', accent: 'lime', rewards: true, quietMotion: false }, look);
  assert.strictEqual(out.rewards, true, 'device rewards leaked into data.json');
  assert.strictEqual(out.quietMotion, false, 'device calm motion leaked into data.json');
  assert.deepStrictEqual(cleanLook({ rewards: 'no', quietMotion: 1 }), null, 'non-booleans must be dropped');
});

if (failed) { console.error(`device-look: ${failed} failed`); process.exit(1); }
