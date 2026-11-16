'use strict';
/* Running — the dedicated page for the trail build.

   Everything here is derived in stats.js like every other figure in this
   app; the page only arranges them. The ladder comes from the running
   plan's FRONTMATTER (`ladder`, `start_date`) rather than being parsed out
   of prose, so "which week am I in" is data, not a guess. */

const { el, ico, fmt, fmtSeconds, statTile, emptyLine } = require('./dom');
const { WEEKDAY_LABELS, WEEKDAYS } = require('./constants');
const { todayISO, weekdayKey, fmtShort, startOfWeek, addDays } = require('./dates');
const { distanceInWeek, ladderWeek, num, ranOn, workoutDate } = require('./stats');
const { runRows, longestRun, paceOf, fmtPace } = require('./run-records');
const { isPaused } = require('./plan-parse');

/* THE ONE RULE FOR "WHICH LONG RUN IS THIS WEEK'S". The plan's days that fall in
   the calendar week containing `today`, the week drawn the way Settings draws it,
   each with `dayWeek`: the ladder rung of THAT DAY's own date (stats.ladderWeek)
   when it is a long run, else null. The "This week" list prints a row per entry
   and the headline names the first long run's rung, so the two cannot disagree.
   The headline used to ask ladderWeek about TODAY, which counts whole 7-day
   blocks from start_date (Mondays) and knew nothing of "Week starts on": with a
   Saturday week, Mon 16 Nov said "6 km, Week 3" over a list whose long run was
   Sat 14 Nov, 5 km. */
function weekRuns(plan, today, weekStartSetting, ladder, startDate) {
  const first = startOfWeek(today, weekStartSetting);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(first, i);
    const wk = weekdayKey(iso);
    for (const day of plan.model.days) {
      if (day.weekday !== wk) continue;
      const isLong = /long/i.test(day.name);
      out.push({ iso, wk, day, isLong, dayWeek: isLong && ladder.length ? ladderWeek(startDate, iso, ladder.length) : null });
    }
  }
  return out;
}

/* The ladder week the headline (and the strip's "now" rung) shows: the week's
   long run's rung. A week with no long run in it, or one that falls before the
   ladder starts, has none, and then today's own rung stands as it always did. */
