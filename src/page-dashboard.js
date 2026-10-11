'use strict';
/* Dashboard — "what's to do today". Editorial masthead on paper; the ONE
   lime flood on this screen is the action slab, and it holds nothing but
   the session stats and the start button (design/06-editorial-floor.html). */

const { el, ico, fmt, fmtSeconds, clickableCard } = require('./dom');
const { WEEKDAYS, WEEKDAY_LABELS } = require('./constants');
const { todayISO, weekdayKey, fmtShort } = require('./dates');
const { workoutDates, workoutDate, weekStreak, sessionCount, sessionsInWeek, goalCurrent, goalProgress, sessionSets } = require('./stats');
const { streakFlame } = require('./streak-flame');
const { itemSets, isRestDay } = require('./plan-parse');
const { equipmentFor } = require('./equipment');
const { PlanPickerModal } = require('./modals');
const { pbInReach, reachText, weekPlan, weekProgress, streakRisk, streakRiskText } = require('./progress');

/* The kit today's session needs, as chips under the prescription. Nothing
   when it's all bodyweight — "No equipment" is worth saying on the setup
   screen you're about to act on, but it is clutter on a dashboard. */
function kitChips(ctx, day) {
  const kit = equipmentFor(ctx.data.exercises, ((day && day.items) || []).map(it => it.exercise));
  if (!kit.length) return null;
  return el('div', { class: 'gv-chips gv-today-kit' },
    el('span', { class: 'gv-kicker gv-today-kit-label' }, 'Bring'),
    ...kit.map(item => el('span', { class: 'gv-tag' }, item.label)));
}

/* ---- Today's hero pieces: one source for every number and word ----------

   estMinutes is the ONE minutes rule. It fed the "9 sets · est. 15 min" line
   alone; the Apex / Lock In slab chips read it too, so the two cannot
   disagree. */
function estMinutes(setsTotal) {
  return Math.max(15, Math.round(setsTotal * 1.8 / 5) * 5);
}

/* The Start button's words, keyed by skin. Apex and Lock In wear the mockups'
   "Lock in" + an arrow on a day not yet done; every other skin keeps its own
   voice. A day already done is "Log another session" everywhere. */
const LOCK_IN_SKINS = ['apex', 'lockin'];
function startCopy(skin, doneToday) {
  if (doneToday) return { label: 'Log another session', arrow: false };
  return LOCK_IN_SKINS.indexOf(skin || 'apex') !== -1
    ? { label: 'Lock in', arrow: true }
    : { label: 'Get after it', arrow: false };
}

/* The title's two voices (Apex + Lock In: a giant first word, then the rest
   smaller and outlined: "PUSH" / "DAY."). Pure, and it declines (null) rather
   than guess: a name that is long, one word, all label ("A ·"), or whose first
   or longest following word cannot fit a phone at the giant size keeps its one
   ordinary title, which Floor and Editorial always use. A leading token with
   fewer than two letters or digits ("A", "·", "-", "1") belongs to the giant
   word, so "A · Push Priority" splits as "A · Push" + "Priority". n1 / n2 are
   the character counts the CSS sizes from (--gv-t1-n, --gv-t2-n): a longer
   word steps the type down instead of running off the screen. */
const SPLIT_MAX_NAME = 44;     // = HERO_LONG: past it the title steps down whole
const SPLIT_MAX_WORD = 14;     // widest giant / outlined word that still fits 320px
function splitTitle(name) {
  const text = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
  if (!text || text.length > SPLIT_MAX_NAME) return null;
  const words = text.split(' ');
  const alnum = w => w.replace(/[^\p{L}\p{N}]/gu, '').length;
  let i = 0;
  while (i < words.length && alnum(words[i]) < 2) i++;
  if (i >= words.length - 1) return null;            // all label, or one word: nothing to split
  const first = words.slice(0, i + 1).join(' ');
  const restWords = words.slice(i + 1);
  const rest = restWords.join(' ');
  if (!alnum(rest)) return null;
  const n1 = Array.from(first).length;
  const n2 = Math.max(...restWords.map(w => Array.from(w).length));
  if (n1 > SPLIT_MAX_WORD || n2 > SPLIT_MAX_WORD) return null;
  return { first, rest, n1, n2 };
}

