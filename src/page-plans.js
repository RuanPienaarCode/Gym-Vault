'use strict';
/* Plans — list, detail, and structural edits (add day / add exercise line).
   The plan note stays the source of truth: heavier editing is one tap away
   via "Open note", and everything written here round-trips through
   plan-parse so hand-written coaching cues survive. */

const { el, ico, prose, clickableCard, backButton, toggleRow, emptyLine } = require('./dom');
const { WEEKDAYS, WEEKDAY_LABELS, startModes } = require('./constants');
const { addItem, removeItemAt, moveItem, updateItem, isRestDay, parsePrescription, isPaused, isFavourite, planRole, rxLabel, roleOf, startDayFor } = require('./plan-parse');
const { equipmentFor, equipmentKeys, equipmentSummary, planExerciseNames, labelFor } = require('./equipment');
const { MUSCLE_GROUPS } = require('./constants');
const { FormModal, ConfirmModal } = require('./modals');
const { todayISO, weekdayKey } = require('./dates');
const { sameName } = require('./stats');

/* SAVES OF ONE PLAN ARE SERIAL, AND THE REFRESH WAITS FOR THEM (L2-01).

   Edit mode saves on every `change`, and the row's `focusout` reloads the
   page. Both used to fire in the same task: the reload read the note while the
   save was still landing (Obsidian's cachedRead serves the OLD text until the
   write resolves), rebuilt the model from that stale text, and the NEXT edit
   then saved the stale model over the first one — the user typed 5 sets and
   the note kept 3. So: one queue per plan record (a new save waits for the
   previous; every save writes the whole model, so a later one carries every
   earlier edit), and anything that reloads first waits for the queue to drain. */
const saveTail = new WeakMap();   // plan record -> tail of its save queue (never rejects)

function saveSerial(ctx, plan) {
  const run = (saveTail.get(plan) || Promise.resolve()).then(() => ctx.io.savePlan(plan));
  const tail = run.catch(() => {});
  saveTail.set(plan, tail);
  tail.then(() => { if (saveTail.get(plan) === tail) saveTail.delete(plan); });
  return run;
}

async function savesSettled(plan) {
  for (;;) {
    const tail = saveTail.get(plan);
    if (!tail) return;
    await tail;
    if (saveTail.get(plan) === tail) return;   // nothing newer was queued while we waited
  }
}

/* NEVER RE-RENDER UNDER A PRESS (the swallowed first click on Done).

   Pressing a button moves focus out of the field being edited on MOUSEDOWN, so
   the row's `focusout` reload re-rendered the page before the press ended; the
   button the finger was on no longer existed on release, the browser dropped the
   click, and Done (or any control outside the row) needed a second tap. A reload
   that is due while a pointer is down therefore waits until the press is over.
   The watcher is installed when an edit row is built (before any press), once per
   document, and a lost pointerup cannot hold the reload for more than PRESS_CAP_MS.
   The document listeners go through the plugin's registerDomEvent so disabling
   the plugin removes them; a bare addEventListener is only the fallback when no
   plugin is reachable. */
const PRESS_CAP_MS = 1500;
const pressOfDoc = new WeakMap();   // document -> { down, waiters }

function pressWatch(doc, ctx) {
  if (!doc || typeof doc.addEventListener !== 'function') return null;
  let s = pressOfDoc.get(doc);
  if (s) return s;
  s = { down: false, waiters: [] };
  const plugin = ctx && ctx.plugin;
  const on = (ev, fn) => (plugin && typeof plugin.registerDomEvent === 'function'
    ? plugin.registerDomEvent(doc, ev, fn, true)
    : doc.addEventListener(ev, fn, true));
  const flush = () => { s.down = false; for (const fn of s.waiters.splice(0)) fn(); };
  on('pointerdown', () => { s.down = true; });
  /* After the click that follows pointerup has been delivered. */
  const end = () => setTimeout(flush, 50);
  on('pointerup', end);
  on('pointercancel', end);
  pressOfDoc.set(doc, s);
  return s;
}

function afterPress(ctx, fn) {
  const s = pressWatch(typeof document !== 'undefined' ? document : null, ctx);
  if (!s || !s.down) { fn(); return; }
  let done = false;
  const once = () => { if (!done) { done = true; fn(); } };
  s.waiters.push(once);
  setTimeout(once, PRESS_CAP_MS);
}

/* A structural edit (add/remove/move): save, wait out any other save in
   flight, then show the note as it now is. A refused save (the note changed
   outside the app — savePlan has already said so) lands on the same reload. */
async function saveThenReload(ctx, plan) {
  try { await saveSerial(ctx, plan); }
  /* The reload is AWAITED: structuralEdit below holds the row controls until the
     page has been re-drawn, and ctx.reload resolves after it has re-rendered. */
  finally { await savesSettled(plan); await ctx.reload(); }
}

/* ONE STRUCTURAL EDIT AT A TIME (finding #7: a double tap on Remove deleted two
   exercises).

   Remove and Move change the model by position, then save and reload
   asynchronously. Until that reload lands the old row (and its Remove button) is
   still on screen, and the model has already shifted: a second tap removed
   whatever had slid into the index the first one used. There is no confirm and no
   undo, so the second tap is simply not taken. The hold is per plan record and
   released only after the save AND the re-draw (saveThenReload awaits both), in a
   finally, so a refused save or a failed refresh cannot leave the controls dead.
   `mutate` returns false when it changed nothing (a Move at the end of the list),
   and then nothing is written. */
