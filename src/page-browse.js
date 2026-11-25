'use strict';
/* Browse — the shared plan library (RuanPienaarCode/gym_plans by default).

   Downloads are plain markdown fetched over https and written into the
   vault: nothing is executed, nothing is sent anywhere, and nothing you
   already have is ever overwritten. Series (a plan in numbered phases) are
   grouped so a four-phase programme reads as one thing, not four. */

const { el, ico, backButton, emptyLine } = require('./dom');
const { countLabel } = require('./stats');

/* The address the library is fetched from, as data.js's repoBase reads it
   (trailing slashes do not make a different address). */
const repoOf = ctx => String((ctx.settings && ctx.settings.planRepo) || '').trim().replace(/\/+$/, '');

/* THE NAME A PLAN HAS IN THE VAULT. Notes are saved under the folded name
   (ctx.io.safeName turns / : # [ ] and friends into "-"), so "is it already
   here?" must fold the library's name the same way before comparing, and fold
   the local name too (contract K4). Comparing the raw library name with the
   local names meant a plan called "Push/Pull" never showed "added", and a second
   Add was reported as an install that had been skipped. */
const vaultKey = (ctx, name) => ctx.io.safeName(name).toLowerCase();

/* THE VAULT PLAN A LIBRARY ENTRY BECAME, or null when it is not in the vault.
   installPlan writes `source: <entry id>` into the plan's frontmatter, so a plan
   that was renamed afterwards (or saved under another name) is still found by
   that id. Notes installed before `source` existed carry none, so the folded
   NAME still matches too. */
function addedPlan(ctx, entry) {
  const plans = (ctx.data && ctx.data.plans) || [];
  const id = entry.id === undefined || entry.id === null ? '' : String(entry.id).trim();
  if (id) {
    const bySource = plans.find(p => p.fm && String(p.fm.source === undefined || p.fm.source === null ? '' : p.fm.source).trim() === id);
    if (bySource) return bySource;
  }
  const key = vaultKey(ctx, entry.name);
  return plans.find(p => vaultKey(ctx, p.name) === key) || null;
}

/* What replaces Add once a plan is in the vault: a small "added" marker and an
   Open button that goes to that plan's page, where the Active switch is at the
   top. Back from there returns here (ctx.nav pushes Browse on the back stack). */
function addedControls(ctx, plan, tagClass) {
  return el('span', { class: 'gv-browse-added' },
    el('span', { class: tagClass }, 'added'),
    el('button', {
      class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': `Open ${plan.name}`,
      onclick: () => ctx.nav('plans', { plan: plan.name }),
    }, el('span', {}, 'Open'), ico('chevron-right')));
}

function render(ctx, root) {
  const ui = ctx.state.browseUi || (ctx.state.browseUi = { index: null, repo: null, error: null, loading: false, busy: null });

  const back = backButton(ctx, 'plans');
  root.append(el('div', { class: 'gv-toolbar' },
    back,
    el('h2', { class: 'gv-toolbar-title' }, 'Plan library'),
    el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => load(true) },
      ico('repeat-2'), el('span', {}, 'Refresh'))));

  root.append(el('p', { class: 'gv-hero-sub gv-export-lede' },
    'Plans shared from a public library. Adding one copies it and any exercises it needs into your vault — it never replaces what you already have, and it arrives switched off.'));

  const listWrap = el('div', {});
  root.append(listWrap);

  const draw = () => {
    while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
    if (ui.loading) { listWrap.append(emptyLine('Fetching the library…')); return; }
    if (ui.error) {
      listWrap.append(emptyLine(
        `Could not reach the library (${ui.error}). Check the connection, or the library URL in Settings.`));
      return;
    }
    if (!ui.index) return;

    const have = entry => addedPlan(ctx, entry);
    /* Group numbered series into one card; standalone plans stand alone. */
    const groups = [];
    const bySeries = new Map();
    for (const p of ui.index.plans) {
      if (!p.series) { groups.push({ single: p }); continue; }
      if (!bySeries.has(p.series)) { const g = { series: p.series, phases: [] }; bySeries.set(p.series, g); groups.push(g); }
      bySeries.get(p.series).phases.push(p);
    }
    for (const g of groups) {
      if (g.series) g.phases.sort((a, b) => (a.phase || 0) - (b.phase || 0));
      listWrap.append(g.series ? seriesCard(ctx, g, have, draw) : planCard(ctx, g.single, have, draw));
    }
  };

  /* The cached index remembers the address it was fetched FROM (`ui.repo`). Once
     the Plan library address in Settings no longer matches, the list is another
     library's: Browse showed the old one, and Add fetched the old entry's file
     from the new address (a 404). It is dropped, not just refetched, so a failed
     fetch from the new address cannot bring the old list back on the next visit. */
  const load = async force => {
    const from = repoOf(ctx);
    if (ui.index && ui.repo !== from) ui.index = null;
    if (ui.index && !force) { draw(); return; }
    ui.loading = true; ui.error = null; draw();
    try { ui.index = await ctx.io.fetchPlanIndex(); ui.repo = from; }
    catch (e) { ui.error = e.message || String(e); }
    ui.loading = false;
    draw();
  };

  load(false);
}

