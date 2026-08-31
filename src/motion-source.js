'use strict';
/* The device half of motion counting: permission, the `devicemotion`
   subscription, and turning each event into one sample for motion-count.js.
   Everything that decides whether a wobble was a rep lives THERE, pure and
   tested; everything that can only be true on a real phone lives here.

   THE PERMISSION RULE THAT BITES. On iOS, `DeviceMotionEvent.requestPermission()`
   only resolves to 'granted' when it is called from inside a user gesture —
   the same rule that governs speech synthesis in rep-counter-shared.js. Call
   it from a render, a timer or a promise chain that has already yielded, and
   iOS rejects it without ever showing the prompt, which looks exactly like
   the user saying no. So `startMotionCounter` must be invoked synchronously
   from a click/tap handler, and every caller here does.

   Android and desktop Chromium have no prompt at all: DeviceMotionEvent
   exists and events simply arrive (or never do, on a desktop with no
   accelerometer). That third case — permission granted, sensor silent — is
   why `onStatus` reports 'listening' only once real samples show up.

   WHAT IT NEVER DOES: throw at the caller. A counter that explodes because a
   sensor is missing is worse than one that quietly stays in tap mode, so
   every failure path resolves to a status string and the tap zone keeps
   working underneath. */

const { createMotionDetector, feedSample } = require('./motion-count');

/* No samples for this long after starting means the sensor is not actually
   delivering — a desktop, a locked-down WebView, a device with the motion
   sensor disabled in settings. Long enough to survive a slow first event. */
const SILENT_SENSOR_MS = 2500;

function motionAvailable() {
  return typeof window !== 'undefined' && typeof window.DeviceMotionEvent !== 'undefined';
}

/* iOS 13+ gates the sensor behind an explicit prompt; everywhere else the
   events just flow. */
function motionNeedsPermission() {
  return motionAvailable() && typeof window.DeviceMotionEvent.requestPermission === 'function';
}

/* Resolves 'granted' | 'denied' | 'unsupported'. MUST be called from inside a
   user gesture — see the header. Never rejects. */
function requestMotionPermission() {
  if (!motionAvailable()) return Promise.resolve('unsupported');
  if (!motionNeedsPermission()) return Promise.resolve('granted');
  try {
    return Promise.resolve(window.DeviceMotionEvent.requestPermission())
      .then(res => (res === 'granted' ? 'granted' : 'denied'))
      .catch(() => 'denied');
  } catch (e) {
    return Promise.resolve('denied');
  }
}

/* |acceleration| from a devicemotion event.

   `accelerationIncludingGravity` is the field every platform actually fills;
   plain `acceleration` (gravity already removed) is null on a good number of
   Android devices. Either works — motion-count.js subtracts its own baseline
   — so take whichever is populated and don't care which it was. Returns null
   when the event carries neither, which is the signal that this device is
   never going to produce samples. */
function magnitudeOf(event) {
  const a = (event && event.accelerationIncludingGravity) || (event && event.acceleration) || null;
  if (!a) return null;
  /* Per spec each axis is a NULLABLE double, and `Number(null)` is 0 — so a
     half-populated reading would otherwise pass as a real one with a missing
     axis silently treated as zero gravity, injecting a step into the averages
     that looks a lot like a rep. Reject the whole sample instead; the next
     event is 20ms away. */
  if (a.x == null || a.y == null || a.z == null) return null;
  const x = Number(a.x), y = Number(a.y), z = Number(a.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return Math.sqrt(x * x + y * y + z * z);
}

/* Start counting reps from device motion.

   opts: {
     onRep()          fired once per detected rep
     onStatus(status) 'listening' | 'nosensor' | 'denied' | 'unsupported'
     sensitivity      'low' | 'normal' | 'high' (or a number)
     now()            clock override, for tests
   }

   Returns a Promise resolving to a stop() function. Calling stop() removes
   the listener; calling it twice is safe. On any failure the promise still
   resolves with a stop() that does nothing, so a caller can always store the
   result without a null check. */
function startMotionCounter(opts) {
  const o = opts || {};
  const onRep = typeof o.onRep === 'function' ? o.onRep : () => {};
  const onStatus = typeof o.onStatus === 'function' ? o.onStatus : () => {};
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const noop = () => {};

  if (!motionAvailable()) { onStatus('unsupported'); return Promise.resolve(noop); }

  return requestMotionPermission().then(perm => {
    if (perm !== 'granted') { onStatus(perm === 'unsupported' ? 'unsupported' : 'denied'); return noop; }

    let detector = createMotionDetector({ sensitivity: o.sensitivity });
    let sawSample = false;
    let stopped = false;

    const onMotion = event => {
      const mag = magnitudeOf(event);
      if (mag === null) return; // this event carried nothing; a later one may
      if (!sawSample) { sawSample = true; onStatus('listening'); }
      const r = feedSample(detector, now(), mag);
      detector = r.state;
      if (r.counted) onRep();
    };

    window.addEventListener('devicemotion', onMotion);

    /* Permission can be granted by a device that then sends nothing at all.
       Say so instead of leaving the screen claiming to be watching. */
    const silenceTimer = window.setTimeout(() => {
      if (!sawSample && !stopped) onStatus('nosensor');
    }, SILENT_SENSOR_MS);

    return () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(silenceTimer);
      window.removeEventListener('devicemotion', onMotion);
    };
  });
}

module.exports = {
  motionAvailable, motionNeedsPermission, requestMotionPermission,
  magnitudeOf, startMotionCounter, SILENT_SENSOR_MS,
};
