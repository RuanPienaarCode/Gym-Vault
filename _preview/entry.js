/* Nav harness entry. Uses the REAL NAV array and the REAL el()/ico() from
   src/, and reproduces buildNav's loop verbatim (controller.js:249-270) —
   buildNav is a closure inside mountApp, so it cannot be called directly
   without standing up a whole plugin host. That reproduction is the one
   thing here that can drift from the app; everything it consumes is real. */
const { el, ico } = require('../src/dom');
const { NAV } = require('../src/controller');

function buildBar(host, activeId) {
  const nav = el('div', { class: 'gv-nav' });
  const headActions = el('div', { class: 'gv-head-actions' });
  for (const item of NAV) {
    if (item.when && !item.when({})) continue;
    const head = item.place === 'head';
    const b = el('button', {
      class: head ? 'gv-head-btn' : 'gv-nav-btn',
      type: 'button', 'data-page': item.id,
      'aria-label': head ? item.label : null,
    }, ico(item.icon), head ? '' : el('span', { class: 'gv-nav-label' }, item.label));
    if (!head && item.id === activeId) b.classList.add('on');
    (head ? headActions : nav).append(b);
  }
  headActions.append(el('button', { class: 'gv-head-btn', type: 'button', 'aria-label': 'Gym Vault settings' }, ico('settings')));

  const head = el('div', { class: 'gv-head' },
    el('div', { class: 'gv-logo' }, ico('dumbbell'), el('span', { class: 'gv-logo-text' }, 'Gym Vault')),
    headActions);
  const page = el('main', { class: 'gv-page' },
    el('h2', { class: 'gv-toolbar-title' }, 'Page content'),
    el('p', {}, 'The bar above is built from the real NAV array with the real dom helpers.'));
  host.append(el('div', { class: 'gv-app gv-skin-floor gv-accent-lime' }, head, nav, page));
}

window.__buildBar = buildBar;

/* sound.js, exposed for _preview/sound.html — the one module whose whole job
   is device APIs the guard suite cannot reach (speechSynthesis, WebAudio,
   navigator.vibrate). resolveMode() is unit-tested; that it actually makes a
   noise is only knowable here. */
window.__sound = require('../src/sound');

/* countdown.js, for _preview/countdown.html — the count-in gate is timers +
   SVG + real layout, none of which the guard suite can see. */
window.__countdown = require('../src/countdown');

/* rep-counter-shared.js, for _preview/typein.html — attachTapZone's guards
   and the inline "Type" box are pointer/keyboard/focus behaviour, which is
   exactly what a node test cannot see. */
window.__shared = require('../src/rep-counter-shared');
window.__repcounter = require('../src/rep-counter');

/* counter-target.js, for _preview/fill.html — the meter is transform,
   pseudo-elements and stage attributes, none of which node can see. */
window.__target = require('../src/counter-target');

/* explainer.js, for _preview/explainer.html — inline SVG plus CSS keyframes,
   which only a browser can actually draw. */
window.__explainer = require('../src/explainer');

window.__flame = require('../src/streak-flame');

/* page-run-records.js and page-voice.js, for _preview/runrecords.html and
   _preview/voice.html — two whole routes rendered against a stub ctx, which
   is the only way to see them before deploying to a vault. */
window.__pages = {
  runRecords: require('../src/page-run-records'),
  voice: require('../src/page-voice'),
  running: require('../src/page-running'),
  profile: require('../src/page-profile'),
};
window.__voicePack = require('../src/voice-pack');
window.__voiceRecord = require('../src/voice-record');
window.__voiceClips = require('../src/voice-clips');

/* page-session.js, for _preview/counter.html — the guided counter screen:
   focus mode (gv-focus hiding the head/nav chrome), the counter-settings
   sheet, and the count-in armed() gate are all real-DOM/timer behaviour a
   node test cannot see. Exposed alongside the real dom helpers and NAV so
   the harness can build the SAME head/nav chrome the controller does,
   instead of a fake stand-in that could hide a real leak. */
window.__pages.session = require('../src/page-session');
window.__dom = require('./../src/dom');
window.__NAV = NAV;
window.__confetti = require('../src/confetti');

/* RepCounterModal, for _preview/counter.html's second frame — the freestyle
   tap-to-count modal. The stub Modal class has no modalEl/contentEl of its
   own (real Obsidian creates them); the harness builds those two nodes and
   hands them to onOpen(), which is all Modal's own machinery would have
   done before calling it. */
window.__RepCounterModal = require('../src/rep-counter-modal').RepCounterModal;

/* page-session-setup.js, for _preview/setsrow.html — the ONE sets field.
   The real setsBlock, not a hand-built replica: a harness that rebuilds the
   markup it is meant to be checking stops matching what ships the moment
   the screen changes, which is exactly what happened to the nine-row
   version of this page. */
window.__setsBlock = require('../src/page-session-setup').setsBlock;
window.__setsForItem = require('../src/page-session-setup').setsForItem;

/* The WHOLE guided-setup screen, for _preview/setup.html. setsrow.html
   drives setsBlock alone; this drives render(), because the bug reported
   against 0.10.2 was not in any one control — it was the ORDER, and "Start
   is below the fold on a 390px phone" is a claim only a browser with a real
   viewport can settle. */
window.__setupPage = require('../src/page-session-setup');
  window.__constants = require('../src/constants');
