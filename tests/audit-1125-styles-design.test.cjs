'use strict';
/* AUDIT 25 NOV 2026, DESIGN FINDINGS 11-19 (lane L9, src/styles.css). Each check runs the real cascade
   (tests/css-cascade.js) or reads the stylesheet, so it fails against the stylesheet before the fix:
   GV_STYLES_CSS=<old copy> node tests/audit-1125-styles-design.test.cjs.

   #11 every skin shows the tab label under the icon on a narrow pane; Calm's selected tab has a solid mark
   #12 Apex dark has no coloured glow: no page wash, no text-shadow, no halo or bloom loop
   #13 Apex light: the timed ring is stroked in the accent-line tone; the warn band is DARKER than normal
   #14 Calm: the recap's "Most reps" label is sentence case
   #15 dark: the empty role ring holds 3:1 on its card
   #16 the setup Start has a bottom margin in every skin
   #17 Calm: "How plans work" takes Calm's corner radius
   #18 Apex: the time chip stacks on a phone up to 400px wide, so the outlined word keeps clear of it
   #19 Apex/Lock In: the live count zone cannot be squeezed below what it holds
   plus the role select (#10) and the plan list toolbar (#9), whose rules this lane wrote. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const cssPath = process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = cx.load();
const SKINS = ['apex', 'lockin', 'calm', 'floor', 'editorial'];

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const value = (chain, prop) => { const c = cx.computed(chain, prop, rules); return c ? c.value : null; };
const colour = (chain, prop) => {
  const c = cx.computed(chain, prop, rules);
  assert.ok(c, `no ${prop} reaches ${chain[chain.length - 1].tag}`);
  const v = cx.resolveVars(c.chain, c.value, rules);
  const p = cx.parseColor(v);
  assert.ok(p, `cannot read ${prop} "${v}"`);
  return p;
};

/* ---------- #11 ---------- */
for (const skin of SKINS) {
  for (const theme of ['light', 'dark']) {
    check(`#11 ${skin}/${theme}: a narrow tab shows its label under the icon`, () => {
      const btn = cx.appChain({ theme, skin, narrow: true }, 'nav.gv-nav', 'button.gv-nav-btn');
      const label = cx.appChain({ theme, skin, narrow: true }, 'nav.gv-nav', 'button.gv-nav-btn', 'span.gv-nav-label');
      assert.strictEqual(value(label, 'display'), 'block', 'the label is hidden');
      assert.strictEqual(value(btn, 'flex-direction'), 'column', 'icon over label');
      const phone = cx.appChain({ theme, skin, narrow: true, host: ['is-mobile', 'is-phone'] }, 'nav.gv-nav', 'button.gv-nav-btn', 'span.gv-nav-label');
      assert.strictEqual(value(phone, 'display'), 'block', 'the label is hidden on a phone host');
    });
  }
}
check('#11 Calm: the selected tab carries a solid bar in Calm\'s fill', () => {
  const r = rules.find(x => x.selector === '.gv-app.gv-skin-calm .gv-nav-btn.on::after' && !x.media);
  assert.ok(r, 'no Calm .on::after mark');
  const bg = (r.decls.find(d => d.prop === 'background-color' || d.prop === 'background') || {}).value || '';
  assert.match(bg, /var\(--gv-calm-fill\)/, 'the mark must use a Calm token');
});

