'use strict';
/* One-tap jump out of guided mode into the user's music app to change the
   song, then back to Obsidian — never navigates the plugin's own view away.

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
   window.location — so this can never replace the guided session itself. */

const MUSIC_LINKS = {
  spotify: { scheme: 'spotify:', https: 'https://open.spotify.com' },
  'apple-music': { scheme: 'music://', https: 'https://music.apple.com' },
};

/* `win` is injected so this is testable with a bare fake object — no real
   DOM/window needed to prove the try-scheme-then-fall-back logic. Returns
   true if either window.open call returned a truthy result (best-effort
   signal only: a falsy return after the scheme attempt is the EXPECTED,
   harmless case on iOS just as much as it is "the scheme was blocked" — the
   OS can intercept a scheme navigation and hand back nothing at all, so
   this never treats that as an error worth surfacing to the user). */
function openMusicApp(key, win) {
  const target = MUSIC_LINKS[key];
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!target || !w || typeof w.open !== 'function') return false;

  let opened = null;
  try { opened = w.open(target.scheme); } catch (e) { opened = null; }
  if (!opened) {
    try { opened = w.open(target.https); } catch (e) { opened = null; }
  }
  return !!opened;
}

module.exports = { MUSIC_LINKS, openMusicApp };
