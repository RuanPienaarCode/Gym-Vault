'use strict';
/* A SMALL CSS CASCADE, FOR TESTS THAT NEED THE OUTCOME RATHER THAN THE RULE.

   Two audit findings (0.12.1, L5-01 and L5-02) were the same shape: a rule in
   src/styles.css looked right and a DIFFERENT rule won. A phone's
   `.is-mobile input[type='text'] { width: 100% }` out-ranked the plugin's
   `.gv-app .gv-set-input { width: 82px }`; a light-theme text colour kept
   winning in dark mode because no dark twin existed. Reading one rule says
   nothing about either. So these helpers answer the question that actually
   matters — "for THIS element, in THIS theme, which declaration wins?" — by
   running specificity + source order over the real stylesheet.

   NOT A BROWSER. It models only what src/styles.css uses: class / id / tag /
   attribute selectors, descendant and `>` combinators, :hover/:focus/:active,
   :first-child/:last-child/:empty, :not(). Anything else a rule that could
   match asks for THROWS instead of being skipped — a silently ignored rule is
   exactly how a guard ends up passing against the bug it was written for.
   Rules inside @media are ignored (the probes describe the resting state of a
   touch phone and of a desktop pane without hover-only styling), and
   @keyframes / @font-face are skipped.

   Host (Obsidian app.css) rules are not loaded: it is proprietary and absent
   in CI. A test that needs one states it as data (see host-input-width) and
   passes it to `cascade` ahead of the plugin's own rules. */
const fs = require('node:fs');
const path = require('node:path');

const SRC_CSS = path.join(__dirname, '..', 'src', 'styles.css');

/* ---------- stylesheet parsing ---------- */

/* Blank comments but keep every newline, so a rule's reported line number is
   the line in the file a person would open. */
const blank = css => css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  throw new Error('css-cascade: unbalanced { at offset ' + open);
}

/* Split on a delimiter that is not inside (), [] or a quoted string. */
function splitTop(text, delim) {
  const out = [];
  let depth = 0, quote = null, last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === delim && depth === 0) { out.push(text.slice(last, i)); last = i + 1; }
  }
  out.push(text.slice(last));
  return out;
}

function parseDecls(body) {
  const decls = [];
  for (const part of splitTop(body, ';')) {
    const at = part.indexOf(':');
    if (at === -1) continue;
    const prop = part.slice(0, at).trim();
    const value = part.slice(at + 1).replace(/!important/g, '').trim();
    if (prop) decls.push({ prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value });
  }
  return decls;
}

function parseStylesheet(css) {
  const src = blank(css);
  const starts = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') starts.push(k + 1);
  const lineAt = offset => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; };
  const rules = [];
  let order = 0;
  (function block(start, end, media) {
    let i = start;
    while (i < end) {
      while (i < end && /\s/.test(src[i])) i++;
      if (i >= end) break;
      const open = src.indexOf('{', i);
      if (open === -1 || open >= end) break;
      const close = matchBrace(src, open);
      const prelude = src.slice(i, open).trim();
      if (prelude[0] === '@') {
        const name = /^@([a-z-]+)/.exec(prelude)[1];
        /* @supports bodies are taken as true: every one in this file wraps a
           progressive enhancement the test engine would satisfy. */
        if (name === 'media') block(open + 1, close, prelude);
        else if (name === 'supports') block(open + 1, close, media);
      } else {
        const decls = parseDecls(src.slice(open + 1, close));
        const line = lineAt(i);
        const idx = order++;
        for (const sel of splitTop(prelude, ',')) {
          if (sel.trim()) rules.push({ selector: sel.trim(), decls, line, order: idx, media });
        }
      }
      i = close + 1;
    }
  })(0, src.length, null);
  return rules;
}

/* ---------- selectors ---------- */

const KNOWN_PSEUDO = new Set(['hover', 'focus', 'active', 'first-child', 'last-child', 'empty', 'not',
  'nth-child', 'nth-last-child', 'disabled', 'hidden']);

