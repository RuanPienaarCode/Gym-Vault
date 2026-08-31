'use strict';
/* "How does this thing count?" — the help sheet behind the ? on every
   counter.

   ALWAYS AVAILABLE, NEVER AUTOMATIC. It does not appear on first run and it
   does not appear once and vanish forever: someone who used this in January
   and comes back in June has exactly the same question as someone new, and a
   one-time tour answers it for neither. A ? that is always in the same place
   is the version that still works the second time you need it.

   Drawn, not written. The two things worth explaining — tap the big area,
   or tilt the phone — are movements, and a sentence describing a movement is
   a worse sentence than a picture of it. Inline SVG so it works offline with
   no image files, built through the DOM like everything else (no innerHTML),
   and animated in CSS so prefers-reduced-motion can stop it without stopping
   the explanation. */

const { el, ico } = require('./dom');

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  return n;
}

/* A phone outline, used by both drawings so they read as the same device. */
function phone(attrs) {
  const g = svgEl('g', attrs || {});
  g.appendChild(svgEl('rect', { x: 0, y: 0, width: 56, height: 104, rx: 9, class: 'gv-xp-phone' }));
  g.appendChild(svgEl('rect', { x: 5, y: 10, width: 46, height: 84, rx: 4, class: 'gv-xp-screen' }));
  g.appendChild(svgEl('rect', { x: 21, y: 4, width: 14, height: 3, rx: 1.5, class: 'gv-xp-speaker' }));
  return g;
}

/* TAP: a finger coming down onto the screen, with the ripple it leaves. */
function tapDrawing() {
  const svg = svgEl('svg', {
    viewBox: '0 0 140 130', class: 'gv-xp-svg', role: 'img',
    'aria-label': 'A finger tapping the middle of the phone screen, once per rep.',
  });
  const g = svgEl('g', { transform: 'translate(24 12)' });
  g.appendChild(phone());

  /* The ripple is a circle that grows and fades under the fingertip. */
  const ripple = svgEl('circle', { cx: 28, cy: 52, r: 6, class: 'gv-xp-ripple' });
  g.appendChild(ripple);

  /* The finger: a rounded stub on a wrist line, moving down and back. */
  const hand = svgEl('g', { class: 'gv-xp-hand' });
  hand.appendChild(svgEl('path', { d: 'M28 22 L28 6', class: 'gv-xp-arm' }));
  hand.appendChild(svgEl('circle', { cx: 28, cy: 26, r: 7, class: 'gv-xp-finger' }));
  g.appendChild(hand);

  svg.appendChild(g);
  return svg;
}

/* TILT: the phone rocking, which is what the motion sensor is reading. */
function tiltDrawing() {
  const svg = svgEl('svg', {
    viewBox: '0 0 140 130', class: 'gv-xp-svg', role: 'img',
    'aria-label': 'The phone rocking up and down, counting each movement as a rep.',
  });
  const g = svgEl('g', { class: 'gv-xp-tilt', transform: 'translate(42 13)' });
  g.appendChild(phone());
  svg.appendChild(g);

  /* Two arrows, one each way, so the drawing says "up AND down" even frozen
     under reduced motion — the animation is a bonus, not the message. */
  const up = svgEl('path', { d: 'M20 74 L20 46 M13 53 L20 46 L27 53', class: 'gv-xp-arrow' });
  const down = svgEl('path', { d: 'M120 46 L120 74 M113 67 L120 74 L127 67', class: 'gv-xp-arrow' });
  svg.appendChild(up);
  svg.appendChild(down);
  return svg;
}

function card(drawing, title, body) {
  return el('div', { class: 'gv-xp-card' },
    el('div', { class: 'gv-xp-art' }, drawing),
    el('h3', { class: 'gv-xp-title' }, title),
    el('p', { class: 'gv-xp-body' }, body));
}

/* Appends the sheet to `host` and returns a function that removes it. The
   sheet covers the counter rather than replacing it, because the thing being
   explained should still be there when the explanation closes. */
function openExplainer(host, opts) {
  const o = opts || {};
  const close = el('button', { class: 'gv-icon-btn gv-xp-close', type: 'button', 'aria-label': 'Close' }, ico('x'));

  const sheet = el('div', {
    class: 'gv-xp', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'How the counter works',
  },
    el('div', { class: 'gv-xp-head' },
      el('h2', { class: 'gv-kicker gv-xp-kicker' }, 'How this counts'),
      close),
    el('div', { class: 'gv-xp-cards' },
      card(tapDrawing(), 'Tap',
        'Tap anywhere in the big area — once per rep. Put the phone on the floor '
        + 'and touch it with your nose at the bottom of a push-up, or tap with a finger. '
        + 'Two taps closer together than about three quarters of a second count as one, '
        + 'so a chin brushing past on the way down does not add a rep.'),
      card(tiltDrawing(), 'Or tilt',
        'Turn on motion counting and the phone counts the movement itself — strapped to '
        + 'your arm, or held against your chest. If it counts one rep as two, or misses '
        + 'them, change the sensitivity: it is remembered per exercise, so you only '
        + 'correct it once.')),
    el('p', { class: 'gv-xp-foot' },
      'Anything the sensor misses can be tapped in, or typed straight in with Type.'));

  /* Presses inside the sheet must not reach the tap zone underneath — a tap
     on the explanation would otherwise count as a rep. */
  for (const ev of ['touchstart', 'mousedown', 'click', 'keydown']) {
    sheet.addEventListener(ev, e => e.stopPropagation());
  }

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    sheet.remove();
    if (o.onClose) o.onClose();
  };
  close.addEventListener('click', dismiss);

  host.append(sheet);
  close.focus();
  return dismiss;
}

/* The ? itself. `host` is resolved lazily (a function) because the guided
   view rebuilds its DOM on every render and a captured node would be stale
   by the time anyone pressed the button. */
function helpButton(getHost) {
  const btn = el('button', {
    class: 'gv-icon-btn gv-xp-btn', type: 'button', 'aria-label': 'How the counter works',
  }, ico('help-circle'));
  btn.addEventListener('click', () => {
    const host = typeof getHost === 'function' ? getHost() : getHost;
    if (!host) return;
    if (host.querySelector('.gv-xp')) return; // already open — do not stack sheets
    openExplainer(host);
  });
  return btn;
}

module.exports = { helpButton, openExplainer };