function headlineWeek(runs, today, ladder, startDate) {
  const long = runs.find(r => r.dayWeek);
  if (long) return long.dayWeek;
  return ladder.length ? ladderWeek(startDate, today, ladder.length) : null;
}

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();
  const plan = ctx.runPlan();

  root.append(el('div', { class: 'gv-toolbar' },
    el('h2', { class: 'gv-toolbar-title' }, 'Running'),
    el('div', { class: 'gv-toolbar-actions' },
      /* Running records hang off this page the way strength records hang
         off History — see page-run-records.js for why they are not one page. */
      el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => ctx.nav('run-records') },
        ico('trophy'), el('span', {}, 'Records')),
      plan ? el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => ctx.nav('plans', { plan: plan.name }) },
        ico('clipboard-list'), el('span', {}, 'Plan')) : '')));

  /* ---- the ladder: which week, what's the target ---- */
  const ladder = (plan && Array.isArray(plan.fm.ladder) ? plan.fm.ladder : []).map(num).filter(v => v !== null);
  const startDate = plan ? (plan.fm.start_date || '') : '';
  /* The same week the list below draws (weekRuns), so the headline names the rung
     of the long run that list shows. */
  const planned = plan ? weekRuns(plan, today, settings.weekStart, ladder, startDate) : [];
  const week = ladder.length ? headlineWeek(planned, today, ladder, startDate) : null;
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
  /* A paused running plan still drives THIS page (ctx.runPlan reads every
     parallel plan); it just is not on Today. Say so, or "where are my runs on
     Today" has no answer. */
  if (plan && isPaused(plan)) {
    root.append(el('p', { class: 'gv-dim' }, 'This plan is paused, so its runs are not on Today. Switch it back on from the Plan page.'));
  }

  /* ---- this week's runs, straight from the plan ---- */
  if (plan) {
    const scheduled = planned;
    if (scheduled.length) {
      root.append(el('div', { class: 'gv-section-title' }, ico('calendar-days'), el('span', {}, 'This week')));
      const list = el('div', { class: 'gv-card-list' });
      for (const s of scheduled) {
        /* stats.ranOn is the one rule for "a run happened that day" - a
           distance row, or a row of a km exercise (a timed circuit saves a
           run as minutes with no km). It reads the day through workoutDate,
           THE rule for a workout's day. */
        const done = ranOn(data.workouts, s.iso, data.exercises);
        /* The rung of THAT DAY's week (weekRuns -> stats.ladderWeek, the rule the
           headline reads too), not today's: a ladder that steps up mid-calendar-week
           gives two long runs in one week two different distances. A day the
           ladder has not started for has no rung and prints the plan's own text. */
        const { dayWeek } = s;
        const rx = dayWeek ? `${ladder[dayWeek - 1]} km` : (s.day.items[0] ? s.day.items[0].target : '');
        const row = el('div', { class: `gv-card gv-runday${s.iso === today ? ' today' : ''}${done ? ' done' : ''}` },
          el('div', { class: 'gv-runday-when' },
            el('div', { class: 'gv-runday-day' }, WEEKDAY_LABELS[s.wk].slice(0, 3)),
            el('div', { class: 'gv-runday-date' }, fmtShort(s.iso))),
          el('div', { class: 'gv-runday-main' },
            el('div', { class: 'gv-runday-name' }, s.day.name),
            el('div', { class: 'gv-runday-rx' }, rx || '')),
          done
            ? el('span', { class: 'gv-badge' }, 'done')
            : el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => ctx.startLog(plan, s.day, s.iso < today ? { date: s.iso } : undefined) },
                ico('play'), el('span', {}, 'Log')));
        list.append(row);
      }
      root.append(list);
    }
  }

  /* ---- volume ---- */
  const thisWeekKm = distanceInWeek(data.workouts, today, settings.weekStart);
  const lastWeekKm = distanceInWeek(data.workouts, addDays(startOfWeek(today, settings.weekStart), -1), settings.weekStart);
  /* ONE SCAN, THE SAME ONE THE RECORDS PAGE USES. These tiles used to walk
     the CURRENT LIBRARY's km-unit notes and take exerciseBests per name,
     while "this week" (distanceInWeek) and the records page counted every
     distance_km row in history. So deleting an exercise note left the week
     tile at 10 km and the records hero at 10 km while "longest run" dropped
     to a dash — three surfaces, three rules, one of them quietly forgetting
     history the moment a note was renamed or removed.

     longestRun(runRows(...)) IS runRecords().longest: same function, same
     input, so the tile cannot disagree with the hero. */
  const runs = runRows(data.workouts);
  const longestRunRow = longestRun(runs);
  const longest = longestRunRow ? longestRunRow.km : null;
  const lastRun = runs.reduce((d, r) => (r.date && (!d || r.date > d) ? r.date : d), null);
  root.append(el('div', { class: 'gv-tiles' },
    statTile(ico('footprints'), fmt(thisWeekKm, ' km'), 'this week'),
    statTile(ico('chart-line'), fmt(lastWeekKm, ' km'), 'last week'),
    statTile(ico('trophy'), fmt(longest, ' km'), 'longest run'),
    statTile(ico('history'), lastRun ? fmtShort(lastRun) : '—', 'last run')));

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
  /* ONE PACE PER RUN, from that run's own two figures.

     This used to sum every distance row in a session and every seconds row,
     then divide. An untimed warm-up walk beside a timed main run therefore
     invented a pace neither of them had — the main run's time spread over
     both distances, reported as if it were a single effort. The session
     total is still shown as the distance, because that IS the sum of the
     rows; only the pace is per-run, and it appears only when the run it
     belongs to carries both figures. */
  const recent = [];
  for (let i = data.workouts.length - 1; i >= 0 && recent.length < 6; i--) {
    const w = data.workouts[i];
    const rows = (w.rows || []).filter(r => num(r.distance_km) !== null);
    if (!rows.length) continue;
    const km = Math.round(rows.reduce((n, r) => n + num(r.distance_km), 0) * 10) / 10;
    const secs = rows.reduce((n, r) => n + (num(r.seconds) || 0), 0);
    /* The pace of the LONGEST row that has both — the run of the session,
       rather than an average across a warm-up. A session whose rows are all
       untimed shows no pace at all, which is the honest answer. */
    const paced = rows
      .map(r => ({ km: num(r.distance_km), seconds: num(r.seconds) }))
      .filter(r => r.km > 0 && r.seconds > 0)
      .sort((a, b) => b.km - a.km)[0] || null;
    recent.push({
      date: workoutDate(w), name: rows[0].exercise, km, secs, file: w.file,
      pace: paced ? fmtPace(paceOf(paced)) : '',
      /* One row, or several? A session pace shown against a multi-row
         session has to say which run it belongs to. */
      paceIsPartial: !!paced && rows.length > 1,
    });
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
            `${fmtShort(r.date)}${r.secs ? ' · ' + fmtSeconds(r.secs) : ''}${r.pace ? ` · ${r.pace}${r.paceIsPartial ? ' (longest leg)' : ''}` : ''}`))));
    }
    root.append(list);
  } else {
    root.append(emptyLine('No runs logged yet — the first one starts the trend.'));
  }
}

module.exports = { render, weekRuns, headlineWeek };