function parseCompound(text) {
  const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [], pseudoElement: false };
  let i = 0;
  const ident = () => { const m = /^[-\w\\]+/.exec(text.slice(i)); if (!m) throw new Error('css-cascade: bad selector "' + text + '"'); i += m[0].length; return m[0]; };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '*') { c.tag = '*'; i++; }
    else if (ch === '.') { i++; c.classes.push(ident()); }
    else if (ch === '#') { i++; c.id = ident(); }
    else if (ch === '[') {
      const end = text.indexOf(']', i);
      const m = /^\[\s*([-\w]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]$/.exec(text.slice(i, end + 1));
      if (!m) throw new Error('css-cascade: bad attribute selector in "' + text + '"');
      c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] });
      i = end + 1;
    } else if (ch === ':') {
      i++;
      if (text[i] === ':') { i++; ident(); c.pseudoElement = true; if (text[i] === '(') { i = matchParen(text, i) + 1; } continue; }
      const name = ident();
      let arg = null;
      if (text[i] === '(') { const close = matchParen(text, i); arg = text.slice(i + 1, close); i = close + 1; }
      /* Legacy single-colon pseudo-elements. */
      if (name === 'before' || name === 'after' || name === 'first-line' || name === 'first-letter') { c.pseudoElement = true; continue; }
      c.pseudos.push({ name, arg });
    } else if (/[-\w]/.test(ch)) { c.tag = ident().toLowerCase(); }
    else throw new Error('css-cascade: unsupported selector syntax "' + ch + '" in "' + text + '"');
  }
  return c;
}

function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  throw new Error('css-cascade: unbalanced ( in "' + text + '"');
}

/* A complex selector becomes { compounds: [c0..cn], combs: [' ' | '>'] } with
   combs[k] joining compounds[k] to compounds[k+1]. `+` and `~` are not used by
   this stylesheet and are refused rather than guessed at. */
function parseSelector(sel) {
  const compounds = [], combs = [];
  let cur = '', depth = 0, pending = null;
  const flush = () => { if (cur) { compounds.push(parseCompound(cur)); cur = ''; } };
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && /\s/.test(ch)) { if (cur) { flush(); pending = ' '; } continue; }
    if (depth === 0 && ch === '>') { flush(); pending = '>'; continue; }
    if (depth === 0 && (ch === '+' || ch === '~')) throw new Error('css-cascade: sibling combinator unsupported in "' + sel + '"');
    if (!cur && pending !== null && compounds.length) { combs.push(pending); pending = null; }
    cur += ch;
  }
  flush();
  return { compounds, combs };
}

/* (ids, classes+attributes+pseudo-classes, tags+pseudo-elements) */
function compoundSpec(c) {
  let a = c.id ? 1 : 0, b = c.classes.length + c.attrs.length, d = c.tag && c.tag !== '*' ? 1 : 0;
  if (c.pseudoElement) d++;
  for (const p of c.pseudos) {
    if (p.name === 'where') continue;
    if (p.name === 'not' || p.name === 'is') {
      const inner = splitTop(p.arg, ',').map(s => compoundSpec(parseCompound(s.trim())));
      inner.sort(compareSpec);
      const top = inner[inner.length - 1] || [0, 0, 0];
      a += top[0]; b += top[1]; d += top[2];
    } else b++;
  }
  return [a, b, d];
}

function specificity(sel) {
  const parsed = typeof sel === 'string' ? parseSelector(sel) : sel;
  return parsed.compounds.reduce((acc, c) => { const s = compoundSpec(c); return [acc[0] + s[0], acc[1] + s[1], acc[2] + s[2]]; }, [0, 0, 0]);
}

const compareSpec = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
const fmtSpec = s => '(' + s.join(',') + ')';

/* ---------- elements ---------- */

/* 'button.gv-btn-finish[type=button]:hover' -> an element description. */
function el(spec) {
  const c = parseCompound(spec);
  const e = { tag: c.tag || 'div', classes: new Set(c.classes), attrs: {}, state: {} };
  for (const a of c.attrs) e.attrs[a.name] = a.value === undefined ? '' : a.value;
  for (const p of c.pseudos) e.state[p.name + (p.arg ? '(' + p.arg + ')' : '')] = true;
  return e;
}

/* A chain is outermost -> innermost. :hover on an element implies it on every
   ancestor, as in a browser. */
function chainOf(specs) {
  const chain = specs.map(s => (typeof s === 'string' ? el(s) : s));
  for (let i = chain.length - 1; i > 0; i--) if (chain[i].state.hover) chain[i - 1].state.hover = true;
  return chain;
}

