'use strict';
/* Exercise library — searchable, filterable, with per-exercise bests. */

const { el, ico, fmtSeconds, clickableCard } = require('./dom');
const { EXERCISE_TYPES, MUSCLE_GROUPS } = require('./constants');
const { exerciseBests } = require('./stats');
const { equipmentTokens, labelFor } = require('./equipment');
const { FormModal, ConfirmModal } = require('./modals');

function render(ctx, root) {
  const { data } = ctx;
  const ui = ctx.state.exercisesUi || (ctx.state.exercisesUi = { q: '', muscle: '' });

  const bar = el('div', { class: 'gv-toolbar' });
  const title = el('h2', { class: 'gv-toolbar-title' }, 'Exercises');
  const search = el('input', {
    class: 'gv-search', type: 'search', placeholder: 'Search exercises…', value: ui.q, 'aria-label': 'Search exercises',
    oninput: e => { ui.q = e.target.value; renderList(); },
  });
  const addBtn = el('button', { class: 'gv-btn', type: 'button', onclick: () => openAdd(ctx) },
    ico('plus'), el('span', {}, 'Exercise'));
  bar.append(title, search, addBtn);
  root.append(bar);

  /* Two notes sharing a basename are genuinely ambiguous and only the user
     can resolve it: plans, goals and logged rows all reference an exercise
     BY NAME, so "Bench" in a plan cannot be pointed at one of two files.
     Each note is now reachable from its own card (nav carries the path), but
     the clash still has to be said out loud rather than silently picking the
     first match — which is what it used to do. */
  if (data.duplicateExercises && data.duplicateExercises.length) {
    const paths = data.duplicateExercises;
    root.append(el('div', { class: 'gv-warn-line' },
      ico('triangle-alert'),
      el('span', {}, `${paths.length === 1 ? '1 exercise shares' : `${paths.length} exercises share`} a name with another note `
        + `(${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''}). `
        + 'Plans and goals reference exercises by name, so rename one to be sure which is used.')));
  }

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

  const listWrap = el('div', { class: 'gv-card-list gv-ex-list' });
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
    items.forEach((ex, i) => listWrap.append(card(ctx, ex, i)));
  };
  renderList();
}

function listOf(v) { return Array.isArray(v) ? v : v ? [v] : []; }

function card(ctx, ex, idx) {
  const bests = exerciseBests(ctx.data.workouts, ex.name);
  /* One number in the lime block: the best in the exercise's own unit. */
  const unit = ex.fm.unit || 'reps';
  const best = unit === 'seconds' ? (bests.seconds !== null ? fmtSeconds(bests.seconds) : null)
    : unit === 'kg' ? (bests.weight !== null ? `${bests.weight}kg` : null)
    : unit === 'km' ? (bests.distance !== null ? `${bests.distance}km` : null)
    : (bests.reps !== null ? String(bests.reps) : null);
  /* Labelled tokens, not the raw field: a YAML list printed itself as
     "bar,bench" and a comma string went out unsplit and unlabelled. */
  const kit = equipmentTokens(ex.fm.equipment).map(labelFor).join(', ');
  const meta = [ex.fm.type || 'strength', listOf(ex.fm.muscles).join(', '), kit]
    .filter(Boolean).join(' · ');
  const c = clickableCard(
    { class: 'gv-ex-card', 'aria-label': `Open ${ex.name}` },
    /* Carry the PATH as well as the name. readNotesIn walks subfolders, so
       two notes can share a basename; name alone always resolved to the
       first and left the other permanently unreachable. */
    () => ctx.nav('exercise', { exercise: ex.name, path: ex.file.path }),
    el('span', { class: 'gv-ex-idx' }, String(idx + 1).padStart(2, '0')),
    el('div', { class: 'gv-ex-main' },
      el('span', { class: 'gv-ex-name' }, ex.name),
      el('span', { class: 'gv-ex-meta' }, meta)),
    el('div', { class: 'gv-card-actions' },
      best !== null ? el('span', { class: 'gv-ex-best' }, best) : '',
      iconBtn('pencil', 'Edit', () => openEdit(ctx, ex)),
      iconBtn('trash-2', 'Delete', () => new ConfirmModal(ctx.app, {
        title: 'Delete exercise?',
        message: `"${ex.name}" will be deleted, following your Obsidian "Deleted files" setting. Logged history keeps its rows.`,
        onConfirm: async () => { await ctx.io.trash(ex.file); ctx.reload(); },
      }).open())));
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
    { key: 'equipment', label: 'Equipment', kind: 'text', value: listOf(fm && fm.equipment).join(', '), placeholder: 'bar, dumbbells, bodyweight', desc: 'Comma-separated' },
    { key: 'unit', label: 'Tracked as', kind: 'dropdown', options: [['reps', 'reps'], ['kg', 'weight (kg)'], ['seconds', 'seconds'], ['km', 'distance (km)']], value: (fm && fm.unit) || 'reps' },
    { key: 'image', label: 'Images', kind: 'text', value: listOf(fm && fm.image).join(', '), placeholder: 'vault path or https URL', desc: 'Comma-separate two (start, finish) to show the movement' },
    { key: 'video', label: 'Video', kind: 'text', value: (fm && fm.video) || '', placeholder: 'vault path or https URL' },
  ];
}

const parseMuscles = s => (s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

/* The Equipment box invites a list ("bar, dumbbells") and equipment.js reads
   one. Written back as a plain STRING when there is a single value, so an
   ordinary `equipment: bar` note is never churned into `equipment: [bar]`
   just because someone renamed the exercise; a list only when it is one.
   Case is preserved here — equipment.js lowercases its own keys, and free
   text like "Treadmill or road" is the author's wording. */
const parseEquipment = s => {
  const parts = (s || '').split(',').map(x => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : (parts[0] || '');
};

/* Comma-separated field → single string or list (two = start/finish pair). */
const parseImages = s => {
  const list = (s || '').split(',').map(x => x.trim()).filter(Boolean);
  return list.length > 1 ? list : (list[0] || '');
};

function openAdd(ctx) {
  new FormModal(ctx.app, {
    title: 'New exercise',
    fields: exerciseFields(null, ''),
    submitLabel: 'Add',
    validate: v => (!v.name.trim() ? 'Give it a name.' : null),
    onSubmit: async v => {
      const created = await ctx.io.createExercise({
        name: v.name.trim(), type: v.type, muscles: parseMuscles(v.muscles), equipment: parseEquipment(v.equipment), unit: v.unit,
        image: parseImages(v.image), video: v.video.trim(),
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
      ex.fm = {
        ...ex.fm, type: v.type, muscles: parseMuscles(v.muscles), equipment: parseEquipment(v.equipment), unit: v.unit,
        image: parseImages(v.image), video: v.video.trim(),
      };
      await ctx.io.saveExercise(ex);
      ctx.reload();
    },
  }).open();
}

module.exports = { render, editExercise: openEdit };