const structuralBusy = new WeakSet();   // plan record -> a structural edit is saving
/* ...and for a moment after the tap, whatever the save did. On a fast vault the
   save and the re-draw can finish inside a double tap: the hold above is already
   released, the page holds NEW plan records, and the second tap lands on the row
   that slid under the finger. So a second structural tap on the same plan within
   DOUBLE_TAP_MS of the last one taken is not taken either. Keyed by plan name,
   because the reload replaces the records. */
const DOUBLE_TAP_MS = 300;
const structuralTapAt = new Map();      // plan name -> when its last structural tap was taken
async function structuralEdit(ctx, plan, mutate) {
  const tapAt = Date.now();
  const last = structuralTapAt.get(plan.name);
  if (structuralBusy.has(plan) || (last !== undefined && tapAt - last < DOUBLE_TAP_MS)) return;
  structuralTapAt.set(plan.name, tapAt);
  structuralBusy.add(plan);
  try {
    if (mutate() === false) return;
    await saveThenReload(ctx, plan);
  } catch (e) {
    /* saveThenReload has already re-read the note (its finally), so the screen
       is true again; say why the edit did not stick. */
    console.error('gym-vault plan save', e);
    ctx.notice(`could not save the plan (${e.message || e})`);
  } finally {
    structuralBusy.delete(plan);
  }
}

/* WHAT A PLAN IS DOING FOR YOU RIGHT NOW. The same split controller.js uses to
   build Today (ctx.parallelPlans / ctx.fallbackPlans: fallback wins over
   parallel), plus "active" meaning the plan Today actually runs —
   ctx.activePlan(), which falls back to the first main plan when nothing is
   flagged — so the list never badges a different plan than Today follows.

   A PAUSED plan (plan-parse.js isPaused) is in use by nothing, so its role is
   '' — it sorts with the ordinary plans, not in the "in use" group. The list
   still says "paused" on it (pausedBadge below): the role decides the ORDER,
   the badge tells the truth about why it is not leading.

   THE RULE ITSELF (planRole) LIVES IN plan-parse.js, pure, so the export labels
   plans by the very same function (finding #40); it is imported above and
   re-exported at the bottom for this page's callers and tests. */
const ROLE_RANK = { active: 0, alongside: 1, 'fills-gaps': 2, '': 4 };
const FAVOURITE_RANK = 3;
const ROLE_BADGE = { active: 'active', alongside: 'add-on', 'fills-gaps': 'backup' };
/* The badge words for a plan: its role, or "paused". */
function badgeWord(p, activePlan) {
  const role = planRole(p, activePlan);
  return role ? ROLE_BADGE[role] : isPaused(p) ? 'inactive' : '';
}

/* Plans in use lead the list (active, then the ones running alongside it,
   then the gap-filler), then your favourites; everything else keeps the order
   it had. */
function orderPlans(plans, activePlan) {
  return plans
    .map((p, i) => {
      const role = planRole(p, activePlan);
      return { p, i, r: !role && isFavourite(p) ? FAVOURITE_RANK : ROLE_RANK[role] };
    })
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.p);
}

/* Search matches the plan name or any of its day names ("swim" finds the
   plan with a Swim day), case-insensitively. */
function planMatches(p, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  if (String(p.name).toLowerCase().includes(needle)) return true;
  return ((p.model && p.model.days) || []).some(d => String(d.name || '').toLowerCase().includes(needle));
}

