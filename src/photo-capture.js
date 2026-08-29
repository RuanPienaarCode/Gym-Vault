'use strict';
/* Take a progress photo, in the same stance as last time.

   TWO PATHS, chosen by feature detection, because the phone will not always
   give us a live preview:

   1. LIVE — `getUserMedia` works, so we render the camera ourselves and draw
      the pose outline and your previous photo straight over it. You line
      yourself up BEFORE the shutter.

   2. HANDOFF — no `getUserMedia` (Obsidian's iOS WebView may simply refuse),
      so we hand off to the OS camera via a file input. The phone's own
      full-screen camera UI takes over and we CANNOT draw a guide on it —
      that is Apple's UI, not ours. So the alignment moves to AFTER the shot:
      the new photo comes back with the previous one ghosted over it and a
      Retake button. Same outcome, one more tap.

   The ghost of your own last photo is the better guide of the two — a
   generic silhouette tells you where a body goes, your own photo tells you
   where YOUR body was. The outline is the fallback for your first shot of a
   pose, when there is nothing to ghost. */

const { Modal, Notice } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { poseByKey } = require('./progress-photos');
const { todayISO } = require('./dates');

/* JPEG at 0.85 — these are body photos taken monthly and kept for years, and
   they sync to every device the vault reaches. A full-resolution PNG per
   pose per month is a gigabyte of iCloud for no visible gain. */
const JPEG_QUALITY = 0.85;
const MAX_EDGE = 1600;

const liveCameraAvailable = () => !!(
  typeof navigator !== 'undefined'
  && navigator.mediaDevices
  && typeof navigator.mediaDevices.getUserMedia === 'function'
);

