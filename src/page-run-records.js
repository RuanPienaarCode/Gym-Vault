'use strict';
/* Running records — the page for what a run is, rather than what a set is.

   WHY A SEPARATE PAGE FROM RECORDS: that page reads one number per kind
   that only goes up. A run is three numbers that pull in different
   directions — further, longer, faster — and "faster" is a number that
   goes DOWN and must be computed from one row's own pair of figures.
   Teaching the strength page about that would have made it worse at the
   one thing it does well. So: two pages, one discipline, and every figure
   here comes from run-records.js, which gets its maxima from stats.js.

   Reached from the Running page's toolbar, the way Records is reached from
   History. Not a nav tab: the bar stays at six (see page-records.js). */

const { el, ico, fmt, fmtSeconds, clickableCard, backButton } = require('./dom');
const { fmtShort } = require('./dates');
const { runRecords, paceOf, fmtPace, MIN_PACE_KM } = require('./run-records');
const { sameName } = require('./stats');

/* "Long Trail Run · 25 Jul · 51:40 · 6:27 /km" — a run described by its
   own figures, pace included only when both halves exist. */
function runLine(run) {
  if (!run) return '';
  const bits = [run.exercise, run.date ? fmtShort(run.date) : 'undated'];
  if (run.seconds) bits.push(fmtSeconds(run.seconds));
  const p = paceOf(run);
  if (p !== null) bits.push(fmtPace(p));
  return bits.filter(Boolean).join(' · ');
}

function render(ctx, root) {
  const { data, settings } = ctx;
  const R = runRecords(data.workouts, data.exercises, settings.weekStart);

  /* Back to the CALLER, not to a hardcoded page. Reaching this from
     Records used to drop you on Running instead of where you came from. */
  const back = backButton(ctx, 'running');
  root.append(el('div', { class: 'gv-toolbar' },
    back,
    el('h2', { class: 'gv-toolbar-title' }, 'Running records'),
    el('div', { class: 'gv-dim' }, R.runs ? `${R.runs} run${R.runs === 1 ? '' : 's'}` : '')));

  if (!R.runs) {
    root.append(el('div', { class: 'gv-empty-line' },
      'No runs logged yet — the first one sets every record here at once.'));
    return;
  }

  /* ---- the longest run, as the headline ---- */
  const L = R.longest;
  const hero = el('div', { class: 'gv-hero' });
  hero.append(el('p', { class: 'gv-kicker' }, 'Longest run'));
  hero.append(el('h3', { class: 'gv-display gv-hero-title' }, el('span', { class: 'gv-mark' }, `${L.km} km`)));
  hero.append(el('p', { class: 'gv-hero-sub' }, runLine(L)));
  root.append(hero);

  /* ---- the other three dimensions ---- */
  /* The tile numeral is "6:00" and the unit lives in the label: "/km" set
     in the display face at tile size wraps onto its own line and reads as
     a second figure. Everywhere else on the page the pace keeps its unit. */
  const paceDigits = run => fmtPace(paceOf(run)).replace(/ \/km$/, '');
  root.append(el('div', { class: 'gv-tiles' },
    tile(ico('gauge'), R.fastest ? paceDigits(R.fastest) : '—', `best min/km, ${MIN_PACE_KM} km+`),
    tile(ico('timer'), R.longestTime ? fmtSeconds(R.longestTime.seconds) : '—', 'longest on feet'),
    tile(ico('calendar-days'), R.biggestWeek ? fmt(R.biggestWeek.km, ' km') : '—', 'biggest week'),
    tile(ico('footprints'), fmt(R.totalKm, ' km'), R.firstDate ? `total since ${fmtShort(R.firstDate)}` : 'total')));

  /* ---- best pace by distance ---- */
  root.append(el('div', { class: 'gv-section-title' }, ico('gauge'), el('span', {}, 'Best pace by distance')));
  const bands = el('div', { class: 'gv-card-list' });
  for (const b of R.bands) {
    const best = b.best;
    bands.append(el('div', { class: `gv-card gv-rr-band${best ? '' : ' empty'}` },
      el('div', { class: 'gv-rr-band-km' }, `${b.km} km+`),
      el('div', { class: 'gv-rr-band-main' },
        el('div', { class: 'gv-rr-band-pace' }, best ? fmtPace(paceOf(best)) : 'not yet'),
        el('div', { class: 'gv-rr-band-sub' }, best
          ? `${best.km} km · ${runLine(best)}`
          /* Honest about WHY: no run that long with a time on it. The
             longest run may well be longer than the band — untimed. */
          : `No timed run of ${b.km} km or more${L.km >= b.km ? ' — log the minutes to claim it' : ''}.`))));
  }
  root.append(bands);
  root.append(el('p', { class: 'gv-dim gv-ladder-note' },
    `Each line is your best average pace over any single run of at least that distance — never a split nobody timed. Runs under ${MIN_PACE_KM} km are not paced.`));

  /* ---- by exercise ---- */
  root.append(el('div', { class: 'gv-section-title' }, ico('footprints'), el('span', {}, 'By exercise')));
  const byEx = el('div', { class: 'gv-card-list' });
  for (const x of R.exercises) {
    const ex = data.exercises.find(e => sameName(e.name, x.exercise));
    const meta = x.runs
      ? [
        `${x.runs} run${x.runs === 1 ? '' : 's'}`,
        `${x.totalKm} km`,
        x.fastest ? fmtPace(paceOf(x.fastest)) : null,
        x.longestTime ? fmtSeconds(x.longestTime.seconds) : null,
      ].filter(Boolean).join(' · ')
      : 'never run';
    byEx.append(clickableCard(
      { class: 'gv-card gv-recrow', 'aria-label': `Open ${x.exercise}` },
      () => ctx.nav('exercise', { exercise: x.exercise, path: ex && ex.file ? ex.file.path : null }),
      el('div', { class: 'gv-recrow-main' },
        el('div', { class: 'gv-recrow-name' }, x.exercise),
        el('div', { class: 'gv-recrow-was' }, meta)),
      el('div', { class: 'gv-recrow-margin' }, x.longest ? `${x.longest.km} km` : '—')));
  }
  root.append(byEx);

  /* ---- every time the longest run moved ---- */
  if (R.timeline.length > 1) {
    root.append(el('div', { class: 'gv-section-title' }, ico('trophy'), el('span', {}, 'Every time the longest run moved')));
    const tl = el('div', { class: 'gv-card-list' });
    for (const t of R.timeline.slice().reverse()) {
      tl.append(el('div', { class: 'gv-card gv-recrow' },
        el('div', { class: 'gv-recrow-main' },
          el('div', { class: 'gv-recrow-name' }, t.exercise),
          el('div', { class: 'gv-recrow-was' },
            `${t.prev === null ? 'the first run' : `from ${t.prev} km`}${t.date ? ' · ' + fmtShort(t.date) : ''}${t.seconds ? ' · ' + fmtSeconds(t.seconds) : ''}`)),
        el('div', { class: 'gv-recrow-margin' }, `${t.km} km`)));
    }
    root.append(tl);
  }

  root.append(el('p', { class: 'gv-microcopy' }, 'A pace here is always one run\'s own time over its own distance.'));
}

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

module.exports = { render, runLine };