function matchCompound(c, e) {
  if (c.pseudoElement) return false;
  if (c.tag && c.tag !== '*' && c.tag !== e.tag) return false;
  for (const k of c.classes) if (!e.classes.has(k)) return false;
  for (const a of c.attrs) {
    if (!(a.name in e.attrs)) return false;
    if (a.op === null) continue;
    if (a.op !== '=') throw new Error('css-cascade: attribute operator ' + a.op + ' unsupported');
    if (e.attrs[a.name] !== a.value) return false;
  }
  for (const p of c.pseudos) {
    if (p.name === 'not') {
      if (splitTop(p.arg, ',').some(s => matchCompound(parseCompound(s.trim()), e))) return false;
    } else if (p.name === 'where' || p.name === 'is') {
      if (!splitTop(p.arg, ',').some(s => matchCompound(parseCompound(s.trim()), e))) return false;
    } else if (KNOWN_PSEUDO.has(p.name)) {
      if (!e.state[p.name + (p.arg ? '(' + p.arg + ')' : '')]) return false;
    } else {
      throw new Error('css-cascade: pseudo-class :' + p.name + ' unsupported');
    }
  }
  return true;
}

function matchesAt(sel, chain, at, k) {
  if (!matchCompound(sel.compounds[k], chain[at])) return false;
  if (k === 0) return true;
  if (sel.combs[k - 1] === '>') return at > 0 && matchesAt(sel, chain, at - 1, k - 1);
  for (let j = at - 1; j >= 0; j--) if (matchesAt(sel, chain, j, k - 1)) return true;
  return false;
}

/* ---------- cascade ---------- */

const parsedCache = new Map();
const selFor = text => { let p = parsedCache.get(text); if (!p) { p = parseSelector(text); p.spec = specificity(p); parsedCache.set(text, p); } return p; };

/* Every declaration of `props` that applies to the LAST element of `chain`,
   best first. `rules` are in source order; `extra` rules (the host's) come
   before them, i.e. lose every tie — Obsidian injects plugin CSS after
   app.css. */
function declarationsFor(chain, props, rules, extra) {
  const all = (extra || []).map((r, i) => Object.assign({ order: -1000 + i, host: true }, r)).concat(rules);
  const hits = [];
  for (const r of all) {
    if (r.media) continue;
    if (!r.decls.some(d => props.includes(d.prop))) continue;
    const sel = selFor(r.selector);
    if (!matchesAt(sel, chain, chain.length - 1, sel.compounds.length - 1)) continue;
    for (let n = r.decls.length - 1; n >= 0; n--) {
      const d = r.decls[n];
      if (props.includes(d.prop)) { hits.push({ rule: r, decl: d, spec: sel.spec, order: r.order, within: n }); break; }
    }
  }
  hits.sort((a, b) => compareSpec(b.spec, a.spec) || (b.order - a.order));
  return hits;
}

/* Custom properties and `color` inherit; everything else is per element. */
const INHERITED = p => p.startsWith('--') || p === 'color' || p === 'font-size' || p === 'font-weight';

function computed(chain, prop, rules, extra) {
  const inherits = INHERITED(prop);
  for (let end = chain.length; end >= 1; end--) {
    const sub = chain.slice(0, end);
    const hit = declarationsFor(sub, [prop], rules, extra)[0];
    if (hit && hit.decl.value !== 'inherit') return { value: hit.decl.value, rule: hit.rule, at: end - 1, chain: sub };
    if (!hit && !inherits) return null;
  }
  return null;
}

function resolveVars(chain, value, rules, extra, depth) {
  if ((depth || 0) > 8) throw new Error('css-cascade: var() cycle in ' + value);
  let out = value, guard = 0;
  for (;;) {
    const at = out.indexOf('var(');
    if (at === -1) return out;
    if (++guard > 20) throw new Error('css-cascade: runaway var() in ' + value);
    const close = matchParen(out, at + 3);
    const [name, ...fallback] = splitTop(out.slice(at + 4, close), ',');
    const found = computed(chain, name.trim(), rules, extra);
    let repl;
    if (found) repl = resolveVars(found.chain, found.value, rules, extra, (depth || 0) + 1);
    else if (fallback.length) repl = resolveVars(chain, fallback.join(',').trim(), rules, extra, (depth || 0) + 1);
    else throw new Error('css-cascade: ' + name.trim() + ' is not defined for this element');
    out = out.slice(0, at) + repl + out.slice(close + 1);
  }
}

