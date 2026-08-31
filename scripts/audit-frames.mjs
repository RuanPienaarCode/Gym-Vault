/* HOW MANY DEMONSTRATION FRAMES DOES EACH EXERCISE ACTUALLY HAVE?

   This reports. It does not edit anything, and it deliberately stops short
   of proposing a fix, because the answer it produces changes what "fix"
   means:

   Nearly every image in this app is a free-exercise-db URL, and that
   database ships exactly TWO frames per exercise — 0.jpg (start) and 1.jpg
   (finish). page-exercise-detail.js even derives the second from the first
   for notes seeded before multi-frame support. So "box jumps is missing the
   landing frame" may not be a broken link at all: there may be no third
   frame in existence to link to. If that is what this finds, the remedy is
   sourcing images, which is a project, not an edit.

   The plugin is NOT the limit — page-session.js already renders up to
   MEDIA_MAX_FRAMES (4), and the detail page renders all of them.

   Usage:
     node scripts/audit-frames.mjs              # seeded exercises only
     node scripts/audit-frames.mjs --check      # also HEAD each URL (slow)
     node scripts/audit-frames.mjs --library ../gym_plans

   Output is a table plus a summary. Nothing is written.
*/
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const libIdx = args.indexOf('--library');
const LIBRARY = libIdx >= 0 ? args[libIdx + 1] : null;

/* Movements whose shape has a phase the classic start/finish PAIR cannot
   show — an airborne moment, a landing, a rack position, a turnover. This is
   a heuristic on the NAME, and it is meant to be: the point is to produce a
   shortlist a human looks at, not a verdict. */
const NEEDS_MORE = [
  /\bjump/i, /\bbox\b/i, /burpee/i, /\bclean\b/i, /snatch/i, /jerk/i,
  /turkish/i, /get[- ]?up/i, /thruster/i, /\bswing/i, /muscle[- ]?up/i,
  /kip/i, /\bthrow/i, /\bslam/i, /crawl/i, /\blunge.*walk|walk.*lunge/i,
];
const looksMultiPhase = name => NEEDS_MORE.some(re => re.test(name));

/* ---------- gather ---------- */

/* The seed is JS, not data, so it is read as text rather than imported —
   importing it would pull in the whole module graph (and obsidian) for a
   list of URLs. The `image:` values are the only thing wanted. */