/* The pose outline, as an SVG the caller can lay over anything. */
function guideSvg(pose, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 200');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', cls || 'gv-photo-guide');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${pose.label} alignment outline`);
  for (const shape of pose.guide) {
    const node = document.createElementNS('http://www.w3.org/2000/svg',
      shape.kind === 'circle' ? 'circle' : 'path');
    if (shape.kind === 'circle') {
      node.setAttribute('cx', shape.cx); node.setAttribute('cy', shape.cy); node.setAttribute('r', shape.r);
    } else {
      node.setAttribute('d', shape.d);
    }
    svg.appendChild(node);
  }
  return svg;
}

/* Draw an image onto a canvas, longest edge capped, and return JPEG bytes. */
function toJpegBytes(source, width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

class PhotoCaptureModal extends Modal {
  /* opts: { pose (key), ghostSrc (previous photo's resource path or null),
             onCaptured(arrayBuffer, dateISO) } */
  constructor(app, opts) {
    super(app);
    opts = opts || {};
    this.pose = poseByKey(opts.pose) || poseByKey('standing');
    this.ghostSrc = opts.ghostSrc || null;
    this.onCaptured = typeof opts.onCaptured === 'function' ? opts.onCaptured : () => {};
    this.showGhost = !!this.ghostSrc;
    this.stream = null;
    this.pending = null;          // {bytes, url} awaiting confirm in handoff mode
  }

  onOpen() {
    this.modalEl.addClass('gv-app');
    this.modalEl.addClass('gv-photo-modal');
    this.render();
  }

  onClose() {
    this.stopStream();
    if (this.pending && this.pending.url) URL.revokeObjectURL(this.pending.url);
    clear(this.contentEl);
  }

  /* Release the camera the moment we are done with it. A WebView that keeps
     a stream open leaves the phone's camera light on and drains the battery
     long after the modal is gone. */
  stopStream() {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }

  render() {
    const host = this.contentEl;
    clear(host);
    host.append(el('h2', { class: 'gv-photo-title' }, `${this.pose.label} — progress photo`));
    host.append(el('p', { class: 'gv-photo-hint' }, this.pose.hint));

    if (this.pending) return this.renderReview(host);
    if (liveCameraAvailable()) return this.renderLive(host);
    return this.renderHandoff(host);
  }

  /* ---- path 1: live preview, guide drawn over it ---- */
  renderLive(host) {
    const video = el('video', { class: 'gv-photo-video', playsinline: 'true', muted: 'true', autoplay: 'true' });
    video.muted = true;                       // attribute alone is not enough on iOS
    const stage = el('div', { class: 'gv-photo-stage' }, video);
    if (this.ghostSrc && this.showGhost) {
      stage.append(el('img', { class: 'gv-photo-ghost', src: this.ghostSrc, alt: '' }));
    } else {
      stage.append(guideSvg(this.pose));
    }
    host.append(stage);

    const shoot = el('button', { class: 'gv-btn gv-photo-shoot', type: 'button' },
      ico('camera'), el('span', {}, 'Take photo'));
    shoot.addEventListener('click', () => {
      if (!video.videoWidth) { new Notice('Gym: the camera is still warming up.'); return; }
      const bytes = toJpegBytes(video, video.videoWidth, video.videoHeight);
      this.stopStream();
      this.commit(bytes);
    });

    const actions = el('div', { class: 'gv-photo-actions' }, shoot);
    if (this.ghostSrc) actions.append(this.ghostToggle(() => this.render()));
    host.append(actions);

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then(stream => {
        if (!this.contentEl.isConnected) { for (const t of stream.getTracks()) t.stop(); return; }
        this.stream = stream;
        video.srcObject = stream;
      })
      .catch(() => {
        /* Permission refused, or the WebView simply won't do it. Not an
           error state — it is the other supported path. */
        this.stopStream();
        clear(host);
        host.append(el('h2', { class: 'gv-photo-title' }, `${this.pose.label} — progress photo`));
        host.append(el('p', { class: 'gv-photo-hint' }, this.pose.hint));
        this.renderHandoff(host, true);
      });
  }

  /* ---- path 2: OS camera, align afterwards ---- */
  renderHandoff(host, becausePermissionFailed) {
    const stage = el('div', { class: 'gv-photo-stage gv-photo-stage-static' });
    if (this.ghostSrc) stage.append(el('img', { class: 'gv-photo-ghost gv-photo-ghost-solo', src: this.ghostSrc, alt: 'Your previous photo in this pose' }));
    else stage.append(guideSvg(this.pose));
    host.append(stage);

    host.append(el('p', { class: 'gv-photo-note' },
      becausePermissionFailed
        ? 'No camera preview available here, so your phone\'s own camera will open. Match the shape above, then check the overlay on the next screen.'
        : 'Your phone\'s camera will open. Match the shape above — you can check the alignment and retake on the next screen.'));

    /* A file input is the only way to reach the OS camera from a WebView.
       `capture` asks for the camera rather than the photo library; a device
       without one falls back to the library, which is a reasonable answer. */
    const input = el('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'gv-sr-only' });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const bytes = toJpegBytes(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        /* Straight to save when there is nothing to compare against — a
           review step with no ghost would be a dead screen. */
        if (!this.ghostSrc) { this.commit(bytes); return; }
        this.pending = { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })) };
        this.render();
      };
      img.onerror = () => { URL.revokeObjectURL(url); new Notice('Gym: that file could not be read as an image.'); };
      img.src = url;
    });
    host.append(input);

    const open = el('button', { class: 'gv-btn gv-photo-shoot', type: 'button' }, ico('camera'), el('span', {}, 'Open camera'));
    open.addEventListener('click', () => input.click());
    host.append(el('div', { class: 'gv-photo-actions' }, open));
  }

  /* ---- the alignment review, handoff mode only ---- */
  renderReview(host) {
    const stage = el('div', { class: 'gv-photo-stage gv-photo-stage-static' },
      el('img', { class: 'gv-photo-shot', src: this.pending.url, alt: 'The photo you just took' }));
    if (this.showGhost) stage.append(el('img', { class: 'gv-photo-ghost', src: this.ghostSrc, alt: '' }));
    host.append(stage);
    host.append(el('p', { class: 'gv-photo-note' }, 'Your previous photo is laid over the new one. Retake if you are out of position.'));

    const keep = el('button', { class: 'gv-btn gv-photo-shoot', type: 'button' }, ico('check'), el('span', {}, 'Keep it'));
    keep.addEventListener('click', () => {
      const bytes = this.pending.bytes;
      URL.revokeObjectURL(this.pending.url);
      this.pending = null;
      this.commit(bytes);
    });
    const retake = el('button', { class: 'gv-btn gv-btn-ghost', type: 'button' }, ico('rotate-ccw'), el('span', {}, 'Retake'));
    retake.addEventListener('click', () => {
      URL.revokeObjectURL(this.pending.url);
      this.pending = null;
      this.render();
    });
    host.append(el('div', { class: 'gv-photo-actions' }, keep, retake, this.ghostToggle(() => this.render())));
  }

  ghostToggle(after) {
    const b = el('button', {
      class: `gv-chip${this.showGhost ? ' on' : ''}`, type: 'button',
      'aria-pressed': this.showGhost ? 'true' : 'false',
    }, el('span', {}, this.showGhost ? 'Overlay on' : 'Overlay off'));
    b.addEventListener('click', () => { this.showGhost = !this.showGhost; after(); });
    return b;
  }

  commit(bytes) {
    this.onCaptured(bytes, todayISO());
    this.close();
  }
}

module.exports = { PhotoCaptureModal, liveCameraAvailable, guideSvg, toJpegBytes };
