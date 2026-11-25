'use strict';
/* A PICTURE FOR AN EXERCISE, from the camera or the photo library (audit
   25 Nov 2026, #29). The Images field asked for a typed vault path, and nobody
   types a file path on a phone.

   The form's "Add photo" button opens a hidden <input type="file"
   accept="image/*"> (modals.js, kind 'images'): the one way a WebView reaches
   the phone's camera and library. No `capture` attribute, so iOS offers both.
   The picture is resized by photo-capture's toJpegBytes (longest edge 1600,
   JPEG 0.85: the size rule progress photos already follow, big enough to see
   the movement, small enough to sync) and saved under
   <Gym folder>/Attachments/<exercise>/, the folder downloaded images already
   use. The Gym folder is the one THIS device uses (finding 20), so two people
   sharing a vault keep their pictures apart.

   A writer of its own rather than data.js: it needs only the vault, and
   data.js belongs to another lane in this wave. */

const { normalizePath } = require('obsidian');
const { safeName } = require('./data');
const { toJpegBytes } = require('./photo-capture');
const { todayISO } = require('./dates');

/* The file or folder at `p`, whatever its letter case, or null. macOS and iOS
   are case-insensitive, so `pull-ups/` and `Pull-ups/` are one folder on disk
   while getAbstractFileByPath is an exact lookup (the rule data.js existingAt
   follows). */
function existingAt(vault, p) {
  const exact = vault.getAbstractFileByPath(p);
  if (exact) return exact;
  const slash = p.lastIndexOf('/');
  const dir = slash > 0 ? existingAt(vault, p.slice(0, slash)) : null;
  const lower = p.toLowerCase();
  return (dir && Array.isArray(dir.children) && dir.children.find(c => String(c.path || '').toLowerCase() === lower)) || null;
}

/* A folder at `p`, created when missing; returns the path it really has (an
   existing folder in another case is used as it is, not doubled). */
async function ensureFolder(vault, p, onWrite) {
  const have = existingAt(vault, p);
  if (have) return have.path;
  onWrite(p);
  try { await vault.createFolder(p); } catch (e) { if (!existingAt(vault, p)) throw e; }
  const made = existingAt(vault, p);
  return made ? made.path : p;
}

/* Record a write as the app's own, so the vault watcher does not reload the
   view under the open form (the per-path map data.js keeps; see controller.js
   isOwnWrite). Never throws. */
function markOwnWrite(plugin, p) {
  if (!plugin) return;
  const now = Date.now();
  plugin._lastWrite = now;
  if (!(plugin._ownWrites instanceof Map)) plugin._ownWrites = new Map();
  plugin._ownWrites.set(p, now);
}

/* Save `bytes` (JPEG) for `exercise`; resolves the vault path written. A
   second picture the same day gets ` 2`, ` 3`… rather than replacing one. */
async function saveExercisePhoto(app, opts) {
  const vault = app.vault;
  const onWrite = typeof opts.onWrite === 'function' ? opts.onWrite : () => {};
  const name = safeName(opts.exercise);
  const root = await ensureFolder(vault, normalizePath(opts.gymFolder || 'Gym'), onWrite);
  const attachments = await ensureFolder(vault, `${root}/Attachments`, onWrite);
  const dir = await ensureFolder(vault, `${attachments}/${name}`, onWrite);
  const base = `${dir}/${name} ${opts.dateISO || todayISO()}`;
  let p = `${base}.jpg`;
  for (let n = 2; existingAt(vault, p); n++) p = `${base} ${n}.jpg`;
  onWrite(p);
  await vault.createBinary(p, opts.bytes);
  onWrite(p);
  return p;
}

/* A picked file as JPEG bytes, resized by toJpegBytes. Rejects when the file
   is not an image the WebView can draw. */
function fileToJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try { resolve(toJpegBytes(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('that file could not be read as an image')); };
    img.src = url;
  });
}

/* The Images field with `p` added at the end. The field splits plain paths on
   every comma (page-exercises splitImageList), so a path holding one goes in
   as a [[link]], which the field keeps whole and the exercise page resolves. */
function withImage(current, p) {
  const entry = p.indexOf(',') >= 0 ? `[[${p}]]` : p;
  const cur = String(current === null || current === undefined ? '' : current).trim().replace(/,\s*$/, '').trim();
  return cur ? `${cur}, ${entry}` : entry;
}

module.exports = { saveExercisePhoto, fileToJpeg, withImage, markOwnWrite };
