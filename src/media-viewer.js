'use strict';
/* The full-screen look at an exercise's frames.

   Why it exists: on the live set the exercise media is a 72px thumbnail (Apex,
   Lock In) or a ~190px frame (Floor, Editorial), and on the exercise page the
   frames are small tiles. Neither could be enlarged, so the form you came to
   check was too small to read. Tapping any of them opens this instead.

   It is an Obsidian Modal so it gets the host's back gesture, Escape and focus
   handling on desktop and mobile, and it wears the user's skin the same way the
   rep counter does (rep-counter-modal.js): the modalEl carries .gv-app plus the
   skin/accent classes, which is what brings the --gv-* tokens and the shared
   button styling into a node Obsidian appends to <body>.

   WHAT IT DELIBERATELY DOES NOT SHARE with the live set: its timer. The session
   keeps its own thumbnail cycle in sess.mediaCycleTimer; this one is the
   viewer's, started on open and cleared on close, so a hold, a rest or a circuit
   running underneath is never touched and opening the viewer twice never stacks
   two of anything. Frame order, skipping and the swipe rule are pure functions in
   media-cycle.js, tested without a browser.

   PINCH ZOOM: nothing here implements it. The stage declares
   `touch-action: pan-y pinch-zoom` (styles.css) so the browser's own zoom is not
   blocked while a horizontal swipe still reaches us as pointer events, and a
   second finger cancels the swipe in progress. Whether a given host honours
   page zoom at all is the host's decision. */

const { Modal } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { skinClasses } = require('./constants');
const { prefersReducedMotion } = require('./confetti');
const { nextFrameIndex, prevFrameIndex, firstFrameIndex, framePosition, frameLabel, swipeDirection, autoPlayMedia, MEDIA_CYCLE_MS } = require('./media-cycle');

/* The one open viewer, so a second open closes the first instead of stacking a
   second dialog and a second timer under it. */
let active = null;

class MediaViewerModal extends Modal {
  /* opts: { name, frames: [{src, tag}], startIndex, skin, accent, settings,
     returnFocus, cycleMs }. `settings` is the plugin's, read only for
     `animateMedia` (autoPlayMedia). returnFocus is the element focus goes back to on close (default:
     whatever had focus when this was opened). */
  constructor(app, opts) {
    super(app);
    opts = opts || {};
    this.name = opts.name || '';
    this.frames = (opts.frames || []).filter(f => f && f.src);
    this.skin = opts.skin || 'apex';
    this.accent = opts.accent || 'lime';
    this.settings = opts.settings || {};
    this.cycleMs = opts.cycleMs || MEDIA_CYCLE_MS;
    this.startIndex = opts.startIndex;
    this.failed = new Set();
    this.index = 0;
    this.playing = false;
    this.closed = false;
    this._timer = null;
    this._returnFocus = opts.returnFocus || (typeof document !== 'undefined' ? document.activeElement : null) || null;
  }