/* The h2: the user's own day name, whole. Split or not, the heading's text is
   the name (a screen reader hears it once, in order). */
function titleNode(name) {
  const parts = splitTitle(name);
  const h = el('h2', { class: heroTitleClass(name) });
  if (!parts) { h.append(el('span', { class: 'gv-mark' }, name)); return h; }
  h.classList.add('is-split');
  h.setAttribute('style', `--gv-t1-n:${parts.n1};--gv-t2-n:${parts.n2}`);
  h.append(el('span', { class: 'gv-mark' },
    el('span', { class: 'gv-title-first' }, parts.first), ' ',
    el('span', { class: 'gv-title-rest' }, parts.rest)));
  return h;
}

/* "13 sets" / "~48 min" beside the title. Apex and Lock In show them as slab
   chips and hide the text line they replace; the other skins hide the chips.
   The empty span is the slot for "up to +N XP" (rewards): nothing draws until
   the rewards work gives it content. */
function heroChips(setsTotal) {
  return el('div', { class: 'gv-hero-chips' },
    el('div', { class: 'gv-hero-chip-row' },
      el('span', { class: 'gv-hero-chip' }, `${setsTotal} sets`),
      el('span', { class: 'gv-hero-chip gv-hero-chip-min' }, `~${estMinutes(setsTotal)} min`)),
    el('span', { class: 'gv-slot-xp-chip', 'data-gv-slot': 'xp-chip' }));
}

/* The streak as the hero's badge (a hexagon in Apex, a starburst in Lock In).
   Built only for a live streak, from the SAME number the flame is given; the
   flame tile lower down keeps the unlit "nothing yet" state and hides itself in
   those two skins when this is shown. */
function streakBadge(streak) {
  return el('div', { class: 'gv-hero-badge' },
    el('div', { class: 'gv-badge-fig' },
      el('div', { class: 'gv-badge-in' }, el('b', { class: 'gv-badge-num' }, String(streak)))),
    el('span', { class: 'gv-badge-label' }, 'wk streak'));
}

