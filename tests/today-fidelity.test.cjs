'use strict';
/* TODAY MATCHES THE DESIGN (Apex = design/10, Lock In = design/07).

   Three kinds of claim, each one a way this screen drifted from the mockups:

   1. PURE RULES. startCopy (the Start button's words by skin), splitTitle (the
      giant word + outlined rest, which must decline rather than guess) and
      estMinutes (the one minutes rule the chips and the text line share).
   2. THE MARKUP CONTRACT page-dashboard.render emits: the head wrapper, the
      chips, the badge (only for a live streak, the SAME number the flame gets),
      the empty slots the rewards work fills, the week header.
   3. THE CSS CONTRACT. The Lock In flood is the HEAD only; the hero itself must
      stay overflow:visible (a sticky Start inside an overflow:hidden ancestor
      never sticks); the Start slab is ordered last and sticky in a narrow pane;
      the tab bar moves to the bottom only for Apex + Lock In in a narrow pane;
      Floor and Editorial draw none of the new elements.

   GV_STYLES_CSS points the CSS half at a deliberately broken copy (mutation
   testing); the markup half is mutated by editing a copy of src/. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const mkNode = tag => ({
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); },
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
  appendChild(k) { this.append(k); return k; },
  get textContent() { return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
  querySelector() { return null; },
});
const clsOf = n => `${n.className} ${n.attrs.class || ''}`.split(/\s+/).filter(Boolean);
global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createElementNS(_ns, tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {}, Plugin: class {},
  PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
} : origLoad(req, ...rest));
const SRC = process.env.GV_DASHBOARD_JS || '../src/page-dashboard';
const dashboard = require(SRC);
const { todayISO, startOfWeek, addDays } = require('../src/dates');
Module._load = origLoad;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const findAll = (node, cls, out) => {
  out = out || [];
  for (const c of node.children || []) { if (c.nodeType !== 1) continue; if (clsOf(c).includes(cls)) out.push(c); findAll(c, cls, out); }
  return out;
};
const first = (node, cls) => findAll(node, cls)[0] || null;

/* ---------- 1. the pure rules ---------- */
{
  const { startCopy, splitTitle, estMinutes } = dashboard;
  for (const skin of ['apex', 'lockin', undefined, '']) {
    eq(startCopy(skin, false), { label: 'Lock in', arrow: true }, `${skin}: the mockup's "Lock in" + arrow on a day not yet done (an unset skin is Apex, the default)`);
    eq(startCopy(skin, true), { label: 'Log another session', arrow: false }, `${skin}: a day already done keeps "Log another session"`);
  }
  for (const skin of ['floor', 'editorial']) {
    eq(startCopy(skin, false), { label: 'Get after it', arrow: false }, `${skin}: keeps its own voice`);
    eq(startCopy(skin, true), { label: 'Log another session', arrow: false }, `${skin}: done is the same everywhere`);
  }

  /* the minutes rule: the line and the chips read this one function */
  eq([0, 3, 9, 13, 20, 27, 40].map(estMinutes), [15, 15, 15, 25, 35, 50, 70], 'est. minutes: 1.8 min a set, to the nearest 5, never under 15');

  /* splitTitle: splits where it can, declines where it cannot, and loses nothing */
  eq(splitTitle('Push Day'), { first: 'Push', rest: 'Day', n1: 4, n2: 3 }, 'the mockup\'s own PUSH / DAY.');
  eq(splitTitle('A · Push Priority'), { first: 'A · Push', rest: 'Priority', n1: 8, n2: 8 }, 'a label token ("A", "·") stays with the giant word');
  eq(splitTitle('S · Saturday Skills'), { first: 'S · Saturday', rest: 'Skills', n1: 12, n2: 6 }, 'the seeded plan\'s own day name');
  eq(splitTitle('Legs, Hinge & Core'), { first: 'Legs,', rest: 'Hinge & Core', n1: 5, n2: 5 }, 'punctuation and an ampersand are fine; n2 is the LONGEST following word');
  eq(splitTitle('Push - Pull'), { first: 'Push', rest: '- Pull', n1: 4, n2: 4 }, 'a dash inside the rest');
  eq(splitTitle('  Upper   body  '), { first: 'Upper', rest: 'body', n1: 5, n2: 4 }, 'runs of space collapse');
  eq(splitTitle('Rest day'), { first: 'Rest', rest: 'day', n1: 4, n2: 3 }, 'the rest-day hero splits too');
  for (const name of ['Rest', 'Pushups', '', '   ', null, undefined, 'A ·', '1 -', 'A · B', 'Push ·', 'Push - ']) {
    eq(splitTitle(name), null, `${JSON.stringify(name)}: one word, all label, or nothing after the first word keeps the single title`);
  }
  eq(splitTitle('Ab '.repeat(15).trim()), { first: 'Ab', rest: 'Ab '.repeat(14).trim(), n1: 2, n2: 2 }, 'fixture: 44 characters of short words still split');
  eq(splitTitle('Ab '.repeat(16).trim()), null, 'a name past 44 characters steps down whole, as before, however short its words');
  eq(splitTitle('Wednesday Evening Extra-Long Descriptive Session With Many Words'), null, 'the long-name stress case keeps its one title');
  ok(splitTitle('x'.repeat(30) + ' ' + 'y'.repeat(10)) === null, 'a first word too wide for a phone declines (> 14 characters)');
  ok(splitTitle('Day ' + 'y'.repeat(15)) === null, 'a following word too wide for a phone declines');
  ok(splitTitle('Hypertrophy Day') !== null, '11 characters is still fine');
  /* nothing is lost or reordered: first + space + rest is the name, whitespace-normalised */
  for (const name of ['A · Push Priority', 'Legs, Hinge & Core', 'Push - Pull', 'Wednesday Evening Run', 'Ünïcode Dây', 'Chest + Tris (heavy)']) {
    const p = splitTitle(name);
    ok(p && `${p.first} ${p.rest}` === name.replace(/\s+/g, ' ').trim(), `${name}: first + rest reads as the name`);
  }
}

