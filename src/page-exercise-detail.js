'use strict';
/* Exercise detail — the library page for one exercise: media (image or
   video), how-to (the note body, rendered as real markdown so embeds and
   lists work), your bests, and recent sets.

   Media contract (documented in README): the exercise note's frontmatter may
   carry `image:` and/or `video:` — either a vault path or an https URL.
   Vault files resolve through getResourcePath (offline, synced with the
   vault); https URLs load when online and degrade to a quiet placeholder
   offline. Images embedded in the note body render too, via the markdown
   pass. */

const { MarkdownRenderer } = require('obsidian');
const { el, ico, fmt, fmtSeconds } = require('./dom');
const { exerciseBests, epley1RM, sameName } = require('./stats');
const { fmtShort } = require('./dates');
const { editExercise } = require('./page-exercises');

const isUrl = v => /^https?:\/\//i.test(v || '');
/* A URL the <video> tag can play directly (vs. a page link like YouTube). */
const isDirectVideo = v => /\.(mp4|m4v|mov|webm)(\?|#|$)/i.test(v || '');

/* Resolve a vault media value: plain path, or the `[[wikilink]]` an
   Obsidian user will naturally type (resolved the way Obsidian resolves
   links, relative to the exercise note). */
function vaultFile(ctx, value, sourcePath) {
  const wl = (value || '').match(/^\[\[(.+?)(\|.*)?\]\]$/);
  if (wl) return ctx.app.metadataCache.getFirstLinkpathDest(wl[1].trim(), sourcePath || '');
  return ctx.app.vault.getFileByPath(value);
}

function render(ctx, root) {
  const name = ctx.state.params && ctx.state.params.exercise;
  const ex = ctx.data.exercises.find(e => e.name === name);
  if (!ex) { ctx.nav('exercises'); return; }

  /* Toolbar */
  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Back to exercises' }, ico('arrow-left'));
  back.addEventListener('click', () => ctx.nav('exercises'));
  root.append(el('div', { class: 'gv-toolbar' },
    back,
    el('h2', { class: 'gv-toolbar-title' }, ex.name),
    el('div', { class: 'gv-toolbar-actions' },
      el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => editExercise(ctx, ex) },
        ico('pencil'), el('span', {}, 'Edit')),
      el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', onclick: () => ctx.openFile(ex.file) },
        ico('search'), el('span', {}, 'Note')))));

  /* Tags */
  const muscles = Array.isArray(ex.fm.muscles) ? ex.fm.muscles : ex.fm.muscles ? [ex.fm.muscles] : [];
  root.append(el('div', { class: 'gv-chips gv-detail-tags' },
    el('span', { class: 'gv-tag gv-tag-type' }, ex.fm.type || 'strength'),
    ...muscles.map(m => el('span', { class: 'gv-tag' }, m)),
    ex.fm.equipment ? el('span', { class: 'gv-tag' }, ex.fm.equipment) : '',
    el('span', { class: 'gv-tag' }, `tracked in ${ex.fm.unit || 'reps'}`)));

  /* Media */
  const media = mediaBlock(ctx, ex);
  if (media) root.append(media);

  /* Bests */
  const bests = exerciseBests(ctx.data.workouts, ex.name);
  const orm = epley1RM(bests.weight, bests.reps);
  const isRun = (ex.fm.unit || '') === 'km';
  /* A run has no "best weight" or 1RM — showing those as dashes is noise.
     Longest time is deliberately NOT divided by longest distance to make a
     pace: they can come from different runs, and two figures derived by
     different rules is exactly how this codebase grows wrong numbers. */
  root.append(isRun
    ? el('div', { class: 'gv-tiles' },
        tile(ico('trophy'), fmt(bests.distance, ' km'), 'longest run'),
        tile(ico('timer'), bests.seconds !== null ? fmtSeconds(bests.seconds) : '—', 'longest time'),
        tile(ico('chart-line'), bests.totalDistance ? `${bests.totalDistance} km` : '—', 'total logged'),
        tile(ico('history'), bests.lastDate ? fmtShort(bests.lastDate) : '—', 'last run'))
    : el('div', { class: 'gv-tiles' },
        tile(ico('trophy'), fmt(bests.reps), 'best reps'),
        tile(ico('dumbbell'), fmt(bests.weight, ' kg'), 'best weight'),
        tile(ico('timer'), bests.seconds !== null ? fmtSeconds(bests.seconds) : '—', 'best hold'),
        orm !== null
          ? tile(ico('chart-line'), `${orm} kg`, 'est. 1RM')
          : tile(ico('history'), bests.lastDate ? fmtShort(bests.lastDate) : '—', 'last done')));

  /* How-to (note body as markdown) */
  const body = (ex.body || '').trim();
  root.append(el('div', { class: 'gv-section-title' }, ico('clipboard-list'), el('span', {}, 'How to')));
  const howto = el('div', { class: 'gv-card gv-howto' });
  if (!body) {
    howto.append(el('div', { class: 'gv-dim' }, 'No instructions yet — add them to the note (steps, cues, anything).'));
  } else if (MarkdownRenderer && MarkdownRenderer.render) {
    MarkdownRenderer.render(ctx.app, body, howto, ex.file ? ex.file.path : '', ctx.view)
      .catch(e => { console.error('gym-vault howto render', e); howto.append(el('div', {}, body)); });
  } else {
    for (const para of body.split(/\n\s*\n/)) howto.append(el('p', {}, para));
  }
  root.append(howto);

  /* Recent sets */
  const recent = recentSessions(ctx.data.workouts, ex.name, 5);
  if (recent.length) {
    root.append(el('div', { class: 'gv-section-title' }, ico('history'), el('span', {}, 'Recent')));
    const listEl = el('div', { class: 'gv-card gv-set-table gv-detail-recent' });
    for (const r of recent) {
      listEl.append(el('div', { class: 'gv-set-ex' }, `${fmtShort(r.date)}${r.day ? ` · ${r.day}` : ''}`));
      listEl.append(el('div', { class: 'gv-set-row' }, el('span', {}, r.summary)));
    }
    root.append(listEl);
  }
}

