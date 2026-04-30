import { App, MarkdownRenderChild, Menu, TFile, Notice } from 'obsidian';
import { TimerData, TimerSettings } from './types';
import { renderDisplay, currentRemaining, nowSec, stopData, playCompletionSound } from './timer';
import { addTimerMenuItems } from './menu';
import { openTimeModal } from './timeModal';
import { mutateTimerInFile } from './controller';
import { addLongPress } from './longPress';

export class TimerRenderChild extends MarkdownRenderChild {
    interval: number | null = null;
    private finishing = false;
    private isFirstRender = true;

    constructor(
        containerEl: HTMLElement,
        public data: TimerData,
        public app: App,
        public sourcePath: string,
        public settings: TimerSettings,
    ) {
        super(containerEl);
    }

    private syncInterval() {
        if (this.data.state === 'running') {
            if (this.interval === null) {
                this.interval = window.setInterval(() => this.refresh(), 1000);
            }
        } else if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }

    private refresh() {
        if (
            !this.finishing &&
            this.data.kind === 'countdown' &&
            this.data.state === 'running' &&
            currentRemaining(this.data) === 0
        ) {
            if (this.isFirstRender) {
                // Expired while closed. Prevent file mutation during read/render phase (crucial for Canvas embeds).
                // Let the background expiry scanner handle the file write.
                this.data = stopData(this.data, nowSec());
            } else {
                this.finishing = true;
                new Notice('Timer finished!');
                if (this.settings.playCompletionSound) playCompletionSound(this.settings.soundType);
                void this.mutate((d) => stopData(d, nowSec())).finally(() => {
                    this.finishing = false;
                });
                return;
            }
        }

        this.isFirstRender = false;
        this.containerEl.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;
        this.containerEl.textContent = renderDisplay(this.data);
        this.syncInterval();
    }

    private async mutate(mutator: (data: TimerData) => TimerData | null) {
        const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
        if (!(file instanceof TFile)) return;

        const nextData = await mutateTimerInFile(this.app, file, this.data.id, mutator);

        if (nextData) {
            this.data = nextData;
            this.refresh();
        } else {
            this.containerEl.remove();
            if (this.interval !== null) {
                window.clearInterval(this.interval);
                this.interval = null;
            }
        }
    }

    private openMenu(event: MouseEvent) {
        const menu = new Menu();

        addTimerMenuItems(menu, this.data, {
            replace: (next) => void this.mutate(() => next),
            changeTime: () => {
                openTimeModal(this.app, this.data, (next) => {
                    void this.mutate(() => next);
                });
            },
            remove: () => void this.mutate(() => null),
        });

        menu.showAtMouseEvent(event);
    }

    onload() {
        this.refresh();

        this.containerEl.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openMenu(event);
        };

        this.containerEl.oncontextmenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openMenu(event);
        };

        addLongPress(this.containerEl, (e) => this.openMenu(e));
    }

    onunload() {
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }
}
