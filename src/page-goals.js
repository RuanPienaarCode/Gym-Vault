'use strict';
/* Goals — progress toward each target, derived from real logged data. */

const { el, ico, fmt, fmtSeconds, ring, clickableCard, emptyLine } = require('./dom');
const { GOAL_METRICS } = require('./constants');
const { goalCurrent, goalIssue, goalProgress, countLabel } = require('./stats');
const { todayISO, daysBetween, fmtShort } = require('./dates');
const { FormModal, ConfirmModal } = require('./modals');
const ch = require('./challenge');
const { openChallenge, openNewChallenge, statusFor } = require('./challenge-flow');

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
    el('div', { class: 'gv-toolbar-actions' },
      el('button', { class: 'gv-btn gv-btn-ghost', type: 'button', onclick: () => openNewChallenge(ctx) }, ico('flame'), el('span', {}, 'Challenge')),
      el('button', { class: 'gv-btn', type: 'button', onclick: () => openAdd(ctx) }, ico('plus'), el('span', {}, 'Goal'))));
  root.append(bar);

  if (!data.goals.length) {
    root.append(emptyLine('No goals yet — name the thing you\'re training for.'));
    return;
  }

  const ctxStats = { workouts: data.workouts, body: data.body, weekStart: settings.weekStart, today };
  const list = el('div', { class: 'gv-goal-grid' });
  const exerciseNames = data.exercises.map(e => e.name);
  const scored = data.goals.map(g => {
    /* stats.goalCurrent applies the claimableKinds gate itself when given the
       exercises (a circuit's clock on a REP exercise is not a hold) - the one
       seam Today, the session's goal check and the export read too. */
    const current = goalCurrent(g, { ...ctxStats, exercises: data.exercises });
    /* "No data yet" and "this goal points at an exercise that doesn't exist"
       rendered identically, so a typo'd exercise name told the user to go log
       a workout — blaming them for the plugin's silence. */
    const issue = goalIssue(g, { ...ctxStats, exerciseNames });
    return { g, current, issue, p: goalProgress(g, current) };
  }).sort((a, b) => (b.p ?? -1) - (a.p ?? -1));

  for (const { g, current, issue, p } of scored) {
    const isDur = g.fm.metric === 'exercise-duration';
    const done = p !== null && p >= 1;
    const cur = isDur ? fmtSeconds(current) : fmt(current);
    const tgt = isDur ? fmtSeconds(g.fm.target) : fmt(g.fm.target);
    const dl = g.fm.deadline;
    const dLeft = dl ? daysBetween(today, dl) : null;

    /* clickableCard, not a div with a click listener: role=button, tabindex 0
       and Enter/Space come with it, and the nested Edit/Delete buttons keep
       firing on their own (the same pattern as the exercise cards). */
    const card = clickableCard(
      { class: `gv-card gv-goal-card${done ? ' done' : ''}`, 'aria-label': `Open goal note: ${g.name}` },
      () => ctx.openFile(g.file),
      el('div', { class: 'gv-goal-ring' }, done ? ico('trophy', 'gv-trophy') : ring(p ?? 0, 64, `${g.name} progress`)),
      el('div', { class: 'gv-goal-main' },
        el('div', { class: 'gv-goal-name' }, g.name),
        el('div', { class: 'gv-goal-metric' },
          `${METRIC_LABELS[g.fm.metric] || g.fm.metric}${g.fm.exercise ? ` · ${g.fm.exercise}` : ''}`),
        el('div', { class: 'gv-goal-nums' },
          el('b', {}, cur), ` of ${tgt}`,
          p === null ? el('span', { class: 'gv-dim' }, issue ? ` — ${issue}` : ' — log a workout to start tracking') : ''),
        ch.isChallenge(g) ? challengeLine(ctx, g) : '',
        dl ? el('div', { class: `gv-goal-deadline${dLeft !== null && dLeft < 0 && !done ? ' over' : ''}` },
          done ? `done · target was ${fmtShort(dl)}`
               : dLeft === null ? '' : dLeft >= 0 ? `${countLabel(dLeft, 'day')} left · ${fmtShort(dl)}` : `${countLabel(-dLeft, 'day')} past ${fmtShort(dl)}`) : ''),
      el('div', { class: 'gv-card-actions' },
        ch.isChallenge(g) ? startBtn(ctx, g) : '',
        iconBtn('pencil', 'Edit', () => openEdit(ctx, g)),
        iconBtn('trash-2', 'Delete', () => new ConfirmModal(ctx.app, {
          title: 'Delete goal?', message: `"${g.name}" will be deleted, following your Obsidian "Deleted files" setting.`,
          onConfirm: async () => { await ctx.io.trash(g.file); ctx.reload(); },
        }).open())));
    list.append(card);
  }
  root.append(list);
}

