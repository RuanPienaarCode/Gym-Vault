'use strict';
/* Loading the user's clips from the vault into sound.js.

   The bridge between data.js (which knows files) and sound.js (which knows
   AudioBuffers) — kept out of both so neither has to import the other.
   Called by the controller after every load and by the recorder page after
   every save.

   CHEAP TO CALL REPEATEDLY, because it is: the controller reloads on every
   vault event. The folder listing is fingerprinted by path and mtime, and
   an unchanged fingerprint means no file is read and nothing is decoded —
   forty clips decoded on every keystroke in another pane would be a real
   cost on a phone. A single re-recorded "seven" changes one mtime and
   re-decodes only that one clip. */

const sound = require('./sound');

let lastStamp = '';
let cache = new Map(); // key -> {stamp, buffer}

function stampOf(entry) {
  const st = entry.file && entry.file.stat;
  return `${entry.file.path}:${st ? st.mtime : 0}:${st ? st.size : 0}`;
}

/* Read + decode whatever changed, then hand the full set to sound.js.
   Returns the Map. A clip that fails to decode is dropped and named in the
   console, not thrown: one bad file must not silence the other forty. */
async function loadClips(io) {
  const entries = await io.listVoiceClips();
  const stamp = entries.map(stampOf).sort().join('|');
  if (stamp === lastStamp) return new Map([...cache].map(([k, v]) => [k, v.buffer]));

  const next = new Map();
  for (const entry of entries) {
    const s = stampOf(entry);
    const had = cache.get(entry.key);
    if (had && had.stamp === s) { next.set(entry.key, had); continue; }
    try {
      const bytes = await io.readVoiceClip(entry.file);
      const buffer = await sound.decodeClip(bytes);
      next.set(entry.key, { stamp: s, buffer });
    } catch (e) {
      console.error(`gym-vault: could not load voice clip ${entry.file.path}`, e);
    }
  }
  cache = next;
  lastStamp = stamp;
  const map = new Map([...next].map(([k, v]) => [k, v.buffer]));
  sound.setClips(map);
  return map;
}

/* Forget the fingerprint so the next loadClips reads the folder fresh —
   after a save or a delete from the recorder page, which knows the file
   changed before any vault event has had a chance to fire. */
function invalidate() { lastStamp = ''; }

module.exports = { loadClips, invalidate };
