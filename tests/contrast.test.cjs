'use strict';
/* WCAG AA gates on the accent palettes, read from src/styles.css itself
   (the single source of every accent hex).

   PART 1 — the palettes. Two pairs matter per accent:
     deep on white        — small text on paper (goal numerals, rx values)
     flood-dim on accent  — small text on the accent flood (shout lines)
   Both must clear 4.5:1 (the text is 10.5–11px/800 — never "large"). A new
   palette that fails here must be darkened before it ships.

   PART 2 — the outcome, per rule, per theme (0.12.1, L5-02). `--gv-ink` flips
   to near-white in dark mode, so a rule that puts light-theme text on
   `background: var(--gv-ink)` (lime-hi on the ladder's current week, the
   setup logo, the Finish button's hover) printed 1.34:1 in dark, and lime-deep
   on a dark surface printed 3.5:1 or worse: ten rules shipped light-mode text
   colours into dark mode, and nothing noticed, because PART 1 only ever looked
   at light-theme pairs. Part 2 runs the REAL cascade (tests/css-cascade.js:
   specificity + source order over src/styles.css) for each probed element in
   every theme x accent x skin and checks the colour that actually wins against
   the colour actually painted behind it. It names the rule that painted each
   side, so a failure says which line to open. A dark twin that loses a
   specificity tie shows up here; a pair-of-tokens table would not see it.

   Targets (WCAG 1.4.3 / 1.4.11): 4.5:1 for text under 24px, or under 18.66px
   when bold; 3:1 for large text and for non-text glyphs (icons).
   Set CONTRAST_REPORT=1 to print every measured ratio instead of asserting. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = hex => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
};

/* Collect palettes: the .gv-app defaults plus every gv-accent block. */
const palettes = {};
const blockRe = /\.gv-app(?:\.gv-accent-([a-z]+))?\s*\{([^}]*)\}/g;
let m;
while ((m = blockRe.exec(css))) {
  const name = m[1] || 'lime';
  const get = key => { const mm = m[2].match(new RegExp(`--gv-${key}:\\s*(#[0-9a-fA-F]{6})`)); return mm ? mm[1] : null; };
  const lime = get('lime'), deep = get('lime-deep'), dim = get('flood-dim');
  if (lime && deep && dim) palettes[name] = { lime, deep, dim };
}

const names = Object.keys(palettes);
assert.ok(names.length >= 5, `expected the 5 accent palettes, found: ${names.join(', ')}`);

for (const [name, p] of Object.entries(palettes)) {
  const deepOnWhite = ratio(p.deep, '#ffffff');
  const dimOnFlood = ratio(p.dim, p.lime);
  assert.ok(deepOnWhite >= 4.5, `${name}: deep ${p.deep} on white = ${deepOnWhite.toFixed(2)} (< 4.5)`);
  assert.ok(dimOnFlood >= 4.5, `${name}: flood-dim ${p.dim} on ${p.lime} = ${dimOnFlood.toFixed(2)} (< 4.5)`);
}


/* ---------- PART 2: the cascade outcome ---------- */

const rules = cx.load();
const THEMES = ['dark', 'light'];
const SKINS = ['floor', 'editorial', 'apex', 'lockin', 'calm'];
const ACCENTS = ['lime', 'volt', 'blaze', 'electric', 'punch', 'olive'];

/* kind 'glyph' = an icon (3:1). Everything else is text, classed by the size
   and weight the cascade gives it. `chain` is the element path under
   <main class="gv-page">, written as the JS builds it. */
/* `modal` = the probe lives in an Obsidian Modal (appended to <body>, outside the
   workspace leaf and the page), not under <main class="gv-page">. */
const text = (id, chain, finding, surface, modal) => ({ id, chain, finding, kind: 'text', surface, modal: !!modal });
const glyph = (id, chain, finding, modal) => ({ id, chain, finding, kind: 'glyph', modal: !!modal });
const LOGSET = ['div.gv-card.gv-log-card', 'div.gv-log-sets'];
const LOGTOP = 'div.gv-logtop';

