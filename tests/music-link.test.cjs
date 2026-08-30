'use strict';
const assert = require('node:assert');
const { MUSIC_LINKS, openMusicApp, parseMusicTarget, isMusicUrl, openPlaylist, appLabel } = require('../src/music-link');

/* Fake `window.open`: records every call, and its return value per call is
   controlled by the test (mimics the OS intercepting a scheme navigation
   and handing back nothing, vs. a real tab/window object). */
function fakeWin(returns) {
  const calls = [];
  let i = 0;
  return {
    calls,
    open(url) {
      calls.push(url);
      const r = returns[i];
      i += 1;
      if (r === 'throw') throw new Error('blocked');
      return r;
    },
  };
}

/* Unknown key: no-op, never calls window.open. */
{
  const w = fakeWin([]);
  assert.strictEqual(openMusicApp('none', w), false);
  assert.strictEqual(openMusicApp('nonsense', w), false);
  assert.deepStrictEqual(w.calls, [], 'unknown key must never touch window.open');
}

/* Scheme succeeds: the https fallback is never tried. */
{
  const w = fakeWin([{}]);
  assert.strictEqual(openMusicApp('spotify', w), true);
  assert.deepStrictEqual(w.calls, [MUSIC_LINKS.spotify.scheme], 'a truthy scheme open must short-circuit the https fallback');
}

/* Scheme returns falsy (the expected iOS shape — the OS intercepted it and
   handed back nothing): falls through to the https universal link. */
{
  const w = fakeWin([null, {}]);
  assert.strictEqual(openMusicApp('spotify', w), true);
  assert.deepStrictEqual(w.calls, [MUSIC_LINKS.spotify.scheme, MUSIC_LINKS.spotify.https]);
}

/* Scheme THROWS (a WKWebView hard-blocking custom-scheme navigation): still
   falls through to https rather than propagating the error. */
{
  const w = fakeWin(['throw', {}]);
  assert.strictEqual(openMusicApp('apple-music', w), true);
  assert.deepStrictEqual(w.calls, [MUSIC_LINKS['apple-music'].scheme, MUSIC_LINKS['apple-music'].https]);
}

/* Both calls come back falsy: reports false, but MUST have tried both — a
   version that gives up after the scheme attempt would never reach the
   universal link, which is the one that actually works on iOS. */
{
  const w = fakeWin([null, null]);
  assert.strictEqual(openMusicApp('spotify', w), false);
  assert.deepStrictEqual(w.calls, [MUSIC_LINKS.spotify.scheme, MUSIC_LINKS.spotify.https], 'must attempt the https fallback even when the scheme attempt is falsy');
}

/* No window/open available (defensive — should never happen inside
   Obsidian, but must not throw). */
{
  assert.strictEqual(openMusicApp('spotify', null), false);
  assert.strictEqual(openMusicApp('spotify', {}), false);
}

/* NEGATIVE CONTROL — prove the test actually exercises the fallback order:
   an implementation that tries https FIRST would produce a different call
   order than openMusicApp for the "scheme throws" case above. */
{
  function naiveHttpsFirst(key, win) {
    const target = MUSIC_LINKS[key];
    const calls = [];
    try { calls.push(win.open(target.https)); } catch (e) { /* noop */ }
    return calls;
  }
  const w = fakeWin(['throw', {}]);
  naiveHttpsFirst('apple-music', w);
  assert.notDeepStrictEqual(w.calls, [MUSIC_LINKS['apple-music'].scheme, MUSIC_LINKS['apple-music'].https],
    'sanity: an https-first implementation must disagree with the scheme-first call order');
}

/* ---------- saved playlists ---------- */