/* Resolve an exercise's `image:` frontmatter into displayable frames —
   [{src, tag}], in order. Shared with page-session.js (the guided view) so
   both pages agree on vault-path / wikilink / https resolution and the
   free-exercise-db two-frame (start→finish) convention; unresolvable entries
   are simply dropped, same as the DOM callers that render them. DOM building
   (the actual <img> nodes, their offline error handling) stays local to each
   caller — this only resolves URLs. */
function resolveExerciseImages(ctx, ex) {
  const images = (Array.isArray(ex.fm.image) ? ex.fm.image : ex.fm.image ? [ex.fm.image] : [])
    .map(s => s.toString().trim()).filter(Boolean);
  /* Notes seeded before multi-frame support hold only the 0.jpg of a
     free-exercise-db pair; derive the finish frame instead of asking anyone
     to migrate files. A missing sibling just drops (unresolvable → filtered
     below, same as any other dead link). */
  if (images.length === 1 && /^https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/.+\/0\.jpg$/.test(images[0])) {
    images.push(images[0].replace(/0\.jpg$/, '1.jpg'));
  }
  const srcPath = ex.file ? ex.file.path : '';
  const pair = images.length === 2; // the classic start/finish pair
  const out = [];
  images.forEach((image, i) => {
    const src = isUrl(image)
      ? image
      : (() => { const f = vaultFile(ctx, image, srcPath); return f ? ctx.app.vault.getResourcePath(f) : null; })();
    if (!src) return;
    out.push({ src, tag: pair ? (i === 0 ? 'start' : 'finish') : String(i + 1) });
  });
  return out;
}

function mediaBlock(ctx, ex) {
  const images = resolveExerciseImages(ctx, ex);
  const video = (ex.fm.video || '').toString().trim();
  if (!images.length && !video) return null;
  const wrap = el('div', { class: 'gv-card gv-media' });

  /* Vault video files and direct remote media both get a real player;
     anything else video-shaped (a YouTube page, say) gets a link button. A
     remote stream that errors (offline, moved) swaps to the button. */
  const srcPath = ex.file ? ex.file.path : '';
  const videoSrc = !video ? null
    : isUrl(video) ? (isDirectVideo(video) ? video : null)
    : (() => { const f = vaultFile(ctx, video, srcPath); return f ? ctx.app.vault.getResourcePath(f) : null; })();
  if (videoSrc) {
    const player = el('video', { class: 'gv-media-video', src: videoSrc, controls: '', playsinline: '', preload: 'metadata' });
    player.addEventListener('error', () => {
      player.replaceWith(isUrl(video) ? watchBtn(video) :
        el('div', { class: 'gv-media-missing' }, ico('play'), el('span', {}, 'Video unavailable')));
    });
    wrap.append(player);
  }
  if (images.length) {
    const frames = el('div', { class: 'gv-media-frames' });
    const pair = images.length === 2 && images[0].tag === 'start'; // the classic start/finish pair
    let alive = images.length; // resolveExerciseImages already dropped anything unresolvable
    images.forEach(({ src, tag }) => {
      const frame = el('div', { class: 'gv-media-frame' },
        el('img', { class: 'gv-media-img', src, alt: `${ex.name} — ${pair ? tag + ' position' : `view ${tag}`}`, loading: 'lazy' }),
        el('span', { class: 'gv-media-frame-tag' }, tag));
      /* Offline / dead link: drop the frame quietly; one placeholder for the
         whole row once every frame has failed — never a broken-image glyph. */
      frame.querySelector('img').addEventListener('error', () => {
        frame.remove();
        if (--alive <= 0 && frames.isConnected) {
          frames.replaceWith(el('div', { class: 'gv-media-missing' }, ico('dumbbell'), el('span', {}, 'Images unavailable offline')));
        }
      });
      frames.append(frame);
    });
    if (frames.childNodes.length) wrap.append(frames);
  }
  if (video && isUrl(video) && !isDirectVideo(video)) wrap.append(watchBtn(video));
  return wrap.childNodes.length ? wrap : null;
}

function watchBtn(url) {
  const btn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small gv-media-watch', type: 'button' },
    ico('play'), el('span', {}, 'Watch video'));
  btn.addEventListener('click', () => window.open(url));
  return btn;
}

function recentSessions(workouts, exercise, n) {
  const out = [];
  for (let i = workouts.length - 1; i >= 0 && out.length < n; i--) {
    const w = workouts[i];
    const sets = (w.rows || []).filter(r => sameName(r.exercise, exercise));
    if (!sets.length) continue;
    const summary = sets.map(r => {
      if (r.distance_km) return `${r.distance_km} km${r.seconds ? ' · ' + fmtSeconds(r.seconds) : ''}`;
      if (r.seconds) return fmtSeconds(r.seconds);
      return r.weight_kg ? `${r.reps || '?'}×${r.weight_kg}kg` : `${r.reps || '?'}`;
    }).join('  ·  ');
    out.push({ date: w.fm.date || '', day: w.fm.day || '', summary });
  }
  return out;
}

function tile(icon, big, label) {
  return el('div', { class: 'gv-tile' },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

module.exports = { render, resolveExerciseImages };
