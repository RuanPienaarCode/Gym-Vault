'use strict';
/* Export — turn the vault into something you can hand to a coach or paste
   into a chat. Pure: no DOM, no obsidian import, so it is testable and the
   page is only a thin shell around it.

   PRIVACY: the body log holds clinical markers (blood pressure, cholesterol,
   glucose) next to training data. Those are OFF by default and only ever
   included when the caller explicitly asks — sharing a training log with a
   coach should not hand over a medical record by accident. */

const { BODY_COLUMNS, WORKOUT_COLUMNS, WEEKDAY_LABELS, WEEKDAYS } = require('./constants');
const { todayISO, fmtShort, addDays } = require('./dates');
const {
  num, exerciseBests, goalCurrent, goalProgress, distanceInWeek, ladderWeek, sessionSets,
} = require('./stats');

/* Columns that are clinical rather than physical. */
const HEALTH_KEYS = ['bp_systolic', 'bp_diastolic', 'cholesterol', 'glucose'];
const isHealthKey = k => HEALTH_KEYS.indexOf(k) >= 0;

const DEFAULTS = { days: 90, includeBody: true, includeHealth: false };

function windowStart(days, today) {
  return days ? addDays(today, -days + 1) : null;
}

function pickWorkouts(data, opts) {
  const from = windowStart(opts.days, opts.today);
  return data.workouts.filter(w => {
    const d = (w.fm.date || '').slice(0, 10);
    return d && (!from || d >= from);
  });
}

/* ---- markdown summary: the one a human reads ---- */

function buildSummary(data, options) {
  const o = { ...DEFAULTS, today: todayISO(), weekStart: 'mon', ...options };
  const L = [];
  const workouts = pickWorkouts(data, o);
  const rangeLabel = o.days ? `last ${o.days} days` : 'all time';

  L.push(`# Gym Vault export — ${fmtShort(o.today)}`);
  L.push('');
  L.push(`Training log exported from Obsidian. Range: ${rangeLabel}. ${workouts.length} session${workouts.length === 1 ? '' : 's'}.`);
  L.push('');

  /* Athlete */
  const fm = data.profile.fm || {};
  const latest = {};
  for (const r of data.body || []) for (const c of BODY_COLUMNS) if (r[c.key]) latest[c.key] = r[c.key];
  const age = num(fm.birth_year) ? new Date(o.today).getFullYear() - num(fm.birth_year) : null;
  const bits = [fm.name, age !== null ? `${age} yrs` : null, fm.sex || null];
  if (o.includeBody) {
    if (num(fm.height_cm)) bits.push(`${fm.height_cm} cm`);
    if (latest.weight_kg) bits.push(`${latest.weight_kg} kg`);
  }
  L.push('## Athlete');
  L.push('');
  L.push(bits.filter(Boolean).join(' · ') || '—');
  const notes = (data.profile.body || '').trim();
  if (notes) { L.push(''); L.push(notes); }
  L.push('');

  /* Plans */
  if (data.plans.length) {
    L.push('## Current programme');
    L.push('');
    for (const p of data.plans) {
      const tag = String(p.fm.parallel) === 'true' ? 'runs alongside'
        : String(p.fm.active) === 'true' ? 'active' : 'inactive';
      L.push(`### ${p.name} (${tag})`);
      L.push('');
      const ordered = [...p.model.days].sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday));
      for (const d of ordered) {
        const items = d.items.map(i => `${i.exercise}${i.sets != null ? ` ${i.sets}×${i.target}` : i.target ? ` ${i.target}` : ''}`);
        L.push(`- **${WEEKDAY_LABELS[d.weekday] || d.weekday} — ${d.name}**${items.length ? ': ' + items.join('; ') : ''}`);
      }
      const ladder = Array.isArray(p.fm.ladder) ? p.fm.ladder.map(num).filter(v => v !== null) : [];
      if (ladder.length) {
        const wk = ladderWeek(p.fm.start_date, o.today, ladder.length);
        L.push('');
        L.push(`Long-run ladder (km): ${ladder.join(' · ')}`);
        if (wk) L.push(`Currently week ${wk} of ${ladder.length} — target ${ladder[wk - 1]} km.`);
      }
      L.push('');
    }
  }

  /* Goals */
  if (data.goals.length) {
    L.push('## Goals');
    L.push('');
    L.push('| Goal | Measured by | Now | Target | Progress |');
    L.push('|---|---|---|---|---|');
    const sctx = { workouts: data.workouts, body: data.body, weekStart: o.weekStart, today: o.today };
    for (const g of data.goals) {
      const cur = goalCurrent(g, sctx);
      const p = goalProgress(g, cur);
      L.push(`| ${g.name} | ${g.fm.metric}${g.fm.exercise ? ` (${g.fm.exercise})` : ''} | ${cur ?? '—'} | ${g.fm.target ?? '—'} | ${p === null ? '—' : Math.round(p * 100) + '%'} |`);
    }
    L.push('');
  }

  /* Personal bests, only for what has actually been logged */
  const bestRows = [];
  for (const ex of data.exercises) {
    const b = exerciseBests(data.workouts, ex.name);
    if (b.reps === null && b.weight === null && b.seconds === null && b.distance === null) continue;
    const cells = [];
    if (b.reps !== null) cells.push(`${b.reps} reps`);
    if (b.weight !== null) cells.push(`${b.weight} kg`);
    if (b.seconds !== null) cells.push(`${b.seconds} s`);
    if (b.distance !== null) cells.push(`${b.distance} km`);
    bestRows.push(`| ${ex.name} | ${cells.join(' · ')} | ${b.lastDate ? fmtShort(b.lastDate) : '—'} |`);
  }
  if (bestRows.length) {
    L.push('## Personal bests');
    L.push('');
    L.push('| Exercise | Best | Last done |');
    L.push('|---|---|---|');
    L.push(...bestRows);
    L.push('');
  }

  /* Running volume */
  const kmThis = distanceInWeek(data.workouts, o.today, o.weekStart);
  const kmLast = distanceInWeek(data.workouts, addDays(o.today, -7), o.weekStart);
  if (kmThis || kmLast) {
    L.push('## Running volume');
    L.push('');
    L.push(`- This week: ${kmThis} km`);
    L.push(`- Last week: ${kmLast} km`);
    L.push('');
  }

  /* Sessions */
  if (workouts.length) {
    L.push(`## Sessions (${rangeLabel})`);
    L.push('');
    for (const w of [...workouts].reverse()) {
      L.push(`### ${fmtShort(w.fm.date)} — ${w.fm.day || 'Freestyle'}${w.fm.plan ? ` (${w.fm.plan})` : ''}`);
      const dur = w.fm.duration_min ? `${w.fm.duration_min} min · ` : '';
      L.push(`${dur}${sessionSets(w.rows)} sets`);
      const byEx = [];
      for (const r of w.rows || []) {
        const last = byEx[byEx.length - 1];
        if (last && last.exercise === r.exercise) last.rows.push(r);
        else byEx.push({ exercise: r.exercise, rows: [r] });
      }
      for (const g of byEx) {
        const parts = g.rows.map(r => {
          if (r.distance_km) return `${r.distance_km} km${r.seconds ? ` in ${Math.round(num(r.seconds) / 60)} min` : ''}`;
          if (r.seconds) return `${r.seconds}s`;
          return r.weight_kg ? `${r.reps || '?'}×${r.weight_kg}kg` : `${r.reps || '?'}`;
        });
        L.push(`- ${g.exercise}: ${parts.join(', ')}`);
      }
      L.push('');
    }
  }

  /* Body + health, both explicitly gated */
  if (o.includeBody && (data.body || []).length) {
    const cols = BODY_COLUMNS.filter(c => o.includeHealth || !isHealthKey(c.key));
    const from = windowStart(o.days, o.today);
    const rows = data.body.filter(r => r.date && (!from || r.date >= from));
    if (rows.length) {
      L.push(o.includeHealth ? '## Body & health measurements' : '## Body measurements');
      L.push('');
      L.push(`| ${cols.map(c => c.label).join(' | ')} |`);
      L.push(`|${cols.map(() => '---').join('|')}|`);
      for (const r of rows) L.push(`| ${cols.map(c => r[c.key] || '').join(' | ')} |`);
      L.push('');
      if (!o.includeHealth) L.push('_Clinical markers (blood pressure, cholesterol, glucose) were not included in this export._');
      L.push('');
    }
  }

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---- CSV: one row per logged set, for a spreadsheet ---- */

