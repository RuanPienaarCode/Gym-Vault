'use strict';
/* W4-10 / L3-14 (usability fix wave 2, 20 Oct 2026): ONE CAPTURE AT A TIME, EVEN THROUGH THE MIC'S START-UP.

   getUserMedia takes a moment (a permission sheet, the audio session switching). In that window the
   big button already says "Tap to stop", and the page's phase was already 'recording'. So:
     tap 1  record   -> phase recording, getUserMedia #1 pending
     tap 2  "stop"   -> no recorder yet: phase back to ready, page re-rendered
     tap 3  record   -> a SECOND capture (getUserMedia #2)
   then #1 resolved into the 'recording' phase tap 3 had set and was ADOPTED, and #2 replaced it as
   ui.rec: the first microphone stream and AudioContext were never released (the mic indicator stays
   on, two captures). Taps are now ignored while a capture is starting; a late microphone from a page
   that was left (or a wizard restarted) is released when it arrives; and sound.unlock() still runs in
   the tap's own stack BEFORE getUserMedia is awaited (the iOS gesture rule).

   Drives the real page-voice.js and voice-record.js over a fake DOM and a fake audio engine whose
   getUserMedia is resolved by hand. Synthetic data only. */
const assert = require('node:assert');
const path = require('node:path');
const { mkNode } = require('./f3-stub.js');
/* The stub's style is a plain object; page-voice writes the level meter through setProperty. */
{ const make = global.document.createElement; global.document.createElement = tag => { const n = make(tag); n.style.setProperty = (k, v) => { n.style[k] = v; }; return n; }; }

/* ---- a fake audio engine; getUserMedia is resolved by the test ---- */
const contexts = [];
class FakeContext {
  constructor() { this.state = 'running'; this.sampleRate = 48000; this.closed = false; this.destination = {}; contexts.push(this); }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
}
FakeContext.prototype.createBufferSource = function () { return { connect() {}, start() {}, stop() {} }; };
global.window = Object.assign(global.window || {}, { AudioContext: FakeContext, setTimeout, clearTimeout });
const pending = [];
const tracks = [];
Object.defineProperty(global, 'navigator', { value: {
  mediaDevices: { getUserMedia: () => new Promise((resolve, reject) => { pending.push({ resolve: () => resolve({ getTracks: () => { const t = { stopped: false, stop() { t.stopped = true; } }; tracks.push(t); return [t]; } }), reject }); }) },
}, configurable: true });

const sound = require('../src/sound');
const order = [];
const realUnlock = sound.unlock;
sound.unlock = () => { order.push('unlock'); return realUnlock.apply(sound, arguments); };
const { stub } = require('./f3-stub.js');
const page = require('../src/page-voice');

let failed = 0;
/* The recorder's own contexts: sound.js's shared playback context is not a capture. */
const captureCtxs = () => contexts.filter(c => c !== sound.audioContext());
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
const check = async (name, fn) => {
  contexts.length = 0; pending.length = 0; tracks.length = 0; order.length = 0;
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

function mount() {
  const ctx = {
    state: { page: 'voice' }, settings: { soundMode: 'silent' },
    plugin: { settings: {}, saveSettings: async () => {} },
    io: { listVoiceClips: async () => [], readVoiceClip: async () => new ArrayBuffer(0) },
    nav() {}, notice() {},
  };
  const view = { root: null };
  ctx.rerender = () => { view.root = mkNode('div'); page.render(ctx, view.root); };
  ctx.rerender();
  const btns = () => view.root.querySelectorAll('button');
  return { ctx, view, btns };
}
const recBtn = view => view.root.querySelectorAll('button').find(b => /gv-voice-rec/.test(b.className));
const startWizard = m => { m.btns().find(b => /Record the missing/.test(b.textContent)).click(); };

(async () => {
  await check('a stop and a record tap inside the mic start-up are ignored: one capture, one context', async () => {
    const m = mount(); startWizard(m); await settle();
    recBtn(m.view).click();                       // tap 1: record
    assert.strictEqual(pending.length, 1, 'tap 1 asks for the microphone once');
    assert.strictEqual(captureCtxs().length, 1);
    recBtn(m.view).click();                       // tap 2: "stop" before the mic is up
    recBtn(m.view).click();                       // tap 3: record again
    assert.strictEqual(pending.length, 1, `a second getUserMedia was asked for (${pending.length}): two captures, and the first one can never be released`);
    assert.strictEqual(captureCtxs().length, 1, `${captureCtxs().length} capture AudioContexts exist`);
  });

  await check('the microphone that arrives is the one capture, and stopping it releases every stream and context', async () => {
    const m = mount(); startWizard(m); await settle();
    recBtn(m.view).click();
    recBtn(m.view).click(); recBtn(m.view).click();
    pending[0].resolve(); await settle();
    recBtn(m.view).click();                       // now live: a real stop
    await settle();
    assert.strictEqual(tracks.length, 1, 'one microphone stream');
    assert.ok(tracks.every(t => t.stopped), 'a microphone track is still live after the stop');
    assert.ok(captureCtxs().every(c => c.closed), `${captureCtxs().filter(c => !c.closed).length} capture AudioContext(s) never closed`);
  });

  await check('leaving the page while the mic starts: the late microphone is released, and a fresh capture can start after', async () => {
    const m = mount(); startWizard(m); await settle();
    recBtn(m.view).click();
    m.ctx.state.pageCleanup();                    // the view navigates away
    pending[0].resolve(); await settle();
    assert.ok(tracks.length === 1 && tracks[0].stopped, 'the mic that came up after we left is still open');
    assert.ok(captureCtxs().every(c => c.closed), 'its context is still open');
    m.ctx.rerender();                             // back on the page
    recBtn(m.view).click();
    assert.strictEqual(pending.length, 2, 'after returning, the record button must work again (a stuck "starting" flag swallowed the tap)');
  });

  await check('a refused microphone clears the start-up state: the next tap tries again', async () => {
    const m = mount(); startWizard(m); await settle();
    recBtn(m.view).click();
    const e = new Error('denied'); e.name = 'NotAllowedError';
    pending[0].reject(e); await settle();
    assert.ok(captureCtxs().every(c => c.closed), 'a refused microphone left the capture AudioContext open (on iOS that holds the audio session in play-and-record)');
    recBtn(m.view).click();
    assert.strictEqual(pending.length, 2, 'the tap after a refusal did nothing');
  });

  await check('iOS gesture rule: sound.unlock() runs in the tap, before getUserMedia is asked for', async () => {
    const m = mount(); startWizard(m); await settle();
    const gum = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = (...a) => { order.push('getUserMedia'); return gum(...a); };
    recBtn(m.view).click();
    navigator.mediaDevices.getUserMedia = gum;
    assert.deepStrictEqual(order.slice(0, 2), ['unlock', 'getUserMedia'], `order was ${order.join(' > ')}`);
  });

  if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
  console.log('w4-voice-start OK');
})();