/* ---------- #12 ---------- */
check('#12 no text-shadow anywhere (each was a coloured glow on a figure)', () => {
  assert.ok(!/\btext-shadow\s*:/.test(bare), 'a text-shadow is back');
});
check('#12 the Apex page has no gradient wash in either theme', () => {
  const bad = rules.filter(r => /^(\.theme-dark |\.theme-light )?\.gv-app\.gv-skin-apex$/.test(r.selector) && r.decls.some(d => /^background(-image)?$/.test(d.prop) && /gradient\(/.test(d.value)));
  assert.deepStrictEqual(bad.map(r => `:${r.line} ${r.selector}`), []);
});
check('#12 no halo or bloom loop behind a PB, no lime shadow glow in Apex', () => {
  assert.ok(!/@keyframes\s+gv-apex-(halo|glow)\b/.test(bare), 'a PB glow loop is back');
  const glow = rules.filter(r => /gv-skin-apex/.test(r.selector) && r.decls.some(d => d.prop === 'box-shadow' && /\b\d+px\s+\d+px\s+[1-9]\d*px[^,]*var\(--gv-lime/.test(d.value)));
  assert.deepStrictEqual(glow.map(r => `:${r.line} ${r.selector}`), [], 'a blurred lime box-shadow is a glow');
});
check('#12 Apex dark: the PB moment is the flat accent flood light mode uses', () => {
  const moment = cx.appChain({ theme: 'dark', skin: 'apex' }, 'div.gv-pb-moment');
  const slab = cx.computed(moment, '--gv-slab', rules);
  assert.ok(slab && /var\(--gv-lime\)/.test(slab.value), `dark PB moment slab is ${slab && slab.value}`);
});

/* ---------- #13 ---------- */
check('#13 Apex light: the ring fill is the accent-line tone, and the warn band is darker than it', () => {
  const o = { theme: 'light', skin: 'apex' };
  const fill = cx.appChain(o, 'div.gv-timed-dial', 'svg.gv-count-ring', 'circle.gv-count-ring-fill');
  const warn = cx.appChain(o, 'div.gv-timed-dial[data-urgency=warn]', 'svg.gv-count-ring', 'circle.gv-count-ring-fill');
  const line = cx.parseColor(cx.resolveVars(fill, 'var(--gv-accent-line)', rules));
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const f = colour(fill, 'stroke'), w = colour(warn, 'stroke');
  assert.strictEqual(cx.hex(f), cx.hex(line), 'the fill is not the accent-line tone');
  assert.ok(cx.ratio(f, white) >= 3, `the fill is ${cx.ratio(f, white).toFixed(2)}:1 on the white page`);
  assert.ok(cx.ratio(w, white) > cx.ratio(f, white), `warn ${cx.hex(w)} (${cx.ratio(w, white).toFixed(2)}:1) must be darker than the fill ${cx.hex(f)} (${cx.ratio(f, white).toFixed(2)}:1)`);
});

/* ---------- #14 ---------- */
check('#14 Calm: the recap label is sentence case', () => {
  assert.strictEqual(value(cx.appChain({ theme: 'light', skin: 'calm' }, 'dl.gv-recap', 'div.gv-recap-line', 'dt'), 'text-transform'), 'none');
});

/* ---------- #15 ---------- */
for (const skin of SKINS) {
  check(`#15 ${skin}/dark: the empty role ring holds 3:1 on its card`, () => {
    const opt = cx.appChain({ theme: 'dark', skin }, 'div.gv-plan-roles', 'button.gv-optrow.gv-plan-roleopt');
    const ring = cx.appChain({ theme: 'dark', skin }, 'div.gv-plan-roles', 'button.gv-optrow.gv-plan-roleopt', 'span.gv-radio');
    const border = colour(ring, 'border-color');
    const bg = cx.paintedBackground(opt, rules).colour;
    assert.ok(cx.ratio(border, bg) >= 3, `${cx.hex(border)} on ${cx.hex(bg)} is ${cx.ratio(border, bg).toFixed(2)}:1`);
  });
}

/* ---------- #16 ---------- */
for (const skin of SKINS) {
  check(`#16 ${skin}: the setup Start keeps the next section off it`, () => {
    /* The winner across the longhand AND the `margin` shorthand: Calm's `.gv-hero-action { margin: 16px 0 0 }`
       zeroed the bottom through the shorthand, which a margin-bottom-only lookup never sees. */
    const chain = cx.appChain({ theme: 'light', skin }, 'div.gv-guidesetup', 'div.gv-hero-action.gv-setup-start');
    const hit = cx.declarationsFor(chain, ['margin', 'margin-bottom'], rules)[0];
    assert.ok(hit, 'no margin reaches the setup Start');
    const parts = hit.decl.value.trim().split(/\s+/);
    const bottom = hit.decl.prop === 'margin-bottom' ? parts[0] : parts[parts.length >= 3 ? 2 : 0];
    assert.ok(parseFloat(bottom) >= 12, `the bottom margin is ${bottom} (from :${hit.rule.line} ${hit.rule.selector})`);
  });
}

/* ---------- #17 ---------- */
check('#17 Calm: "How plans work" takes Calm\'s radius', () => {
  assert.strictEqual(value(cx.appChain({ theme: 'light', skin: 'calm' }, 'details.gv-plan-help', 'dl'), 'border-radius'), 'var(--gv-calm-radius)');
});

/* ---------- #18 ---------- */
check('#18 Apex: the time chip stacks at phone widths up to 400px', () => {
  const m = [...bare.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([^{}]*\{[^{}]*\})*[^{}]*\}/g)]
    .find(x => /\.gv-app\.gv-skin-apex \.gv-hero-chip-row\s*\{[^}]*flex-direction:\s*column/.test(x[0]));
  assert.ok(m, 'no media block stacks the chip row');
  assert.ok(Number(m[1]) >= 400, `the chip only stacks below ${m[1]}px: at 375-390 the outlined word runs into it`);
});

