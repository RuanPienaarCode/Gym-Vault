'use strict';
/* History — activity heatmap plus every logged session, newest first. */

const { el, ico, fmtSeconds, clickableCard } = require('./dom');
const { todayISO, addDays, startOfWeek, fmtShort, monthLabel, weekdayKey } = require('./dates');
const { workoutDates, workoutDate, weekStreak, sessionCount, sessionVolume, sessionSets } = require('./stats');
const { streakFlame } = require('./streak-flame');
const { ConfirmModal } = require('./modals');

const HEAT_WEEKS = 16;

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();
  const dates = new Set(workoutDates(data.workouts));
  /* Every session on the list, including undated ones. This counted only
     DATED files while the list below rendered all of them, so the number and
     the cards under it could disagree — and Today counted unique dates on
     top of that, making three surfaces and three answers. stats.sessionCount
     is the one rule now. */
  const counted = sessionCount(data.workouts);

  root.append(el('div', { class: 'gv-toolbar' },
    el('h2', { class: 'gv-toolbar-title' }, 'History'),
    /* stats.sessionCount — the same rule the dashboard tile and the export
       summary use. */
    el('div', { class: 'gv-dim' }, `${counted} session${counted === 1 ? '' : 's'}`),
    /* Records hang off History rather than taking a seventh nav tab — see
       page-records.js's header for why the bar stays at six. */
    el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => ctx.nav('records') },
      ico('trophy'), el('span', {}, 'Records'))));

  /* Heat grid: HEAT_WEEKS columns × 7 rows, current week last. */
  const heat = el('div', { class: 'gv-heat', role: 'img', 'aria-label': `Workout activity, last ${HEAT_WEEKS} weeks` });
  const thisWeek = startOfWeek(today, settings.weekStart);
  for (let w = HEAT_WEEKS - 1; w >= 0; w--) {
    const col = el('div', { class: 'gv-heat-col' });
    const weekStart = addDays(thisWeek, -7 * w);
    for (let d = 0; d < 7; d++) {
      const iso = addDays(weekStart, d);
      const cls = iso > today ? 'future' : dates.has(iso) ? 'on' : 'off';
      col.append(el('div', { class: `gv-heat-cell ${cls}${iso === today ? ' today' : ''}`, title: iso }));
    }
    heat.append(col);
  }
  root.append(el('div', { class: 'gv-heat-wrap' }, heat));

  /* The same flame the dashboard shows, from the same weekStreak call — one
     figure, one component, so the two pages cannot disagree about how long
     the streak is or how hot it should look. */
  root.append(streakFlame(weekStreak([...dates], settings.weekStart, today)));

  if (!data.workouts.length) {
    root.append(el('div', { class: 'gv-empty-line' }, 'Nothing logged yet — your first session will land here.'));
    return;
  }

  /* Sessions newest-first, grouped by month. */
  const sessions = [...data.workouts].reverse();
  let lastMonth = '';
  const openName = ctx.state.params && ctx.state.params.session;
  for (const w of sessions) {
    /* The day this app actually reads, not the raw string — a note under the
       wrong month header is the same lie as one in the wrong sort position. */
    const m = monthLabel(workoutDate(w) || '');
    if (m && m !== lastMonth) {
      root.append(el('div', { class: 'gv-section-title' }, ico('calendar-days'), el('span', {}, m)));
      lastMonth = m;
    }
    root.append(sessionCard(ctx, w, w.name === openName));
  }
}

function sessionCard(ctx, w, open) {
  const vol = sessionVolume(w.rows);
  const meta = [
    `${sessionSets(w.rows)} sets`,
    vol ? `${vol}kg volume` : null,
    w.fm.duration_min ? `${w.fm.duration_min} min` : null,
  ].filter(Boolean).join(' · ');

  const card = el('div', { class: `gv-card gv-session-card${open ? ' open' : ''}` });
  /* An unreadable date falls back to the file name rather than printing a
     date nothing else in the app agrees with. */
  const d = workoutDate(w);
  const whenLabel = d ? fmtShort(d) : w.name;
  const head = clickableCard(
    { class: 'gv-session-head', 'aria-expanded': open ? 'true' : 'false', 'aria-label': `${whenLabel} session, ${open ? 'expanded' : 'collapsed'}` },
    () => ctx.nav('history', { session: open ? undefined : w.name }),
    el('div', { class: 'gv-session-when' },
      el('div', { class: 'gv-session-date' }, whenLabel),
      el('div', { class: 'gv-session-day' }, [w.fm.day, w.fm.plan].filter(Boolean).join(' · ') || 'Freestyle')),
    el('div', { class: 'gv-session-meta' }, meta),
    el('div', { class: 'gv-card-actions' },
      iconBtn('trash-2', 'Delete session', () => new ConfirmModal(ctx.app, {
        title: 'Delete session?',
        message: `${w.name} will be deleted, following your Obsidian "Deleted files" setting.`,
        onConfirm: async () => { await ctx.io.trash(w.file); ctx.reload(); },
      }).open()),
      ico(open ? 'chevron-left' : 'chevron-right', 'gv-dim')));
  card.append(head);

  if (open) {
    const table = el('div', { class: 'gv-set-table' });
    /* Group rows by exercise so a session reads the way it was performed. */
    const byEx = [];
    for (const r of w.rows) {
      const last = byEx[byEx.length - 1];
      if (last && last.exercise === r.exercise) last.rows.push(r);
      else byEx.push({ exercise: r.exercise, rows: [r] });
    }
    for (const g of byEx) {
      table.append(el('div', { class: 'gv-set-ex' }, g.exercise));
      for (const r of g.rows) {
        const bits = [];
        if (r.distance_km) bits.push(`${r.distance_km} km`);
        if (r.reps) bits.push(`${r.reps} reps`);
        if (r.weight_kg) bits.push(`${r.weight_kg}kg`);
        if (r.seconds) bits.push(fmtSeconds(r.seconds));
        table.append(el('div', { class: 'gv-set-row' },
          el('span', { class: 'gv-set-num' }, `set ${r.set || '?'}`),
          el('span', {}, bits.join(' · ') || '—'),
          r.note ? el('span', { class: 'gv-dim' }, r.note) : ''));
      }
    }
    const openNote = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' },
      ico('pencil'), el('span', {}, 'Open note'));
    openNote.addEventListener('click', () => ctx.openFile(w.file));
    table.append(el('div', { class: 'gv-session-foot' }, openNote));
    card.append(table);
  }
  return card;
}

function iconBtn(name, label, onClick) {
  const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': label }, ico(name));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

module.exports = { render };