/* ---------- 2. the markup ---------- */
const TODAY = todayISO();
const day = { name: 'A · Push Priority', weekday: 'mon', items: [{ exercise: 'Dips', sets: 3, target: 'AMRAP' }, { exercise: 'Pull-ups', sets: 4, target: '8' }], notes: [] };
const restDay = { name: 'Rest & recovery', weekday: 'mon', items: [], notes: [] };
const planOf = d => ({ name: 'P', fm: { active: 'true' }, model: { days: [d], intro: [] } });
const w = date => ({ name: date, fm: { date }, rows: [{ exercise: 'Dips', reps: '9' }] });
const streakWorkouts = len => Array.from({ length: len }, (_, i) => w(addDays(startOfWeek(TODAY, 'mon'), -7 * i)));
function render(o) {
  o = o || {};
  const d = o.day || day;
  const pl = planOf(d);
  const ctx = {
    app: {}, data: { workouts: o.workouts || [], exercises: [{ name: 'Dips', fm: { unit: 'reps' } }], goals: [], body: [] },
    settings: Object.assign({ weekStart: 'mon' }, o.settings || {}), state: { logDraft: null },
    io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
    activePlan: () => pl, activePlanIsImplicit: () => false, mainPlans: () => [pl],
    parallelPlans: () => [], fallbackPlans: () => [], daysOn: () => (o.none ? [] : [{ plan: pl, day: d }]),
  };
  const root = mkNode('div'); root.classList.owner = root;
  dashboard.render(ctx, root);
  return root;
}
const textOf = node => node.textContent;
{
  const root = render({ workouts: streakWorkouts(3) });
  const today = first(root, 'gv-today');
  ok(today && root.children.includes(today), 'everything Today draws sits in ONE .gv-today wrapper');
  const hero = first(root, 'gv-hero');
  ok(clsOf(hero).includes('gv-hero-today'), 'the Today hero says so (the other pages\' heroes have no head and keep flooding whole)');
  const head = hero.children[0];
  ok(clsOf(head).includes('gv-hero-head'), 'the head is the hero\'s FIRST child: the flood can be limited to it');
  for (const cls of ['gv-kicker', 'gv-hero-title', 'gv-hero-sub', 'gv-hero-chips', 'gv-hero-badge']) ok(first(head, cls), `.${cls} is inside the head`);
  const outside = hero.children.slice(1);
  for (const cls of ['gv-rx', 'gv-ticker', 'gv-hero-action', 'gv-btn-go', 'gv-hero-manual']) {
    ok(outside.some(c => clsOf(c).includes(cls) || first(c, cls)), `.${cls} sits AFTER the head, on the page's own colour`);
    ok(!first(head, cls), `.${cls} is not inside the head`);
  }
  ok(!first(head, 'gv-hero-title').attrs.style || /--gv-t1-n:8;--gv-t2-n:8/.test(first(head, 'gv-hero-title').attrs.style), 'the title carries its two word lengths for the CSS to size from');
  /* the heading's text is the day name, split or not */
  eq(textOf(first(head, 'gv-hero-title')), 'A · Push Priority', 'the heading reads as the day name (split into two spans, text intact)');
  ok(clsOf(first(head, 'gv-hero-title')).includes('is-split'), 'a splittable name is marked is-split');
  const unsplit = render({ day: { name: 'Pushups', weekday: 'mon', items: day.items, notes: [] } });
  ok(!clsOf(first(unsplit, 'gv-hero-title')).includes('is-split') && textOf(first(unsplit, 'gv-hero-title')) === 'Pushups', 'a one-word name keeps the single title');

  /* one source for the numbers */
  const sets = 3 + 4;
  const chips = findAll(root, 'gv-hero-chip').map(textOf);
  eq(chips, [`${sets} sets`, `~${dashboard.estMinutes(sets)} min`], 'the chips say the day\'s sets and the one minutes rule');
  ok(textOf(first(root, 'gv-shout-est')) === `${sets} sets · est. ${dashboard.estMinutes(sets)} min`, 'the older text line, hidden in Apex and Lock In, says the same numbers');
  ok(first(root, 'gv-slot-xp-chip') && first(root, 'gv-slot-xp-chip').children.length === 0, 'the XP chip slot exists and is EMPTY (the rewards work fills it)');
  ok(first(root, 'gv-slot-level') && first(root, 'gv-slot-level').children.length === 0, 'the level / XP bar slot exists and is empty');
  ok(first(root, 'gv-slot-quest') && first(root, 'gv-slot-quest').children.length === 0, 'the weekly quest slot exists and is empty');

  /* the badge and the flame read ONE streak */
  const badge = first(root, 'gv-hero-badge');
  eq(textOf(first(badge, 'gv-badge-num')), '3', 'the badge shows the real streak');
  eq(textOf(first(badge, 'gv-badge-label')), 'wk streak', 'and says what it is');
  const flame = first(root, 'gv-streak');
  eq(textOf(first(flame, 'gv-streak-num')), '3', 'the flame tile shows the same number');
  ok(clsOf(flame).includes('gv-streak-dup'), 'with a live streak the flame tile is marked as a duplicate (hidden in Apex and Lock In)');
  const none = render({ workouts: [] });
  ok(!first(none, 'gv-hero-badge'), 'no streak: no badge');
  ok(!clsOf(first(none, 'gv-streak')).includes('gv-streak-dup'), 'and the flame tile (the unlit "nothing yet") stays visible');

  /* the week header */
  const wh = first(root, 'gv-week-head');
  ok(wh && textOf(first(wh, 'gv-week-head-title')) === 'This week', 'the strip has its "This week" header');
  ok(/^\d+ of \d+ done$/.test(textOf(first(wh, 'gv-week-head-note'))), `with the count the ring states (${textOf(first(wh, 'gv-week-head-note'))})`);
  const order = today.children.map(c => clsOf(c).find(x => /^gv-(week-head|week|slot-quest|week-progress)$/.test(x)) || '').filter(Boolean);
  eq(order.slice(0, 3), ['gv-week-head', 'gv-week', 'gv-slot-quest'], 'header, strip, then the quest slot');

  /* the Start button's words follow the skin */
  const label = skin => textOf(first(render({ settings: { skin } }), 'gv-btn-go'));
  eq([label('apex'), label('lockin'), label('floor'), label('editorial')], ['Lock in', 'Lock in', 'Get after it', 'Get after it'], 'copy by skin');
  ok(first(first(render({ settings: { skin: 'apex' } }), 'gv-btn-go'), 'gv-go-arrow'), 'Apex gets the arrow icon');
  ok(!first(first(render({ settings: { skin: 'floor' } }), 'gv-btn-go'), 'gv-go-arrow'), 'Floor does not');

  /* rest days and an empty day keep their hero and still wear the badge */
  const rest = render({ day: restDay, workouts: streakWorkouts(2) });
  const rh = first(rest, 'gv-hero');
  ok(clsOf(rh).includes('gv-hero-rest') && clsOf(rh).includes('gv-hero-today') && clsOf(rh.children[0]).includes('gv-hero-head'), 'a planned rest day: rest hero with a head');
  ok(first(rest, 'gv-hero-badge') && !first(rest, 'gv-hero-chips') && !first(rest, 'gv-ticker'), 'it shows the streak badge but no chips and no ticker');
  const empty = render({ none: true });
  ok(clsOf(first(empty, 'gv-hero')).includes('gv-hero-rest') && clsOf(first(empty, 'gv-hero').children[0]).includes('gv-hero-head'), 'a day with nothing scheduled: rest hero with a head');
}

