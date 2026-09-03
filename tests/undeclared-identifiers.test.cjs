'use strict';
/* Every identifier a src/ module references must actually be bound: declared
   locally, imported, or a real engine global.

   THE BUG THIS CATCHES: page-exercises.js used `equipmentTokens(...)` and
   `labelFor(...)` while its `const { equipmentTokens, labelFor } =
   require('./equipment');` line was missing. A free identifier is not an
   error until it is EVALUATED, so esbuild bundled it, `node --check` parsed
   it, and all 47 test files passed. The Exercises page threw
   "equipmentTokens is not defined" the moment it rendered. It was found by
   eye.

   This is the same failure as module-exports.test.cjs guards — a name that
   resolves to nothing at render time, invisible to every stage of the build —
   approached from the other side. That file asks "is everything imported
   really exported?". This one asks "is everything used really imported?".
   Nothing in the suite renders a page, so neither question answers itself.

   HOW IT KNOWS: not by regex. Guessing at scope with a hand-rolled scan
   cannot tell `class X { foo() {} }` from a call to a missing `foo()`, and a
   guard that cries wolf gets deleted. Instead esbuild — already a dependency,
   and already the thing that decides what ships — does the scope analysis:
   `define` rewrites ONLY free identifier references, never a local, a
   parameter, a property, an object key, a class method or a label. So every
   candidate name in the file is defined to a unique marker, and whichever
   markers survive into the output are precisely the names nothing binds.

   Requiring each module under an obsidian stub was the other option and is
   strictly weaker: `require()` runs top-level code only, so a free identifier
   inside a render function — which is where this bug lived, and where nearly
   all of src/ lives — never gets looked up at all. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let esbuild;
try {
  esbuild = require('esbuild');
} catch {
  assert.fail('esbuild is not installed, so this guard cannot run — run `npm ci`. ' +
    'Do not skip it: a missing import ships silently and breaks a page in the real app.');
}

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));

/* Names an engine provides. Anything here is legitimately free; anything not
   here and not bound in the file is the bug. `require`, `module`, `exports`,
   `__filename` and `__dirname` are absent on purpose — they are bound as
   parameters by the CommonJS wrapper applied below, exactly as Node binds
   them.

   Node's own `globalThis` is deliberately NOT consulted: it grows between
   Node versions, so a name would pass on the machine that added it and fail
   in CI. An explicit list fails the same way everywhere.

   Adding to it is a normal edit. If a new browser API is genuinely being
   used, put it under the right heading; if the name is a typo or a forgotten
   import, that is what this guard just told you. */
const ENGINE_GLOBALS = new Set([
  /* ECMAScript — present in every JS engine. */
  'globalThis', 'undefined', 'NaN', 'Infinity', 'arguments',
  'Object', 'Function', 'Boolean', 'Symbol', 'BigInt', 'Number', 'String', 'Array',
  'Math', 'Date', 'RegExp', 'JSON', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef',
  'Promise', 'Proxy', 'Reflect', 'Intl', 'FinalizationRegistry',
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError',
  'URIError', 'AggregateError',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',

  /* The WebView. Obsidian desktop is Electron and Obsidian mobile is the OS
     WebView, so this is the browser platform, not Node — `process`, `Buffer`
     and friends are left out on purpose (ios-hazards.test.cjs bars them). */
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'console',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask',
  'alert', 'confirm', 'prompt', 'getComputedStyle', 'matchMedia',
  'localStorage', 'sessionStorage', 'indexedDB',
  'fetch', 'Request', 'Response', 'Headers', 'FormData',
  'AbortController', 'AbortSignal', 'XMLHttpRequest', 'WebSocket',
  'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FileList',
  'atob', 'btoa', 'TextEncoder', 'TextDecoder', 'structuredClone',
  'crypto', 'performance',
  'Event', 'CustomEvent', 'EventTarget', 'ErrorEvent', 'ProgressEvent',
  'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent', 'WheelEvent',
  'InputEvent', 'DragEvent', 'MessageChannel', 'MessagePort',
  'Node', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement',
  'HTMLInputElement', 'HTMLVideoElement', 'HTMLAudioElement', 'SVGElement',
  'DocumentFragment', 'DOMParser', 'XMLSerializer', 'Range', 'Selection', 'CSS',
  'Image', 'Audio', 'Option', 'Worker', 'ImageData', 'OffscreenCanvas',
  'createImageBitmap', 'CanvasRenderingContext2D',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver',
  'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'AudioBuffer',
  'MediaRecorder', 'MediaStream', 'MediaStreamTrack',
  'speechSynthesis', 'SpeechSynthesisUtterance',
  'DeviceMotionEvent', 'DeviceOrientationEvent', 'Notification', 'ClipboardItem',
]);

/* Reserved words cannot be `define` keys, and are never free variables. */
const KEYWORDS = new Set(('await break case catch class const continue debugger default ' +
  'delete do else enum export extends false finally for function if implements import in ' +
  'instanceof interface let new null package private protected public return static super ' +
  'switch this throw true try typeof var void while with yield').split(' '));

const MARK = '__gvFreeIdent';

const problems = [];
let checked = 0;   // (file, free name) pairs actually resolved
let analysed = 0;  // files esbuild successfully read the scopes of

for (const file of files) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  assert.ok(!src.includes(MARK), `${file} contains ${MARK}, which this guard uses as its marker`);

  /* Candidates are gathered sloppily on purpose — property names, object
     keys and words inside strings all get swept in. esbuild is what decides
     which of them are actually free, so over-collecting costs nothing. */
  const names = [...new Set([...src.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].map(m => m[0]))]
    .filter(n => !KEYWORDS.has(n));

  const define = {};
  names.forEach((n, i) => { define[n] = `${MARK}${i}__`; });

  /* The same wrapper Node applies to a CommonJS module, so `require`,
     `module` and `exports` are bound here for the same reason they are bound
     at runtime — not waved through by an allowlist. */
  const wrapped = `(function(exports, require, module, __filename, __dirname){\n${src}\n});`;

  let out;
  try {
    out = esbuild.transformSync(wrapped, { loader: 'js', target: 'esnext', define, logLevel: 'silent' });
  } catch (e) {
    problems.push(`${file}: esbuild could not parse it, so nothing in it is being checked — ${e.message}`);
    continue;
  }
  analysed++;

  const free = new Set([...out.code.matchAll(new RegExp(`${MARK}(\\d+)__`, 'g'))].map(m => names[+m[1]]));
  for (const name of free) {
    checked++;
    if (ENGINE_GLOBALS.has(name)) continue;
    problems.push(
      `${file} uses '${name}', but nothing in the file declares or imports it. ` +
      'That is a ReferenceError the instant the line runs — the bundle builds, the suite ' +
      'passes, and the page dies blank in the app. Add the missing require, fix the typo, ' +
      `or if '${name}' really is an engine global, add it to ENGINE_GLOBALS here.`,
    );
  }
}

assert.deepStrictEqual(problems, [], `\n  ${problems.join('\n  ')}\n`);

/* A guard that silently stops resolving anything passes forever. If the
   wrapper, the marker or esbuild's define behaviour ever changes shape, the
   free set goes empty and everything looks fine — fail loudly instead. */
assert.ok(analysed >= 40,
  `only ${analysed} of ${files.length} src modules were analysed — the rest are unguarded.`);
assert.ok(checked >= 150,
  `only ${checked} free identifiers were resolved across src/ — esbuild's define substitution ` +
  'has probably stopped matching, and this guard is now checking nothing.');

console.log(`undeclared identifiers OK (${checked} free identifiers across ${analysed} modules, all of them real globals)`);
