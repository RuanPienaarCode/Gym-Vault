'use strict';
/* R1-06 (usability fix wave 20 Oct 2026): "YOUR VOICE" IS PRINTED ONCE.

   With no clip recorded the page showed the toolbar's <h2>Your voice</h2> and, a
   few lines below, the hero's <h3> with the same two words: a heading the page has
   already said. The hero's job is the PROGRESS ("3 of 52"), so with nothing recorded
   it now says "0 of 52", which is also the truth the progress bar underneath draws.
   Built through the real page-voice.render against the shared DOM stub. */
const assert = require('node:assert');
const Module = require('node:module');
const stub = require('./plans-dom-stub.js');

const baseDoc = stub.makeDocument();
/* the shared stub's style object is a plain bag (the progress bar writes a custom property) and has no childNodes */
global.document = Object.assign({}, baseDoc, { createElement: tag => { const n = baseDoc.createElement(tag); n.style.setProperty = (k, v) => { n.style[k] = v; }; Object.defineProperty(n, 'childNodes', { get: () => n.children }); return n; } });
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub.obsidianStub : origLoad.call(this, request, ...rest); };

const voiceClips = require('../src/voice-clips');
voiceClips.loadClips = () => Promise.resolve();
const sound = require('../src/sound');
const voicePack = require('../src/voice-pack');
const page = require('../src/page-voice');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

const headings = node => {
  const out = [];
  (function walk(n) {
    if (!n || n.nodeType === 3) return;
    if (/^h[1-6]$/.test(n.tag)) out.push({ tag: n.tag, text: n.textContent.trim() });
    for (const c of n.children || []) walk(c);
  })(node);
  return out;
};
const render = recordedKeys => {
  const orig = sound.clipKeys;
  sound.clipKeys = () => new Set(recordedKeys);
  try {
    const root = global.document.createElement('div');
    const ctx = { state: { voiceUi: { queue: [], at: 0, phase: 'idle', rec: null, take: null, takeBuffer: null, error: '', loaded: true } }, settings: { soundMode: 'voice' }, io: {}, nav() {}, rerender() {}, plugin: { settings: {}, saveSettings() {} }, app: {} };
    page.render(ctx, root);
    return headings(root);
  } finally { sound.clipKeys = orig; }
};

check('nothing recorded: no two headings on the page read the same', () => {
  const hs = render([]);
  assert.ok(hs.length >= 2, `expected the toolbar and the hero headings, got ${JSON.stringify(hs)}`);
  const seen = new Set();
  for (const h of hs) { assert.ok(!seen.has(h.text), `"${h.text}" is printed twice: ${JSON.stringify(hs)}`); seen.add(h.text); }
});

check('nothing recorded: the hero heading is the progress, "0 of N"', () => {
  const hs = render([]);
  const total = voicePack.progressOf(new Set()).total;
  assert.ok(hs.some(h => h.tag === 'h3' && h.text === `0 of ${total}`), `hero heading is ${JSON.stringify(hs.filter(h => h.tag === 'h3'))}, want "0 of ${total}"`);
});

check('some recorded: the hero still shows the count', () => {
  const key = voicePack.CUES[0].key;
  const hs = render([key]);
  const total = voicePack.progressOf(new Set()).total;
  assert.ok(hs.some(h => h.tag === 'h3' && h.text === `1 of ${total}`), JSON.stringify(hs));
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-voice-title OK');