function render(ctx, root) {
  const { data, settings } = ctx;
  const today = todayISO();
  const dates = workoutDates(data.workouts);
  /* Everything Today draws sits in ONE wrapper. It carries no styling in Floor
     or Editorial (a plain block) and gives Apex and Lock In one column to order
     the sticky Start button inside. */
  const page = el('div', { class: 'gv-today' });
  const streak = weekStreak(dates, settings.weekStart, today);
  const wp = weekProgress({ workouts: data.workouts, goals: data.goals, daysOn: ctx.daysOn, today, weekStart: settings.weekStart });
  /* Empty, on purpose: slots the rewards work fills (level + XP bar row). */
  page.append(el('div', { class: 'gv-slot-level', 'data-gv-slot': 'level' }));
  const plan = ctx.activePlan();
  const todayKeyName = weekdayKey(today);
  /* Strength AND running: daysOn merges the active plan with every
     parallel one, so a run day shows up beside the lifting. */
  const todays = ctx.daysOn(todayKeyName);
  const doneToday = dates.includes(today);
  const last = data.workouts.length ? data.workouts[data.workouts.length - 1] : null;
  /* The day, via the one rule — a note whose date this app cannot read shows
     no date rather than the string it was typed as. */
  const lastDate = last ? workoutDate(last) : null;

  /* AN OPEN SESSION OUTRANKS TODAY'S PLAN. The nav bar stays visible during
     rest and on the completion screen, so leaving mid-session is one tap and
     easily accidental. The draft survives that in memory, but until now
     nothing on this screen said so and nothing offered it back — the next
     Start simply overwrote it. This slab is the way back in; the controller
     asks before anything replaces a live draft. */
  if (ctx.state.logDraft) {
    /* Deliberately built from the "Also today" card's own classes rather
       than a new pair of its own: this is the same object (card, label,
       name, one action button) and a second near-identical rule set is how
       two cards drift apart. */
    page.append(el('div', { class: 'gv-card gv-alsotoday' },
      el('div', { class: 'gv-alsotoday-main' },
        el('div', { class: 'gv-kicker' }, 'Session in progress'),
        el('div', { class: 'gv-alsotoday-name' }, ctx.describeDraft()),
        el('div', { class: 'gv-alsotoday-plan' }, 'Kept on this device — saved to your vault when you finish')),
      el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => ctx.resumeDraft() },
        ico('play'), el('span', {}, 'Resume'))));
  }

  /* Masthead + action slab. The HEAD is the poster: kicker, the "make it
     active" card, the title with its chips and badge, and the sub line. Apex
     and Lock In paint their flood on the head ONLY (design 07: the list, the
     Start slab and the week sit on the page's own colour); Floor and Editorial
     draw no box for it, so it is invisible there. */
  const hero = el('div', { class: 'gv-hero gv-hero-today' });
  const head = el('div', { class: 'gv-hero-head' });
  /* The plan name is the switcher — swapping programme is a thing you do
     from the day you are looking at, not by hunting through Plans. */
  const kicker = el('p', { class: 'gv-kicker' }, `${fmtShort(today)} · ${WEEKDAY_LABELS[todayKeyName]} · `);
  if (plan) {
    const swap = el('button', { class: 'gv-planswap', type: 'button', 'aria-label': `Active plan: ${plan.name}. Switch plan` },
      el('span', {}, plan.name), ico('repeat-2'));
    swap.addEventListener('click', () => new PlanPickerModal(ctx.app, {
      plans: ctx.mainPlans(),
      extras: [...ctx.parallelPlans(), ...ctx.fallbackPlans()],
      currentName: plan.name,
      onPick: async next => {
        await ctx.io.setActivePlan(ctx.mainPlans(), next);
        ctx.notice(`switched to ${next.name}.`);
        ctx.reload();
      },
    }).open());
    kicker.append(swap);
  }
  head.append(kicker);

  /* No plan carries the active flag, so activePlan() is quietly falling back
     to the first main plan. Every downloaded plan arrives `active: false`, so
     deleting the seeded plan lands the user here — Today driving a programme
     the Plans list does not badge, with nothing on screen admitting the
     choice was made for them. Say it, and make fixing it one tap. */
  if (plan && ctx.activePlanIsImplicit()) {
    const claim = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' },
      ico('circle-check'), el('span', {}, 'Make it active'));
    claim.addEventListener('click', async () => {
      await ctx.io.setActivePlan(ctx.mainPlans(), plan);
      ctx.notice(`${plan.name} is now your active plan.`);
      ctx.reload();
    });
    head.append(el('div', { class: 'gv-card gv-alsotoday' },
      el('div', { class: 'gv-alsotoday-main' },
        el('div', { class: 'gv-kicker' }, 'No active plan'),
        el('div', { class: 'gv-alsotoday-plan' }, `Today is using ${plan.name}.`)),
      claim));
  }

  /* The title, its chips and the streak badge share one positioned stage, so
     the chips and the badge sit beside the title's second line. */
  const stage = el('div', { class: `gv-hero-stage${streak > 0 ? ' has-badge' : ''}` });
  const addTitle = name => { const t = titleNode(name); if (t.classList.contains('is-split')) stage.classList.add('is-split'); stage.append(t); };
  const badge = streak > 0 ? streakBadge(streak) : null;
  const sub = el('p', { class: 'gv-hero-sub' });

  const restToday = todays.length && isRestDay(todays[0].day);
  /* A rest hero says so, so a skin that floods the hero on training days
     (Lock In) can keep it quiet on a day whose whole point is nothing to
     attack. BOTH kinds: a rest day written into the plan, and a day with
     nothing scheduled. tests/hero-rest-class.test.cjs. */
  if (restToday || !todays.length) hero.classList.add('gv-hero-rest');
  let afterHead = [];
  if (restToday) {
    const { plan: dayPlan, day } = todays[0];
    addTitle(day.name);
    const prose = (day.notes || []).join(' ').trim();
    sub.append(prose || 'Rest is where the adaptation happens.');
    if (day.items.length) {
      const list = el('ul', { class: 'gv-rx gv-rx-rest' });
      for (const it of day.items) {
        list.append(el('li', {},
          el('span', {}, it.exercise),
          el('b', {}, it.sets != null ? `${it.sets} × ${it.target}` : it.target || '')));
      }
      afterHead.push(list);
    }
    /* No lime flood and no "Get after it" — the whole point of the day is
       that there is nothing to attack. Logging it stays possible. */
    afterHead.push(el('button', {
      class: 'gv-btn-hero-ghost', type: 'button',
      onclick: () => ctx.startLog(dayPlan, day),
    }, ico('circle-check'), el('span', {}, 'Log recovery')));
  } else if (todays.length) {
    const { plan: dayPlan, day } = todays[0];
    const setsTotal = day.items.reduce((n, it) => n + itemSets(it), 0);
    addTitle(day.name);
    stage.append(heroChips(setsTotal));
    stage.classList.add('has-chips');
    const prose = (day.notes || []).join(' ').trim();
    sub.append(doneToday ? 'Logged for today — nice work.' : prose || `${day.items.length} exercises on the plan.`);

    afterHead.push(ticker());

    /* ONE exercise carries the PB-in-reach line (progress.pbInReach owns which,
       and why: the first item whose session kind has a prior best). The line
       sits inside the name span, under the name, and the row gets a hook of its
       own so the skin can light the whole row. */
    const reach = pbInReach(day.items, data.workouts, data.exercises);
    const rx = el('ul', { class: 'gv-rx' });
    day.items.forEach((it, i) => {
      const hit = reach && reach.index === i ? reach : null;
      rx.append(el('li', { class: hit ? 'gv-rx-reach' : '' },
        el('span', {}, it.exercise, hit ? el('span', { class: 'gv-pb-reach' }, reachText(hit)) : ''),
        el('b', {}, it.sets != null ? `${it.sets} × ${it.target}` : it.target || '')));
    });
    afterHead.push(rx);
    const kit = kitChips(ctx, day);
    if (kit) afterHead.push(kit);

    const slab = el('div', { class: 'gv-hero-action' });
    const speed = el('div', { class: 'gv-speed', 'aria-hidden': 'true' },
      el('span', { style: 'top:16%;left:-12%;width:62%' }),
      el('span', { style: 'top:40%;left:28%;width:78%' }),
      el('span', { style: 'top:74%;left:-8%;width:50%' }));
    slab.append(speed);
    slab.append(el('div', { class: 'gv-hero-action-line' },
      el('span', { class: 'gv-shout gv-shout-est' }, `${setsTotal} sets · est. ${estMinutes(setsTotal)} min`),
      el('span', { class: 'gv-shout' },
        lastDate ? `Last: ${fmtShort(lastDate)} · ${sessionSets(last.rows)} sets` : 'First session — make it count')));
    const copy = startCopy(settings.skin, doneToday);
    slab.append(el('button', {
      class: 'gv-btn-go', type: 'button',
      onclick: () => ctx.startGuided(dayPlan, day),
    }, copy.label, copy.arrow ? ico('arrow-right', 'gv-go-arrow') : ''));
    afterHead.push(slab);
    /* Guided is the default path; manual entry (the old direct-to-overview
       behaviour) stays one tap away for anyone who'd rather type it in. */
    afterHead.push(el('button', {
      class: 'gv-btn-hero-ghost gv-hero-manual', type: 'button',
      onclick: () => ctx.startLog(dayPlan, day),
    }, el('span', {}, 'Log manually')));
  } else {
    addTitle('Rest day');
    const next = nextPlannedDay(ctx, todayKeyName);
    sub.append(next ? `Next up: ${next.day.name} on ${WEEKDAY_LABELS[next.weekday]}. Progress lives on rest days.`
           : plan ? 'No days scheduled in the active plan yet.'
                  : 'No active plan — pick one on the Plans page.');
    afterHead.push(el('button', {
      class: 'gv-btn-hero-ghost', type: 'button',
      onclick: () => ctx.startLog(plan, null),
    }, ico('plus'), el('span', {}, 'Log a freestyle session')));
  }
  if (badge) stage.append(badge);
  head.append(stage, sub);
  hero.append(head, ...afterHead);
  page.append(hero);

  /* Anything else scheduled today (a run beside the lifting) gets its own
     card rather than being hidden behind the hero's single session. */
  for (const extra of todays.slice(1)) {
    page.append(el('div', { class: 'gv-card gv-alsotoday' },
      el('div', { class: 'gv-alsotoday-main' },
        el('div', { class: 'gv-kicker' }, 'Also today'),
        el('div', { class: 'gv-alsotoday-name' }, extra.day.name),
        el('div', { class: 'gv-alsotoday-plan' }, extra.plan.name)),
      el('button', { class: 'gv-btn gv-btn-small', type: 'button', onclick: () => ctx.startGuided(extra.plan, extra.day) },
        ico('play'), el('span', {}, 'Start'))));
  }

  /* Week strip — typographic: big initial, plan-day tag beneath. The day
     each cell is planned for comes from progress.weekPlan, the same rule the
     week's target counts with, so the dots and the "x/4" cannot disagree. */
  const strip = el('div', { class: 'gv-week', role: 'group', 'aria-label': 'This week' });
  for (const { iso, wk, planDay } of weekPlan(ctx.daysOn, today, settings.weekStart)) {
    const done = dates.includes(iso);
    const cls = ['gv-day', done ? 'done' : planDay ? 'planned' : 'rest', iso === today ? 'today' : ''].join(' ');
    const tag = el('div', { class: 'gv-day-dot' });
    if (done) { if (planDay) tag.append(dayShort(planDay), ' '); tag.append(ico('check')); }
    else tag.append(planDay ? dayShort(planDay) : '—');
    strip.append(el('div', { class: cls },
      el('div', { class: 'gv-day-name' }, WEEKDAY_LABELS[wk][0]),
      tag));
  }
  /* The strip's header (Apex and Lock In only; the other skins hide it): the
     mockups' "THIS WEEK" over the cells, with the count the ring below states.
     `wp` is the same weekProgress the ring reads. */
  page.append(el('div', { class: 'gv-week-head' },
    el('span', { class: 'gv-week-head-title' }, 'This week'),
    el('span', { class: 'gv-week-head-note' }, wp ? `${wp.done} of ${wp.target} done` : '')));
  page.append(strip);
  /* Empty, on purpose: the slot for the weekly quest card (rewards). */
  page.append(el('div', { class: 'gv-slot-quest', 'data-gv-slot': 'quest' }));

  /* Stats — oversized numerals on the hairline grid. */
  /* SESSIONS, not training days. These tiles counted unique DATES while
     History and Export counted files, so logging a lift and then a run on
     the same day — "Log another session" is a button on this very screen —
     showed 1 here and 2 there. `dates` is still what the streak and the
     heatmap use, because a streak is genuinely a run of DAYS. */
  const thisWeek = sessionsInWeek(data.workouts, today, settings.weekStart);

  /* The streak comes OUT of the tile grid and becomes a drawing, because it
     is the one figure here whose size means something: a flame that is
     bigger and faster at eleven weeks than at two says the thing the digit
     alone cannot. Every other tile is a reading surface and stays flat —
     two loud treatments on one screen cancel each other out, which is the
     same rule as the one lime flood per screen. */
  /* "weeks in a row" spelled out, because the tile below it counts SESSIONS
     this week and in an ordinary week both figures are 1. Two 1s stacked
     with near-identical labels read as the same number printed twice; the
     labels have to do the work the digits cannot. */
  /* This week against its target, then the flame, then the nag: the ring
     answers "how far", the flame "how long", the nag "what is at stake". The
     nag reads the SAME `streak` the flame is given. */
  if (wp) page.append(weekProgressBlock(wp));
  const flame = streakFlame(streak, { label: streak === 1 ? 'week in a row' : 'weeks in a row' });
  /* A live streak is already the hero's badge in Apex and Lock In. */
  if (streak > 0) flame.classList.add('gv-streak-dup');
  page.append(flame);
  const risk = streakRisk(streak, wp, today, settings.weekStart);
  if (risk) page.append(el('p', { class: 'gv-streak-risk' }, streakRiskText(risk)));

  /* Three tiles in a two-column grid leaves a hole, and an empty cell reads
     as a figure that failed to load. The last-session tile spans instead. */
  const tiles = el('div', { class: 'gv-tiles' },
    tile(ico('calendar-days'), fmt(thisWeek), 'sessions this week'),
    tile(ico('dumbbell'), fmt(sessionCount(data.workouts)), 'sessions all time'),
    tile(ico('history'), lastDate ? fmtShort(lastDate) : '—', last ? `last · ${sessionSets(last.rows)} sets` : 'last session', 'gv-tile-wide'),
  );
  page.append(tiles);

  /* Goal snapshot. */
  if (data.goals.length) {
    page.append(el('div', { class: 'gv-section-title' }, ico('target'), el('span', {}, 'Goals in flight')));
    const ranked = data.goals
      .map(g => {
        const current = goalCurrent(g, { workouts: data.workouts, body: data.body, weekStart: settings.weekStart, today });
        return { g, current, p: goalProgress(g, current) };
      })
      .filter(x => x.p === null || x.p < 1)
      .sort((a, b) => (b.p ?? -1) - (a.p ?? -1))
      .slice(0, 4);
    const wrap = el('div', { class: 'gv-goal-mini-list' });
    for (const { g, current, p } of ranked) {
      const isDur = g.fm.metric === 'exercise-duration';
      const cur = isDur ? fmtSeconds(current) : fmt(current);
      const tgt = isDur ? fmtSeconds(g.fm.target) : fmt(g.fm.target);
      wrap.append(clickableCard(
        { class: 'gv-goal-mini', 'aria-label': `${g.name}: ${cur} of ${tgt} — open Goals` },
        () => ctx.nav('goals'),
        el('div', { class: 'gv-goal-mini-head' },
          el('span', { class: 'gv-goal-mini-name' }, g.name),
          el('span', { class: 'gv-goal-mini-nums' }, `${cur} / ${tgt}`)),
        el('div', { class: 'gv-bar' }, el('div', { class: 'gv-bar-fill', style: `width:${Math.round((p || 0) * 100)}%` }))));
    }
    if (!ranked.length) wrap.append(el('div', { class: 'gv-empty-line' }, 'All goals hit — set a new one!'));
    page.append(wrap);
    page.append(el('p', { class: 'gv-microcopy' }, 'No zero days.'));
  }
  root.append(page);
}

