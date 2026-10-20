'use strict';
/* Records — every personal best in one place.

   WHY IT IS NOT A NAV TAB: the primary bar is six tabs, which is what makes
   it fit a phone without scrolling, and adding a seventh would trade a
   permanent cost (a bar that scrolls, every session, forever) for a page
   most people open occasionally. It hangs off History instead, which is
   where "what have I done" already lives.

   Every figure here comes from records.allRecords, which gets its values
   from stats.exerciseBests — the same function the exercise detail page
   reads. That is not incidental: a Records page with its own faster scan
   would eventually show a different best from the exercise's own page, and
   nothing would say which was wrong. */

const { el, ico, fmtSeconds, clickableCard, backButton, emptyLine } = require('./dom');
const { MUSCLE_GROUPS } = require('./constants');
const { allRecords, latestRecord } = require('./records');
const { pbDelta, marginText } = require('./progress');
const { fmtShort, todayISO } = require('./dates');
const rewardsUi = require('./rewards-ui');
const { recordsKicker } = require('./rewards-view');

const KIND_LABEL = { reps: 'reps', weight: 'weight', seconds: 'hold' };

/* One figure, in the unit its kind is measured in. Reuses fmtSeconds so a
   hold reads the same here as it does everywhere else in the app. */
function figure(kind, value) {
  if (kind === 'seconds') return fmtSeconds(value);
  if (kind === 'weight') return `${value} kg`;
  return String(value);
}

function listOf(v) { return Array.isArray(v) ? v : v ? [v] : []; }

