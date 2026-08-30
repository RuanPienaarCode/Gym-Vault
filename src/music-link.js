'use strict';
/* One-tap jump out of guided mode into the user's music app — to open the
   app, or to start a specific playlist — then back to Obsidian. It never
   navigates the plugin's own view away.

   Two ways in, tried in order:
     1. A custom URL scheme (`spotify:`, `music://`) opens the app directly
        when the OS/webview honours it.
     2. An https "universal link" (`open.spotify.com`, `music.apple.com`)
        that iOS bounces into the installed app when it's present, or opens
        in the browser/web player when it isn't.

   Expected behaviour:
     - iOS (WKWebView, the real floor here): scheme navigation from inside a
       WKWebView is silently blocked on some Obsidian mobile builds, so it
       is tried first and cheaply discarded — the https universal link is
       what actually does the work, bouncing Safari's link handler into the
       installed Spotify/Music app.
     - Desktop (Electron/Chromium): the custom scheme usually DOES fire (OS
       handles it via a registered protocol handler) and nothing further
       happens; when it doesn't, the https fallback opens the web player in
       a new tab/window.
   Either path is a NEW window/tab/app — window.open, never
   window.location — so this can never replace the guided session itself.

   PLAYLISTS: the user pastes a share link in settings and this module turns
   it into the same {scheme, https} pair, so a saved playlist opens by
   exactly the mechanism above with no second code path. Parsing is
   deliberately strict — anything it does not recognise is rejected at the
   settings field, where the user can still see what they pasted, rather than
   being stored and silently failing months later mid-session. */

const MUSIC_LINKS = {
  spotify: { scheme: 'spotify:', https: 'https://open.spotify.com' },
  'apple-music': { scheme: 'music://', https: 'https://music.apple.com' },
};

/* What a Spotify share link can point at. Anything outside this list is not
   something you can play, so it is not a playlist link. */
const SPOTIFY_KINDS = 'playlist|album|track|artist|show|episode';

/* `intl-de/` and friends appear in links copied from a localised client;
   they carry no meaning for playback. No lookbehind anywhere in this file —
   a lookbehind literal is a parse-time SyntaxError on iOS 15 and would kill
   the whole bundle at load (see tests/ios-hazards.test.cjs). */
const SPOTIFY_URL = new RegExp(
  `^https?://open\\.spotify\\.com/(?:intl-[a-z-]+/)?(${SPOTIFY_KINDS})/([A-Za-z0-9]+)`, 'i');
const SPOTIFY_URI = new RegExp(`^spotify:(${SPOTIFY_KINDS}):([A-Za-z0-9]+)$`, 'i');
const APPLE_URL = /^https?:\/\/music\.apple\.com\/([^\s?#]+)/i;
const APPLE_URI = /^music:\/\/music\.apple\.com\/([^\s?#]+)/i;

/* A share link → {app, kind, id, scheme, https}, or null if it isn't one.

   The `?si=…` share token every Spotify copy-link carries is DROPPED: it
   identifies the person who shared the link, the playlist opens fine
   without it, and there is no reason for this vault to store it. */
function parseMusicTarget(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  let m = raw.match(SPOTIFY_URL) || raw.match(SPOTIFY_URI);
  if (m) {
    const kind = m[1].toLowerCase();
    const id = m[2];
    return {
      app: 'spotify', kind, id,
      scheme: `spotify:${kind}:${id}`,
      https: `https://open.spotify.com/${kind}/${id}`,
    };
  }

  m = raw.match(APPLE_URL) || raw.match(APPLE_URI);
  if (m) {
    /* Apple's universal links map to the app by swapping the protocol and
       keeping the path verbatim, so there is nothing to pick apart — but the
       path DOES carry the playlist id, so it must survive intact. */
    const path = m[1].replace(/\/+$/, '');
    if (!path) return null;
    return {
      app: 'apple-music', kind: null, id: path,
      scheme: `music://music.apple.com/${path}`,
      https: `https://music.apple.com/${path}`,
    };
  }

  return null;
}

/* True when a pasted string is something this app can open. The settings
   field uses this to refuse junk at the point of entry. */
const isMusicUrl = url => parseMusicTarget(url) !== null;

/* The one opener. `win` is injected so this is testable with a bare fake
   object — no real DOM/window needed to prove the try-scheme-then-fall-back
   logic. Returns true if either window.open call returned a truthy result
   (best-effort signal only: a falsy return after the scheme attempt is the
   EXPECTED, harmless case on iOS just as much as it is "the scheme was
   blocked" — the OS can intercept a scheme navigation and hand back nothing
   at all, so this never treats that as an error worth surfacing). */
function openTarget(target, win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!target || !w || typeof w.open !== 'function') return false;

  let opened = null;
  if (target.scheme) {
    try { opened = w.open(target.scheme); } catch (e) { opened = null; }
  }
  if (!opened && target.https) {
    try { opened = w.open(target.https); } catch (e) { opened = null; }
  }
  return !!opened;
}

/* Open the app itself (the settings dropdown's choice), no particular
   playlist. */
function openMusicApp(key, win) {
  return openTarget(MUSIC_LINKS[key], win);
}

/* Open one saved playlist. The stored `url` is re-parsed at open time rather
   than trusting a stored scheme: settings files get hand-edited and synced
   between devices, and a link that no longer parses should fail here, where
   it can be reported, instead of being handed to window.open unchecked. */
function openPlaylist(playlist, win) {
  const target = parseMusicTarget(playlist && playlist.url);
  if (!target) return false;
  return openTarget(target, win);
}

/* Which of the settings dropdown's app keys a saved playlist belongs to —
   lets the picker group and label saved links without re-parsing at render
   time in every caller. */
const APP_LABELS = { spotify: 'Spotify', 'apple-music': 'Apple Music' };
const appLabel = app => APP_LABELS[app] || 'Music';

module.exports = {
  MUSIC_LINKS, APP_LABELS, appLabel,
  parseMusicTarget, isMusicUrl, openTarget, openMusicApp, openPlaylist,
};
