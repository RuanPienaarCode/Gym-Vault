'use strict';
/* Exercise library — searchable, filterable, with per-exercise bests. */

const { el, ico, fmt, fmtSeconds } = require('./dom');
const { EXERCISE_TYPES, MUSCLE_GROUPS } = require('./constants');
const { exerciseBests } = require('./stats');
const { fmtShort } = require('./dates');
const { FormModal, ConfirmModal } = require('./modals');

const TYPE_ICON = { strength: 'dumbbell', cardio: 'heart-pulse', mobility: 'ruler', skill: 'medal' };

function render(ctx, root) {
  const { data } = ctx;
  const ui = ctx.state.exercisesUi || (ctx.state.exercisesUi = { q: '', muscle: '' });

  const bar = el('div', { class: 'gv-toolbar' });
  const search = el('input', {
    class: 'gv-search', type: 'search', placeholder: 'Search exercises…', value: ui.q,
    oninput: e => { ui.q = e.target.value; renderList(); },
  });
  const addBtn = el('button', { class: 'gv-btn', type: 'button', onclick: () => openAdd(ctx) },
    ico('plus'), el('span', {}, 'Exercise'));
  bar.append(search, addBtn);
  root.append(bar);

  const chips = el('div', { class: 'gv-chips' });
  const allChip = el('button', { class: `gv-chip${ui.muscle === '' ? ' on' : ''}`, type: 'button' }, 'all');
  allChip.addEventListener('click', () => { ui.muscle = ''; ctx.rerender(); });
  chips.append(allChip);
  const used = new Set();
  for (const ex of data.exercises) for (const m of listOf(ex.fm.muscles)) used.add(m);
  for (const m of MUSCLE_GROUPS.filter(m => used.has(m))) {
    const c = el('button', { class: `gv-chip${ui.muscle === m ? ' on' : ''}`, type: 'button' }, m);
    c.addEventListener('click', () => { ui.muscle = ui.muscle === m ? '' : m; ctx.rerender(); });
    chips.append(c);
  }
  root.append(chips);

  const listWrap = el('div', { class: 'gv-card-list' });
  root.append(listWrap);

  const renderList = () => {
    while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
    const q = ui.q.trim().toLowerCase();
    const items = data.exercises.filter(ex =>
      (!q || ex.name.toLowerCase().includes(q)) &&
      (!ui.muscle || listOf(ex.fm.muscles).includes(ui.muscle)));
    if (!items.length) {
      listWrap.append(el('div', { class: 'gv-empty-line' }, data.exercises.length ? 'No matches.' : 'No exercises yet — add one.'));
      return;
    }
    for (const ex of items) listWrap.append(card(ctx, ex));
  };
  renderList();
}

function listOf(v) { return Array.isArray(v) ? v : v ? [v] : []; }

function card(ctx, ex) {
  const bests = exerciseBests(ctx.data.workouts, ex.name);
  const unit = ex.fm.unit || 'reps';
  const bestBits = [];
  if (bests.weight !== null) bestBits.push(`best ${bests.weight}kg`);
  if (bests.reps !== null) bestBits.push(`${bests.reps} reps`);
  if (bests.seconds !== null) bestBits.push(fmtSeconds(bests.seconds));
  const c = el('div', { class: 'gv-card gv-ex-card' },
    el('div', { class: 'gv-ex-ico' }, ico(TYPE_ICON[ex.fm.type] || 'dumbbell')),
    el('div', { class: 'gv-ex-main' },
      el('div', { class: 'gv-ex-name' }, ex.name),
      el('div', { class: 'gv-ex-meta' },
        el('span', { class: 'gv-tag gv-tag-type' }, ex.fm.type || 'strength'),
        ...listOf(ex.fm.muscles).map(m => el('span', { class: 'gv-tag' }, m))),
      el('div', { class: 'gv-ex-best' },
        bestBits.length ? `${bestBits.join(' · ')}${bests.lastDate ? ` · last ${fmtShort(bests.lastDate)}` : ''}` : 'not logged yet')),
    el('div', { class: 'gv-card-actions' },
      iconBtn('pencil', 'Edit', () => openEdit(ctx, ex)),
      iconBtn('trash-2', 'Delete', () => new ConfirmModal(ctx.app, {
        title: 'Delete exercise?',
        message: `"${ex.name}" will be moved to the system trash. Logged history keeps its rows.`,
        onConfirm: async () => { await ctx.io.trash(ex.file); ctx.reload(); },
      }).open())));
  c.addEventListener('click', e => { if (!e.target.closest('button')) ctx.openFile(ex.file); });
  return c;
}

function iconBtn(name, label, onClick) {
  const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': label }, ico(name));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

function exerciseFields(fm, name) {
  return [
    { key: 'name', label: 'Name', kind: 'text', value: name || '', placeholder: 'e.g. Pull-ups' },
    { key: 'type', label: 'Type', kind: 'dropdown', options: EXERCISE_TYPES.map(t => [t, t]), value: (fm && fm.type) || 'strength' },
    { key: 'muscles', label: 'Muscles', kind: 'text', value: listOf(fm && fm.muscles).join(', '), placeholder: 'back, biceps', desc: 'Comma-separated' },
    { key: 'equipment', label: 'Equipment', kind: 'text', value: (fm && fm.equipment) || '', placeholder: 'bar, dumbbells, bodyweight' },
    { key: 'unit', label: 'Tracked as', kind: 'dropdown', options: [['reps', 'reps'], ['kg', 'weight (kg)'], ['seconds', 'seconds']], value: (fm && fm.unit) || 'reps' },
  ];
}

const parseMuscles = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

function openAdd(ctx) {
  new FormModal(ctx.app, {
    title: 'New exercise',
    fields: exerciseFields(null, ''),
    submitLabel: 'Add',
    validate: v => (!v.name.trim() ? 'Give it a name.' : null),
    onSubmit: async v => {
      const created = await ctx.io.createExercise({
        name: v.name.trim(), type: v.type, muscles: parseMuscles(v.muscles), equipment: v.equipment.trim(), unit: v.unit,
      });
      if (!created) ctx.notice('An exercise with that name already exists.');
      ctx.reload();
    },
  }).open();
}

function openEdit(ctx, ex) {
  new FormModal(ctx.app, {
    title: `Edit ${ex.name}`,
    fields: exerciseFields(ex.fm, ex.name).filter(f => f.key !== 'name'), // rename = rename the note, like every entity here
    onSubmit: async v => {
      ex.fm = { ...ex.fm, type: v.type, muscles: parseMuscles(v.muscles), equipment: v.equipment.trim(), unit: v.unit };
      await ctx.io.saveExercise(ex);
      ctx.reload();
    },
  }).open();
}

module.exports = { render };
