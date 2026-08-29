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

  /* `const { a, b: c } = require('./mod');` — the only local-import shape this
     codebase uses. A default import (`const m = require('./mod')`) accesses
     keys dynamically and is deliberately out of scope. */
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

console.log('module exports OK (every destructured local import is really exported)');
