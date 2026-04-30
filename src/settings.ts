import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { TimerSettings } from './types';
import { formatDuration, parseDurationInput } from './timer';
import type TimerPlugin from '../main';
import { ANALYTICS_VIEW_TYPE } from './analytics/view';

export const DEFAULT_SETTINGS: TimerSettings = {
    insertPosition: 'tail',
    lastActiveTime: 0,
    defaultCountdownSeconds: 25 * 60,
    playCompletionSound: false,
    soundType: 'chime',
    enableAnalytics: false,
};

export class TimerSettingTab extends PluginSettingTab {
    plugin: TimerPlugin;

    constructor(app: App, plugin: TimerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Timer Settings' });

        new Setting(containerEl)
            .setName('Insert position')
            .setDesc('Where to insert new timers on a line.')
            .addDropdown((dd) =>
                dd
                    .addOption('tail', 'End of line')
                    .addOption('head', 'Start of line')
                    .addOption('cursor', 'At cursor')
                    .setValue(this.plugin.settings.insertPosition)
                    .onChange(async (v) => {
                        this.plugin.settings.insertPosition =
                            v as TimerSettings['insertPosition'];
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Play sound on completion')
            .setDesc('Play a brief text-editor friendly sound when a countdown finishes.')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.playCompletionSound)
                    .onChange(async (v) => {
                        this.plugin.settings.playCompletionSound = v;
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Sound type')
            .setDesc('Which sound to play on countdown completion.')
            .addDropdown((dd) =>
                dd
                    .addOption('chime', 'Soft Chime')
                    .addOption('bell', 'Gentle Bell')
                    .addOption('beep', 'Classic Beep')
                    .addOption('digital', 'Digital Alarm')
                    .addOption('marimba', 'Soft Marimba')
                    .setValue(this.plugin.settings.soundType)
                    .onChange(async (v) => {
                        this.plugin.settings.soundType =
                            v as TimerSettings['soundType'];
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Default countdown')
            .setDesc(
                'Used by Alt+C. Use mm:ss, hh:mm:ss, or a whole number for minutes.',
            )
            .addText((text) => {
                text.setPlaceholder('25:00');
                text.setValue(
                    formatDuration(this.plugin.settings.defaultCountdownSeconds),
                );

                const save = async () => {
                    const secs = parseDurationInput(text.inputEl.value);
                    if (secs === null || secs <= 0) {
                        new Notice('Invalid countdown.');
                        text.setValue(
                            formatDuration(
                                this.plugin.settings.defaultCountdownSeconds,
                            ),
                        );
                        return;
                    }

                    this.plugin.settings.defaultCountdownSeconds = secs;
                    await this.plugin.saveSettings();
                    text.setValue(formatDuration(secs));
                };

                text.inputEl.addEventListener('blur', () => void save());
                text.inputEl.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        void save();
                        text.inputEl.blur();
                    }
                });
            });

        // ── Advanced ──
        containerEl.createEl('h3', { text: 'Advanced' });

        new Setting(containerEl)
            .setName('Enable analytics panel')
            .setDesc(
                'Show a sidebar panel with time tracking analytics. ' +
                'Requires reopening the analytics view after toggling.',
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableAnalytics)
                    .onChange(async (v) => {
                        this.plugin.settings.enableAnalytics = v;
                        await this.plugin.saveSettings();

                        if (v) {
                            this.plugin.registerAnalytics();
                            this.plugin.toggleAnalyticsRibbon(true);
                        } else {
                            this.plugin.toggleAnalyticsRibbon(false);
                            // Detach any open analytics leaves
                            this.app.workspace
                                .getLeavesOfType(ANALYTICS_VIEW_TYPE)
                                .forEach((leaf) => leaf.detach());
                        }
                    }),
            );
    }
}
