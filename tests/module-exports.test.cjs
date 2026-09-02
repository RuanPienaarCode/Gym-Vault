'use strict';
/* Every name destructured from a local module must actually be exported.

   THE BUG THIS CATCHES: `clickableCard` was added to dom.js and used by six
   page modules, but never added to dom.js's `module.exports`. Destructuring a
   missing key yields `undefined` rather than throwing, so the bundle built
   clean, `node --check` passed, all 20 test suites passed — and every page
   using it died at RENDER time with "X is not a function". It shipped in
   0.3.0 and broke Exercises, Plans, History, Dashboard and Export in the real
   app.

   Nothing in the suite caught it because no test renders a page. This does
   not render a page either — it checks the seam statically, which is cheap
   and total: it covers every local require in src/, including modules no test
   ever touches. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js'));

/* Read the exported keys STATICALLY. Requiring the module would be stronger,
   but half of src/ imports 'obsidian', which does not exist outside the app —
   and a guard that can only check the half of the codebase not touching the
   host API would have missed this exact bug in dom.js. */
function exportsOf(file) {
  const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = code.match(/module\.exports\s*=\s*\{([\s\S]*?)\n?\};/);
  if (!m) return null;
  return m[1]
    .split(',')
    .map(s => s.split(':')[0].trim())
    .filter(Boolean);
}

const problems = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8');
  /* Strip comments so a require written inside a comment isn't checked. */
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* `const { a, b: c } = require('./mod');` — the destructured shape.
     Namespace imports (`const m = require('./mod')`) are checked separately
     below; they used to be out of scope, and a real bug shipped through the
     gap. */
  const re = /const\s*\{([^}]*)\}\s*=\s*require\('\.\/([\w-]+)'\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const [, namesRaw, mod] = m;
    const target = path.join(SRC, `${mod}.js`);
    if (!fs.existsSync(target)) { problems.push(`${file}: requires './${mod}' which does not exist`); continue; }

    const exported = exportsOf(target);
    if (exported === null) { problems.push(`${file}: could not read module.exports out of ${mod}.js`); continue; }

    for (const raw of namesRaw.split(',')) {
      // `a: b` imports key `a`; the local alias `b` is irrelevant here.
      const key = raw.split(':')[0].trim();
      if (!key) continue;
      if (!exported.includes(key)) {
        problems.push(
          `${file} destructures '${key}' from './${mod}', but ${mod}.js does not export it ` +
          `(exports: ${exported.join(', ')}). This is undefined at runtime, not an error — ` +
          'it fails only when the code path actually runs.',
        );
      }
    }
  }
}

assert.deepStrictEqual(problems, [], `\n  ${problems.join('\n  ')}\n`);

/* The check is only meaningful while it is actually finding requires to
   check. If the import style changes and the pattern stops matching, this
   would pass vacuously — fail loudly instead. */
{
  let count = 0;
  for (const file of files) {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    count += (code.match(/const\s*\{[^}]*\}\s*=\s*require\('\.\//g) || []).length;
  }
  assert.ok(count >= 20,
    `only ${count} destructured local requires found — the pattern has probably stopped matching ` +
    'the codebase\'s import style, and this guard is now checking nothing.');
}

/* ---------- namespace imports: `const m = require('./mod'); m.fn()` -------

   THE BUG THIS CATCHES: countdown.js renamed runCountIn to startCountIn and
   changed its shape (host + opts returning a stop function, to headless opts
   returning {stop, skip}). rep-counter-modal.js still called
   countdown.runCountIn(c, {...}). Destructured imports were already covered
   above, but a namespace import is a property access — so it bundled clean,
   node --check passed, every suite was green, and it SHIPPED in 0.9.1. It
   threw "countdown.runCountIn is not a function" the moment anyone opened the
   standalone rep counter and picked a target.

   The section above exists because of the same class of failure in dom.js.
   That one was caught and this one was not, purely because the import was
   written `const countdown = require(...)` instead of `const { ... } =`. The
   seam is identical; only the syntax differed. */
{
  const nsProblems = [];
  let nsUses = 0;
  const skipped = [];

  for (const file of files) {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const bound = new Map();
    const nsRe = /const\s+([A-Za-z_$][\w$]*)\s*=\s*require\('\.\/([\w-]+)'\)/g;
    let m;
    while ((m = nsRe.exec(code)) !== null) bound.set(m[1], m[2]);

    for (const [ident, mod] of bound) {
      const target = path.join(SRC, `${mod}.js`);
      if (!fs.existsSync(target)) { nsProblems.push(`${file}: requires './${mod}' which does not exist`); continue; }
      const exported = exportsOf(target);
      /* No readable `module.exports = {...}` literal means nothing to check
         against — the destructured pass above already reports that shape. */
      if (exported === null) continue;

      const esc = ident.replace(/\$/g, '\\$');
      /* Shadowing: the same name bound again (a local array, a parameter)
         would make every method call on it look like a missing export. */
      const decls = (code.match(new RegExp('(?:const|let|var)\\s+' + esc + '\\b', 'g')) || []).length;
      const asParam = new RegExp('(?:function\\s+[\\w$]*\\s*\\([^)]*\\b' + esc + '\\b|\\(\\s*[^)]*\\b' + esc + '\\b[^)]*\\)\\s*=>)').test(code);
      if (decls > 1 || asParam) { skipped.push(`${file}:${ident}`); continue; }

      /* Must NOT be preceded by a dot: `sess.records.find` is a property
         chain on session state, not the records module. Written as a capture
         rather than a lookbehind on purpose — lookbehind is a parse-time
         SyntaxError on the iOS 15 WebKit this plugin targets, and while a
         test never ships, the habit is the point. */
      const useRe = new RegExp('(^|[^.\\w$])' + esc + '\\.([A-Za-z_$][\\w$]*)', 'g');
      let u;
      while ((u = useRe.exec(code)) !== null) {
        nsUses++;
        const key = u[2];
        if (!exported.includes(key)) {
          nsProblems.push(
            `${file} calls ${ident}.${key}, but ${mod}.js does not export '${key}' ` +
            `(exports: ${exported.join(', ')}). This is undefined at runtime, not an error — ` +
            'it throws only when the code path actually runs.',
          );
        }
      }
    }
  }

  assert.deepStrictEqual(nsProblems, [], `\n  ${nsProblems.join('\n  ')}\n`);

  /* Same vacuous-pass guard as above: if the import style drifts and nothing
     matches any more, fail loudly rather than pass on an empty set. */
  assert.ok(nsUses >= 40,
    `only ${nsUses} namespace property uses found — the pattern has probably stopped matching ` +
    'the codebase\'s import style, and this half of the guard is now checking nothing.');
}

console.log('module exports OK (every destructured local import AND namespace property use is really exported)');
