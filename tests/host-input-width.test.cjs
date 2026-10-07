'use strict';
/* THE HOST'S `width: 100%` ON TEXT INPUTS MUST NOT WIN ON A PHONE (0.12.1, L5-01).

   Obsidian's app.css ships

       .is-mobile input[type='text'] { width: 100%; }        specificity (0,2,1)

   and dom.js `numericInput` has built every number box as type="text" since
   0.11.0 (a type="number" box refuses "4,3" and 2.5 kg plates). The plugin
   sized those boxes with `.gv-app .gv-set-input { width: 82px }` — (0,2,0), one
   element short of the host. On a desktop pane nothing contests it; on a phone
   the host won, every box asked for the whole row, and the flex row shrank the
   set-tick button to 24px and the tap-count button to 22px: the primary action
   of the logging screen, unusable, on exactly the device it is used on. The
   desktop harness could not show it because it has no `.is-mobile`.

   app.css is Obsidian's proprietary file and is absent in CI, so the host rule
   is encoded below as DATA, with the version it was read from. If a newer
   Obsidian changes it, this constant is the one place to update — and the
   cascade runs again against whatever it now says.

   Three things are pinned:
     1. every plugin `width` rule on a class that lands on a text input
        OUT-RANKS the host rule (strictly: a tie is won by load order, which is
        true of Obsidian today and not something to lean on);
     2. the cascade OUTCOME — the width each box really resolves to on a phone
        and on a desktop pane, in both themes and both skins (this is the check
        that catches a fix which beats the host and then also beats a more
        specific plugin width, e.g. the sets box that must stay 56px);
     3. the tick and tap-count buttons can never shrink (`flex: 0 0 auto`).
   And a tripwire: a NEW text-input class in src/*.js must be considered here. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

/* ---- the host rule, as data ---- */
const HOST = {
  from: "Obsidian 1.14.4 app.css:21208 (same rule in 1.12.7)",
  rules: [{ selector: ".is-mobile input[type='text']", decls: [{ prop: 'width', value: '100%' }], line: 21208, media: null }],
  /* Properties that rule sets. min-width/flex are not among them, so a plugin
     rule that sets only those cannot lose to it. */
  props: ['width'],
};
const HOST_SPEC = cx.specificity(HOST.rules[0].selector);
assert.deepStrictEqual(HOST_SPEC, [0, 2, 1], 'the host selector must read (0,2,1): ' + HOST.from);

const rules = cx.load();

/* Classes that carry an explicit width. The first five land on type="text"
   boxes (dom.numericInput). The last two are type="number", which the host
   rule does not touch — but they also carry .gv-set-input, so their widths must
   out-rank the raised base width or the sets box turns 82px and the target box
   118px. */
const SIZED = ['gv-set-input', 'gv-set-input-narrow', 'gv-session-weight', 'gv-session-distance',
  'gv-timed-input', 'gv-edititem-sets', 'gv-rc-targetinput'];
/* A text input that takes its width from flex, not from a width rule. */
const UNSIZED_TEXT = ['gv-edititem-target'];

/* ---- 1. static: every width rule on those classes out-ranks the host ---- */
{
  const seen = new Set();
  const losers = [];
  for (const r of rules) {
    if (r.media || !r.decls.some(d => HOST.props.includes(d.prop))) continue;
    const sel = cx.parseSelector(r.selector);
    const last = sel.compounds[sel.compounds.length - 1];
    if (last.pseudoElement) continue;
    for (const cls of SIZED) {
      if (!last.classes.includes(cls)) continue;
      seen.add(cls);
      const spec = cx.specificity(sel);
      if (cx.compareSpec(spec, HOST_SPEC) <= 0) {
        losers.push(`src/styles.css:${r.line}  ${r.selector}  ${cx.fmtSpec(spec)}  does not out-rank the host ${cx.fmtSpec(HOST_SPEC)}`);
      }
    }
  }
  assert.deepStrictEqual(losers, [],
    `a plugin width rule must out-rank ${HOST.rules[0].selector} (${HOST.from}) or a phone's text box takes the whole row.\n` +
    'Put the element type in the selector, e.g. `body .gv-app input.gv-set-input`:\n' + losers.join('\n'));
  assert.deepStrictEqual(SIZED.filter(c => !seen.has(c)), [],
    'a class listed as sized has no width rule at all — the list here and the stylesheet have drifted');
}

