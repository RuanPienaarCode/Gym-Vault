'use strict';
/* REWARDS UI - draws what src/rewards-view.js says, wherever it lives: Today's
   three slots (level row, XP chip, weekly quest), the XP card and medal-unlocked
   card on Session complete, the Medals section on Records and the level hero on
   Profile.

   Nothing here decides a number. Every figure is a field of a view-model (itself the
   engine's figure, formatted); this file chooses elements and classes. The skins
   (src/styles.css, the REWARDS UI blocks) do all the looking: the same markup is a
   hexagon in Apex, a starburst in Lock In and a hairline ring in Floor / Editorial.

   REWARDS OFF: every entry point returns before it builds, reads or computes.
   NEVER AN ERROR: every mount is wrapped; a rewards bug leaves its slot empty and the
   page it sits in untouched (the page's own try/catch is not the only defence).

   MARKUP CONTRACT (the tests and the contrast probes follow these chains)
     bar      div.gv-rw-bar[role=progressbar] > i.gv-rw-bar-fill (+ i.gv-rw-bar-gain)
     hex      div.gv-rw-hex.is-<tier>.is-<size> > div.gv-rw-hex-in > b.gv-rw-hex-num | span.gv-ico
     level    div.gv-rw-level > hex, div.gv-rw-level-mid
     quest    section.gv-rw-quest.is-<open|done|paid>
     xp card  section.gv-rw-xp ; medal unlocked  section.gv-rw-unlock
     medals   section.gv-rw-medals > ul.gv-rw-medal-grid > li.gv-rw-medal.is-<tier>
     profile  article.gv-rw-profile */

const { el, ico } = require('./dom');
const V = require('./rewards-view');
const F = require('./rewards-flow');

const isGone = node => !!node && node.isConnected === false;
const safe = (what, fn) => { try { return fn(); } catch (e) { console.error(`gym-vault rewards ${what}`, e); return undefined; } };

/* ---- parts ---- */

/* A hexagon (Apex), starburst (Lock In) or ring (Floor, Editorial): one markup, the skin draws it.
   `tier` is gold | silver | bronze | lock | lime (the level hex). */
function hexNode(o) {
  const inner = o.icon ? ico(o.icon) : el('b', { class: 'gv-rw-hex-num' }, o.text == null ? '' : String(o.text));
  const attrs = { class: `gv-rw-hex is-${o.tier || 'lime'} is-${o.size || 'md'}` };
  if (o.label) { attrs.role = 'img'; attrs['aria-label'] = o.label; } else attrs['aria-hidden'] = 'true';
  return el('div', attrs, el('div', { class: 'gv-rw-hex-in' }, inner));
}

const pct100 = n => Math.max(0, Math.min(100, Number(n) || 0));

/* A progress bar that says its value to a screen reader. `fill` and `gain` are exact
   widths (view-model fields); `now` is the whole percent the engine prints. */
function barNode(o) {
  const attrs = {
    class: `gv-rw-bar${o.cls ? ' ' + o.cls : ''}`, role: 'progressbar',
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct100(o.now))),
  };
  if (o.text) attrs['aria-valuetext'] = o.text;
  if (o.label) attrs['aria-label'] = o.label;
  const bar = el('div', attrs, el('i', { class: 'gv-rw-bar-fill', style: `width:${pct100(o.fill)}%` }));
  if (o.gain) bar.append(el('i', { class: 'gv-rw-bar-gain', style: `left:${pct100(o.fill)}%;width:${pct100(o.gain)}%` }));
  return bar;
}

/* ---- Today ---- */

