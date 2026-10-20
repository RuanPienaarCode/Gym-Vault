'use strict';
/* Browse — the shared plan library (RuanPienaarCode/gym_plans by default).

   Downloads are plain markdown fetched over https and written into the
   vault: nothing is executed, nothing is sent anywhere, and nothing you
   already have is ever overwritten. Series (a plan in numbered phases) are
   grouped so a four-phase programme reads as one thing, not four. */

const { el, ico, backButton, emptyLine } = require('./dom');
const { countLabel } = require('./stats');

function render(ctx, root) {
  const ui = ctx.state.browseUi || (ctx.state.browseUi = { index: null, error: null, loading: false, busy: null });

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

    const have = new Set(ctx.data.plans.map(p => p.name.toLowerCase()));
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

  const load = async force => {
    if (ui.index && !force) { draw(); return; }
    ui.loading = true; ui.error = null; draw();
    try { ui.index = await ctx.io.fetchPlanIndex(); }
    catch (e) { ui.error = e.message || String(e); }
    ui.loading = false;
    draw();
  };

  load(false);
}

function seriesCard(ctx, group, have, draw) {
  const first = group.phases[0];
  const installed = group.phases.filter(p => have.has(p.name.toLowerCase())).length;
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
  const added = have.has(p.name.toLowerCase());
  return el('div', { class: 'gv-browse-phase' },
    el('span', { class: 'gv-browse-phase-n' }, `${p.phase}`),
    el('span', { class: 'gv-browse-phase-name' }, p.name.replace(/^.*?·\s*/, '')),
    el('span', { class: 'gv-browse-phase-meta' }, `${countLabel(p.days, 'day')} · ${countLabel(p.exercises.length, 'exercise')}`),
    added
      ? el('span', { class: 'gv-tag' }, 'added')
      : addButton(ctx, 'plan:' + p.name, 'gv-btn gv-btn-ghost gv-btn-small', 'Add', () => installOne(ctx, p, draw)));
}

function planCard(ctx, p, have, draw) {
  const added = have.has(p.name.toLowerCase());
  return el('div', { class: 'gv-card gv-browse-card' },
    el('div', { class: 'gv-browse-head' },
      el('div', {},
        el('div', { class: 'gv-browse-name' }, p.name),
        el('div', { class: 'gv-kicker' }, `${countLabel(p.days, 'day')} · ${countLabel(p.exercises.length, 'exercise')}${p.fallback ? ' · fills empty days' : p.parallel ? ' · runs alongside' : ''}`)),
      added
        ? el('span', { class: 'gv-badge' }, 'added')
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
  if (results.length) ctx.notice(report(`${results.length} plan${results.length === 1 ? '' : 's'}`, results));
  draw();
}

/* One honest sentence: what landed, what was already there, what failed. */
function report(what, results) {
  const added = results.reduce((n, r) => n + r.exercisesAdded, 0);
  const skipped = results.reduce((n, r) => n + r.exercisesSkipped, 0);
  const failed = results.flatMap(r => r.failed);
  const planSkipped = results.filter(r => r.planSkipped).length;
  const bits = [`${what} added`];
  if (planSkipped) bits.push(`${planSkipped} already there`);
  if (added) bits.push(`${added} new exercise${added === 1 ? '' : 's'}`);
  if (skipped) bits.push(`${skipped} you already had`);
  if (failed.length) bits.push(`could not fetch: ${failed.join(', ')}`);
  return bits.join(' · ') + '.';
}

module.exports = { render };
