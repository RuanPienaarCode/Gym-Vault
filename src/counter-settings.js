'use strict';
/* THE ONE BUTTON THE SECONDARY CONTROLS LIVE BEHIND.

   The counter bar used to carry six controls side by side: motion, mute,
   help, type, undo, done. Three of those are setup decisions — how this set
   should be counted — and they were sitting at thumb height for the whole
   set, next to the two that are actually used mid-rep. A row of six
   same-sized buttons also gives no hint which one matters, so the eye has to
   read all of them every time it comes back from the number.

   What stays on the bar is what you reach for WITHOUT looking away from the
   count: mute, undo, done. What moves in here is what you decide once, at
   the start: motion counting, typing a count in, and the explainer.

   Modelled on explainer.js's sheet, deliberately: same overlay-the-counter
   behaviour, same propagation guard, same dismiss contract. Two different
   sheet idioms over one tap zone would be two different sets of bugs. */

const { el, ico } = require('./dom');

/* Appends the sheet to `host` and returns a function that removes it.
   `rows` is [{ label, hint, node }] — `node` is the LIVE control, moved in
   here rather than rebuilt, so its state and listeners ride along. */
function openCounterSettings(host, rows, opts) {
  const o = opts || {};
  const close = el('button', { class: 'gv-icon-btn gv-cs-close', type: 'button', 'aria-label': 'Close' }, ico('x'));

  const list = el('div', { class: 'gv-cs-rows' });
  for (const r of (rows || [])) {
    if (!r || !r.node) continue;
    list.append(el('div', { class: 'gv-cs-row' },
      el('div', { class: 'gv-cs-text' },
        el('span', { class: 'gv-cs-label' }, r.label || ''),
        r.hint ? el('span', { class: 'gv-cs-hint' }, r.hint) : ''),
      el('div', { class: 'gv-cs-control' }, r.node)));
  }

  const sheet = el('div', {
    class: 'gv-cs', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Counter settings',
  },
    el('div', { class: 'gv-cs-head' },
      el('h2', { class: 'gv-kicker gv-cs-kicker' }, 'Counter'),
      close),
    list);

  /* Presses inside the sheet must not reach the tap zone underneath — the
     same trap explainer.js documents: a tap on a setting would otherwise
     also count as a rep. */
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

/* The gear itself. `getHost` is resolved lazily (a function) for the same
   reason helpButton does it: the guided view rebuilds its DOM on every
   render, so a captured node is stale by the time anyone presses this.

   `getRows` is called at OPEN time, not build time — a row's control may
   not exist yet when the bar is assembled, and motion's label depends on
   whether the sensor is currently running. */
function counterSettingsButton(getHost, getRows) {
  const btn = el('button', {
    class: 'gv-icon-btn gv-cs-btn', type: 'button', 'aria-label': 'Counter settings',
  }, ico('settings'));
  btn.addEventListener('click', () => {
    const host = typeof getHost === 'function' ? getHost() : getHost;
    if (!host) return;
    if (host.querySelector('.gv-cs')) return; // already open — do not stack sheets
    const rows = typeof getRows === 'function' ? getRows() : getRows;
    const dismiss = openCounterSettings(host, rows);
    /* Controls that open their OWN surface have to take the sheet down with
       them: Type edits the count element underneath this sheet, and the
       explainer would otherwise stack a second dialog on top of it. The
       motion toggle deliberately does not close — you may want to flip it
       and read the sensitivity line it reveals. */
    for (const r of (rows || [])) {
      if (r && r.node && r.closeOnUse) r.node.addEventListener('click', dismiss);
    }
  });
  return btn;
}

module.exports = { counterSettingsButton, openCounterSettings };