/* ---------- colour ---------- */

function parseColor(text) {
  const t = text.trim().toLowerCase();
  if (t === 'transparent' || t === 'none') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; }
  return null;
}

const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
function ratio(a, b) { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); }

/* The colour `background` / `background-color` paints on one element, or null
   when it paints none. A gradient is refused: nothing probed uses one, and
   guessing a flat colour for it would be a made-up number. */
function ownBackground(chain, rules, extra) {
  const hit = declarationsFor(chain, ['background', 'background-color'], rules, extra)[0];
  if (!hit) return null;
  const value = resolveVars(chain, hit.decl.value, rules, extra);
  if (/gradient\(/.test(value)) throw new Error('css-cascade: gradient background on a probed element (' + hit.rule.selector + ')');
  let colour = null;
  for (const tok of splitTop(value.replace(/\s+/g, ' ').trim(), ' ')) { const c = parseColor(tok); if (c) { colour = c; break; } }
  return { colour: colour || { r: 0, g: 0, b: 0, a: 0 }, rule: hit.rule };
}

/* What is actually painted behind the last element: its own background over
   its ancestors', outermost first. */
function paintedBackground(chain, rules, extra) {
  let under = null, by = null;
  for (let end = 1; end <= chain.length; end++) {
    const own = ownBackground(chain.slice(0, end), rules, extra);
    if (!own || own.colour.a === 0) continue;
    under = under ? over(own.colour, under) : own.colour;
    by = own.rule;
  }
  if (!under || under.a < 1) throw new Error('css-cascade: nothing opaque paints behind ' + chain.map(e => e.tag).join(' > '));
  return { colour: under, rule: by };
}

function textColor(chain, rules, extra) {
  const bg = paintedBackground(chain, rules, extra);
  const found = computed(chain, 'color', rules, extra);
  if (!found) throw new Error('css-cascade: no text colour reaches the element');
  const value = resolveVars(found.chain, found.value, rules, extra);
  const fg = parseColor(value);
  if (!fg) throw new Error('css-cascade: cannot read colour "' + value + '" (' + found.rule.selector + ')');
  return { fg: over(fg, bg.colour), bg: bg.colour, fgRule: found.rule, bgRule: bg.rule };
}

/* px from a font-size declaration, as a 390px-wide phone would lay it out.
   Anything but a plain px or clamp(px, vw, px) is refused so a probe's WCAG
   size class is never guessed. */
function pxOf(value, viewport) {
  const v = value.trim();
  let m = /^(\d+(?:\.\d+)?)px$/.exec(v);
  if (m) return Number(m[1]);
  m = /^clamp\(\s*(\d+(?:\.\d+)?)px\s*,\s*(\d+(?:\.\d+)?)vw\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(v);
  if (m) return Math.max(Number(m[1]), Math.min(Number(m[2]) * (viewport || 390) / 100, Number(m[3])));
  throw new Error('css-cascade: font-size "' + value + '" is not a plain px or clamp(px, vw, px) value');
}

/* ---------- convenience ---------- */

/* GV_STYLES_CSS points the guards at another stylesheet — how a guard is
   mutation-tested against a deliberately broken copy without touching
   src/styles.css. */
function load(file) { return parseStylesheet(fs.readFileSync(file || process.env.GV_STYLES_CSS || SRC_CSS, 'utf8')); }

/* The element chain every probe lives in: body > leaf > .gv-app > page.
   `host` adds the body classes Obsidian mobile sets. */
function appChain(o, ...inner) {
  const body = ['body', 'theme-' + o.theme].concat(o.host || []);
  const root = ['view-content', 'gv-app', 'gv-skin-' + (o.skin || 'floor'), 'gv-accent-' + (o.accent || 'lime')].concat(o.narrow ? ['gv-narrow'] : []);
  return chainOf([
    'body' + body.slice(1).map(c => '.' + c).join(''),
    'div.workspace-leaf-content',
    'div' + root.map(c => '.' + c).join(''),
    'main.gv-page',
    ...inner,
  ]);
}

module.exports = {
  SRC_CSS, load, parseStylesheet, parseSelector, specificity, compareSpec, fmtSpec,
  el, chainOf, appChain, declarationsFor, computed, resolveVars,
  parseColor, ratio, hex, textColor, paintedBackground, pxOf,
};