function levelNode(row) {
  return el('div', { class: `gv-rw-level is-rank-${row.rankIndex}`, role: 'group', 'aria-label': row.aria },
    hexNode({ tier: 'lime', size: 'sm', text: row.level }),
    el('div', { class: 'gv-rw-level-mid' },
      el('div', { class: 'gv-rw-level-top' },
        el('b', { class: 'gv-rw-level-title' }, row.title),
        el('span', { class: 'gv-rw-level-to' }, row.toText)),
      barNode({ cls: 'is-thin', fill: row.fill, now: row.pct, text: row.aria, label: 'Level progress' }),
      el('div', { class: 'gv-rw-level-foot' },
        el('span', { class: 'gv-rw-level-rank' }, row.rank),
        el('span', { class: 'gv-rw-level-into' }, row.intoText))));
}

function questNode(q) {
  const kicker = q.state === 'open' ? 'Weekly quest' : 'Weekly quest done';
  const nums = el('div', { class: 'gv-rw-quest-nums' },
    el('span', { class: 'gv-rw-quest-done' }, el('b', {}, q.doneText), ` ${q.unit} · ${q.pct}%`),
    el('span', { class: 'gv-rw-quest-togo' }, q.toGoText));
  return el('section', { class: `gv-rw-quest is-${q.state}`, 'aria-label': q.aria },
    el('div', { class: 'gv-rw-quest-top' },
      el('div', { class: 'gv-rw-quest-head' },
        el('span', { class: 'gv-kicker gv-rw-quest-kicker' }, kicker),
        el('b', { class: 'gv-rw-quest-title' }, q.title)),
      q.xpText ? el('span', { class: 'gv-rw-quest-xp' }, q.xpText) : ''),
    barNode({ cls: 'is-thin', fill: q.pct, now: q.pct, text: `${q.doneText} ${q.unit}`, label: 'Weekly quest progress' }),
    nums);
}

function chipNode(chip) {
  return el('span', { class: 'gv-rw-xpchip', title: chip.title, 'aria-label': chip.title }, chip.label);
}

/* Fill Today's slots. Slots are the empty nodes page-dashboard rendered; the fill happens now when
   the ledger is already read (no flicker) and when the read lands otherwise. */
function mountToday(ctx, o) {
  safe('today', () => {
    if (!F.enabled(ctx)) return;
    const c = F.readLedger(ctx);
    const paint = () => {
      if (c.failed || isGone(o.level)) return;
      safe('today paint', () => {
        const summary = F.summaryFor(ctx, c.value);
        const row = V.levelRow(summary.level);
        if (o.level && row) o.level.append(levelNode(row));
        const quest = V.questCard(F.questFor(ctx, c.value));
        if (o.quest && quest) o.quest.append(questNode(quest));
        const chip = o.day ? V.xpChipFor(o.day, ctx.settings) : null;
        if (o.chip && chip) {
          o.chip.append(chipNode(chip));
          /* The chips column is one row taller: a skin that stacks its chips makes room (see .has-xp). */
          if (o.stage && o.stage.classList) o.stage.classList.add('has-xp');
        }
      });
    };
    if (c.done) paint(); else c.promise.then(paint);
  });
}

/* ---- Session complete ---- */

function unlockNode(m) {
  return el('section', { class: `gv-rw-unlock is-${m.tier}`, 'aria-label': `Medal unlocked: ${m.name}, ${m.tier}` },
    hexNode({ tier: m.tier, size: 'sm', icon: m.icon }),
    el('div', { class: 'gv-rw-unlock-text' },
      el('span', { class: 'gv-rw-unlock-kicker' }, `${m.tierLabel} medal unlocked`),
      el('strong', { class: 'gv-rw-unlock-name' }, m.name),
      el('p', { class: 'gv-rw-unlock-next' }, m.nextText)));
}