/* ---- tripwire: every text-input class used by the JS is accounted for ---- */
{
  const dir = path.join(__dirname, '..', 'src');
  /* Classes on inputs that are NOT text, or that size themselves elsewhere. */
  const NOT_TEXT = ['gv-search', 'gv-rc-typein', 'gv-photo-scrub', 'gv-dial-range', 'gv-sr-only', 'gv-rc-targetinput', 'gv-edititem-sets'];
  const known = new Set(SIZED.concat(UNSIZED_TEXT, NOT_TEXT));
  const callText = (src, at) => {
    const open = src.indexOf('(', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
    }
    return '';
  };
  const found = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    /* `how`: 'class' reads the call's own class: '…' literal (a callback
       inside the call may mention other classes — a wrapper's, say — and those
       are not on the input); 'args' reads quoted 'gv-…' arguments. */
    const grab = (re, how, needText) => {
      let m;
      while ((m = re.exec(src))) {
        const text = callText(src, m.index).replace(/\$\{[^}]*\}/g, ' ');
        if (needText && !/type:\s*'text'/.test(text)) continue;
        const literals = how === 'class'
          ? [(/\bclass:\s*(['"`])((?:(?!\1)[^\\])*)\1/.exec(text) || [])[2] || '']
          : (text.match(/'gv-[A-Za-z0-9_-]+'/g) || []);
        for (const lit of literals) for (const t of lit.match(/gv-[A-Za-z0-9_-]+/g) || []) found.push({ file: f, cls: t });
      }
    };
    grab(/\bnumericInput\(\{/g, 'class', false);   /* every numericInput is type="text" */
    grab(/\bnumInput\(['"]/g, 'args', false);        /* page-log.js's wrapper passes a modifier class */
    grab(/\bel\('input'/g, 'class', true);           /* a bare text input */
  }
  const unknown = found.filter(x => !known.has(x.cls));
  assert.deepStrictEqual(unknown, [],
    'a class on a text input is not covered by host-input-width.test.cjs. A phone gives every type="text" box ' +
    '`width: 100%` — give the class a width rule that out-ranks it, add it to SIZED (or UNSIZED_TEXT if flex sizes it) here:\n' +
    unknown.map(x => `  ${x.file}: ${x.cls}`).join('\n'));
  assert.ok(found.length >= 6, 'the tripwire found almost no text-input classes — its scan has stopped working');
}

/* ---- 2 + 3. the cascade outcome, per context ---- */
const PHONE = ['is-mobile', 'is-phone', 'is-ios'];
const LOG = ['div.gv-card.gv-log-card', 'div.gv-log-sets', 'div.gv-log-set'];
const WIDTHS = [
  /* [label, inner chain, expected px] — the numbers are the layout's design: a 390px row holds
     num + two boxes + two units + counter + 48px tick. */
  ['log reps / seconds box', [...LOG, "input.gv-set-input[type=text]"], 82],
  ['log narrow box (weighted reps, kg, km, min)', [...LOG, "input.gv-set-input.gv-set-input-narrow[type=text]"], 66],
  ['guided weight box', ['div.gv-session-page', 'div.gv-session-weightrow', 'input.gv-set-input.gv-session-weight[type=text]'], 66],
  ['guided run box (km / min)', ['div.gv-session-page', 'div.gv-session-runrow', 'div.gv-session-runfield', 'input.gv-set-input.gv-session-distance[type=text]'], 66],
  ['guided timed box', ['div.gv-session-page', 'div.gv-timed-figures', 'div.gv-timed-field', 'input.gv-set-input.gv-timed-input[type=text]'], 84],
  ['plan edit: sets box (type=number, must stay 56px)', ['div.gv-card', 'div.gv-edititem', 'div.gv-edititem-rx', 'input.gv-set-input.gv-edititem-sets[type=number]'], 56],
  ['rep-counter target box (type=number, must stay 118px)', ['div.gv-rc-targetstep', 'div.gv-rc-targetcustom', 'input.gv-set-input.gv-rc-targetinput[type=number]'], 118],
];

const failures = [];
let checked = 0;
for (const theme of ['dark', 'light']) {
  for (const skin of ['floor', 'editorial']) {
    for (const [ctxLabel, host] of [['phone', PHONE], ['desktop', []]]) {
      for (const narrow of [true, false]) {
        const o = { theme, skin, accent: 'lime', host, narrow };
        const where = `${ctxLabel}/${theme}/${skin}${narrow ? '/narrow' : ''}`;
        for (const [label, inner, want] of WIDTHS) {
          const chain = cx.appChain(o, ...inner);
          const hit = cx.declarationsFor(chain, ['width'], rules, HOST.rules)[0];
          const got = hit ? hit.decl.value : '(none)';
          checked++;
          if (got !== want + 'px') {
            const who = hit ? (hit.rule.host ? `HOST ${hit.rule.selector}` : `src/styles.css:${hit.rule.line} ${hit.rule.selector}`) : 'no rule';
            failures.push(`${where}  ${label}: width resolves to ${got} (from ${who}), expected ${want}px`);
          }
        }
        /* The tick and the tap-count button hold their size. */
        const shrink = chainInner => {
          const hit = cx.declarationsFor(cx.appChain(o, ...chainInner), ['flex', 'flex-shrink'], rules, HOST.rules)[0];
          if (!hit) return '(none: shrinks)';
          const v = hit.decl.value.trim();
          return hit.decl.prop === 'flex' ? v : 'flex-shrink:' + v;
        };
        for (const [label, inner] of [
          ['set-tick button', [...LOG, 'button.gv-set-done']],
          ['tap-count button', [...LOG, 'button.gv-icon-btn.gv-icon-btn-small']],
        ]) {
          checked++;
          const got = shrink(inner);
          if (got !== '0 0 auto') failures.push(`${where}  ${label}: flex is ${got}, expected "0 0 auto" so a crowded row can never squeeze it`);
        }
        /* And the tick keeps its designed width. */
        const tick = cx.declarationsFor(cx.appChain(o, ...LOG, 'button.gv-set-done'), ['width'], rules, HOST.rules)[0];
        const tickWant = skin === 'editorial' ? '44px' : '48px';
        checked++;
        if (!tick || tick.decl.value !== tickWant) failures.push(`${where}  set-tick button: width ${tick ? tick.decl.value : '(none)'}, expected ${tickWant}`);
      }
    }
  }
}
assert.deepStrictEqual(failures, [],
  `${failures.length} of ${checked} cascade checks failed (src/styles.css vs ${HOST.from}):\n` + failures.join('\n'));

console.log(`host input width OK (${checked} cascade checks: 7 box kinds + tick/counter, phone + desktop, both themes, both skins)`);
