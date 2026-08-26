'use strict';
/* Workout logging — the live session screen. The draft lives in memory on
   ctx.state.logDraft and nothing touches disk until Finish, so backing out
   never leaves a half-written session note. */

const { el, ico, fmtSeconds } = require('./dom');
const { todayISO } = require('./dates');
const { targetFirstNumber, targetWeight, targetIsDuration } = require('./plan-parse');
const { FormModal, ConfirmModal } = require('./modals');

function startDraft(ctx, plan, day) {
  const entries = [];
  if (day) for (const it of day.items) entries.push(makeEntry(ctx, it.exercise, it.sets || 3, it.target));
  ctx.state.logDraft = {
    date: todayISO(),
    plan: plan ? plan.name : '',
    day: day ? day.name : '',
    startedAt: Date.now(),
    entries,
  };
}

function makeEntry(ctx, exercise, sets, target) {
  const ex = ctx.data.exercises.find(e => e.name.toLowerCase() === exercise.toLowerCase());
  const unit = ex ? ex.fm.unit : null;
  const duration = unit === 'seconds' || (!unit && targetIsDuration(target || ''));
  const weighted = unit === 'kg' || targetWeight(target || '') !== null;
  const prefReps = duration ? '' : (targetFirstNumber(target || '') ?? '');
  const prefSecs = duration ? (targetFirstNumber(target || '') ?? '') : '';
  const prefW = targetWeight(target || '') ?? '';
  return {
    exercise, target: target || '', duration, weighted,
    sets: Array.from({ length: Math.max(1, sets) }, () => ({
      reps: prefReps, weight_kg: prefW, seconds: prefSecs, done: false,
    })),
  };
}

function render(ctx, root) {
  const draft = ctx.state.logDraft;
  if (!draft) { ctx.nav('dashboard'); return; }

  const bar = el('div', { class: 'gv-toolbar' });
  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Discard session' }, ico('arrow-left'));
  back.addEventListener('click', () => new ConfirmModal(ctx.app, {
    title: 'Discard session?', message: 'Nothing has been saved yet.', confirmLabel: 'Discard',
    onConfirm: () => { ctx.state.logDraft = null; ctx.nav('dashboard'); },
  }).open());
  bar.append(back,
    el('div', { class: 'gv-toolbar-title' }, draft.day || 'Freestyle session'),
    el('div', { class: 'gv-log-clock' }, ico('timer'), el('span', { class: 'gv-log-elapsed' }, elapsed(draft))));
  root.append(bar);

  // Tick the elapsed label without re-rendering the whole page (inputs would
  // lose focus). The interval dies with the page via ctx.pageInterval.
  ctx.setPageInterval(() => {
    const s = root.querySelector('.gv-log-elapsed');
    if (s) s.textContent = elapsed(ctx.state.logDraft || draft);
  }, 30000);

  draft.entries.forEach((entry, ei) => root.append(entryCard(ctx, draft, entry, ei)));

  const addEx = el('button', { class: 'gv-add-line', type: 'button', onclick: () => openAddExercise(ctx, draft) },
    ico('plus'), el('span', {}, 'Add exercise'));
  root.append(addEx);

  const finish = el('button', { class: 'gv-btn gv-btn-hero gv-btn-finish', type: 'button', onclick: () => finishSession(ctx, draft) },
    ico('circle-check'), el('span', {}, 'Finish workout'));
  root.append(el('div', { class: 'gv-log-foot' }, finish));
}

function elapsed(draft) {
  const min = Math.max(0, Math.round((Date.now() - draft.startedAt) / 60000));
  return `${min} min`;
}

function entryCard(ctx, draft, entry, ei) {
  const card = el('div', { class: 'gv-card gv-log-card' });
  card.append(el('div', { class: 'gv-log-ex-head' },
    el('div', {},
      el('div', { class: 'gv-log-ex-name' }, entry.exercise),
      entry.target ? el('div', { class: 'gv-log-ex-target' }, `target ${entry.target}`) : ''),
    removeBtn(ctx, draft, ei)));

  const rows = el('div', { class: 'gv-log-sets' });
  entry.sets.forEach((set, si) => rows.append(setRow(ctx, entry, set, si)));
  card.append(rows);

  const addSet = el('button', { class: 'gv-add-line gv-add-set', type: 'button' }, ico('plus'), el('span', {}, 'Set'));
  addSet.addEventListener('click', () => {
    const prev = entry.sets[entry.sets.length - 1] || { reps: '', weight_kg: '', seconds: '' };
    entry.sets.push({ reps: prev.reps, weight_kg: prev.weight_kg, seconds: prev.seconds, done: false });
    ctx.rerender();
  });
  card.append(addSet);
  return card;
}

