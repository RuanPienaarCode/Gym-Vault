'use strict';
const assert = require('node:assert');
const { MUSIC_LINKS, openMusicApp } = require('../src/music-link');

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

console.log('music-link OK (scheme-then-https fallback, both keys, error paths)');
