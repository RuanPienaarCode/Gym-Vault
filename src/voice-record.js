'use strict';
/* The microphone — the only place in this app that listens.

   Captures RAW PCM through WebAudio rather than through MediaRecorder, and
   that choice is the whole design. MediaRecorder hands back a compressed
   file in whatever container the engine likes (AAC/MP4 on an iPhone,
   Opus/WebM on desktop Chrome), and neither engine decodes the other's. A
   vault syncs between exactly those two. Tapping the stream through a
   ScriptProcessorNode instead yields Float32 samples on every engine, which
   voice-pack.js turns into a plain WAV that every decoder reads. No codec
   is ever involved.

   ScriptProcessorNode is deprecated in favour of AudioWorklet, and stays
   here on purpose: an AudioWorklet needs a module loaded from a URL, and a
   plugin bundle inside Obsidian's WebView has no URL to load it from
   without a blob: dance that iOS treats with suspicion. The deprecated node
   still ships in every current engine, and the guard here says so plainly
   if it ever stops.

   THE GESTURE. iOS resumes the AudioContext only from inside a user tap,
   and getUserMedia is async — so the caller must sound.unlock() in the tap
   handler BEFORE awaiting start(). This module cannot do that for it: by
   the time start() runs, the gesture stack may already be gone.

   ITS OWN CONTEXT. The take is tapped through an AudioContext created for
   it and CLOSED when it ends — never sound.js's shared one. On iOS a
   microphone stream moves the whole audio session to play-and-record (output
   to the call earpiece, at earpiece volume) and any context alive through
   that comes out the far side 'interrupted'. Closing the capture context is
   what hands the session back, so the playback context is never the one
   that lived through a recording. The two run at whatever rates the engine
   gives them; voice-pack.resample makes that nobody's problem.

   The stream and the context are released the moment recording stops or is
   cancelled; there is no state here that outlives one take. */

const sound = require('./sound');
const { rms, concatSamples, MAX_CLIP_MS } = require('./voice-pack');

/* Can this device record at all? Three things: a microphone API, WebAudio
   to tap it, and the tap node itself. */
function canRecord() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const w = typeof window === 'undefined' ? null : window;
  if (!nav || !nav.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') return false;
  if (!sound.capabilities().audio) return false;
  const Ctor = w && (w.AudioContext || w.webkitAudioContext);
  return !!(Ctor && Ctor.prototype && typeof Ctor.prototype.createScriptProcessor === 'function');
}

/* Turn a getUserMedia failure into a sentence a person can act on. */
function describeError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was refused. Allow it for Obsidian in your device settings and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return `Could not start recording (${(e && e.message) || e}).`;
}

/* Start a take. Resolves to a handle once the microphone is live:
     stop()    -> {samples: Float32Array, rate}   the raw take
     cancel()  -> releases everything, returns nothing
   opts.onLevel(rms) fires per audio block for a meter; opts.onLimit() fires
   ONCE when the take reaches maxMs (default MAX_CLIP_MS) — the caller then
   calls stop(), which is how a forgotten microphone cannot record a minute
   of room tone. Rejects with an Error whose message is already user-facing. */
async function startRecording(opts) {
  const o = opts || {};
  if (!canRecord()) throw new Error('This device cannot record here — no microphone access in this app.');
  /* Created and resumed HERE, synchronously, while the caller's tap stack is
     still alive — an async function runs up to its first await inside the
     caller's frame. Created after the await it would start suspended with
     no gesture left to wake it. */
  const Ctor = window.AudioContext || window.webkitAudioContext;
  let ac = null;
  try { ac = new Ctor(); } catch (e) { ac = null; }
  if (!ac) throw new Error('No audio engine is available.');
  try { if (ac.state !== 'running') ac.resume(); } catch (e) { /* retried below */ }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) { throw new Error(describeError(e)); }

  /* Belt and braces: unlock() already resumed it in the tap, but a context
     that went to sleep between then and now would record silence. */
  try { if (ac.state === 'suspended') await ac.resume(); } catch (e) { /* recorded silence is reported by prepareClip */ }

  const maxMs = o.maxMs || MAX_CLIP_MS;
  const chunks = [];
  let total = 0;
  let limited = false;
  let live = true;

  const source = ac.createMediaStreamSource(stream);
  const tap = ac.createScriptProcessor(4096, 1, 1);
  /* A processor only runs while connected to the destination on some
     engines; a muted gain in between keeps the microphone out of the
     speakers, which on a phone would be a feedback whistle. */
  const sink = ac.createGain();
  sink.gain.value = 0;

  tap.onaudioprocess = e => {
    if (!live) return;
    const block = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(block));
    total += block.length;
    if (o.onLevel) { try { o.onLevel(rms(block)); } catch (err) { /* a meter must never stop a take */ } }
    if (!limited && (total / ac.sampleRate) * 1000 >= maxMs) {
      limited = true;
      if (o.onLimit) { try { o.onLimit(); } catch (err) { /* ignore */ } }
    }
  };
  source.connect(tap);
  tap.connect(sink);
  sink.connect(ac.destination);

  const release = () => {
    if (!live) return;
    live = false;
    tap.onaudioprocess = null;
    try { source.disconnect(); } catch (e) { /* ignore */ }
    try { tap.disconnect(); } catch (e) { /* ignore */ }
    try { sink.disconnect(); } catch (e) { /* ignore */ }
    for (const t of stream.getTracks()) { try { t.stop(); } catch (e) { /* ignore */ } }
    /* Last, and unconditionally: this is what gives iOS its speaker back. */
    try { ac.close(); } catch (e) { /* ignore */ }
  };

  return {
    stop() {
      release();
      return { samples: concatSamples(chunks), rate: ac.sampleRate };
    },
    cancel() { release(); },
    isLive: () => live,
  };
}

module.exports = { canRecord, startRecording, describeError };