function render(ctx, root) {
  const { data } = ctx;
  const openName = ctx.state.params && ctx.state.params.plan;
  const open = data.plans.find(p => p.name === openName);
  if (open) return renderDetail(ctx, root, open);

  const ui = ctx.state.plansListUi || (ctx.state.plansListUi = { kit: '', focus: '', q: '' });
  if (ui.q === undefined) ui.q = '';

  /* The search box redraws only the card list, never the page, so the
     input keeps focus between keystrokes — the exercise library's pattern. */
  let renderList = () => {};
  const search = data.plans.length ? el('input', {
    class: 'gv-search', type: 'search', placeholder: 'Search plans…', value: ui.q, 'aria-label': 'Search plans',
    oninput: e => { ui.q = e.target.value; renderList(); },
  }) : null;

  const bar = el('div', { class: 'gv-toolbar' },
    el('h2', { class: 'gv-toolbar-title' }, 'Training plans'),
    search || '',
    el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => ctx.nav('browse') },
      ico('search'), el('span', {}, 'Browse')),
    el('button', { class: 'gv-btn', type: 'button', onclick: () => openAddPlan(ctx) }, ico('plus'), el('span', {}, 'Plan')));
  root.append(bar);

  if (!data.plans.length) {
    root.append(emptyLine('No plans yet — create one, or run setup from Settings.'));
    return;
  }

  const activeNow = typeof ctx.activePlan === 'function' ? ctx.activePlan() : null;
  const inUse = inUseStrip(ctx, orderPlans(data.plans, activeNow).filter(p => planRole(p, activeNow)), activeNow);
  if (inUse) root.append(inUse);

  /* Two filters: what you need to own, and what it works.

     Both are DERIVED from the plan's exercises rather than stored on the
     plan — an exercise note is the only place equipment and muscles live,
     and a copy on the plan would be a second answer that goes stale the
     moment a note is edited. Same chip pattern, and the same "only offer
     values actually in use" rule, as the exercise library: a vault with
     three plans must not render fourteen dead chips. */
  const facets = new Map();
  for (const p of data.plans) {
    const names = planExerciseNames(p);
    facets.set(p.name, {
      kit: new Set(equipmentKeys(data.exercises, names)),
      focus: new Set(musclesOfPlan(data.exercises, names)),
    });
  }
  const matches = p => {
    const f = facets.get(p.name);
    return (!ui.kit || (f && f.kit.has(ui.kit))) && (!ui.focus || (f && f.focus.has(ui.focus)));
  };

  const usedKit = new Set(), usedFocus = new Set();
  for (const f of facets.values()) {
    for (const k of f.kit) usedKit.add(k);
    for (const m of f.focus) usedFocus.add(m);
  }
  /* A filter whose chip row is not drawn, or whose value is no longer offered,
     cannot be cleared by the user, so it must not keep filtering: with one kit
     left (the plans you had were deleted or edited) the row hides while `ui.kit`
     went on hiding every plan under "No plan matches both filters". */
  if (ui.kit && (usedKit.size < 2 || !usedKit.has(ui.kit))) ui.kit = '';
  if (ui.focus && (usedFocus.size < 2 || !usedFocus.has(ui.focus))) ui.focus = '';
  /* The two chip rows fold into one "Filters" line (24 Nov 2026: on a phone
     they filled two screens and pushed the plans, and every Start, out of
     sight). Open while a filter is set, so a filter is never hidden. */
  if (usedKit.size > 1 || usedFocus.size > 1) {
    const set = (ui.kit ? 1 : 0) + (ui.focus ? 1 : 0);
    const open = ui.filtersOpen || set > 0;
    const fold = el('details', open ? { class: 'gv-plan-filters', open: '' } : { class: 'gv-plan-filters' },
      el('summary', {}, ico('sliders-horizontal'), el('span', {}, set ? `Filters · ${set} on` : 'Filters')));
    fold.addEventListener('toggle', () => { ui.filtersOpen = fold.open; });
    if (usedKit.size > 1) fold.append(facetChips(ctx, 'Equipment', [...usedKit], k => labelFor(k), () => ui.kit, v => { ui.kit = v; }));
    if (usedFocus.size > 1) {
      fold.append(facetChips(ctx, 'Focus', MUSCLE_GROUPS.filter(m => usedFocus.has(m)), m => m, () => ui.focus, v => { ui.focus = v; }));
    }
    root.append(fold);
  }

  const ordered = orderPlans(data.plans, activeNow);
  root.append(plansHelp(ui));
  const listWrap = el('div', {});
  root.append(listWrap);

  renderList = () => {
    while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
    const shown = ordered.filter(p => matches(p) && planMatches(p, ui.q));
    if (!shown.length) {
      const q = String(ui.q || '').trim();
      listWrap.append(emptyLine(q
        ? `No plan matches “${q}”${ui.kit || ui.focus ? ' with these filters' : ''}.`
        : 'No plan matches both filters — clear one to widen the search.'));
      return;
    }
    listWrap.append(planCards(ctx, shown, activeNow));
  };
  renderList();
}

/* WHAT START OPENS, as one card: "Today" or "Next · Friday", the day's name,
   the plan, and the two ways in (Settings → Start opens decides which is
   Start). Shared by the Plans list's "In use" strip and the top of a plan's
   own page, so both start the same day. Any day can be started on any day:
   a Friday lunch circuit on a Tuesday is the plan's next day, started now. */
function startCard(ctx, plan, pick, opts = {}) {
  const when = pick.today ? 'Today' : `Next · ${WEEKDAY_LABELS[pick.weekday] || pick.weekday}`;
  const stop = e => e.stopPropagation();
  const alt = el('button', {
    class: 'gv-btn gv-btn-small gv-btn-ghost gv-start-alt', type: 'button',
    'aria-label': `${startModes(ctx.settings).altLabel}: ${pick.day.name}`,
  }, el('span', {}, startModes(ctx.settings).altLabel));
  alt.addEventListener('click', e => { stop(e); ctx.startAlt(plan, pick.day); });
  const go = el('button', { class: 'gv-btn gv-btn-small gv-plan-go', type: 'button', 'aria-label': `Start ${pick.day.name}` },
    ico('play'), el('span', {}, 'Start'));
  go.addEventListener('click', e => { stop(e); ctx.start(plan, pick.day); });
  const main = el('div', { class: 'gv-alsotoday-main' },
    el('div', { class: 'gv-kicker' }, opts.kicker ? `${opts.kicker} · ${when}` : when),
    el('div', { class: 'gv-alsotoday-name' }, pick.day.name),
    opts.showPlan ? el('div', { class: 'gv-alsotoday-plan' }, plan.name) : '');
  const pair = el('div', { class: 'gv-start-pair' }, alt, go);
  if (!opts.onOpen) return el('div', { class: 'gv-card gv-alsotoday gv-plan-start' }, main, pair);
  return clickableCard({ class: 'gv-card gv-alsotoday gv-plan-start', 'aria-label': `Open ${plan.name}` }, opts.onOpen, main, pair);
}

/* THE PLANS YOU ARE ON, FIRST. Every plan Today uses (main, add-ons, backup)
   as a start card at the top of the list, above search and filters, so the
   plan you follow is never two screens of chips away from its Start. */