function xpCardNode(card) {
  const a = card.after;
  const header = el('div', { class: 'gv-rw-xp-head' },
    el('b', { class: 'gv-rw-xp-big' }, card.gainedText, el('small', {}, 'XP')),
    el('div', { class: 'gv-rw-xp-lv' }, el('span', {}, a.title), el('b', {}, `${a.pct}%`)));
  const bar = barNode({
    cls: 'is-big', fill: card.baseFill, gain: card.gainFill, now: a.pct,
    text: `${a.title}, ${a.pct} percent, ${card.toNextText}`, label: 'Level progress',
  });
  const nums = el('div', { class: 'gv-rw-xp-nums' },
    el('span', { class: 'gv-rw-xp-into' }, el('b', {}, V.groupDigits(a.xpInto)), ` / ${V.groupDigits(a.xpForNext)} XP`),
    el('span', { class: 'gv-rw-xp-togo' }, card.toNextText));
  const lines = el('ul', { class: 'gv-rw-xp-lines', 'aria-label': 'Where the XP came from' },
    ...card.lines.map(l => el('li', { class: `gv-rw-xp-line is-${l.key}` },
      el('span', { class: 'gv-rw-xp-label' }, l.label, l.detail ? el('small', {}, ` · ${l.detail}`) : ''),
      el('b', { class: 'gv-rw-xp-amount' }, l.text))));
  const kids = [header, bar, nums];
  if (card.leveledUp) {
    kids.push(el('p', { class: 'gv-rw-levelup' }, card.levelUpText, card.rankUp ? el('small', {}, ` ${a.rank}`) : ''));
  }
  kids.push(lines);
  return el('section', { class: 'gv-rw-xp', 'aria-label': 'Experience gained' }, ...kids);
}

/* The slot Session complete reserves: always present while rewards are on, so the polite live
   region exists BEFORE its text does (a region filled on creation is not announced). */