const csvCell = v => {
  const s = (v ?? '').toString();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildCsv(data, options) {
  const o = { ...DEFAULTS, today: todayISO(), ...options };
  const cols = ['date', 'plan', 'day', ...WORKOUT_COLUMNS.map(c => c.key)];
  const lines = [cols.join(',')];
  for (const w of pickWorkouts(data, o)) {
    for (const r of w.rows || []) {
      lines.push(cols.map(k => csvCell(
        k === 'date' ? w.fm.date : k === 'plan' ? w.fm.plan : k === 'day' ? w.fm.day : r[k],
      )).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

/* ---- JSON: the structured dump, for analysis ---- */

function buildJson(data, options) {
  const o = { ...DEFAULTS, today: todayISO(), weekStart: 'mon', ...options };
  const from = windowStart(o.days, o.today);
  const out = {
    exported: o.today,
    range: o.days ? `last ${o.days} days` : 'all',
    profile: { ...(data.profile.fm || {}), notes: (data.profile.body || '').trim() },
    plans: data.plans.map(p => ({
      name: p.name,
      active: String(p.fm.active) === 'true',
      parallel: String(p.fm.parallel) === 'true',
      ladder: p.fm.ladder,
      start_date: p.fm.start_date,
      days: p.model.days.map(d => ({ weekday: d.weekday, name: d.name, items: d.items })),
    })),
    goals: data.goals.map(g => {
      const cur = goalCurrent(g, { workouts: data.workouts, body: data.body, weekStart: o.weekStart, today: o.today });
      return { name: g.name, ...g.fm, current: cur, progress: goalProgress(g, cur) };
    }),
    exercises: data.exercises.map(e => ({ name: e.name, ...e.fm, bests: exerciseBests(data.workouts, e.name) })),
    workouts: pickWorkouts(data, o).map(w => ({ ...w.fm, rows: w.rows })),
  };
  if (o.includeBody) {
    out.body = (data.body || [])
      .filter(r => r.date && (!from || r.date >= from))
      .map(r => {
        const row = {};
        for (const c of BODY_COLUMNS) {
          if (!o.includeHealth && isHealthKey(c.key)) continue;
          if (r[c.key]) row[c.key] = r[c.key];
        }
        return row;
      });
  }
  return JSON.stringify(out, null, 2) + '\n';
}

module.exports = { buildSummary, buildCsv, buildJson, HEALTH_KEYS, isHealthKey, DEFAULTS };
