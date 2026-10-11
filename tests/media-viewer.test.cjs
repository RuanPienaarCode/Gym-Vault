'use strict';
/* THE FULL-SCREEN MEDIA VIEWER (src/media-viewer.js).

   Ruan, from his phone on 0.14.0: "the user can't enlarge or view the
   instruction images or animations". On the live set the exercise media is a
   72px thumbnail (Apex, Lock In) or a ~190px frame (Floor, Editorial), and on
   the exercise page the frames are small tiles; tapping did nothing.

   THE CONTRACT these cases pin, on the REAL modal, the REAL guided session and
   the REAL exercise page (tests/live-session-harness.js, with its fake clock and
   fake DOM):
     - tapping a frame opens the viewer ON THAT FRAME; next/prev wrap; a frame
       that fails to load is skipped, and the position figure renumbers;
     - 2+ frames animate (the session's own MEDIA_CYCLE_MS); Pause stops it, a
       manual step pauses it; reduced motion starts paused;
     - the viewer's timer is ITS OWN: closing clears it, opening twice leaves one,
       and the session's media-cycle timer is untouched;
     - Escape / the backdrop / the close button close it; focus goes in and comes
       back to the thumbnail;
     - on the live set, opening it never counts a rep, never touches a running
       hold, and in reduced motion a tap opens the viewer instead of advancing
       the thumbnail in place.
   Synthetic data only. */
const assert = require('node:assert');
const path = require('node:path');
const H = require('./live-session-harness.js');
const { openMediaViewer } = require(path.join(H.SRC, 'media-viewer'));
const { MEDIA_CYCLE_MS } = require(path.join(H.SRC, 'media-cycle'));

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.modals.length = 0; H.speech.length = 0;
  H.win.matchMedia = () => ({ matches: false });
  H.document.activeElement = null;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
/* the fake DOM's focus() is a no-op; make it observable */
H.N.prototype.focus = function () { H.document.activeElement = this; };
const reduceMotion = () => { H.win.matchMedia = q => ({ matches: /reduce/.test(q) }); };

const PAIR = [{ src: 'https://example.test/0.jpg', tag: 'start' }, { src: 'https://example.test/1.jpg', tag: 'finish' }];
const SEQ = [1, 2, 3, 4].map(n => ({ src: `https://example.test/s${n}.jpg`, tag: String(n) }));
const open = (frames, extra) => openMediaViewer({}, Object.assign({ name: 'Push-ups', frames, startIndex: 0, skin: 'apex', accent: 'lime' }, extra || {}));
const imgs = m => m.contentEl.querySelectorAll('.gv-mv-img');
const shown = m => imgs(m).findIndex(i => i.classList.contains('gv-mv-on'));
const btn = (m, label) => H.byLabel(m.contentEl, label);
const text = (m, sel) => (m.contentEl.querySelector(sel) || { textContent: '(missing)' }).textContent;
const key = (m, k) => H.fire(m.modalEl, 'keydown', { key: k });
const attached = () => { const n = new H.N('div'); H.docRoot().appendChild(n); return n; };