/* The ticker strip over the Rx list: short static words, decoration only (so
   hidden from assistive tech). Two passes of the same three words so a skin
   that scrolls it has a seamless loop; one that does not simply clips it. */
function ticker() {
  const words = ['Lock in', 'No days off', 'Earn it'];
  return el('div', { class: 'gv-ticker', 'aria-hidden': 'true' },
    el('div', {}, ...words.concat(words).map(w => el('span', {}, w))));
}

/* A day name is the USER'S text ("A · Pull Priority" ... or a whole sentence),
   and Apex sets the hero title at up to 92px: an unbroken 95-character name
   wrapped to ten lines and pushed Start 400px down the screen. CSS cannot count
   characters, so the length steps are classes: past HERO_LONG the title steps
   down once, past HERO_XLONG twice. A name up to HERO_LONG (a normal day name,
   and the mockup's) is untouched. Floor and Editorial ignore the classes. */
const HERO_LONG = 44;
const HERO_XLONG = 70;
function heroTitleClass(name) {
  const n = String(name || '').trim().length;
  return `gv-display gv-hero-title${n > HERO_XLONG ? ' is-xlong' : n > HERO_LONG ? ' is-long' : ''}`;
}

/* The weekly ring + "2/4" + "2 to go". The dash is measured against the real
   circumference (2 * pi * r), exactly as dom.ring() does - NOT the SVG
   `pathLength="100"` shortcut, which is unconfirmed for <circle> on iOS 15
   WebKit and would quietly draw a full or empty ring if it were ignored.
   dom.ring() is not reused: it prints a percentage inside and is shared with
   Goals, whose look must not move. This keeps ring()'s radius-28 geometry and
   its gv-ring classes, so Goals' ring styles still fit this one. `pct` is
   0..100 (progress.weekProgress). */