function iconBtn(name, label, onClick) {
  const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': label }, ico(name));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

/* Where a weekly challenge stands, in one line under the goal's numbers. */
function challengeLine(ctx, g) {
  const s = statusFor(ctx, g);
  const sc = n => ch.fmtScore(n, s.kind);
  const wk = s.weekNo ? `Week ${s.weekNo} · ` : '';
  let text;
  if (s.done) text = `${wk}goal reached — keep beating it`;
  else if (s.testWeek) text = s.thisWeek
    ? `${wk}baseline ${sc(s.thisWeek.best)} — next week beat ${sc(ch.nextTarget(s.thisWeek.best, s.goal))}`
    : `${wk}test week: ${s.kind === 'seconds' ? 'one long hold' : 'one big set'}`;
  else if (s.beaten) text = `${wk}beaten this week — ${sc(s.thisWeek.best)} of ${sc(s.target)}`;
  else text = `${wk}this week beat ${sc(s.target)}${s.thisWeek ? ` · ${sc(s.toGo)} to go` : ''}`;
  return el('div', { class: `gv-goal-challenge${s.beaten || s.done ? ' beaten' : ''}` }, ico(s.beaten || s.done ? 'check' : 'flame'), el('span', {}, text));
}

function startBtn(ctx, g) {
  const b = el('button', { class: 'gv-btn gv-btn-small', type: 'button', 'aria-label': `Start ${g.name}` }, ico('play'), el('span', {}, 'Start'));
  b.addEventListener('click', e => { e.stopPropagation(); openChallenge(ctx, g); });
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
    { key: 'challenge', label: 'Weekly challenge', kind: 'toggle', value: fm.challenge === 'weekly',
      desc: 'Beat your best unbroken set (or hold) every week until you reach the target. Best reps or best hold only.' },
  ];
}

const validateGoal = v => {
  if (v.name !== undefined && !v.name.trim()) return 'Give it a name.';
  const t = parseFloat(v.target);
  if (!Number.isFinite(t) || t <= 0) return 'Set a target above zero.';
  if (v.metric.startsWith('exercise-') && !String(v.exercise).trim()) return 'Pick the exercise this goal measures.';
  if (v.challenge && v.metric !== 'exercise-reps' && v.metric !== 'exercise-duration') return 'A weekly challenge is measured by best reps in a set or best hold.';
  return null;
};

/* `prev` is the goal's frontmatter before the edit ({} for a new goal). The
   challenge keys are only written when the switch is on, or to clear them
   when it is turned off - a plain goal never grows empty challenge keys.
   `started` is kept from the first time it was switched on: turning the
   switch off and on again must not quietly restart the weeks. */
const goalFm = (v, prev) => {
  const p = prev || {};
  const fm = {
    metric: v.metric,
    exercise: v.metric.startsWith('exercise-') ? String(v.exercise).trim() : '',
    target: parseFloat(v.target),
    start_value: String(v.start_value).trim() === '' ? '' : parseFloat(v.start_value),
    direction: v.direction,
    deadline: v.deadline || '',
  };
  if (v.challenge) {
    fm.challenge = 'weekly';
    fm.started = p.started || todayISO();
  } else if (p.challenge) {
    fm.challenge = '';
  }
  return fm;
};

function openAdd(ctx) {
  new FormModal(ctx.app, {
    title: 'New goal',
    fields: goalFields(ctx, null),
    submitLabel: 'Add',
    validate: validateGoal,
    onSubmit: async v => {
      const created = await ctx.io.createGoal({ name: v.name.trim(), fm: goalFm(v, {}) });
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
      g.fm = { ...g.fm, ...goalFm(v, g.fm) };
      await ctx.io.saveGoal(g);
      ctx.reload();
    },
  }).open();
}

module.exports = { render };
