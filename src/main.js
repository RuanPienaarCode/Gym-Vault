'use strict';
/* ============================================================================
   GYM VAULT — Obsidian plugin (entry point)
   Dashboard, exercises, plans, goals, history and profile for training kept
   as plain markdown in the vault. Vault API only — desktop and iOS/Android.

   Source lives in src/ as plain-JS CommonJS modules; esbuild bundles them
   into the single main.js Obsidian loads (target safari15 — the real engine
   floor on mobile, not minAppVersion).
   ============================================================================ */

const { Plugin, normalizePath, Notice } = require('obsidian');
const { VIEW_TYPE, DEFAULT_SETTINGS, accentFor } = require('./constants');
const { GymView } = require('./view');
const { GymSettingTab } = require('./settings-tab');
const { RepCounterModal } = require('./rep-counter-modal');
const { weekdayKey, todayISO } = require('./dates');
const { isChallenge } = require('./challenge');
const { openChallenge, openNewChallenge } = require('./challenge-flow');
const { applyLook, sharedForSave, makeLookStore, LOOK_FIELDS, applyFolder, makeFolderStore, cleanFolder } = require('./device-look');

class GymPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0; // shared write-guard timestamp (see data.js / controller.js)
    /* Per-path own-write record: data.js stamps every path it writes, the
       controller's vault watcher skips an event only for a path in here. */
    this._ownWrites = new Map();

    this.registerView(VIEW_TYPE, leaf => new GymView(leaf, this));
    this.addRibbonIcon('dumbbell', 'Open gym', () => this.activateView());
    this.addCommand({ id: 'open-gym', name: 'Open gym', callback: () => this.activateView() });
    this.addCommand({
      id: 'log-workout',
      name: "Log today's workout",
      callback: async () => {
        await this.activateView();
        this.forEachView(ctl => {
          /* No gym yet (or nothing loaded yet): the setup card is what the
             view shows, and a draft started behind it would turn up as a
             phantom "Session in progress" after "Create my gym". Opening the
             view is all the command does then. */
          if (!GymPlugin.canLogNow(ctl.ctx)) return;
          const { plan, day } = GymPlugin.logTargetFor(ctl.ctx);
          ctl.ctx.startLog(plan, day);
        });
      },
    });
    this.addCommand({
      id: 'open-rep-counter',
      name: 'Open rep counter',
      callback: () => {
        new RepCounterModal(this.app, {
          exerciseName: '',
          skin: this.settings.skin,
          accent: accentFor(this.settings),
          settings: this.settings,
          onDone: count => new Notice(`Gym: counted ${count} rep${count === 1 ? '' : 's'}.`, 5000),
        }).open();
      },
    });
    /* One challenge: straight into it. Several: the Goals page, where they
       are listed. None: the Goals page with the new-challenge picker open.
       Before the first load there is nothing to read, so just the Goals page. */
    this.addCommand({
      id: 'start-weekly-challenge',
      name: 'Start weekly challenge',
      callback: async () => {
        await this.activateView();
        let handled = false;
        this.forEachView(ctl => {
          if (handled) return;
          handled = true;
          const ctx = ctl.ctx;
          const list = ctx.data ? ctx.data.goals.filter(isChallenge) : null;
          if (list && list.length === 1) { openChallenge(ctx, list[0]); return; }
          ctx.nav('goals');
          if (list && !list.length) openNewChallenge(ctx);
        });
      },
    });
    this.addCommand({
      id: 'record-voice',
      name: 'Record your own count-in',
      callback: () => this.openPage('voice'),
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

  /* Open the gym and land on one of its pages — the settings tab's "Open
     the recorder" button and the command palette both need this. */
  async openPage(page, params) {
    await this.activateView();
    this.forEachView(ctl => ctl.ctx.nav(page, params));
  }

  /* Brings the gym forward and resolves only once there is a view to act on.

     revealLeaf is awaited in BOTH branches: it is async on the host, and the
     commands run forEachView right after this returns. And a Gym tab restored
     at startup in the background is DEFERRED — the leaf exists but has no view
     (and so no appCtl) until something loads it — so forEachView skipped it and
     "Log today's workout" / "Record your own count-in" only brought the tab
     forward. loadIfDeferred is feature-detected (it is newer than some hosts
     in range of minAppVersion) and a failure to load must not stop the
     command from reaching whatever views there are. */
  async activateView() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE);
    let leaf = existing[0];
    if (!leaf) {
      leaf = ws.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await ws.revealLeaf(leaf);
    if (typeof leaf.loadIfDeferred === 'function') {
      try { await leaf.loadIfDeferred(); } catch (e) { console.error('gym-vault load deferred view', e); }
    }
  }

  /* Style + Accent may be chosen for THIS DEVICE ONLY (src/device-look.js):
     this.settings holds what this device shows, this._sharedLook what
     data.json holds, this.deviceLook the local override (or null).

     The Gym folder too (audit 25 Nov 2026, finding 20): this.deviceFolder is
     this device's own folder (or null), this._sharedFolder the one data.json
     holds, and this.settings.gymFolder the EFFECTIVE one every reader uses. */
  async loadSettings() {
    const stored = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this._sharedLook = {};
    for (const f of LOOK_FIELDS) this._sharedLook[f] = stored[f];
    this._sharedFolder = stored.gymFolder;
    this._lookStore = makeLookStore(this.app);
    this._folderStore = makeFolderStore(this.app);
    this.deviceLook = this._lookStore.read();
    this.deviceFolder = this._folderStore.read();
    this.settings = applyFolder(applyLook(stored, this.deviceLook), this.deviceFolder);
  }

  /* data.json was changed on disk by something else — the vault syncing another
     device's choice. Obsidian calls this; without it settings were read once at
     load, so this device's next save wrote its stale copy over the change.
     It goes back through loadSettings so the per-device look is re-applied (a
     Style or Accent chosen for THIS DEVICE still wins here and still stays out
     of data.json) and _sharedLook now holds what the file holds. A failed read
     leaves the settings this device has. */
  async onExternalSettingsChange() {
    try { await this.loadSettings(); } catch (e) { console.error('gym-vault external settings', e); return; }
    this.refreshViews();
  }

  /* Without a device folder the folder shown IS the shared one, so whatever a
     caller set on settings.gymFolder is what switching a device folder off
     later returns to. With one, data.json keeps the shared folder. */
  async saveSettings() {
    if (!this.deviceFolder) this._sharedFolder = this.settings.gymFolder;
    const shared = Object.assign({}, this._sharedLook, { gymFolder: this._sharedFolder });
    await this.saveData(sharedForSave(this.settings, shared, this.deviceLook, this.deviceFolder));
  }

  /* The folder data.json holds (what the other devices follow). */
  sharedGymFolder() { return this.deviceFolder ? this._sharedFolder : this.settings.gymFolder; }

  /* The shared "Gym folder" row while this device has its own: only data.json
     changes, this device stays where it is (so no reload). */
  async setSharedFolder(folder) {
    this._sharedFolder = folder;
    if (!this.deviceFolder) this.settings.gymFolder = folder;
    await this.saveSettings();
  }

  /* This device's own Gym folder: a folder to use it (false when it is no
     folder: empty, the vault root, hidden), null to follow the shared folder
     again. Kept in local storage only; the views reload either way, the same
     as changing the shared folder does. */
  setDeviceFolder(folder) {
    if (folder === null || folder === undefined) {
      this.deviceFolder = null;
      this._folderStore.write(null);
      this.settings.gymFolder = this._sharedFolder;
    } else {
      const clean = cleanFolder(folder);
      if (!clean) return false;
      this.deviceFolder = clean;
      this._folderStore.write(clean);
      this.settings.gymFolder = clean;
    }
    this.refreshViews();
    return true;
  }

  /* Style, Accent, Rewards or Calm motion picked in Settings: this device's choice when one is on,
     otherwise the shared one every device follows. */
  async setLook(field, value) { return this.setLooks({ [field]: value }); }

  /* Several at once (a Style entry is a style AND its Calm palette): one
     write, one refresh. */
  async setLooks(values) {
    Object.assign(this.settings, values);
    if (this.deviceLook) {
      this.deviceLook = Object.assign({}, this.deviceLook, values);
      this._lookStore.write(this.deviceLook);
    } else {
      Object.assign(this._sharedLook, values);
      await this.saveSettings();
    }
    this.refreshViews();
  }

  /* On: this device keeps what it shows now and stops following data.json.
     Off: back to the shared look. */
  setDeviceLook(on) {
    if (on) {
      this.deviceLook = {};
      for (const f of LOOK_FIELDS) if (this.settings[f] !== undefined) this.deviceLook[f] = this.settings[f];
      this._lookStore.write(this.deviceLook);
    } else {
      this.deviceLook = null;
      this._lookStore.write(null);
      Object.assign(this.settings, this._sharedLook);
    }
    this.refreshViews();
  }
}

/* Is there a gym to log into? Loaded, and its folder holds a gym
   (data.present — the same field the view's setup card keys on). */
GymPlugin.canLogNow = ctx => !!(ctx && ctx.data && ctx.data.present);

/* WHAT "Log today's workout" OPENS. The first entry of ctx.daysOn for today -
   the rule Today's hero uses (controller.resolveDaysOn: the active plan's own
   day, then its `(any)` day, then parallel plans, then a fallback), so the
   command and the screen cannot disagree about what today is. It used to look
   in the active plan's days by weekday alone, so on a run or rest day it
   opened an empty log named after the strength plan. Nothing scheduled is a
   plain freestyle log, with no plan name that would be wrong. */
GymPlugin.logTargetFor = (ctx, iso) => {
  const hit = ctx.daysOn(weekdayKey(iso || todayISO()))[0];
  return hit ? { plan: hit.plan, day: hit.day } : { plan: null, day: null };
};

module.exports = GymPlugin;
