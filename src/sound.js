'use strict';
/* THE ONE PLACE THIS APP MAKES A NOISE.

   Before this module there was `speak()` in rep-counter-shared.js and eleven
   call sites that each decided for themselves whether to call it. Adding a
   second way to be told a rep landed would have meant editing all eleven —
   which is how a rep gets a beep and a record does not, and how the freestyle
   counter ends up sounding different from the guided one. So: every
   announcement in the app goes through announce() or cue() here, and the
   MODE decision happens once, in one function, against one settings value.

   THREE THINGS ARE HARD, AND ALL THREE ARE THE PLATFORM'S FAULT:

   1. iOS unlocks audio only from inside a real user-gesture call stack —
      speechSynthesis AND AudioContext both. Every announcement in this app
      historically came straight out of a tap handler, which is why it has
      always worked; timed mode is the exception (it fires on a timer) and
      page-session-setup.js's beginSession exists in the shape it does purely
      to keep the Start tap's stack intact. unlock() is that hook, and it is
      idempotent so a caller can be paranoid for free.

   2. Voices load asynchronously. getVoices() returns [] on the first call in
      several engines and fills in later, on a `voiceschanged` event. A
      settings dropdown that reads it once ships empty.

   3. The device may simply not do what the user asked for. iOS WebKit has no
      navigator.vibrate at all; a locked-down engine may have no WebAudio. So
      a stored mode is a REQUEST, not a fact: resolveMode() turns it into
      what will actually happen, and callers never see the difference.

   The decisions are pure and exported for the guard suite; only the bottom
   third of this file touches a device API. */

/* ---------- capabilities (the only device probing that happens) ---------- */

function capabilities() {
  const w = typeof window === 'undefined' ? null : window;
  return {
    speech: !!(w && w.speechSynthesis && w.SpeechSynthesisUtterance),
    audio: !!(w && (w.AudioContext || w.webkitAudioContext)),
    vibrate: !!(typeof navigator !== 'undefined' && navigator && typeof navigator.vibrate === 'function'),
  };
}

/* ---------- pure decisions ---------- */

const MODES = ['voice', 'beep', 'vibrate', 'silent'];

/* What will ACTUALLY happen, given what was asked for and what the device
   can do. The fallback chain is deliberate and one-directional:

     voice   -> beep    (you wanted to be told; a tone still tells you)
     beep    -> silent  (a beep asked for is a beep or nothing — falling
                         through to speech would be louder and more personal
                         than what was asked for, in a gym, out loud)
     vibrate -> silent  (same reasoning, more so: vibration is the choice
                         you make when you do NOT want to make a sound. The
                         one wrong answer here is to substitute audio.)

   An unknown/absent stored mode reads as 'voice', the default — not as
   silence, because a settings value that failed to load must not quietly
   turn the feature off. */
function resolveMode(mode, caps) {
  const want = MODES.includes(mode) ? mode : 'voice';
  if (want === 'silent') return 'silent';
  if (want === 'voice') {
    if (caps.speech) return 'voice';
    return caps.audio ? 'beep' : 'silent';
  }
  if (want === 'beep') return caps.audio ? 'beep' : 'silent';
  return caps.vibrate ? 'vibrate' : 'silent'; // vibrate
}

/* The voice to speak with. A stored URI that isn't installed on THIS device
   (chosen on a phone, now running on a desktop) resolves to null, which means
   "let the engine pick" — never to silence, and never to some other voice the
   user didn't choose. */
function pickVoice(voices, uri) {
  if (!uri || !Array.isArray(voices) || !voices.length) return null;
  return voices.find(v => v && v.voiceURI === uri) || null;
}

/* The voices worth offering. Two filters, both learned from a real device:
   a Mac reports 180 voices, and a dropdown of 180 is not a choice — it is a
   wall. Worse, most of them cannot pronounce what this app says: everything
   it speaks ("new record", "begin", the numbers) is English, and an Italian
   voice reading it is not a preference anyone would pick on purpose.

   So: drop anything unusable (no URI means it cannot be stored, no name
   means it cannot be shown), then keep the language family the user's own
   device is set to. `lang` is a BCP-47 tag; only the primary subtag is
   compared, so en-ZA, en-GB and en-US all survive an en-ZA device — a South
   African picking a British voice is a real choice, picking a Finnish one is
   not.

   FALLING BACK TO EVERYTHING is deliberate: on a device whose UI language
   has no installed voices, a filtered list would be EMPTY and the picker
   would offer nothing at all. A long list beats no list. */
function usableVoices(voices, lang) {
  const all = (Array.isArray(voices) ? voices : []).filter(v => v && v.voiceURI && v.name);
  const want = String(lang || '').split('-')[0].toLowerCase();
  if (!want) return all;
  const matching = all.filter(v => String(v.lang || '').split('-')[0].toLowerCase() === want);
  return matching.length ? matching : all;
}

/* Tone shapes, in one table so a rep and a record can never drift into
   sounding the same. freq in Hz, ms per note; a list is played in sequence.
   Deliberately short and dry — this fires between reps, not as a fanfare. */
