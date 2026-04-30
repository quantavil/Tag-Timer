import {
    Plugin,
    MarkdownView,
    Notice,
} from 'obsidian';
import { TimerSettings } from './src/types';
import { timerRegex, extractTimerData } from './src/editor';
import { timerViewPlugin, setWidgetApp, setWidgetSettings } from './src/widget';
import { TIMER_MUTATED_EVENT, nowSec } from './src/timer';
import { DEFAULT_SETTINGS, TimerSettingTab } from './src/settings';
import { handleCommand } from './src/commands';
import { buildContextMenu } from './src/contextMenu';
import { recoverRunningTimers, saveAllRunningTimers, pauseOpenEditorsSync, stopAllRunningTimers } from './src/recovery';
import { TimerRenderChild } from './src/postProcessor';

export default class TimerPlugin extends Plugin {
    settings!: TimerSettings;
    private beforeUnloadRef: (() => void) | null = null;
    private timerMutatedRef: ((evt: Event) => void) | null = null;
    private enforcingLimit = false;

    async onload() {
        await this.loadSettings();
        setWidgetApp(this.app);
        setWidgetSettings(this.settings);
        this.registerEditorExtension(timerViewPlugin);

        await recoverRunningTimers(this.app, this.settings.lastActiveTime);

        // Keep lastActiveTime up to date for recovery
        this.registerInterval(
            window.setInterval(() => {
                this.settings.lastActiveTime = nowSec();
                void this.saveSettings();
            }, 30_000),
        );

        this.beforeUnloadRef = () => {
            pauseOpenEditorsSync(this.app);
        };
        window.addEventListener('beforeunload', this.beforeUnloadRef);

        this.timerMutatedRef = () => {
            void this.saveSettings();
        };
        window.addEventListener(TIMER_MUTATED_EVENT, this.timerMutatedRef);

        this.registerMarkdownPostProcessor((el, ctx) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const nodes: Text[] = [];
            let node: Node | null;

            while ((node = walker.nextNode()) !== null) {
                nodes.push(node as Text);
            }

            for (const textNode of nodes) {
                const text = textNode.textContent ?? '';
                const re = timerRegex();
                let m: RegExpExecArray | null;
                let last = 0;
                let changed = false;

                const frag = document.createDocumentFragment();

                while ((m = re.exec(text)) !== null) {
                    changed = true;

                    if (m.index > last) {
                        frag.append(text.slice(last, m.index));
                    }

                    const data = extractTimerData(m);
                    const span = document.createElement('span');
                    span.className = `timer-badge timer-${data.kind} timer-${data.state}`;
                    frag.appendChild(span);
                    ctx.addChild(new TimerRenderChild(span, data, this.app, ctx.sourcePath, this.settings));

                    last = m.index + m[0].length;
                }

                if (!changed) continue;

                if (last < text.length) {
                    frag.append(text.slice(last));
                }

                textNode.parentNode?.replaceChild(frag, textNode);
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (this.enforcingLimit) return;
                const line = editor.getCursor().line;
                const lineText = editor.getLine(line);
                const matches = [...lineText.matchAll(timerRegex())];

                if (matches.length > 1) {
                    this.enforcingLimit = true;
                    try {
                        for (let i = matches.length - 1; i > 0; i--) {
                            const m = matches[i];
                            if (m.index !== undefined) {
                                editor.replaceRange(
                                    '',
                                    { line, ch: m.index },
                                    { line, ch: m.index + m[0].length },
                                );
                            }
                        }
                    } finally {
                        this.enforcingLimit = false;
                    }
                }
            }),
        );

        this.addCommand({
            id: 'toggle-timer',
            name: 'Toggle timer',
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 's' }],
            editorCallback: (e, v) =>
                handleCommand(this.app, this.settings, e, v as MarkdownView, 'toggle', 'stopwatch'),
        });

        this.addCommand({
            id: 'toggle-countdown',
            name: 'Start/pause countdown',
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'c' }],
            editorCallback: (e, v) =>
                handleCommand(this.app, this.settings, e, v as MarkdownView, 'toggle', 'countdown'),
        });

        this.addCommand({
            id: 'stop-timer',
            name: 'Stop timer',
            editorCallback: (e, v) =>
                handleCommand(this.app, this.settings, e, v as MarkdownView, 'stop'),
        });

        this.addCommand({
            id: 'stop-all-timers',
            name: 'Stop all running timers',
            callback: async () => {
                const count = await stopAllRunningTimers(this.app);
                new Notice(`Stopped ${count} running timer(s).`);
            }
        });

        this.addCommand({
            id: 'reset-timer',
            name: 'Reset timer',
            editorCallback: (e, v) =>
                handleCommand(this.app, this.settings, e, v as MarkdownView, 'reset'),
        });

        this.addCommand({
            id: 'change-timer-time',
            name: 'Change timer/countdown time',
            editorCallback: (e, v) =>
                handleCommand(this.app, this.settings, e, v as MarkdownView, 'change'),
        });

        this.addCommand({
            id: 'delete-timer',
            name: 'Delete timer',
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'd' }],
            editorCallback: (e, v) =>
                handleCommand(this.app, this.settings, e, v as MarkdownView, 'delete'),
        });

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (view instanceof MarkdownView) {
                    buildContextMenu(this.app, this.settings, menu, editor, view);
                }
            }),
        );

        this.addSettingTab(new TimerSettingTab(this.app, this));
    }

    async onunload() {
        if (this.beforeUnloadRef) {
            window.removeEventListener('beforeunload', this.beforeUnloadRef);
            this.beforeUnloadRef = null;
        }

        if (this.timerMutatedRef) {
            window.removeEventListener(TIMER_MUTATED_EVENT, this.timerMutatedRef);
            this.timerMutatedRef = null;
        }

        await saveAllRunningTimers(this.app);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        
        // Cleanup old array if it exists
        if ('runningTimerFiles' in this.settings) {
            delete (this.settings as any).runningTimerFiles;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}