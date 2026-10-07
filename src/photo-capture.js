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

const stopTracks = stream => { for (const track of stream.getTracks()) track.stop(); };

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
    /* Which getUserMedia request is the live one. A request that resolves
       after it was superseded (a re-render asked again) or after the modal
       closed holds a camera nobody will ever stop — see renderLive. */
    this.streamToken = 0;
    this.closed = false;
    this.pending = null;          // {bytes, url} awaiting confirm in handoff mode
  }

  onOpen() {
    this.closed = false;
    this.modalEl.addClass('gv-app');
    this.modalEl.addClass('gv-photo-modal');
    this.render();
  }

  onClose() {
    this.closed = true;
    this.streamToken++;           // any request still in flight is now stale
    this.stopStream();
    if (this.pending && this.pending.url) URL.revokeObjectURL(this.pending.url);
    clear(this.contentEl);
  }

  /* Release the camera the moment we are done with it. A WebView that keeps
     a stream open leaves the phone's camera light on and drains the battery
     long after the modal is gone. */
  stopStream() {
    if (!this.stream) return;
    stopTracks(this.stream);
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
    /* The <video> this stream fed was just thrown away with the rest of the
       modal body, so release the camera now and ask again below; the token
       makes any earlier request that is still pending stop itself on arrival
       instead of overwriting this.stream and being orphaned. */
    this.stopStream();
    const token = ++this.streamToken;
    const video = el('video', { class: 'gv-photo-video', playsinline: 'true', muted: 'true', autoplay: 'true' });
    video.muted = true;                       // attribute alone is not enough on iOS
    const overlayNode = () => (this.ghostSrc && this.showGhost
      ? el('img', { class: 'gv-photo-ghost', src: this.ghostSrc, alt: '' })
      : guideSvg(this.pose));
    let overlay = overlayNode();
    const stage = el('div', { class: 'gv-photo-stage' }, video, overlay);
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
    /* The overlay chip swaps ONLY the overlay node. It used to re-render the
       whole modal, which opened a second camera stream and orphaned the
       first — the camera stayed on after close. */
    if (this.ghostSrc) {
      actions.append(this.ghostToggle(() => {
        const next = overlayNode();
        overlay.replaceWith(next);
        overlay = next;
      }));
    }
    host.append(actions);

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then(stream => {
        /* Closed, or a newer request owns the screen: this stream has no
           video element to feed and nothing will ever stop it but us. */
        if (this.closed || token !== this.streamToken || !this.contentEl.isConnected) { stopTracks(stream); return; }
        this.stopStream();            // never leave an earlier stream orphaned
        this.stream = stream;
        video.srcObject = stream;
      })
      .catch(() => {
        /* A refusal for a request that is no longer the live one must not
           tear down the screen the newer request is driving. */
        if (this.closed || token !== this.streamToken) return;
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

  /* The overlay on/off chip. It repaints itself (rebuilt through el(), so a
     fresh chip keeps the host-button opt-out el() gives every button) and then
     calls `after` — which decides how much of the screen has to change. */
  ghostToggle(after) {
    const build = () => {
      const b = el('button', {
        class: `gv-chip${this.showGhost ? ' on' : ''}`, type: 'button',
        'aria-pressed': this.showGhost ? 'true' : 'false',
      }, el('span', {}, this.showGhost ? 'Overlay on' : 'Overlay off'));
      b.addEventListener('click', () => {
        this.showGhost = !this.showGhost;
        const next = build();
        const hadFocus = document.activeElement === b;
        b.replaceWith(next);
        if (hadFocus && typeof next.focus === 'function') next.focus();
        after();
      });
      return b;
    };
    return build();
  }

  commit(bytes) {
    this.onCaptured(bytes, todayISO());
    this.close();
  }
}

module.exports = { PhotoCaptureModal, liveCameraAvailable, guideSvg, toJpegBytes };