const PROBES = [
  /* ---- the audit's list: L5-02 (+ L4-05 rung, L4-11 trend/recrow) ---- */
  text('.gv-rung.now km', ['div.gv-ladder', 'div.gv-rung.now', 'div.gv-rung-km'], 'L5-02/L4-05'),
  text('.gv-rung.now week', ['div.gv-ladder', 'div.gv-rung.now', 'div.gv-rung-wk'], 'L5-02/L4-05'),
  text('.gv-log-set.done unit', [...LOGSET, 'div.gv-log-set.done', 'span.gv-set-unit'], 'L5-02'),
  text('.gv-log-set.done number', [...LOGSET, 'div.gv-log-set.done', 'span.gv-set-num'], 'L5-02'),
  glyph('.gv-log-set.done tick', [...LOGSET, 'div.gv-log-set.done', 'button.gv-set-done', 'span.gv-ico', 'svg'], 'L5-02'),
  text('.gv-btn-finish:hover', ['div.gv-log-foot', 'button.gv-btn-finish:hover'], 'L5-02'),
  glyph('.gv-setup-logo glyph', ['div.gv-setup', 'div.gv-setup-logo', 'span.gv-ico', 'svg'], 'L5-02'),
  text('.gv-trend-delta.downs', ['div.gv-card.gv-trend-card', 'div.gv-trend-head', 'span.gv-trend-delta.downs'], 'L4-11'),
  text('.gv-recrow-margin (completion screen)', ['div.gv-session-records', 'div.gv-recrow', 'div.gv-recrow-margin'], 'L4-11'),
  text('.gv-recrow-margin (records card)', ['div.gv-card.gv-recrow', 'div.gv-recrow-margin'], 'L4-11'),
  text('.gv-add-line:hover', ['button.gv-add-line:hover', 'span'], 'L5-02'),
  text('.gv-day.today label', ['div.gv-week', 'div.gv-day.today', 'div.gv-day-dot'], 'L5-02'),
  text('.gv-day.today name', ['div.gv-week', 'div.gv-day.today', 'div.gv-day-name'], 'L5-02'),
  text('.gv-media-frame-tag', ['div.gv-media-frames', 'div.gv-media-frame', 'span.gv-media-frame-tag'], 'L5-02'),
  text('.gv-logtop-sub', [LOGTOP, 'div.gv-logtop-lead', 'div', 'div.gv-logtop-sub'], 'L5-02'),
  text('.gv-logtop-title', [LOGTOP, 'div.gv-logtop-lead', 'div', 'h2.gv-logtop-title'], 'L5-02'),
  text('.gv-log-clock', [LOGTOP, 'div.gv-log-clock', 'span.gv-log-elapsed'], 'L5-02'),
  glyph('.gv-logtop back button glyph', [LOGTOP, 'div.gv-logtop-lead', 'button.gv-icon-btn', 'span.gv-ico', 'svg'], 'L5-02'),
  text('.gv-logtop Guided button', [LOGTOP, 'button.gv-btn.gv-btn-ghost.gv-btn-small.gv-logtop-guided', 'span.gv-btn-guided-label'], 'L5-02'),

  /* ---- already-green pairs on the same surfaces: they must stay green ---- */
  text('.gv-kicker on the page', ['p.gv-kicker']),
  text('.gv-tile-label on a tile', ['div.gv-tiles', 'div.gv-tile', 'div.gv-tile-label']),
  text('.gv-rx b (lime-deep / lime numeral)', ['div.gv-hero.gv-hero-today', 'ul.gv-rx', 'li', 'b']),
  text('.gv-goal-nums b', ['div.gv-card.gv-goal-card', 'div.gv-goal-main', 'div.gv-goal-nums', 'b']),
  text('.gv-day.done label', ['div.gv-week', 'div.gv-day.done', 'div.gv-day-dot']),
  text('.gv-btn-go label', ['div.gv-hero-action', 'button.gv-btn-go', 'span']),
  text('.gv-btn primary label', ['button.gv-btn', 'span']),
  text('.gv-btn-ghost label', ['button.gv-btn.gv-btn-ghost', 'span']),
  text('.gv-nav-btn.on label', ['nav.gv-nav', 'button.gv-nav-btn.on', 'span.gv-nav-label']),
  glyph('.gv-head-btn.on glyph', ['div.gv-head-actions', 'button.gv-head-btn.on', 'span.gv-ico', 'svg']),
  text('.gv-chip.on', ['div.gv-chips', 'button.gv-chip.on']),
  text('.gv-tag', ['span.gv-tag']),
  text('.gv-tag-type', ['span.gv-tag.gv-tag-type']),
  text('.gv-badge', ['span.gv-badge']),
  text('.gv-session-callout', ['div.gv-session-callouts', 'div.gv-session-callout']),
  text('.gv-session-wins', ['div.gv-session-complete', 'div.gv-session-wins']),
  text('.gv-session-target', ['div.gv-session-exblock', 'div.gv-session-target']),
  text('.gv-log-ex-name on the exercise head', [...LOGSET.slice(0, 1), 'div.gv-log-ex-head', 'div.gv-log-ex-name']),
  text('.gv-log-ex-target on the exercise head', [...LOGSET.slice(0, 1), 'div.gv-log-ex-head', 'div.gv-log-ex-target']),
  /* An exercise with nothing logged yet (page-log's `.unlogged` card, the state
     every card is in when a session is first opened). Its name used to take
     --gv-ink-dim, which on the accent head is 1.57:1 in dark: the audit's
     BLOCKER. The head is an accent flood in every theme, so everything on it
     takes the fixed ink. */
  text('.gv-log-ex-name on the exercise head (nothing logged yet)', ['div.gv-card.gv-log-card.unlogged', 'div.gv-log-ex-head', 'div.gv-log-ex-name'], 'blocker'),
  text('.gv-log-ex-target on the exercise head (nothing logged yet)', ['div.gv-card.gv-log-card.unlogged', 'div.gv-log-ex-head', 'div.gv-log-ex-target'], 'blocker'),
  glyph('.gv-log-ex-head remove button glyph (logged)', ['div.gv-card.gv-log-card', 'div.gv-log-ex-head', 'button.gv-icon-btn.gv-icon-btn-small', 'span.gv-ico', 'svg'], 'blocker'),
  glyph('.gv-log-ex-head remove button glyph (nothing logged yet)', ['div.gv-card.gv-log-card.unlogged', 'div.gv-log-ex-head', 'button.gv-icon-btn.gv-icon-btn-small', 'span.gv-ico', 'svg'], 'blocker'),
  text('.gv-log-set number (not done)', [...LOGSET, 'div.gv-log-set', 'span.gv-set-num']),
  text('.gv-log-set unit (not done)', [...LOGSET, 'div.gv-log-set', 'span.gv-set-unit']),
  glyph('.gv-set-done tick (not done)', [...LOGSET, 'div.gv-log-set', 'button.gv-set-done', 'span.gv-ico', 'svg']),
  text('.gv-btn-finish label', ['div.gv-log-foot', 'button.gv-btn-finish']),
  text('.gv-btn-discard', ['div.gv-log-foot', 'button.gv-btn-discard']),
  text('.gv-btn-danger-ghost', ['button.gv-btn.gv-btn-danger-ghost', 'span']),
  text('.gv-warn-line text', ['div.gv-warn-line']),
  text('.gv-planswap link', ['button.gv-planswap']),
  text('.gv-add-line label', ['button.gv-add-line', 'span']),
  text('.gv-tile-ico caption-free numeral', ['div.gv-tiles', 'div.gv-tile', 'div.gv-tile-big']),

  /* ---- progress + personal-best elements (every skin), and the Apex skin's
     own surfaces. Chains follow the markup page-dashboard / page-session /
     page-records emit. The Apex ones sit on slabs: tests/css-cascade.js reads
     --gv-slab as the fill the leaning ::before paints. ---- */
  text('PB in reach line', ['div.gv-hero.gv-hero-today', 'ul.gv-rx', 'li.gv-rx-reach', 'span', 'span.gv-pb-reach'], 'progress'),
  text('PB in reach row value', ['div.gv-hero.gv-hero-today', 'ul.gv-rx', 'li.gv-rx-reach', 'b'], 'progress'),
  text('ticker word', ['div.gv-hero.gv-hero-today', 'div.gv-ticker', 'div.gv-ticker-band', 'div', 'span'], 'apex'),
  text('week progress label', ['div.gv-week-progress', 'div.gv-week-progress-text', 'span.gv-week-progress-label'], 'progress'),
  text('week progress number', ['div.gv-week-progress', 'div.gv-week-progress-text', 'b.gv-week-progress-num'], 'progress'),
  text('week progress to-go', ['div.gv-week-progress', 'div.gv-week-progress-text', 'span.gv-week-progress-togo'], 'progress'),
  text('streak risk line', ['p.gv-streak-risk'], 'progress'),
  text('streak number', ['div.gv-streak', 'div.gv-streak-read', 'div.gv-streak-num'], 'apex'),
  text('live target label', ['div.gv-pb-target', 'span.gv-pb-target-label'], 'progress'),
  text('live target now', ['div.gv-pb-target', 'span.gv-pb-target-now'], 'progress'),
  text('live target to-go', ['div.gv-pb-target', 'span.gv-pb-target-togo'], 'progress'),
  text('live target label (beaten)', ['div.gv-pb-target.is-beaten', 'span.gv-pb-target-label'], 'progress'),
  text('live target now (beaten)', ['div.gv-pb-target.is-beaten', 'span.gv-pb-target-now'], 'progress'),
  text('live target to-go (beaten)', ['div.gv-pb-target.is-beaten', 'span.gv-pb-target-togo'], 'progress'),
  text('PB moment kicker', ['div.gv-session-complete', 'div.gv-pb-moment', 'p.gv-pb-moment-kicker'], 'progress'),
  text('PB moment name', ['div.gv-session-complete', 'div.gv-pb-moment', 'h3.gv-pb-moment-name'], 'progress'),
  text('PB moment old value', ['div.gv-session-complete', 'div.gv-pb-moment', 'div.gv-pb-moment-swap', 's.gv-pb-old'], 'progress'),
  glyph('PB moment arrow', ['div.gv-session-complete', 'div.gv-pb-moment', 'div.gv-pb-moment-swap', 'span.gv-ico.gv-pb-arrow', 'svg'], 'progress'),
  text('PB moment new value', ['div.gv-session-complete', 'div.gv-pb-moment', 'div.gv-pb-moment-swap', 'b.gv-pb-new'], 'progress'),
  text('PB moment unit', ['div.gv-session-complete', 'div.gv-pb-moment', 'div.gv-pb-moment-swap', 'small.gv-pb-unit'], 'progress'),
  text('PB moment delta chip', ['div.gv-session-complete', 'div.gv-pb-moment', 'div.gv-pb-moment-chips', 'span.gv-pb-delta'], 'progress'),
  text('newest record: name', ['div.gv-card-list', 'div.gv-card.gv-recrow.gv-rec-new', 'div.gv-recrow-main', 'div.gv-recrow-name'], 'progress'),
  text('newest record: what it beat', ['div.gv-card-list', 'div.gv-card.gv-recrow.gv-rec-new', 'div.gv-recrow-main', 'div.gv-recrow-was', 's.gv-rec-prev'], 'progress'),
  text('newest record: delta chip', ['div.gv-card-list', 'div.gv-card.gv-recrow.gv-rec-new', 'div.gv-recrow-main', 'div.gv-recrow-was', 'span.gv-rec-delta'], 'progress'),
  text('newest record: value', ['div.gv-card-list', 'div.gv-card.gv-recrow.gv-rec-new', 'div.gv-recrow-margin'], 'progress'),
  text('older record: value', ['div.gv-card-list', 'div.gv-card.gv-recrow', 'div.gv-recrow-margin']),
  text('Today title', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title']),
  /* The split title (design fidelity): the giant first word and the outlined rest, in every skin. */
  text('Today title: giant first word', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title.is-split', 'span.gv-title-first'], 'fidelity'),
  text('Today title: outlined rest', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title.is-split', 'span.gv-title-rest'], 'fidelity'),
  text('hero chip (sets / minutes)', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'div.gv-hero-chips', 'div.gv-hero-chip-row', 'span.gv-hero-chip'], 'fidelity'),
  text('streak badge number', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'div.gv-hero-badge', 'div.gv-badge-fig', 'div.gv-badge-in', 'b.gv-badge-num'], 'fidelity'),
  /* The label is a SIBLING of the badge figure, not inside it, so what it inherits and what is painted behind it
     are two different elements. Lock In lays it on the amber starburst (.gv-badge-fig), so the surface is the
     figure's own fill (a `surface` probe reads that), not the hero's: measured against the hero, a label that
     inherited the page's white on a rest day printed fine and was 1.83:1 on the real surface. Apex draws it
     BELOW its hexagon, on the hero, so it keeps the default. */
  ...[['', 'div.gv-hero.gv-hero-today'], [' (rest / no plan)', 'div.gv-hero.gv-hero-today.gv-hero-rest']].flatMap(([when, hero]) => {
    const badge = [hero, 'div.gv-hero-head', 'div.gv-hero-stage', 'div.gv-hero-badge'];
    const onStar = skin => (skin === 'lockin' ? [...badge, 'div.gv-badge-fig'] : null);
    return [
      text(`streak badge label${when}`, [...badge, 'span.gv-badge-label'], 'fidelity', onStar),
      ...(when ? [text(`streak badge number${when}`, [...badge, 'div.gv-badge-fig', 'div.gv-badge-in', 'b.gv-badge-num'], 'fidelity')] : []),
    ];
  }),
  text('week header title', ['div.gv-week-head', 'span.gv-week-head-title'], 'fidelity'),
  text('week header note', ['div.gv-week-head', 'span.gv-week-head-note'], 'fidelity'),
  /* The REST hero (0.13.1): Lock In keeps it off the accent flood. */
  text('rest hero title', ['div.gv-hero.gv-hero-today.gv-hero-rest', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title']),
  text('rest hero kicker', ['div.gv-hero.gv-hero-today.gv-hero-rest', 'div.gv-hero-head', 'p.gv-kicker']),
  text('rest hero sub', ['div.gv-hero.gv-hero-today.gv-hero-rest', 'div.gv-hero-head', 'p.gv-hero-sub']),
  text('rest hero plan switcher', ['div.gv-hero.gv-hero-today.gv-hero-rest', 'div.gv-hero-head', 'p.gv-kicker', 'button.gv-planswap']),
  /* The Lock In HEAD (kicker, plan switcher, title, chips, sub) is the accent FLOOD; the list, BRING line, Start
     and the rest-day list sit on the page's own colour. Probed in every skin on the surface each really has. */
  text('hero kicker', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'p.gv-kicker'], 'lockin'),
  text('hero plan switcher', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'p.gv-kicker', 'button.gv-planswap', 'span'], 'lockin'),
  text('hero BRING label', ['div.gv-hero.gv-hero-today', 'div.gv-chips.gv-today-kit', 'span.gv-kicker.gv-today-kit-label'], 'lockin'),
  text('hero BRING chip', ['div.gv-hero.gv-hero-today', 'div.gv-chips.gv-today-kit', 'span.gv-tag'], 'lockin'),
  text('hero rx name', ['div.gv-hero.gv-hero-today', 'ul.gv-rx', 'li', 'span'], 'lockin'),
  text('hero rest-day value', ['div.gv-hero.gv-hero-today.gv-hero-rest', 'ul.gv-rx.gv-rx-rest', 'li', 'b'], 'lockin'),
  text('hero CTA label (on the flood)', ['div.gv-hero.gv-hero-today', 'div.gv-hero-action', 'button.gv-btn-go', 'span'], 'lockin'),
  text('hero CTA label hover (on the flood)', ['div.gv-hero.gv-hero-today', 'div.gv-hero-action', 'button.gv-btn-go:hover', 'span'], 'lockin'),
  text('hero Log manually button', ['div.gv-hero.gv-hero-today', 'button.gv-btn-hero-ghost.gv-hero-manual', 'span'], 'lockin'),
  text('PB moment name', ['div.gv-session-complete', 'div.gv-pb-moment', 'h3.gv-pb-moment-name'], 'lockin'),
  text('Today sub', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'p.gv-hero-sub']),
  text('hero shout line', ['div.gv-hero.gv-hero-today', 'div.gv-hero-action', 'div.gv-hero-action-line', 'span.gv-shout']),
  text('rest-day ghost button', ['div.gv-hero.gv-hero-today.gv-hero-rest', 'button.gv-btn-hero-ghost', 'span']),
  text('.gv-day.rest label', ['div.gv-week', 'div.gv-day.rest', 'div.gv-day-name']),
  text('.gv-day.planned name', ['div.gv-week', 'div.gv-day.planned', 'div.gv-day-name']),
  text('.gv-day.planned label', ['div.gv-week', 'div.gv-day.planned', 'div.gv-day-dot']),
  text('.gv-day.done.today name', ['div.gv-week', 'div.gv-day.done.today', 'div.gv-day-name']),
  text('.gv-ex-best', ['div.gv-ex-list', 'div.gv-ex-card', 'span.gv-ex-best']),
  text('.gv-chip (off)', ['div.gv-chips', 'button.gv-chip']),
  text('.gv-segmented-btn (off)', ['div.gv-segmented', 'button.gv-segmented-btn']),
  text('.gv-segmented-btn.on', ['div.gv-segmented', 'button.gv-segmented-btn.on']),
  text('.gv-nav-btn (off)', ['nav.gv-nav', 'button.gv-nav-btn', 'span.gv-nav-label']),
  glyph('.gv-icon-btn glyph', ['div.gv-toolbar', 'button.gv-icon-btn', 'span.gv-ico', 'svg']),
  glyph('.gv-icon-btn-on glyph', ['div.gv-rc-controls', 'button.gv-icon-btn.gv-icon-btn-on', 'span.gv-ico', 'svg']),
  glyph('.gv-head-btn glyph (off)', ['div.gv-head-actions', 'button.gv-head-btn', 'span.gv-ico', 'svg']),
  glyph('.gv-timed-play glyph', ['div.gv-timed-controls', 'button.gv-timed-play', 'span.gv-ico', 'svg']),
  /* PAUSED TIMERS: the "Paused" line on each timer, and the hold's Done. The hold's line sits in the
     counter zone: probed here on the idle zone only, because the stage floods are painted by layers this cascade
     probe does not model (tests/rc-zone-stages.test.cjs holds the hint on every stage, with the flood composited);
     the circuit's is absolutely placed in the ring; the rest's is in flow under the button. */
  text('paused line: hold (idle zone)', ['div.gv-session-body', 'div.gv-rc-zone.gv-session-zone', 'div.gv-rc-hint'], 'pause'),
  text('paused line: circuit (in the ring)', ['div.gv-session-body.gv-timed', 'div.gv-timed-dial', 'div.gv-rc-hint'], 'pause'),
  text('paused line: rest', ['div.gv-session-rest', 'div.gv-rc-hint'], 'pause'),
  text('hold Done (ghost button, paused)', ['div.gv-session-body', 'div.gv-timed-controls', 'button.gv-btn.gv-btn-ghost.gv-hold-done', 'span'], 'pause'),
  glyph('.gv-dial-step glyph', ['div.gv-dial-row', 'button.gv-dial-step', 'span.gv-ico', 'svg']),
  text('.gv-logo text', ['div.gv-head', 'div.gv-logo', 'span.gv-logo-text']),
  text('set number box', [...LOGSET, 'div.gv-log-set', 'input.gv-set-input']),
  text('.gv-log-set.done input', [...LOGSET, 'div.gv-log-set.done', 'input.gv-set-input']),
  text('.gv-btn-go on the rest screen', ['div.gv-session-rest', 'div.gv-hero-action.gv-session-nextwrap', 'button.gv-btn-go']),
  text('.gv-session-complete title', ['div.gv-session-complete', 'h2.gv-display.gv-session-complete-title']),
  text('.gv-btn-go hover', ['div.gv-hero-action', 'button.gv-btn-go:hover', 'span']),
  text('.gv-btn hover', ['button.gv-btn:hover', 'span']),

  /* ---- REWARDS (XP, levels, quest, medals), every skin: Today's level row and quest, the XP chip, the XP card and
     medal unlock on Session complete, the Medals section on Records, the Profile hero. Chains follow the markup
     src/rewards-ui.js builds. The hex / starburst glyphs are the tier colours' own ink against the ring or fill. ---- */
  ...(() => {
    const LV = ['div.gv-today', 'div.gv-slot-level', 'div.gv-rw-level'];
    const QU = ['div.gv-today', 'div.gv-slot-quest', 'section.gv-rw-quest.is-open', 'div.gv-rw-quest-top'];
    const XP = ['div.gv-session-complete', 'div.gv-rw-complete', 'section.gv-rw-xp'];
    const UN = tier => ['div.gv-session-complete', 'div.gv-rw-complete', `section.gv-rw-unlock.is-${tier}`];
    const MD = tier => ['section.gv-rw-medals', 'ul.gv-rw-medal-grid', `li.gv-rw-medal.is-${tier}`];
    const PR = ['article.gv-card.gv-rw-profile'];
    const HEX = tier => `div.gv-rw-hex.is-${tier}.is-sm`;
    const out = [
      text('level row: title', [...LV, 'div.gv-rw-level-mid', 'div.gv-rw-level-top', 'b.gv-rw-level-title'], 'rewards'),
      text('level row: XP to next', [...LV, 'div.gv-rw-level-mid', 'div.gv-rw-level-top', 'span.gv-rw-level-to'], 'rewards'),
      text('level row: rank', [...LV, 'div.gv-rw-level-mid', 'div.gv-rw-level-foot', 'span.gv-rw-level-rank'], 'rewards'),
      text('level row: XP into the level', [...LV, 'div.gv-rw-level-mid', 'div.gv-rw-level-foot', 'span.gv-rw-level-into'], 'rewards'),
      text('level hex number', [...LV, 'div.gv-rw-hex.is-lime.is-sm', 'div.gv-rw-hex-in', 'b.gv-rw-hex-num'], 'rewards'),
      text('XP chip', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'div.gv-hero-chips', 'span.gv-slot-xp-chip', 'span.gv-rw-xpchip'], 'rewards'),
      text('quest: kicker', [...QU, 'div.gv-rw-quest-head', 'span.gv-kicker.gv-rw-quest-kicker'], 'rewards'),
      text('quest: title', [...QU, 'div.gv-rw-quest-head', 'b.gv-rw-quest-title'], 'rewards'),
      text('quest: +XP', [...QU, 'span.gv-rw-quest-xp'], 'rewards'),
      text('quest: figures', ['div.gv-today', 'div.gv-slot-quest', 'section.gv-rw-quest.is-open', 'div.gv-rw-quest-nums', 'span.gv-rw-quest-done'], 'rewards'),
      text('quest: to go', ['div.gv-today', 'div.gv-slot-quest', 'section.gv-rw-quest.is-open', 'div.gv-rw-quest-nums', 'span.gv-rw-quest-togo'], 'rewards'),
      text('XP card: +N XP', [...XP, 'div.gv-rw-xp-head', 'b.gv-rw-xp-big'], 'rewards'),
      text('XP card: level label', [...XP, 'div.gv-rw-xp-head', 'div.gv-rw-xp-lv', 'span'], 'rewards'),
      text('XP card: level percent', [...XP, 'div.gv-rw-xp-head', 'div.gv-rw-xp-lv', 'b'], 'rewards'),
      text('XP card: into the level', [...XP, 'div.gv-rw-xp-nums', 'span.gv-rw-xp-into'], 'rewards'),
      text('XP card: to next', [...XP, 'div.gv-rw-xp-nums', 'span.gv-rw-xp-togo'], 'rewards'),
      text('XP card: Level n!', [...XP, 'p.gv-rw-levelup'], 'rewards'),
      text('XP card: line label', [...XP, 'ul.gv-rw-xp-lines', 'li.gv-rw-xp-line', 'span.gv-rw-xp-label'], 'rewards'),
      text('XP card: line detail', [...XP, 'ul.gv-rw-xp-lines', 'li.gv-rw-xp-line', 'span.gv-rw-xp-label', 'small'], 'rewards'),
      text('XP card: line amount', [...XP, 'ul.gv-rw-xp-lines', 'li.gv-rw-xp-line', 'b.gv-rw-xp-amount'], 'rewards'),
      text('records: medals heading', ['section.gv-rw-medals', 'div.gv-rw-sec', 'h3.gv-section-title.gv-rw-sec-title', 'span'], 'rewards'),
      text('records: medals count', ['section.gv-rw-medals', 'div.gv-rw-sec', 'span.gv-rw-sec-count'], 'rewards'),
      text('records: Next call-out title', ['section.gv-rw-medals', 'div.gv-rw-next', 'div.gv-rw-next-text', 'b'], 'rewards'),
      text('records: Next call-out detail', ['section.gv-rw-medals', 'div.gv-rw-next', 'div.gv-rw-next-text', 'span'], 'rewards'),
      text('records: Next call-out percent', ['section.gv-rw-medals', 'div.gv-rw-next', 'span.gv-rw-pc.gv-rw-next-pc'], 'rewards'),
      text('profile: level', [...PR, 'div.gv-rw-profile-top', 'div.gv-rw-profile-id', 'h3.gv-rw-profile-level'], 'rewards'),
      text('profile: rank', [...PR, 'div.gv-rw-profile-top', 'div.gv-rw-profile-id', 'p.gv-rw-profile-rank'], 'rewards'),
      text('profile: hex number', [...PR, 'div.gv-rw-profile-top', 'div.gv-rw-hex.is-lime.is-lg', 'div.gv-rw-hex-in', 'b.gv-rw-hex-num'], 'rewards'),
      text('profile: XP figures', [...PR, 'div.gv-rw-profile-nums', 'span'], 'rewards'),
      text('profile: to go', [...PR, 'div.gv-rw-profile-nums', 'span.gv-rw-profile-togo'], 'rewards'),
      text('profile: rung (done)', [...PR, 'ol.gv-rw-ladder', 'li.gv-rw-rung.is-done', 'span'], 'rewards'),
      text('profile: rung (current)', [...PR, 'ol.gv-rw-ladder', 'li.gv-rw-rung.is-current', 'span'], 'rewards'),
      text('profile: rung (ahead)', [...PR, 'ol.gv-rw-ladder', 'li.gv-rw-rung.is-ahead', 'span'], 'rewards'),
      text('profile: total', [...PR, 'p.gv-rw-profile-total'], 'rewards'),
      text('profile: count number', [...PR, 'div.gv-rw-stats', 'div', 'b'], 'rewards'),
      text('profile: count label', [...PR, 'div.gv-rw-stats', 'div', 'span'], 'rewards'),
      text('profile: medals count (gold)', [...PR, 'div.gv-rw-stats', 'div:nth-child(3)', 'b'], 'rewards'),
    ];
    for (const tier of ['gold', 'silver', 'bronze']) {
      out.push(
        text(`medal unlocked: kicker (${tier})`, [...UN(tier), 'div.gv-rw-unlock-text', 'span.gv-rw-unlock-kicker'], 'rewards'),
        text(`medal unlocked: name (${tier})`, [...UN(tier), 'div.gv-rw-unlock-text', 'strong.gv-rw-unlock-name'], 'rewards'),
        text(`medal unlocked: next (${tier})`, [...UN(tier), 'div.gv-rw-unlock-text', 'p.gv-rw-unlock-next'], 'rewards'),
        glyph(`medal unlocked: glyph (${tier})`, [...UN(tier), HEX(tier), 'div.gv-rw-hex-in', 'span.gv-ico', 'svg'], 'rewards'),
        text(`medal tile: name (${tier})`, [...MD(tier), 'strong.gv-rw-medal-name'], 'rewards'),
        text(`medal tile: tier word (${tier})`, [...MD(tier), 'span.gv-rw-tier'], 'rewards'),
        text(`medal tile: earned on (${tier})`, [...MD(tier), 'span.gv-rw-earned'], 'rewards'),
        text(`medal tile: percent (${tier})`, [...MD(tier), 'span.gv-rw-pc'], 'rewards'),
        glyph(`medal tile: glyph (${tier})`, [...MD(tier), HEX(tier), 'div.gv-rw-hex-in', 'span.gv-ico', 'svg'], 'rewards'));
    }
    out.push(
      text('medal tile: name (locked)', [...MD('lock'), 'strong.gv-rw-medal-name'], 'rewards'),
      text('medal tile: percent (locked)', [...MD('lock'), 'span.gv-rw-pc'], 'rewards'),
      glyph('medal tile: lock glyph', [...MD('lock'), HEX('lock'), 'div.gv-rw-hex-in', 'span.gv-ico', 'svg'], 'rewards'),
      glyph('Next call-out: glyph', ['section.gv-rw-medals', 'div.gv-rw-next', HEX('lock'), 'div.gv-rw-hex-in', 'span.gv-ico', 'svg'], 'rewards'));
    return out;
  })(),
  /* ---- THE LIVE SET, poster chrome (Apex + Lock In; live-chrome.js). Probed in every skin, so the
     unstyled Floor/Editorial resolve too; the nodes only exist in the poster skins. The sheet's own
     text sits on a two-colour gradient: live-poster-css.test.cjs measures both ends. ---- */
  text('live: Move n of N chip', ['div.gv-session-page', 'div.gv-session-top.gv-live-top', 'div.gv-session-top-row.gv-live-toprow', 'span.gv-live-chip'], 'poster'),
  text('live: sub line', ['div.gv-session-page', 'div.gv-session-exblock.gv-live-head', 'div.gv-live-headtext', 'div.gv-session-target.gv-live-sub'], 'poster'),
  text('live: set rail label', ['div.gv-session-page', 'div.gv-session-exblock.gv-live-head', 'div.gv-live-rail', 'b'], 'poster'),
  text('live: PB target kicker', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-pb-target', 'span.gv-pb-target-kicker'], 'poster'),
  text('live: PB target kicker (beaten)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-pb-target.is-beaten', 'span.gv-pb-target-kicker'], 'poster'),
  text('live: PB target scale', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-pb-target', 'div.gv-pb-target-marks', 'span'], 'poster'),
  text('live: PB target scale (beaten)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-pb-target.is-beaten', 'div.gv-pb-target-marks', 'span'], 'poster'),
  /* The scale's MIDDLE figure ("62% of PB") is the one span the poster skins colour differently (the accent's text tone),
     through a `:nth-child(2)` rule. A probe whose last link is a bare `span` never matches that rule, so the gate measured the
     two outer figures and passed while the middle one printed 4.42:1 (Electric, Lock In light). Probe it by position. */
  text('live: PB target scale, middle figure', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-pb-target', 'div.gv-pb-target-marks', 'span:nth-child(2)'], 'poster'),
  text('live: PB target scale, middle figure (beaten)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-pb-target.is-beaten', 'div.gv-pb-target-marks', 'span:nth-child(2)'], 'poster'),
  text('live: tap chip (idle zone)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-rc-zone.gv-session-zone.gv-live-zone', 'div.gv-rc-tapchip'], 'poster'),
  text('live: count caption (idle zone)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-rc-zone.gv-session-zone.gv-live-zone', 'div.gv-rc-target'], 'poster'),
  text('live: Tick set label', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet', 'div.gv-live-tickwrap', 'button.gv-btn-go.gv-live-tick', 'span'], 'poster'),
  glyph('live: Tick set check', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet', 'div.gv-live-tickwrap', 'button.gv-btn-go.gv-live-tick', 'span.gv-ico', 'svg'], 'poster'),
  glyph('live: weight stepper glyph', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-weight', 'button.gv-icon-btn.gv-live-step', 'span.gv-ico', 'svg'], 'poster'),
  text('live: weight figure', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-weight', 'div.gv-live-weightval', 'input.gv-set-input.gv-session-weight'], 'poster'),
  text('live: weight unit', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-weight', 'div.gv-live-weightval', 'span.gv-set-unit'], 'poster'),
  glyph('live: utility icon glyph (sheet)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet', 'div.gv-live-utility', 'button.gv-icon-btn', 'span.gv-ico', 'svg'], 'poster'),
  text('live: skip button label (sheet)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet', 'div.gv-live-utility', 'div.gv-live-skips', 'button.gv-btn.gv-btn-ghost.gv-btn-small.gv-session-skip', 'span'], 'poster'),
  text('live: skip kicker (sheet)', ['div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet', 'div.gv-live-utility', 'div.gv-live-skips', 'span.gv-session-skip-kicker'], 'poster'),

  /* ---- the full-screen media viewer (src/media-viewer.js) + the expand corner that opens it ---- */
  glyph('media viewer: expand corner (exercise page tile)', ['div.gv-card.gv-media', 'div.gv-media-frames', 'div.gv-media-frame', 'span.gv-media-expand', 'span.gv-ico', 'svg'], 'media-viewer'),
  glyph('media viewer: expand corner (live thumbnail)', ['div.gv-session-page', 'div.gv-session-exblock.gv-live-head', 'div.gv-session-media', 'div.gv-media-frame.gv-session-frame', 'span.gv-media-expand', 'span.gv-ico', 'svg'], 'media-viewer'),
  text('media viewer: title', ['div.gv-mv-bar', 'h2.gv-display.gv-mv-title'], 'media-viewer', null, true),
  text('media viewer: frame tag', ['div.gv-mv-caption', 'span.gv-mv-tag'], 'media-viewer', null, true),
  text('media viewer: position figure', ['div.gv-mv-caption', 'span.gv-mv-pos'], 'media-viewer', null, true),
  text('media viewer: Play / Pause label', ['div.gv-mv-controls', 'button.gv-btn.gv-btn-ghost.gv-mv-play', 'span'], 'media-viewer', null, true),
  glyph('media viewer: close glyph', ['div.gv-mv-bar', 'button.gv-icon-btn.gv-mv-close', 'span.gv-ico', 'svg'], 'media-viewer', true),
  glyph('media viewer: step glyph', ['div.gv-mv-controls', 'button.gv-icon-btn.gv-mv-step', 'span.gv-ico', 'svg'], 'media-viewer', true),
  text('media viewer: images unavailable', ['div.gv-mv-stage.gv-mv-stage-empty', 'div.gv-mv-missing'], 'media-viewer', null, true),

  /* ---- the MUSCLE MAP (src/muscle-map.js): on the exercise page (a card), and large in the viewer (on the page's
     own colour, no card). The labels are SVG text, set with `color` + `fill: currentColor` so this gate measures
     them like any other text; the stage paints --gv-bg behind them. The Detailed labels are the smallest text
     in the plugin, so they are held to the full 4.5:1 whatever the theme, skin and accent. ---- */
  ...(() => {
    const PAGE = ['div.gv-mm-block', 'div.gv-card.gv-mm-card', 'div.gv-mm'];
    const VIEW = ['div.gv-mv-stage.gv-mv-is-map', 'div.gv-mv-map', 'div.gv-mm'];
    const SVG = ['div.gv-mm-stage', 'svg.gv-mm-svg', 'g.gv-mm-labels', 'g.gv-mm-label.gv-mm-label-prime'];
    const out = [];
    for (const [where, base, modal] of [['page', PAGE, false], ['viewer', VIEW, true]]) {
      out.push(
        text(`muscle map (${where}): heading`, [...base, 'div.gv-mm-head', 'div.gv-mm-headl', 'span.gv-mm-title'], 'muscle-map', null, modal),
        text(`muscle map (${where}): Working / Holding legend`, [...base, 'div.gv-mm-under', 'div.gv-mm-legend', 'span.gv-mm-key-text'], 'muscle-map', null, modal),
        text(`muscle map (${where}): label name`, [...base, ...SVG, 'text.gv-mm-lbl'], 'muscle-map', null, modal),
        text(`muscle map (${where}): label load %`, [...base, ...SVG, 'text.gv-mm-lbl', 'tspan.gv-mm-pct'], 'muscle-map', null, modal),
        text(`muscle map (${where}): label Latin name`, [...base, ...SVG, 'text.gv-mm-latin'], 'muscle-map', null, modal),
        text(`muscle map (${where}): label name (holding)`, [...base, 'div.gv-mm-stage', 'svg.gv-mm-svg', 'g.gv-mm-labels', 'g.gv-mm-label.gv-mm-label-hold', 'text.gv-mm-lbl'], 'muscle-map', null, modal),
        text(`muscle map (${where}): Load caption`, [...base, 'div.gv-mm-under', 'div.gv-mm-load', 'span.gv-mm-load-label'], 'muscle-map', null, modal),
        text(`muscle map (${where}): Load %`, [...base, 'div.gv-mm-under', 'div.gv-mm-load', 'span.gv-mm-load-pct'], 'muscle-map', null, modal),
        text(`muscle map (${where}): step caption`, [...base, 'div.gv-mm-under', 'div.gv-mm-step'], 'muscle-map', null, modal));
    }
    out.push(
      glyph('muscle map: Show larger button glyph', [...PAGE.slice(0, 2), 'div.gv-mm', 'div.gv-mm-head', 'div.gv-mm-headl', 'button.gv-icon-btn.gv-icon-btn-small.gv-mm-enlarge', 'span.gv-ico', 'svg'], 'muscle-map'),
      text('muscle map: Photos button label', ['div.gv-mm-block', 'div.gv-card.gv-mm-card', 'button.gv-btn.gv-btn-ghost.gv-btn-small.gv-mm-photos', 'span'], 'muscle-map'),
      text('muscle map (viewer): Photos / Muscle map switch label', ['div.gv-mv-bar', 'button.gv-btn.gv-btn-ghost.gv-btn-small.gv-mv-mode', 'span'], 'muscle-map', null, true),
      text('muscle map (viewer): caption tag', ['div.gv-mv-caption', 'span.gv-mv-tag'], 'muscle-map', null, true));
    return out;
  })(),
];

const need = (probe, size, weight) => (probe.kind === 'glyph' ? 3 : (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5);
const weightOf = v => (v === 'bold' ? 700 : v === 'normal' ? 400 : Number(v) || 400);

/* The media viewer's chain: body > modal-container > the modalEl (which wears .gv-app
   and the skin classes itself, src/media-viewer.js) > the content. The poster class
   goes with the poster skins, as constants.skinClasses() adds it. */
const modalChain = (o, ...inner) => cx.chainOf([
  'body.theme-' + o.theme,
  'div.modal-container.mod-dim',
  'div.modal.gv-app.gv-skin-' + o.skin + (o.skin === 'apex' || o.skin === 'lockin' ? '.gv-skin-poster' : '') + '.gv-accent-' + o.accent + '.gv-mv-modal',
  'div.modal-content.gv-mv',
  ...inner,
]);

const measured = [];
const problems = [];
for (const theme of THEMES) for (const skin of SKINS) for (const accent of ACCENTS) {
  for (const probe of PROBES) {
    const chain = probe.modal ? modalChain({ theme, skin, accent }, ...probe.chain) : cx.appChain({ theme, skin, accent }, ...probe.chain);
    const surface = probe.surface && probe.surface(skin);
    const t = surface ? cx.textColorOn(chain, cx.appChain({ theme, skin, accent }, ...surface), rules) : cx.textColor(chain, rules);
    const size = probe.kind === 'glyph' ? 0 : (() => { const f = cx.computed(chain, 'font-size', rules); return f ? cx.pxOf(f.value) : 16; })();
    const weight = probe.kind === 'glyph' ? 0 : (() => { const f = cx.computed(chain, 'font-weight', rules); return f ? weightOf(f.value) : 400; })();
    const min = need(probe, size, weight);
    const r = cx.ratio(t.fg, t.bg);
    measured.push({ probe, theme, skin, accent, r, min, fg: cx.hex(t.fg), bg: cx.hex(t.bg), t, size, weight });
  }
}

if (process.env.CONTRAST_REPORT) {
  for (const probe of PROBES) {
    for (const theme of THEMES) for (const skin of SKINS) {
      const row = measured.filter(m => m.probe === probe && m.theme === theme && m.skin === skin);
      console.log(`${probe.id.padEnd(46)} ${theme}/${skin}`.padEnd(66) + `need ${row[0].min}  ` +
        row.map(m => `${m.accent} ${m.r.toFixed(2)}${m.r < m.min ? '!' : ''}`).join('  '));
    }
  }
  process.exit(0);
}

/* One line per (probe, theme, skin), accents side by side, with the rules that painted each side. */
const groups = new Map();
for (const m of measured.filter(m => m.r < m.min)) {
  const key = `${m.probe.id}\u0000${m.theme}/${m.skin}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(m);
}
for (const [key, list] of groups) {
  const [id, where] = key.split('\u0000');
  const first = list[0];
  const tag = first.probe.finding ? ` [${first.probe.finding}]` : '';
  problems.push(`${id}${tag}  ${where}: ${list.map(m => `${m.accent} ${m.r.toFixed(2)}`).join(', ')} (need ${first.min}:1)  ` +
    `${first.fg} on ${first.bg} — text from src/styles.css:${first.t.fgRule.line} \`${first.t.fgRule.selector}\`, ` +
    `painted on :${first.t.bgRule.line} \`${first.t.bgRule.selector}\``);
}
assert.deepStrictEqual(problems, [],
  `${problems.length} contrast failure group(s) across ${THEMES.length} themes x ${SKINS.length} skins x ${ACCENTS.length} accents ` +
  `(${measured.length} measurements). A rule that puts text on \`var(--gv-ink)\` or lime-deep on a dark surface needs a ` +
  '`.theme-dark .gv-app …` twin (--gv-ink-fixed / --gv-lime), as .gv-head-btn.on and .gv-logo .gv-ico already have:\n' + problems.join('\n'));

console.log(`contrast OK (${names.length} palettes: ${names.join(', ')}; ${PROBES.length} probed elements x ${THEMES.length} themes x ${SKINS.length} skins x ${ACCENTS.length} accents = ${measured.length} cascade measurements)`);