(async () => {
  /* ================= OPENING ================= */

  await check('O1. opens on the frame that was tapped, with the name as the title', async () => {
    const m = open(SEQ, { startIndex: 2 });
    assert.ok(m, 'a viewer opened');
    assert.strictEqual(H.modals.at(-1), m, 'it went through Modal.open()');
    assert.strictEqual(shown(m), 2);
    assert.strictEqual(text(m, '.gv-mv-title'), 'Push-ups');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'view 3');
    assert.strictEqual(text(m, '.gv-mv-pos'), '3 / 4');
    assert.strictEqual(imgs(m).length, 4, 'every frame is stacked, none cropped to a thumbnail');
    assert.strictEqual(imgs(m)[2].getAttribute('alt'), 'Push-ups — view 3', 'alt text names the exercise and the frame');
    m.close();
  });

  await check('O2. a start/finish pair is labelled in those words', async () => {
    const m = open(PAIR, { startIndex: 1 });
    assert.strictEqual(shown(m), 1);
    assert.strictEqual(text(m, '.gv-mv-tag'), 'finish');
    assert.strictEqual(imgs(m)[0].getAttribute('alt'), 'Push-ups — start');
    m.close();
  });

  await check('O3. no frames, no viewer (nothing to show is not an empty dialog)', async () => {
    assert.strictEqual(open([]), null);
    assert.strictEqual(H.modals.length, 0);
  });

  await check('O4. a start index past the end opens on the last frame, not on nothing', async () => {
    const m = open(SEQ, { startIndex: 40 });
    assert.strictEqual(shown(m), 3);
    m.close();
  });

  /* ================= STEPPING ================= */

  await check('S1. next and previous wrap, and the figure follows', async () => {
    const m = open(SEQ, { startIndex: 3 });
    H.click(btn(m, 'Next frame'));
    assert.strictEqual(shown(m), 0, 'next from the last frame is the first');
    assert.strictEqual(text(m, '.gv-mv-pos'), '1 / 4');
    H.click(btn(m, 'Previous frame'));
    assert.strictEqual(shown(m), 3, 'previous from the first frame is the last');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'view 4');
    m.close();
  });

  await check('S2. a frame that fails to load is dropped, skipped both ways, and the figure renumbers', async () => {
    const m = open(SEQ, { startIndex: 0 });
    H.fire(imgs(m)[1], 'error');
    assert.strictEqual(imgs(m).length, 3, 'the dead frame left the stack');
    H.click(btn(m, 'Next frame'));
    assert.strictEqual(text(m, '.gv-mv-tag'), 'view 3', 'next skipped the dead frame');
    assert.strictEqual(text(m, '.gv-mv-pos'), '2 / 3', 'and the figure counts only what is left');
    H.click(btn(m, 'Previous frame'));
    assert.strictEqual(text(m, '.gv-mv-tag'), 'view 1');
    m.close();
  });

  await check('S3. the frame on screen failing moves on to the next live one', async () => {
    const m = open(SEQ, { startIndex: 1 });
    H.fire(imgs(m)[1], 'error');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'view 3');
    m.close();
  });

  await check('S4. opening ON a frame that already failed lands on the next live one', async () => {
    const m = open(SEQ, { startIndex: 1 });
    H.fire(imgs(m)[1], 'error');
    m.close();
    const again = open(SEQ.filter(f => f.tag !== '2'), { startIndex: 1 });
    assert.strictEqual(text(again, '.gv-mv-tag'), 'view 3');
    again.close();
  });

  await check('S5. one frame left: static, prev/next/play are off and no timer runs', async () => {
    const m = open(PAIR);
    assert.strictEqual(H.liveIntervals(), 1, 'fixture: a pair animates');
    H.fire(imgs(m)[0], 'error');
    assert.strictEqual(H.liveIntervals(), 0, 'one frame is not an animation');
    assert.strictEqual(btn(m, 'Next frame').disabled, true);
    assert.strictEqual(btn(m, 'Previous frame').disabled, true);
    assert.strictEqual(text(m, '.gv-mv-pos'), '1 / 1');
    m.close();
  });

  await check('S6. a single frame opens static: no timer, controls off, still closable', async () => {
    const m = open([PAIR[0]]);
    assert.strictEqual(H.liveIntervals(), 0);
    assert.strictEqual(btn(m, 'Next frame').disabled, true);
    assert.strictEqual(btn(m, 'Play animation').disabled, true, 'there is nothing to play');
    assert.ok(btn(m, 'Close'), 'the close button is there');
    m.close();
  });

  await check('S7. every frame failing says so and stops cycling nothing', async () => {
    const m = open(PAIR);
    H.fire(imgs(m)[0], 'error'); H.fire(imgs(m)[0], 'error');
    assert.strictEqual(H.liveIntervals(), 0);
    assert.match(m.contentEl.textContent, /Images unavailable/);
    assert.ok(btn(m, 'Close'), 'and you can still leave');
    m.close();
  });

  await check('S8. the arrow keys step, and a swipe steps (left is next, right is previous)', async () => {
    const m = open(SEQ, { startIndex: 1 });
    key(m, 'ArrowRight'); assert.strictEqual(shown(m), 2);
    key(m, 'ArrowLeft'); key(m, 'ArrowLeft'); assert.strictEqual(shown(m), 0);
    const stage = m.contentEl.querySelector('.gv-mv-stage');
    const drag = (x0, y0, x1, y1, id) => {
      H.fire(stage, 'pointerdown', { pointerId: id || 1, clientX: x0, clientY: y0 });
      H.fire(stage, 'pointerup', { pointerId: id || 1, clientX: x1, clientY: y1 });
    };
    drag(300, 400, 180, 410); assert.strictEqual(shown(m), 1, 'swipe left = next');
    drag(180, 400, 300, 390); assert.strictEqual(shown(m), 0, 'swipe right = previous');
    drag(300, 400, 290, 410); assert.strictEqual(shown(m), 0, 'a tap-sized drag does nothing');
    drag(300, 300, 240, 480); assert.strictEqual(shown(m), 0, 'a mostly-vertical drag does nothing');
    m.close();
  });

  await check('S9. a second finger cancels the swipe (that is a pinch, and it belongs to the browser)', async () => {
    const m = open(SEQ, { startIndex: 0 });
    const stage = m.contentEl.querySelector('.gv-mv-stage');
    H.fire(stage, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 400 });
    H.fire(stage, 'pointerdown', { pointerId: 2, clientX: 320, clientY: 400 });
    H.fire(stage, 'pointerup', { pointerId: 2, clientX: 100, clientY: 400 });
    H.fire(stage, 'pointerup', { pointerId: 1, clientX: 100, clientY: 400 });
    assert.strictEqual(shown(m), 0, 'no step from a two-finger gesture');
    H.fire(stage, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 400 });
    H.fire(stage, 'pointercancel', { pointerId: 1 });
    H.fire(stage, 'pointerup', { pointerId: 1, clientX: 100, clientY: 400 });
    assert.strictEqual(shown(m), 0, 'and a cancelled gesture does not step later');
    m.close();
  });

  /* ================= THE ANIMATION ================= */

  await check('A1. two or more frames animate by themselves, at the session\'s own cycle time', async () => {
    const m = open(SEQ);
    assert.strictEqual(H.liveIntervals(), 1);
    assert.ok(btn(m, 'Pause animation'), 'it says it is playing');
    H.advance(MEDIA_CYCLE_MS - 1); assert.strictEqual(shown(m), 0);
    H.advance(1); assert.strictEqual(shown(m), 1);
    H.advance(MEDIA_CYCLE_MS * 3); assert.strictEqual(shown(m), 0, 'and wraps');
    m.close();
  });

  await check('A2. Pause stops it, Play starts it again, and the button says which', async () => {
    const m = open(PAIR);
    H.click(btn(m, 'Pause animation'));
    assert.strictEqual(H.liveIntervals(), 0, 'paused means no timer, not a timer that ignores ticks');
    H.advance(MEDIA_CYCLE_MS * 10); assert.strictEqual(shown(m), 0, 'the frame holds');
    assert.ok(btn(m, 'Play animation') && !btn(m, 'Pause animation'));
    H.click(btn(m, 'Play animation'));
    assert.strictEqual(H.liveIntervals(), 1);
    H.advance(MEDIA_CYCLE_MS); assert.strictEqual(shown(m), 1);
    m.close();
  });

  await check('A3. stepping by hand pauses it (you stopped to look)', async () => {
    const m = open(SEQ);
    H.click(btn(m, 'Next frame'));
    assert.strictEqual(shown(m), 1);
    assert.strictEqual(H.liveIntervals(), 0);
    H.advance(MEDIA_CYCLE_MS * 5); assert.strictEqual(shown(m), 1);
    assert.ok(btn(m, 'Play animation'));
    m.close();
  });

  await check('A4. reduced motion: it opens paused, nothing loops, and Play is still the user\'s to press', async () => {
    reduceMotion();
    const m = open(PAIR);
    assert.strictEqual(H.liveIntervals(), 0, 'no timer at all');
    H.advance(MEDIA_CYCLE_MS * 5); assert.strictEqual(shown(m), 0);
    assert.ok(btn(m, 'Play animation'));
    H.click(btn(m, 'Next frame')); assert.strictEqual(shown(m), 1, 'next/previous work as the way to see the movement');
    m.close();
  });

  await check('A5. a frame failing mid-animation: the cycle skips it and carries on', async () => {
    const m = open(SEQ);
    H.fire(imgs(m)[1], 'error');
    H.advance(MEDIA_CYCLE_MS); assert.strictEqual(text(m, '.gv-mv-tag'), 'view 3');
    m.close();
  });

  await check('A6. Settings "Animate exercise images" OFF: the viewer opens paused, Play still works for this viewing', async () => {
    const m = open(PAIR, { settings: { animateMedia: false } });
    assert.strictEqual(H.liveIntervals(), 0, 'no timer');
    assert.ok(btn(m, 'Play animation'));
    H.advance(MEDIA_CYCLE_MS * 5); assert.strictEqual(shown(m), 0);
    H.click(btn(m, 'Play animation'));
    H.advance(MEDIA_CYCLE_MS); assert.strictEqual(shown(m), 1, 'Play animates this viewing');
    m.close();
    const on = open(PAIR, { settings: { animateMedia: true } });
    assert.strictEqual(H.liveIntervals(), 1, 'ON (and a missing key, see O1/A1) animates');
    on.close();
  });

  /* ================= LEAKS ================= */

  await check('L1. closing clears the timer: no interval is left', async () => {
    const m = open(SEQ);
    assert.strictEqual(H.liveIntervals(), 1);
    m.close();
    assert.strictEqual(H.liveIntervals(), 0);
    H.advance(MEDIA_CYCLE_MS * 4); // and nothing fires into the dead DOM
  });

  await check('L2. closing twice (Escape then the host\'s own close) is harmless', async () => {
    const m = open(SEQ);
    m.close(); m.close();
    assert.strictEqual(H.liveIntervals(), 0);
  });

  await check('L3. opening twice leaves ONE timer, and the first viewer is closed', async () => {
    const a = open(SEQ);
    const b = open(PAIR, { startIndex: 1 });
    assert.strictEqual(H.liveIntervals(), 1, 'one timer, not two');
    assert.strictEqual(a.closed, true, 'the first one was closed, not stacked underneath');
    assert.strictEqual(shown(b), 1);
    b.close();
    assert.strictEqual(H.liveIntervals(), 0);
  });

  await check('L4. opening and closing ten times leaves nothing behind', async () => {
    const before = Object.keys(H.windowListeners).map(k => H.windowListeners[k].length).reduce((a, b) => a + b, 0);
    for (let i = 0; i < 10; i++) { const m = open(SEQ); m.close(); }
    assert.strictEqual(H.liveIntervals(), 0);
    const after = Object.keys(H.windowListeners).map(k => H.windowListeners[k].length).reduce((a, b) => a + b, 0);
    assert.strictEqual(after, before, 'no window listeners were added and left');
    assert.strictEqual(Object.values(H.docListeners).reduce((a, l) => a + l.length, 0), 0, 'no document listeners either');
  });

  /* ================= CLOSING + FOCUS ================= */

  await check('C1. Escape, the close button and the backdrop each close it', async () => {
    let m = open(SEQ); key(m, 'Escape'); assert.strictEqual(m.closed, true, 'Escape');
    m = open(SEQ); H.click(btn(m, 'Close')); assert.strictEqual(m.closed, true, 'the close button');
    m = open(SEQ); H.fire(m.containerEl, 'click'); assert.strictEqual(m.closed, true, 'the backdrop');
    m = open(SEQ); H.click(m.contentEl.querySelector('.gv-mv-stage')); assert.strictEqual(m.closed, false, 'but a tap on the picture does not close it');
    m.close();
    assert.strictEqual(H.liveIntervals(), 0);
  });

  await check('C2. focus moves into the dialog on open and back to the thumbnail on close', async () => {
    const thumb = attached(); H.document.activeElement = thumb;
    const m = open(SEQ);
    assert.ok(H.document.activeElement && m.modalEl.contains(H.document.activeElement), 'focus is inside the dialog');
    m.close();
    assert.strictEqual(H.document.activeElement, thumb, 'and back where it came from');
  });

  await check('C3. focus is not returned to a thumbnail that has since been rebuilt', async () => {
    const thumb = attached(); H.document.activeElement = thumb;
    const m = open(SEQ, { returnFocus: thumb });
    thumb.remove(); // the page re-rendered while the viewer was open; the old thumbnail is gone
    const elsewhere = attached(); H.document.activeElement = elsewhere;
    m.close();
    assert.strictEqual(H.document.activeElement, elsewhere, 'a detached node is not focused');
  });

  await check('C4. the dialog is a labelled modal dialog', async () => {
    const m = open(SEQ);
    assert.strictEqual(m.modalEl.getAttribute('role'), 'dialog');
    assert.strictEqual(m.modalEl.getAttribute('aria-modal'), 'true');
    assert.strictEqual(m.modalEl.getAttribute('aria-label'), 'Push-ups');
    const cap = m.contentEl.querySelector('.gv-mv-caption');
    assert.strictEqual(cap.getAttribute('aria-live'), 'off', 'while it animates the caption stays quiet (it would talk over a screen reader every 1.1 s)');
    H.click(btn(m, 'Pause animation'));
    assert.strictEqual(cap.getAttribute('aria-live'), 'polite', 'once it holds still a frame change is announced');
    m.close();
  });

  /* ================= SKIN ================= */

  await check('K1. the dialog wears the user\'s skin and accent, through skinClasses()', async () => {
    const want = { apex: ['gv-skin-apex', 'gv-skin-poster'], lockin: ['gv-skin-lockin', 'gv-skin-poster'], floor: ['gv-skin-floor'], editorial: ['gv-skin-editorial'] };
    for (const [skin, cls] of Object.entries(want)) {
      const m = open(SEQ, { skin, accent: 'blaze' });
      for (const c of ['gv-app', 'gv-mv-modal', 'gv-accent-blaze', ...cls]) assert.ok(m.modalEl.classList.contains(c), `${skin}: ${c}`);
      if (skin === 'floor' || skin === 'editorial') assert.ok(!m.modalEl.classList.contains('gv-skin-poster'), `${skin} is not a poster skin`);
      m.close();
    }
  });

  await check('K2. buttons are the plugin\'s own: close is an icon button, play/prev/next too', async () => {
    const m = open(SEQ);
    for (const l of ['Close', 'Previous frame', 'Next frame']) assert.ok(btn(m, l).classList.contains('gv-icon-btn'), l);
    assert.ok(btn(m, 'Pause animation').classList.contains('gv-btn'));
    m.close();
  });

  /* ================= THE LIVE SET ================= */

  const IMG = ['https://example.test/a0.jpg', 'https://example.test/a1.jpg'];
  const withImages = names => names.map(n => H.ex(n, n === 'Plank' ? { unit: 'seconds', image: IMG } : { image: IMG }));
  async function guided(planBody, skin, extraSettings) {
    const b = await H.boot({
      planBody, exercises: withImages(['Push-ups', 'Plank']),
      settings: Object.assign({ guideRestSeconds: 0, skin, soundMode: 'silent' }, extraSettings || {}),
    });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    return b;
  }
  const thumb = b => H.page(b.ctx).querySelector('.gv-session-frame');
  const PUSH = '## D (any)\n\n- Push-ups | 1 x 10\n';
  const PLANK = '## D (any)\n\n- Plank | 1 x 60s\n';

  for (const skin of ['apex', 'lockin', 'floor', 'editorial']) {
    await check(`T1. live set (${skin}): the media is a labelled button that opens the viewer on the frame showing`, async () => {
      const b = await guided(PUSH, skin);
      const t = thumb(b);
      assert.ok(t, 'the media block is on the live set');
      assert.strictEqual(t.getAttribute('role'), 'button');
      assert.strictEqual(t.getAttribute('tabindex'), '0');
      assert.strictEqual(t.getAttribute('aria-label'), 'Show Push-ups larger');
      assert.ok(t.querySelector('.gv-media-expand'), 'an expand corner says it can be enlarged');
      H.advance(MEDIA_CYCLE_MS); // the thumbnail's own cycle is now on frame 2
      H.click(t);
      const m = H.modals.at(-1);
      assert.ok(m && m.modalEl, 'a viewer opened');
      assert.strictEqual(shown(m), 1, 'on the frame the thumbnail was showing');
      assert.ok(m.modalEl.classList.contains(`gv-skin-${skin}`), 'in the user\'s skin');
      m.close();
    });
  }

  await check('T2. Enter and Space open it too (keyboard / switch control)', async () => {
    for (const k of ['Enter', ' ']) {
      const b = await guided(PUSH, 'apex');
      H.modals.length = 0;
      H.fire(thumb(b), 'keydown', { key: k });
      assert.strictEqual(H.modals.length, 1, `${JSON.stringify(k)} opens it`);
      H.modals.at(-1).close();
    }
  });

  await check('T3. opening it does not count a rep', async () => {
    const b = await guided(PUSH, 'apex');
    H.advance(6000); // count-in over
    const before = H.countText(b.ctx);
    H.click(thumb(b));
    H.fire(thumb(b), 'mousedown', { button: 0 });
    H.fire(thumb(b), 'touchstart', { changedTouches: [{ identifier: 1 }] });
    H.fire(thumb(b), 'keydown', { key: 'Enter' });
    assert.strictEqual(H.countText(b.ctx), before, 'the counter did not move');
    assert.strictEqual(b.ctx.state.session.counter.count, 0, 'and neither did the counter\'s state');
    H.modals.at(-1).close();
    H.tapZone(H.page(b.ctx).querySelector('.gv-session-zone'));
    assert.notStrictEqual(H.countText(b.ctx), before, 'fixture: a real tap on the zone DOES count');
  });

  await check('T4. a running hold keeps running while the viewer is open (and after)', async () => {
    const b = await guided(PLANK, 'lockin');
    H.advance(6000);
    const sess = b.ctx.state.session;
    assert.ok(sess.hold && sess.hold.running, 'fixture: the hold is running');
    H.advance(5000);
    const at5 = H.countText(b.ctx);
    H.click(thumb(b));
    assert.ok(H.modals.at(-1).modalEl, 'viewer open');
    H.advance(10000);
    assert.ok(sess.hold.running, 'still running');
    assert.notStrictEqual(H.countText(b.ctx), at5, 'the clock moved on under the viewer');
    const held = Number.parseInt(H.countText(b.ctx), 10);
    assert.ok(held >= 15, `the hold read ${H.countText(b.ctx)} after 5 s + 10 s; the viewer did not pause it`);
    H.modals.at(-1).close();
    H.advance(5000);
    assert.ok(Number.parseInt(H.countText(b.ctx), 10) >= held + 5, 'and closing it does not restart it');
  });

  await check('T5. the session\'s own media-cycle timer is independent of the viewer\'s', async () => {
    const b = await guided(PUSH, 'apex');
    const sess = b.ctx.state.session;
    assert.ok(sess.mediaCycleTimer, 'fixture: the thumbnail animates');
    const own = sess.mediaCycleTimer;
    const base = H.liveIntervals();
    H.click(thumb(b));
    assert.strictEqual(H.liveIntervals(), base + 1, 'the viewer adds exactly its own');
    assert.strictEqual(sess.mediaCycleTimer, own, 'and leaves the session\'s alone');
    H.modals.at(-1).close();
    assert.strictEqual(H.liveIntervals(), base, 'closing it removes only its own');
    assert.strictEqual(sess.mediaCycleTimer, own);
  });

  await check('T6. reduced motion: a tap opens the viewer (paused) instead of advancing the thumbnail in place', async () => {
    reduceMotion();
    const b = await guided(PUSH, 'apex');
    const t = thumb(b);
    const on = () => t.querySelectorAll('.gv-session-cycle-img').findIndex(i => i.classList.contains('gv-session-cycle-on'));
    assert.strictEqual(on(), 0);
    assert.strictEqual(b.ctx.state.session.mediaCycleTimer, null, 'fixture: no auto-cycle under reduced motion');
    const base = H.liveIntervals();
    H.click(t);
    assert.strictEqual(H.modals.length, 1, 'the viewer opened');
    assert.strictEqual(on(), 0, 'and the thumbnail did NOT advance behind it');
    const m = H.modals.at(-1);
    assert.ok(btn(m, 'Play animation'), 'the viewer starts paused');
    assert.strictEqual(H.liveIntervals(), base, 'and starts no timer');
    m.close();
  });

  await check('T8. Animate exercise images OFF: no media-cycle timer, frame 1 holds, still tappable, viewer opens paused', async () => {
    const b = await guided(PUSH, 'apex', { animateMedia: false });
    const sess = b.ctx.state.session;
    assert.strictEqual(sess.mediaCycleTimer, null, 'no cycle timer');
    const t = thumb(b);
    const on = () => t.querySelectorAll('.gv-session-cycle-img').findIndex(i => i.classList.contains('gv-session-cycle-on'));
    H.advance(MEDIA_CYCLE_MS * 5);
    assert.strictEqual(on(), 0, 'frame 1 holds');
    assert.strictEqual(t.getAttribute('role'), 'button');
    H.click(t);
    const m = H.modals.at(-1);
    assert.ok(m && m.modalEl, 'still opens the viewer');
    assert.ok(btn(m, 'Play animation'), 'paused');
    m.close();
    assert.strictEqual(sess.mediaCycleTimer, null);
  });

  await check('T9. Animate exercise images ON (the default, key absent) leaves the cycle timer running', async () => {
    const b = await guided(PUSH, 'apex');
    assert.ok(b.ctx.state.session.mediaCycleTimer, 'a missing key means ON');
    const b2 = await guided(PUSH, 'apex', { animateMedia: true });
    assert.ok(b2.ctx.state.session.mediaCycleTimer);
  });

  await check('T10. a thumbnail frame that failed to load is not offered to the viewer', async () => {
    const b = await guided(PUSH, 'apex');
    const t = thumb(b);
    H.fire(t.querySelectorAll('.gv-session-cycle-img')[0], 'error'); // the start frame is dead; the thumbnail moves to the finish frame
    H.click(t);
    const m = H.modals.at(-1);
    assert.strictEqual(imgs(m).length, 1, 'only the live frame went in');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'finish', 'and it opened on it');
    m.close();
  });

  await check('T7. a single image still opens the viewer (a bigger look at the one picture)', async () => {
    const b = await H.boot({ planBody: PUSH, exercises: [H.ex('Push-ups', { image: IMG[0] })], settings: { skin: 'apex', soundMode: 'silent', guideRestSeconds: 0 } });
    const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    // a lone free-exercise-db style URL would derive a pair; this one is a plain URL, so it stays single
    H.click(thumb(b));
    const m = H.modals.at(-1);
    assert.ok(m && m.modalEl);
    assert.strictEqual(imgs(m).length, 1);
    assert.strictEqual(btn(m, 'Next frame').disabled, true);
    m.close();
  });

  /* ================= THE EXERCISE PAGE ================= */

  async function detail(images, skin) {
    const b = await H.boot({ exercises: [H.ex('Push-ups', { image: images })], settings: { skin: skin || 'apex', soundMode: 'silent' } });
    b.ctx.nav('exercise', { exercise: 'Push-ups' });
    return b;
  }
  const tiles = b => H.page(b.ctx).querySelectorAll('.gv-media-frame');

  await check('D1. exercise page: tapping a frame opens the viewer ON that frame', async () => {
    const b = await detail(IMG);
    assert.strictEqual(tiles(b).length, 2);
    H.click(tiles(b)[1]);
    const m = H.modals.at(-1);
    assert.ok(m && m.modalEl, 'a viewer opened');
    assert.strictEqual(shown(m), 1, 'on the second frame');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'finish');
    m.close();
    H.click(tiles(b)[0]);
    assert.strictEqual(shown(H.modals.at(-1)), 0);
    H.modals.at(-1).close();
  });

  await check('D2. each frame is a labelled button, with an expand corner, reachable by keyboard', async () => {
    const b = await detail(IMG);
    const t = tiles(b)[1];
    assert.strictEqual(t.getAttribute('role'), 'button');
    assert.strictEqual(t.getAttribute('tabindex'), '0');
    assert.strictEqual(t.getAttribute('aria-label'), 'Show Push-ups — finish larger');
    assert.ok(t.querySelector('.gv-media-expand'));
    H.modals.length = 0;
    H.fire(t, 'keydown', { key: 'Enter' });
    assert.strictEqual(H.modals.length, 1);
    H.modals.at(-1).close();
  });

  await check('D3. a frame that already failed on the page is not offered to the viewer, and the index still points at the tapped frame', async () => {
    const b = await detail(['https://example.test/x0.jpg', 'https://example.test/x1.jpg', 'https://example.test/x2.jpg']);
    H.fire(tiles(b)[0].querySelector('img'), 'error'); // the first frame is dead
    assert.strictEqual(tiles(b).length, 2);
    H.click(tiles(b)[1]); // the page's second tile is the sequence's THIRD frame
    const m = H.modals.at(-1);
    assert.strictEqual(imgs(m).length, 2, 'only live frames go in');
    assert.strictEqual(text(m, '.gv-mv-tag'), 'view 3', 'and it opened on the one that was tapped');
    m.close();
  });

  /* ---- report ---- */
  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`media viewer OK (${results.length} cases)`);
})();
