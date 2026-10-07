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

/* Flat `key: value` frontmatter plus lists — inline `[a, b]` (what the plugin
   writes) and block `- a` sequences of scalars (what OBSIDIAN writes). Nested
   YAML is deliberately out of the format — every file this plugin owns keeps
   its structure in the BODY (tables, day sections), so a tiny parser stays
   honest about what it can round-trip. */
/* Unquote a scalar: strip outer quotes, then undo yamlStr's escapes. The
   unescape must exist or values containing `"` gain a backslash per save
   cycle (write \" → read \" verbatim → write \\\" → …). */
const unquote = s => {
  /* YAML single-quoted (Obsidian and hand-edits write these): no backslash
     escapes, `''` is one literal `'`. Left alone, `'seconds'` kept its quotes
     when read and the next save double-wrapped it as `"'seconds'"`. As below,
     only unquote when every quote INSIDE is doubled — `'a' and 'b'` is not
     one quoted value. */
  if (/^'.*'$/.test(s)) {
    const inner = s.slice(1, -1);
    return inner.replace(/''/g, '').indexOf("'") === -1 ? inner.replace(/''/g, "'") : s;
  }
  if (!/^".*"$/.test(s)) return s;
  /* `/^".*"$/` cannot tell "fully quoted" from "merely starts and ends with a
     quote": `"a" and "b"` is the latter, and eating its outer quotes destroys
     the user's delimiters. Only unquote when nothing inside is an UNESCAPED
     quote — i.e. the final `"` really is the terminator. */
  const inner = s.slice(1, -1);
  if (/(^|[^\\])"/.test(inner)) return s;
  return inner.replace(/\\(["\\])/g, '$1');
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

/* Everything this parser cannot MODEL, it must PASS THROUGH byte-for-byte.

   Obsidian's own Properties panel writes `tags`, `aliases` and `cssclasses`
   as BLOCK SEQUENCES, and users hand-write nested maps and block scalars.
   The flat `key: value` reader turned all of those into '' (which the
   serializer then dropped) and, worse, hoisted a nested map's children to
   the top level — so `archive:\n  active: true` became the plan's own
   `active: true` and silently hijacked which plan was active.

   `layout` records the original line order. A part is one of:
     raw    — comment / blank / stray lines, re-emitted verbatim.
     key    — a flat `key: value` or inline list, re-emitted from `fm`.
     block  — a key whose value sits on the following lines and IS modelled:
              a block sequence of scalars (read into `fm` as an array) or an
              empty `key:` (kept OUT of `fm`). Re-emitted verbatim while `fm`
              still says what the lines say; once the plugin changes it, the
              whole block is REPLACED where it sits, in the plugin's own flow
              style.
     opaque — a key whose structure we cannot model (nested map, block
              scalar, list of maps). Verbatim, unless the plugin sets that key
              to a real value, which replaces it in place.
   Appending is only for keys the file never had: an existing key written
   twice is a duplicate-key error to Obsidian's parser (uniqueKeys) and the
   note's properties go invalid.
   The layout rides on the fm object under a Symbol, so `Object.entries`,
   spread and JSON.stringify all ignore it and every existing caller is
   unchanged. */
const FM_LAYOUT = Symbol.for('gv.fmLayout');

/* Where a key's value continues on the lines after it: indented lines and,
   for an empty `key:`, un-indented `- ` items (YAML allows both). Blank and
   comment lines belong to the block only when more of it follows. Returns the
   exclusive end index. */
function continuationEnd(lines, i, seqAtColumnZero) {
  let end = i + 1;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^\s+\S/.test(l) || (seqAtColumnZero && /^-(\s|$)/.test(l))) end = j + 1;
    else if (l.trim() !== '' && !/^#/.test(l)) break;
  }
  return end;
}

/* One block-sequence item as a scalar, or null when it is not a scalar (a map
   item, a nested list or block scalar, an anchor/tag) — the whole list is then
   left opaque rather than half-read. */
function blockItem(item) {
  if (/^"/.test(item)) return item.length > 1 && /"$/.test(item) ? unquote(item) : null;
  if (/^'/.test(item)) return item.length > 1 && /'$/.test(item) ? unquote(item) : null;
  if (/^\[\[[^\]]*\]\]$/.test(item)) return item;
  /* An unquoted ` #` starts a YAML comment: `- chest  # primary` is `chest`. */
  const plain = item.replace(/(^|\s+)#.*$/, '');
  if (/^[[{|>!&*]/.test(plain) || /^-(\s|$)/.test(plain) || /:(\s|$)/.test(plain)) return null;
  return plain;
}

/* The lines after `key:` as an array of scalars, or null when they are not a
   plain block sequence (every item at one indent, every item a scalar). */
function readBlockSeq(lines) {
  const items = [];
  let indent = -1;
  for (const l of lines) {
    if (l.trim() === '' || /^\s*#/.test(l)) continue;
    const m = l.match(/^(\s*)-(?:\s+(.*))?$/);
    if (!m) return null;
    if (indent < 0) indent = m[1].length;
    else if (m[1].length !== indent) return null;
    const v = blockItem((m[2] || '').trim());
    if (v === null) return null;
    if (v !== '') items.push(v);
  }
  return items;
}

/* A scalar, an inline list, or a wikilink (which is a scalar, not a list). */
function parseScalar(val) {
  /* `[[a.png]]` is one wikilink; `[[[a.png]], [[b.png]]]` is a LIST of two.
     The guard must require the FIRST `]]` to be the terminator, or a
     two-item list is swallowed whole as a scalar string. */
  if (/^\[.*\]$/.test(val) && !/^\[\[[^\]]*\]\]$/.test(val)) {
    return splitListItems(val.slice(1, -1));
  }
  return unquote(val);
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (m) {
    const lines = m[1].split(/\r?\n/);
    const layout = [];
    const raw = line => {
      const last = layout[layout.length - 1];
      if (last && last.kind === 'raw') last.lines.push(line);
      else layout.push({ kind: 'raw', lines: [line] });
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      /* Indented lines, sequence items, comments and blanks belong to
         whatever came before them — never to the top level. */
      if (/^\s/.test(line) || /^-\s/.test(line) || /^#/.test(line) || line.trim() === '') { raw(line); continue; }
      const ci = line.indexOf(':');
      if (ci <= 0) { raw(line); continue; }
      const key = line.slice(0, ci).trim();
      const rest = line.slice(ci + 1).trim();
      const next = lines[i + 1] ?? '';
      /* A key whose value lives on the FOLLOWING lines, or which the user
         left empty. A block sequence of scalars is what Obsidian's Properties
         panel writes for every list: read it. An empty `key:` is kept out of
         `fm` but remembered, so setting it later replaces the line instead of
         appending a second one. Anything else (nested map, block scalar, list
         of maps) we cannot represent — pass it through whole. */
      if (rest === '' || rest === '>' || rest === '|' || /^\s+\S/.test(next)) {
        const end = continuationEnd(lines, i, rest === '');
        const block = lines.slice(i, end);
        const seq = rest === '' ? readBlockSeq(block.slice(1)) : null;
        if (seq) {
          if (seq.length) fm[key] = seq;
          layout.push({ kind: 'block', key, lines: block });
        } else {
          layout.push({ kind: 'opaque', key, lines: block });
        }
        i = end - 1;
        continue;
      }
      fm[key] = parseScalar(rest);
      layout.push({ kind: 'key', key });
    }
    Object.defineProperty(fm, FM_LAYOUT, { value: layout, enumerable: true, writable: true, configurable: true });
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

/* Serialize a frontmatter object.

   Two different jobs, and conflating them was a data-loss bug: a key the
   PLUGIN built with an empty value is an unset optional and should simply
   not appear, but a key that came from the USER'S FILE with an empty value
   is theirs and deleting it destroys their data. The layout recorded at
   parse time is what tells the two apart; a plain object built in code has
   no layout and behaves exactly as before.

   A key already in the file is only ever REPLACED where it sits (see the
   layout note at FM_LAYOUT); the append loop at the end is for keys the file
   never had. */
const isEmptyFm = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
/* Same value for the purpose of "did the plugin change this?": numbers match
   their digit strings (a form re-saving `[4, 5, 6]` over `- 4` is no edit). */
function sameFm(a, b) {
  if (isEmptyFm(a) || isEmptyFm(b)) return isEmptyFm(a) && isEmptyFm(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => String(x) === String(b[i]));
  return String(a) === String(b);
}
const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function serializeFrontmatter(fm) {
  const layout = fm ? fm[FM_LAYOUT] : null;
  const lines = [];
  const done = new Set();
  const emit = (k, v) => {
    if (isEmptyFm(v)) return;
    lines.push(`${k}: ${yamlVal(v)}`);
  };
  if (layout) {
    for (const part of layout) {
      if (part.kind === 'raw') { lines.push(...part.lines); continue; }
      /* A key the file holds twice (an earlier save wrote one) is written
         once, so the next save heals the note instead of re-emitting it. */
      if (done.has(part.key)) continue;
      done.add(part.key);
      const cur = hasKey(fm, part.key) ? fm[part.key] : undefined;
      if (part.kind === 'block') {
        /* Unchanged → the user's own lines, byte for byte. */
        if (sameFm(cur, readBlockSeq(part.lines.slice(1)))) lines.push(...part.lines);
        else emit(part.key, cur);
      } else if (part.kind === 'opaque') {
        /* The plugin cannot read this key; it only replaces it if it was
           told to write a real value there. */
        if (isEmptyFm(cur)) lines.push(...part.lines);
        else emit(part.key, cur);
      } else {
        emit(part.key, cur);
      }
    }
  }
  /* Keys the plugin added since the file was read go after what was there. */
  for (const [k, v] of Object.entries(fm)) {
    if (done.has(k)) continue;
    emit(k, v);
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
/* Cells beyond the schema are the USER'S OWN COLUMN. The positional map
   can't name them, so they ride along as an opaque tail rather than being
   dropped on the next write. */
const ROW_EXTRA = Symbol.for('gv.rowExtra');

function tableToObjects(text, columns) {
  const rows = parseMdTable(text);
  if (!rows.length) return [];
  return rows.slice(1).map(cells => {
    const o = {};
    columns.forEach((col, i) => { o[col.key] = unescMd(cells[i] ?? ''); });
    const tail = cells.slice(columns.length);
    if (tail.length) o[ROW_EXTRA] = tail.map(unescMd);
    return o;
  });
}

function buildMdTable(columns, objects, extraLabels) {
  const extras = extraLabels && extraLabels.length ? extraLabels : [];
  const head = `| ${[...columns.map(c => c.label), ...extras].join(' | ')} |`;
  const sep = `|${[...columns, ...extras].map(() => '---').join('|')}|`;
  const body = objects.map(o => {
    const tail = o[ROW_EXTRA] || [];
    const cells = [...columns.map(c => escMd(o[c.key])), ...extras.map((_, i) => escMd(tail[i] ?? ''))];
    return `| ${cells.join(' | ')} |`;
  });
  return [head, sep, ...body].join('\n');
}

/* The line span of the first table, scanned by exactly parseMdTable's rules
   so the span we replace is always the table we actually read. */
function firstTableSpan(text) {
  const lines = text.split(/\r?\n/);
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('|')) { if (start >= 0) break; continue; }
    if (start < 0) start = i;
    end = i + 1;
  }
  return start < 0 ? null : { start, end };
}

/* Splice a rebuilt table into the file IN PLACE, leaving every other line
   byte-identical. Returns null when there is no table to replace — the
   caller decides whether to append or refuse, because silently rebuilding
   the whole file is how headings, prose and whole sections got deleted. */
function replaceFirstTable(text, table) {
  const span = firstTableSpan(text);
  if (!span) return null;
  const lines = text.split(/\r?\n/);
  lines.splice(span.start, span.end - span.start, ...table.split('\n'));
  return lines.join('\n');
}

/* Header labels of the first table — for checking it is OURS before writing. */
function tableHeaderLabels(text) {
  const rows = parseMdTable(text);
  return rows.length ? rows[0] : null;
}

module.exports = {
  escMd, unescMd, parseFrontmatter, serializeFrontmatter, yamlStr,
  splitBarePipes, parseMdTable, tableToObjects, buildMdTable,
  firstTableSpan, replaceFirstTable, tableHeaderLabels, ROW_EXTRA,
};
