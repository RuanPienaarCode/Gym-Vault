'use strict';
/* Browse — the shared plan library (RuanPienaarCode/gym_plans by default).

   Downloads are plain markdown fetched over https and written into the
   vault: nothing is executed, nothing is sent anywhere, and nothing you
   already have is ever overwritten. Series (a plan in numbered phases) are
   grouped so a four-phase programme reads as one thing, not four. */

const { el, ico } = require('./dom');

function render(ctx, root) {
  const ui = ctx.state.browseUi || (ctx.state.browseUi = { index: null, error: null, loading: false, busy: null });

  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Back to plans' }, ico('arrow-left'));
  back.addEventListener('click', () => ctx.nav('plans'));
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
    if (ui.loading) { listWrap.append(el('div', { class: 'gv-empty-line' }, 'Fetching the library…')); return; }
    if (ui.error) {
      listWrap.append(el('div', { class: 'gv-empty-line' },
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
        : el('button', {
            class: 'gv-btn gv-btn-small', type: 'button',
            onclick: () => installMany(ctx, group.phases, draw),
          }, ico('plus'), el('span', {}, installed ? 'Add the rest' : 'Add all'))),
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
    el('span', { class: 'gv-browse-phase-meta' }, `${p.days} days · ${p.exercises.length} exercises`),
    added
      ? el('span', { class: 'gv-tag' }, 'added')
      : el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => installOne(ctx, p, draw) },
          ico('plus'), el('span', {}, 'Add')));
}

function planCard(ctx, p, have, draw) {
  const added = have.has(p.name.toLowerCase());
  return el('div', { class: 'gv-card gv-browse-card' },
    el('div', { class: 'gv-browse-head' },
      el('div', {},
        el('div', { class: 'gv-browse-name' }, p.name),
        el('div', { class: 'gv-kicker' }, `${p.days} days · ${p.exercises.length} exercises${p.fallback ? ' · fills empty days' : p.parallel ? ' · runs alongside' : ''}`)),
      added
        ? el('span', { class: 'gv-badge' }, 'added')
        : el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => installOne(ctx, p, draw) },
            ico('plus'), el('span', {}, 'Add'))),
    el('div', { class: 'gv-browse-summary' }, p.summary));
}

async function installOne(ctx, entry, draw) {
  try {
    const r = await ctx.io.installPlan(entry);
    await ctx.reload();
    ctx.notice(report(entry.name, [r]));
    draw();
  } catch (e) {
    ctx.notice(`could not add ${entry.name} (${e.message || e})`);
  }
}

async function installMany(ctx, entries, draw) {
  const results = [];
  try {
    for (const entry of entries) results.push(await ctx.io.installPlan(entry));
  } catch (e) {
    ctx.notice(`stopped partway (${e.message || e}) — what downloaded is already in your vault.`);
  }
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