const ROLE_KICKER = { active: 'Main plan', alongside: 'Add-on', 'fills-gaps': 'Backup' };
function inUseStrip(ctx, plans, activeNow) {
  const todayKey = weekdayKey(todayISO());
  const cards = [];
  for (const p of plans) {
    const pick = startDayFor(p, todayKey);
    if (!pick) continue;
    cards.push(startCard(ctx, p, pick, { kicker: ROLE_KICKER[planRole(p, activeNow)], showPlan: true, onOpen: () => ctx.nav('plans', { plan: p.name }) }));
  }
  if (!cards.length) return null;
  return el('div', { class: 'gv-plan-inuse' }, el('div', { class: 'gv-plan-roles-label' }, 'In use'), ...cards);
}

function planCards(ctx, shown, activeNow) {
  const { data } = ctx;
  const list = el('div', { class: 'gv-card-list' });
  for (const p of shown) {
    const role = planRole(p, activeNow);
    const badge = badgeWord(p, activeNow);
    const active = role === 'active';
    const days = p.model.days;
    const exerciseCount = days.reduce((n, d) => n + d.items.length, 0);
    const c = clickableCard(
      { class: `gv-card gv-plan-card${active ? ' active' : ''}`,
        'aria-label': `Open ${p.name}${badge ? `, ${badge}` : ''}` },
      () => ctx.nav('plans', { plan: p.name }),
      el('div', { class: 'gv-plan-main' },
        el('div', { class: 'gv-plan-name' },
          el('span', {}, p.name),
          badge ? el('span', { class: 'gv-badge' }, badge) : ''),
        el('div', { class: 'gv-plan-meta' },
          `${days.length} day${days.length === 1 ? '' : 's'} / week · ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`),
        /* What the whole plan asks you to own, so you can tell at a glance
           whether it fits the kit you actually have. */
        el('div', { class: 'gv-plan-kit' }, ico('dumbbell'),
          el('span', {}, equipmentSummary(data.exercises, planExerciseNames(p)))),
        el('div', { class: 'gv-plan-days' },
          ...days.map(d => el('span', { class: 'gv-tag' }, `${d.weekday} · ${d.name}`))),
        cardControls(ctx, p)),
      el('div', { class: 'gv-card-actions' }, favouriteButton(ctx, p), ico('chevron-right', 'gv-dim')));
    list.append(c);
  }
  return list;
}

/* The star, on a list card and on the plan's own page. */
function favouriteButton(ctx, plan) {
  const on = isFavourite(plan);
  const b = el('button', {
    class: `gv-icon-btn gv-plan-fav${on ? ' on' : ''}`, type: 'button',
    'aria-label': `Favourite ${plan.name}`, 'aria-pressed': on ? 'true' : 'false',
  }, ico('star'));
  b.addEventListener('click', async e => {
    e.stopPropagation();
    await ctx.io.setFavourite(plan, !on);
    ctx.rerender();
  });
  return b;
}

/* Every muscle group a plan's exercises name, from the exercise notes —
   the only place that fact is recorded. */
function musclesOfPlan(exercises, names) {
  const out = new Set();
  for (const n of names) {
    const ex = exercises.find(e => e.name === n || (e.name || '').toLowerCase() === String(n).toLowerCase());
    if (!ex || !ex.fm) continue;
    const m = ex.fm.muscles;
    for (const g of Array.isArray(m) ? m : m ? [m] : []) out.add(g);
  }
  return out;
}

/* One labelled chip row. `get`/`set` rather than a bound value so the two
   rows share one implementation without either owning the other's state. */
function facetChips(ctx, label, values, labelOf, get, set) {
  const row = el('div', { class: 'gv-chips gv-facet' });
  row.append(el('span', { class: 'gv-facet-label' }, label));
  const all = el('button', { class: `gv-chip${get() === '' ? ' on' : ''}`, type: 'button' }, 'all');
  all.addEventListener('click', () => { set(''); ctx.rerender(); });
  row.append(all);
  for (const v of values) {
    const c = el('button', { class: `gv-chip${get() === v ? ' on' : ''}`, type: 'button' }, labelOf(v));
    /* Tapping the active chip clears it — the same toggle the exercise
       library uses, so a filter is never a trap you have to hunt for the
       way out of. */
    c.addEventListener('click', () => { set(get() === v ? '' : v); ctx.rerender(); });
    row.append(c);
  }
  return row;
}

/* Plain words for the three roles, each with the one line that says what it
   does. Ruan, 18 Nov 2026: "Runs alongside" and "Fills gaps" meant nothing to
   a user. So each role has a short everyday name, and wherever you pick one
   the line under it says what will happen on Today. The frontmatter keys
   (parallel, fallback) are unchanged. */
const ROLES = {
  main: { label: 'Main plan', desc: 'The plan Today follows. Only one can be active.' },
  parallel: { label: 'Add-on', desc: 'Adds its days on top of your main plan.' },
  fallback: { label: 'Backup', desc: 'Only shows on days your main plan has no workout.' },
};
const ROLE_OPTIONS = ['main', 'parallel', 'fallback'].map(v => [v, ROLES[v].label]);

/* The two writes, shared by the plan page and the Plans list so both say and
   do exactly the same thing. */
function isPlanOn(ctx, plan) {
  if (roleOf(plan.fm) === 'main') return typeof ctx.activePlan === 'function' && ctx.activePlan() === plan;
  return !isPaused(plan);
}
async function setPlanOn(ctx, plan, on) {
  if (roleOf(plan.fm) === 'main') await ctx.io.setActivePlan(ctx.mainPlans(), on ? plan : null);
  else await ctx.io.setPaused(plan, !on);
  ctx.reload();
}
async function changeRole(ctx, plan, next) {
  const ok = await ctx.io.setPlanRole(plan, next);
  if (ok && next === 'main') ctx.notice(`${plan.name} is now a main plan. Switch it to Active to make Today follow it.`);
  ctx.reload();
}

