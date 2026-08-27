'use strict';

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { SKINS, ACCENTS } = require('./constants');
const { makeIo } = require('./data');

class GymSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl: c } = this;
    c.empty();

    new Setting(c)
      .setName('Gym folder')
      .setDesc('Vault folder holding your exercises, plans, workouts, goals and body log.')
      .addText(t => t
        .setValue(this.plugin.settings.gymFolder)
        .onChange(async v => {
          this.plugin.settings.gymFolder = v.trim() || 'Gym';
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(c)
      .setName('Week starts on')
      .addDropdown(d => d
        .addOption('mon', 'Monday')
        .addOption('sun', 'Sunday')
        .setValue(this.plugin.settings.weekStart)
        .onChange(async v => {
          this.plugin.settings.weekStart = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(c)
      .setName('Style')
      .setDesc('How the gym looks. Both styles use the same data.')
      .addDropdown(d => {
        for (const [key, label] of SKINS) d.addOption(key, label);
        d.setValue(this.plugin.settings.skin || 'floor')
          .onChange(async v => {
            this.plugin.settings.skin = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    new Setting(c)
      .setName('Accent color')
      .setDesc('The highlight color threading through the whole app.')
      .addDropdown(d => {
        for (const [key, label] of ACCENTS) d.addOption(key, label);
        d.setValue(this.plugin.settings.accent || 'lime')
          .onChange(async v => {
            this.plugin.settings.accent = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    new Setting(c)
      .setName('Open on startup')
      .setDesc('Open the gym view when Obsidian launches.')
      .addToggle(t => t
        .setValue(this.plugin.settings.openOnStartup)
        .onChange(async v => {
          this.plugin.settings.openOnStartup = v;
          await this.plugin.saveSettings();
        }));

    new Setting(c)
      .setName('Download images for offline')
      .setDesc('Fetch every remote exercise image into Gym/Attachments and point the notes at the local files, so the library works with no connection. Videos keep streaming (they are large).')
      .addButton(b => b
        .setButtonText('Download images')
        .onClick(async () => {
          b.setDisabled(true).setButtonText('Downloading…');
          try {
            const r = await makeIo(this.plugin).downloadMedia();
            this.plugin.refreshViews();
            new Notice(r.saved || r.patched
              ? `Gym: ${r.saved} image${r.saved === 1 ? '' : 's'} downloaded, ${r.patched} note${r.patched === 1 ? '' : 's'} updated${r.failed ? `, ${r.failed} failed (try again online)` : ''}.`
              : r.failed ? `Gym: downloads failed (${r.failed}) — are you online?` : 'Gym: all images are already local.', 7000);
          } catch (e) {
            new Notice(`Gym: download failed (${e.message || e})`, 6000);
          } finally {
            b.setDisabled(false).setButtonText('Download images');
          }
        }));

    new Setting(c)
      .setName('Refresh starter media')
      .setDesc('Update the demonstration images and videos on the starter exercises to the latest set. Only touches media that is still the bundled default — anything you set yourself stays.')
      .addButton(b => b
        .setButtonText('Refresh media')
        .onClick(async () => {
          try {
            const n = await makeIo(this.plugin).refreshSeedMedia();
            this.plugin.refreshViews();
            new Notice(n ? `Gym: media refreshed on ${n} exercise${n === 1 ? '' : 's'}.` : 'Gym: everything already up to date.', 5000);
          } catch (e) {
            new Notice(`Gym: media refresh failed (${e.message || e})`, 6000);
          }
        }));

    new Setting(c)
      .setName('Starter files')
      .setDesc('Re-run first-time setup. Existing files are never overwritten — only missing starters are created.')
      .addButton(b => b
        .setButtonText('Create starter files')
        .onClick(async () => {
          try {
            await makeIo(this.plugin).scaffold();
            this.plugin.settings.onboarded = true;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            new Notice('Gym: starter files are in place.', 5000);
          } catch (e) {
            new Notice(`Gym: setup failed (${e.message || e})`, 6000);
          }
        }));
  }
}

module.exports = { GymSettingTab };