/* A Spotify share link becomes the same {scheme, https} pair the app-root
   buttons use, so playlists open by exactly one mechanism. */
{
  const t = parseMusicTarget('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.strictEqual(t.app, 'spotify');
  assert.strictEqual(t.kind, 'playlist');
  assert.strictEqual(t.id, '37i9dQZF1DXcBWIGoYBM5M');
  assert.strictEqual(t.scheme, 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.strictEqual(t.https, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
}

/* The `?si=` token on every copied Spotify link identifies the person who
   shared it. It is dropped: the playlist opens fine without it, and there is
   no reason to keep it in the user's settings file. */
{
  const t = parseMusicTarget('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123&pt=x');
  assert.strictEqual(t.https, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.ok(!t.scheme.includes('si='), 'the share token must not survive into the scheme either');
}

/* A link copied from a localised client carries an `intl-xx` segment that
   means nothing for playback. */
{
  const t = parseMusicTarget('https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3');
  assert.strictEqual(t.kind, 'album');
  assert.strictEqual(t.id, '1DFixLWuPkv3KT3TnV35m3');
}

/* Every playable Spotify kind, plus a raw URI pasted straight from the app. */
{
  for (const kind of ['playlist', 'album', 'track', 'artist', 'show', 'episode']) {
    const t = parseMusicTarget(`https://open.spotify.com/${kind}/abc123XYZ`);
    assert.strictEqual(t && t.kind, kind, `${kind} links must parse`);
  }
  const uri = parseMusicTarget('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.strictEqual(uri.scheme, 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.strictEqual(uri.https, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    'a pasted URI still gets the https fallback iOS actually needs');
}

/* Apple Music maps by swapping the protocol and keeping the path — and the
   path is where the playlist id lives, so it has to survive intact. */
{
  const t = parseMusicTarget('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb');
  assert.strictEqual(t.app, 'apple-music');
  assert.strictEqual(t.scheme, 'music://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb');
  assert.strictEqual(t.https, 'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb');
  assert.strictEqual(parseMusicTarget('music://music.apple.com/us/playlist/x/pl.abc').app, 'apple-music');
}

/* Junk is refused at the point of entry rather than stored and failing
   silently mid-session months later. */
{
  for (const bad of [
    '', '   ', null, undefined,
    'not a url',
    'https://example.com/playlist/123',
    'https://open.spotify.com/',
    'https://open.spotify.com/user/someone',        // not a playable kind
    'https://music.apple.com',                      // no path, nothing to open
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.strictEqual(parseMusicTarget(bad), null, `must refuse: ${JSON.stringify(bad)}`);
    assert.strictEqual(isMusicUrl(bad), false);
  }
  assert.strictEqual(isMusicUrl('https://open.spotify.com/playlist/abc123'), true);
}

/* A saved playlist opens through the same scheme-then-https ladder. */
{
  const w = fakeWin([null, {}]);
  const pl = { name: 'Beast Mode', url: 'https://open.spotify.com/playlist/abc123?si=zzz' };
  assert.strictEqual(openPlaylist(pl, w), true);
  assert.deepStrictEqual(w.calls, ['spotify:playlist:abc123', 'https://open.spotify.com/playlist/abc123']);
}

/* A stored link that no longer parses fails HERE, where it can be reported —
   settings files get hand-edited and synced between devices, so the stored
   url is re-parsed at open time rather than trusted. */
{
  const w = fakeWin([{}]);
  assert.strictEqual(openPlaylist({ name: 'Broken', url: 'https://example.com/x' }, w), false);
  assert.strictEqual(openPlaylist(null, w), false);
  assert.strictEqual(openPlaylist({ name: 'No url' }, w), false);
  assert.deepStrictEqual(w.calls, [], 'an unparseable link must never reach window.open');
}

{
  assert.strictEqual(appLabel('spotify'), 'Spotify');
  assert.strictEqual(appLabel('apple-music'), 'Apple Music');
  assert.strictEqual(appLabel('who-knows'), 'Music');
}

/* iOS 15 floor: no lookbehind anywhere, including inside the RegExp strings
   this module builds at load time (a bad pattern there throws on
   construction and takes the whole bundle down at import). */
{
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'music-link.js'), 'utf8');
  assert.ok(!src.includes('(?<'), 'lookbehind is a parse-time SyntaxError on iOS 15');
}

console.log('music-link OK (scheme-then-https fallback, both keys, error paths, playlist parsing)');
