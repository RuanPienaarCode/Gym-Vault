'use strict';
/* AUDIT 16 NOV 2026 — the Your voice page.

   #27 (Low): Back always went to Profile. The page is reached from the
   `record-voice` command or from Settings as well, so Back landed on a page you
   never visited and pushed `voice` onto the back stack. It uses the shared back
   button the other nested pages use (ctx.back with Profile only as the
   fallback), so Back returns to where you came from.

   #41 (Low): a failed clip delete showed nothing. deleteClip put the error into
   ui.error, which is drawn only inside the wizard card; Delete lives in the clip
   list, where no wizard is open, so a refused trash (Obsidian 1.15's trashFile
   can return false) was silent. The failure is raised as a notice, the way the
   Exercises, Plans and History delete paths do.

   Drives the real page-voice.js over the shared DOM stub. */
const assert = require('node:assert');
const Module = require('node:module');
const stub = require('./plans-dom-stub.js');

const baseDoc = stub.makeDocument();
global.document = Object.assign({}, baseDoc, { createElement: tag => { const n = baseDoc.createElement(tag); n.style.setProperty = (k, v) => { n.style[k] = v; }; Object.defineProperty(n, 'childNodes', { get: () => n.children }); return n; } });
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub.obsidianStub : origLoad.call(this, request, ...rest); };

/* The confirm sheet is a recorder: it hands the test the onConfirm the page passed. */
const modals = require('../src/modals');
const sheets = [];
modals.ConfirmModal = class { constructor(_app, opts) { this.opts = opts; } open() { sheets.push(this.opts); } };
const voiceClips = require('../src/voice-clips');
voiceClips.loadClips = () => Promise.resolve();
const sound = require('../src/sound');
const { CUES } = require('../src/voice-pack');
const page = require('../src/page-voice');

let failed = 0;
const queue = [];
const check = (name, fn) => queue.push([name, fn]);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

function mount(io) {
  const calls = { nav: [], back: [], notices: [], rerenders: 0 };
  const ctx = {
    state: { voiceUi: { queue: [], at: 0, phase: 'idle', rec: null, take: null, takeBuffer: null, error: '', loaded: true, starting: false, captureId: 0 } },
    settings: { soundMode: 'voice' }, plugin: { settings: {}, saveSettings() {} }, app: {},
    io: io || {}, rerender() { calls.rerenders++; },
    nav: (...a) => calls.nav.push(a), back: f => calls.back.push(f), backTo: f => f,
    notice: m => calls.notices.push(m),
  };
  const root = global.document.createElement('div');
  page.render(ctx, root);
  return { ctx, root, calls };
}
const buttons = root => stub.byTag(root, 'button');
const fire = stub.fire;

check('#27 Back goes through the shared back stack, with Profile only as the fallback', () => {
  const { root, calls } = mount();
  const back = buttons(root).find(b => /^Back to /.test(b.attrs['aria-label'] || ''));
  assert.ok(back, `no Back button; buttons: ${JSON.stringify(buttons(root).map(b => b.attrs['aria-label']))}`);
  fire(back, 'click', {});
  assert.deepStrictEqual(calls.nav.filter(a => a[0] === 'profile'), [], 'Back must not navigate to Profile itself: that pushes `voice` onto the stack and lands on a page you never visited');
  assert.deepStrictEqual(calls.back, ['profile'], `ctx.back was called with ${JSON.stringify(calls.back)}`);
});

check('#27 the Back label names where Back will really land (the caller), not Profile', () => {
  const { ctx, root } = mount();
  ctx.backTo = () => 'dashboard';
  const again = global.document.createElement('div');
  page.render(ctx, again);
  const back = buttons(again).find(b => /^Back to /.test(b.attrs['aria-label'] || ''));
  assert.ok(back, 'the page has a Back button');
  assert.ok(!/profile/i.test(back.attrs['aria-label']), `with Today as the caller the label still says "${back.attrs['aria-label']}"`);
  assert.ok(root);
});

check('#41 a refused delete is shown where the user is (a notice), not only inside a wizard card', async () => {
  const key = CUES[0].key;
  sound.setClip(key, { duration: 1 });
  const io = {
    listVoiceClips: async () => [{ key, file: { path: `Gym/Voice/${key}.wav` } }],
    trash: async () => { throw new Error('Could not move "x" to the trash, so nothing was deleted.'); },
  };
  const { root, calls } = mount(io);
  const del = buttons(root).find(b => /^Delete /.test(b.attrs['aria-label'] || ''));
  assert.ok(del, 'a recorded clip has a Delete button');
  sheets.length = 0;
  fire(del, 'click', {});
  assert.strictEqual(sheets.length, 1, 'Delete asks for confirmation first');
  await sheets[0].onConfirm();
  await settle();
  assert.ok(calls.notices.some(m => /could not delete|nothing was deleted/i.test(m)),
    `the failure raised no notice (notices: ${JSON.stringify(calls.notices)}); with no wizard open ui.error is never drawn`);
  assert.ok(sound.hasClip(key), 'and the clip is still there (nothing was lost)');
  sound.setClip(key, null);
});

check('#41 control: a delete that works says nothing and drops the clip', async () => {
  const key = CUES[0].key;
  sound.setClip(key, { duration: 1 });
  let trashed = null;
  const io = {
    listVoiceClips: async () => [{ key, file: { path: `Gym/Voice/${key}.wav` } }],
    trash: async f => { trashed = f.path; },
  };
  const { root, calls } = mount(io);
  const del = buttons(root).find(b => /^Delete /.test(b.attrs['aria-label'] || ''));
  sheets.length = 0;
  fire(del, 'click', {});
  await sheets[0].onConfirm();
  await settle();
  assert.strictEqual(trashed, `Gym/Voice/${key}.wav`);
  assert.deepStrictEqual(calls.notices, [], 'no notice on success');
  assert.ok(!sound.hasClip(key), 'the clip is dropped from the player');
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
  }
  if (failed) { console.error(`audit-1116 content voice: ${failed} of ${queue.length} check(s) FAILED`); process.exit(1); }
  console.log('audit-1116 content voice OK');
})();
