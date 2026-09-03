'use strict';
/* Dashboard — "what's to do today". Editorial masthead on paper; the ONE
   lime flood on this screen is the action slab, and it holds nothing but
   the session stats and the start button (design/06-editorial-floor.html). */

const { el, ico, fmt, fmtSeconds, clickableCard } = require('./dom');
const { WEEKDAYS, WEEKDAY_LABELS } = require('./constants');
const { todayISO, weekdayKey, startOfWeek, addDays, fmtShort } = require('./dates');
const { workoutDates, weekStreak, sessionCount, sessionsInWeek, goalCurrent, goalProgress, sessionSets } = require('./stats');
const { streakFlame } = require('./streak-flame');
const { itemSets, isRestDay } = require('./plan-parse');
const { equipmentFor } = require('./equipment');
const { PlanPickerModal } = require('./modals');

/* The kit today's session needs, as chips under the prescription. Nothing
   when it's all bodyweight — "No equipment" is worth saying on the setup
   screen you're about to act on, but it is clutter on a dashboard. */
function kitChips(ctx, day) {
  const kit = equipmentFor(ctx.data.exercises, ((day && day.items) || []).map(it => it.exercise));
  if (!kit.length) return null;
  return el('div', { class: 'gv-chips gv-today-kit' },
    el('span', { class: 'gv-kicker gv-today-kit-label' }, 'Bring'),
    ...kit.map(item => el('span', { class: 'gv-tag' }, item.label)));
}

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();
  const dates = workoutDates(data.workouts);
  const plan = ctx.activePlan();
  const todayKeyName = weekdayKey(today);
  /* Strength AND running: daysOn merges the active plan with every
     parallel one, so a run day shows up beside the lifting. */
  const todays = ctx.daysOn(todayKeyName);
  const doneToday = dates.includes(today);
  const last = data.workouts.length ? data.workouts[data.workouts.length - 1] : null;

  /* Masthead + action slab. */
  const hero = el('div', { class: 'gv-hero' });
  /* The plan name is the switcher — swapping programme is a thing you do
     from the day you are looking at, not by hunting through Plans. */
  const kicker = el('p', { class: 'gv-kicker' }, `${fmtShort(today)} · ${WEEKDAY_LABELS[todayKeyName]} · `);
  if (plan) {
    const swap = el('button', { class: 'gv-planswap', type: 'button', 'aria-label': `Active plan: ${plan.name}. Switch plan` },
      el('span', {}, plan.name), ico('repeat-2'));
    swap.addEventListener('click', () => new PlanPickerModal(ctx.app, {
      plans: ctx.mainPlans(),
      extras: [...ctx.parallelPlans(), ...ctx.fallbackPlans()],
      currentName: plan.name,
      onPick: async next => {
        await ctx.io.setActivePlan(ctx.mainPlans(), next);
        ctx.notice(`switched to ${next.name}.`);
        ctx.reload();
      },
    }).open());
    kicker.append(swap);
  }
  hero.append(kicker);

  const restToday = todays.length && isRestDay(todays[0].day);
  if (restToday) {
    const { plan: dayPlan, day } = todays[0];
    hero.append(el('h2', { class: 'gv-display gv-hero-title' }, el('span', { class: 'gv-mark' }, day.name)));
    const prose = (day.notes || []).join(' ').trim();
    hero.append(el('p', { class: 'gv-hero-sub' }, prose || 'Rest is where the adaptation happens.'));
    if (day.items.length) {
      const list = el('ul', { class: 'gv-rx gv-rx-rest' });
      for (const it of day.items) {
        list.append(el('li', {},
          el('span', {}, it.exercise),
          el('b', {}, it.sets != null ? `${it.sets} × ${it.target}` : it.target || '')));
      }
      hero.append(list);
    }
    /* No lime flood and no "Get after it" — the whole point of the day is
       that there is nothing to attack. Logging it stays possible. */
    hero.append(el('button', {
      class: 'gv-btn-hero-ghost', type: 'button',
      onclick: () => ctx.startLog(dayPlan, day),
    }, ico('circle-check'), el('span', {}, 'Log recovery')));
  } else if (todays.length) {
    const { plan: dayPlan, day } = todays[0];
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
    const kit = kitChips(ctx, day);
    if (kit) hero.append(kit);

    const setsTotal = day.items.reduce((n, it) => n + itemSets(it), 0);
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
      onclick: () => ctx.startGuided(dayPlan, day),
    }, doneToday ? 'Log another session' : 'Get after it'));
    hero.append(slab);
    /* Guided is the default path; manual entry (the old direct-to-overview
       behaviour) stays one tap away for anyone who'd rather type it in. */
    hero.append(el('button', {
      class: 'gv-btn-hero-ghost gv-hero-manual', type: 'button',
      onclick: () => ctx.startLog(dayPlan, day),
    }, el('span', {}, 'Log manually')));
  } else {
    hero.append(el('h2', { class: 'gv-display gv-hero-title' }, el('span', { class: 'gv-mark' }, 'Rest day')));
    const next = nextPlannedDay(ctx, todayKeyName);
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

  /* Anything else scheduled today (a run beside the lifting) gets its own
     card rather than being hidden behind the hero's single session. */
  for (const extra of todays.slice(1)) {
    root.append(el('div', { class: 'gv-card gv-alsotoday' },
      el('div', { class: 'gv-alsotoday-main' },
        el('div', { class: 'gv-kicker' }, 'Also today'),
        el('div', { class: 'gv-alsotoday-name' }, extra.day.name),
        el('div', { class: 'gv-alsotoday-plan' }, extra.plan.name)),
      el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => ctx.startGuided(extra.plan, extra.day) },
        ico('play'), el('span', {}, 'Start'))));
  }

  /* Week strip — typographic: big initial, plan-day tag beneath. */
  const weekStart = startOfWeek(today, settings.weekStart);
  const strip = el('div', { class: 'gv-week', role: 'group', 'aria-label': 'This week' });
  for (let i = 0; i < 7; i++) {
    const iso = addDays(weekStart, i);
    const wk = weekdayKey(iso);
    const scheduled = (ctx.daysOn(wk)[0] || {}).day || null;
    const planDay = scheduled && !isRestDay(scheduled) ? scheduled : null;
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
  /* SESSIONS, not training days. These tiles counted unique DATES while
     History and Export counted files, so logging a lift and then a run on
     the same day — "Log another session" is a button on this very screen —
     showed 1 here and 2 there. `dates` is still what the streak and the
     heatmap use, because a streak is genuinely a run of DAYS. */
  const thisWeek = sessionsInWeek(data.workouts, today, settings.weekStart);

  /* The streak comes OUT of the tile grid and becomes a drawing, because it
     is the one figure here whose size means something: a flame that is
     bigger and faster at eleven weeks than at two says the thing the digit
     alone cannot. Every other tile is a reading surface and stays flat —
     two loud treatments on one screen cancel each other out, which is the
     same rule as the one lime flood per screen. */
  /* "weeks in a row" spelled out, because the tile below it counts SESSIONS
     this week and in an ordinary week both figures are 1. Two 1s stacked
     with near-identical labels read as the same number printed twice; the
     labels have to do the work the digits cannot. */
  root.append(streakFlame(streak, { label: streak === 1 ? 'week in a row' : 'weeks in a row' }));

  /* Three tiles in a two-column grid leaves a hole, and an empty cell reads
     as a figure that failed to load. The last-session tile spans instead. */
  const tiles = el('div', { class: 'gv-tiles' },
    tile(ico('calendar-days'), fmt(thisWeek), 'sessions this week'),
    tile(ico('dumbbell'), fmt(sessionCount(data.workouts)), 'sessions all time'),
    tile(ico('history'), last && last.fm.date ? fmtShort(last.fm.date) : '—', last ? `last · ${sessionSets(last.rows)} sets` : 'last session', 'gv-tile-wide'),
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
      wrap.append(clickableCard(
        { class: 'gv-goal-mini', 'aria-label': `${g.name}: ${cur} of ${tgt} — open Goals` },
        () => ctx.nav('goals'),
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

function tile(icon, big, label, extraClass) {
  return el('div', { class: `gv-tile${extraClass ? ` ${extraClass}` : ''}` },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

/* Searches every plan (active + parallel), not just the strength one. */
function nextPlannedDay(ctx, todayKeyName) {
  const start = WEEKDAYS.indexOf(todayKeyName);
  for (let i = 1; i <= 7; i++) {
    const wk = WEEKDAYS[(start + i) % 7];
    const hit = ctx.daysOn(wk)[0];
    if (hit) return { weekday: wk, day: hit.day };
  }
  return null;
}

module.exports = { render };
