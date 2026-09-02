'use strict';
/* voice-pack.js — the list of clips, the lookup that plays them, and the
   arithmetic between a microphone take and a saved WAV.

   THREE SEAMS ARE GUARDED HERE, because each fails silently:

   1. The lookup must agree with what the app actually says. countdown.js
      passes GO_WORD to cue('go'); the meter passes 'target'. If either
      stops mapping to a clip, the user records "Begin" and hears the device
      voice instead, with nothing to say why.
   2. The count-in length must equal countdown.GATE_FROM. voice-pack cannot
      import countdown (cycle), so the number is a literal — pinned here.
   3. The WAV must be a WAV. A header off by two bytes decodes as noise on
      one engine and throws on another; the header is parsed back and
      checked field by field. */
const assert = require('node:assert');
const vp = require('../src/voice-pack');
const countdown = require('../src/countdown');
const fs = require('node:fs');
const path = require('node:path');

/* ---------- the list ---------- */
{
  const keys = vp.CUES.map(c => c.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'clip keys must be unique — they are filenames');
  for (const c of vp.CUES) {
    assert.match(c.key, /^[a-z]+(-\d+)?$/, `${c.key}: a key is a filename and a lookup token; keep it plain`);
    assert.ok(vp.GROUPS.some(g => g.id === c.group), `${c.key}: unknown group ${c.group}`);
    assert.ok(c.label && c.say, `${c.key}: needs a label and something to say`);
  }
  assert.strictEqual(vp.COUNT_CLIPS, countdown.GATE_FROM,
    'the count-in clips must cover exactly what countdown.js counts from — the literal in voice-pack.js has drifted');
  assert.strictEqual(vp.CUES.filter(c => c.group === 'countin').length, vp.COUNT_CLIPS + 1, 'five numbers and the word');
  assert.strictEqual(vp.CUES.filter(c => c.group === 'reps').length, vp.REP_CLIP_MAX);
  assert.strictEqual(vp.numberWord(17), 'seventeen');
  assert.strictEqual(vp.numberWord(23), 'twenty-three');
  assert.strictEqual(vp.numberWord(30), 'thirty');
  assert.strictEqual(vp.numberWord(31), '31', 'past the recorded range a number is just a number');
}

/* ---------- the lookup agrees with the callers ---------- */
{
  assert.strictEqual(vp.clipKey('go', countdown.GO_WORD), 'go', 'countdown.js\'s word at zero must map to the "go" clip');
  assert.strictEqual(vp.clipKey('go', 'target'), 'target', 'the meter\'s target cue must map to its own clip');
  assert.strictEqual(vp.clipKey('record', 'new record'), 'record');
  assert.strictEqual(vp.clipKey('goal', 'goal met'), 'goal');
  assert.strictEqual(vp.clipKey('begin', 'Next, Push-ups'), null, 'exercise names are never clips');
  assert.strictEqual(vp.clipKey('count', 3), 'count-3');
  assert.strictEqual(vp.clipKey('count', '3'), 'count-3', 'numbers arrive as strings from some callers');
  assert.strictEqual(vp.clipKey('count', 6), null, 'the count-in never says six');
  assert.strictEqual(vp.clipKey('rep', 12), 'rep-12');
  assert.strictEqual(vp.clipKey('rep', vp.REP_CLIP_MAX + 1), null, 'past the recorded range → device voice');
  assert.strictEqual(vp.clipKey('rep', 0), null);
  assert.strictEqual(vp.clipKey('rep', 'seven'), null, 'a word is not a rep number');
  assert.strictEqual(vp.clipKey('nonsense', 'x'), null);
  /* Every key the lookup can return exists in the list. */
  for (const k of [vp.clipKey('go', 'Begin'), vp.clipKey('go', 'target'), vp.clipKey('record'), vp.clipKey('goal'), vp.clipKey('count', 1), vp.clipKey('rep', 30)]) {
    assert.ok(vp.cueFor(k), `${k} is returned by clipKey but is not in CUES`);
  }
}

