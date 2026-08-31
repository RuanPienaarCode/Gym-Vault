/* Build the browser harness.

   WHY THIS EXISTS: the guard suite under tests/ renders no pages. It proves
   the pure logic and the shape of the stylesheet; it cannot tell you that
   six nav tabs actually divide a 390px bar, or that a calc() resolves to the
   pixels you meant. Everything visual in this plugin has, until now, been
   verifiable only by deploying to a vault and looking — which is slow, and
   impossible to do for three pane widths at once.

   So: real src/ modules, real built styles.css, a stubbed `obsidian`, and a
   plain page that mounts them at several widths. Outputs are gitignored —
   this is a tool, not an artifact.

   Serve it:  python3 -m http.server 8817     (then /_preview/nav.html)
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* The harness must load the SAME stylesheet the plugin ships, not src/
   styles.css on its own — root styles.css is src/font.css + src/styles.css,
   and a harness reading only half of it would miss any font-driven metric. */
writeFileSync(join(here, 'gym.css'), readFileSync(join(root, 'styles.css'), 'utf8'));

await esbuild.build({
  entryPoints: [join(here, 'entry.js')],
  outfile: join(here, 'bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  alias: { obsidian: join(here, 'obsidian-stub.js') },
  logLevel: 'info',
});