/* ---------- 3. the CSS ---------- */
{
  const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const rules = cx.load();
  const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
  const find = sel => rules.filter(r => r.selector === sel && !r.media);
  const need = sel => { const r = find(sel); assert.ok(r.length, `no rule for ${sel}`); return r; };
  const has = (sel, prop, value) => need(sel).some(r => decl(r, prop) === value);

  for (const skin of ['apex', 'lockin']) {
    const S = `.gv-app.gv-skin-${skin}`;
    /* the flood belongs to the head and the hero itself must not clip */
    ok(has(`${S} .gv-hero-head`, 'overflow', 'hidden'), `${skin}: the head carries the poster (and clips its own band)`);
    ok(need(`${S} .gv-hero-head`).some(r => /gv-lime|gv-surface/.test(decl(r, 'background-color') || '')), `${skin}: the head has a fill`);
    ok(has(`${S} .gv-hero.gv-hero-today`, 'overflow', 'visible'), `${skin}: the Today hero is overflow:visible (a sticky Start inside overflow:hidden never sticks)`);
    ok(has(`${S} .gv-hero.gv-hero-today`, 'background-color', 'transparent'), `${skin}: the Today hero paints nothing itself: the list, Start and week sit on the page`);
    ok(has(`${S} .gv-hero.gv-hero-today`, 'background-image', 'none'), `${skin}: and no gradient`);
    /* the new elements are drawn here, not in the other skins */
    ok(need(`${S} .gv-hero-chips`).some(r => decl(r, 'display') === 'flex'), `${skin}: the chips are shown`);
    ok(need(`${S} .gv-hero-badge`).some(r => decl(r, 'display') === 'block'), `${skin}: the badge is shown`);
    ok(need(`${S} .gv-week-head`).some(r => decl(r, 'display') === 'flex'), `${skin}: the week header is shown`);
    ok(has(`${S} .gv-streak-dup`, 'display', 'none'), `${skin}: the flame tile is not shown twice`);
    ok(has(`${S} .gv-shout-est`, 'display', 'none'), `${skin}: the sets/minutes text line is replaced by the chips`);
    /* narrow pane: sticky Start + bottom bar */
    const N = `${S}.gv-narrow`;
    ok(has(`${N} .gv-hero-today > .gv-hero-action`, 'position', 'sticky'), `${skin}: Start sticks in a narrow pane`);
    ok(has(`${N} .gv-hero-today > .gv-hero-action`, 'order', '99'), `${skin}: and is ordered last, so it pins for the whole page`);
    ok(has(`${N} .gv-today`, 'flex-direction', 'column') && has(`${N} .gv-hero-today`, 'display', 'contents'), `${skin}: the page is one flex column, the hero's children are its items`);
    ok(has(`${N} .gv-nav`, 'order', '2'), `${skin}: the tab bar is ordered after the page (the root is a flex column)`);
    ok(has(`${N} .gv-nav-label`, 'display', 'block'), `${skin}: with its labels`);
    ok(has(`${N} .gv-nav-btn`, 'flex-direction', 'column'), `${skin}: icon over label`);
    ok(has(`body.is-phone ${N} .gv-nav`, 'padding-bottom', 'var(--view-bottom-spacing, 0px)'), `${skin}: the bar carries the host navbar clearance, directly (never inside calc)`);
    ok(rules.some(r => r.selector === `body.is-phone ${N}:not(.gv-focus) .gv-page`), `${skin}: and the page gives its own clearance up, until focus mode hides the bar`);
    /* no ancestor between the sticky slab and the scroll container may clip */
    for (const sel of [`${N} .gv-today`, `${N} .gv-hero-today`, `${S} .gv-hero.gv-hero-today`]) {
      ok(!need(sel).some(r => ['hidden', 'auto', 'scroll', 'clip'].includes(decl(r, 'overflow'))), `${sel}: no clipping ancestor above the sticky slab`);
    }
  }
  /* Floor and Editorial: none of it */
  const others = rules.filter(r => /gv-skin-(floor|editorial)/.test(r.selector) && /gv-hero-(head|chips|badge|today)|gv-week-head|gv-streak-dup|gv-nav\b|gv-today\b|gv-badge/.test(r.selector));
  eq(others.map(r => r.selector), [], 'Floor and Editorial have no rule for the head, chips, badge, week header, bottom bar or Today wrapper');
  for (const sel of ['.gv-hero-chips', '.gv-hero-badge', '.gv-week-head', '.gv-records-count']) {
    ok(need(sel).some(r => decl(r, 'display') === 'none'), `the base hides ${sel}, so a skin that does not style it draws nothing`);
  }
  const baseNav = rules.filter(r => r.selector === '.gv-nav' && !r.media);
  ok(baseNav.length === 1 && decl(baseNav[0], 'order') === undefined, 'the base tab bar is still the top bar (no order)');
  /* no clip-path anywhere (css-guards) - the hexagon and the star are made of boxes and borders */
  ok(!/clip-path\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no clip-path');
  const hex = need('.gv-app.gv-skin-apex .gv-badge-fig::before').concat(need('.gv-app.gv-skin-apex .gv-badge-fig::after'));
  ok(hex.some(r => /solid transparent/.test(decl(r, 'border-left') || '')), 'the Apex hexagon is a box plus two border triangles');
}
console.log(`today fidelity OK (${n} checks: Start copy by skin, the title split declines instead of guessing, one minutes rule, head wrapper, badge = flame streak, empty reward slots, sticky Start + bottom bar scoped to Apex/Lock In in a narrow pane, Floor/Editorial untouched)`);
