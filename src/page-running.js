'use strict';
/* Running — the dedicated page for the trail build.

   Everything here is derived in stats.js like every other figure in this
   app; the page only arranges them. The ladder comes from the running
   plan's FRONTMATTER (`ladder`, `start_date`) rather than being parsed out
   of prose, so "which week am I in" is data, not a guess. */

const { el, ico, fmt, fmtSeconds } = require('./dom');
const { WEEKDAY_LABELS, WEEKDAYS } = require('./constants');
const { todayISO, weekdayKey, fmtShort, startOfWeek, addDays } = require('./dates');
const { distanceInWeek, ladderWeek, exerciseBests, num } = require('./stats');

const isRun = ex => (ex.fm.unit || '') === 'km';

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();
  const plan = ctx.runPlan();
  const runExercises = data.exercises.filter(isRun);

  root.append(el('div', { class: 'gv-toolbar' },
    el('div', { class: 'gv-toolbar-title' }, 'Running'),
    plan ? el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => ctx.nav('plans', { plan: plan.name }) },
      ico('clipboard-list'), el('span', {}, 'Plan')) : ''));

  /* ---- the ladder: which week, what's the target ---- */
  const ladder = (plan && Array.isArray(plan.fm.ladder) ? plan.fm.ladder : []).map(num).filter(v => v !== null);
  const startDate = plan ? (plan.fm.start_date || '') : '';
  const week = ladder.length ? ladderWeek(startDate, today, ladder.length) : null;
  const target = week ? ladder[week - 1] : null;

  const hero = el('div', { class: 'gv-hero' });
  hero.append(el('p', { class: 'gv-kicker' }, `${fmtShort(today)} · ${WEEKDAY_LABELS[weekdayKey(today)]}`));
  if (target !== null) {
    hero.append(el('h2', { class: 'gv-display gv-hero-title' },
      el('span', { class: 'gv-mark' }, `${target} km`)));
    hero.append(el('p', { class: 'gv-hero-sub' },
      `Week ${week} of ${ladder.length} — this week's long run. ` +
      (week > 1 && ladder[week - 1] < ladder[week - 2]
        ? 'A step down on purpose: this is where the adaptation lands.'
        : 'Slow, and walk the climbs.')));
  } else {
    hero.append(el('h2', { class: 'gv-display gv-hero-title' }, el('span', { class: 'gv-mark' }, 'Running')));
    hero.append(el('p', { class: 'gv-hero-sub' }, plan
      ? (startDate ? 'The ladder starts on ' + fmtShort(startDate) + '.' : 'Add a start_date to the running plan to track the ladder.')
      : 'No running plan yet — create one on the Plans page and mark it parallel.'));
  }
  root.append(hero);

  /* ---- this week's runs, straight from the plan ---- */
  if (plan) {
    const weekStart = startOfWeek(today, settings.weekStart);
    const scheduled = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(weekStart, i);
      const wk = weekdayKey(iso);
      for (const d of plan.model.days) if (d.weekday === wk) scheduled.push({ iso, wk, day: d });
    }
    if (scheduled.length) {
      root.append(el('div', { class: 'gv-section-title' }, ico('calendar-days'), el('span', {}, 'This week')));
      const list = el('div', { class: 'gv-card-list' });
      for (const s of scheduled) {
        const done = data.workouts.some(w => (w.fm.date || '').slice(0, 10) === s.iso &&
          (w.rows || []).some(r => num(r.distance_km) !== null));
        const isLong = /long/i.test(s.day.name);
        const rx = isLong && target !== null ? `${target} km` : (s.day.items[0] ? s.day.items[0].target : '');
        const row = el('div', { class: `gv-card gv-runday${s.iso === today ? ' today' : ''}${done ? ' done' : ''}` },
          el('div', { class: 'gv-runday-when' },
            el('div', { class: 'gv-runday-day' }, WEEKDAY_LABELS[s.wk].slice(0, 3)),
            el('div', { class: 'gv-runday-date' }, fmtShort(s.iso))),
          el('div', { class: 'gv-runday-main' },
            el('div', { class: 'gv-runday-name' }, s.day.name),
            el('div', { class: 'gv-runday-rx' }, rx || '')),
          done
            ? el('span', { class: 'gv-badge' }, 'done')
            : el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => ctx.startLog(plan, s.day) },
                ico('play'), el('span', {}, 'Log')));
        list.append(row);
      }
      root.append(list);
    }
  }

  /* ---- volume ---- */
  const thisWeekKm = distanceInWeek(data.workouts, today, settings.weekStart);
  const lastWeekKm = distanceInWeek(data.workouts, addDays(startOfWeek(today, settings.weekStart), -1), settings.weekStart);
  let longest = null, total = 0, lastRun = null;
  for (const ex of runExercises) {
    const b = exerciseBests(data.workouts, ex.name);
    if (b.distance !== null && (longest === null || b.distance > longest)) longest = b.distance;
    total += b.totalDistance || 0;
    if (b.lastDate && (!lastRun || b.lastDate > lastRun)) lastRun = b.lastDate;
  }
  root.append(el('div', { class: 'gv-tiles' },
    tile(ico('footprints'), fmt(thisWeekKm, ' km'), 'this week'),
    tile(ico('chart-line'), fmt(lastWeekKm, ' km'), 'last week'),
    tile(ico('trophy'), fmt(longest, ' km'), 'longest run'),
    tile(ico('history'), lastRun ? fmtShort(lastRun) : '—', 'last run')));

  /* ---- the ladder strip ---- */
  if (ladder.length) {
    root.append(el('div', { class: 'gv-section-title' }, ico('target'), el('span', {}, 'The ladder')));
    const strip = el('div', { class: 'gv-ladder', role: 'img', 'aria-label': `Long-run ladder, week ${week || 0} of ${ladder.length}` });
    ladder.forEach((km, i) => {
      const n = i + 1;
      const cls = week === null ? '' : n < week ? ' past' : n === week ? ' now' : '';
      strip.append(el('div', { class: `gv-rung${cls}` },
        el('div', { class: 'gv-rung-km' }, String(km)),
        el('div', { class: 'gv-rung-wk' }, `w${n}`)));
    });
    root.append(strip);
    root.append(el('p', { class: 'gv-dim gv-ladder-note' },
      'Kilometres for the weekend long run. Repeat a week whenever it felt hard — the ladder is a guide, not a contract.'));
  }

  /* ---- recent runs ---- */
  const recent = [];
  for (let i = data.workouts.length - 1; i >= 0 && recent.length < 6; i--) {
    const w = data.workouts[i];
    const rows = (w.rows || []).filter(r => num(r.distance_km) !== null);
    if (!rows.length) continue;
    const km = Math.round(rows.reduce((n, r) => n + num(r.distance_km), 0) * 10) / 10;
    const secs = rows.reduce((n, r) => n + (num(r.seconds) || 0), 0);
    recent.push({ date: w.fm.date, name: rows[0].exercise, km, secs, file: w.file });
  }
  if (recent.length) {
    root.append(el('div', { class: 'gv-section-title' }, ico('history'), el('span', {}, 'Recent runs')));
    const list = el('div', { class: 'gv-card-list' });
    for (const r of recent) {
      list.append(el('div', { class: 'gv-card gv-runday' },
        el('div', { class: 'gv-runday-when' },
          el('div', { class: 'gv-runday-day' }, `${r.km}`),
          el('div', { class: 'gv-runday-date' }, 'km')),
        el('div', { class: 'gv-runday-main' },
          el('div', { class: 'gv-runday-name' }, r.name),
          el('div', { class: 'gv-runday-rx' },
            `${fmtShort(r.date)}${r.secs ? ' · ' + fmtSeconds(r.secs) : ''}${r.secs && r.km ? ' · ' + pace(r.secs, r.km) : ''}`))));
    }
    root.append(list);
  } else {
    root.append(el('div', { class: 'gv-empty-line' }, 'No runs logged yet — the first one starts the trend.'));
  }
}

/* Pace for ONE run, from that run's own distance and time — never from a
   longest-distance / longest-time pair, which can be different runs. */
function pace(seconds, km) {
  if (!seconds || !km) return '';
  const s = Math.round(seconds / km);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

module.exports = { render };
