'use strict';
/* Profile — who's training: basics, latest body stats, weight trend, and
   the measurement log. Static facts live in Profile.md frontmatter; every
   measurement is a dated row in Body Log.md. */

const { el, ico, clear, fmt, fmtSeconds, sparkline, clickableCard } = require('./dom');
const { progressOf } = require('./voice-pack');
const sound = require('./sound');
const { BODY_COLUMNS } = require('./constants');
const { todayISO, fmtShort } = require('./dates');
const { weightSeries, bmi, num } = require('./stats');
const { FormModal } = require('./modals');
const { POSES, poseSummary, beforeAfter, photosForPose } = require('./progress-photos');
const { PhotoCaptureModal } = require('./photo-capture');
const { renderPhotoViewer } = require('./photo-viewer');

function render(ctx, root) {
  const { data } = ctx;
  const fm = data.profile.fm || {};
  const series = weightSeries(data.body);
  const latest = latestStats(data.body);
  const currentYear = new Date().getFullYear();
  const age = num(fm.birth_year) ? currentYear - num(fm.birth_year) : null;

  /* Profile has no toolbar of its own (the identity card doubles as the
     header) — this page had zero headings before, so the primary title is a
     new addition rather than a promoted existing element, unlike the other
     six pages in this pass. */
  root.append(el('h2', { class: 'gv-toolbar-title' }, 'Profile'));

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

  /* Progress photos and the recorder both live here, UNCONDITIONALLY. The
     photos call used to sit inside the training-notes branch below, so a
     profile whose note body was empty never showed the camera at all. */
  renderPhotos(ctx, root);
  renderVoiceLink(ctx, root);

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


/* ---- progress photos ------------------------------------------------- */

/* Photos are BINARY and are fetched separately from loadAll(), so this
   section renders its shell synchronously and fills in when the listing
   lands. Guarding on isConnected matters: the user can leave Profile before
   the vault answers, and writing into a detached node is how a "why is this
   blank" bug starts. */
/* The way into the recorder from inside the app. Settings has a button too,
   but Profile is where "who is training" lives, and whose voice counts you
   in is part of that. */
function renderVoiceLink(ctx, root) {
  const p = progressOf(sound.clipKeys());
  const on = (ctx.settings.soundMode || 'voice') === 'custom';
  root.append(el('div', { class: 'gv-section-title' }, ico('mic'), el('span', {}, 'Your voice')));
  root.append(clickableCard(
    { class: 'gv-card gv-optrow gv-voice-link', 'aria-label': 'Open the voice recorder' },
    () => ctx.nav('voice'),
    el('div', { class: 'gv-optrow-main' },
      el('div', { class: 'gv-optrow-name' }, 'Count yourself in'),
      el('div', { class: 'gv-optrow-desc' },
        p.recorded
          ? `${p.recorded} of ${p.total} recorded${on ? ' · in use' : ' · not in use yet'}`
          : 'Record the count-in, the rep counts and the celebrations in your own voice.')),
    ico('chevron-right', 'gv-dim')));
}

function renderPhotos(ctx, root) {
  const ui = ctx.state.photosUi || (ctx.state.photosUi = { pose: 'standing' });

  root.append(el('div', { class: 'gv-toolbar' },
    el('h3', { class: 'gv-section-title' }, ico('camera'), el('span', {}, 'Progress photos'))));

  const body = el('div', { class: 'gv-photos-section' },
    el('div', { class: 'gv-dim' }, 'Loading photos…'));
  root.append(body);

  ctx.io.listPhotos().then(entries => {
    if (!body.isConnected) return;
    paint(ctx, body, entries, ui);
  }).catch(e => {
    if (!body.isConnected) return;
    clear(body);
    body.append(el('div', { class: 'gv-empty-line' }, `Could not read your photos — ${(e && e.message) || e}`));
  });
}

function paint(ctx, body, entries, ui) {
  clear(body);
  /* Any earlier viewer's play timer must die before we build another, or two
     dissolves run against the same stage. */
  if (ctx.state.pageCleanup) { ctx.state.pageCleanup(); ctx.state.pageCleanup = null; }

  const summary = poseSummary(entries);
  const chips = el('div', { class: 'gv-chips' });
  for (const { pose, count } of summary) {
    const c = el('button', {
      class: `gv-chip${ui.pose === pose.key ? ' on' : ''}`, type: 'button',
      'aria-pressed': ui.pose === pose.key ? 'true' : 'false',
    }, el('span', {}, count ? `${pose.label} · ${count}` : pose.label));
    c.addEventListener('click', () => { ui.pose = pose.key; paint(ctx, body, entries, ui); });
    chips.append(c);
  }
  body.append(chips);

  const list = photosForPose(entries, ui.pose);
  const pair = beforeAfter(entries, ui.pose);

  const shoot = el('button', { class: 'gv-btn', type: 'button' },
    ico('camera'), el('span', {}, list.length ? 'New photo' : 'First photo'));
  shoot.addEventListener('click', () => openCapture(ctx, ui.pose, list, body, entries, ui));
  body.append(el('div', { class: 'gv-photo-viewer-actions' }, shoot));

  if (!list.length) {
    body.append(el('div', { class: 'gv-empty-line' },
      'No photos in this pose yet — the first one becomes the "before".'));
    return;
  }

  const stage = el('div', { class: 'gv-photos-viewer' });
  body.append(stage);
  ctx.state.pageCleanup = renderPhotoViewer(stage, {
    entries, pose: ui.pose, srcOf: f => ctx.io.photoSrc(f),
  });

  if (pair) {
    body.append(el('div', { class: 'gv-photo-caption gv-dim' },
      `${pair.count} photos · ${fmtShort(pair.before.date)} → ${fmtShort(pair.after.date)}`));
  } else {
    body.append(el('div', { class: 'gv-photo-caption gv-dim' },
      'One photo so far — take another to see the change.'));
  }
}

function openCapture(ctx, pose, list, body, entries, ui) {
  const previous = list.length ? list[list.length - 1] : null;
  new PhotoCaptureModal(ctx.app, {
    pose,
    ghostSrc: previous ? ctx.io.photoSrc(previous.file) : null,
    onCaptured: async (bytes, dateISO) => {
      try {
        await ctx.io.savePhoto(pose, dateISO, bytes);
        ctx.notice('progress photo saved.');
        const fresh = await ctx.io.listPhotos();
        if (body.isConnected) paint(ctx, body, fresh, ui);
      } catch (e) {
        ctx.notice(`could not save that photo — ${(e && e.message) || e}`);
      }
    },
  }).open();
}

module.exports = { render };
