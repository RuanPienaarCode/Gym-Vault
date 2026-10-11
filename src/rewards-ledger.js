'use strict';
/* The rewards LEDGER: the one storage format for XP. Pure, no DOM, no
   obsidian import. data.js owns the vault IO (io.readRewards / io.appendRewards)
   and calls these functions on the file's CURRENT text; nothing here touches a
   file.

   WHY A LEDGER. XP is never a stored number. Gym/Rewards.md is an append-only
   list with ONE LINE PER AWARD and every total is a sum of those lines, so
   there is no stored total to drift and two devices that each append a line
   merge by text. It lives in the vault (not data.json) because data.json syncs
   as a whole file: a settings save on the other device would clobber it.

   FILE FORMAT (a real example; the Gym folder is configurable, the file name is not):

     ---
     type: rewards
     started: 2026-10-12
     ---
     # Rewards

     | Date | Kind | Key | XP | Note |
     | --- | --- | --- | --- | --- |
     | 2026-10-12 | session | session:Gym/Workouts/2026-10-12 Push.md | 100 | Session finished |
     | 2026-10-12 | sets | sets:Gym/Workouts/2026-10-12 Push.md | 70 | 14 sets logged |

   CONTRACT
     LEDGER_COLUMNS                 ['Date','Kind','Key','XP','Note']
     KINDS                          ['session','sets','pb','streak','quest','medal'] - the kinds this
                                    version writes. Any other kind in a file is KEPT and summed
                                    (counted in `unknown`), never dropped.
     formatEntry(e) -> string       one table row, no newline. Pipes in a cell are escaped (markdown.escMd).
     parseLedger(text) -> {entries, keys, started, bad, duplicates, unknown}
         NEVER throws; null/undefined/'' -> an empty ledger. entries: [{date, kind, key, xp, note, line}]
         in file order, ONE per key (the first line for a key wins, so the same key
         written twice - two devices - is paid once); keys: Set of those keys; started:
         frontmatter `started` when a valid date, else null; bad: [{line, text}] table rows
         that could not be read (kept out of the sum, listed, never fatal); duplicates:
         number of later lines whose key was already seen; unknown: entries whose kind is
         not in KINDS. Header, separator, prose, headings and blank lines are ignored.
     entriesOf(x) -> entries         x is a parseLedger() result OR an array of entries; same
                                    first-key-wins rule. null -> [].
     hasKey(x, key) -> bool
     appendToText(current, entries) -> {text, appended, skipped}
         PURE. `current` is the file's text right now, or null when there is no file. Returns the
         text with the NEW lines added at the end and nothing else changed: text.startsWith(current)
         always holds, existing lines are never rewritten. An entry whose key is already in
         `current`, or that repeats an earlier entry of the same call, is skipped
         ({key, why:'present'}); an invalid entry (no key/kind, bad date, non-integer xp)
         is skipped ({key, why:'invalid'}). Nothing to append -> text === current (null stays null).
         A missing file gets frontmatter (type: rewards, started: <first appended date>),
         a heading, the table header and the rows. An existing file keeps its own frontmatter
         untouched (no `started` is added to a hand-made note); a file with no trailing
         newline gets one; a file whose LAST line is not a table row (prose, or a blank line after
         the table) gets a fresh table header before the new rows, so they still render. */

const { parseFrontmatter, serializeFrontmatter, splitBarePipes, escMd, unescMd } = require('./markdown');
const { fromISO, toISO } = require('./dates');

const LEDGER_COLUMNS = ['Date', 'Kind', 'Key', 'XP', 'Note'];
const KINDS = ['session', 'sets', 'pb', 'streak', 'quest', 'medal'];

const isIsoDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && (() => { const x = fromISO(d); return !!x && toISO(x) === d; })();
const isKindName = k => typeof k === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(k);
/* A key as it reads back from the file: escaped then unescaped, so the key an
   award is CHECKED under is byte for byte the key a line is PARSED to. */
const canonCell = s => unescMd(escMd(s));

function headerRows() {
  return `| ${LEDGER_COLUMNS.join(' | ')} |\n| ${LEDGER_COLUMNS.map(() => '---').join(' | ')} |\n`;
}

/* One award as one table row. Only call with a normalised entry; cells are
   escaped so a pipe or newline in a note cannot break the row. */
function formatEntry(e) {
  return `| ${e.date} | ${escMd(e.kind)} | ${escMd(e.key)} | ${String(e.xp)} | ${escMd(e.note || '')} |`;
}