function seriesCard(ctx, group, have, draw) {
  const first = group.phases[0];
  const installed = group.phases.filter(p => have(p)).length;
  const card = el('div', { class: 'gv-card gv-browse-card' },
    el('div', { class: 'gv-browse-head' },
      el('div', {},
        el('div', { class: 'gv-kicker' }, `${group.phases.length}-phase programme`),
        el('div', { class: 'gv-browse-name' }, seriesTitle(first))),
      installed === group.phases.length
        ? el('span', { class: 'gv-badge' }, 'added')
        : addButton(ctx, 'series:' + group.series, 'gv-btn gv-btn-small', installed ? 'Add the rest' : 'Add all',
            () => installMany(ctx, group.series, group.phases, draw))),
    el('div', { class: 'gv-browse-summary' }, first.summary));
  const phases = el('div', { class: 'gv-browse-phases' });
  for (const p of group.phases) phases.append(phaseRow(ctx, p, have, draw));
  card.append(phases);
  return card;
}

const seriesTitle = first => (first.name || '').replace(/\s*\d+\s*·.*$/, '').trim() || first.series;

function phaseRow(ctx, p, have, draw) {
  const added = have(p);
  return el('div', { class: 'gv-browse-phase' },
    el('span', { class: 'gv-browse-phase-n' }, `${p.phase}`),
    el('span', { class: 'gv-browse-phase-name' }, p.name.replace(/^.*?·\s*/, '')),
    el('span', { class: 'gv-browse-phase-meta' }, `${countLabel(p.days, 'day')} · ${countLabel(p.exercises.length, 'exercise')}`),
    added
      ? addedControls(ctx, added, 'gv-tag')
      : addButton(ctx, 'plan:' + p.name, 'gv-btn gv-btn-ghost gv-btn-small', 'Add', () => installOne(ctx, p, draw)));
}

function planCard(ctx, p, have, draw) {
  const added = have(p);
  return el('div', { class: 'gv-card gv-browse-card' },
    el('div', { class: 'gv-browse-head' },
      el('div', {},
        el('div', { class: 'gv-browse-name' }, p.name),
        el('div', { class: 'gv-kicker' }, `${countLabel(p.days, 'day')} · ${countLabel(p.exercises.length, 'exercise')}${p.fallback ? ' · backup' : p.parallel ? ' · add-on' : ''}`)),
      added
        ? addedControls(ctx, added, 'gv-tag')
        : addButton(ctx, 'plan:' + p.name, 'gv-btn gv-btn-small', 'Add', () => installOne(ctx, p, draw))),
    el('div', { class: 'gv-browse-summary' }, p.summary));
}

/* ONE INSTALL AT A TIME. `ui.busy` names the install in flight (or null). The
   buttons are disabled and say "Adding..." while it runs, and a second tap that
   still gets through (a double-tap lands before the redraw) is refused here -
   the second run used to hit "File already exists." right after a success and
   report a failure for something that had worked. */
function addButton(ctx, key, cls, label, onClick) {
  const busy = ctx.state.browseUi.busy;
  const b = el('button', { class: cls, type: 'button', onclick: onClick },
    ico('plus'), el('span', {}, busy === key ? 'Adding\u2026' : label));
  if (busy) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
  return b;
}

async function installOne(ctx, entry, draw) {
  const ui = ctx.state.browseUi;
  if (ui.busy) return;
  ui.busy = 'plan:' + entry.name; draw();
  let r;
  try {
    r = await ctx.io.installPlan(entry);
  } catch (e) {
    ui.busy = null; draw();
    ctx.notice(`could not add ${entry.name} (${e.message || e})`);
    return;
  }
  /* Released BEFORE the reload: reload re-renders the page, and that render
     must see a free library (the old draw below belongs to a page it replaces). */
  ui.busy = null;
  await ctx.reload();
  ctx.notice(report(entry.name, [r]));
  draw();
}

async function installMany(ctx, series, entries, draw) {
  const ui = ctx.state.browseUi;
  if (ui.busy) return;
  ui.busy = 'series:' + series; draw();
  const results = [];
  try {
    for (const entry of entries) results.push(await ctx.io.installPlan(entry));
  } catch (e) {
    ctx.notice(`stopped partway (${e.message || e}) — what downloaded is already in your vault.`);
  }
  ui.busy = null;
  await ctx.reload();
  if (results.length) ctx.notice(report(entries[0].name, results));
  draw();
}

/* One honest sentence: what landed, what was already there, what failed.

   `what` names the plan when ONE was installed. A skipped install (the note was
   already in the vault, which installPlan never overwrites) says so; it used to
   open with "<name> added" whatever happened, and a series counted the skipped
   phases among the ones added. */
function report(what, results) {
  const added = results.reduce((n, r) => n + r.exercisesAdded, 0);
  const skipped = results.reduce((n, r) => n + r.exercisesSkipped, 0);
  const failed = results.flatMap(r => r.failed);
  const planSkipped = results.filter(r => r.planSkipped).length;
  const planAdded = results.length - planSkipped;
  const bits = [];
  if (results.length === 1) bits.push(`${what} ${planSkipped ? 'was already there' : 'added'}`);
  else {
    if (planAdded) bits.push(`${planAdded} plan${planAdded === 1 ? '' : 's'} added`);
    if (planSkipped) bits.push(`${planSkipped} already there`);
  }
  if (added) bits.push(`${added} new exercise${added === 1 ? '' : 's'}`);
  if (skipped) bits.push(`${skipped} you already had`);
  if (failed.length) bits.push(`could not fetch: ${failed.join(', ')}`);
  return bits.join(' · ') + '.';
}

module.exports = { render };
