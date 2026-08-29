'use strict';
/* Progress photos: poses, paths, and the ordering the viewer reads.

   ONE SOURCE OF TRUTH, on purpose. Everything here is derived from the files
   on disk — the folder names the pose, the filename carries the date. There
   is deliberately NO index note listing the photos.

   That is a departure from "the markdown files ARE the database" everywhere
   else in this plugin, and it is the right call here: an index would be a
   SECOND record of the same facts, free to drift from the folder the moment
   a photo is added, renamed or deleted in Obsidian rather than in the app.
   "Two figures derived by different rules" is this codebase's recurring bug
   shape (four separate instances were fixed in 0.3.0) and a photo index is
   that shape with the user's own file manager as the second writer.

   Pure — no DOM, no obsidian import. */

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];

/* The guide outline drawn over the camera, so each photo is taken from the
   same stance. Schematic on purpose: a rough silhouette you line yourself up
   inside reads better than an anatomically detailed one, which invites you to
   match the drawing rather than your own previous photo. Coordinates are in a
   100x200 viewBox and scale to whatever the preview is. */
const POSES = [
  {
    key: 'standing',
    label: 'Standing',
    hint: 'Arms relaxed at your sides, feet shoulder-width apart.',
    guide: [
      { kind: 'circle', cx: 50, cy: 18, r: 11 },
      { kind: 'path', d: 'M38 32 L34 46 L33 72 L37 102 L63 102 L67 72 L66 46 L62 32 Z' },
      { kind: 'path', d: 'M34 46 L26 74 L24 106' },
      { kind: 'path', d: 'M66 46 L74 74 L76 106' },
      { kind: 'path', d: 'M41 102 L39 150 L38 192' },
      { kind: 'path', d: 'M59 102 L61 150 L62 192' },
    ],
  },
  {
    key: 'flexing',
    label: 'Flexing',
    hint: 'Double biceps — elbows up to shoulder height.',
    guide: [
      { kind: 'circle', cx: 50, cy: 18, r: 11 },
      { kind: 'path', d: 'M38 32 L34 46 L33 72 L37 102 L63 102 L67 72 L66 46 L62 32 Z' },
      { kind: 'path', d: 'M34 46 L18 44 L14 26 L24 18' },
      { kind: 'path', d: 'M66 46 L82 44 L86 26 L76 18' },
      { kind: 'path', d: 'M41 102 L39 150 L38 192' },
      { kind: 'path', d: 'M59 102 L61 150 L62 192' },
    ],
  },
  {
    key: 'side',
    label: 'Side on',
    hint: 'Turn side on, arms hanging naturally.',
    guide: [
      { kind: 'circle', cx: 52, cy: 18, r: 11 },
      { kind: 'path', d: 'M44 32 L42 48 L44 74 L46 102 L58 102 L59 74 L58 48 L56 32 Z' },
      { kind: 'path', d: 'M56 48 L58 76 L57 106' },
      { kind: 'path', d: 'M48 102 L47 150 L46 192' },
      { kind: 'path', d: 'M56 102 L57 150 L57 192' },
    ],
  },
  {
    key: 'back',
    label: 'Back',
    hint: 'Facing away, arms relaxed.',
    guide: [
      { kind: 'circle', cx: 50, cy: 18, r: 11 },
      { kind: 'path', d: 'M37 32 L33 46 L32 72 L37 102 L63 102 L68 72 L67 46 L63 32 Z' },
      { kind: 'path', d: 'M33 46 L25 74 L23 106' },
      { kind: 'path', d: 'M67 46 L75 74 L77 106' },
      { kind: 'path', d: 'M41 102 L39 150 L38 192' },
      { kind: 'path', d: 'M59 102 L61 150 L62 192' },
    ],
  },
];

const poseByKey = key => POSES.find(p => p.key === key) || null;
const isPoseKey = key => POSES.some(p => p.key === key);

/* `Gym/Progress Photos/<pose>/<YYYY-MM-DD>.<ext>`. The date is the filename
   because that is what makes the folder self-describing in Obsidian's own
   file explorer — the feature stays legible without this plugin installed. */
const photosRoot = root => `${root}/Progress Photos`;
const poseFolder = (root, pose) => `${photosRoot(root)}/${pose}`;
const photoPath = (root, pose, dateISO, ext) => `${poseFolder(root, pose)}/${dateISO}.${(ext || 'jpg').toLowerCase()}`;

const extOf = path => {
  const i = (path || '').lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
};

/* A vault path back to {pose, date}, or null when the file is not one of
   ours. Tolerates the ` 2` suffix a same-day retake gets, so a second photo
   on one date still sorts under that date rather than vanishing. */
function parsePhotoPath(root, path) {
  const prefix = `${photosRoot(root)}/`;
  if (!path || path.indexOf(prefix) !== 0) return null;
  if (!IMAGE_EXT.includes(extOf(path))) return null;
  const rest = path.slice(prefix.length).split('/');
  if (rest.length !== 2) return null;
  const [pose, file] = rest;
  if (!isPoseKey(pose)) return null;
  const m = file.match(/^(\d{4}-\d{2}-\d{2})(?: (\d+))?\./);
  if (!m) return null;
  return { pose, date: m[1], seq: m[2] ? Number(m[2]) : 1, path };
}

/* Every photo of one pose, oldest first — the order the viewer morphs in.
   Ties on date break by the retake sequence so a same-day pair is stable. */
function photosForPose(entries, pose) {
  return entries
    .filter(e => e.pose === pose)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
}

/* The before/after pair the profile card shows at a glance: first and last.
   Returns null when there is nothing to compare yet — ONE photo is not a
   comparison, and showing the same image twice under "before" and "after"
   would imply a change that hasn't happened. */
function beforeAfter(entries, pose) {
  const list = photosForPose(entries, pose);
  if (list.length < 2) return null;
  return { before: list[0], after: list[list.length - 1], count: list.length };
}

/* Which poses actually have photos, in POSES order, with their counts — the
   profile section renders only these plus an "add" affordance. */
function poseSummary(entries) {
  return POSES.map(p => {
    const list = photosForPose(entries, p.key);
    return { pose: p, count: list.length, latest: list.length ? list[list.length - 1] : null };
  });
}

module.exports = {
  POSES, IMAGE_EXT, poseByKey, isPoseKey,
  photosRoot, poseFolder, photoPath, parsePhotoPath, extOf,
  photosForPose, beforeAfter, poseSummary,
};
