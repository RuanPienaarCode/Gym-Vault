'use strict';
/* Your own voice — the list of everything the app ever says on repeat, and
   the arithmetic that turns a microphone take into a clip worth keeping.

   Pure: no DOM, no obsidian, no device API. Everything here runs in plain
   node and is covered by tests/voice-pack.test.cjs. The device half
   (microphone, WebAudio) lives in voice-record.js; playback lives in
   sound.js, which asks THIS module which clip a given announcement maps to.

   THE LIST IS THE CONTRACT. sound.js speaks a small, fixed vocabulary —
   the count-in numbers, the word at zero, a rep number, three celebration
   moments — and CUES is that vocabulary written down once, so the recorder
   page, the settings progress line and the playback lookup all agree on
   what exists. Adding a new spoken moment to the app means adding it here
   or accepting that it stays in the device voice.

   WHAT IS DELIBERATELY NOT HERE: exercise names. A timed circuit announces
   "Next, Push-ups" for every exercise in the library, and a library is
   open-ended. Those stay spoken by the device voice, and the page says so.

   WAV, NOT WHATEVER THE RECORDER PRODUCES. MediaRecorder on an iPhone writes
   AAC in an MP4; on desktop Chrome it writes Opus in WebM; and neither
   engine can decode the other's file. A vault syncs between the two. Plain
   16-bit PCM WAV is the one format every WebAudio decoder has always
   understood, and a two-second clip at 22 kHz mono is under 90 KB — so
   takes are captured as raw samples and written as WAV, and the format
   question never reaches the user. */

/* The count-in counts down from five (countdown.GATE_FROM). Written as a
   literal rather than imported: countdown.js requires sound.js, which
   requires this module, and a cycle there is a load-order bug waiting to
   happen. The guard suite asserts the two agree. */
const COUNT_CLIPS = 5;

/* Rep numbers are recorded up to here; anything higher falls back to the
   device voice. Thirty covers every prescription in the seeded plans with
   room to spare, and forty-one clips is already an afternoon's project. */
const REP_CLIP_MAX = 30;

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];
function numberWord(n) {
  if (n < NUMBER_WORDS.length) return NUMBER_WORDS[n];
  if (n < 30) return `twenty-${NUMBER_WORDS[n - 20]}`;
  if (n === 30) return 'thirty';
  return String(n);
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* Groups, in the order the recorder page shows them. */
const GROUPS = [
  { id: 'countin', label: 'Count-in', blurb: 'Before every set, and into every timed interval: five, four, three, two, one — and the word that starts it.' },
  { id: 'moments', label: 'The moments', blurb: 'What you hear when a target is met, a record falls, or a goal lands.' },
  { id: 'reps', label: 'Rep counts', blurb: `Each rep as it lands. Past ${REP_CLIP_MAX}, the device voice takes over.` },
];

/* Every clip: key (also the filename), group, the label shown on the page,
   and what to say into the microphone. */
const CUES = [];
for (let n = COUNT_CLIPS; n >= 1; n--) {
  CUES.push({ key: `count-${n}`, group: 'countin', label: cap(numberWord(n)), say: numberWord(n) });
}
CUES.push({ key: 'go', group: 'countin', label: 'Begin', say: 'Begin — or Go, or whatever actually gets you moving' });
CUES.push({ key: 'target', group: 'moments', label: 'Target reached', say: 'target reached' });
CUES.push({ key: 'record', group: 'moments', label: 'New record', say: 'new record' });
CUES.push({ key: 'goal', group: 'moments', label: 'Goal met', say: 'goal met' });
for (let n = 1; n <= REP_CLIP_MAX; n++) {
  CUES.push({ key: `rep-${n}`, group: 'reps', label: cap(numberWord(n)), say: numberWord(n) });
}

const KEYS = new Set(CUES.map(c => c.key));
const cueFor = key => CUES.find(c => c.key === key) || null;

/* Which clip an announcement maps to, or null when it has none and must
   fall back to the device voice.

     kind 'rep'    text is the rep number
     kind 'count'  text is a count-in number
     kind 'go'     words are countdown.GO_WORD, or 'target' from the meter
     'record' / 'goal'   the celebrations
     'begin'       an exercise name — never a clip (see the header)

   Numbers arrive as numbers or as strings; anything that is not a whole
   number in range gets null, never a wrong clip. */
function clipKey(kind, text) {
  if (kind === 'rep' || kind === 'count') {
    const n = typeof text === 'number' ? text : parseInt(String(text), 10);
    if (!Number.isInteger(n) || n < 1) return null;
    if (kind === 'rep') return n <= REP_CLIP_MAX ? `rep-${n}` : null;
    return n <= COUNT_CLIPS ? `count-${n}` : null;
  }
  if (kind === 'go') return String(text || '').toLowerCase() === 'target' ? 'target' : 'go';
  if (kind === 'record' || kind === 'goal') return kind;
  return null;
}

/* ---------- files ---------- */

const CLIP_EXT = 'wav';
function clipFileName(key) { return `${key}.${CLIP_EXT}`; }

/* The key a file in the Voice folder stands for, or null for any file that
   is not one of ours — a stray recording or a note dropped in the folder
   must be ignored, not played as rep seven. */
function keyFromFileName(name) {
  const m = String(name || '').match(/^([a-z]+-?\d*)\.wav$/i);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return KEYS.has(key) ? key : null;
}

/* ---------- the take, cleaned up ---------- */

/* Stored sample rate. Speech is intelligible well below this; 22.05 kHz
   keeps a "seventeen" crisp and a full set of clips under 4 MB. */
const CLIP_RATE = 22050;
/* Longest clip kept, in ms. "Twenty-seven" fits in one second; three is
   a hard stop so a forgotten microphone cannot write a minute of room tone. */
const MAX_CLIP_MS = 3000;

/* Root-mean-square level of a block, 0..1 — the number the level meter
   draws while recording. */
function rms(samples) {
  if (!samples || !samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/* Join recorder blocks into one array. */
function concatSamples(chunks) {
  let total = 0;
  for (const c of chunks || []) total += c.length;
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks || []) { out.set(c, at); at += c.length; }
  return out;
}

/* Cut the silence off both ends, keeping `padMs` of room on each side so
   the word does not start mid-consonant. Threshold is on the absolute
   sample value; 0.02 sits above room tone on a phone and well below any
   spoken syllable. Returns an EMPTY array when nothing crossed it — the
   caller treats that as "nothing was heard", not as a very short clip. */
function trimSilence(samples, rate, opts) {
  const o = opts || {};
  const threshold = o.threshold == null ? 0.02 : o.threshold;
  const pad = Math.round(((o.padMs == null ? 60 : o.padMs) / 1000) * rate);
  let start = -1, end = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) { if (start < 0) start = i; end = i; }
  }
  if (start < 0) return new Float32Array(0);
  return samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad + 1));
}