function render(ctx, root) {
  const { data } = ctx;
  const ui = ctx.state.recordsUi || (ctx.state.recordsUi = { q: '', muscle: '' });

  const back = backButton(ctx, 'history');

  const rows = allRecords(data.workouts, data.exercises);
  /* No records, nothing to search: the box used to be drawn anyway and its
     handler closed over `draw`, which does not exist yet on the empty-state
     path - typing threw "Cannot access 'draw' before initialization". */
  const search = !rows.length ? null : el('input', {
    class: 'gv-search', type: 'search', placeholder: 'Search exercises…', value: ui.q, 'aria-label': 'Search records',
    oninput: e => { ui.q = e.target.value; draw(); },
  });
  /* The count under the title is the mockups' "14 BESTS" (Apex and Lock In
     draw it; the other skins hide it). Same rows the list prints. */
  root.append(el('div', { class: 'gv-toolbar gv-toolbar-records' },
    back,
    el('h2', { class: 'gv-toolbar-title' }, 'Records'),
    /* "14 bests" and, when a best was beaten today, "· 1 new today" (design 07's sub line). recordsKicker
       counts only beaten records: a first-ever figure is a baseline, not a record. */
    el('p', { class: 'gv-kicker gv-records-count' }, `${rows.length} ${rows.length === 1 ? 'best' : 'bests'}`,
      recordsKicker(rows, todayISO()).text ? el('span', { class: 'gv-records-new' }, ` \u00b7 ${recordsKicker(rows, todayISO()).text}`) : ''),
    search || ''));
  if (!rows.length) {
    root.append(emptyLine(
      'No records yet — log a set and the first one becomes the number to beat.'));
    rewardsUi.mountRecords(ctx, root);
    return;
  }

  /* Muscle filter, same chip pattern (and same "only the groups actually in
     use" rule) as the exercise library, so the two pages behave identically.
     A record's muscles come from its exercise note, which is the only place
     that fact lives. */
  const musclesFor = name => {
    const ex = data.exercises.find(e => e.name === name);
    return ex && ex.fm ? listOf(ex.fm.muscles) : [];
  };
  const used = new Set();
  for (const r of rows) for (const m of musclesFor(r.exercise)) used.add(m);

  const chips = el('div', { class: 'gv-chips' });
  const allChip = el('button', { class: `gv-chip${ui.muscle === '' ? ' on' : ''}`, type: 'button' }, 'all');
  allChip.addEventListener('click', () => { ui.muscle = ''; ctx.rerender(); });
  chips.append(allChip);
  for (const m of MUSCLE_GROUPS.filter(m => used.has(m))) {
    const c = el('button', { class: `gv-chip${ui.muscle === m ? ' on' : ''}`, type: 'button' }, m);
    c.addEventListener('click', () => { ui.muscle = ui.muscle === m ? '' : m; ctx.rerender(); });
    chips.append(c);
  }
  root.append(chips);

  const listWrap = el('div', { class: 'gv-card-list' });
  root.append(listWrap);

  /* THE NEWEST RECORD, if any best has ever been beaten. records.latestRecord
     is built on the same allRecords/recordHistory the rows come from, so the
     row it marks carries the value and date printed beside it. Computed from
     ALL records, not the filtered view: a search that hides the newest record
     must not hand its mark to whichever row is left. */
  const latest = latestRecord(data.workouts, data.exercises);
  const latestDelta = latest ? pbDelta(latest.prev, latest.value) : null;

  const draw = () => {
    while (listWrap.firstChild) listWrap.removeChild(listWrap.firstChild);
    const q = ui.q.trim().toLowerCase();
    const shown = rows.filter(r =>
      (!q || r.exercise.toLowerCase().includes(q)) &&
      (!ui.muscle || musclesFor(r.exercise).includes(ui.muscle)));

    if (!shown.length) {
      listWrap.append(emptyLine('No matches.'));
      return;
    }

    /* Newest first. A records page sorted alphabetically is a reference
       table; sorted by when it last moved, it is a story about the last
       month. Sorted on a COPY — `rows` is rebuilt per render, but sorting
       the filtered view in place would still reorder it under the next
       filter pass for no reason. */
    const ordered = shown.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    for (const r of ordered) {
      const ex = data.exercises.find(e => e.name === r.exercise);
      const isNew = !!latest && latest.exercise === r.exercise && latest.kind === r.kind;
      listWrap.append(clickableCard(
        /* The "Latest" badge is CSS content on .gv-rec-new, which assistive
           tech does not reliably read - and this aria-label REPLACES the row's
           own text anyway. So the badge is said here, in words. */
        { class: `gv-card gv-recrow${isNew ? ' gv-rec-new' : ''}`, 'aria-label': isNew ? `Open ${r.exercise}, latest record` : `Open ${r.exercise}` },
        () => ctx.nav('exercise', { exercise: r.exercise, path: ex && ex.file ? ex.file.path : null }),
        el('div', { class: 'gv-recrow-main' },
          el('div', { class: 'gv-recrow-name' }, r.exercise),
          el('div', { class: 'gv-recrow-was' },
            /* `times: 1` means set once and never beaten. Calling that a
               "record" overstates it — it is the only figure there is, and
               saying so is the honest version. */
            `${KIND_LABEL[r.kind]} · ${r.times === 1 ? 'first logged' : `beaten ${r.times - 1}×`}`
            + (r.date ? ` · ${fmtShort(r.date)}` : ''),
            /* What the newest record beat, and by how much. */
            ...(isNew ? [' · ', el('s', { class: 'gv-rec-prev' }, figure(r.kind, latest.prev)),
              ' ', latestDelta ? el('span', { class: 'gv-rec-delta' }, marginText(r.kind, latestDelta.abs)) : ''] : []))),
        el('div', { class: 'gv-recrow-margin' }, figure(r.kind, r.value))));
    }
  };
  draw();

  /* Medals sit with the personal bests: derived from the whole history (no ledger read), hidden when
     rewards are off. The filters above do not touch them. */
  rewardsUi.mountRecords(ctx, root);

  /* Runs are measured, not counted, and their records live on their own
     page (see page-run-records.js). Say so here, where someone looking for
     a longest run would otherwise conclude it was never tracked. */
  root.append(el('div', { class: 'gv-session-foot' },
    el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => ctx.nav('run-records') },
      ico('footprints'), el('span', {}, 'Running records'))));
  root.append(el('p', { class: 'gv-microcopy' }, 'Every number here is one you already did.'));
}

module.exports = { render };
