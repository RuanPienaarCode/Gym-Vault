'use strict';
/* THE MUSCLE MAP IN THE FULL-SCREEN VIEWER (media-viewer.js) AND THE THUMBNAIL
   THAT OPENS IT (page-session.js), on the REAL renderer, the REAL modal and the
   REAL guided session, with requestAnimationFrame and IntersectionObserver
   replaced by recorders so "is a frame still queued?" is a fact, not a timing
   guess (tests/muscle-map-render.test.cjs does the same for the renderer alone).

   THE CONTRACT these cases pin:
     - an exercise with a motion opens the viewer ON ITS MAP; "Photos" in the bar
       switches the same dialog to the originals and back; one modal, never two;
     - ONE RULE for playing: media-cycle.js autoPlayMedia (reduced motion, or
       Settings -> Animate exercise images off, means still) decides the map exactly
       as it decides the photos; the Play button is the user's for that viewing;
       previous / next step the still poses and pause, as they do the photos;
     - NO LEAKED LOOP: closing the viewer, switching to the photos, a re-render of
       the live set and leaving the page each end the loop that belonged to them;
     - ONE LOOP VISIBLE: while the viewer's map is open the thumbnail under it
       pauses, and wakes when the viewer closes;
     - the thumbnail is the BARE figure (no switch, legend, labels, fibres), and
       the Basic/Detailed switch in the viewer reaches the map on the page. */
const assert = require('node:assert');
const path = require('node:path');
const H = require('./live-session-harness.js');

/* ---- frame + visibility recorders ---- */
const rafs = new Map();
let rid = 0;
H.win.requestAnimationFrame = fn => { const id = ++rid; rafs.set(id, fn); return id; };
H.win.cancelAnimationFrame = id => { rafs.delete(id); };
const tick = t => { const fns = [...rafs.values()]; rafs.clear(); for (const fn of fns) fn(t); };
const ios = [];
class FakeIO {
  constructor(cb) { this.cb = cb; this.connected = true; ios.push(this); }
  observe(n) { this.node = n; }
  disconnect() { this.connected = false; }
  fire(visible) { if (this.connected) this.cb([{ isIntersecting: visible, target: this.node }]); }
}
H.win.IntersectionObserver = FakeIO;
const seeAll = () => ios.filter(i => i.connected).forEach(i => i.fire(true));

const { openMediaViewer } = require(path.join(H.SRC, 'media-viewer'));
const lib = require(path.join(H.SRC, 'motion-library'));
const { mountMuscleMap } = require(path.join(H.SRC, 'muscle-map'));

