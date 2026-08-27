'use strict';
/* Profile — who's training: basics, latest body stats, weight trend, and
   the measurement log. Static facts live in Profile.md frontmatter; every
   measurement is a dated row in Body Log.md. */

const { el, ico, fmt, fmtSeconds, sparkline } = require('./dom');
const { BODY_COLUMNS } = require('./constants');
const { todayISO, fmtShort } = require('./dates');
const { weightSeries, bmi, num } = require('./stats');
const { FormModal } = require('./modals');

function render(ctx, root) {
  const { data } = ctx;
  const fm = data.profile.fm || {};
  const series = weightSeries(data.body);
  const latest = latestStats(data.body);
  const currentYear = new Date().getFullYear();
  const age = num(fm.birth_year) ? currentYear - num(fm.birth_year) : null;

  /* Identity card. */
  const idCard = el('div', { class: 'gv-card gv-profile-card' },
    el('div', { class: 'gv-profile-avatar' }, ico('user')),
    el('div', { class: 'gv-profile-main' },
      el('div', { class: 'gv-profile-name' }, fm.name || 'Athlete'),
      el('div', { class: 'gv-profile-meta' }, [
        age !== null ? `${age} yrs` : null,
        num(fm.height_cm) ? `${fm.height_cm} cm` : null,
        latest.weight_kg ? `${latest.weight_kg} kg` : null,
        fm.sex || null,
      ].filter(Boolean).join(' · ') || 'Fill in your details')),
    el('div', { class: 'gv-card-actions' },
      iconBtn('pencil', 'Edit profile', () => openEditProfile(ctx))));
  root.append(idCard);

  /* Health tiles. */
  const bmiVal = bmi(latest.weight_kg, fm.height_cm);
  const tiles = el('div', { class: 'gv-tiles' },
    tile(ico('scale'), fmt(latest.weight_kg, ' kg'), 'weight'),
    tile(ico('activity'), fmt(bmiVal), 'BMI'),
    tile(ico('heart-pulse'), fmt(latest.resting_hr), 'resting HR'),
    tile(ico('ruler'), fmt(latest.waist_cm, ' cm'), 'waist'));
  /* Clinical tiles appear only once there's a reading — four permanent
     dashes would be noise for anyone who never logs bloods. */
  if (latest.bp_systolic && latest.bp_diastolic) {
    tiles.append(tile(ico('gauge'), `${latest.bp_systolic}/${latest.bp_diastolic}`, 'blood pressure'));
  }
  if (latest.cholesterol) tiles.append(tile(ico('test-tube'), fmt(latest.cholesterol), 'cholesterol'));
  if (latest.glucose) tiles.append(tile(ico('droplet'), fmt(latest.glucose), 'glucose'));
  root.append(tiles);

  /* Weight trend. */
  if (series.length >= 2) {
    const first = series[0].value, last = series[series.length - 1].value;
    const delta = Math.round((last - first) * 10) / 10;
    root.append(el('div', { class: 'gv-card gv-trend-card' },
      el('div', { class: 'gv-trend-head' },
        el('span', { class: 'gv-section-title-inline' }, 'Weight trend'),
        el('span', { class: `gv-trend-delta${delta < 0 ? ' downs' : delta > 0 ? ' ups' : ''}` },
          `${delta > 0 ? '+' : ''}${delta} kg since ${fmtShort(series[0].date)}`)),
      sparkline(series, 320, 72, 'Body weight trend')));
  }

  /* Measurement log + add. */
  root.append(el('div', { class: 'gv-toolbar' },
    el('div', { class: 'gv-toolbar-title' }, 'Body log'),
    el('button', { class: 'gv-btn', type: 'button', onclick: () => openAddMeasurement(ctx) },
      ico('plus'), el('span', {}, 'Measurement'))));

  if (!data.body.length) {
    root.append(el('div', { class: 'gv-empty-line' }, 'No measurements yet — log the first one to start the trend.'));
  } else {
    const list = el('div', { class: 'gv-card-list' });
    for (const r of [...data.body].reverse().slice(0, 12)) {
      const bits = BODY_COLUMNS
        .filter(c => c.key !== 'date' && c.key !== 'note' && r[c.key])
        .map(c => `${c.label.replace(/\s*\(.*\)/, '').toLowerCase()} ${r[c.key]}`);
      list.append(el('div', { class: 'gv-card gv-body-row' },
        el('div', { class: 'gv-body-date' }, fmtShort(r.date)),
        el('div', { class: 'gv-body-vals' }, bits.join(' · ') || '—'),
        r.note ? el('div', { class: 'gv-dim gv-body-note' }, r.note) : ''));
    }
    root.append(list);
    if (data.bodyFile) {
      const openBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' },
        ico('pencil'), el('span', {}, 'Open Body Log note'));
      openBtn.addEventListener('click', () => ctx.openFile(data.bodyFile));
      root.append(el('div', { class: 'gv-session-foot' }, openBtn));
    }
  }

  /* Training notes from the profile body (watch-outs, context). */
  const notes = (data.profile.body || '').trim();
  if (notes) {
    root.append(el('div', { class: 'gv-section-title' }, ico('clipboard-list'), el('span', {}, 'Training notes')));
    const noteCard = el('div', { class: 'gv-card gv-profile-notes' });
    for (const para of notes.split(/\n\s*\n/)) noteCard.append(el('p', {}, para.replace(/\n/g, ' ')));
    root.append(noteCard);
  }
}

