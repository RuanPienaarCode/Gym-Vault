'use strict';
/* THE MUSCLE MAP RENDERER: what it builds, and that it never runs when
   nobody can see it.

   An animation loop is the one kind of code in this app that costs battery
   every frame, so the promises that matter are the ones about STOPPING:
   off-screen, app in the background, page left, stop() called, or its own
   DOM thrown away by a re-render. Each one is driven here against the real
   module, on the shared fake DOM, with requestAnimationFrame and
   IntersectionObserver replaced by recorders so "is a frame still queued?"
   is a fact rather than a timing guess. */
const assert = require('node:assert');
const H = require('./live-session-harness');

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
  fire(visible) { this.cb([{ isIntersecting: visible, target: this.node }]); }
}
H.win.IntersectionObserver = FakeIO;

const { mountMuscleMap } = require('../src/muscle-map');
const lib = require('../src/motion-library');

const STEPS = ['Hands under the shoulders.', 'Lower to a fist off the floor.', 'Press to lockout.'];
const pushups = { name: 'Push-ups', fm: { muscles: ['chest', 'triceps', 'core'] }, body: '' };
const motion = lib.motionFor(pushups);

(async () => {
  const b = await H.boot();
  const docRoot = b.contentEl.parentNode;
  const fresh = () => { const h = new H.N('div'); docRoot.appendChild(h); return h; };
  const torsoD = host => host.querySelector('.gv-mm-torso').getAttribute('d');
  const visListeners = () => (H.docListeners.visibilitychange || []).length;

  /* ---- Basic: the moving body, coloured muscles, one quiet legend ---- */
  let detailAsked = [];
  const host = fresh();
  const stop = mountMuscleMap(host, { ex: pushups, motion, detail: 'basic', body: 'male', steps: STEPS, onDetail: d => detailAsked.push(d) });
  assert.strictEqual(typeof stop, 'function', 'mount returns stop()');
  assert.ok(host.querySelector('.gv-mm'), 'a muscle map card is built');
  assert.ok(host.querySelector('svg.gv-mm-svg'), 'with an svg stage');
  assert.ok(host.querySelector('svg.gv-mm-svg').getAttribute('aria-label').includes('Push-ups'), 'the svg says what it shows');
  assert.strictEqual(host.querySelectorAll('.gv-mm-label').length, 0, 'Basic has no labels');
  const legend = host.querySelector('.gv-mm-legend');
  assert.ok(legend && /Chest/.test(legend.textContent) && /Core/.test(legend.textContent), 'Basic names working and holding muscles once');
  assert.strictEqual(host.querySelectorAll('.gv-mm-muscle').length, lib.REGIONS.length, 'every region is drawn');
  const seg = host.querySelector('.gv-mm-seg').querySelectorAll('button');
  assert.strictEqual(seg.length, 2, 'Basic / Detailed switch on the visual');
  assert.strictEqual(seg.find(x => x.getAttribute('data-detail') === 'basic').getAttribute('aria-pressed'), 'true');
  console.log('ok   basic view builds');

  /* ---- it animates while visible ---- */
  const io = ios[ios.length - 1];
  io.fire(true);
  const d0 = torsoD(host);
  tick(0); tick(900);
  assert.notStrictEqual(torsoD(host), d0, 'the figure moves between frames');
  assert.strictEqual(rafs.size, 1, 'exactly one frame queued while visible');

  /* ---- off-screen pauses, back on-screen resumes ---- */
  io.fire(false); tick(1000);
  assert.strictEqual(rafs.size, 0, 'off-screen: nothing queued');
  io.fire(true);
  assert.strictEqual(rafs.size, 1, 'back on-screen: resumes');

  /* ---- app in the background pauses ---- */
  H.document.visibilityState = 'hidden';
  for (const fn of H.docListeners.visibilitychange || []) fn({});
  tick(1100);
  assert.strictEqual(rafs.size, 0, 'hidden app: nothing queued');
  H.document.visibilityState = 'visible';
  for (const fn of H.docListeners.visibilitychange || []) fn({});
  assert.strictEqual(rafs.size, 1, 'visible again: resumes');
  console.log('ok   pauses off-screen and in the background');

  /* ---- Detailed: labels, load bar, the note's steps ---- */
  H.click(seg.find(x => x.getAttribute('data-detail') === 'detailed'));
  assert.deepStrictEqual(detailAsked, ['detailed'], 'flipping the switch reports the choice so it can be remembered');
  assert.strictEqual(host.querySelectorAll('.gv-mm-label').length, lib.REGIONS.length, 'Detailed labels every muscle');
  assert.ok(host.querySelectorAll('.gv-mm-label').some(l => /pectoralis major/.test(l.textContent)), 'with Latin names');
  assert.ok(host.querySelector('.gv-mm-load'), 'and a load bar');
  assert.strictEqual(host.querySelector('.gv-mm-step').textContent.includes(STEPS[0]), true, 'the caption starts at step 1');
  assert.strictEqual(host.querySelector('.gv-mm-legend'), null, 'the Basic legend gives way to labels');
  /* A row of more than three labels collides at phone width, so a long row
     alternates between two levels: a row may hold at most six (two levels of
     three), and every label of the push-up is in one of the two rows. */
  const topRow = lib.REGIONS.filter(r => r.row === 'top');
  assert.ok(topRow.length <= 6, `at most six labels above the figure (got ${topRow.map(r => r.id).join(', ')})`);
  assert.ok(lib.REGIONS.length - topRow.length <= 6, 'and at most six below');
  assert.strictEqual(rafs.size, 1, 'switching view does not stack a second loop');
  H.click(host.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'basic'));
  assert.strictEqual(host.querySelectorAll('.gv-mm-label').length, 0, 'and back to Basic');
  console.log('ok   detailed view and the switch');

  /* ---- stop() really stops, and is safe twice ---- */
  const before = visListeners();
  stop();
  assert.strictEqual(rafs.size, 0, 'stop(): no frame queued');
  assert.strictEqual(io.connected, false, 'stop(): observer disconnected');
  assert.strictEqual(visListeners(), before - 1, 'stop(): visibility listener removed');
  stop();
  tick(1200);
  assert.strictEqual(rafs.size, 0, 'nothing restarts it');
  console.log('ok   stop() tears everything down');

  /* ---- a re-render that throws the DOM away stops the loop on its own ---- */
  const h2 = fresh();
  mountMuscleMap(h2, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  ios[ios.length - 1].fire(true);
  tick(0);
  assert.strictEqual(rafs.size, 1);
  docRoot.removeChild(h2);
  tick(16);
  assert.strictEqual(rafs.size, 0, 'detached: the loop ends itself');
  console.log('ok   a detached map stops itself');

  /* ---- a shared clock carries the rep across a re-mount ---- */
  const shared = { t: 0 };
  const hc1 = fresh();
  const c1 = mountMuscleMap(hc1, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], clock: shared });
  ios[ios.length - 1].fire(true);
  tick(0); tick(100); tick(200); tick(300); tick(400); tick(500); tick(600); tick(700); tick(800); tick(900); tick(1000);
  assert.ok(shared.t >= 999, `the shared clock advanced with the frames (${shared.t}ms)`);
  const carried = torsoD(hc1);
  c1(); docRoot.removeChild(hc1);
  const hc2 = fresh();
  const c2 = mountMuscleMap(hc2, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], clock: shared });
  assert.strictEqual(torsoD(hc2), carried, 'a new map on the same clock starts where the last one was, not at the top');
  const fromTop = fresh();
  const c3 = mountMuscleMap(fromTop, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  assert.notStrictEqual(torsoD(fromTop), carried, 'without a shared clock it starts at the top');
  c2(); c3();
  console.log('ok   a shared clock carries the rep across re-mounts');

  /* ---- a mount that throws leaves nothing subscribed ---- */
  const visBefore = visListeners(), ioBefore = ios.length;
  /* No phases: framing (poseAtDepth) still works, the first draw (poseAt)
     throws — i.e. the failure lands AFTER the card is built, which is the
     case that used to leave the observer and listener behind. */
  assert.throws(() => mountMuscleMap(fresh(), { ex: pushups, motion: { ...motion, phases: [] }, detail: 'basic', body: 'male', steps: [] }));
  assert.strictEqual(visListeners(), visBefore, 'no visibility listener left behind');
  assert.strictEqual(ios.length, ioBefore, 'no observer created');
  console.log('ok   a failed mount leaks nothing');

  /* ---- one map per slot: the detail page re-rendering replaces, never stacks ---- */
  const h3 = fresh(), h4 = fresh();
  mountMuscleMap(h3, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], slot: 'detail' });
  const io3 = ios[ios.length - 1]; io3.fire(true);
  mountMuscleMap(h4, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], slot: 'detail' });
  ios[ios.length - 1].fire(true);
  assert.strictEqual(io3.connected, false, 'the earlier map in the slot was stopped');
  tick(0);
  assert.strictEqual(rafs.size, 1, 'only the newest map runs');
  console.log('ok   one map per slot');

  /* ---- Side | Front: one rep, two views, one loop ---- */
  const squatEx = { name: 'Bodyweight Squat', fm: { muscles: ['quads', 'glutes'] }, body: '' };
  const sq = lib.motionFor(squatEx);
  rafs.clear(); // the slot check above leaves its map running; start this one clean
  const hv = fresh(), vclock = { t: 0 };
  const sv = mountMuscleMap(hv, { ex: squatEx, motion: sq, detail: 'detailed', body: 'male', steps: [], clock: vclock });
  const vbar = hv.querySelector('.gv-mm-views');
  assert.ok(vbar, 'the squat offers Side | Front');
  const vbtn = v => hv.querySelector('.gv-mm-views').querySelectorAll('button').find(x => x.getAttribute('data-view') === v);
  assert.strictEqual(vbtn('squat').getAttribute('aria-pressed'), 'true', 'side is the default view');
  ios[ios.length - 1].fire(true);
  tick(0); tick(400);
  const tBefore = vclock.t;
  H.click(vbtn('squat-front'));
  assert.strictEqual(hv.querySelectorAll('.gv-mm').length, 1, 'switching view replaces the card, never stacks a second');
  assert.strictEqual(vbtn('squat-front').getAttribute('aria-pressed'), 'true', 'front is now showing');
  assert.strictEqual(hv.querySelectorAll('.gv-mm-label').length > 0, true, 'the Detailed choice carried over');
  ios[ios.length - 1].fire(true);
  tick(800);
  assert.strictEqual(rafs.size, 1, 'one loop, not two');
  assert.ok(vclock.t >= tBefore, 'the rep carried on from where it was');
  sv();
  tick(900);
  assert.strictEqual(rafs.size, 0, 'stop() stops whichever view is showing');
  assert.strictEqual(lib.motionFor({ name: 'Push-ups', fm: {} }).views, undefined);
  const hp = fresh();
  const sp = mountMuscleMap(hp, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  assert.strictEqual(hp.querySelector('.gv-mm-views'), null, 'a one-view movement has no view switch');
  sp();
  console.log('ok   Side | Front switches view, keeps the rep and the detail, one loop');

  /* ---- the body setting changes the figure ---- */
  const hm = fresh(), hf = fresh();
  const sm = mountMuscleMap(hm, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  const sf = mountMuscleMap(hf, { ex: pushups, motion, detail: 'basic', body: 'female', steps: [] });
  assert.notStrictEqual(torsoD(hm), torsoD(hf), 'male and female are different shapes');
  sm(); sf();

  /* ---- reduced motion: a still pose you can step through, never a loop ---- */
  rafs.clear();
  const realMM = H.win.matchMedia;
  H.win.matchMedia = q => ({ matches: /reduce/.test(q) });
  const hr = fresh();
  const sr = mountMuscleMap(hr, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  ios[ios.length - 1].fire(true);
  tick(0); tick(500);
  assert.strictEqual(rafs.size, 0, 'reduced motion: never queues a frame');
  const still = torsoD(hr);
  H.click(hr.querySelector('.gv-mm-stage'));
  assert.notStrictEqual(torsoD(hr), still, 'a tap steps to the next position');
  assert.ok(/tap/i.test(hr.querySelector('.gv-mm-stage').getAttribute('aria-label')), 'and says so');
  sr();
  H.win.matchMedia = realMM;
  console.log('ok   reduced motion is still and steppable');

  /* ================= the 0.14.0 integration: thumbnail, viewer, one rule ================= */

  /* ---- mini: the bare figure for the live set's frame ---- */
  rafs.clear();
  const hMini = fresh(), hFrame = fresh(), hFull = fresh();
  const sMini = mountMuscleMap(hMini, { ex: pushups, motion, mini: 'thumb', body: 'male', autoPlay: true });
  const sFrame = mountMuscleMap(hFrame, { ex: pushups, motion, mini: 'frame', body: 'male', autoPlay: true });
  const sFull = mountMuscleMap(hFull, { ex: pushups, motion, detail: 'detailed', body: 'male', steps: STEPS });
  assert.ok(hMini.querySelector('.gv-mm-mini'), 'mini is a card of its own kind');
  for (const bad of ['.gv-mm-head', '.gv-mm-seg', '.gv-mm-under', '.gv-mm-legend', '.gv-mm-label', '.gv-mm-fibre', '.gv-mm-mark', '.gv-mm-tendon']) {
    assert.strictEqual(hMini.querySelector(bad), null, `mini draws no ${bad}`);
  }
  assert.strictEqual(hMini.querySelectorAll('.gv-mm-muscle').length, lib.REGIONS.length, 'but every muscle region');
  assert.ok(hMini.querySelector('.gv-mm-ctx'), 'and the neutral muscles that make it read as a body');
  const vbw = h => Number(h.querySelector('svg.gv-mm-svg').getAttribute('viewBox').split(' ')[2]);
  const frameW = vbw(hFrame), thumbW = vbw(hMini);
  assert.ok(thumbW < frameW * 0.8 && thumbW > frameW * 0.6, `the 96x72 thumbnail crops a long figure to its front part (${thumbW.toFixed(0)} of ${frameW.toFixed(0)})`);
  assert.ok(frameW < vbw(hFull), 'the wide-frame miniature keeps the whole figure (less padding than the page card, not less figure)');
  const miniNodes = hMini.querySelectorAll('path').length, fullNodes = hFull.querySelectorAll('path').length;
  assert.ok(miniNodes < fullNodes * 0.7, `mini builds far fewer paths (${miniNodes} vs ${fullNodes})`);
  assert.strictEqual(hMini.querySelector('svg').getAttribute('aria-hidden'), 'true', 'the miniature is hidden from assistive tech (its frame is the control)');
  assert.strictEqual(hMini.querySelector('.gv-mm-stage').getAttribute('role'), null, 'and is not a control itself: its frame takes the tap');
  ios[ios.length - 3].fire(true); tick(0); tick(40);
  assert.strictEqual(rafs.size, 1, 'a mini loops');
  sMini(); sFrame(); sFull();
  console.log('ok   mini: bare figure, cropped for the thumbnail, whole for the frame');

  /* ---- ~30 fps: a frame that comes too soon is skipped, the clock still keeps real time ---- */
  rafs.clear();
  const cap = { t: 0 };
  const hCap = fresh();
  const sCap = mountMuscleMap(hCap, { ex: pushups, motion, mini: 'frame', body: 'male', autoPlay: true, clock: cap });
  ios[ios.length - 1].fire(true);
  tick(0); const dCap = torsoD(hCap);
  tick(8); tick(16); tick(24);
  assert.strictEqual(torsoD(hCap), dCap, 'frames closer than ~28ms to the last drawn one redraw nothing');
  assert.strictEqual(cap.t, 0, 'and do not advance the clock');
  assert.strictEqual(rafs.size, 1, 'but the loop stays scheduled');
  tick(40);
  assert.notStrictEqual(torsoD(hCap), dCap, 'the next frame past the cap draws');
  assert.strictEqual(cap.t, 40, 'and the clock advanced by the real time since the last drawn frame');
  sCap();
  console.log('ok   about 30 fps, real-time clock');

  /* ---- the heat comes from the load-ramp tokens, read from the page's own style ---- */
  const realGCS = H.win.getComputedStyle;
  let tokenSet = { '--gv-load-lo': '#102030', '--gv-load-hi': ' rgb(200, 10, 20) ' };
  H.win.getComputedStyle = () => ({ getPropertyValue: k => tokenSet[k] || '' });
  const hTok = fresh();
  const sTok = mountMuscleMap(hTok, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], autoPlay: false });
  const stopColours = h => h.querySelectorAll('stop').filter(n => n.getAttribute('stop-color')).map(n => n.getAttribute('stop-color'));
  /* a still figure starts at the bottom (depth 1): the hot end of the ramp */
  assert.strictEqual(stopColours(hTok)[1], 'rgb(200,10,20)', 'the bottom of the rep is --gv-load-hi');
  H.click(hTok.querySelector('.gv-mm-stage')); H.click(hTok.querySelector('.gv-mm-stage')); // halfway, then the top
  assert.strictEqual(stopColours(hTok)[1], 'rgb(16,32,48)', 'the top of the rep is --gv-load-lo');
  sTok();
  /* built before the host is in the page: reads again the first time it is seen */
  tokenSet = {};
  const hLate = new H.N('div'); // detached
  const sLate = mountMuscleMap(hLate, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], autoPlay: true });
  assert.strictEqual(stopColours(hLate)[1].startsWith('rgb(') && stopColours(hLate)[1] !== 'rgb(16,32,48)', true, 'detached: fallback ramp, no style to read');
  tokenSet = { '--gv-load-lo': '#102030', '--gv-load-hi': '#c80a14' };
  docRoot.appendChild(hLate);
  ios[ios.length - 1].fire(true);
  tick(0);
  assert.strictEqual(stopColours(hLate)[1], 'rgb(16,32,48)', 'attached and seen: reads the page\'s tokens (depth 0 = lo)');
  /* the theme flips while it is on screen */
  H.document.body = { classList: { contains: c => c === 'theme-dark' && dark } };
  let dark = false;
  tick(100); tick(200);
  tokenSet = { '--gv-load-lo': '#aa0000', '--gv-load-hi': '#aa0000' }; // a flat ramp: the colour is the same at every depth
  dark = true;
  tick(300); tick(400);
  assert.strictEqual(stopColours(hLate)[1], 'rgb(170,0,0)', 'a theme flip re-reads the tokens');
  sLate();
  delete H.document.body;
  H.win.getComputedStyle = realGCS;
  console.log('ok   heat follows --gv-load-lo / --gv-load-hi, read from the page, re-read on attach and theme flip');

  /* ---- play / pause / step: the viewer's controls ---- */
  rafs.clear();
  const hCtl = fresh(), ctl = { t: 0 };
  const sCtl = mountMuscleMap(hCtl, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], autoPlay: true, clock: ctl });
  assert.strictEqual(typeof sCtl.setPlaying, 'function');
  assert.strictEqual(sCtl.isPlaying(), true);
  ios[ios.length - 1].fire(true);
  for (let t = 0; t <= 1400; t += 40) tick(t);
  const mid = torsoD(hCtl);
  sCtl.setPlaying(false);
  assert.strictEqual(sCtl.isPlaying(), false);
  assert.strictEqual(torsoD(hCtl), mid, 'pausing freezes the figure exactly where it is');
  assert.strictEqual(rafs.size, 0, 'and queues nothing');
  assert.ok(/still pose/.test(hCtl.querySelector('.gv-mm-stage').getAttribute('aria-label')), 'a paused figure is a step control');
  const poses = new Set([mid]);
  for (let i = 0; i < 3; i++) { sCtl.step(1); poses.add(torsoD(hCtl)); }
  assert.ok(poses.size >= 3, 'stepping walks the resting poses');
  sCtl.step(1);
  const bottom = torsoD(hCtl);
  sCtl.step(-1); sCtl.step(1);
  assert.strictEqual(torsoD(hCtl), bottom, 'forward and back are inverses');
  sCtl.setPlaying(true);
  ios[ios.length - 1].fire(true);
  assert.strictEqual(sCtl.isPlaying(), true);
  assert.strictEqual(rafs.size, 1, 'Play resumes the loop');
  assert.strictEqual(hCtl.querySelector('.gv-mm-stage').getAttribute('role'), null, 'a playing figure is not a step control');
  sCtl(); sCtl.setPlaying(false); sCtl.step(1); // after stop: harmless
  assert.strictEqual(rafs.size, 0);
  console.log('ok   setPlaying / step: freeze, walk the poses, resume');

  /* ---- autoPlay is the caller's one rule ---- */
  const off = mountMuscleMap(fresh(), { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], autoPlay: false });
  ios[ios.length - 1].fire(true); rafs.clear(); tick(0);
  assert.strictEqual(rafs.size, 0, 'autoPlay:false is still, whatever the media query says');
  assert.strictEqual(off.isPlaying(), false);
  off();
  H.win.matchMedia = q => ({ matches: /reduce/.test(q) });
  const dflt = mountMuscleMap(fresh(), { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  assert.strictEqual(dflt.isPlaying(), false, 'with no autoPlay given, reduced motion decides');
  dflt();
  H.win.matchMedia = () => ({ matches: false });
  const forced = mountMuscleMap(fresh(), { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], autoPlay: true });
  assert.strictEqual(forced.isPlaying(), true, 'autoPlay:true plays');
  forced();
  console.log('ok   autoPlay decides, the media query only when none is given');

  /* ---- the enlarge button, the Basic/Detailed broadcast ---- */
  let enlarged = 0;
  const hEn = fresh();
  const sEn = mountMuscleMap(hEn, { ex: pushups, motion, detail: 'basic', body: 'male', steps: STEPS, autoPlay: true, onEnlarge: () => enlarged++ });
  const eb = hEn.querySelectorAll('button').find(b => b.classList.contains('gv-mm-enlarge'));
  assert.ok(eb && /larger/.test(eb.getAttribute('aria-label')), 'a labelled Show larger button in the heading row');
  H.click(eb);
  assert.strictEqual(enlarged, 1, 'it enlarges');
  H.click(hEn.querySelector('.gv-mm-stage'));
  assert.strictEqual(enlarged, 2, 'a tap on a PLAYING figure enlarges it too');
  sEn.setPlaying(false);
  H.click(hEn.querySelector('.gv-mm-stage'));
  assert.strictEqual(enlarged, 2, 'a tap on a still figure steps it instead');
  const hNo = fresh();
  const sNo = mountMuscleMap(hNo, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [], autoPlay: true });
  assert.strictEqual(hNo.querySelectorAll('button').filter(b => b.classList.contains('gv-mm-enlarge')).length, 0, 'no button where nothing opens');
  assert.strictEqual(hNo.querySelector('.gv-mm-stage').getAttribute('role'), null, 'and a playing figure is inert');
  const saved = [];
  const hA = fresh(), hB = fresh();
  const sA = mountMuscleMap(hA, { ex: pushups, motion, detail: 'basic', body: 'male', steps: STEPS, autoPlay: true, onDetail: d => saved.push('A:' + d) });
  const sB = mountMuscleMap(hB, { ex: pushups, motion, detail: 'basic', body: 'male', steps: STEPS, autoPlay: true, onDetail: d => saved.push('B:' + d) });
  H.click(hA.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'detailed'));
  assert.deepStrictEqual(saved, ['A:detailed'], 'only the map you touched reports (one save)');
  assert.ok(hB.querySelector('.gv-mm-load'), 'but the other map follows');
  assert.strictEqual(hB.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'detailed').getAttribute('aria-pressed'), 'true');
  sB(); sB.setDetail('basic');
  H.click(hA.querySelector('.gv-mm-seg').querySelectorAll('button').find(x => x.getAttribute('data-detail') === 'basic'));
  assert.deepStrictEqual(saved, ['A:detailed', 'A:basic'], 'a stopped map is never poked');
  sA(); sEn(); sNo();
  console.log('ok   enlarge button + stage, Basic/Detailed follows across maps');

  /* ---- no IntersectionObserver (old engine / test DOM): one still frame ---- */
  delete H.win.IntersectionObserver;
  const hn = fresh();
  const sn = mountMuscleMap(hn, { ex: pushups, motion, detail: 'basic', body: 'male', steps: [] });
  tick(0);
  assert.ok(hn.querySelector('.gv-mm-torso').getAttribute('d').startsWith('M'), 'it still draws');
  assert.strictEqual(rafs.size, 0, 'but never loops where it cannot tell if it is visible');
  sn();
  console.log('muscle map render OK');
})().catch(e => { console.error(e); process.exit(1); });
