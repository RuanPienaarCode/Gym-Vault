'use strict';
/* AN EMPTY GYM FOLDER THAT ALREADY EXISTS WARNS BEFORE "CREATE MY GYM"
   (0.12.1, audit L2-06 follow-up from the iPhone review).

   0.12.1 offers setup for an existing, empty gym folder once Obsidian's
   metadata cache has finished its first pass. On a phone that is still
   downloading the vault from iCloud, that pass can finish while the folder
   is there but its files have not landed yet. Tapping Create then writes
   starter notes beside notes that are still on their way, and the sync
   leaves duplicate copies. The app cannot tell "still syncing" from "really
   empty", so the setup card says so when the folder already exists — and
   says nothing extra on a genuinely fresh start (no folder at all).

   Drives the REAL controller and reads what it renders. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const BASE = { present: false, unreadable: 0, unreadablePaths: [], exercises: [], plans: [], goals: [], workouts: [] };
const text = b => H.page(b.ctx).textContent;
const boot = data => H.boot({
  data: Object.assign({}, BASE, data),
  app: { metadataCache: { initialized: true, on: () => ({}) } },
});

(async () => {
  H.killProcess();
  const there = await boot({ rootExists: true });
  assert.ok(/Create my gym/.test(text(there)), `setup card expected, page says: "${text(there).slice(0, 120)}"`);
  assert.ok(/still syncing/i.test(text(there)),
    `an existing but empty gym folder must warn that a vault still syncing to this device can leave duplicates — page says: "${text(there).slice(0, 240)}"`);

  H.killProcess();
  const fresh = await boot({ rootExists: false });
  assert.ok(/Create my gym/.test(text(fresh)), 'a fresh start still offers setup');
  assert.ok(!/still syncing/i.test(text(fresh)), 'a genuinely fresh start (no folder yet) must not carry the sync warning');

  console.log('gym folder setup sync warning OK (existing empty folder warns about a sync in progress; a fresh start does not)');
})().catch(e => { console.error(e.message || e); process.exit(1); });
