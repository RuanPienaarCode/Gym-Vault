'use strict';
/* Dashboard — "what's to do today". Editorial masthead on paper; the ONE
   lime flood on this screen is the action slab, and it holds nothing but
   the session stats and the start button (design/06-editorial-floor.html). */

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
  const last = data.workouts.length ? data.workouts[data.workouts.length - 1] : null;

  /* Masthead + action slab. */
  const hero = el('div', { class: 'gv-hero' });
  hero.append(el('p', { class: 'gv-kicker' },
    `${fmtShort(today)} · ${WEEKDAY_LABELS[todayKeyName]}${plan ? ` · ${plan.name}` : ''}`));

  if (todays.length) {
    const day = todays[0];
    hero.append(el('h2', { class: 'gv-display gv-hero-title' }, el('span', { class: 'gv-mark' }, day.name)));
    const prose = (day.notes || []).join(' ').trim();
    hero.append(el('p', { class: 'gv-hero-sub' },
      doneToday ? 'Logged for today — nice work.' : prose || `${day.items.length} exercises on the plan.`));

    const rx = el('ul', { class: 'gv-rx' });
    for (const it of day.items) {
      rx.append(el('li', {},
        el('span', {}, it.exercise),
        el('b', {}, it.sets != null ? `${it.sets} × ${it.target}` : it.target || '')));
    }
    hero.append(rx);

    const setsTotal = day.items.reduce((n, it) => n + (it.sets || 3), 0);
    const slab = el('div', { class: 'gv-hero-action' });
    const speed = el('div', { class: 'gv-speed', 'aria-hidden': 'true' },
      el('span', { style: 'top:16%;left:-12%;width:62%' }),
      el('span', { style: 'top:40%;left:28%;width:78%' }),
      el('span', { style: 'top:74%;left:-8%;width:50%' }));
    slab.append(speed);
    slab.append(el('div', { class: 'gv-hero-action-line' },
      el('span', { class: 'gv-shout' }, `${setsTotal} sets · est. ${Math.max(15, Math.round(setsTotal * 1.8 / 5) * 5)} min`),
      el('span', { class: 'gv-shout' },
        last && last.fm.date ? `Last: ${fmtShort(last.fm.date)} · ${sessionSets(last.rows)} sets` : 'First session — make it count')));
    slab.append(el('button', {
      class: 'gv-btn-go', type: 'button',
      onclick: () => ctx.startLog(plan, day),
    }, doneToday ? 'Log another session' : 'Get after it'));
    hero.append(slab);
  } else {
    hero.append(el('h2', { class: 'gv-display gv-hero-title' }, el('span', { class: 'gv-mark' }, 'Rest day')));
    const next = nextPlannedDay(plan, todayKeyName);
    hero.append(el('p', { class: 'gv-hero-sub' },
      next ? `Next up: ${next.day.name} on ${WEEKDAY_LABELS[next.weekday]}. Progress lives on rest days.`
           : plan ? 'No days scheduled in the active plan yet.'
                  : 'No active plan — pick one on the Plans page.'));
    hero.append(el('button', {
      class: 'gv-btn-hero-ghost', type: 'button',
      onclick: () => ctx.startLog(plan, null),
    }, ico('plus'), el('span', {}, 'Log a freestyle session')));
  }
  root.append(hero);

  /* Week strip — typographic: big initial, plan-day tag beneath. */
  const weekStart = startOfWeek(today, settings.weekStart);
  const strip = el('div', { class: 'gv-week', role: 'group', 'aria-label': 'This week' });
  for (let i = 0; i < 7; i++) {
    const iso = addDays(weekStart, i);
    const wk = weekdayKey(iso);
    const planDay = plan ? plan.model.days.find(d => d.weekday === wk) : null;
    const done = dates.includes(iso);
    const cls = ['gv-day', done ? 'done' : planDay ? 'planned' : 'rest', iso === today ? 'today' : ''].join(' ');
    const tag = el('div', { class: 'gv-day-dot' });
    if (done) { if (planDay) tag.append(dayShort(planDay), ' '); tag.append(ico('check')); }
    else tag.append(planDay ? dayShort(planDay) : '—');
    strip.append(el('div', { class: cls },
      el('div', { class: 'gv-day-name' }, WEEKDAY_LABELS[wk][0]),
      tag));
  }
  root.append(strip);

  /* Stats — oversized numerals on the hairline grid. */
  const streak = weekStreak(dates, settings.weekStart, today);
  const thisWeek = countInWeek(dates, today, settings.weekStart);
  const tiles = el('div', { class: 'gv-tiles' },
    tile(ico('flame'), fmt(streak), 'week streak'),
    tile(ico('calendar-days'), fmt(thisWeek), 'this week'),
    tile(ico('dumbbell'), fmt(dates.length), 'total sessions'),
    tile(ico('history'), last && last.fm.date ? fmtShort(last.fm.date) : '—', last ? `last · ${sessionSets(last.rows)} sets` : 'last session'),
  );
  root.append(tiles);

  /* Goal snapshot. */
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
      wrap.append(el('div', { class: 'gv-goal-mini', onclick: () => ctx.nav('goals') },
        el('div', { class: 'gv-goal-mini-head' },
          el('span', { class: 'gv-goal-mini-name' }, g.name),
          el('span', { class: 'gv-goal-mini-nums' }, `${cur} / ${tgt}`)),
        el('div', { class: 'gv-bar' }, el('div', { class: 'gv-bar-fill', style: `width:${Math.round((p || 0) * 100)}%` }))));
    }
    if (!ranked.length) wrap.append(el('div', { class: 'gv-empty-line' }, 'All goals hit — set a new one!'));
    root.append(wrap);
    root.append(el('p', { class: 'gv-microcopy' }, 'No zero days.'));
  }
}

/* "A · Pull Priority" → "A"; "Push + Volume" → "PUS". Short enough for a
   week cell, distinctive enough to tell the days apart. */
function dayShort(day) {
  const first = (day.name || '').trim().split(/[\s·|]+/)[0] || '';
  return first.slice(0, 3).toUpperCase();
}

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

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