const WEEK_RING_R = 28;
function weekRing(pct, label) {
  const NS = 'http://www.w3.org/2000/svg';
  const c = 2 * Math.PI * WEEK_RING_R;
  const dash = c * Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'gv-ring gv-week-progress-ring');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const circle = (cls, fill) => {
    const ci = document.createElementNS(NS, 'circle');
    ci.setAttribute('cx', '32'); ci.setAttribute('cy', '32'); ci.setAttribute('r', String(WEEK_RING_R));
    ci.setAttribute('class', cls);
    if (fill) {
      ci.setAttribute('stroke-dasharray', `${dash} ${c}`);
      ci.setAttribute('transform', 'rotate(-90 32 32)');
    }
    svg.appendChild(ci);
  };
  circle('gv-ring-track', false);
  circle('gv-ring-fill', true);
  return svg;
}

function weekProgressBlock(wp) {
  return el('div', { class: 'gv-week-progress' },
    weekRing(wp.pct, `${wp.done} of ${wp.target} sessions this week`),
    el('div', { class: 'gv-week-progress-text' },
      el('span', { class: 'gv-week-progress-label' }, 'This week'),
      el('b', { class: 'gv-week-progress-num' }, `${wp.done}/${wp.target}`),
      el('span', { class: 'gv-week-progress-togo' }, wp.met ? 'Week done' : `${wp.toGo} to go`)));
}

/* "A · Pull Priority" → "A"; "Push + Volume" → "PUS". Short enough for a
   week cell, distinctive enough to tell the days apart. */
function dayShort(day) {
  const first = (day.name || '').trim().split(/[\s·|]+/)[0] || '';
  return first.slice(0, 3).toUpperCase();
}

function tile(icon, big, label, extraClass) {
  return el('div', { class: `gv-tile${extraClass ? ` ${extraClass}` : ''}` },
    el('div', { class: 'gv-tile-ico' }, icon),
    el('div', { class: 'gv-tile-big' }, big),
    el('div', { class: 'gv-tile-label' }, label));
}

/* Searches every plan (active + parallel), not just the strength one. */
function nextPlannedDay(ctx, todayKeyName) {
  const start = WEEKDAYS.indexOf(todayKeyName);
  for (let i = 1; i <= 7; i++) {
    const wk = WEEKDAYS[(start + i) % 7];
    const hit = ctx.daysOn(wk)[0];
    if (hit) return { weekday: wk, day: hit.day };
  }
  return null;
}

module.exports = { render, startCopy, splitTitle, estMinutes };
