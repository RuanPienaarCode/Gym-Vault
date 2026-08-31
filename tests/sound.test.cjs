'use strict';
/* sound.js — the mode decision, the voice pick, and the shape tables.

   WHAT THIS IS GUARDING: a stored sound mode is a REQUEST, not a fact. iOS
   WebKit has no navigator.vibrate; a locked-down engine may have no
   speechSynthesis. resolveMode() is the single place that turns "what was
   asked for" into "what will happen", and every announcement in the app goes
   through it — so a wrong fallback here is silence in the gym, or worse, a
   phone that talks out loud when the user deliberately chose vibration.

   The effects (speaking, oscillators, buzzing) are not tested here: they are
   device APIs with no return value. What IS testable is every decision made
   before touching one, and that is all of it. */
const assert = require('node:assert');
const sound = require('../src/sound');

const caps = (speech, audio, vibrate) => ({ speech, audio, vibrate });
const ALL = caps(true, true, true);
const NONE = caps(false, false, false);

/* ---------- resolveMode: honoured when possible ---------- */

for (const m of sound.MODES) {
  assert.strictEqual(sound.resolveMode(m, ALL), m, `${m} must be honoured on a device that can do it`);
}

/* ---------- resolveMode: the fallback chain ---------- */

/* voice degrades to a beep — you asked to be TOLD, and a tone still tells
   you. Only with no audio at all does it go quiet. */
assert.strictEqual(sound.resolveMode('voice', caps(false, true, true)), 'beep');
assert.strictEqual(sound.resolveMode('voice', caps(false, false, true)), 'silent');

/* beep does NOT degrade to voice. Falling "up" to speech would make the app
   louder and more personal than what was asked for — out loud, in a gym. */
assert.strictEqual(sound.resolveMode('beep', caps(true, false, true)), 'silent');

/* vibrate degrades to silence, never to sound. Vibration is the mode you
   choose precisely because you do not want to make a noise; substituting
   audio would invert the user's intent, which is the one unrecoverable
   failure in this table. */
assert.strictEqual(sound.resolveMode('vibrate', caps(true, true, false)), 'silent');
assert.strictEqual(sound.resolveMode('vibrate', ALL), 'vibrate');

/* silent stays silent even on a device that can do everything. */
assert.strictEqual(sound.resolveMode('silent', ALL), 'silent');

/* ---------- resolveMode: junk input ---------- */

/* A missing or unrecognised setting reads as the DEFAULT, not as silence —
   a settings value that failed to load must not quietly switch the feature
   off, because the user would have no way to tell that is what happened. */
for (const junk of [undefined, null, '', 'shout', 0, {}]) {
  assert.strictEqual(sound.resolveMode(junk, ALL), 'voice', `${JSON.stringify(junk)} must fall back to voice`);
}
assert.strictEqual(sound.resolveMode(undefined, NONE), 'silent', 'a device that can do nothing is silent');

/* ---------- pickVoice ---------- */

const VOICES = [
  { voiceURI: 'com.apple.voice.samantha', name: 'Samantha', lang: 'en-US' },
  { voiceURI: 'com.apple.voice.daniel', name: 'Daniel', lang: 'en-GB' },
];

assert.strictEqual(sound.pickVoice(VOICES, 'com.apple.voice.daniel'), VOICES[1]);

/* A URI chosen on another device resolves to null — meaning "let the engine
   pick its default". NOT to some other voice (the user did not choose it)
   and NOT to silence (the count still has to be spoken). */
assert.strictEqual(sound.pickVoice(VOICES, 'com.google.voice.nobody'), null);
assert.strictEqual(sound.pickVoice(VOICES, ''), null);
assert.strictEqual(sound.pickVoice([], 'com.apple.voice.daniel'), null);
assert.strictEqual(sound.pickVoice(null, 'x'), null, 'getVoices() can return junk before it is ready');

/* ---------- usableVoices ---------- */

