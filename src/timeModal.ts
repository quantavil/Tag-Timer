import { App, Modal, Setting, Notice } from 'obsidian';
import { TimerData } from './types';
import {
    currentRemaining,
    currentElapsed,
    formatDuration,
    parseDurationInput,
    setDisplayedSeconds,
    nowSec,
} from './timer';

export function openTimeModal(
    app: App,
    data: TimerData,
    onSubmit: (next: TimerData) => void,
): void {
    const shown = data.kind === 'countdown'
        ? currentRemaining(data)
        : currentElapsed(data);

    class TimeModal extends Modal {
        private value = formatDuration(shown);

        onOpen() {
            this.titleEl.setText('Set time');

            new Setting(this.contentEl)
                .setName('Time')
                .setDesc('mm:ss, hh:mm:ss, or a whole number for minutes')
                .addText((text) => {
                    text.setValue(this.value);
                    text.onChange((v) => (this.value = v));
                    text.inputEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            this.submit();
                        }
                    });
                    setTimeout(() => {
                        text.inputEl.focus();
                        text.inputEl.select();
                    }, 10);
                });

            new Setting(this.contentEl)
                .addButton((btn) =>
                    btn.setButtonText('OK').setCta().onClick(() => this.submit()))
                .addButton((btn) =>
                    btn.setButtonText('Cancel').onClick(() => this.close()));
        }

        private submit() {
            const secs = parseDurationInput(this.value);
            if (secs === null || secs < 0) {
                new Notice('Invalid time format.');
                return;
            }
            this.close();
            onSubmit(setDisplayedSeconds(data, secs, nowSec()));
        }
    }

    new TimeModal(app).open();
}