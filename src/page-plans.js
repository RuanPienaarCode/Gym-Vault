'use strict';
/* Plans — list, detail, and structural edits (add day / add exercise line).
   The plan note stays the source of truth: heavier editing is one tap away
   via "Open note", and everything written here round-trips through
   plan-parse so hand-written coaching cues survive. */

const { el, ico, prose, clickableCard, backButton } = require('./dom');
const { WEEKDAYS, WEEKDAY_LABELS } = require('./constants');
const { addItem, removeItemAt, moveItem, updateItem, isRestDay } = require('./plan-parse');
const { equipmentFor, equipmentKeys, equipmentSummary, planExerciseNames, labelFor } = require('./equipment');
const { MUSCLE_GROUPS } = require('./constants');
const { FormModal, ConfirmModal } = require('./modals');
const { todayISO, weekdayKey } = require('./dates');

function render(ctx, root) {
  const { data } = ctx;
  const openName = ctx.state.params && ctx.state.params.plan;
  const open = data.plans.find(p => p.name === openName);
  if (open) return renderDetail(ctx, root, open);

  const bar = el('div', { class: 'gv-toolbar' },
    el('h2', { class: 'gv-toolbar-title' }, 'Training plans'),
    el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => ctx.nav('browse') },
      ico('search'), el('span', {}, 'Browse')),
    el('button', { class: 'gv-btn', type: 'button', onclick: () => openAddPlan(ctx) }, ico('plus'), el('span', {}, 'Plan')));
  root.append(bar);

  if (!data.plans.length) {
    root.append(el('div', { class: 'gv-empty-line' }, 'No plans yet — create one, or run setup from Settings.'));
    return;
  }

  /* Two filters: what you need to own, and what it works.

     Both are DERIVED from the plan's exercises rather than stored on the
     plan — an exercise note is the only place equipment and muscles live,
     and a copy on the plan would be a second answer that goes stale the
     moment a note is edited. Same chip pattern, and the same "only offer
     values actually in use" rule, as the exercise library: a vault with
     three plans must not render fourteen dead chips. */
  const ui = ctx.state.plansListUi || (ctx.state.plansListUi = { kit: '', focus: '' });
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
  if (usedKit.size > 1) root.append(facetChips(ctx, 'Equipment', [...usedKit], k => labelFor(k), () => ui.kit, v => { ui.kit = v; }));
  if (usedFocus.size > 1) {
    root.append(facetChips(ctx, 'Focus', MUSCLE_GROUPS.filter(m => usedFocus.has(m)), m => m, () => ui.focus, v => { ui.focus = v; }));
  }

  const shown = data.plans.filter(matches);
  if (!shown.length) {
    root.append(el('div', { class: 'gv-empty-line' }, 'No plan matches both filters — clear one to widen the search.'));
    return;
  }

  const list = el('div', { class: 'gv-card-list' });
  for (const p of shown) {
    const active = String(p.fm.active) === 'true';
    const days = p.model.days;
    const c = clickableCard(
      { class: `gv-card gv-plan-card${active ? ' active' : ''}`, 'aria-label': `Open ${p.name}` },
      () => ctx.nav('plans', { plan: p.name }),
      el('div', { class: 'gv-plan-main' },
        el('div', { class: 'gv-plan-name' },
          el('span', {}, p.name),
          active ? el('span', { class: 'gv-badge' }, 'active') : ''),
        el('div', { class: 'gv-plan-meta' },
          `${days.length} day${days.length === 1 ? '' : 's'} / week · ${days.reduce((n, d) => n + d.items.length, 0)} exercises`),
        /* What the whole plan asks you to own, so you can tell at a glance
           whether it fits the kit you actually have. */
        el('div', { class: 'gv-plan-kit' }, ico('dumbbell'),
          el('span', {}, equipmentSummary(data.exercises, planExerciseNames(p)))),
        el('div', { class: 'gv-plan-days' },
          ...days.map(d => el('span', { class: 'gv-tag' }, `${d.weekday} · ${d.name}`)))),
      el('div', { class: 'gv-card-actions' }, ico('chevron-right', 'gv-dim')));
    list.append(c);
  }
  root.append(list);
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