function fromSeed() {
  const whole = readFileSync(join(root, 'src', 'seed.js'), 'utf8');

  /* ONLY the SEED_EXERCISES array. The first version of this script split
     the whole file on `{ name:` and swept up SEED_GOALS and the running
     entries with it — reporting "10 Muscle-ups", "4 Workouts a Week" and
     "Easy Run" as exercises with no demonstration image. They are a goal, a
     goal and a run; none of them wants one, and the inflated count would
     have sent someone off to source fifteen images that were never
     missing. */
  const start = whole.indexOf('const SEED_EXERCISES = [');
  if (start < 0) { console.error('SEED_EXERCISES not found in src/seed.js'); process.exit(1); }
  const end = whole.indexOf('\n];', start);
  const src = whole.slice(start, end < 0 ? undefined : end);

  const out = [];
  /* Each exercise literal starts `{ name: '...'` and may carry `image: ...`
     before the next `{ name:`. */
  const blocks = src.split(/\n  \{ name: /).slice(1);
  for (const b of blocks) {
    const name = (b.match(/^'([^']+)'/) || [])[1];
    if (!name) continue;
    const imageLine = b.match(/image:\s*([\s\S]*?)(?:,\n\s{4}\w+:|\n\s{2}\})/);
    const raw = imageLine ? imageLine[1] : '';
    let frames = 0;
    /* IMG('X') expands to two URLs; WGER('p') and bare strings are one
       each. Counting the SOURCE form rather than resolving it keeps this
       honest about what the seed actually writes. */
    frames += (raw.match(/IMG\(/g) || []).length * 2;
    frames += (raw.match(/WGER\(/g) || []).length;
    frames += (raw.match(/'https:\/\//g) || []).length;
    out.push({ source: 'seed', name, frames });
  }
  return out;
}

/* Exercise notes in a plan library repo — frontmatter `image:` lists. */
function fromLibrary(dir) {
  const exDir = join(dir, 'exercises');
  if (!existsSync(exDir)) return [];
  const out = [];
  for (const f of readdirSync(exDir)) {
    if (!f.endsWith('.md')) continue;
    const path = join(exDir, f);
    if (!statSync(path).isFile()) continue;
    const text = readFileSync(path, 'utf8');
    const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const name = (fm.match(/^name:\s*(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
    /* Two YAML shapes: a bare scalar, or a `- ` list under `image:`. */
    const listBlock = fm.match(/^image:\s*\n((?:\s*-\s*.+\n?)+)/m);
    const scalar = fm.match(/^image:\s*(\S.*)$/m);
    const frames = listBlock ? (listBlock[1].match(/^\s*-\s*\S/gm) || []).length : scalar ? 1 : 0;
    out.push({ source: 'library', name: name.trim(), frames });
  }
  return out;
}

async function headOk(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return r.ok;
  } catch { return false; }
}

/* ---------- report ---------- */

const rows = [...fromSeed(), ...(LIBRARY ? fromLibrary(LIBRARY) : [])];
if (!rows.length) {
  console.error('No exercises found — is this the plugin repo?');
  process.exit(1);
}

const bucket = n => (n === 0 ? 'none' : n === 1 ? 'one' : n === 2 ? 'pair' : 'three+');
const counts = { none: 0, one: 0, pair: 0, 'three+': 0 };
for (const r of rows) counts[bucket(r.frames)]++;

const flagged = rows.filter(r => looksMultiPhase(r.name) && r.frames <= 2);

const pad = (s, n) => String(s).padEnd(n);
console.log('\n== frames per exercise ==\n');
console.log(pad('EXERCISE', 34) + pad('SRC', 9) + pad('FRAMES', 8) + 'NOTE');
for (const r of rows.slice().sort((a, b) => a.frames - b.frames || a.name.localeCompare(b.name))) {
  const note = r.frames === 0 ? 'NO IMAGE AT ALL'
    : looksMultiPhase(r.name) && r.frames <= 2 ? 'name implies a phase a start/finish pair cannot show'
    : '';
  console.log(pad(r.name, 34) + pad(r.source, 9) + pad(r.frames, 8) + note);
}

console.log('\n== summary ==');
console.log(`  ${rows.length} exercises`);
console.log(`  none: ${counts.none}   one: ${counts.one}   pair: ${counts.pair}   three or more: ${counts['three+']}`);
console.log(`  ${flagged.length} look multi-phase but have two frames or fewer`);

if (flagged.length) {
  console.log('\n  The shortlist (a human decides, not this script):');
  for (const r of flagged) console.log(`    - ${r.name} (${r.frames} frame${r.frames === 1 ? '' : 's'})`);
  console.log('\n  BEFORE treating these as broken links, note that free-exercise-db ships');
  console.log('  exactly two frames per exercise. A third frame is not a missing link —');
  console.log('  it is an image that does not exist yet, and would have to be sourced.');
}

if (CHECK) {
  console.log('\n== reachability (HEAD on every seeded URL) ==');
  const src = readFileSync(join(root, 'src', 'seed.js'), 'utf8');
  const urls = [...new Set(src.match(/https:\/\/[^'"\s\]]+/g) || [])]
    .filter(u => /\.(jpg|png|gif|webp)$/i.test(u));
  let dead = 0;
  for (const u of urls) {
    /* Serial on purpose: this points at someone else's CDN and a burst of a
       hundred parallel HEADs is rude, not fast. */
    const ok = await headOk(u);
    if (!ok) { dead++; console.log(`  DEAD  ${u}`); }
  }
  console.log(`  ${urls.length} URLs checked, ${dead} unreachable`);
}

console.log('');
