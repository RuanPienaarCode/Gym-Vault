'use strict';

const { PluginSettingTab, Setting, Notice } = require('obsidian');
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
      .setName('Open on startup')
      .setDesc('Open the gym view when Obsidian launches.')
      .addToggle(t => t
        .setValue(this.plugin.settings.openOnStartup)
        .onChange(async v => {
          this.plugin.settings.openOnStartup = v;
          await this.plugin.saveSettings();
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