const results = [];
const reset = () => {
  H.killProcess(); H.modals.length = 0; H.speech.length = 0; rafs.clear(); ios.length = 0;
  H.win.matchMedia = () => ({ matches: false });
  H.document.visibilityState = 'visible';
  H.document.activeElement = null;
};
const check = async (name, fn) => { reset(); try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
H.N.prototype.focus = function () { H.document.activeElement = this; };
const reduceMotion = () => { H.win.matchMedia = q => ({ matches: /reduce/.test(q) }); };

const PAIR = [{ src: 'https://example.test/0.jpg', tag: 'start' }, { src: 'https://example.test/1.jpg', tag: 'finish' }];
const pushups = H.ex('Push-ups', { muscles: ['chest', 'triceps', 'core'] });
pushups.body = '1. Hands under the shoulders.\n2. Lower.\n3. Press up.';
const motion = lib.motionFor(pushups);
const detailsSaved = [];
const open = (extra, mm) => openMediaViewer({}, Object.assign({
  name: 'Push-ups', frames: PAIR, startIndex: 0, skin: 'apex', accent: 'lime', settings: {},
  muscleMap: Object.assign({ ex: pushups, motion, steps: lib.noteSteps(pushups.body), onDetail: d => detailsSaved.push(d) }, mm || {}),
}, extra || {}));
const btn = (m, label) => H.byLabel(m.contentEl, label);
const modeBtn = m => m.contentEl.querySelectorAll('button').find(b => b.classList.contains('gv-mv-mode'));
const mapNode = m => m.contentEl.querySelector('.gv-mm');
const text = (m, sel) => (m.contentEl.querySelector(sel) || { textContent: '(missing)' }).textContent;
const torsoD = root => root.querySelector('.gv-mm-torso').getAttribute('d');
const attached = () => { const n = new H.N('div'); H.docRoot().appendChild(n); return n; };
const visListeners = () => (H.docListeners.visibilitychange || []).length;

(async () => {
  await check('V1. opens on the map, large, in the viewer; the caption says so; photos are stacked but not shown', async () => {
    const m = open();
    assert.ok(m, 'a viewer opened');
    assert.strictEqual(m.mode, 'map');
    assert.ok(mapNode(m), 'the map is drawn');
    assert.ok(m.contentEl.querySelector('.gv-mv-stage').classList.contains('gv-mv-is-map'), 'the stage is in map mode (CSS swaps the mat and hides the photos)');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'Muscle map');
    assert.ok(m.contentEl.querySelector('.gv-mm-seg'), 'the Basic / Detailed switch is on the visual');
    assert.strictEqual(m.contentEl.querySelectorAll('.gv-mm').length, 1, 'one map');
    assert.strictEqual(H.modals.length, 1, 'one modal');
    m.close();
  });

  await check('V2. "Photos" switches the same dialog to the originals and back; the map\'s loop stops while away', async () => {
    const m = open();
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 1, 'the map is looping');
    const mm = modeBtn(m);
    assert.ok(mm && /Photos/.test(mm.textContent), 'a Photos button in the bar');
    H.click(mm);
    assert.strictEqual(m.mode, 'photos');
    assert.ok(!m.contentEl.querySelector('.gv-mv-stage').classList.contains('gv-mv-is-map'));
    assert.strictEqual(mapNode(m), null, 'the map is gone');
    assert.strictEqual(rafs.size, 0, 'and its loop with it');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'start', 'the photos have their own captions');
    assert.ok(/Muscle map/.test(modeBtn(m).textContent), 'the same button now goes back');
    assert.strictEqual(m.contentEl.querySelectorAll('.gv-mv-img').length, 2);
    assert.strictEqual(H.modals.length, 1, 'still one modal');
    H.click(modeBtn(m));
    assert.strictEqual(m.mode, 'map');
    assert.ok(mapNode(m), 'the map is back');
    assert.strictEqual(m.contentEl.querySelectorAll('.gv-mm').length, 1, 'one map, not two');
    m.close();
  });

  await check('V3. start: "photos" opens on the photos; no photos means no switch; nothing to show means no viewer', async () => {
    const m = open({ start: 'photos' });
    assert.strictEqual(m.mode, 'photos');
    assert.strictEqual(mapNode(m), null, 'the map is not built until asked for');
    m.close();
    const only = open({ frames: [] });
    assert.strictEqual(only.mode, 'map', 'no photos: the map');
    assert.strictEqual(modeBtn(only), undefined, 'and nothing to switch to');
    only.close();
    assert.strictEqual(openMediaViewer({}, { name: 'x', frames: [] }), null);
    assert.strictEqual(openMediaViewer({}, { name: 'x', frames: [], muscleMap: {} }), null, 'a map with no motion is nothing');
  });

  await check('V4. plays by autoPlayMedia: default plays; animateMedia off and reduced motion open still; Play starts it for that viewing only', async () => {
    let m = open();
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 1, 'default: looping');
    assert.ok(/Pause/.test(btn(m, 'Pause animation').textContent), 'the control offers Pause');
    m.close();

    const settings = { animateMedia: false };
    m = open({ settings });
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 0, 'animateMedia off: no loop');
    assert.ok(btn(m, 'Play animation'), 'the control offers Play');
    H.click(btn(m, 'Play animation'));
    seeAll();
    assert.strictEqual(rafs.size, 1, 'Play starts it for this viewing');
    assert.strictEqual(settings.animateMedia, false, 'and does not change the setting');
    H.click(btn(m, 'Pause animation'));
    assert.strictEqual(rafs.size, 0, 'Pause stops it');
    m.close();

    reduceMotion();
    m = open();
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 0, 'reduced motion: still');
    H.click(btn(m, 'Play animation'));
    seeAll();
    assert.strictEqual(rafs.size, 1, 'the user can still press Play');
    m.close();
  });

  await check('V5. previous / next step the resting poses and pause; a tap on a still figure steps too', async () => {
    const m = open({ settings: { animateMedia: false } });
    const first = torsoD(m.contentEl);
    H.click(btn(m, 'Next pose'));
    const second = torsoD(m.contentEl);
    assert.notStrictEqual(second, first, 'next shows another pose');
    H.click(btn(m, 'Next pose'));
    const third = torsoD(m.contentEl);
    assert.ok(third !== second && third !== first, 'three distinct poses');
    H.click(btn(m, 'Previous pose'));
    assert.strictEqual(torsoD(m.contentEl), second, 'previous goes back');
    H.click(m.contentEl.querySelector('.gv-mm-stage'));
    assert.strictEqual(torsoD(m.contentEl), third, 'a tap on the still figure steps forward');
    m.close();

    /* stepping a PLAYING figure pauses it, as stepping photos does */
    const p = open();
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 1);
    H.click(btn(p, 'Next pose'));
    assert.strictEqual(rafs.size, 0, 'a step the user asked for pauses the animation');
    assert.ok(btn(p, 'Play animation'), 'and the control now offers Play');
    p.close();
  });

  await check('V6. closing the viewer ends its loop, observer and listener; open twice leaves one', async () => {
    const vis0 = visListeners();
    const a = open();
    seeAll(); tick(0);
    const b = open();
    seeAll(); tick(16);
    assert.strictEqual(a.closed, true, 'a second open closes the first');
    assert.strictEqual(rafs.size, 1, 'exactly one loop');
    b.close();
    assert.strictEqual(rafs.size, 0, 'close: no frame queued');
    assert.strictEqual(ios.filter(i => i.connected).length, 0, 'close: every observer disconnected');
    assert.strictEqual(visListeners(), vis0, 'close: the visibility listener is gone');
    tick(32);
    assert.strictEqual(rafs.size, 0, 'nothing restarts it');
  });

  await check('V7. the viewer\'s map is exclusive: a thumbnail loop pauses under it and wakes after it', async () => {
    const host = attached();
    const stopThumb = mountMuscleMap(host, { ex: pushups, motion, mini: true, body: 'male', autoPlay: true });
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 1, 'the thumbnail is looping');
    const m = open();
    seeAll();
    tick(100);
    assert.strictEqual(rafs.size, 1, 'one loop while the viewer is open: the viewer\'s, not both');
    const thumbIO = ios[0];
    assert.ok(thumbIO.connected, 'the thumbnail is still mounted, only paused');
    m.close();
    seeAll();
    assert.strictEqual(rafs.size, 1, 'closed: the thumbnail is looping again');
    stopThumb();
    assert.strictEqual(rafs.size, 0);
    /* switching to the photos releases the thumbnail as well */
    const stop2 = mountMuscleMap(attached(), { ex: pushups, motion, mini: true, body: 'male', autoPlay: true });
    seeAll(); tick(0);
    const m2 = open();
    seeAll(); tick(50);
    H.click(modeBtn(m2));
    tick(80);
    assert.strictEqual(rafs.size, 1, 'on the photos the thumbnail runs (the viewer shows none)');
    m2.close(); stop2();
  });

  await check('V8. the Basic/Detailed switch in the viewer is remembered once and reaches the page\'s map without restarting it', async () => {
    const host = attached();
    const stopPage = mountMuscleMap(host, { ex: pushups, motion, detail: 'basic', body: 'male', steps: lib.noteSteps(pushups.body), autoPlay: true, slot: 'detail' });
    seeAll(); tick(0);
    const m = open();
    seeAll();
    const seg = m.contentEl.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'detailed');
    H.click(seg);
    assert.deepStrictEqual(detailsSaved.splice(0), ['detailed'], 'reported once, so it is saved once');
    assert.ok(m.contentEl.querySelector('.gv-mm-load'), 'the viewer\'s map is Detailed');
    assert.ok(host.querySelector('.gv-mm-load'), 'and the map on the page behind it follows');
    assert.ok(host.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'detailed').getAttribute('aria-pressed') === 'true', 'with its switch showing it');
    m.close(); stopPage();
    /* the opposite direction too, and a closed map is never poked */
    const p2 = mountMuscleMap(attached(), { ex: pushups, motion, detail: 'detailed', body: 'male', steps: [], autoPlay: true });
    const q = open({}, {});
    q.contentEl.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'basic');
    q.close(); p2();
  });

  await check('V9. a map that cannot build leaves the photos, and the dialog still works', async () => {
    const realError = console.error; const errors = []; console.error = (...a) => errors.push(a.join(' '));
    try {
      const m = open({}, { motion: { id: 'broken', phases: [], regions: [], context: [], prime: [], hold: [], alwaysPrime: [], rig: 'nope' } });
      assert.strictEqual(m.mode, 'photos', 'fell back to the photos');
      assert.strictEqual(m.contentEl.querySelectorAll('.gv-mv-img').length, 2);
      assert.ok(errors.some(e => /muscle map/.test(e)), 'and logged it');
      assert.strictEqual(rafs.size, 0);
      m.close();
    } finally { console.error = realError; }
  });

  /* ================= THE THUMBNAIL ON THE LIVE SET (real renderer) ================= */
  const IMAGES = ['https://example.invalid/0.jpg', 'https://example.invalid/1.jpg'];
  const exercises = [Object.assign(H.ex('Push-ups', { muscles: ['chest', 'triceps', 'core'], image: IMAGES }), { body: pushups.body }), H.ex('Plank', { unit: 'seconds', image: IMAGES })];
  const live = async (skin, settings, plan) => {
    const b = await H.boot({ exercises, planBody: plan || '## Day A (any)\n\n- Push-ups | 2 x 10\n- Plank | 2 x 30s\n', settings: Object.assign({ skin }, settings || {}) });
    const p = b.ctx.activePlan();
    b.ctx.startGuided(p, p.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    H.advance(6000);
    return b;
  };
  const frame = b => H.page(b.ctx).querySelector('.gv-session-frame');

  for (const skin of ['apex', 'lockin', 'floor', 'editorial']) {
    await check(`L1. live set (${skin}): a looping bare figure in the frame; no switch, legend, labels or fibres`, async () => {
      const b = await live(skin);
      const f = frame(b);
      assert.ok(f.querySelector('.gv-mm-mini'), 'the mini map is in the photo frame');
      assert.strictEqual(f.querySelector('.gv-mm-seg'), null, 'no switch');
      assert.strictEqual(f.querySelector('.gv-mm-legend'), null, 'no legend');
      assert.strictEqual(f.querySelector('.gv-mm-head'), null, 'no heading row');
      assert.strictEqual(f.querySelectorAll('.gv-mm-label').length, 0, 'no labels');
      assert.strictEqual(f.querySelectorAll('.gv-mm-fibre').length, 0, 'no fibre strands (invisible at that size, a third of the paths)');
      assert.strictEqual(f.querySelector('svg').getAttribute('aria-hidden'), 'true', 'hidden from assistive tech; the frame is the labelled control');
      assert.ok(f.querySelectorAll('.gv-mm-muscle').length >= 10, 'every muscle region is still drawn');
      seeAll(); tick(0);
      assert.strictEqual(rafs.size, 1, 'it loops');
      b.ctx.nav('dashboard');
      assert.strictEqual(rafs.size, 0, 'leaving the session ends the loop');
      assert.strictEqual(ios.filter(i => i.connected).length, 0, 'and its observer');
    });
  }

  await check('L2. the loop survives a re-render on the same clock, and each render leaves exactly one loop', async () => {
    const b = await live('apex');
    seeAll();
    for (let t = 0; t <= 800; t += 40) tick(t); // the clock takes at most 100ms a frame, so tick at a realistic rate
    const t0 = b.ctx.state.session.muscleMapClock.t;
    assert.ok(t0 >= 700, `the session clock ran (${t0}ms)`);
    for (let i = 0; i < 3; i++) { b.ctx.rerender(); seeAll(); tick(1000 + i * 100); }
    assert.strictEqual(ios.filter(i => i.connected).length, 1, 'one observer after three re-renders');
    assert.ok(rafs.size <= 1, 'one loop');
    assert.ok(b.ctx.state.session.muscleMapClock.t >= t0, 'the rep carried on, it did not restart');
    b.ctx.nav('dashboard');
    assert.strictEqual(ios.filter(i => i.connected).length, 0);
  });

  await check('L3. reduced motion and animateMedia off: the thumbnail is a still pose, never a loop', async () => {
    reduceMotion();
    let b = await live('apex');
    seeAll(); tick(0); tick(500);
    assert.strictEqual(rafs.size, 0, 'reduced motion: no frame queued');
    assert.ok(frame(b).querySelector('svg').getAttribute('viewBox'), 'but it drew its pose');
    b.ctx.nav('dashboard');
    reset();
    b = await live('floor', { animateMedia: false });
    seeAll(); tick(0);
    assert.strictEqual(rafs.size, 0, 'animateMedia off: still');
    b.ctx.nav('dashboard');
  });

  await check('L4. tapping the thumbnail opens the viewer on the map; the thumbnail pauses under it; closing wakes it; no rep is counted, a running clock is untouched', async () => {
    const b = await live('apex');
    seeAll(); tick(0);
    const countBefore = H.countText(b.ctx);
    H.click(frame(b));
    const v = H.modals.filter(x => x.constructor.name === 'MediaViewerModal')[0];
    assert.ok(v && v.mode === 'map', 'the viewer opened on the map');
    assert.strictEqual(H.countText(b.ctx), countBefore, 'no rep counted');
    seeAll(); tick(100);
    assert.strictEqual(rafs.size, 1, 'one loop visible: the viewer\'s');
    assert.ok(H.page(b.ctx).querySelector('.gv-session-frame'), 'the live set is still there under it');
    v.close();
    seeAll();
    assert.strictEqual(rafs.size, 1, 'the thumbnail is looping again');
    b.ctx.nav('dashboard');
    assert.strictEqual(rafs.size, 0);
  });

  await check('L5. other exercises keep their photos on the live set', async () => {
    const b = await live('apex', {}, '## Day A (any)\n\n- Plank | 2 x 30s\n');
    assert.strictEqual(frame(b).querySelector('.gv-mm'), null, 'no map on Plank');
    assert.ok(frame(b).querySelectorAll('.gv-session-cycle-img').length >= 1, 'its photos');
    b.ctx.nav('dashboard');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 5).join('\n  ') : err}`); } else console.log(`ok   ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} viewer cases failed`); process.exit(1); }
  console.log(`muscle map viewer OK (${results.length} cases)`);
})().catch(e => { console.error(e); process.exit(1); });