/* The entry as it would be written, or null when it is not a valid award. */
function normaliseEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const date = typeof e.date === 'string' ? e.date.trim() : '';
  const kind = typeof e.kind === 'string' ? e.kind.trim().toLowerCase() : '';
  const key = canonCell(e.key == null ? '' : e.key);
  const xp = typeof e.xp === 'number' ? e.xp : (/^[+-]?\d+$/.test(String(e.xp == null ? '' : e.xp).trim()) ? Number(String(e.xp).trim()) : NaN);
  if (!isIsoDay(date) || !isKindName(kind) || !key || !Number.isSafeInteger(xp)) return null;
  return { date, kind, key, xp, note: canonCell(e.note == null ? '' : e.note) };
}

const SEPARATOR_ROW = /^\|[\s:|-]+\|?$/;

function parseLedger(text) {
  const out = { entries: [], keys: new Set(), started: null, bad: [], duplicates: 0, unknown: 0 };
  if (typeof text !== 'string' || !text) return out;
  try {
    const fm = parseFrontmatter(text).fm || {};
    const s = fm.started == null ? '' : String(fm.started).trim();
    out.started = isIsoDay(s) ? s : null;
  } catch (e) { /* a broken frontmatter block is not a broken ledger */ }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|') || SEPARATOR_ROW.test(t)) continue;
    let inner = t.slice(1);
    if (inner.endsWith('|') && inner[inner.length - 2] !== '\\') inner = inner.slice(0, -1);
    const cells = splitBarePipes(inner).map(unescMd);
    if (cells.length >= 2 && cells[0].toLowerCase() === 'date' && cells[1].toLowerCase() === 'kind') continue;
    /* Everything after the fourth cell is the note, so a bare pipe typed into a note by hand does not drop the row. */
    const entry = cells.length >= 4 ? normaliseEntry({ date: cells[0], kind: cells[1], key: cells[2], xp: cells[3], note: cells.slice(4).join(' | ') }) : null;
    if (!entry) { out.bad.push({ line: i + 1, text: t }); continue; }
    if (out.keys.has(entry.key)) { out.duplicates++; continue; }
    out.keys.add(entry.key);
    if (KINDS.indexOf(entry.kind) < 0) out.unknown++;
    entry.line = i + 1;
    out.entries.push(entry);
  }
  return out;
}

function entriesOf(x) {
  if (!x) return [];
  if (Array.isArray(x)) {
    const seen = new Set(), out = [];
    for (const e of x) {
      if (!e || typeof e.key !== 'string' || seen.has(e.key)) continue;
      seen.add(e.key);
      out.push(e);
    }
    return out;
  }
  return Array.isArray(x.entries) ? x.entries : [];
}

function hasKey(x, key) {
  const k = canonCell(key == null ? '' : key);
  if (x && x.keys && typeof x.keys.has === 'function') return x.keys.has(k);
  return entriesOf(x).some(e => e.key === k);
}

function appendToText(current, entries) {
  const have = typeof current === 'string' ? parseLedger(current).keys : new Set();
  const appended = [], skipped = [];
  for (const raw of entries || []) {
    const e = normaliseEntry(raw);
    if (!e) { skipped.push({ key: raw && raw.key != null ? String(raw.key) : '', why: 'invalid' }); continue; }
    if (have.has(e.key)) { skipped.push({ key: e.key, why: 'present' }); continue; }
    have.add(e.key);
    appended.push(e);
  }
  if (!appended.length) return { text: current === undefined ? null : current, appended, skipped };
  const rows = appended.map(formatEntry).join('\n') + '\n';
  if (typeof current !== 'string') {
    const head = serializeFrontmatter({ type: 'rewards', started: appended[0].date });
    return { text: `${head}\n# Rewards\n\n${headerRows()}${rows}`, appended, skipped };
  }
  let text = current;
  if (text && !text.endsWith('\n')) text += '\n';
  /* New rows must sit directly under a table row to render as part of the
     table. When the file ends in anything else - prose, or a blank line after
     the table - start a fresh table (the parser skips repeated headers). The
     existing text is never touched, trailing blank lines included. */
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine.startsWith('|')) text += (lastLine === '' ? '' : '\n') + headerRows();
  return { text: text + rows, appended, skipped };
}

module.exports = { LEDGER_COLUMNS, KINDS, formatEntry, parseLedger, entriesOf, hasKey, appendToText };
