'use strict';
/* App controller — owns the loaded data, the current page, navigation, and
   the vault watcher. One controller per open view. */

const { Notice, normalizePath } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { makeIo } = require('./data');
const voiceClips = require('./voice-clips');
const sound = require('./sound');
const pages = {
  dashboard: require('./page-dashboard'),
  exercises: require('./page-exercises'),
  plans: require('./page-plans'),
  goals: require('./page-goals'),
  history: require('./page-history'),
  profile: require('./page-profile'),
  running: require('./page-running'),
  export: require('./page-export'),
  browse: require('./page-browse'),
  log: require('./page-log'),
  exercise: require('./page-exercise-detail'),
  records: require('./page-records'),
  'run-records': require('./page-run-records'),
  voice: require('./page-voice'),
  setup: require('./page-session-setup'),
  session: require('./page-session'),
};

const NAV = [
  { id: 'dashboard', label: 'Today', icon: 'flame' },
  { id: 'exercises', label: 'Exercises', icon: 'dumbbell' },
  { id: 'plans', label: 'Plans', icon: 'clipboard-list' },
  { id: 'goals', label: 'Goals', icon: 'target' },
  /* Running is ALWAYS here, even with no running data. It used to appear
     only once a km-unit exercise existed, which meant the bar silently grew
     from five tabs to six the first time a run was logged — a layout that
     changes underneath you is worse than a tab you have not used yet, and
     the page carries its own empty state either way. */
  { id: 'running', label: 'Running', icon: 'footprints' },
  { id: 'history', label: 'History', icon: 'history' },
  /* place:'head' — utility destinations live top-right beside the logo, not
     in the main nav. Keeps the nav to six primary tabs, which is what makes
     it fit a phone without scrolling. */
  { id: 'profile', label: 'Profile', icon: 'user', place: 'head' },
  { id: 'export', label: 'Export', icon: 'share-2', place: 'head' },
];