function setRow(ctx, entry, set, si) {
  const row = el('div', { class: `gv-log-set${set.done ? ' done' : ''}` });
  row.append(el('span', { class: 'gv-set-num' }, String(si + 1)));

  const numInput = (key, placeholder, cls) => {
    const i = el('input', {
      class: `gv-set-input${cls ? ' ' + cls : ''}`, type: 'number', inputmode: 'decimal',
      placeholder, value: set[key] ?? '',
    });
    i.addEventListener('input', () => { set[key] = i.value; });
    return i;
  };

  if (entry.duration) {
    row.append(numInput('seconds', 'sec'), el('span', { class: 'gv-set-unit' }, 's'));
  } else {
    row.append(numInput('reps', 'reps'), el('span', { class: 'gv-set-unit' }, '×'));
    if (entry.weighted) row.append(numInput('weight_kg', 'kg'), el('span', { class: 'gv-set-unit' }, 'kg'));
  }

  const done = el('button', { class: 'gv-set-done', type: 'button', 'aria-label': set.done ? 'Mark not done' : 'Mark done' }, ico('check'));
  done.addEventListener('click', () => { set.done = !set.done; ctx.rerender(); });
  row.append(done);
  return row;
}

function removeBtn(ctx, draft, ei) {
  const b = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Remove exercise' }, ico('x'));
  b.addEventListener('click', () => { draft.entries.splice(ei, 1); ctx.rerender(); });
  return b;
}

function openAddExercise(ctx, draft) {
  const options = ctx.data.exercises.map(e => [e.name, e.name]);
  new FormModal(ctx.app, {
    title: 'Add exercise',
    fields: [
      options.length
        ? { key: 'exercise', label: 'Exercise', kind: 'dropdown', options, value: options[0][0] }
        : { key: 'exercise', label: 'Exercise', kind: 'text', placeholder: 'e.g. Pull-ups' },
      { key: 'sets', label: 'Sets', kind: 'number', value: '3' },
    ],
    submitLabel: 'Add',
    validate: v => (!String(v.exercise).trim() ? 'Pick an exercise.' : null),
    onSubmit: v => {
      const sets = parseInt(v.sets, 10);
      draft.entries.push(makeEntry(ctx, String(v.exercise).trim(), Number.isFinite(sets) && sets > 0 ? sets : 3, ''));
      ctx.rerender();
    },
  }).open();
}

async function finishSession(ctx, draft) {
  /* A set counts when it holds any figure or was ticked done; a prefilled
     value alone doesn't (untouched rows are the sets you skipped). */
  const rows = [];
  for (const entry of draft.entries) {
    let n = 0;
    for (const set of entry.sets) {
      const has = set.done || String(set.reps).trim() || String(set.weight_kg).trim() || String(set.seconds).trim();
      if (!has || !set.done) continue;
      n++;
      rows.push({
        exercise: entry.exercise, set: n,
        reps: entry.duration ? '' : String(set.reps).trim(),
        weight_kg: entry.duration ? '' : String(set.weight_kg).trim(),
        seconds: entry.duration ? String(set.seconds).trim() : '',
        note: '',
      });
    }
  }
  if (!rows.length) { ctx.notice('Tick at least one set as done before finishing.'); return; }
  const duration_min = Math.max(1, Math.round((Date.now() - draft.startedAt) / 60000));
  await ctx.io.saveWorkout({ date: draft.date, plan: draft.plan, day: draft.day, duration_min, rows });
  ctx.state.logDraft = null;
  ctx.notice('Session logged. Strong work.');
  ctx.nav('dashboard');
  ctx.reload();
}

module.exports = { render, startDraft };
