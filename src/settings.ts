import { App, PluginSettingTab, Setting } from 'obsidian';
import TimerPlugin from '../main';
import { LANG } from './constants';

export class TimerSettingTab extends PluginSettingTab {
    plugin: TimerPlugin;
    constructor(app: App, plugin: TimerPlugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this; containerEl.empty(); const lang = LANG.settings;
        new Setting(containerEl).setName(lang.name).setHeading();
        containerEl.createEl('p', { text: lang.desc });
        const tutorial = containerEl.createDiv({ cls: 'tutorial-info' }); const p = tutorial.createEl('p');
        p.appendText(lang.tutorial); p.createEl('a', { text: 'GitHub', href: 'https://github.com/quantavil/tag-timer', attr: { target: '_blank' } });
        containerEl.createEl('p', { text: lang.askforvote }); containerEl.createEl('p', { text: lang.issue });

        new Setting(containerEl).setName(lang.sections.basic.name).setHeading();

        new Setting(containerEl)
            .setName(lang.autostop.name).setDesc(lang.autostop.desc)
            .addDropdown(dd => dd.addOption('never', lang.autostop.choice.never).addOption('quit', lang.autostop.choice.quit).addOption('close', lang.autostop.choice.close)
                .setValue(this.plugin.settings.autoStopTimers).onChange(async v => this.plugin.updateSetting('autoStopTimers', v as any)));

        new Setting(containerEl)
            .setName(lang.insertlocation.name).setDesc(lang.insertlocation.desc)
            .addDropdown(dd => dd.addOption('head', lang.insertlocation.choice.head).addOption('tail', lang.insertlocation.choice.tail).addOption('cursor', lang.insertlocation.choice.cursor)
                .setValue(this.plugin.settings.timerInsertLocation).onChange(async v => this.plugin.updateSetting('timerInsertLocation', v as any)));
    }
}