/* Scale so the loudest sample sits at `peak`. A quiet take on a phone held
   at arm's length is the common case, and a rep count you cannot hear over
   your own breathing is a clip you will re-record. Silence stays silence. */
function normalizePeak(samples, peak) {
  const target = peak == null ? 0.9 : peak;
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  if (!max) return samples.slice();
  const g = target / max;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return out;
}

/* Linear resampling. Speech at these rates does not need a windowed sinc;
   what it needs is to not be 48 kHz for no reason. Same rate → a copy. */
function resample(samples, fromRate, toRate) {
  if (!samples.length || fromRate === toRate) return samples.slice();
  const ratio = fromRate / toRate;
  const n = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(samples.length - 1, lo + 1);
    const t = pos - lo;
    out[i] = samples[lo] * (1 - t) + samples[hi] * t;
  }
  return out;
}

/* 16-bit PCM mono WAV. 44-byte canonical header, little-endian, no
   extension chunks — the shape every decoder, including iOS WebKit's, has
   accepted since the format existed. */
function encodeWav(samples, rate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const str = (at, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);       // PCM chunk size
  dv.setUint16(20, 1, true);        // PCM
  dv.setUint16(22, 1, true);        // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true); // byte rate
  dv.setUint16(32, 2, true);        // block align
  dv.setUint16(34, 16, true);       // bits per sample
  str(36, 'data');
  dv.setUint32(40, n * 2, true);
  let at = 44;
  for (let i = 0; i < n; i++, at += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/* Read the header back — what the tests check, and what a page can show
   ("1.2 s") without decoding audio. Null for anything that is not our WAV. */
function wavInfo(buf) {
  if (!buf || buf.byteLength < 44) return null;
  const dv = new DataView(buf);
  const tag = (at, len) => { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(at + i)); return s; };
  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE') return null;
  const channels = dv.getUint16(22, true);
  const rate = dv.getUint32(24, true);
  const bits = dv.getUint16(34, true);
  const bytes = dv.getUint32(40, true);
  if (!rate || !channels || !bits) return null;
  const samples = bytes / (channels * (bits / 8));
  return { channels, rate, bits, samples, seconds: samples / rate };
}

/* A raw take → the clip that gets saved. Trim, normalise, resample, cap,
   encode. Returns null when the take held nothing above the silence
   threshold, so the caller can say "nothing heard" rather than saving a
   clip of room tone that plays as a pause on rep nine. */
function prepareClip(samples, rate) {
  const trimmed = trimSilence(samples, rate);
  if (!trimmed.length) return null;
  const levelled = normalizePeak(trimmed);
  let out = resample(levelled, rate, CLIP_RATE);
  const cap = Math.round((MAX_CLIP_MS / 1000) * CLIP_RATE);
  if (out.length > cap) out = out.slice(0, cap);
  return { wav: encodeWav(out, CLIP_RATE), samples: out, rate: CLIP_RATE, seconds: out.length / CLIP_RATE };
}

/* Where the recording stands: how many of the list exist. `keys` is
   whatever is on disk (a Set or array of keys). */
function progressOf(keys) {
  const have = new Set(keys || []);
  const missing = CUES.filter(c => !have.has(c.key));
  return { recorded: CUES.length - missing.length, total: CUES.length, missing };
}

module.exports = {
  COUNT_CLIPS, REP_CLIP_MAX, GROUPS, CUES, CLIP_EXT, CLIP_RATE, MAX_CLIP_MS,
  numberWord, cueFor, clipKey, clipFileName, keyFromFileName,
  rms, concatSamples, trimSilence, normalizePeak, resample, encodeWav, wavInfo, prepareClip, progressOf,
};