function renderDetail(ctx, root, plan) {
  const active = String(plan.fm.active) === 'true';

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
  const actions = el('div', { class: 'gv-toolbar-actions' });
  if (!active) {
    actions.append(el('button', {
      class: 'gv-btn gv-btn-ghost', type: 'button',
      onclick: async () => { await ctx.io.setActivePlan(ctx.data.plans, plan); ctx.reload(); },
    }, ico('circle-check'), el('span', {}, 'Make active')));
  } else {
    actions.append(el('span', { class: 'gv-badge' }, 'active'));
  }
  /* EDIT MODE is a view state, not a draft. Every change writes to the note
     the moment it is made — there is no Save button and nothing accumulates
     unsaved, because a half-finished plan edit lost to a vault sync would be
     worse than an extra write. The toggle only changes what controls are on
     screen. */
  const editing = !!(ctx.state.plansUi && ctx.state.plansUi.editing);
  actions.append(el('button', {
    class: `gv-btn ${editing ? '' : 'gv-btn-ghost'}`, type: 'button',
    'aria-pressed': editing ? 'true' : 'false',
    onclick: () => {
      ctx.state.plansUi = { editing: !editing };
      ctx.rerender();
    },
  }, ico(editing ? 'check' : 'pencil'), el('span', {}, editing ? 'Done' : 'Edit')));
  actions.append(el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => ctx.openFile(plan.file) },
    ico('file-text'), el('span', {}, 'Open note')));
  bar.append(actions);
  root.append(bar);

  if (plan.model.intro.length) {
    /* First paragraph only until asked — a plan's rationale is worth having
       but should not be the first wall you meet. */
    root.append(prose(plan.model.intro, { class: 'gv-plan-intro', preview: 1 }));
  }

  /* THIS PAGE IS A READING DOCUMENT (Editorial Floor). It is coaching prose,
     day lists and equipment tags — so it gets ONE acting flood, not one per
     day. Every day card used to carry a solid Start, which made a six-day
     plan six acting blocks and left nothing for the eye to land on.

     The one flood is today's day, if the plan has one. On a rest day, or
     when today is not on this plan, every Start goes ghost and NO flood is
     invented: Today already owns the primary training CTA, and a second one
     here would be competing with it from a page you came to read.

     Start stays on every day either way — starting a specific day from the
     plan is a real action, and this is a change of register, not of
     function. */
  const todayKey = weekdayKey(todayISO());
  const todaysDay = plan.model.days.find(d => d.weekday === todayKey && !isRestDay(d)) || null;

  for (const day of plan.model.days) {
    const card = el('div', { class: 'gv-card gv-day-card' });
    const isToday = day === todaysDay;
    card.append(el('div', { class: 'gv-day-head' },
      el('div', {},
        el('div', { class: 'gv-day-title' }, day.name),
        el('div', { class: 'gv-day-sub' }, WEEKDAY_LABELS[day.weekday] || day.weekday)),
      el('button', {
        class: `gv-btn gv-btn-small${isToday ? '' : ' gv-btn-ghost'}`,
        type: 'button',
        onclick: () => ctx.startGuided(plan, day),
      }, ico('play'), el('span', {}, 'Start'))));
    if (day.notes.length) card.append(prose(day.notes, { class: 'gv-day-note', preview: 1 }));
    const kit = equipmentFor(ctx.data.exercises, day.items.map(it => it.exercise));
    if (kit.length) {
      card.append(el('div', { class: 'gv-chips gv-day-kit' },
        ...kit.map(item => el('span', { class: 'gv-tag' }, item.label))));
    }
    const ul = el('div', { class: 'gv-day-items' });
    day.items.forEach((it, idx) => {
      ul.append(editing
        ? editableItem(ctx, plan, day, it, idx)
        : el('div', { class: 'gv-day-item' },
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

/* One exercise line, in edit mode: sets, target, move up, move down, remove.

   THE NAME IS NOT EDITABLE. Plans, goals and every logged row reference an
   exercise BY NAME, so renaming one here would orphan its whole history
   without saying so. Removing and re-adding is the deliberate, visible way
   to change which exercise a line is.

   Writes on `change`, not on every keystroke: `input` would save (and then
   reload the whole plan out from under the field) between "1" and "12". */
function editableItem(ctx, plan, day, it, idx) {
  const save = async () => {
    await ctx.io.savePlan(plan);
    ctx.reload();
  };

  const setsInput = el('input', {
    class: 'gv-set-input gv-edititem-sets', type: 'number', inputmode: 'numeric', min: '1', step: '1',
    value: it.sets == null ? '' : String(it.sets), placeholder: '3',
    'aria-label': `Sets of ${it.exercise}`,
  });
  setsInput.addEventListener('change', () => {
    updateItem(day, idx, { sets: setsInput.value });
    save();
  });

  const targetInput = el('input', {
    class: 'gv-set-input gv-edititem-target', type: 'text',
    value: it.target || '', placeholder: 'reps, 45s, 5 @ 60kg',
    'aria-label': `Prescription for ${it.exercise}`,
  });
  targetInput.addEventListener('change', () => {
    updateItem(day, idx, { target: targetInput.value });
    save();
  });

  const move = delta => async () => {
    const to = moveItem(day, idx, delta);
    if (to === idx) return; // already at the end — nothing was written
    await save();
  };
  const up = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Move ${it.exercise} up` }, ico('chevron-up'));
  up.addEventListener('click', move(-1));
  up.disabled = idx === 0;
  const down = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Move ${it.exercise} down` }, ico('chevron-down'));
  down.addEventListener('click', move(1));
  down.disabled = idx === day.items.length - 1;

  return el('div', { class: 'gv-day-item gv-edititem' },
    el('div', { class: 'gv-edititem-name' }, it.exercise),
    el('div', { class: 'gv-edititem-rx' },
      setsInput,
      el('span', { class: 'gv-set-unit' }, '×'),
      targetInput),
    el('div', { class: 'gv-edititem-actions' }, up, down, removeItemBtn(ctx, plan, day, idx)));
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