assert.deepStrictEqual(
  sound.usableVoices([null, { name: 'no uri' }, { voiceURI: 'u' }, VOICES[0]]),
  [VOICES[0]],
  'a voice with no URI cannot be stored and a voice with no name cannot be shown — drop both',
);
assert.deepStrictEqual(sound.usableVoices(undefined), [], 'getVoices() before it is ready must not throw');

/* Language filtering. A real Mac reports 180 voices; unfiltered that is a
   wall, and most of them cannot pronounce the English this app speaks. */
const MANY = [
  { voiceURI: 'a', name: 'Tessa', lang: 'en-ZA' },
  { voiceURI: 'b', name: 'Daniel', lang: 'en-GB' },
  { voiceURI: 'c', name: 'Alice', lang: 'it-IT' },
  { voiceURI: 'd', name: 'Yuna', lang: 'ko-KR' },
];
assert.deepStrictEqual(
  sound.usableVoices(MANY, 'en-ZA').map(v => v.name), ['Tessa', 'Daniel'],
  'only the primary subtag is compared, so en-GB survives an en-ZA device',
);
assert.deepStrictEqual(
  sound.usableVoices(MANY, 'EN').map(v => v.name), ['Tessa', 'Daniel'],
  'language matching must be case-insensitive',
);

/* THE IMPORTANT ONE: a device whose UI language has no installed voices must
   still get a picker. An empty filtered list would offer nothing at all,
   which is strictly worse than a long list. */
assert.deepStrictEqual(
  sound.usableVoices(MANY, 'fi-FI').map(v => v.name), ['Tessa', 'Daniel', 'Alice', 'Yuna'],
  'no match in the requested language must fall back to every voice, never to none',
);
assert.strictEqual(sound.usableVoices(MANY, '').length, 4, 'no language known — offer everything');

/* ---------- the shape tables ---------- */

/* Every event a caller can raise must have its own tone AND its own buzz.
   A missing entry silently falls back to the plain rep shape, which is how
   a broken record ends up sounding exactly like rep eleven. */
for (const kind of ['rep', 'begin', 'go', 'record', 'goal']) {
  assert.ok(sound.TONES[kind], `no tone shape for '${kind}'`);
  assert.ok(sound.BUZZES[kind] !== undefined, `no vibration shape for '${kind}'`);
}

/* A record must not sound like a rep — the whole point of the celebration is
   that you can tell without looking. */
assert.notDeepStrictEqual(sound.TONES.record, sound.TONES.rep);
assert.notDeepStrictEqual(sound.BUZZES.record, sound.BUZZES.rep);
assert.notDeepStrictEqual(sound.TONES.goal, sound.TONES.record);

/* A rep tone fires between fast reps: long enough and it overlaps the next
   one and the count turns into a drone. */
const repMs = sound.toneFor('rep').reduce((n, t) => n + t.ms, 0);
assert.ok(repMs <= 120, `the per-rep tone must stay under ~120ms, got ${repMs}ms`);

for (const [kind, notes] of Object.entries(sound.TONES)) {
  for (const n of notes) {
    assert.ok(Number.isFinite(n.freq) && n.freq > 40 && n.freq < 8000, `${kind}: freq out of audible range`);
    assert.ok(Number.isFinite(n.ms) && n.ms > 0, `${kind}: every note needs a duration`);
  }
}

/* An unknown kind degrades to the rep shape rather than throwing — a cue
   raised from a code path nobody updated should be quiet-ish, not a crash
   mid-set. */
assert.deepStrictEqual(sound.toneFor('nonsense'), sound.TONES.rep);
assert.deepStrictEqual(sound.buzzFor('nonsense'), sound.BUZZES.rep);

/* ---------- capabilities, with no window at all ---------- */

/* The module is required by the guard suite in plain node. Probing must not
   throw there, and must report nothing available. */
assert.deepStrictEqual(
  sound.capabilities(), { speech: false, audio: false, vibrate: false },
  'capabilities() must survive a no-window environment',
);

console.log('sound OK (mode fallbacks never invert intent, unknown voice falls back to default, every event has its own shape)');