/* What the Active switch will do, in one line, for each role. */
function switchLine(ctx, plan, role, on) {
  if (role === 'main') {
    if (on) return 'Today follows this plan.';
    const cur = typeof ctx.activePlan === 'function' ? ctx.activePlan() : null;
    return cur ? `Switch on to make Today follow it instead of ${cur.name}.` : 'Switch on to make Today follow it.';
  }
  if (!on) return 'Not on Today. Nothing is deleted.';
  return role === 'fallback' ? 'Fills the days your main plan leaves empty.' : 'Its days are added to Today.';
}

/* "How plans work": one closed line above the Plans list that opens to say,
   once, what the three roles and the switch mean. Whether it is open lives in
   the list's view state, so flipping a switch (which redraws) keeps it open. */
function plansHelp(ui) {
  const d = el('details', ui.help ? { class: 'gv-plan-help', open: '' } : { class: 'gv-plan-help' },
    el('summary', {}, ico('info'), el('span', {}, 'How plans work')));
  d.addEventListener('toggle', () => { ui.help = d.open; });
  const list = el('dl', {});
  for (const v of ['main', 'parallel', 'fallback']) {
    list.append(el('dt', {}, ROLES[v].label), el('dd', {}, ROLES[v].desc));
  }
  d.append(list, el('p', {}, 'Set a plan to Inactive to take it off Today. Nothing is deleted. Tap a plan to change it on its own page.'));
  return d;
}

/* The footer of a Plans list card: the role on the left, the Active switch on
   the right, under a hairline so it reads apart from the plan's details. Both
   sit inside a card that opens the plan when tapped, so every event they take
   stops there (the star does the same). */
function cardControls(ctx, plan) {
  const stop = e => e.stopPropagation();
  const role = roleOf(plan.fm);
  const sel = el('select', { class: 'dropdown gv-plan-role-select', 'aria-label': `Role of ${plan.name}`, title: ROLES[role].desc },
    ...ROLE_OPTIONS.map(([v, label]) => el('option', v === role ? { value: v, selected: 'selected' } : { value: v }, label)));
  sel.value = role;
  sel.addEventListener('click', stop);
  sel.addEventListener('keydown', stop);
  sel.addEventListener('change', e => { stop(e); if (sel.value !== role) changeRole(ctx, plan, sel.value); });
  const on = isPlanOn(ctx, plan);
  const sw = el('button', {
    class: `gv-plan-switch${on ? ' on' : ''}`, type: 'button', role: 'switch',
    'aria-checked': on ? 'true' : 'false', 'aria-label': `${plan.name} active`,
  }, el('span', {}, on ? 'Active' : 'Inactive'), el('span', { class: `gv-switch${on ? ' on' : ''}`, 'aria-hidden': 'true' }));
  sw.addEventListener('keydown', stop);
  sw.addEventListener('click', e => { stop(e); setPlanOn(ctx, plan, !on); });
  return el('div', { class: 'gv-plan-ctl' }, sel, sw);
}

/* WHAT THIS PLAN DOES, AND WHETHER IT IS ON — one block at the top of a
   plan's page, for every plan.

   First the Active switch (the thing you came to change), then the role as
   three rows, each saying in one line what it does, so the choice explains
   itself without a help page.

   The switch is Active / Inactive in every role. For a main plan it is the
   `active` flag: on makes it THE plan Today runs (the one that was active is
   switched off — exactly one, so Today is never ambiguous), off leaves Today
   with no main plan until you turn one on. setActivePlan is only ever handed
   ctx.mainPlans(): stamping `active` onto an alongside plan means nothing.
   For an add-on or backup it is `paused` (plan-parse.isPaused). Nothing is
   deleted either way; the plan stays in the library. */
function planControls(ctx, plan) {
  const wrap = el('div', { class: 'gv-plan-controls' });
  const role = roleOf(plan.fm);
  const on = isPlanOn(ctx, plan);
  wrap.append(toggleRow(on ? 'Active' : 'Inactive', switchLine(ctx, plan, role, on), on,
    want => setPlanOn(ctx, plan, want),
    { label: role === 'main' ? 'Active plan' : 'Show on Today' }));

  const group = el('div', { class: 'gv-plan-roles', role: 'radiogroup', 'aria-label': `Role of ${plan.name}` },
    el('div', { class: 'gv-plan-roles-label' }, 'How Today uses it'));
  for (const [value, label] of ROLE_OPTIONS) {
    const picked = value === role;
    const row = el('button', {
      class: `gv-card gv-optrow gv-plan-roleopt${picked ? ' on' : ''}`, type: 'button',
      role: 'radio', 'aria-checked': picked ? 'true' : 'false',
    },
    el('span', { class: 'gv-radio', 'aria-hidden': 'true' }),
    el('span', { class: 'gv-optrow-main' },
      el('span', { class: 'gv-optrow-name' }, label),
      el('span', { class: 'gv-optrow-desc' }, ROLES[value].desc)));
    row.addEventListener('click', () => { if (!picked) changeRole(ctx, plan, value); });
    group.append(row);
  }
  wrap.append(group);
  return wrap;
}

