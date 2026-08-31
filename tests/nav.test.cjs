'use strict';
/* The nav bar's two standing promises.

   PROMISE 1 — the bar does not change size underneath you. Running used to
   carry `when: ctx => ctx.hasRunning()`, so a fresh vault showed five tabs
   and the first logged run silently made it six: every tab moved, mid-use,
   with no action that asked for it. Any future conditional tab reintroduces
   that, so `when` on a PRIMARY tab is a test failure rather than a judgement
   call. (`when` itself stays on the NAV shape as the extension point —
   `buildNav` still honours it — this only forbids using it in the main bar.)

   PROMISE 2 — the tabs divide the whole bar rather than huddling left, and
   their icons are big enough to hit with a thumb. Both are CSS, so both are
   asserted against the stylesheet the build actually ships. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

/* controller.js pulls in the whole page graph, and several of those modules
   import obsidian at load time. Same stub trick the other suites use. */
const origLoad = Module._load;
const stub = {
  setIcon: () => {},
  Notice: class {}, Modal: class {}, Plugin: class {}, ItemView: class {},
  PluginSettingTab: class {}, Setting: class {},
  TFile: class {}, TFolder: class {},
  normalizePath: p => p,
  requestUrl: () => {},
};
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));

const { NAV } = require('../src/controller');

const primary = NAV.filter(n => n.place !== 'head');
const head = NAV.filter(n => n.place === 'head');

/* ---- PROMISE 1: a stable, unconditional primary bar ---- */

assert.strictEqual(
  primary.length, 6,
  `the primary nav is six tabs — the count that fits a phone without scrolling. Got ${primary.length}: ` +
  primary.map(n => n.id).join(', '),
);

const conditional = primary.filter(n => n.when);
assert.deepStrictEqual(
  conditional.map(n => n.id), [],
  'a PRIMARY nav tab must not be conditional: a bar that grows from five tabs to six the first time ' +
  'you log something moves every tab underneath the user. Give the page an empty state instead. ' +
  `Conditional: ${conditional.map(n => n.id).join(', ')}`,
);

assert.ok(
  primary.some(n => n.id === 'running'),
  'Running is a primary tab — it is reachable before any run exists, which is the point.',
);

/* Utility destinations stay top-right. Moving them into the bar is what
   pushes it past six and starts the horizontal scrolling this avoids. */
assert.deepStrictEqual(
  head.map(n => n.id), ['profile', 'export'],
  'Profile and Export live in the header, not the nav bar.',
);

for (const item of NAV) {
  assert.ok(item.id && typeof item.id === 'string', `nav entry needs an id: ${JSON.stringify(item)}`);
  assert.ok(item.label && typeof item.label === 'string', `nav entry ${item.id} needs a label`);
  assert.ok(item.icon && typeof item.icon === 'string', `nav entry ${item.id} needs an icon name`);
}

/* ---- PROMISE 2: the bar is full width, with thumb-sized icons ---- */

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

{
  const rule = css.match(/\.gv-app \.gv-nav-btn\s*\{[^}]*\}/);
  assert.ok(rule, '.gv-app .gv-nav-btn rule missing');
  assert.match(
    rule[0], /flex:\s*1\s+1\s/,
    'nav buttons must flex-grow, or six tabs huddle at the left of the bar instead of filling it.',
  );
  /* basis must NOT be 0: `white-space: nowrap` is set on the same rule, so a
     0-basis shrinks a button below its own label and the text spills out of
     it on the in-between widths where labels are still visible. */
  assert.ok(
    !/flex:\s*1\s+1\s+0/.test(rule[0]),
    'nav buttons carry white-space:nowrap — a `flex: 1 1 0` basis shrinks them below their label ' +
    'and the text spills out of the button. Use `flex: 1 1 auto`.',
  );
  assert.match(
    rule[0], /max-width:\s*\d+px/,
    'cap the stretch — six tabs across a very wide desktop pane read as a stretched banner.',
  );
}

/* Centring a flex row that can also scroll puts the first item out of reach
   at overflow. The bar takes up its slack with flex-grow instead. */
{
  const nav = css.match(/\.gv-nav\s*\{[^}]*\}/);
  assert.ok(nav, '.gv-nav rule missing');
  if (/overflow-x:\s*auto/.test(nav[0])) {
    assert.ok(
      !/justify-content:\s*center/.test(nav[0]),
      '.gv-nav scrolls on overflow — `justify-content: center` would make the first tab ' +
      'unreachable once it does. Let the buttons grow instead.',
    );
  }
}

{
  const desktop = css.match(/\.gv-nav-btn \.gv-ico svg\s*\{[^}]*\}/);
  assert.ok(desktop, 'nav icon size rule missing');
  const dw = /width:\s*(\d+)px/.exec(desktop[0]);
  assert.ok(dw && Number(dw[1]) >= 18, `nav icons must be at least 18px, got ${dw && dw[1]}px`);

  const touch = css.match(/\.gv-app\.gv-narrow \.gv-nav-btn \.gv-ico svg\s*\{[^}]*\}/);
  assert.ok(touch, 'narrow-pane nav icon size rule missing');
  const tw = /width:\s*(\d+)px/.exec(touch[0]);
  assert.ok(tw && Number(tw[1]) >= 24, `nav icons on a phone must be at least 24px, got ${tw && tw[1]}px`);
  assert.ok(
    Number(tw[1]) > Number(dw[1]),
    'the phone nav icon must be larger than the desktop one — it is hit with a thumb, not a cursor.',
  );
}

console.log('nav OK (six unconditional primary tabs, utilities in the header, full-width bar, thumb-sized icons)');
