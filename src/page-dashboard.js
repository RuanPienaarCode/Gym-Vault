'use strict';
/* Dashboard — "what's to do today". */

const { el, ico, fmt, fmtSeconds } = require('./dom');
const { WEEKDAYS, WEEKDAY_LABELS } = require('./constants');
const { todayISO, weekdayKey, startOfWeek, addDays, fmtShort } = require('./dates');
const { workoutDates, weekStreak, countInWeek, goalCurrent, goalProgress, sessionSets } = require('./stats');

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();
  const dates = workoutDates(data.workouts);
  const plan = ctx.activePlan();
  const todayKeyName = weekdayKey(today);
  const todays = plan ? plan.model.days.filter(d => d.weekday === todayKeyName) : [];
  const doneToday = dates.includes(today);

  /* Hero — today's session or rest day. */
  const hero = el('div', { class: 'gv-hero' });
  const heroHead = el('div', { class: 'gv-hero-date' }, `${WEEKDAY_LABELS[todayKeyName]} · ${fmtShort(today)}`);
  hero.append(heroHead);

  if (todays.length) {
    const day = todays[0];
    hero.append(el('div', { class: 'gv-hero-title' }, day.name));
    hero.append(el('div', { class: 'gv-hero-sub' },
      doneToday ? 'Logged for today — nice work.' : `${day.items.length} exercises on the plan${plan ? ` · ${plan.name}` : ''}`));
    const list = el('div', { class: 'gv-hero-list' });
    for (const it of day.items.slice(0, 6)) {
      list.append(el('span', { class: 'gv-hero-chip' },
        it.exercise + (it.sets != null ? ` · ${it.sets}×${it.target}` : it.target ? ` · ${it.target}` : '')));
    }
    if (day.items.length > 6) list.append(el('span', { class: 'gv-hero-chip' }, `+${day.items.length - 6} more`));
    hero.append(list);
    const btn = el('button', {
      class: 'gv-btn gv-btn-hero', type: 'button',
      onclick: () => ctx.startLog(plan, day),
    }, ico('play'), el('span', {}, doneToday ? 'Log another session' : 'Start workout'));
    hero.append(btn);
  } else {
    hero.append(el('div', { class: 'gv-hero-title' }, 'Rest day'));
    const next = nextPlannedDay(plan, todayKeyName);
    hero.append(el('div', { class: 'gv-hero-sub' },
      next ? `Next up: ${next.day.name} on ${WEEKDAY_LABELS[next.weekday]}. Progress lives on rest days.`
           : plan ? 'No days scheduled in the active plan yet.'
                  : 'No active plan — pick one on the Plans page.'));
    const btn = el('button', {
      class: 'gv-btn gv-btn-hero-ghost', type: 'button',
      onclick: () => ctx.startLog(plan, null),
    }, ico('plus'), el('span', {}, 'Log a freestyle session'));
    hero.append(btn);
  }
  root.append(hero);

  /* Week strip. */
  const weekStart = startOfWeek(today, settings.weekStart);
  const strip = el('div', { class: 'gv-week' });
  for (let i = 0; i < 7; i++) {
    const iso = addDays(weekStart, i);
    const wk = weekdayKey(iso);
    const planned = plan ? plan.model.days.some(d => d.weekday === wk) : false;
    const done = dates.includes(iso);
    const cls = ['gv-day', done ? 'done' : planned ? 'planned' : 'rest', iso === today ? 'today' : ''].join(' ');
    strip.append(el('div', { class: cls },
      el('div', { class: 'gv-day-name' }, wk.toUpperCase()),
      el('div', { class: 'gv-day-dot' }, done ? ico('check') : planned ? '·' : '—')));
  }
  root.append(strip);

  /* Stat tiles. */
  const streak = weekStreak(dates, settings.weekStart, today);
  const thisWeek = countInWeek(dates, today, settings.weekStart);
  const last = data.workouts.length ? data.workouts[data.workouts.length - 1] : null;
  const tiles = el('div', { class: 'gv-tiles' },
    tile(ico('flame'), fmt(streak), streak === 1 ? 'week streak' : 'week streak'),
    tile(ico('calendar-days'), fmt(thisWeek), 'this week'),
    tile(ico('dumbbell'), fmt(dates.length), 'total sessions'),
    tile(ico('history'), last && last.fm.date ? fmtShort(last.fm.date) : '—', last ? `last · ${sessionSets(last.rows)} sets` : 'last session'),
  );
  root.append(tiles);

  /* Goal snapshot — top goals by nearest-to-done that aren't finished. */
  if (data.goals.length) {
    root.append(el('div', { class: 'gv-section-title' }, ico('target'), el('span', {}, 'Goals in flight')));
    const ranked = data.goals
      .map(g => {
        const current = goalCurrent(g, { workouts: data.workouts, body: data.body, weekStart: settings.weekStart, today });
        return { g, current, p: goalProgress(g, current) };
      })
      .filter(x => x.p === null || x.p < 1)
      .sort((a, b) => (b.p ?? -1) - (a.p ?? -1))
      .slice(0, 4);
    const wrap = el('div', { class: 'gv-goal-mini-list' });
    for (const { g, current, p } of ranked) {
      const isDur = g.fm.metric === 'exercise-duration';
      const cur = isDur ? fmtSeconds(current) : fmt(current);
      const tgt = isDur ? fmtSeconds(g.fm.target) : fmt(g.fm.target);
      const row = el('div', { class: 'gv-goal-mini', onclick: () => ctx.nav('goals') },
        el('div', { class: 'gv-goal-mini-head' },
          el('span', { class: 'gv-goal-mini-name' }, g.name),
          el('span', { class: 'gv-goal-mini-nums' }, `${cur} / ${tgt}`)),
        el('div', { class: 'gv-bar' }, el('div', { class: 'gv-bar-fill', style: `width:${Math.round((p || 0) * 100)}%` })));
      wrap.append(row);
    }
    if (!ranked.length) wrap.append(el('div', { class: 'gv-empty-line' }, 'All goals hit — set a new one!'));
    root.append(wrap);
  }
}

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

/* The next weekday (searching forward from tomorrow) with a planned day. */
function nextPlannedDay(plan, todayKeyName) {
  if (!plan) return null;
  const start = WEEKDAYS.indexOf(todayKeyName);
  for (let i = 1; i <= 7; i++) {
    const wk = WEEKDAYS[(start + i) % 7];
    const day = plan.model.days.find(d => d.weekday === wk);
    if (day) return { weekday: wk, day };
  }
  return null;
}

module.exports = { render };
