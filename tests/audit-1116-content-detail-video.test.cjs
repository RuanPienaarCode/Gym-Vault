'use strict';
/* AUDIT 16 NOV 2026, finding #15 (Medium): an exercise's video could not be
   reached when it had a muscle map and photos.

   With a motion (the muscle map) the map replaces the media block and its one
   button opened the photo viewer if there were images; the video toggle was
   offered only when there were none. The seeded Pull-ups has a map, three images
   and a video, so its video was unreachable. Whenever `video` is set there is a
   way to open it: a second button ("Video" / "Hide video") beside "Photos", built
   lazily like the video-only path.

   Drives the real page-exercise-detail.js over the shared DOM stub. The muscle
   map's own drawing and the full-screen viewer are replaced by recorders (they
   are not what is under test); the page's motion block is. */
const assert = require('node:assert');
const T = require('./f3-stub');

/* The shared stub's nodes have no remove(); a real DOM node does, and the Video toggle uses it. */
{
  const make = global.document.createElement;
  global.document.createElement = tag => {
    const n = make(tag);
    n.remove = () => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n); };
    return n;
  };
}

const mm = require('../src/muscle-map');
mm.mountMuscleMap = host => { host.append(T.mkNode('div')); return () => {}; };
const viewer = require('../src/media-viewer');
const viewerCalls = [];
viewer.openMediaViewer = (_app, opts) => { viewerCalls.push(opts); };
const detail = require('../src/page-exercise-detail');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
};

const IMAGES = ['https://img.example/p/0.jpg', 'https://img.example/p/1.jpg', 'https://img.example/p/2.jpg'];
function mount(fm) {
  /* "Pull-ups" is a name the motion library knows, so the page takes the map path. */
  const ex = { name: 'Pull-ups', file: { path: 'Gym/Exercises/Pull-ups.md' }, fm: { type: 'strength', unit: 'reps', ...fm }, body: '' };
  const ctx = {
    data: { exercises: [ex], workouts: [] }, settings: {}, state: { params: { exercise: 'Pull-ups', path: ex.file.path } },
    app: {}, view: null, nav() {}, notice() {}, reload() {}, openFile() {}, back() {}, backTo: f => f,
  };
  return T.render(detail, ctx);
}
const buttonWith = (root, re) => T.findAll(root, 'gv-btn').find(b => re.test(b.textContent.replace(/\s+/g, ' ').trim()));
const text = n => n.textContent.replace(/\s+/g, ' ').trim();

check('map + photos + video: the page offers a Video button beside Photos', () => {
  const root = mount({ image: IMAGES, video: 'https://cdn.example/pullups.mp4' });
  assert.ok(root.querySelector('.gv-mm-block'), 'control: the muscle-map block was built');
  assert.ok(buttonWith(root, /^Photos$/), 'control: Photos is still there');
  assert.ok(buttonWith(root, /^Video$/), `no Video button; buttons: ${JSON.stringify(T.findAll(root, 'gv-btn').map(text))}`);
});

check('the Video button builds the player when asked, shows Hide video, and a second tap removes it', () => {
  const root = mount({ image: IMAGES, video: 'https://cdn.example/pullups.mp4' });
  const host = root.querySelector('.gv-mm-photos-host');
  assert.strictEqual(T.findAll(host, 'gv-media-video').length, 0, 'nothing is loaded until it is asked for');
  const b = buttonWith(root, /^Video$/);
  assert.ok(b, 'Video button present');
  b.click();
  assert.strictEqual(T.findAll(host, 'gv-media-video').length, 1, 'the player is built on the tap');
  assert.strictEqual(T.findAll(host, 'gv-media-frames').length, 0, 'and it is the video alone: the photos stay behind the Photos button');
  assert.strictEqual(text(b), 'Hide video');
  assert.strictEqual(b.getAttribute('aria-expanded'), 'true');
  b.click();
  assert.strictEqual(T.findAll(host, 'gv-media-video').length, 0, 'a second tap hides it');
  assert.strictEqual(text(b), 'Video');
  assert.strictEqual(b.getAttribute('aria-expanded'), 'false');
});

check('Photos still opens the viewer on the photos (the new button does not take its place)', () => {
  viewerCalls.length = 0;
  const root = mount({ image: IMAGES, video: 'https://cdn.example/pullups.mp4' });
  const p = buttonWith(root, /^Photos$/);
  assert.ok(p, 'Photos button present');
  p.click();
  assert.strictEqual(viewerCalls.length, 1);
  assert.strictEqual(viewerCalls[0].start, 'photos');
  assert.strictEqual(viewerCalls[0].frames.length, IMAGES.length);
});

check('a page-style video (YouTube) gets its Watch button through the same Video toggle', () => {
  const root = mount({ image: IMAGES, video: 'https://www.youtube.com/watch?v=abc' });
  const b = buttonWith(root, /^Video$/);
  assert.ok(b, 'Video button present');
  b.click();
  const host = root.querySelector('.gv-mm-photos-host');
  assert.strictEqual(T.findAll(host, 'gv-media-watch').length, 1, 'Watch video is offered');
});

check('control: no video -> no Video button; video and no photos -> the single button is still "Video"', () => {
  const a = mount({ image: IMAGES });
  assert.ok(!buttonWith(a, /^Video$/), 'no video, no Video button');
  const b = mount({ video: 'https://cdn.example/pullups.mp4' });
  assert.ok(buttonWith(b, /^Video$/), 'video-only keeps its toggle');
  assert.ok(!buttonWith(b, /^Photos$/), 'and has no Photos button');
});

if (failed) { console.error(`audit-1116 content detail video: ${failed} check(s) FAILED`); process.exit(1); }
console.log('audit-1116 content detail video OK');