  onOpen() {
    const modalEl = this.modalEl;
    modalEl.addClass('gv-app');
    modalEl.addClass('gv-mv-modal');
    for (const cls of skinClasses(this.skin)) modalEl.addClass(cls);
    modalEl.addClass(`gv-accent-${this.accent}`);
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', this.name || 'Exercise images');
    modalEl.setAttribute('tabindex', '-1');
    this.contentEl.addClass('gv-mv');

    const closeBtn = el('button', { class: 'gv-icon-btn gv-mv-close', type: 'button', 'aria-label': 'Close' }, ico('x'));
    closeBtn.addEventListener('click', () => this.close());
    const bar = el('div', { class: 'gv-mv-bar' }, el('h2', { class: 'gv-display gv-mv-title' }, this.name), closeBtn);

    this.stage = el('div', { class: 'gv-mv-stage' });
    this.imgs = this.frames.map((f, i) => {
      const img = el('img', { class: 'gv-mv-img', src: f.src, alt: `${this.name} — ${frameLabel(this.frames, i)}`, draggable: 'false' });
      img.addEventListener('error', () => this._frameFailed(i));
      this.stage.append(img);
      return img;
    });
    this._wireSwipe(this.stage);

    this.tagEl = el('span', { class: 'gv-mv-tag' });
    this.posEl = el('span', { class: 'gv-mv-pos' });
    this.captionEl = el('div', { class: 'gv-mv-caption', 'aria-live': 'polite', 'aria-atomic': 'true' }, this.tagEl, this.posEl);

    this.prevBtn = el('button', { class: 'gv-icon-btn gv-mv-step', type: 'button', 'aria-label': 'Previous frame' }, ico('chevron-left'));
    this.nextBtn = el('button', { class: 'gv-icon-btn gv-mv-step', type: 'button', 'aria-label': 'Next frame' }, ico('chevron-right'));
    this.playBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-mv-play', type: 'button' });
    this.prevBtn.addEventListener('click', () => this._step('prev'));
    this.nextBtn.addEventListener('click', () => this._step('next'));
    this.playBtn.addEventListener('click', () => this._setPlaying(!this.playing));
    const controls = el('div', { class: 'gv-mv-controls' }, this.prevBtn, this.playBtn, this.nextBtn);

    this.contentEl.append(bar, this.stage, this.captionEl, controls);

    modalEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowRight') { if (e.preventDefault) e.preventDefault(); this._step('next'); }
      else if (e.key === 'ArrowLeft') { if (e.preventDefault) e.preventDefault(); this._step('prev'); }
    });
    /* Obsidian closes on a backdrop press itself; this is the same rule written
       down, so it holds if the host ever stops doing it and so it can be tested.
       close() twice is harmless (onClose is guarded). */
    if (this.containerEl && this.containerEl.addEventListener) {
      this.containerEl.addEventListener('click', e => {
        const t = e.target;
        if (t === this.containerEl || (t && t.classList && t.classList.contains('modal-bg'))) this.close();
      });
    }

    const first = firstFrameIndex(this.frames.length, this.failed, this.startIndex);
    this.index = first === null ? 0 : first;
    this._show(this.index);
    /* Opens paused under reduced motion or with Settings -> "Animate exercise
       images" off (autoPlayMedia); the Play button is still the user's to press
       for this viewing, and does not change the setting. */
    this._setPlaying(autoPlayMedia(this.settings, prefersReducedMotion()));
    modalEl.focus();
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    this._stopTimer();
    if (active === this) active = null;
    this.contentEl.empty();
    const back = this._returnFocus;
    this._returnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  _live() { return this.frames.length - this.failed.size; }

  _stopTimer() {
    if (this._timer !== null) { window.clearInterval(this._timer); this._timer = null; }
  }

  _setPlaying(on) {
    this._stopTimer();
    this.playing = !!on && this._live() >= 2;
    if (this.playing) this._timer = window.setInterval(() => this._tick(), this.cycleMs);
    this._sync();
  }

  _tick() {
    const next = nextFrameIndex(this.frames.length, this.failed, this.index);
    if (next !== null && next !== this.index) this._show(next);
  }

  _show(i) {
    this.index = i;
    this.imgs.forEach((img, k) => img.classList.toggle('gv-mv-on', k === i));
    this._sync();
  }

  /* A step the user asked for pauses the animation: they stopped to look. */
  _step(dir) {
    if (this.closed || this._live() < 2) return;
    const to = dir === 'prev'
      ? prevFrameIndex(this.frames.length, this.failed, this.index)
      : nextFrameIndex(this.frames.length, this.failed, this.index);
    if (to === null) return;
    this._setPlaying(false);
    this._show(to);
  }

  _frameFailed(i) {
    if (this.closed || this.failed.has(i)) return;
    this.failed.add(i);
    this.imgs[i].remove();
    if (this._live() <= 0) {
      this._stopTimer();
      this.playing = false;
      this.stage.classList.add('gv-mv-stage-empty');
      this.stage.append(el('div', { class: 'gv-mv-missing' }, ico('dumbbell'), el('span', {}, 'Images unavailable offline')));
      this._sync();
      return;
    }
    if (this.index === i) {
      const next = nextFrameIndex(this.frames.length, this.failed, i);
      if (next !== null) this._show(next);
    }
    if (this._live() < 2) this._setPlaying(false);
    else this._sync();
  }

  /* Everything that reads the state, in one place. */
  _sync() {
    if (!this.tagEl) return;
    const live = this._live();
    const pos = framePosition(this.frames.length, this.failed, this.index);
    this.tagEl.textContent = live > 0 ? frameLabel(this.frames, this.index) : '';
    this.posEl.textContent = live > 0 ? `${pos.n} / ${pos.of}` : '';
    const solo = live < 2;
    this.prevBtn.disabled = solo;
    this.nextBtn.disabled = solo;
    this.playBtn.disabled = solo;
    clear(this.playBtn);
    this.playBtn.append(ico(this.playing ? 'pause' : 'play'), el('span', {}, this.playing ? 'Pause' : 'Play'));
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause animation' : 'Play animation');
    /* A caption that announces itself every 1.1 s while it animates would talk
       over the user's screen reader; it speaks only once the frame holds still. */
    this.captionEl.setAttribute('aria-live', this.playing ? 'off' : 'polite');
  }

  /* Horizontal swipe on touch and mouse. A second finger down makes it a pinch
     (the browser's), so the whole gesture is dropped. */
  _wireSwipe(stage) {
    const down = new Map();
    let spoiled = false;
    stage.addEventListener('pointerdown', e => {
      down.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (down.size > 1) spoiled = true;
    });
    stage.addEventListener('pointerup', e => {
      const from = down.get(e.pointerId);
      down.delete(e.pointerId);
      if (from && !spoiled) {
        const dir = swipeDirection(e.clientX - from.x, e.clientY - from.y);
        if (dir) this._step(dir);
      }
      if (!down.size) spoiled = false;
    });
    stage.addEventListener('pointercancel', e => {
      down.delete(e.pointerId);
      spoiled = true;
      if (!down.size) spoiled = false;
    });
  }
}

/* opts: { name, frames: [{src, tag}], startIndex, skin, accent, returnFocus }.
   Returns the open viewer, or null when there is nothing to show. */
function openMediaViewer(app, opts) {
  const frames = ((opts && opts.frames) || []).filter(f => f && f.src);
  if (!frames.length) return null;
  if (active && !active.closed) active.close();
  const viewer = new MediaViewerModal(app, opts);
  active = viewer;
  viewer.open();
  return viewer;
}

module.exports = { openMediaViewer, MediaViewerModal };
