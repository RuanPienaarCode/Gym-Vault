'use strict';
/* App controller — owns the loaded data, the current page, navigation, and
   the vault watcher. One controller per open view. */

const { Notice, normalizePath } = require('obsidian');
const { el, ico, clear } = require('./dom');
const { makeIo } = require('./data');
const pages = {
  dashboard: require('./page-dashboard'),
  exercises: require('./page-exercises'),
  plans: require('./page-plans'),
  goals: require('./page-goals'),
  history: require('./page-history'),
  profile: require('./page-profile'),
  running: require('./page-running'),
  log: require('./page-log'),
  exercise: require('./page-exercise-detail'),
};

const NAV = [
  { id: 'dashboard', label: 'Today', icon: 'flame' },
  { id: 'exercises', label: 'Exercises', icon: 'dumbbell' },
  { id: 'plans', label: 'Plans', icon: 'clipboard-list' },
  { id: 'goals', label: 'Goals', icon: 'target' },
  { id: 'running', label: 'Running', icon: 'footprints', when: ctx => ctx.hasRunning() },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];

function mountApp(view) {
  const plugin = view.plugin;
  const app = plugin.app;
  const io = makeIo(plugin);

  const ctx = {
    app, plugin, io, view,
    settings: plugin.settings,
    data: null,
    state: { page: 'dashboard', params: {}, logDraft: null },
    _interval: null,
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

  let navEl = null, pageEl = null;

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
  ctx.parallelPlans = () => (ctx.data ? ctx.data.plans.filter(isParallel) : []);
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
    return out;
  };
  /* The Running tab appears only once the vault actually holds running. */
  ctx.hasRunning = () => !!ctx.data && ctx.data.exercises.some(e => (e.fm.unit || '') === 'km');

  ctx.openFile = file => { app.workspace.getLeaf('tab').openFile(file); };

  ctx.nav = (page, params) => {
    ctx.state.page = page;
    ctx.state.params = params || {};
    ctx.rerender();
  };

  ctx.startLog = (plan, day) => {
    pages.log.startDraft(ctx, plan, day);
    ctx.nav('log');
  };

  /* A page may register one interval (the log clock); it's cleared on every
     rerender and on unmount so a closed pane never keeps a timer alive. */
  ctx.setPageInterval = (fn, ms) => {
    if (ctx._interval) window.clearInterval(ctx._interval);
    ctx._interval = window.setInterval(fn, ms);
  };

  ctx.rerender = () => {
    if (ctx._interval) { window.clearInterval(ctx._interval); ctx._interval = null; }
    if (!pageEl) return;
    clear(pageEl);
    renderNavState();
    if (!ctx.data) return;
    if (!ctx.data.present) { renderSetup(ctx, pageEl); return; }
    const page = pages[ctx.state.page] || pages.dashboard;
    try { page.render(ctx, pageEl); }
    catch (e) {
      console.error('gym-vault render', e);
      pageEl.append(el('div', { class: 'gv-empty-line' }, `Something went wrong rendering this page (${e.message}).`));
    }
    pageEl.scrollTop = 0;
  };

  ctx.reload = async () => {
    ctx.data = await io.loadAll();
    ctx.settings = plugin.settings;
    syncChrome();
    buildNav();          // the Running tab appears once running exists
    ctx.rerender();
  };

  /* Rebuilt on every reload: conditional tabs (Running) appear as soon as
     the data that justifies them exists. */
  function buildNav() {
    if (!navEl) return;
    clear(navEl);
    for (const item of NAV) {
      if (item.when && !item.when(ctx)) continue;
      const b = el('button', { class: 'gv-nav-btn', type: 'button', 'data-page': item.id },
        ico(item.icon), el('span', { class: 'gv-nav-label' }, item.label));
      b.addEventListener('click', () => {
        /* Leaving mid-log keeps the draft: coming back to Today offers the
           log page again via the nav highlight, and Finish/Discard are the
           only ways to end it. Navigation itself must never eat a session. */
        ctx.nav(item.id);
      });
      navEl.append(b);
    }
    renderNavState();
  }

  function buildShell() {
    clear(rootEl);
    const head = el('div', { class: 'gv-head' },
      el('div', { class: 'gv-logo' }, ico('dumbbell'), el('span', { class: 'gv-logo-text' }, 'Gym Vault')));
    navEl = el('nav', { class: 'gv-nav', 'aria-label': 'Gym sections' });
    pageEl = el('main', { class: 'gv-page' });
    rootEl.append(head, navEl, pageEl);
    buildNav();
  }

  function renderNavState() {
    if (!navEl) return;
    const current = ctx.state.page === 'log' ? 'dashboard'
      : ctx.state.page === 'exercise' ? 'exercises'
      : ctx.state.page;
    for (const b of navEl.querySelectorAll('.gv-nav-btn')) {
      b.classList.toggle('on', b.getAttribute('data-page') === current);
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
      await ctx.reload();
    },
    stop() {
      if (resizeObs) resizeObs.disconnect();
      if (ctx._interval) window.clearInterval(ctx._interval);
      if (debounceTimer) window.clearTimeout(debounceTimer);
    },
    hasDraft: () => !!ctx.state.logDraft,
    reload: () => ctx.reload(),
  };
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

module.exports = { mountApp };
