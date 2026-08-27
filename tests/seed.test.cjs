'use strict';
/* Seed media invariants — what keeps "Refresh starter media" safe. */
const assert = require('node:assert');
const { SEED_EXERCISES, isSeedMediaUrl } = require('../src/seed');

/* Every media URL the seed ships MUST pass the seed-source gate: refresh
   overwrites only gate-passing values, so a seed URL outside the gate would
   make its own refresh non-idempotent (patched once, then orphaned). */
for (const ex of SEED_EXERCISES) {
  const images = Array.isArray(ex.image) ? ex.image : ex.image ? [ex.image] : [];
  for (const u of images) {
    assert.ok(/^https:\/\//.test(u), `${ex.name}: image must be https (${u})`);
    assert.ok(isSeedMediaUrl(u), `${ex.name}: image outside the seed-source gate (${u})`);
  }
  if (ex.video) {
    assert.ok(/^https:\/\//.test(ex.video), `${ex.name}: video must be https`);
    assert.ok(isSeedMediaUrl(ex.video), `${ex.name}: video outside the seed-source gate`);
  }
}

/* The gate must NOT swallow arbitrary URLs — that would let refresh clobber
   a user's own media. */
assert.ok(!isSeedMediaUrl('https://example.com/me.jpg'));
assert.ok(!isSeedMediaUrl('Gym/Attachments/mine.mp4'));
assert.ok(!isSeedMediaUrl(''));
assert.ok(isSeedMediaUrl('https://wger.de/media/exercise-video/475/x.MOV'));
assert.ok(isSeedMediaUrl('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Pullups/0.jpg'));

/* wger media requires attribution — any seed exercise using it must say so
   in its note body. */
for (const ex of SEED_EXERCISES) {
  const all = [...(Array.isArray(ex.image) ? ex.image : ex.image ? [ex.image] : []), ex.video || ''];
  if (all.some(u => u.includes('wger.de'))) {
    assert.ok((ex.note || '').includes('wger.de'), `${ex.name}: wger media without attribution in the note`);
  }
}

console.log('seed media invariants OK');