/* ---------- #19 ---------- */
for (const skin of ['apex', 'lockin']) {
  check(`#19 ${skin}: the live count zone is never squeezed below its own content`, () => {
    const zone = cx.appChain({ theme: 'light', skin, narrow: true }, 'div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-rc-zone.gv-session-zone.gv-live-zone');
    assert.strictEqual(value(zone, 'min-height'), 'min-content', 'the zone clips (overflow: hidden), so `auto` would resolve to 0');
  });
}

/* ---------- #10 / #9: the rules this lane wrote for the plans list ---------- */
for (const skin of SKINS) {
  for (const theme of ['light', 'dark']) {
    check(`#10 ${skin}/${theme}: the role select is the app's own control, full width, 44px, no native box`, () => {
      const sel = cx.appChain({ theme, skin }, 'div.gv-card.gv-plan-card', 'div.gv-plan-main', 'div.gv-plan-ctl', 'div.gv-plan-role', 'select.dropdown.gv-plan-role-select');
      assert.strictEqual(value(sel, 'appearance'), 'none');
      assert.strictEqual(value(sel, 'max-width'), 'none', 'the 60% cap squeezed the select beside the switch');
      assert.ok(parseFloat(value(sel, 'min-height')) >= 44);
      const fg = colour(sel, 'color');
      const bg = colour(sel, 'background-color');
      assert.ok(cx.ratio(fg, bg) >= 4.5, `select text ${cx.hex(fg)} on ${cx.hex(bg)}`);
      const desc = cx.appChain({ theme, skin }, 'div.gv-card.gv-plan-card', 'div.gv-plan-main', 'div.gv-plan-ctl', 'div.gv-plan-role', 'div.gv-plan-role-desc');
      assert.strictEqual(value(desc, 'font-size'), '12px');
    });
  }
}
check('#9 the plan list toolbar: title alone on row 1; search, Browse and + Plan share row 2', () => {
  const o = { theme: 'light', skin: 'calm', narrow: true };
  const title = cx.appChain(o, 'div.gv-toolbar', 'h2.gv-toolbar-title:first-child:nth-last-child(4)');
  assert.strictEqual(value(title, 'flex'), '1 0 100%');
  const add = cx.appChain(o, 'div.gv-toolbar', 'button.gv-btn.gv-btn-ghost.gv-plan-add');
  assert.strictEqual(value(add, 'flex'), '0 0 auto', 'the + Plan button may shrink');
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('audit-1125 styles design OK');
