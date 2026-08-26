/* The build, as one reproducible Node script (same layout as budget-vault so
   the community scorecard can verify a release by `npm ci` + `npm run build`).

   BOTH root main.js and root styles.css are BUILD OUTPUT. Neither is
   hand-edited:
     main.js    <- bundled from src/*.js
     styles.css <- copied from src/styles.css
   An edit made directly to a root artifact is lost on the next build. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const rel = p => join(root, p);

writeFileSync(rel('styles.css'), readFileSync(rel('src/styles.css'), 'utf8'));

/* target safari15 pins the syntax floor at the engine this plugin actually has
   to parse on. The floor is NOT minAppVersion — Obsidian mobile runs the OS
   WebView, and a syntax feature the engine cannot parse is a SyntaxError that
   kills the WHOLE bundle at load, not a graceful degradation.

   format cjs + external obsidian: Obsidian loads main.js as CommonJS and
   provides the `obsidian` module itself, so it must stay unbundled. */
await esbuild.build({
  entryPoints: [rel('src/main.js')],
  outfile: rel('main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'safari15',
  external: ['obsidian'],
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
});