/* Every cue KIND the app raises is either mapped or deliberately unmapped.
   Read the real call sites so a new sound.cue('rest', …) added to a page
   cannot quietly play the device voice in custom mode forever. */
{
  const src = path.join(__dirname, '..', 'src');
  const kinds = new Set();
  for (const f of fs.readdirSync(src).filter(f => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(src, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of code.matchAll(/sound\.cue\(\s*'([a-z]+)'/g)) kinds.add(m[1]);
    /* page-session.js's celebrate(ctx, sess, kind, words) forwards its kind
       to sound.cue — 'goal' only ever reaches sound.js that way. */
    for (const m of code.matchAll(/celebrate\(ctx, sess, '([a-z]+)'/g)) kinds.add(m[1]);
  }
  assert.ok(kinds.size >= 4, `expected the cue kinds to be found in src/, got ${[...kinds].join(', ')}`);
  const KNOWN = new Set(['begin', 'go', 'record', 'goal']);
  for (const k of kinds) {
    assert.ok(KNOWN.has(k), `sound.cue('${k}') is raised somewhere in src/ but voice-pack.js has no decision for it — add a clip or list it as device-voice-only`);
  }
}

/* ---------- filenames ---------- */
{
  assert.strictEqual(vp.clipFileName('rep-7'), 'rep-7.wav');
  assert.strictEqual(vp.keyFromFileName('rep-7.wav'), 'rep-7');
  assert.strictEqual(vp.keyFromFileName('REP-7.WAV'), 'rep-7', 'case-insensitive filesystems');
  assert.strictEqual(vp.keyFromFileName('rep-99.wav'), null, 'a file that is not one of ours is ignored, not played');
  assert.strictEqual(vp.keyFromFileName('go.wav'), 'go');
  assert.strictEqual(vp.keyFromFileName('go.m4a'), null, 'only the format we write');
  assert.strictEqual(vp.keyFromFileName('notes.md'), null);
  for (const c of vp.CUES) assert.strictEqual(vp.keyFromFileName(vp.clipFileName(c.key)), c.key, `${c.key} must round-trip through its filename`);
}

/* ---------- the take ---------- */

/* A synthetic "word": silence, a 440 Hz burst, silence. */
const RATE = 48000;
function take(rate, leadMs, toneMs, tailMs, amp) {
  const n = ms => Math.round((ms / 1000) * rate);
  const out = new Float32Array(n(leadMs) + n(toneMs) + n(tailMs));
  for (let i = 0; i < n(toneMs); i++) out[n(leadMs) + i] = amp * Math.sin((2 * Math.PI * 440 * i) / rate);
  return out;
}

{
  const t = take(RATE, 400, 300, 900, 0.3);
  const trimmed = vp.trimSilence(t, RATE);
  const ms = (trimmed.length / RATE) * 1000;
  assert.ok(ms > 300 && ms < 460, `trim keeps the word plus ~60ms of room each side, got ${ms.toFixed(0)}ms`);
  assert.strictEqual(vp.trimSilence(new Float32Array(RATE), RATE).length, 0, 'pure silence trims to nothing');
  assert.strictEqual(vp.trimSilence(take(RATE, 0, 200, 0, 0.005), RATE).length, 0, 'room tone under the threshold is silence');
}

{
  const quiet = take(RATE, 0, 100, 0, 0.1);
  const loud = vp.normalizePeak(quiet, 0.9);
  let max = 0; for (const s of loud) max = Math.max(max, Math.abs(s));
  assert.ok(Math.abs(max - 0.9) < 1e-3, `normalise to the peak, got ${max}`);
  assert.deepStrictEqual([...vp.normalizePeak(new Float32Array(10))], new Array(10).fill(0), 'silence stays silence — no divide by zero');
}

{
  const s = take(RATE, 0, 1000, 0, 0.5);
  const r = vp.resample(s, RATE, vp.CLIP_RATE);
  assert.ok(Math.abs(r.length - vp.CLIP_RATE) <= 1, `one second stays one second at the new rate, got ${r.length}`);
  assert.strictEqual(vp.resample(s, RATE, RATE).length, s.length, 'same rate is a copy');
  assert.notStrictEqual(vp.resample(s, RATE, RATE), s, 'a copy, not the caller\'s own array');
}

{
  const chunks = [new Float32Array([1, 2]), new Float32Array([3]), new Float32Array(0), new Float32Array([4, 5])];
  assert.deepStrictEqual([...vp.concatSamples(chunks)], [1, 2, 3, 4, 5]);
  assert.strictEqual(vp.rms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.strictEqual(vp.rms(new Float32Array(0)), 0);
}

/* The WAV header, field by field. */
{
  const s = take(vp.CLIP_RATE, 0, 500, 0, 0.8);
  const wav = vp.encodeWav(s, vp.CLIP_RATE);
  assert.strictEqual(wav.byteLength, 44 + s.length * 2, '44-byte canonical header plus 16-bit samples');
  const info = vp.wavInfo(wav);
  assert.deepStrictEqual({ channels: info.channels, rate: info.rate, bits: info.bits, samples: info.samples },
    { channels: 1, rate: vp.CLIP_RATE, bits: 16, samples: s.length });
  assert.ok(Math.abs(info.seconds - 0.5) < 1e-6);
  const dv = new DataView(wav);
  assert.strictEqual(dv.getUint32(4, true), 36 + s.length * 2, 'RIFF chunk size');
  assert.strictEqual(dv.getUint32(28, true), vp.CLIP_RATE * 2, 'byte rate = rate × block align');
  assert.strictEqual(dv.getUint16(32, true), 2, 'block align for 16-bit mono');
  /* Clipping: a sample past ±1 must saturate, not wrap around into a click. */
  const hot = vp.encodeWav(new Float32Array([1.5, -1.5]), vp.CLIP_RATE);
  assert.strictEqual(new DataView(hot).getInt16(44, true), 0x7fff);
  assert.strictEqual(new DataView(hot).getInt16(46, true), -0x8000);
  assert.strictEqual(vp.wavInfo(new ArrayBuffer(10)), null);
  assert.strictEqual(vp.wavInfo(new TextEncoder().encode('not a wav at all, definitely not, no sir, nope, nada').buffer), null);
}

/* prepareClip end to end. */
{
  const clip = vp.prepareClip(take(RATE, 500, 400, 500, 0.2), RATE);
  assert.ok(clip, 'a take with a word in it yields a clip');
  assert.strictEqual(clip.rate, vp.CLIP_RATE);
  assert.ok(clip.seconds > 0.4 && clip.seconds < 0.6, `trimmed to the word, got ${clip.seconds}s`);
  assert.strictEqual(vp.wavInfo(clip.wav).samples, clip.samples.length);
  assert.strictEqual(vp.prepareClip(new Float32Array(RATE), RATE), null, 'silence is "nothing heard", not a clip');
  const long = vp.prepareClip(take(RATE, 0, 5000, 0, 0.5), RATE);
  assert.ok(Math.abs(long.seconds - vp.MAX_CLIP_MS / 1000) < 0.01, 'a forgotten microphone is capped, not saved whole');
}

/* ---------- progress ---------- */
{
  const p = vp.progressOf(['go', 'rep-1', 'nonsense']);
  assert.strictEqual(p.total, vp.CUES.length);
  assert.strictEqual(p.recorded, 2, 'a key not in the list does not count');
  assert.strictEqual(p.missing.length, vp.CUES.length - 2);
  assert.strictEqual(vp.progressOf(null).recorded, 0);
  assert.strictEqual(vp.progressOf(vp.CUES.map(c => c.key)).missing.length, 0);
}

console.log(`voice pack OK (${vp.CUES.length} cues, lookup matches countdown and the meter, WAV header round-trips, silence is not a clip)`);
