'use strict';
/* The iPhone take that records but plays back silence.

   iOS WebKit moves the audio session to play-and-record while a microphone
   stream is open, and when the stream stops it leaves any AudioContext that
   was alive through it in the NON-STANDARD state 'interrupted' — not
   'suspended'. A resume guarded by `state === 'suspended'` never fires, so
   "hear it" starts a buffer on a context that is not running: the meter
   moved, the WAV is fine, and nothing is heard. Seen on a real iPhone,
   3 Sep 2026, against 0.11.1.

   Two rules, both pinned here against a fake AudioContext:

   1. Playback resumes from ANY non-running state, 'interrupted' included.
   2. The recorder taps the microphone through its OWN context and closes it
      when the take ends, so the shared playback context is never the one
      that lived through a capture session. */
const assert = require('node:assert');

/* A fake engine: enough surface for sound.js and voice-record.js, and a
   ledger of what was called on which instance. */
const made = [];
class FakeContext {
  constructor() {
    this.state = 'interrupted';
    this.sampleRate = 48000;
    this.resumed = 0;
    this.closed = false;
    this.currentTime = 0;
    this.destination = {};
    made.push(this);
  }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createGain() { return { gain: {}, connect() { return this; }, disconnect() {} }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  createOscillator() { return { frequency: {}, connect() { return this; }, start() {}, stop() {} }; }
}
global.window = { AudioContext: FakeContext };
/* node 21+ ships a read-only navigator getter; define over it. */
Object.defineProperty(global, 'navigator', { value: {
  mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
}, configurable: true });

const sound = require('../src/sound');
const { startRecording } = require('../src/voice-record');

/* ---- 1. playback resumes an interrupted context ---- */
const shared = sound.audioContext();
assert.ok(shared instanceof FakeContext, 'the shared context comes from the fake engine');
assert.strictEqual(shared.state, 'interrupted');
assert.strictEqual(sound.playBuffer({ duration: 1 }), true, 'a buffer still starts');
assert.strictEqual(shared.resumed, 1, 'playBuffer must resume a context that is not running, interrupted included');

shared.state = 'interrupted';
sound.unlock();
assert.strictEqual(shared.resumed, 2, 'unlock() must resume an interrupted context');

shared.state = 'running';
sound.playBuffer({ duration: 1 });
assert.strictEqual(shared.resumed, 2, 'a running context is left alone');

/* ---- 2. the recorder owns and closes its own context ---- */
(async () => {
  const before = made.length;
  const rec = await startRecording({});
  assert.strictEqual(made.length, before + 1, 'a take opens a context of its own, not the playback one');
  const own = made[made.length - 1];
  assert.notStrictEqual(own, shared);
  assert.ok(own.resumed >= 1, 'the capture context is resumed before samples are read');
  const raw = rec.stop();
  assert.strictEqual(raw.rate, own.sampleRate, 'the take reports the capture context rate');
  assert.strictEqual(own.closed, true, 'stop() closes the capture context so iOS restores the playback route');
  assert.strictEqual(shared.closed, false, 'the shared playback context is never closed');

  const rec2 = await startRecording({});
  const own2 = made[made.length - 1];
  rec2.cancel();
  assert.strictEqual(own2.closed, true, 'cancel() closes it too');

  console.log('voice playback iOS OK (interrupted resumes; the take has its own context and closes it)');
})().catch(e => { console.error(e); process.exit(1); });
