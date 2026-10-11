'use strict';
/* THE POSTER FAMILY: Apex and Lock In are one poster in two palettes, so the
   rules they have in common are written ONCE in src/styles.css against
   `.gv-skin-poster`, and the app root (and the rep-counter modal, which wears
   the skin too) carries that class IN ADDITION to gv-skin-<key>.

   What can go wrong silently, and what this pins:
     1  THE CLASS IS SET WHEREVER THE SKIN IS: a surface that gets gv-skin-apex
        but not gv-skin-poster would lose every shared rule and look half-styled.
        constants.skinClasses() is the one place that decides; the controller and
        the modal must both go through it, and nothing else in src/ may build a
        gv-skin-<key> class by hand.
     2  ONLY APEX AND LOCK IN WEAR IT: Floor and Editorial must not (a shared rule
        would repaint them).
     3  THE HOOK IS WRITTEN ONE WAY: every selector that names it starts at the
        app root (.gv-app.gv-skin-poster, optionally behind .theme-dark or
        body.is-phone), never names a single skin as well, and lives inside the
        Apex section (above the Lock In banner), where the poster's shared
        rules are read and where they win ties against the base styles.
     4  THE ENGINE AGREES: tests/css-cascade.js reads each shared rule as one rule
        per skin, same line and same source order, so every other guard keeps
        asserting what it always asserted for both skins.
   GV_STYLES_CSS points the CSS half at a deliberately broken copy (mutation testing). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');
const { POSTER_SKINS, SKINS, skinClasses } = require('../src/constants');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = process.env.GV_STYLES_CSS ? fs.readFileSync(process.env.GV_STYLES_CSS, 'utf8') : read('src/styles.css');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

/* ---------- 1 + 2: the class ---------- */
eq(POSTER_SKINS, ['apex', 'lockin'], 'the poster family is Apex and Lock In');
for (const [key] of SKINS) {
  const want = POSTER_SKINS.includes(key) ? [`gv-skin-${key}`, 'gv-skin-poster'] : [`gv-skin-${key}`];
  eq(skinClasses(key), want, `${key}: wears ${want.join(' + ')}`);
}
{
  const controller = read('src/controller.js'), modal = read('src/rep-counter-modal.js');
  ok(/classList\.add\(\.\.\.skinClasses\(plugin\.settings\.skin \|\| 'apex'\), `gv-accent-/.test(controller), 'the controller sets the skin classes through skinClasses()');
  ok(/for \(const cls of skinClasses\(this\.skin\)\) this\.modalEl\.addClass\(cls\)/.test(modal), 'the rep-counter modal sets the skin classes through skinClasses()');
  /* the controller's re-sync removes by prefix, so the poster class is dropped when the skin changes to Floor */
  ok(/cls\.indexOf\('gv-skin-'\) === 0/.test(controller), 'the controller clears every gv-skin-* class (the poster hook included) before re-adding');
  for (const f of fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js') && f !== 'constants.js')) {
    const code = read('src/' + f).split('\n').filter(l => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    ok(!/gv-skin-\$\{/.test(code), `src/${f} builds a gv-skin-<key> class by hand; go through constants.skinClasses() so the poster hook goes with it`);
  }
}

/* ---------- 3: the hook in the stylesheet ---------- */
const apexBanner = css.indexOf('SKIN: APEX'), lockBanner = css.indexOf('SKIN: LOCK IN');
ok(apexBanner > 0 && lockBanner > apexBanner, 'the Apex and Lock In banners are in order');
const apexLine = css.slice(0, apexBanner).split('\n').length, lockLine = css.slice(0, lockBanner).split('\n').length;
const rules = cx.load();
const shared = rules.filter(r => r.shared);
ok(shared.length > 300, `the shared poster rules parsed to almost nothing (${shared.length})`);
const poster = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].flatMap(m => m[1].split(',')).map(s => s.trim()).filter(s => /gv-skin-poster/.test(s));
ok(poster.length > 150, `expected the poster hook to carry the shared rules, found ${poster.length} selectors`);
for (const s of poster) {
  ok(/^(\.theme-dark |body\.is-phone )?\.gv-app\.gv-skin-poster(\.gv-narrow)?($|[\s.:>])/.test(s), `\`${s}\` must start at the app root: .gv-app.gv-skin-poster`);
  ok(!/gv-skin-(apex|lockin|floor|editorial)/.test(s), `\`${s}\` names the poster hook AND a single skin`);
}
for (const r of shared) ok(r.line >= apexLine && r.line < lockLine, `src/styles.css:${r.line} \`${r.selector}\` is a shared poster rule outside the Apex section`);

/* ---------- 4: the engine reads each shared rule as one rule per skin ---------- */
{
  const by = new Map();
  for (const r of shared) { const k = r.order + '|' + r.line; (by.get(k) || by.set(k, []).get(k)).push(r); }
  for (const group of by.values()) {
    const skins = new Set(group.map(r => (/gv-skin-(apex|lockin)/.exec(r.selector) || [])[1]));
    ok(skins.has('apex') && skins.has('lockin'), `src/styles.css:${group[0].line} \`${group[0].selector}\` expands to ${[...skins].join(',')} only`);
  }
}

console.log(`skin family OK (${n} checks: the poster class is set by skinClasses() in the controller and the modal and by nothing else; ${shared.length / 2} shared selectors, every one rooted at .gv-app.gv-skin-poster inside the Apex section; the engine reads each as one rule per skin)`);
