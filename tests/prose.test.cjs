'use strict';
/* Plan prose: chunking, and the accordion that keeps long coaching copy
   readable without hiding anything that matters.

   THE BUG THIS LOCKS: the plans page rendered note prose as
   `lines.join(' ')`, flattening blank-line paragraph breaks AND bullet
   lines into one unbroken blob — 700 characters of undifferentiated text
   on a phone, which is what "this copy is overwhelming" was reporting.

   THE SAFETY CONSTRAINT: these intros carry medical red flags ("STOP AND
   GET ASSESSED IF YOU GET: leaking urine…"). An earlier attempt classified
   paragraphs as safety-critical by keyword and kept those expanded, but the
   matcher missed a real warning that never says "stop" or "see a doctor".
   So nothing is classified: EVERY chunk's headline stays on screen and only
   the detail collapses. The tests below enforce that invariant. */
const assert = require('node:assert');
const Module = require('node:module');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? { setIcon: () => {} } : origLoad(req, ...rest));

const mkNode = tag => ({
  /* style.display starts '' as it does in a real DOM — undefined would be a harness artifact. */
  /* nodeType 1 is load-bearing, not decoration: el() checks `kid.nodeType`
     to tell an element from a string, so a stub without it gets its
     element children stringified to "[object Object]".
     style.display starts '' as in a real DOM. */
  nodeType: 1, tag, className: '', style: { display: '' }, children: [], attrs: {}, listeners: {},
  classList: { add(c) { this.owner.className = (this.owner.className + ' ' + c).trim(); } },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
  append(...kids) { for (const k of kids) this.children.push(k); },
  get textContent() {
    if (this._text) return this._text;
    return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join('');
  },
  set textContent(v) { this._text = v; this.children = []; },
  querySelector: () => null,
});
global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};

const { paragraphs, chunks, prose } = require('../src/dom');
Module._load = origLoad;

const flat = node => (node.nodeType === 3 ? [node] : [node, ...node.children.flatMap(flat)]);
const byTag = (node, tag) => flat(node).filter(n => n.tag === tag);
const hasClass = (node, c) => String(node.className || '').split(/\s+/).includes(c);

/* ---------- paragraphs(): blank lines are paragraph breaks ---------- */
assert.deepStrictEqual(
  paragraphs(['One line', 'wraps on.', '', 'Second para.', '', '', 'Third.']),
  ['One line wraps on.', 'Second para.', 'Third.'],
);
assert.deepStrictEqual(paragraphs([]), []);
assert.deepStrictEqual(paragraphs(undefined), [], 'undefined is not a crash');
assert.deepStrictEqual(paragraphs(['   ', '']), [], 'whitespace-only lines are not paragraphs');

/* ---------- chunks(): headline extraction ---------- */
const c1 = chunks(['THE WEEK: Mon pull, Wed push.', '', 'At-home strength, four days a week.']);
assert.strictEqual(c1.length, 2);
assert.strictEqual(c1[0].label, 'THE WEEK:', 'an ALL-CAPS lead-in becomes the headline');
assert.strictEqual(c1[0].blocks[0].text, 'Mon pull, Wed push.', 'and is stripped from the body');
assert.ok(c1[1].label.startsWith('At-home strength'), 'an unlabelled chunk is summarised, never left blank');
assert.ok(!c1[1].label.endsWith('…'), 'a short paragraph is summarised whole — no needless ellipsis');
const longEnough = chunks(['One two three four five six seven eight nine ten eleven.'])[0].label;
assert.strictEqual(longEnough, 'One two three four five six seven eight…', 'a long paragraph truncates at eight words');

assert.strictEqual(chunks(['PHASE 1 OF 4 — FOUNDATION. Breathing.'])[0].label, 'PHASE 1 OF 4 — FOUNDATION.',
  'a lead-in may end in a period');
assert.strictEqual(chunks(['WHILE REBUILDING (to 11 Sep): both runs are optional.'])[0].label,
  'WHILE REBUILDING (to 11 Sep):', 'a parenthetical may carry lowercase');
const notLeadIn = chunks(['Warm-up before every session (~5 min): shoulder rolls and arm circles.'])[0];
assert.ok(notLeadIn.label.startsWith('Warm-up before every session'),
  'ordinary sentence-case prose is NOT mistaken for a lead-in — it is summarised instead');
assert.strictEqual(notLeadIn.blocks[0].text, 'Warm-up before every session (~5 min): shoulder rolls and arm circles.',
  'and nothing is stripped from its body');

/* ---------- REGRESSION: wrapped bullets must not split their list ---------- */
const wrapped = chunks([
  'THE RULES FOR THESE TWO WEEKS:',
  '',
  '- Three sessions a week, 48 hours apart.',
  '- NO explosive work — no Box Jumps. Those are',
  '  the most likely to aggravate a joint.',
  '- Give this two full weeks.',
]);
assert.strictEqual(wrapped.length, 1, 'a lead-in-only group adopts the list that follows it');
assert.strictEqual(wrapped[0].label, 'THE RULES FOR THESE TWO WEEKS:');
assert.strictEqual(wrapped[0].blocks.length, 1, 'the list stays ONE block — no stray paragraphs');
assert.strictEqual(wrapped[0].blocks[0].kind, 'ul');
assert.deepStrictEqual(wrapped[0].blocks[0].items.length, 3, 'three bullets, not five fragments');
assert.match(wrapped[0].blocks[0].items[1], /Box Jumps\. Those are the most likely to aggravate a joint\./,
  'an indented continuation line rejoins ITS bullet (Markdown lazy continuation)');