function latestStats(rows) {
  /* Latest non-empty value per column — measurements are sparse and a new
     row shouldn't blank stats it didn't remeasure. */
  const out = {};
  for (const r of rows) for (const c of BODY_COLUMNS) if (r[c.key]) out[c.key] = r[c.key];
  return out;
}

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

function iconBtn(name, label, onClick) {
  const b = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': label }, ico(name));
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

function openEditProfile(ctx) {
  const fm = ctx.data.profile.fm || {};
  new FormModal(ctx.app, {
    title: 'Edit profile',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', value: fm.name || '' },
      { key: 'birth_year', label: 'Birth year', kind: 'number', value: fm.birth_year || '' },
      { key: 'height_cm', label: 'Height (cm)', kind: 'number', value: fm.height_cm || '' },
      { key: 'sex', label: 'Sex', kind: 'dropdown', options: [['', '—'], ['male', 'Male'], ['female', 'Female']], value: fm.sex || '' },
    ],
    onSubmit: async v => {
      const next = { ...fm, name: v.name.trim(), birth_year: v.birth_year, height_cm: v.height_cm, sex: v.sex };
      await ctx.io.saveProfile(next, ctx.data.profile.body);
      ctx.reload();
    },
  }).open();
}

function openAddMeasurement(ctx) {
  new FormModal(ctx.app, {
    title: 'Log measurement',
    fields: [
      { key: 'date', label: 'Date', kind: 'date', value: todayISO() },
      { key: 'weight_kg', label: 'Weight (kg)', kind: 'number' },
      { key: 'body_fat_pct', label: 'Body fat %', kind: 'number' },
      { key: 'waist_cm', label: 'Waist (cm)', kind: 'number' },
      { key: 'chest_cm', label: 'Chest (cm)', kind: 'number' },
      { key: 'hips_cm', label: 'Hips (cm)', kind: 'number' },
      { key: 'arm_cm', label: 'Arm (cm)', kind: 'number' },
      { key: 'thigh_cm', label: 'Thigh (cm)', kind: 'number' },
      { key: 'resting_hr', label: 'Resting heart rate', kind: 'number' },
      { key: 'bp_systolic', label: 'Blood pressure — systolic', kind: 'number' },
      { key: 'bp_diastolic', label: 'Blood pressure — diastolic', kind: 'number' },
      { key: 'cholesterol', label: 'Total cholesterol (mmol/L)', kind: 'number' },
      { key: 'glucose', label: 'Glucose (mmol/L)', kind: 'number' },
      { key: 'note', label: 'Note', kind: 'text' },
    ],
    submitLabel: 'Log',
    validate: v => (!v.date ? 'Pick a date.' : null),
    onSubmit: async v => { await ctx.io.appendBodyRow(v); ctx.reload(); },
  }).open();
}

module.exports = { render };
