'use strict';
/* Plans — list, detail, and structural edits (add day / add exercise line).
   The plan note stays the source of truth: heavier editing is one tap away
   via "Open note", and everything written here round-trips through
   plan-parse so hand-written coaching cues survive. */

const { el, ico } = require('./dom');
const { WEEKDAYS, WEEKDAY_LABELS } = require('./constants');
const { addItem, removeItemAt } = require('./plan-parse');
const { FormModal, ConfirmModal } = require('./modals');

function render(ctx, root) {
  const { data } = ctx;
  const openName = ctx.state.params && ctx.state.params.plan;
  const open = data.plans.find(p => p.name === openName);
  if (open) return renderDetail(ctx, root, open);

  const bar = el('div', { class: 'gv-toolbar' },
    el('div', { class: 'gv-toolbar-title' }, 'Training plans'),
    el('button', { class: 'gv-btn', type: 'button', onclick: () => openAddPlan(ctx) }, ico('plus'), el('span', {}, 'Plan')));
  root.append(bar);

  if (!data.plans.length) {
    root.append(el('div', { class: 'gv-empty-line' }, 'No plans yet — create one, or run setup from Settings.'));
    return;
  }
  const list = el('div', { class: 'gv-card-list' });
  for (const p of data.plans) {
    const active = String(p.fm.active) === 'true';
    const days = p.model.days;
    const c = el('div', { class: `gv-card gv-plan-card${active ? ' active' : ''}` },
      el('div', { class: 'gv-plan-main' },
        el('div', { class: 'gv-plan-name' },
          el('span', {}, p.name),
          active ? el('span', { class: 'gv-badge' }, 'active') : ''),
        el('div', { class: 'gv-plan-meta' },
          `${days.length} day${days.length === 1 ? '' : 's'} / week · ${days.reduce((n, d) => n + d.items.length, 0)} exercises`),
        el('div', { class: 'gv-plan-days' },
          ...days.map(d => el('span', { class: 'gv-tag' }, `${d.weekday} · ${d.name}`)))),
      el('div', { class: 'gv-card-actions' }, ico('chevron-right', 'gv-dim')));
    c.addEventListener('click', () => ctx.nav('plans', { plan: p.name }));
    list.append(c);
  }
  root.append(list);
}

function renderDetail(ctx, root, plan) {
  const active = String(plan.fm.active) === 'true';

  const bar = el('div', { class: 'gv-toolbar' });
  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Back' }, ico('arrow-left'));
  back.addEventListener('click', () => ctx.nav('plans'));
  bar.append(back, el('div', { class: 'gv-toolbar-title' }, plan.name));
  const actions = el('div', { class: 'gv-toolbar-actions' });
  if (!active) {
    actions.append(el('button', {
      class: 'gv-btn gv-btn-ghost', type: 'button',
      onclick: async () => { await ctx.io.setActivePlan(ctx.data.plans, plan); ctx.reload(); },
    }, ico('circle-check'), el('span', {}, 'Make active')));
  } else {
    actions.append(el('span', { class: 'gv-badge' }, 'active'));
  }
  actions.append(el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => ctx.openFile(plan.file) },
    ico('pencil'), el('span', {}, 'Open note')));
  bar.append(actions);
  root.append(bar);

  if (plan.model.intro.length) {
    root.append(el('div', { class: 'gv-plan-intro' }, plan.model.intro.join(' ').trim()));
  }

  for (const day of plan.model.days) {
    const card = el('div', { class: 'gv-card gv-day-card' });
    card.append(el('div', { class: 'gv-day-head' },
      el('div', {},
        el('div', { class: 'gv-day-title' }, day.name),
        el('div', { class: 'gv-day-sub' }, WEEKDAY_LABELS[day.weekday] || day.weekday)),
      el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => ctx.startGuided(plan, day) },
        ico('play'), el('span', {}, 'Start'))));
    if (day.notes.length) {
      const prose = day.notes.join(' ').trim();
      if (prose) card.append(el('div', { class: 'gv-day-note' }, prose));
    }
    const ul = el('div', { class: 'gv-day-items' });
    day.items.forEach((it, idx) => {
      ul.append(el('div', { class: 'gv-day-item' },
        el('span', { class: 'gv-day-item-name' }, it.exercise),
        el('span', { class: 'gv-day-item-rx' }, it.sets != null ? `${it.sets} × ${it.target}` : it.target),
        removeItemBtn(ctx, plan, day, idx)));
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
        message: `"${plan.name}" will be moved to the system trash. Logged workouts stay.`,
        onConfirm: async () => { await ctx.io.trash(plan.file); ctx.nav('plans'); ctx.reload(); },
      }).open(),
    }, ico('trash-2'), el('span', {}, 'Delete plan')));
  root.append(foot);
}

function removeItemBtn(ctx, plan, day, idx) {
  const b = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Remove' }, ico('x'));
  b.addEventListener('click', async () => {
    removeItemAt(day, idx);
    await ctx.io.savePlan(plan);
    ctx.reload();
  });
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
      { key: 'weekday', label: 'Weekday', kind: 'dropdown', options: WEEKDAYS.map(w => [w, WEEKDAY_LABELS[w]]), value: 'mon' },
    ],
    submitLabel: 'Add',
    validate: v => (!v.name.trim() ? 'Give the day a name.' : null),
    onSubmit: async v => {
      plan.model.days.push({ name: v.name.trim(), weekday: v.weekday, parts: [], notes: [], items: [] });
      await ctx.io.savePlan(plan);
      ctx.reload();
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
      await ctx.io.savePlan(plan);
      ctx.reload();
    },
  }).open();
}

module.exports = { render };
