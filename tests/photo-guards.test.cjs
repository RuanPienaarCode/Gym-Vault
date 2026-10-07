'use strict';
/* Structural guards for the progress-photo feature.

   The suite renders no DOM, so these check the seams that a runtime test
   caught once and would not catch again on a machine without a browser. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* GUARD 1: a photo must never be left INVISIBLE by a fade that didn't run.

   Rendering is throttled while a pane is hidden, and Obsidian hides panes
   whenever you switch tabs. The viewer sets opacity 0 then transitions to 1;
   if that transition never ticks, the photo stays at 0 and the page looks
   empty. Verified live: with document.visibilityState 'hidden', the computed
   opacity sat at 0 indefinitely until a setTimeout backstop was added.
   requestAnimationFrame is NOT a valid backstop — it does not run at all
   while hidden, which is exactly the case that breaks. */
{
  const code = strip(read('photo-viewer.js'));
  assert.ok(/setTimeout\(/.test(code),
    'photo-viewer must keep a setTimeout backstop that forces the fade\'s end state — ' +
    'a hidden pane never ticks the transition and the photo stays invisible.');
  assert.ok(!/requestAnimationFrame/.test(code),
    'photo-viewer must not depend on requestAnimationFrame: it does not run while the pane ' +
    'is hidden, which is the very case that leaves the photo at opacity 0.');
  assert.ok(/prefers-reduced-motion/.test(read('photo-viewer.js')),
    'the cross-dissolve must be skippable under prefers-reduced-motion');
}

/* GUARD 2: the camera must be released.

   A WebView that keeps a MediaStream open leaves the phone's camera active
   and draining after the modal is gone. */
{
  const code = strip(read('photo-capture.js'));
  assert.ok(/getTracks\(\)/.test(code) && /\.stop\(\)/.test(code),
    'photo-capture must stop every MediaStream track');
  assert.ok(/onClose\(\)\s*\{[\s\S]*?stopStream\(\)/.test(code),
    'photo-capture must release the camera in onClose(), not only on the shutter — ' +
    'Escape and backdrop dismissal bypass the shutter entirely.');
  assert.ok(/liveCameraAvailable/.test(code) && /catch\s*\(/.test(code),
    'photo-capture must feature-detect getUserMedia AND handle its rejection — ' +
    'Obsidian\'s iOS WebView can expose the API and still refuse the permission.');
}

/* GUARD 3: body photos must never reach an export.

   The exporters walk `data`, so photos are deliberately NOT loaded into it.
   This is the same class of leak as the profile spread fixed in 0.3.0, and
   the consequence here is worse. */
{
  const exportCode = strip(read('export.js'));
  for (const forbidden of ['photo', 'Photo', 'Progress Photos']) {
    assert.ok(!exportCode.includes(forbidden),
      `export.js must not reference '${forbidden}' — progress photos are body images and ` +
      'must never be carried into an export in any format.');
  }
  const dataCode = strip(read('data.js'));
  const loadAll = dataCode.match(/async function loadAll\(\)[\s\S]*?\n  \}/);
  assert.ok(loadAll, 'loadAll not found in data.js — renamed?');
  assert.ok(!/listPhotos|photoSrc|Progress Photos/.test(loadAll[0]),
    'loadAll must not pull photos into `data` — the exporters walk `data`, and a body photo ' +
    'must not be one refactor away from an export.');
}

/* GUARD 4: pose keys are folder names on the user's disk.

   Renaming or reordering one orphans every photo already filed under it. */
{
  const { POSES } = require('../src/progress-photos');
  assert.deepStrictEqual(POSES.map(p => p.key), ['standing', 'flexing', 'side', 'back'],
    'pose keys are FOLDER NAMES on disk — changing one orphans the user\'s existing photos. ' +
    'Add new poses at the end; never rename or reorder.');
}

/* GUARD 5: photos are written with createBinary and read via the host's own
   resource path. A file:// URL does not resolve inside the app's WebView, and
   reading bytes into a blob: URL would hold every thumbnail in memory. */
{
  const code = strip(read('data.js'));
  assert.ok(/createBinary\(path, data\)/.test(code), 'savePhoto must write bytes with createBinary');
  assert.ok(/getResourcePath/.test(code), 'photoSrc must use the host resource path, not file:// or blob:');
}

/* GUARD 6: the camera is released on EVERY path — behaviourally.

   GUARD 2 above only greps for getTracks()/stopStream, which is why this
   slipped (0.12.0 audit, L6-01): tapping "Overlay on/off" in live mode
   re-rendered the whole modal, renderLive() asked getUserMedia for a SECOND
   stream and overwrote this.stream, so the first stream was orphaned with its
   camera still on, and close/shutter stopped only the newest. The README
   promises "the stream is released the moment you leave it".

   This drives the real PhotoCaptureModal against a fake navigator.mediaDevices
   and counts what is still LIVE (an unstopped track), not what the source
   mentions. The DOM stub reports isConnected: true for every node, as the
   audit's repro did — so a pass cannot come from the host-detached check
   alone; the modal has to know it was closed. */
async function guard6() {
  const Module = require('node:module');

  const mk = tag => {
    const n = {
      nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, isConnected: true, parentNode: null,
      classList: {
        add(c) { const s = new Set(String(n.className).split(/\s+/).filter(Boolean)); s.add(c); n.className = [...s].join(' '); },
        remove(c) { n.className = String(n.className).split(/\s+/).filter(x => x && x !== c).join(' '); },
        contains(c) { return String(n.className).split(/\s+/).includes(c); },
        toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; if (want) this.add(c); else this.remove(c); return want; },
      },
      addClass(c) { n.classList.add(c); },
      setAttribute(k, v) { n.attrs[k] = String(v); },
      getAttribute(k) { return n.attrs[k]; },
      addEventListener(ev, fn) { (n.listeners[ev] = n.listeners[ev] || []).push(fn); },
      append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parentNode = n; n.children.push(k); } },
      appendChild(k) { n.append(k); return k; },
      get firstChild() { return n.children[0] || null; },
      removeChild(k) { n.children = n.children.filter(c => c !== k); if (k && k.nodeType === 1) k.parentNode = null; },
      replaceWith(next) {
        const p = n.parentNode;
        if (!p) return;
        p.children = p.children.map(c => (c === n ? next : c));
        next.parentNode = p; n.parentNode = null;
      },
      remove() { if (n.parentNode) n.parentNode.removeChild(n); },
      get textContent() { return n.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
      querySelector(sel) {
        const want = sel.replace(/^\./, ''); const byTag = sel.charAt(0) !== '.';
        const walk = m => { for (const c of m.children) { if (c.nodeType !== 1) continue; if (byTag ? c.tag === want : String(c.className).split(/\s+/).includes(want)) return c; const r = walk(c); if (r) return r; } return null; };
        return walk(n);
      },
    };
    return n;
  };
  const all = (n, out = []) => { out.push(n); for (const c of n.children) if (c.nodeType === 1) all(c, out); return out; };
  const byClass = (n, cls) => all(n).filter(x => String(x.className).split(/\s+/).includes(cls));

  /* A camera whose answers can be held back, so "the user closed the modal
     before the camera answered" and "two requests in flight" are expressible. */
  function fakeCamera(manual) {
    const requests = [];
    const cam = {
      requests,
      mediaDevices: {
        getUserMedia() {
          return new Promise((resolve, reject) => {
            const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
            const stream = { getTracks: () => tracks, tracks };
            const req = { stream, delivered: false, deliver() { req.delivered = true; resolve(stream); }, fail() { reject(new Error('NotAllowedError')); } };
            requests.push(req);
            if (!manual) req.deliver();
          });
        },
      },
      /* Streams the page has actually been handed and has not stopped: the
         phone's camera light is on while this is non-zero. */
      live() { return requests.filter(r => r.delivered && r.stream.tracks.some(t => !t.stopped)).length; },
    };
    return cam;
  }
  const tick = () => new Promise(r => setTimeout(r, 5));

  const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const savedDocument = globalThis.document;
  globalThis.document = { createElement: mk, createElementNS: (_ns, t) => mk(t), createTextNode: t => ({ nodeType: 3, tag: '#text', text: String(t) }) };

  const obsidian = {
    setIcon() {}, Notice: class {},
    Modal: class { constructor(app) { this.app = app; this.contentEl = mk('div'); this.modalEl = mk('div'); } close() { this.onClose(); } },
  };
  const origLoad = Module._load;
  Module._load = (req, ...rest) => (req === 'obsidian' ? obsidian : origLoad(req, ...rest));
  let PhotoCaptureModal;
  try { ({ PhotoCaptureModal } = require('../src/photo-capture')); } finally { Module._load = origLoad; }

  const setCamera = cam => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: cam.mediaDevices } });
  const open = opts => {
    const m = new PhotoCaptureModal({}, Object.assign({ pose: 'standing', ghostSrc: 'app://previous-photo.jpg', onCaptured() {} }, opts));
    m.onOpen();
    return m;
  };
  const overlayKind = m => {
    const stage = byClass(m.contentEl, 'gv-photo-stage')[0];
    const last = stage.children[stage.children.length - 1];
    return last.tag === 'img' ? 'ghost-image' : last.tag === 'svg' ? 'outline' : last.tag;
  };
  const chip = m => byClass(m.contentEl, 'gv-chip')[0];

  /* Every case runs and is reported by name, so a regression prints each
     wrong value instead of stopping at the first. */
  const failures = [];
  const check = async (name, fn) => {
    try { await fn(); } catch (e) { failures.push(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`); }
  };

  try {
    await check('A. open, toggle Overlay twice, close: one getUserMedia, nothing live', async () => {
      const cam = fakeCamera(false); setCamera(cam);
      const m = open(); await tick();
      assert.strictEqual(cam.live(), 1, 'sanity: the camera is on while the photo screen is open');
      assert.strictEqual(overlayKind(m), 'ghost-image', 'sanity: the previous photo starts as the overlay');
      assert.strictEqual(chip(m).textContent, 'Overlay on');
      chip(m).listeners.click[0]({}); await tick();
      assert.strictEqual(overlayKind(m), 'outline', 'Overlay off swaps the ghost for the pose outline');
      assert.strictEqual(chip(m).textContent, 'Overlay off', 'the chip reports the new state');
      assert.strictEqual(chip(m).attrs['aria-pressed'], 'false');
      assert.ok(chip(m).classList.contains('clickable-icon'), 'a rebuilt chip must keep the host-button opt-out el() gives every button');
      chip(m).listeners.click[0]({}); await tick();
      assert.strictEqual(overlayKind(m), 'ghost-image', 'Overlay on brings the ghost back');
      assert.strictEqual(chip(m).textContent, 'Overlay on');
      assert.strictEqual(cam.requests.length, 1,
        `toggling the overlay must not ask the camera again: getUserMedia was called ${cam.requests.length} times`);
      assert.strictEqual(cam.live(), 1, 'the one stream stays live while the screen is open');
      m.close();
      assert.strictEqual(cam.live(), 0,
        `after close, ${cam.live()} stream(s) are still live — the camera light stays on`);
    });

    /* B. Closed before the camera answered: the late stream must be stopped. */
    await check('B. closed before the camera answered: the late stream is stopped on arrival', async () => {
      const cam = fakeCamera(true); setCamera(cam);
      const m = open(); await tick();
      m.close();
      cam.requests[0].deliver(); await tick();
      assert.strictEqual(cam.live(), 0, 'a stream that arrives after the modal closed must be stopped on arrival');
    });

    /* C. Any re-render while a stream is live (not just the overlay chip) —
       the old stream must not be orphaned. */
    await check('C. a re-render while a stream is live leaves exactly the newest live', async () => {
      const cam = fakeCamera(false); setCamera(cam);
      const m = open(); await tick();
      m.render(); await tick();
      assert.strictEqual(cam.live(), 1, `a re-render left ${cam.live()} streams live; exactly the newest may be`);
      m.close();
      assert.strictEqual(cam.live(), 0, 'close stops the newest stream');
    });

    /* D. Two requests in flight (a re-render before the camera answered):
       the superseded one is stopped whichever order they arrive in. */
    for (const order of [[0, 1], [1, 0]]) await check(`D. two requests in flight, answered in order ${order}: only the newest stays live`, async () => {
      const cam = fakeCamera(true); setCamera(cam);
      const m = open(); await tick();
      m.render(); await tick();
      assert.strictEqual(cam.requests.length, 2, 'sanity: the re-render asked again');
      for (const i of order) { cam.requests[i].deliver(); await tick(); }
      assert.strictEqual(cam.live(), 1, `order ${order}: the superseded request's stream must be stopped, the newest kept (live=${cam.live()})`);
      assert.strictEqual(cam.requests[1].stream.tracks[0].stopped, false, `order ${order}: the NEWEST request is the one that stays live`);
      m.close();
      assert.strictEqual(cam.live(), 0, `order ${order}: close leaves nothing live`);
    });

    /* E. A superseded request that is REFUSED late must not tear down the
       live screen the newer request is driving. */
    await check('E. a late refusal of a superseded request does not tear down the live screen', async () => {
      const cam = fakeCamera(true); setCamera(cam);
      const m = open(); await tick();
      m.render(); await tick();
      cam.requests[1].deliver(); await tick();
      cam.requests[0].fail(); await tick();
      assert.ok(byClass(m.contentEl, 'gv-photo-shoot').some(b => /Take photo/.test(b.textContent)),
        'a stale rejection replaced the live camera screen with the handoff fallback');
      assert.strictEqual(cam.live(), 1, 'a stale rejection must not stop the newer stream');
      m.close();
      assert.strictEqual(cam.live(), 0);
    });

    /* F. Whatever else may have left a stream on the modal while a request was
       in flight, the arriving stream replaces it by stopping it first. */
    await check('F. a stream already held when a new one arrives is stopped, not overwritten', async () => {
      const cam = fakeCamera(true); setCamera(cam);
      const m = open(); await tick();
      const held = { tracks: [{ stopped: false, stop() { this.stopped = true; } }] };
      held.getTracks = () => held.tracks;
      m.stream = held;
      cam.requests[0].deliver(); await tick();
      assert.strictEqual(held.tracks[0].stopped, true, 'the earlier stream was overwritten while its camera was still on');
      m.close();
      assert.strictEqual(cam.live(), 0);
    });
  } finally {
    if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete globalThis.navigator;
    if (hadDocument) globalThis.document = savedDocument; else delete globalThis.document;
  }
  if (failures.length) throw new Error(`camera-release guard: ${failures.length} case(s) failed\n${failures.join('\n')}`);
}

guard6().then(
  () => console.log('photo guards OK (fade cannot strand a photo invisible, camera released on every path, photos never exported)'),
  e => { console.error(e.message); process.exit(1); },
);
