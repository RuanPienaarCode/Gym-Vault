'use strict';
/* The music control, shared by the guided session's top bar and the setup
   screen. One module so the two can never offer different lists.

   music-link.js owns WHAT a link is and how to open it; this owns WHERE the
   choice is presented. Obsidian's own Menu is used rather than a hand-rolled
   popover: it already handles mobile placement, dismissal and the safe-area
   inset, and a bespoke menu would be one more surface to get wrong on a
   phone. */

const { Menu } = require('obsidian');
const { el, ico } = require('./dom');
const { openMusicApp, openPlaylist, parseMusicTarget, appLabel } = require('./music-link');

/* Everything the user could pick right now, in menu order: the app itself
   first (it is the one that always works), then their saved links.

   A saved link whose url no longer parses is DROPPED here rather than shown
   and failing on tap — settings files get hand-edited and synced, and a
   playlist that silently does nothing mid-session is worse than one that
   isn't offered. Settings is where a broken link is reported; see
   settings-tab.js. */
function musicChoices(settings) {
  const out = [];
  const app = settings && settings.musicApp;
  if (app && app !== 'none') {
    out.push({ kind: 'app', key: app, label: `Open ${appLabel(app)}`, icon: 'music' });
  }
  for (const pl of ((settings && settings.playlists) || [])) {
    if (!pl || !pl.name || !parseMusicTarget(pl.url)) continue;
    out.push({ kind: 'playlist', playlist: pl, label: pl.name, icon: 'list-music' });
  }
  return out;
}

/* Fire one choice. Returns music-link's best-effort opened flag. */
function openChoice(choice) {
  if (!choice) return false;
  if (choice.kind === 'playlist') return openPlaylist(choice.playlist, null);
  return openMusicApp(choice.key, null);
}

/* Present the choices. One choice is not a menu — it opens straight away,
   which is what "tap the music button" should do when there is nothing to
   choose between. */
function showMusicMenu(ctx, evt, choices) {
  const list = choices || musicChoices(ctx.settings);
  if (!list.length) return;
  if (list.length === 1) { openChoice(list[0]); return; }

  const menu = new Menu();
  for (const choice of list) {
    menu.addItem(item => item
      .setTitle(choice.label)
      .setIcon(choice.icon)
      .onClick(() => openChoice(choice)));
  }
  /* showAtMouseEvent covers touch too (Obsidian normalises it); the position
     fallback keeps a keyboard activation — which has no coordinates — from
     dropping the menu in the top-left corner of the screen. */
  try {
    if (evt && (evt.clientX || evt.clientY)) menu.showAtMouseEvent(evt);
    else if (evt && evt.currentTarget && evt.currentTarget.getBoundingClientRect) {
      const r = evt.currentTarget.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.bottom });
    } else menu.showAtPosition({ x: 0, y: 0 });
  } catch (e) {
    /* A menu that will not open must not take the session down with it. */
    console.error('gym-vault music menu', e);
    openChoice(list[0]);
  }
}

/* The guided view's corner button. Returns null when there is nothing to
   offer, so the caller renders no button at all rather than a dead one.
   Reuses .gv-icon-btn-small for the existing 44px/40px mobile touch-target
   rules and app-anchored colors — no new CSS. */
function musicButton(ctx) {
  const choices = musicChoices(ctx.settings);
  if (!choices.length) return null;
  const label = choices.length === 1 ? choices[0].label : 'Music';
  const btn = el('button', {
    class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': label,
  }, ico('music'));
  btn.addEventListener('click', evt => showMusicMenu(ctx, evt, choices));
  return btn;
}

/* The setup screen's row: same choices, but named and with room to say what
   tapping does. Null when there is nothing saved and no app chosen. */
function musicRow(ctx) {
  const choices = musicChoices(ctx.settings);
  if (!choices.length) return null;
  const sub = choices.length === 1
    ? choices[0].label
    : `${appLabel(ctx.settings.musicApp)} · ${choices.length - 1} saved`;
  const row = el('button', { class: 'gv-card gv-optrow gv-setup-music', type: 'button' },
    el('div', { class: 'gv-optrow-main' },
      el('div', { class: 'gv-optrow-name' }, 'Music'),
      el('div', { class: 'gv-optrow-desc' }, `${sub} — starts playing in your music app, then come back here.`)),
    ico('music'));
  row.addEventListener('click', evt => showMusicMenu(ctx, evt, choices));
  return row;
}

module.exports = { musicChoices, openChoice, showMusicMenu, musicButton, musicRow };