/* ---------- REGRESSION: a bare list continues what introduced it ---------- */
const checks = chunks([
  'THE RETURN-TO-RUNNING CHECKS. Work these until you can do all of them.',
  '',
  '- Walk 30 minutes briskly',
  '- Balance on one leg, 10 seconds',
]);
assert.strictEqual(checks.length, 1, 'the checks belong to the heading that announced them');
assert.strictEqual(checks[0].label, 'THE RETURN-TO-RUNNING CHECKS.');
assert.strictEqual(checks[0].blocks.filter(b => b.kind === 'ul').length, 1);

/* numbered lists too */
const prog = chunks(['THE PROGRESSION. One step per week.', '', '1. Walk 4 min / jog 1 min', '2. Walk 3 min / jog 2 min']);
assert.strictEqual(prog[0].blocks.find(b => b.kind === 'ol').items.length, 2, 'ordered lists are ordered lists');

/* ---------- prose(): one chunk gets no accordion chrome ---------- */
const one = prose(['Just this, nothing more.']);
assert.strictEqual(byTag(one, 'button').length, 0, 'a single chunk needs no disclosure control');
assert.strictEqual(byTag(one, 'p').length, 1);

/* ---------- prose(): THE SAFETY INVARIANT ---------- */
const intro = [
  'PHASE 1 OF 4 — FOUNDATION. Breathing and gentle core.',
  '',
  'BEFORE ANYTHING ELSE: see a pelvic health physiotherapist.',
  '',
  'STOP AND GET ASSESSED IF YOU GET: leaking urine, heaviness, or bleeding that had stopped starting again.',
  '',
  'Leaking or dragging during a run means go back a step and get it looked at.',
];
const acc = prose(intro, { class: 'gv-plan-intro' });
const heads = byTag(acc, 'button');
assert.strictEqual(heads.length, 4, 'EVERY chunk gets a headline control — none opens expanded');

const headlines = flat(acc).filter(n => hasClass(n, 'gv-chunk-label')).map(n => n.textContent);
assert.ok(headlines.some(h => h.startsWith('PHASE 1 OF 4')), 'lead headline visible');
assert.strictEqual(headlines.length, 4, 'one headline per chunk, all on screen');
assert.ok(headlines.some(h => h === 'BEFORE ANYTHING ELSE:'), 'the referral warning is visible WITHOUT expanding');
assert.ok(headlines.some(h => h === 'STOP AND GET ASSESSED IF YOU GET:'), 'the red-flag warning is visible WITHOUT expanding');
assert.ok(headlines.some(h => /^Leaking or dragging/.test(h)),
  'a warning with NO caps lead-in — the one keyword matching missed — is still summarised on screen');

/* Collapsed state is carried by a CLASS, not an inline style — Obsidian's
   review guidelines ask plugins not to assign styles from JS. */
const closedChunks = flat(acc).filter(n => hasClass(n, 'gv-chunk') && !hasClass(n, 'open'));
assert.strictEqual(closedChunks.length, 4, 'the intro opens as a compact stack of headlines, nothing expanded');
for (const chunk of closedChunks) {
  const body = flat(chunk).find(n => hasClass(n, 'gv-chunk-body'));
  assert.ok(body, 'a closed chunk still HAS its body in the DOM');
  assert.strictEqual(byTag(body, 'button').length, 0, 'a headline control is never buried inside a collapsed body');
}
for (const n of flat(acc)) {
  assert.strictEqual(n.style && n.style.display, n.nodeType === 3 ? undefined : '',
    'no element carries a JS-assigned display style');
}

/* every word is in the DOM even while collapsed */
const allText = flat(acc).filter(n => n.nodeType === 3).map(n => n.text).join(' ');
assert.match(allText, /bleeding that had stopped starting again/,
  'collapsing is VISUAL only — find-in-page and screen readers still reach the full warning');

/* ---------- prose(): the toggle ---------- */
const head = heads[0];
assert.strictEqual(head.attrs['aria-expanded'], 'false');
assert.ok(head.attrs['aria-controls'], 'the header points at the body it controls');
const headChunk = flat(acc).find(n => hasClass(n, 'gv-chunk') && flat(n).includes(head));
head.listeners.click[0]();
assert.strictEqual(head.attrs['aria-expanded'], 'true', 'assistive tech is told the state changed');
assert.ok(hasClass(headChunk, 'open'), 'and the open state is a class');
head.listeners.click[0]();
assert.strictEqual(head.attrs['aria-expanded'], 'false', 'and it collapses again');
assert.ok(!hasClass(headChunk, 'open'));

/* ---------- TRIPWIRE: the flattening must not come back ---------- */
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-plans.js'), 'utf8');
assert.doesNotMatch(
  src, /(intro|notes)\s*\.join\(/,
  'page-plans.js must not flatten intro/notes with .join() — that is the wall-of-text bug; use prose()',
);

console.log('prose OK (chunked, lists intact, every warning headline visible while collapsed)');
