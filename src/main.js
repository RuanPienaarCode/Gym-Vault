'use strict';
/* ============================================================================
   GYM VAULT — Obsidian plugin (entry point)
   Dashboard, exercises, plans, goals, history and profile for training kept
   as plain markdown in the vault. Vault API only — desktop and iOS/Android.

   Source lives in src/ as plain-JS CommonJS modules; esbuild bundles them
   into the single main.js Obsidian loads (target safari15 — the real engine
   floor on mobile, not minAppVersion).
   ============================================================================ */

const { Plugin, normalizePath } = require('obsidian');
const { VIEW_TYPE, DEFAULT_SETTINGS } = require('./constants');
const { GymView } = require('./view');
const { GymSettingTab } = require('./settings-tab');

class GymPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0; // shared write-guard timestamp (see data.js / controller.js)

    this.registerView(VIEW_TYPE, leaf => new GymView(leaf, this));
    this.addRibbonIcon('dumbbell', 'Open gym', () => this.activateView());
    this.addCommand({ id: 'open-gym', name: 'Open gym', callback: () => this.activateView() });
    this.addCommand({
      id: 'log-workout',
      name: "Log today's workout",
      callback: async () => {
        await this.activateView();
        this.forEachView(ctl => {
          const ctx = ctl.ctx;
          const plan = ctx.activePlan();
          const wk = require('./dates').weekdayKey(require('./dates').todayISO());
          const day = plan ? plan.model.days.find(d => d.weekday === wk) : null;
          ctx.startLog(plan, day || null);
        });
      },
    });
    this.addSettingTab(new GymSettingTab(this.app, this));

    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        if (!this.app.workspace.getLeavesOfType(VIEW_TYPE).length) this.activateView();
      });
    }

    /* Silent adoption: an existing gym folder on a fresh install (new device,
       restored sync) just works — no setup screen. Truly-empty installs see
       the in-view setup card instead when they first open the gym. */
    if (!this.settings.onboarded) {
      this.app.workspace.onLayoutReady(async () => {
        if (this.hasGymData()) {
          this.settings.onboarded = true;
          try { await this.saveSettings(); } catch (e) { console.error('gym-vault adopt', e); }
        }
      });
    }
  }

  hasGymData() {
    const root = normalizePath(this.settings.gymFolder || 'Gym');
    const v = this.app.vault;
    return !!v.getFileByPath(`${root}/Profile.md`) || !!v.getFolderByPath(`${root}/Exercises`);
  }

  forEachView(fn) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view && leaf.view.appCtl) fn(leaf.view.appCtl);
    }
  }

  refreshViews() { this.forEachView(ctl => ctl.reload()); }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() { await this.saveData(this.settings); }
}

module.exports = GymPlugin;
