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
  log: require('./page-log'),
  exercise: require('./page-exercise-detail'),
};

const NAV = [
  { id: 'dashboard', label: 'Today', icon: 'flame' },
  { id: 'exercises', label: 'Exercises', icon: 'dumbbell' },
  { id: 'plans', label: 'Plans', icon: 'clipboard-list' },
  { id: 'goals', label: 'Goals', icon: 'target' },
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

  ctx.activePlan = () => {
    if (!ctx.data) return null;
    return ctx.data.plans.find(p => String(p.fm.active) === 'true') || ctx.data.plans[0] || null;
  };

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
    ctx.rerender();
  };

  function buildShell() {
    clear(rootEl);
    const head = el('div', { class: 'gv-head' },
      el('div', { class: 'gv-logo' }, ico('dumbbell'), el('span', { class: 'gv-logo-text' }, 'Gym Vault')));
    navEl = el('nav', { class: 'gv-nav', 'aria-label': 'Gym sections' });
    for (const item of NAV) {
      const b = el('button', { class: 'gv-nav-btn', type: 'button', 'data-page': item.id },
        ico(item.icon), el('span', {}, item.label));
      b.addEventListener('click', () => {
        /* Leaving mid-log keeps the draft: coming back to Today offers the
           log page again via the nav highlight, and Finish/Discard are the
           only ways to end it. Navigation itself must never eat a session. */
        ctx.nav(item.id);
      });
      navEl.append(b);
    }
    pageEl = el('main', { class: 'gv-page' });
    rootEl.append(head, navEl, pageEl);
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
  const onVaultEvent = f => {
    if (!f || !f.path) return;
    const root = normalizePath(plugin.settings.gymFolder || 'Gym') + '/';
    if (!f.path.startsWith(root) && f.path !== normalizePath(plugin.settings.gymFolder || 'Gym')) return;
    if (Date.now() - (plugin._lastWrite || 0) < 1500) return;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => { debounceTimer = null; ctx.reload(); }, 400);
  };

  return {
    ctx,
    async start() {
      buildShell();
      for (const evt of ['modify', 'create', 'delete', 'rename']) {
        view.registerEvent(app.vault.on(evt, onVaultEvent));
      }
      await ctx.reload();
    },
    stop() {
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