function completeSlot(ctx) {
  if (!F.enabled(ctx)) return null;
  return el('div', { class: 'gv-rw-complete' },
    el('div', { class: 'gv-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }));
}

function mountComplete(ctx, slot, o) {
  safe('complete', () => {
    if (!slot || !F.enabled(ctx)) return;
    const p = F.preview(ctx, o.draft, o.sess, o.rows || []);
    if (!p) return;
    const paint = () => {
      if (p.failed || !p.value || isGone(slot)) return;
      safe('complete paint', () => {
        const card = V.xpCard(p.value);
        if (!card) return;
        slot.append(xpCardNode(card));
        for (const m of card.medals) slot.append(unlockNode(m));
        if (card.announce && !o.sess.rewardsAnnounced) {
          o.sess.rewardsAnnounced = true;
          const live = slot.firstChild;
          if (live) live.textContent = card.announce;
        }
      });
    };
    if (p.done) paint(); else p.promise.then(paint);
  });
}

/* ---- Records ---- */

function medalTileNode(t) {
  const kids = [
    hexNode({ tier: t.state === 'earned' ? t.tier : 'lock', size: 'sm', icon: t.state === 'earned' ? t.icon : 'lock' }),
    el('strong', { class: 'gv-rw-medal-name' }, t.name),
  ];
  if (t.state === 'earned') {
    kids.push(el('span', { class: 'gv-rw-tier' }, t.tierLabel));
    if (t.earnedText) kids.push(el('span', { class: 'gv-rw-earned' }, t.earnedText));
    if (!t.complete) kids.push(barNode({ cls: 'is-thin', fill: t.pct, now: t.pct, text: `${t.pct} percent to the next tier`, label: `${t.name} progress` }), el('span', { class: 'gv-rw-pc' }, t.pctText));
  } else {
    kids.push(barNode({ cls: 'is-thin', fill: t.pct, now: t.pct, text: `${t.pct} percent`, label: `${t.name} progress` }), el('span', { class: 'gv-rw-pc' }, t.pctText));
  }
  return el('li', { class: `gv-rw-medal is-${t.state === 'earned' ? t.tier : 'lock'}`, 'aria-label': t.aria }, ...kids);
}

function medalsNode(sec) {
  const kids = [el('div', { class: 'gv-rw-sec' },
    el('h3', { class: 'gv-section-title gv-rw-sec-title' }, ico('medal'), el('span', {}, 'Medals')),
    el('span', { class: 'gv-rw-sec-count' }, sec.countText))];
  if (sec.next) {
    kids.push(el('div', { class: 'gv-rw-next' },
      hexNode({ tier: 'lock', size: 'sm', icon: sec.next.tile.icon }),
      el('div', { class: 'gv-rw-next-text' },
        el('b', {}, sec.next.text),
        el('span', {}, sec.next.detail)),
      el('span', { class: 'gv-rw-pc gv-rw-next-pc' }, sec.next.pctText)));
  }
  kids.push(el('ul', { class: 'gv-rw-medal-grid' }, ...sec.tiles.map(medalTileNode)));
  return el('section', { class: 'gv-rw-medals', 'aria-label': 'Medals' }, ...kids);
}

/* Returns the node (or null). Medals are derived from history: no ledger is read. */
function mountRecords(ctx, root) {
  return safe('records', () => {
    if (!F.enabled(ctx) || !ctx.data) return null;
    const sec = V.medalsSection(F.medalsFor(ctx));
    if (!sec.total) return null;
    const node = medalsNode(sec);
    root.append(node);
    return node;
  }) || null;
}

/* ---- Profile ---- */

function ladderNode(steps) {
  return el('ol', { class: 'gv-rw-ladder', 'aria-label': 'Rank ladder' },
    ...steps.map(s => el('li', Object.assign({ class: `gv-rw-rung is-${s.state}` }, s.state === 'current' ? { 'aria-current': 'step' } : {}),
      el('i', {}), el('span', {}, s.name))));
}

function profileNode(m) {
  const h = m.hero;
  return el('article', { class: 'gv-card gv-rw-profile', 'aria-label': h.aria },
    el('div', { class: 'gv-rw-profile-top' },
      hexNode({ tier: 'lime', size: 'lg', text: h.level }),
      el('div', { class: 'gv-rw-profile-id' },
        el('h3', { class: 'gv-rw-profile-level' }, h.title),
        el('p', { class: 'gv-rw-profile-rank' }, `Rank · ${h.rank}`))),
    barNode({ fill: h.fill, now: h.pct, text: h.aria, label: 'Level progress' }),
    el('div', { class: 'gv-rw-profile-nums' },
      el('span', {}, el('b', {}, V.groupDigits(h.xpInto)), ` / ${V.groupDigits(h.xpForNext)} XP · ${h.pct}%`),
      el('span', { class: 'gv-rw-profile-togo' }, `${V.groupDigits(h.toNext)} to go`)),
    ladderNode(m.ladder),
    el('p', { class: 'gv-rw-profile-total' }, `${m.totalText} in total`),
    el('div', { class: 'gv-rw-stats' },
      el('div', {}, el('b', {}, V.groupDigits(m.counts.sessions)), el('span', {}, 'sessions')),
      el('div', {}, el('b', {}, V.groupDigits(m.counts.pbs)), el('span', {}, 'PBs')),
      el('div', { 'aria-label': `${m.counts.medalsText} medals` }, el('b', {}, V.groupDigits(m.counts.medals), el('small', {}, ` of ${m.counts.medalsTotal}`)), el('span', {}, 'medals'))));
}

/* The slot is created now (so the card keeps its place on the page) and filled when the ledger lands. */
function mountProfile(ctx, root) {
  return safe('profile', () => {
    if (!F.enabled(ctx) || !ctx.data) return null;
    const slot = el('div', { class: 'gv-rw-profile-slot' });
    root.append(slot);
    const c = F.readLedger(ctx);
    const paint = () => {
      if (c.failed || isGone(slot)) return;
      safe('profile paint', () => {
        const summary = F.summaryFor(ctx, c.value);
        const model = V.profileModel({ summary, medals: F.medalsFor(ctx), sessionCount: F.sessionCount(ctx.data.workouts) });
        if (model.hero) slot.append(profileNode(model));
      });
    };
    if (c.done) paint(); else c.promise.then(paint);
    return slot;
  }) || null;
}

module.exports = { hexNode, barNode, mountToday, completeSlot, mountComplete, mountRecords, mountProfile, levelNode, questNode, xpCardNode, medalsNode, profileNode };