function renderDetail(ctx, root, plan) {

  const bar = el('div', { class: 'gv-toolbar' });
  /* Back to the CALLER. This was hardcoded to the plan LIST, which is right
     when you opened the plan from the list — and wrong from anywhere else.
     Running's "Plan" button navigates straight here, so Back dropped you on
     the Plans list rather than returning you to Running: the same defect
     #22 fixed for records and exercise detail, on a route that issue did not
     name.

     'plans' stays the fallback rather than the destination. Opening a plan
     from the list is a LATERAL move — same page, different params — so the
     stack deliberately does not push it, and with an empty stack the
     fallback is what lands you back on the list. */
  const back = backButton(ctx, 'plans');
  bar.append(back, el('h2', { class: 'gv-toolbar-title' }, plan.name));
  const actions = el('div', { class: 'gv-toolbar-actions' }, favouriteButton(ctx, plan));
  /* EDIT MODE is a view state, not a draft. Every change writes to the note
     the moment it is made — there is no Save button and nothing accumulates
     unsaved, because a half-finished plan edit lost to a vault sync would be
     worse than an extra write. The toggle only changes what controls are on
     screen. */
  /* Keyed to THIS plan's name, not a bare bool: without the key, edit mode
     outlived the plan it was switched on for — open plan A, tap Edit, Back,
     open plan B, and B opened already in edit mode (it even survived a tab
     switch, since nothing ever reset it). A plan whose name no longer
     matches means we navigated somewhere else since, so it reads as off. */
  const editing = !!(ctx.state.plansUi && ctx.state.plansUi.plan === plan.name && ctx.state.plansUi.editing);
  actions.append(el('button', {
    class: `gv-btn ${editing ? '' : 'gv-btn-ghost'}`, type: 'button',
    'aria-pressed': editing ? 'true' : 'false',
    onclick: () => {
      ctx.state.plansUi = { plan: plan.name, editing: !editing };
      ctx.rerender();
    },
  }, ico(editing ? 'check' : 'pencil'), el('span', {}, editing ? 'Done' : 'Edit')));
  actions.append(el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => ctx.openFile(plan.file) },
    ico('file-text'), el('span', {}, 'Open note')));
  bar.append(actions);
  root.append(bar);

  /* THE ONE START ON THIS PAGE, at the top (24 Nov 2026): today's day, or the
     next one, so a plan whose days fall later in the week can still be done
     now. It is the page's single flood; the per-day Starts below are ghost. */
  const todayKey = weekdayKey(todayISO());
  const pick = startDayFor(plan, todayKey);
  if (pick) root.append(startCard(ctx, plan, pick));

  root.append(planControls(ctx, plan));

  if (plan.model.intro.length) {
    /* First paragraph only until asked — a plan's rationale is worth having
       but should not be the first wall you meet. */
    root.append(prose(plan.model.intro, { class: 'gv-plan-intro', preview: 1 }));
  }

  /* THIS PAGE IS A READING DOCUMENT (Editorial Floor). It is coaching prose,
     day lists and equipment tags — so it gets ONE acting flood, not one per
     day. Every day card used to carry a solid Start, which made a six-day
     plan six acting blocks and left nothing for the eye to land on.

     The one flood is the start card at the top of the page (today's day, or
     the plan's next one), so every day card's Start below is ghost.

     Start stays on every day either way — starting a specific day from the
     plan is a real action, and this is a change of register, not of
     function. */
  for (const day of plan.model.days) {
    const card = el('div', { class: 'gv-card gv-day-card' });
    card.append(el('div', { class: 'gv-day-head' },
      el('div', {},
        el('div', { class: 'gv-day-title' }, day.name),
        el('div', { class: 'gv-day-sub' }, WEEKDAY_LABELS[day.weekday] || day.weekday)),
      /* Start opens what Settings → Start opens says; the other way sits
         beside it, so the log is never reached by starting and leaving a
         guided session (issue #28). */
      el('div', { class: 'gv-start-pair' },
        el('button', {
          class: 'gv-btn gv-btn-small gv-btn-ghost gv-start-alt',
          type: 'button',
          'aria-label': `${startModes(ctx.settings).altLabel}: ${day.name}`,
          onclick: () => ctx.startAlt(plan, day),
        }, el('span', {}, startModes(ctx.settings).altLabel)),
        el('button', {
          class: 'gv-btn gv-btn-small gv-btn-ghost',
          type: 'button',
          onclick: () => ctx.start(plan, day),
        }, ico('play'), el('span', {}, 'Start')))));
    if (day.notes.length) card.append(prose(day.notes, { class: 'gv-day-note', preview: 1 }));
    const kit = equipmentFor(ctx.data.exercises, day.items.map(it => it.exercise));
    if (kit.length) {
      card.append(el('div', { class: 'gv-chips gv-day-kit' },
        ...kit.map(item => el('span', { class: 'gv-tag' }, item.label))));
    }
    const ul = el('div', { class: 'gv-day-items' });
    day.items.forEach((it, idx) => {
      /* No remove button outside edit mode. It used to sit beside every
         line in the read view with no confirm and no undo — a mis-tap on a
         phone silently rewrote the plan note. Edit mode already carries the
         same button (below), so removing a line now takes a deliberate step
         into edit mode first. */
      ul.append(editing ? editableItem(ctx, plan, day, it, idx) : planItemRow(ctx, it));
    });
    ul.append(el('button', { class: 'gv-add-line', type: 'button', onclick: () => openAddItem(ctx, plan, day) },
      ico('plus'), el('span', {}, 'Add exercise')));
    card.append(ul);
    root.append(card);
  }

  const foot = el('div', { class: 'gv-toolbar gv-toolbar-foot' },
    el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => openAddDay(ctx, plan) },
      ico('plus'), el('span', {}, 'Add day')),
    el('button', {
      class: 'gv-btn gv-btn-danger-ghost', type: 'button',
      onclick: () => new ConfirmModal(ctx.app, {
        title: 'Delete plan?',
        message: `"${plan.name}" will be deleted, following your Obsidian "Deleted files" setting. Logged workouts stay.`,
        /* Leave this page BEFORE deleting, not after. This is the detail
           view of the very plan being removed: awaiting the delete first
           meant sitting on it for the whole operation — which reads as
           nothing having happened — and staying on it permanently if the
           delete threw. The reload is in a finally so the list is accurate
           whether the delete succeeded or not; the error still reaches the
           modal's handler, which raises a Notice. */
        onConfirm: async () => {
          ctx.nav('plans');
          try {
            await ctx.io.trash(plan.file);
          } finally {
            await ctx.reload();
          }
        },
      }).open(),
    }, ico('trash-2'), el('span', {}, 'Delete plan')));
  root.append(foot);
}

