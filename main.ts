import { Plugin, MarkdownView, Menu, Editor, Notice, App, PluginSettingTab, Setting } from 'obsidian';
import { TimerData, TimerSettings } from './src/types';
import { generateId, nowSec, currentElapsed, startInterval, stopInterval, stopAllIntervals } from './src/timer';
import { parse, render, insertTimer, replaceTimer, removeTimer } from './src/editor';

const DEFAULT_SETTINGS: TimerSettings = { insertPosition: 'tail' };

export default class TimerPlugin extends Plugin {
    settings!: TimerSettings;
    timers = new Map<string, TimerData>();

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'toggle-timer',
            name: 'Toggle timer',
            hotkeys: [{ modifiers: ['Alt'], key: 's' }],
            editorCallback: (editor, view) => this.handleCommand(editor, view as MarkdownView, 'toggle'),
        });

        this.addCommand({
            id: 'delete-timer',
            name: 'Delete timer',
            hotkeys: [{ modifiers: ['Alt'], key: 'd' }],
            editorCallback: (editor, view) => this.handleCommand(editor, view as MarkdownView, 'delete'),
        });

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (view instanceof MarkdownView) this.buildContextMenu(menu, editor, view);
            })
        );

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (!file) return;
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view?.file === file) this.restoreTimersInView(view);
            })
        );

        this.addSettingTab(new TimerSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => this.restoreAllTimers());
    }

    async onunload() {
        this.pauseAll();
        stopAllIntervals();
    }

    // --- Core actions ---

    handleCommand(editor: Editor, view: MarkdownView, action: 'toggle' | 'delete') {
        if ((view as any).getMode?.() === 'preview') {
            new Notice('Switch to edit mode to use timers.');
            return;
        }
        const line = editor.getCursor().line;
        const parsed = parse(editor.getLine(line));

        if (action === 'delete') {
            if (parsed) this.deleteTimer(editor, line, parsed.id);
            else new Notice('No timer found on current line.');
            return;
        }

        if (!parsed) {
            this.startTimer(editor, line);
        } else if (parsed.state === 'running') {
            this.pauseTimer(editor, line, parsed.id);
        } else {
            this.resumeTimer(editor, line, parsed.id);
        }
    }

    startTimer(editor: Editor, line: number) {
        const id = generateId();
        const data: TimerData = { id, state: 'running', elapsed: 0, startedAt: nowSec() };
        this.timers.set(id, data);
        insertTimer(editor, line, render(data), this.settings.insertPosition);
        startInterval(id, (timerId) => this.tick(timerId, editor));
    }

    pauseTimer(editor: Editor, line: number, id: string) {
        const data = this.timers.get(id);
        if (!data) return;
        const elapsed = currentElapsed(data);
        const paused: TimerData = { ...data, state: 'paused', elapsed, startedAt: nowSec() };
        this.timers.set(id, paused);
        stopInterval(id);

        const parsed = parse(editor.getLine(line));
        if (parsed && parsed.id === id) {
            replaceTimer(editor, line, render(paused), parsed.start, parsed.end);
        }
    }

    resumeTimer(editor: Editor, line: number, id: string) {
        const existing = this.timers.get(id);
        const parsed = parse(editor.getLine(line));
        if (!parsed || parsed.id !== id) return;

        const data: TimerData = {
            id,
            state: 'running',
            elapsed: existing?.elapsed ?? parsed.elapsed,
            startedAt: nowSec(),
        };
        this.timers.set(id, data);
        replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        startInterval(id, (timerId) => this.tick(timerId, editor));
    }

    deleteTimer(editor: Editor, line: number, id: string) {
        stopInterval(id);
        this.timers.delete(id);
        const parsed = parse(editor.getLine(line));
        if (parsed && parsed.id === id) {
            removeTimer(editor, line, parsed.start, parsed.end);
        }
        new Notice('Timer deleted');
    }

    tick(id: string, editor: Editor) {
        const data = this.timers.get(id);
        if (!data || data.state !== 'running') return;

        const now = nowSec();
        const elapsed = currentElapsed(data);
        const updated: TimerData = { ...data, elapsed, startedAt: now };
        this.timers.set(id, updated);

        // Find the timer in the editor and update its display
        for (let i = 0; i < editor.lineCount(); i++) {
            const parsed = parse(editor.getLine(i));
            if (parsed && parsed.id === id) {
                replaceTimer(editor, i, render(updated), parsed.start, parsed.end);
                return;
            }
        }
        // Timer not found in editor, stop it
        stopInterval(id);
        this.timers.delete(id);
    }

    // --- Restore ---

    restoreAllTimers() {
        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
            if (leaf.view instanceof MarkdownView) this.restoreTimersInView(leaf.view);
        });
    }

    restoreTimersInView(view: MarkdownView) {
        const editor = view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const parsed = parse(editor.getLine(i));
            if (parsed?.state === 'running') {
                const data: TimerData = {
                    id: parsed.id,
                    state: 'running',
                    elapsed: parsed.elapsed,
                    startedAt: nowSec(),
                };
                this.timers.set(parsed.id, data);
                replaceTimer(editor, i, render(data), parsed.start, parsed.end);
                startInterval(parsed.id, (timerId) => this.tick(timerId, editor));
            }
        }
    }

    pauseAll() {
        const now = nowSec();
        for (const [id, data] of this.timers) {
            if (data.state === 'running') {
                this.timers.set(id, { ...data, state: 'paused', elapsed: currentElapsed(data), startedAt: now });
            }
        }
    }

    // --- Context menu ---

    buildContextMenu(menu: Menu, editor: Editor, view: MarkdownView) {
        const line = editor.getCursor().line;
        const parsed = parse(editor.getLine(line));

        if (!parsed) {
            menu.addItem((item) =>
                item.setTitle('Start timer').setIcon('play').onClick(() => this.startTimer(editor, line))
            );
        } else {
            if (parsed.state === 'running') {
                menu.addItem((item) =>
                    item.setTitle('Pause timer').setIcon('pause').onClick(() => this.pauseTimer(editor, line, parsed.id))
                );
            } else {
                menu.addItem((item) =>
                    item.setTitle('Resume timer').setIcon('play').onClick(() => this.resumeTimer(editor, line, parsed.id))
                );
            }
            menu.addItem((item) =>
                item.setTitle('Delete timer').setIcon('trash').onClick(() => this.deleteTimer(editor, line, parsed.id))
            );
        }
    }

    // --- Settings ---

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class TimerSettingTab extends PluginSettingTab {
    plugin: TimerPlugin;

    constructor(app: App, plugin: TimerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Timer Settings').setHeading();

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
                        this.plugin.settings.insertPosition = v as TimerSettings['insertPosition'];
                        await this.plugin.saveSettings();
                    })
            );
    }
}