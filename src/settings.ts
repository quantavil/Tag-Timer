import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { TimerSettings } from './types';
import { formatDuration, parseDurationInput } from './timer';
import type TimerPlugin from '../main';

export const DEFAULT_SETTINGS: TimerSettings = {
    insertPosition: 'tail',
    lastActiveTime: 0,
    defaultCountdownSeconds: 25 * 60,
    playCompletionSound: false,
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
            .setDesc('Play a brief text-editor friendly beep when a countdown finishes.')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.playCompletionSound)
                    .onChange(async (v) => {
                        this.plugin.settings.playCompletionSound = v;
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
    }
}
