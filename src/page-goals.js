'use strict';
/* Goals — progress toward each target, derived from real logged data. */

const { el, ico, fmt, fmtSeconds, ring } = require('./dom');
const { GOAL_METRICS } = require('./constants');
const { goalCurrent, goalIssue, goalProgress } = require('./stats');
const { todayISO, daysBetween, fmtShort } = require('./dates');
const { FormModal, ConfirmModal } = require('./modals');

const METRIC_LABELS = {
  'exercise-reps': 'Best reps in a set',
  'exercise-duration': 'Best hold (seconds)',
  'exercise-weight': 'Heaviest weight (kg)',
  'exercise-distance': 'Longest single run (km)',
  'body-weight': 'Body weight (kg)',
  'workouts-per-week': 'Workouts per week',
};

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();

  const bar = el('div', { class: 'gv-toolbar' },
    el('h2', { class: 'gv-toolbar-title' }, 'Goals'),
    el('button', { class: 'gv-btn', type: 'button', onclick: () => openAdd(ctx) }, ico('plus'), el('span', {}, 'Goal')));
  root.append(bar);

  if (!data.goals.length) {
    root.append(el('div', { class: 'gv-empty-line' }, 'No goals yet — name the thing you\'re training for.'));
    return;
  }

  const ctxStats = { workouts: data.workouts, body: data.body, weekStart: settings.weekStart, today };
  const list = el('div', { class: 'gv-goal-grid' });
  const scored = data.goals.map(g => {
    const current = goalCurrent(g, ctxStats);
    /* "No data yet" and "this goal points at an exercise that doesn't exist"
       rendered identically, so a typo'd exercise name told the user to go log
       a workout — blaming them for the plugin's silence. */
    const issue = goalIssue(g, { ...ctxStats, exerciseNames: ctx.data.exercises.map(e => e.name) });
    return { g, current, p: goalProgress(g, current) };
  }).sort((a, b) => (b.p ?? -1) - (a.p ?? -1));

  for (const { g, current, p } of scored) {
    const isDur = g.fm.metric === 'exercise-duration';
    const done = p !== null && p >= 1;
    const cur = isDur ? fmtSeconds(current) : fmt(current);
    const tgt = isDur ? fmtSeconds(g.fm.target) : fmt(g.fm.target);
    const dl = g.fm.deadline;
    const dLeft = dl ? daysBetween(today, dl) : null;

    const card = el('div', { class: `gv-card gv-goal-card${done ? ' done' : ''}` },
      el('div', { class: 'gv-goal-ring' }, done ? ico('trophy', 'gv-trophy') : ring(p ?? 0, 64, `${g.name} progress`)),
      el('div', { class: 'gv-goal-main' },
        el('div', { class: 'gv-goal-name' }, g.name),
        el('div', { class: 'gv-goal-metric' },
          `${METRIC_LABELS[g.fm.metric] || g.fm.metric}${g.fm.exercise ? ` · ${g.fm.exercise}` : ''}`),
        el('div', { class: 'gv-goal-nums' },
          el('b', {}, cur), ` of ${tgt}`,
          p === null ? el('span', { class: 'gv-dim' }, issue ? ` — ${issue}` : ' — log a workout to start tracking') : ''),
        dl ? el('div', { class: `gv-goal-deadline${dLeft !== null && dLeft < 0 && !done ? ' over' : ''}` },
          done ? `done · target was ${fmtShort(dl)}`
               : dLeft === null ? '' : dLeft >= 0 ? `${dLeft} days left · ${fmtShort(dl)}` : `${-dLeft} days past ${fmtShort(dl)}`) : ''),
      el('div', { class: 'gv-card-actions' },
        iconBtn('pencil', 'Edit', () => openEdit(ctx, g)),
        iconBtn('trash-2', 'Delete', () => new ConfirmModal(ctx.app, {
          title: 'Delete goal?', message: `"${g.name}" will be deleted, following your Obsidian "Deleted files" setting.`,
          onConfirm: async () => { await ctx.io.trash(g.file); ctx.reload(); },
        }).open())));
    card.addEventListener('click', e => { if (!e.target.closest('button')) ctx.openFile(g.file); });
    list.append(card);
  }
  root.append(list);
}

function iconBtn(name, label, onClick) {
  const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': label }, ico(name));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

function goalFields(ctx, g) {
  const fm = (g && g.fm) || {};
  const exOptions = ctx.data.exercises.map(e => [e.name, e.name]);
  return [
    ...(g ? [] : [{ key: 'name', label: 'Name', kind: 'text', placeholder: 'e.g. 10 Pull-ups' }]),
    { key: 'metric', label: 'Measured by', kind: 'dropdown', options: GOAL_METRICS.map(m => [m, METRIC_LABELS[m]]), value: fm.metric || 'exercise-reps' },
    exOptions.length
      ? { key: 'exercise', label: 'Exercise', kind: 'dropdown', options: [['', '—'], ...exOptions], value: fm.exercise || '', desc: 'For the exercise metrics' }
      : { key: 'exercise', label: 'Exercise', kind: 'text', value: fm.exercise || '' },
    { key: 'target', label: 'Target', kind: 'number', value: fm.target ?? '', desc: 'Reps, kg, or seconds — whatever the metric measures' },
    { key: 'start_value', label: 'Starting from (optional)', kind: 'number', value: fm.start_value ?? '' },
    { key: 'direction', label: 'Direction', kind: 'dropdown', options: [['increase', 'Increase'], ['decrease', 'Decrease']], value: fm.direction || 'increase' },
    { key: 'deadline', label: 'Deadline (optional)', kind: 'date', value: fm.deadline || '' },
  ];
}

const validateGoal = v => {
  if (v.name !== undefined && !v.name.trim()) return 'Give it a name.';
  const t = parseFloat(v.target);
  if (!Number.isFinite(t) || t <= 0) return 'Set a target above zero.';
  if (v.metric.startsWith('exercise-') && !String(v.exercise).trim()) return 'Pick the exercise this goal measures.';
  return null;
};

const goalFm = v => ({
  metric: v.metric,
  exercise: v.metric.startsWith('exercise-') ? String(v.exercise).trim() : '',
  target: parseFloat(v.target),
  start_value: String(v.start_value).trim() === '' ? '' : parseFloat(v.start_value),
  direction: v.direction,
  deadline: v.deadline || '',
});

function openAdd(ctx) {
  new FormModal(ctx.app, {
    title: 'New goal',
    fields: goalFields(ctx, null),
    submitLabel: 'Add',
    validate: validateGoal,
    onSubmit: async v => {
      const created = await ctx.io.createGoal({ name: v.name.trim(), fm: goalFm(v) });
      if (!created) ctx.notice('A goal with that name already exists.');
      ctx.reload();
    },
  }).open();
}

function openEdit(ctx, g) {
  new FormModal(ctx.app, {
    title: `Edit ${g.name}`,
    fields: goalFields(ctx, g),
    validate: validateGoal,
    onSubmit: async v => {
      g.fm = { ...g.fm, ...goalFm(v) };
      await ctx.io.saveGoal(g);
      ctx.reload();
    },
  }).open();
}

module.exports = { render };
