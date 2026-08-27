'use strict';
/* The markdown files ARE the database (same storage philosophy as the budget
   plugin). Everything the plugin shows is derived from files the user could
   have written by hand, so:

     - a hand-edited file must survive a round trip: parseMdTable stops at the
       first table and tolerates a missing trailing pipe; frontmatter parsing
       keeps unknown keys so a serializer can write them back verbatim.
     - anything written back must not corrupt the file for OBSIDIAN, which
       parses it too — escMd/yamlStr exist for that.

   Pure — no DOM, no obsidian import.

   iOS note: no lookbehind regex anywhere in src/ — a lookbehind LITERAL is a
   parse-time SyntaxError on WebKit before iOS 16.4 and kills the whole bundle
   at load. Pipe escaping is handled char-by-char instead. */

const escMd = s => (s ?? '').toString().replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
const unescMd = s => (s ?? '').replace(/<br>/g, '\n').replace(/\\\|/g, '|').trim();

/* ---- frontmatter ---------------------------------------------------- */

/* Flat `key: value` frontmatter plus inline lists `[a, b]`. Nested YAML is
   deliberately out of the format — every file this plugin owns keeps its
   structure in the BODY (tables, day sections), so a tiny parser stays honest
   about what it can round-trip. */
/* Unquote a scalar: strip outer quotes, then undo yamlStr's escapes. The
   unescape must exist or values containing `"` gain a backslash per save
   cycle (write \" → read \" verbatim → write \\\" → …). */
const unquote = s => {
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return s;
};

/* Split an inline list on commas that sit OUTSIDE quotes, so
   `[ "a, b", c ]` stays two items. Char-by-char (no lookbehind — iOS). */
function splitListItems(inner) {
  const items = [];
  let cur = '', inQ = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== '\\') { inQ = !inQ; cur += ch; }
    else if (ch === ',' && !inQ) { items.push(cur); cur = ''; }
    else cur += ch;
  }
  items.push(cur);
  return items.map(s => unquote(s.trim())).filter(Boolean);
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      /* `[[wikilink]]` is a scalar, not a list — Obsidian users type these
         for media paths, and eating the outer brackets breaks the link. */
      if (/^\[.*\]$/.test(val) && !/^\[\[.*\]\]$/.test(val)) {
        val = splitListItems(val.slice(1, -1));
      } else {
        val = unquote(val);
      }
      fm[key] = val;
    }
  }
  /* Strip ALL leading blank lines, not just one: every writer joins with
     `fm + '\n' + body`, so a single-newline strip here would grow the body
     by one blank line per save cycle (verified in the logic audit). */
  return { fm, raw: m ? m[1] : '', body: m ? text.slice(m[0].length).replace(/^(\r?\n)+/, '') : text };
}

/* Quote a scalar for YAML when it would otherwise change meaning. The
   newline fold mirrors escMd: these values are single-line by contract. */
function yamlStr(v) {
  const s = (v ?? '').toString().replace(/\r?\n/g, ' ').trim();
  if (s === '') return '""';
  if (/[:#\[\]{}"'|>&*!%@`,]|^\s|\s$|^-|^\d+$/.test(s) && !/^[\d.]+$/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

const yamlVal = v => {
  if (Array.isArray(v)) return `[${v.map(yamlStr).join(', ')}]`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return yamlStr(v);
};

/* Serialize a frontmatter object. Skips null/undefined/'' so optional keys
   simply don't appear rather than appearing blank. */
function serializeFrontmatter(fm) {
  const lines = [];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    lines.push(`${k}: ${yamlVal(v)}`);
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

/* ---- markdown tables ------------------------------------------------- */

/* "Split on unescaped pipes", char-by-char (see iOS note above). */
const endsWithBarePipe = s => s.endsWith('|') && s[s.length - 2] !== '\\';
function splitBarePipes(s) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '|' && s[i - 1] !== '\\') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/* Rows of the FIRST table in `text` (header row included, separator dropped).
   Stops at the first non-table line after rows start, so prose or a second
   table below never bleeds into the data. */
function parseMdTable(text) {
  const rows = [];
  let sepSeen = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) { if (rows.length) break; continue; }
    /* Exactly ONE separator, right after the header — matching the dash
       pattern anywhere else would eat a hand-written all-dash DATA row
       like `| - | - | … |`. */
    if (!sepSeen && rows.length === 1 && /^\|[\s:|-]+\|$/.test(t)) { sepSeen = true; continue; }
    let inner = t.slice(1);
    if (endsWithBarePipe(inner)) inner = inner.slice(0, -1);
    rows.push(splitBarePipes(inner).map(c => c.trim()));
  }
  return rows;
}

/* First table → array of objects keyed by `columns` (a schema array of
   {key, label}). Mapping is POSITIONAL against the schema, which is why the
   schema is append-only. */
function tableToObjects(text, columns) {
  const rows = parseMdTable(text);
  if (!rows.length) return [];
  return rows.slice(1).map(cells => {
    const o = {};
    columns.forEach((col, i) => { o[col.key] = unescMd(cells[i] ?? ''); });
    return o;
  });
}

function buildMdTable(columns, objects) {
  const head = `| ${columns.map(c => c.label).join(' | ')} |`;
  const sep = `|${columns.map(() => '---').join('|')}|`;
  const body = objects.map(o => `| ${columns.map(c => escMd(o[c.key])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

module.exports = {
  escMd, unescMd, parseFrontmatter, serializeFrontmatter, yamlStr,
  splitBarePipes, parseMdTable, tableToObjects, buildMdTable,
};