/* One exercise line in the READ view (0.11.2 journey audit, finding L11).
   Nothing here opened its exercise — back-stack.test.cjs's own router model
   already assumed a plan detail -> exercise detail leg existed, and it did
   not: page-plans.js never called ctx.nav('exercise', …). Every other place
   an exercise's name appears (the library, Records, Running records)
   already makes that jump.

   A plan can name an exercise with no note behind it — nothing stops a
   hand-typed line — and there the row stays inert: page-exercise-detail
   bounces straight back to the library when it can't resolve one, which
   would only replace "goes nowhere" with "goes to the wrong somewhere". */
function planItemRow(ctx, it) {
  const rx = rxLabel(it);
  const ex = ctx.data.exercises.find(e => sameName(e.name, it.exercise));
  if (!ex) {
    return el('div', { class: 'gv-day-item' },
      el('span', { class: 'gv-day-item-name' }, it.exercise),
      el('span', { class: 'gv-day-item-rx' }, rx));
  }
  return clickableCard(
    { class: 'gv-day-item gv-day-item-link', 'aria-label': `Open ${it.exercise}` },
    () => ctx.nav('exercise', { exercise: it.exercise, path: ex.file.path }),
    el('span', { class: 'gv-day-item-name' }, it.exercise),
    el('span', { class: 'gv-day-item-rx' }, rx));
}

/* One exercise line, in edit mode: sets, target, move up, move down, remove.

   THE NAME IS NOT EDITABLE. Plans, goals and every logged row reference an
   exercise BY NAME, so renaming one here would orphan its whole history
   without saying so. Removing and re-adding is the deliberate, visible way
   to change which exercise a line is.

   Writes on `change`, not on every keystroke: `input` would save (and then
   reload the whole plan out from under the field) between "1" and "12".

   The reload that follows a write is DEFERRED to when focus actually leaves
   this row (see the `focusout` listener below), not fired the instant a
   field's `change` event does. `change` fires on blur, so tabbing from Sets
   straight into Target used to call ctx.reload() — a full re-render of the
   whole page — right as focus landed in Target, throwing the caret back out
   to the page mid-tab. The write itself still happens on every change, and
   that deferred reload waits for the write (saveSerial / savesSettled above). */
function editableItem(ctx, plan, day, it, idx) {
  /* Resolves true when the note was saved. When it was not — the note changed
     outside the app and savePlan refused (it has told the user), or the write
     failed — the screen is showing a model the note no longer matches, so
     rebuild it from disk now and resolve false. */
  const persist = async () => {
    try {
      if ((await saveSerial(ctx, plan)) !== false) return true;
    } catch (e) {
      console.error('gym-vault plan save', e);
      ctx.notice(`could not save the plan (${e.message || e})`);
    }
    ctx.reload();
    return false;
  };
  const setsInput = el('input', {
    class: 'gv-set-input gv-edititem-sets', type: 'number', inputmode: 'numeric', min: '1', step: '1',
    value: it.sets == null ? '' : String(it.sets), placeholder: '3',
    'aria-label': `Sets of ${it.exercise}`,
  });
  setsInput.addEventListener('change', () => {
    updateItem(day, idx, { sets: setsInput.value });
    persist();
  });

  const targetInput = el('input', {
    class: 'gv-set-input gv-edititem-target', type: 'text',
    value: it.target || '', placeholder: 'reps, 45s, 5 @ 60kg',
    'aria-label': `Prescription for ${it.exercise}`,
  });
  targetInput.addEventListener('change', () => {
    /* A typed target that STARTS WITH "N x" / "N ×" is peeled the same way
       parsePrescription (plan-parse.js) reads a saved line back off disk:
       the leading count becomes Sets, the remainder becomes Target. Without
       this, typing "3 x 10" into Target while Sets already held 3 wrote the
       line as `3 x 3 x 10` (the existing Sets count, PLUS the count typed
       into Target) — which round-tripped through the parser as sets:3,
       target:"3 x 10", and displayed as "3 × 3 x 10". Peeling before the
       write means what the box shows the moment it is typed is what comes
       back after a reload, not a second multiplier stacked on top of it. */
    const parsed = parsePrescription(targetInput.value);
    if (parsed.sets != null) {
      updateItem(day, idx, { sets: parsed.sets, target: parsed.target });
      setsInput.value = String(parsed.sets);
      targetInput.value = parsed.target;
    } else {
      updateItem(day, idx, { target: targetInput.value });
    }
    persist();
  });

  /* By the item, not the index captured at render: the position is read at the
     moment of the tap, so a model that has shifted can never move a different
     line. */
  const move = delta => () => structuralEdit(ctx, plan, () => {
    const from = day.items.indexOf(it);
    if (from < 0) return false;
    return moveItem(day, from, delta) !== from; // false at the end: nothing to write
  });
  const up = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Move ${it.exercise} up` }, ico('chevron-up'));
  up.addEventListener('click', move(-1));
  up.disabled = idx === 0;
  const down = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Move ${it.exercise} down` }, ico('chevron-down'));
  down.addEventListener('click', move(1));
  down.disabled = idx === day.items.length - 1;

  const row = el('div', { class: 'gv-day-item gv-edititem' },
    el('div', { class: 'gv-edititem-name' }, it.exercise),
    el('div', { class: 'gv-edititem-rx' },
      setsInput,
      el('span', { class: 'gv-set-unit' }, '×'),
      targetInput),
    el('div', { class: 'gv-edititem-actions' }, up, down, removeItemBtn(ctx, plan, day, it)));

  /* `focusout` bubbles (unlike `blur`), so one listener on the row catches
     focus leaving ANY of its fields. `relatedTarget` is where focus is
     GOING — if that is still inside this row (Sets -> Target, or into one
     of the row's own buttons) nothing has actually been left yet, so the
     rebuild waits. */
  row.addEventListener('focusout', e => {
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    savesSettled(plan).then(() => afterPress(ctx, () => ctx.reload()));
  });
  pressWatch(typeof document !== 'undefined' ? document : null, ctx);
  return row;
}

