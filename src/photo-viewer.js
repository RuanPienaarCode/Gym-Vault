'use strict';
/* The change over time, as a slow cross-dissolve.

   "Morph" here is an honest cross-fade between consecutive photos, not a
   warp: true morphing needs landmark correspondence between two bodies, and
   a wrong correspondence invents change that did not happen. For a progress
   photo — the one thing you must be able to trust — a dissolve between two
   real frames is the truthful primitive. Taking both shots from the same
   stance (which is what the capture overlay is for) is what makes the
   dissolve read as change in YOU rather than change in the camera angle.

   The scrubber is the primary control and the play button is secondary: the
   thing people actually do with these is drag back and forth between two
   dates, not watch a slideshow. */

const { el, ico, clear } = require('./dom');
const { fmtShort } = require('./dates');
const { photosForPose, poseByKey } = require('./progress-photos');

const STEP_MS = 1400;          // dwell per photo when playing — "slow morph"
const FADE_MS = 900;

const reducedMotion = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
};

/* Renders into `host`. Returns a teardown to stop the timer — a modal or a
   page swap that leaves the interval running keeps re-rendering a detached
   node forever. */
function renderPhotoViewer(host, opts) {
  const { entries, pose, srcOf } = opts;
  const list = photosForPose(entries, pose);
  const poseDef = poseByKey(pose);
  clear(host);

  if (!list.length) {
    host.append(el('div', { class: 'gv-empty-line' }, `No ${poseDef ? poseDef.label.toLowerCase() : pose} photos yet.`));
    return () => {};
  }

  let i = list.length - 1;      // open on the most recent
  let timer = null;
  let settle = null;            // backstop that guarantees the fade's END state

  /* Two stacked layers cross-faded by opacity, rather than swapping one
     img's src: swapping src shows a blank frame while the next file decodes,
     which reads as a flicker exactly when you are trying to see a change. */
  const under = el('img', { class: 'gv-photo-layer', alt: '' });
  const over = el('img', { class: 'gv-photo-layer gv-photo-layer-top', alt: '' });
  const stage = el('div', { class: 'gv-photo-stage gv-photo-viewer-stage' }, under, over);

  const caption = el('div', { class: 'gv-photo-caption' });
  const scrub = el('input', {
    type: 'range', class: 'gv-photo-scrub', min: '0', max: String(list.length - 1),
    value: String(i), step: '1', 'aria-label': `${poseDef ? poseDef.label : pose} photos over time`,
  });

  const show = (next, animate) => {
    const entry = list[next];
    if (!entry) return;
    caption.textContent = `${fmtShort(entry.date)} · ${next + 1} of ${list.length}`;
    scrub.value = String(next);
    scrub.setAttribute('aria-valuetext', fmtShort(entry.date));
    if (!animate || reducedMotion()) {
      if (settle) { window.clearTimeout(settle); settle = null; }
      over.style.transition = 'none';
      under.src = srcOf(entry.file);
      over.src = srcOf(entry.file);
      over.style.opacity = '1';
      i = next;
      return;
    }
    /* Current frame drops to the under layer, the new one fades in above it.

       The opacity 0 -> 1 flip is separated by a FORCED REFLOW, not by
       requestAnimationFrame. rAF does not run while the pane is hidden, and
       Obsidian hides panes routinely (switch tabs and come back) — a fade
       that depends on it leaves the photo stuck at opacity 0, i.e. invisible.
       Reading offsetHeight flushes the style synchronously, so the browser
       has two real values to transition between no matter what. */
    under.src = over.src || srcOf(list[i].file);
    over.style.transition = 'none';
    over.style.opacity = '0';
    over.src = srcOf(entry.file);
    void over.offsetHeight;
    over.style.transition = `opacity ${FADE_MS}ms ease-in-out`;
    over.style.opacity = '1';
    /* A stalled transition must never leave the photo INVISIBLE. Rendering
       is throttled while a pane is hidden — and Obsidian hides panes every
       time you switch tabs — so the opacity animation can simply not run.
       setTimeout still fires when hidden (throttled, but it fires), so this
       forces the end state the fade was only ever decorating. */
    if (settle) window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      settle = null;
      over.style.transition = 'none';
      over.style.opacity = '1';
    }, FADE_MS + 60);
    i = next;
  };

  scrub.addEventListener('input', () => { stop(); show(Number(scrub.value), false); });

  const playBtn = el('button', {
    class: 'gv-btn gv-btn-ghost', type: 'button', 'aria-label': 'Play the change over time',
  }, ico('play'), el('span', {}, 'Play'));

  function stop() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
    clear(playBtn);
    playBtn.append(ico('play'), el('span', {}, 'Play'));
    playBtn.setAttribute('aria-label', 'Play the change over time');
  }

  function play() {
    if (list.length < 2) return;
    /* Always restart from the beginning: pressing play on the last frame and
       watching nothing happen is the obvious trap here. */
    show(0, false);
    timer = window.setInterval(() => {
      if (i >= list.length - 1) { stop(); return; }
      show(i + 1, true);
      /* Reset the button as soon as the last frame is up, rather than one
         full dwell later — otherwise it still reads "Stop" with nothing left
         to play. */
      if (i >= list.length - 1) stop();
    }, STEP_MS);
    clear(playBtn);
    playBtn.append(ico('pause'), el('span', {}, 'Stop'));
    playBtn.setAttribute('aria-label', 'Stop playing');
  }

  playBtn.addEventListener('click', () => (timer ? stop() : play()));

  const step = (delta, label) => {
    const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': label },
      ico(delta < 0 ? 'chevron-left' : 'chevron-right'));
    b.addEventListener('click', () => {
      stop();
      show(Math.min(list.length - 1, Math.max(0, i + delta)), true);
    });
    return b;
  };

  host.append(stage, caption, scrub,
    el('div', { class: 'gv-photo-viewer-actions' },
      step(-1, 'Previous photo'),
      list.length > 1 ? playBtn : '',
      step(1, 'Next photo')));

  show(i, false);
  return () => {
    stop();
    if (settle) { window.clearTimeout(settle); settle = null; }
  };
}

module.exports = { renderPhotoViewer, STEP_MS, FADE_MS };