const TONES = {
  rep:    [{ freq: 880, ms: 55 }],
  begin:  [{ freq: 660, ms: 90 }],
  go:     [{ freq: 990, ms: 160 }],
  record: [{ freq: 784, ms: 90 }, { freq: 1046, ms: 140 }],
  goal:   [{ freq: 659, ms: 90 }, { freq: 880, ms: 90 }, { freq: 1175, ms: 160 }],
};

/* Vibration patterns, same table discipline. navigator.vibrate takes ms, or
   an on/off/on list. */
const BUZZES = {
  rep: 20,
  begin: 40,
  go: [0, 60],
  record: [0, 50, 60, 50],
  goal: [0, 50, 60, 50, 60, 90],
};

function toneFor(kind) { return TONES[kind] || TONES.rep; }
function buzzFor(kind) { return BUZZES[kind] === undefined ? BUZZES.rep : BUZZES[kind]; }

/* ---------- the device-touching part ---------- */

let ctxAudio = null;

function audioContext() {
  if (ctxAudio) return ctxAudio;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try { ctxAudio = new Ctor(); } catch (e) { ctxAudio = null; }
  return ctxAudio;
}

/* Call from inside a user gesture, before anything will need to make a noise
   on a TIMER. Idempotent and never throws: a failed unlock degrades to a
   silent session, which is exactly what happens today without it. */
function unlock() {
  try {
    const ac = audioContext();
    if (ac && ac.state === 'suspended') ac.resume();
  } catch (e) { /* audio is a nicety — the count still lands on screen */ }
  /* Speech unlocks by having spoken once from a gesture. An empty utterance
     is inaudible and does that without saying anything. */
  try {
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(''));
    }
  } catch (e) { /* ignore */ }
}

function speakText(text, settings) {
  try {
    window.speechSynthesis.cancel(); // fast reps must not queue a backlog
    const u = new window.SpeechSynthesisUtterance(String(text));
    const chosen = pickVoice(window.speechSynthesis.getVoices(), settings && settings.voiceURI);
    if (chosen) u.voice = chosen;
    window.speechSynthesis.speak(u);
  } catch (e) { /* degrade silently — the count still lands */ }
}

function playTone(kind) {
  const ac = audioContext();
  if (!ac) return;
  try {
    if (ac.state === 'suspended') ac.resume();
    let at = ac.currentTime;
    for (const note of toneFor(kind)) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      const dur = note.ms / 1000;
      /* Ramps, not a bare start/stop: a square-edged gate on an oscillator
         is an audible click at both ends, which on a phone speaker reads as
         a fault rather than a beep. */
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      at += dur + 0.02;
    }
  } catch (e) { /* ignore */ }
}

function buzz(kind) {
  try { navigator.vibrate(buzzFor(kind)); } catch (e) { /* ignore */ }
}

/* ---------- what callers actually use ---------- */

/* Announce a COUNT — a rep number, a hold checkpoint. `text` is what a voice
   would say; the beep and buzz modes ignore it and play the 'rep' shape,
   because a tone cannot say "twelve" and pretending otherwise would just be
   a different tone per rep. */
function announce(text, settings) {
  const mode = resolveMode(settings && settings.soundMode, capabilities());
  if (mode === 'voice') return speakText(text, settings);
  if (mode === 'beep') return playTone('rep');
  if (mode === 'vibrate') return buzz('rep');
}

/* Announce an EVENT — 'begin', 'go', 'record', 'goal'. `words` is the spoken
   form; every mode has its own shape for the same event. */
function cue(kind, words, settings) {
  const mode = resolveMode(settings && settings.soundMode, capabilities());
  if (mode === 'voice') return speakText(words || kind, settings);
  if (mode === 'beep') return playTone(kind);
  if (mode === 'vibrate') return buzz(kind);
}

/* Stop anything queued. Only speech queues; tones are short and fire-and-
   forget, and a vibration already ran. Called when muting mid-count and when
   leaving a session, where a backlog of "seven… eight… nine" playing over
   the next screen is the bug. */
function cancel() {
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch (e) { /* ignore */ }
}

/* Is this mode going to do anything at all here? Used to decide whether the
   mute button is worth showing — a control that silences silence is noise. */
function audible(settings) {
  return resolveMode(settings && settings.soundMode, capabilities()) !== 'silent';
}

/* The voice list, for the settings dropdown. Async by nature (see the header
   note 2): calls back once now and again on `voiceschanged`. Returns a
   teardown so the settings tab can stop listening when it closes. */
function watchVoices(onVoices) {
  if (!capabilities().speech) { onVoices([]); return () => {}; }
  const read = () => {
    try {
      const lang = (typeof navigator !== 'undefined' && navigator && navigator.language) || '';
      onVoices(usableVoices(window.speechSynthesis.getVoices(), lang));
    } catch (e) { onVoices([]); }
  };
  read();
  window.speechSynthesis.addEventListener('voiceschanged', read);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', read);
}

module.exports = {
  /* pure — unit-tested */
  MODES, TONES, BUZZES, resolveMode, pickVoice, usableVoices, toneFor, buzzFor, capabilities,
  /* effects */
  unlock, announce, cue, cancel, audible, watchVoices,
};