function removeItemBtn(ctx, plan, day, it) {
  const b = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Remove' }, ico('x'));
  b.addEventListener('click', () => structuralEdit(ctx, plan, () => {
    const at = day.items.indexOf(it);   // this line, wherever it is now
    if (at < 0) return false;
    removeItemAt(day, at);
  }));
  return b;
}

function openAddPlan(ctx) {
  new FormModal(ctx.app, {
    title: 'New plan',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', placeholder: 'e.g. Get Over The Bar' },
      { key: 'active', label: 'Make it the active plan', kind: 'toggle', value: ctx.data.plans.length === 0 },
    ],
    submitLabel: 'Create',
    validate: v => (!v.name.trim() ? 'Give it a name.' : null),
    onSubmit: async v => {
      const created = await ctx.io.createPlan(v.name.trim(), { active: false }, '');
      if (!created) { ctx.notice('A plan with that name already exists.'); return; }
      const fresh = await ctx.io.loadAll();
      const p = fresh.plans.find(x => x.name === ctx.io.safeName(v.name.trim()));
      if (v.active && p) await ctx.io.setActivePlan(fresh.plans, p);
      ctx.nav('plans', { plan: p ? p.name : undefined });
      ctx.reload();
    },
  }).open();
}

function openAddDay(ctx, plan) {
  new FormModal(ctx.app, {
    title: 'Add day',
    fields: [
      { key: 'name', label: 'Day name', kind: 'text', placeholder: 'e.g. Push + Volume' },
      /* `any` sits after the seven real weekdays, not among them — it is
         the wildcard fallback/parallel plans use to fill whatever weekday
         they do not otherwise claim (controller.js's resolveDaysOn), a real
         and now-authorable choice rather than the decorative one it used to
         be (0.11.2 journey audit, finding L12). */
      { key: 'weekday', label: 'Weekday', kind: 'dropdown', options: [...WEEKDAYS, 'any'].map(w => [w, WEEKDAY_LABELS[w]]), value: 'mon' },
    ],
    submitLabel: 'Add',
    validate: v => (!v.name.trim() ? 'Give the day a name.' : null),
    onSubmit: async v => {
      plan.model.days.push({ name: v.name.trim(), weekday: v.weekday, parts: [], notes: [], items: [] });
      await saveThenReload(ctx, plan);
    },
  }).open();
}

function openAddItem(ctx, plan, day) {
  const options = ctx.data.exercises.map(e => [e.name, e.name]);
  new FormModal(ctx.app, {
    title: `Add to ${day.name}`,
    fields: [
      options.length
        ? { key: 'exercise', label: 'Exercise', kind: 'dropdown', options, value: options[0][0] }
        : { key: 'exercise', label: 'Exercise', kind: 'text', placeholder: 'e.g. Pull-ups' },
      { key: 'sets', label: 'Sets', kind: 'number', value: '3' },
      { key: 'target', label: 'Target', kind: 'text', placeholder: '8-12, submax, 30-45s, 8 @ 20kg', desc: 'Free text — reps, a range, seconds, or "@ weight"' },
    ],
    submitLabel: 'Add',
    validate: v => (!String(v.exercise).trim() ? 'Pick an exercise.' : null),
    onSubmit: async v => {
      const sets = parseInt(v.sets, 10);
      addItem(day, { exercise: String(v.exercise).trim(), sets: Number.isFinite(sets) && sets > 0 ? sets : null, target: v.target.trim() });
      await saveThenReload(ctx, plan);
    },
  }).open();
}

module.exports = { render, planRole, orderPlans, planMatches, badgeWord };