function mountApp(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  const io = makeIo(plugin);

  const ctx = {
    app, plugin, io, view,
    settings: plugin.settings,
    data: null,
    /* session: guided-mode UI state ONLY (position, phase, timers) — the
       draft itself stays on logDraft, per ONE DRAFT, TWO VIEWS. pageCleanup
       is a one-shot teardown any page can register (wake lock, confetti rAF)
       that ctx.nav runs the moment the page actually changes. */
    /* setup/setupUi: the pending {plan, day} and the choices being made on
       the setup screen — deliberately NOT a draft. Nothing exists until
       Start, so backing out of setup leaves the vault untouched. */
    state: { page: 'dashboard', params: {}, logDraft: null, session: null, setup: null, setupUi: null, pageCleanup: null },
    _interval: null,
    /* Set by ctx.nav() only (never by a plain ctx.rerender() from local UI
       state — ticking a set, toggling a switch — which must NOT steal focus
       mid-interaction). Consumed once by the focus-move at the bottom of
       ctx.rerender(). */
    _focusPageOnRender: false,
  };

  const rootEl = view.contentEl;
  rootEl.addClass('gv-app');

  /* Skin + accent are classes on the app root; re-synced on every reload so
     a settings change lands without reopening the view. */
  const syncChrome = () => {
    for (const cls of [...rootEl.classList]) {
      if (cls.indexOf('gv-skin-') === 0 || cls.indexOf('gv-accent-') === 0) rootEl.classList.remove(cls);
    }
    rootEl.classList.add(`gv-skin-${plugin.settings.skin || 'floor'}`, `gv-accent-${plugin.settings.accent || 'lime'}`);
  };
  syncChrome();

  let navEl = null, pageEl = null, headActionsEl = null;

  ctx.notice = msg => new Notice(`Gym: ${msg}`, 5000);

  /* A plan marked `parallel` is not an ALTERNATIVE to the active plan — it
     runs alongside it (running beside strength), so the dashboard merges
     days from the active plan and every parallel one. */
  const isParallel = p => String(p.fm.parallel) === 'true';
  ctx.activePlan = () => {
    if (!ctx.data) return null;
    const main = ctx.data.plans.filter(p => !isParallel(p));
    return main.find(p => String(p.fm.active) === 'true') || main[0] || null;
  };
  const isFallback = p => String(p.fm.fallback) === 'true';
  ctx.parallelPlans = () => (ctx.data ? ctx.data.plans.filter(p => isParallel(p) && !isFallback(p)) : []);
  ctx.fallbackPlans = () => (ctx.data ? ctx.data.plans.filter(isFallback) : []);
  /* Every non-parallel plan, for the switcher. */
  ctx.mainPlans = () => (ctx.data ? ctx.data.plans.filter(p => !isParallel(p) && !isFallback(p)) : []);
  const isRunExercise = name => !!ctx.data && ctx.data.exercises.some(e =>
    e.name.toLowerCase() === (name || '').toLowerCase() && (e.fm.unit || '') === 'km');
  ctx.runPlan = () =>
    ctx.parallelPlans().find(p => p.model.days.some(d => d.items.some(i => isRunExercise(i.exercise))))
    || ctx.parallelPlans()[0] || null;
  /* Every {plan, day} scheduled on a weekday, active plan first. */
  ctx.daysOn = weekday => {
    const out = [];
    const main = ctx.activePlan();
    if (main) for (const d of main.model.days) if (d.weekday === weekday) out.push({ plan: main, day: d });
    for (const p of ctx.parallelPlans()) for (const d of p.model.days) if (d.weekday === weekday) out.push({ plan: p, day: d });
    /* Nothing training-related today? A fallback plan (rest & recovery)
       fills the gap — an exact weekday match first, then its `any` day. */
    if (!out.length) {
      for (const p of ctx.fallbackPlans()) {
        const day = p.model.days.find(d => d.weekday === weekday) || p.model.days.find(d => d.weekday === 'any');
        if (day) { out.push({ plan: p, day }); break; }
      }
    }
    return out;
  };
  ctx.openFile = file => { app.workspace.getLeaf('tab').openFile(file); };

  ctx.nav = (page, params) => {
    /* Leaving a page that registered cleanup (guided mode's wake lock and
       any in-flight confetti burst) tears it down exactly once — even when
       the user bails via the persistent nav bar rather than guided mode's
       own exit button. A re-nav to the SAME page (e.g. a refresh) must not
       trigger it. */
    if (ctx.state.pageCleanup && page !== ctx.state.page) {
      try { ctx.state.pageCleanup(); } catch (e) { console.error('gym-vault page cleanup', e); }
      ctx.state.pageCleanup = null;
    }
    ctx.state.page = page;
    ctx.state.params = params || {};
    /* A route change is exactly what SHOULD move focus — plain rerenders
       from local UI state (a tick, a toggle) must not. */
    ctx._focusPageOnRender = true;
    ctx.rerender();
  };

  ctx.startLog = (plan, day) => {
    pages.log.startDraft(ctx, plan, day);
    ctx.nav('log');
  };

  /* Enter guided mode over whatever draft already exists in
     ctx.state.logDraft — page-session.js routes to the dashboard if there
     isn't one. session=null forces a fresh initialPosition() so re-entering
     always resumes at the first actually-incomplete set, honouring anything
     ticked on the overview since guided mode was last open. */
  ctx.enterGuided = () => {
    /* THE GESTURE, AT THE SEAM. iOS permits speechSynthesis and AudioContext
       only for a page that has used them from inside a real user-gesture call
       stack, and guided mode is where this app first makes a noise on a TIMER
       — the interval announcement and the spoken "3, 2, 1".

       beginSession unlocks in the Start tap, so the setup route was fine. The
       log overview's Guided button called this directly and unlocked nothing,
       so Dashboard -> Log manually -> Guided — a first-run path — ran the
       whole session silent on a phone, with no error and nothing to explain
       it. Putting it HERE covers every route into guided mode, including the
       next one somebody adds.

       Every caller reaches this synchronously from a click, which is the
       whole requirement; unlock() is idempotent and never throws, so calling
       it again after beginSession's costs nothing. */
    sound.unlock();
    ctx.state.session = null;
    ctx.nav('session');
  };
  /* Starting a session goes through the setup screen (page-session-setup.js):
     it asks how you want to be guided and for how long, then builds the draft
     itself. It deliberately does NOT create a draft here — half the point of
     that screen is that backing out of it costs nothing.

     NAMES, not object references. The user can sit on the setup screen for a
     minute, and any vault change in that window (an iCloud sync landing, an
     edit in another pane) fires ctx.reload(), which replaces ctx.data
     wholesale — a held reference would then be a snapshot of a plan that no
     longer exists, and the session would be built from it. The index is kept
     only as a fallback for the pathological case of two days sharing a name. */
  ctx.startGuided = (plan, day) => {
    const dayIndex = plan && day ? plan.model.days.indexOf(day) : -1;
    ctx.state.setup = {
      plan: plan ? plan.name : null,
      day: day ? day.name : null,
      dayIndex,
    };
    ctx.state.setupUi = null;
    ctx.nav('setup');
  };

  /* A page may register one interval (the log clock); it's cleared on every
     rerender and on unmount so a closed pane never keeps a timer alive. */
  ctx.setPageInterval = (fn, ms) => {
    if (ctx._interval) window.clearInterval(ctx._interval);
    ctx._interval = window.setInterval(fn, ms);
  };

  /* Route change gets no signal a screen-reader user can pick up otherwise —
     the page under the persistent nav bar is swapped in place, so nothing
     announces "you're on a new screen now". Moving focus to the new page's
     own heading is the same pattern any SPA route change needs; tabindex=-1
     makes an otherwise non-interactive heading a valid focus target without
     adding it to the normal Tab order. */
  function focusPageHeading() {
    if (!ctx._focusPageOnRender) return;
    ctx._focusPageOnRender = false;
    if (!pageEl) return;
    const heading = pageEl.querySelector('h1, h2, h3, h4, h5, h6');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  ctx.rerender = () => {
    if (ctx._interval) { window.clearInterval(ctx._interval); ctx._interval = null; }
    if (!pageEl) return;
    clear(pageEl);
    /* Focus mode is OPT-IN PER RENDER: cleared here, re-added by the counting
       screens in page-session.js. A sticky class would hide the nav on a page
       that has no other way out of itself. */
    rootEl.classList.remove('gv-focus');
    renderNavState();
    /* NEVER render nothing. A blank page under the nav is indistinguishable
       from a broken plugin, and this is exactly what a mid-index vault used
       to produce: loadAll fails or finds nothing, and the screen goes empty
       with no way back. */
    if (!ctx.data || ctx.loadError) {
      renderNotReady(ctx, pageEl);
    } else if (!ctx.data.present) {
      /* The gym folder existing but reading empty means Obsidian has not
         finished indexing — offering "create my gym" there would be wrong
         and alarming. Only a genuinely absent folder is a fresh start. */
      if (ctx.data.rootExists || ctx.data.unreadable) {
        renderNotReady(ctx, pageEl);
      } else {
        renderSetup(ctx, pageEl);
      }
    } else {
      const page = pages[ctx.state.page] || pages.dashboard;
      try { page.render(ctx, pageEl); }
      catch (e) {
        console.error('gym-vault render', e);
        pageEl.append(el('div', { class: 'gv-empty-line' }, `Something went wrong rendering this page (${e.message}).`));
      }
    }
    pageEl.scrollTop = 0;
    focusPageHeading();
  };

  ctx.reload = async () => {
    ctx.settings = plugin.settings;
    try {
      ctx.data = await io.loadAll();
      ctx.loadError = null;
    } catch (e) {
      /* Keep whatever we already had rather than blanking the screen — a
         failed refresh should never cost you the page you were reading. */
      console.error('gym-vault load', e);
      ctx.loadError = e.message || String(e);
    }
    syncChrome();
    buildNav();
    ctx.rerender();
    /* The user's own clips, decoded into sound.js. Deliberately AFTER the
       render and never awaited: a session must not wait on forty decodes,
       and voice-clips.js skips the work entirely when nothing changed. */
    if (ctx.data && ctx.data.present) {
      voiceClips.loadClips(io).catch(e => console.error('gym-vault voice clips', e));
    }
  };

  /* Rebuilt on every reload. Every NAV entry is unconditional today — the
     `when` hook survives as the extension point for a tab that genuinely
     only makes sense sometimes. Running used to use it; see NAV for why it
     no longer does. */
  function buildNav() {
    if (!navEl) return;
    clear(navEl);
    if (headActionsEl) clear(headActionsEl);
    for (const item of NAV) {
      if (item.when && !item.when(ctx)) continue;
      const head = item.place === 'head';
      const b = el('button', {
        class: head ? 'gv-head-btn' : 'gv-nav-btn',
        type: 'button', 'data-page': item.id,
        'aria-label': head ? item.label : null,
      }, ico(item.icon), head ? '' : el('span', { class: 'gv-nav-label' }, item.label));
      b.addEventListener('click', () => {
        /* Leaving mid-log keeps the draft: coming back to Today offers the
           log page again via the nav highlight, and Finish/Discard are the
           only ways to end it. Navigation itself must never eat a session. */
        ctx.nav(item.id);
      });
      (head && headActionsEl ? headActionsEl : navEl).append(b);
    }
    if (headActionsEl) headActionsEl.append(settingsButton());
    renderNavState();
  }

  /* Settings sits beside Profile in the header, but is NOT a NAV entry: it
     opens Obsidian's own settings dialog rather than routing to a page, so it
     carries no data-page and renderNavState leaves it alone.

     `app.setting` is not in the published API typings, so every hop is
     guarded — on a build where it's missing the button explains where to go
     by hand instead of doing nothing, which is the failure mode a silent
     no-op would give. */
  function settingsButton() {
    const b = el('button', {
      class: 'gv-head-btn', type: 'button', 'aria-label': 'Gym Vault settings',
    }, ico('settings'));
    b.addEventListener('click', () => {
      const setting = app.setting;
      const id = plugin.manifest && plugin.manifest.id;
      if (setting && typeof setting.open === 'function' && typeof setting.openTabById === 'function' && id) {
        setting.open();
        setting.openTabById(id);
        return;
      }
      ctx.notice('open Settings → Community plugins → Gym Vault.');
    });
    return b;
  }

  function buildShell() {
    clear(rootEl);
    headActionsEl = el('div', { class: 'gv-head-actions' });
    const head = el('div', { class: 'gv-head' },
      el('div', { class: 'gv-logo' }, ico('dumbbell'), el('span', { class: 'gv-logo-text' }, 'Gym Vault')),
      headActionsEl);
    navEl = el('nav', { class: 'gv-nav', 'aria-label': 'Gym sections' });
    pageEl = el('main', { class: 'gv-page' });
    rootEl.append(head, navEl, pageEl);
    buildNav();
  }

  function renderNavState() {
    if (!navEl) return;
    const current = ctx.state.page === 'log' || ctx.state.page === 'session' || ctx.state.page === 'setup' ? 'dashboard'
      : ctx.state.page === 'exercise' ? 'exercises'
      : ctx.state.page === 'run-records' ? 'running'
      : ctx.state.page === 'voice' ? 'profile'
      : ctx.state.page === 'records' ? 'history'
      : ctx.state.page;
    const buttons = [
      ...navEl.querySelectorAll('.gv-nav-btn'),
      ...(headActionsEl ? headActionsEl.querySelectorAll('.gv-head-btn') : []),
    ];
    for (const b of buttons) {
      const active = b.getAttribute('data-page') === current;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }

  /* Vault watcher: reload when a gym file changes and the change wasn't one
     of our own writes (write-guard, same pattern as the budget plugin). */
  let debounceTimer = null;
  const onVaultEvent = (f, oldPath) => {
    if (!f || !f.path) return;
    const base = normalizePath(plugin.settings.gymFolder || 'Gym');
    const inGym = p => !!p && (p.startsWith(base + '/') || p === base);
    /* rename passes (file, oldPath) — a note dragged OUT of the gym folder
       only matches on its OLD path, and missing it leaves stale data. */
    if (!inGym(f.path) && !inGym(oldPath)) return;
    if (Date.now() - (plugin._lastWrite || 0) < 1500) return;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => { debounceTimer = null; ctx.reload(); }, 400);
  };

  /* Narrow-pane mode tracks the app root's OWN width (a 300px desktop
     split-pane must compact even when the window is wide — media queries
     can't see pane width). ResizeObserver is iOS 13.4+, under the floor. */
  let resizeObs = null;
  const watchWidth = () => {
    if (typeof ResizeObserver === 'undefined') return;
    resizeObs = new ResizeObserver(entries => {
      const w = entries[entries.length - 1].contentRect.width;
      rootEl.classList.toggle('gv-narrow', w > 0 && w <= 480);
    });
    resizeObs.observe(rootEl);
  };

  return {
    ctx,
    async start() {
      buildShell();
      watchWidth();
      for (const evt of ['modify', 'create', 'delete', 'rename']) {
        view.registerEvent(app.vault.on(evt, onVaultEvent));
      }
      /* Opening the gym while Obsidian is still indexing (a new device, a
         big iCloud sync) can read an empty or unreadable vault. `resolved`
         fires when the metadata cache finishes, so reload once more then —
         otherwise the view sits on whatever the half-indexed vault gave it
         until some unrelated file event happens to shake it loose. */
      if (app.metadataCache && app.metadataCache.on) {
        view.registerEvent(app.metadataCache.on('resolved', () => {
          if (!ctx.data || ctx.loadError || !ctx.data.present) ctx.reload();
        }));
      }
      await ctx.reload();
    },
    stop() {
      if (resizeObs) resizeObs.disconnect();
      if (ctx._interval) window.clearInterval(ctx._interval);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      /* View closing mid-guided-session: release the wake lock / stop any
         confetti burst the same way navigating away would. */
      if (ctx.state.pageCleanup) {
        try { ctx.state.pageCleanup(); } catch (e) { console.error('gym-vault page cleanup', e); }
        ctx.state.pageCleanup = null;
      }
    },
    hasDraft: () => !!ctx.state.logDraft,
    reload: () => ctx.reload(),
  };
}

/* Not a fresh vault and not a working one: Obsidian is still indexing, or a
   read failed. Says which, and offers the one useful action. */
function renderNotReady(ctx, root) {
  const why = ctx.loadError
    ? `Could not read the gym folder (${ctx.loadError}).`
    : ctx.data && ctx.data.unreadable
      /* Name the files. "3 files could not be read" gives the user nothing
         to act on; the paths tell them whether it's one bad note or a sync
         still landing. Cap the list so a mid-sync vault doesn't wall of text. */
      ? `${ctx.data.unreadable} file${ctx.data.unreadable === 1 ? '' : 's'} could not be read yet`
        + (ctx.data.unreadablePaths && ctx.data.unreadablePaths.length
          ? `: ${ctx.data.unreadablePaths.slice(0, 3).join(', ')}${ctx.data.unreadablePaths.length > 3 ? ', …' : ''}.`
          : '.')
      : 'Your gym folder is there, but Obsidian has not finished indexing it.';
  const card = el('div', { class: 'gv-setup' },
    el('div', { class: 'gv-setup-logo' }, ico('history')),
    el('h2', { class: 'gv-setup-title' }, 'Waiting for the vault'),
    el('p', { class: 'gv-setup-sub' }, `${why} This usually clears itself in a few seconds — nothing is lost.`),
    el('button', { class: 'gv-btn gv-btn-hero', type: 'button', onclick: () => ctx.reload() },
      ico('repeat-2'), el('span', {}, 'Try again')));
  root.append(card);
}

/* Empty vault — first-run setup card (silent adoption handles the existing-
   data case before this ever shows; see data.present). */
function renderSetup(ctx, root) {
  const card = el('div', { class: 'gv-setup' },
    el('div', { class: 'gv-setup-logo' }, ico('dumbbell')),
    el('h2', { class: 'gv-setup-title' }, 'Set up your gym'),
    el('p', { class: 'gv-setup-sub' },
      `This creates plain markdown files under "${ctx.settings.gymFolder}/" — a starter exercise library, `,
      'the Get Over The Bar plan, goals to chase, a profile and a body log. Everything stays in your vault.'),
    el('button', {
      class: 'gv-btn gv-btn-hero', type: 'button',
      onclick: async () => {
        try {
          await ctx.io.scaffold();
          ctx.plugin.settings.onboarded = true;
          await ctx.plugin.saveSettings();
          await ctx.reload();
          ctx.notice('Gym folder created. Let\'s train.');
        } catch (e) { ctx.notice(`setup failed (${e.message || e})`); }
      },
    }, ico('play'), el('span', {}, 'Create my gym')));
  root.append(card);
}

/* NAV is exported for the guard suite (tests/nav.test.cjs) and the preview
   harness, which both need the real tab list rather than a copy of it — a
   copied nav is a nav that silently stops matching the app. */
module.exports = { mountApp, NAV };
