import { Plugin, MarkdownView, Menu, Editor, Notice, App, PluginSettingTab, Setting, MarkdownRenderChild } from 'obsidian';
import { TimerData, TimerSettings } from './src/types';
import { generateId, nowSec, currentElapsed, renderDisplay } from './src/timer';
import { parse, render, insertTimer, replaceTimer, removeTimer, TIMER_RE } from './src/editor';
import { timerViewPlugin } from './src/widget';

const DEFAULT_SETTINGS: TimerSettings = { insertPosition: 'tail' };

class TimerRenderChild extends MarkdownRenderChild {
    interval: number | null = null;
    constructor(containerEl: HTMLElement, public data: TimerData) {
        super(containerEl);
    }
    onload() {
        const update = () => {
            this.containerEl.textContent = renderDisplay(this.data);
        };
        update();
        if (this.data.state === 'running') {
            this.interval = window.setInterval(update, 1000);
        }
    }
    onunload() {
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }
}

export default class TimerPlugin extends Plugin {
    settings!: TimerSettings;

    async onload() {
        await this.loadSettings();

        this.registerEditorExtension(timerViewPlugin);

        this.registerMarkdownPostProcessor((el, ctx) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const matches: { node: Text; match: RegExpExecArray }[] = [];
            let node;
            while ((node = walker.nextNode() as Text | null)) {
                const re = new RegExp(TIMER_RE.source, 'g');
                let m;
                while ((m = re.exec(node.textContent ?? '')) !== null) {
                    matches.push({ node, match: m });
                }
            }
            for (const { node, match } of matches) {
                const data: TimerData = {
                    id: match[1],
                    state: match[2] as TimerData['state'],
                    elapsed: parseInt(match[3], 10),
                    startedAt: parseInt(match[4], 10),
                };
                const before = node.textContent!.slice(0, match.index);
                const after = node.textContent!.slice(match.index + match[0].length);

                const span = document.createElement('span');
                span.className = `timer-${data.state}`;

                const parent = node.parentNode!;
                if (before) parent.insertBefore(document.createTextNode(before), node);
                parent.insertBefore(span, node);
                if (after) parent.insertBefore(document.createTextNode(after), node);
                parent.removeChild(node);

                ctx.addChild(new TimerRenderChild(span, data));
            }
        });

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

        this.addSettingTab(new TimerSettingTab(this.app, this));
    }

    async onunload() {
        this.saveAllRunningTimers();
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
            if (parsed) {
                removeTimer(editor, line, parsed.start, parsed.end);
                new Notice('Timer deleted');
            } else {
                new Notice('No timer found on current line.');
            }
            return;
        }

        if (!parsed) {
            const id = generateId();
            const data: TimerData = { id, state: 'running', elapsed: 0, startedAt: nowSec() };
            insertTimer(editor, line, render(data), this.settings.insertPosition);
        } else if (parsed.state === 'running') {
            const elapsed = currentElapsed(parsed);
            const data: TimerData = { id: parsed.id, state: 'paused', elapsed, startedAt: nowSec() };
            replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        } else {
            const data: TimerData = { id: parsed.id, state: 'running', elapsed: parsed.elapsed, startedAt: nowSec() };
            replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        }
    }

    // --- Save running timers on unload ---

    saveAllRunningTimers() {
        const now = nowSec();
        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) return;
            const editor = leaf.view.editor;
            for (let i = 0; i < editor.lineCount(); i++) {
                const parsed = parse(editor.getLine(i));
                if (parsed?.state === 'running') {
                    const elapsed = currentElapsed(parsed);
                    const data: TimerData = { id: parsed.id, state: 'paused', elapsed, startedAt: now };
                    replaceTimer(editor, i, render(data), parsed.start, parsed.end);
                }
            }
        });
    }

    // --- Context menu ---

    buildContextMenu(menu: Menu, editor: Editor, view: MarkdownView) {
        const line = editor.getCursor().line;
        const parsed = parse(editor.getLine(line));

        if (!parsed) {
            menu.addItem((item) =>
                item.setTitle('Start timer').setIcon('play').onClick(() =>
                    this.handleCommand(editor, view, 'toggle'))
            );
        } else {
            if (parsed.state === 'running') {
                menu.addItem((item) =>
                    item.setTitle('Pause timer').setIcon('pause').onClick(() =>
                        this.handleCommand(editor, view, 'toggle'))
                );
            } else {
                menu.addItem((item) =>
                    item.setTitle('Resume timer').setIcon('play').onClick(() =>
                        this.handleCommand(editor, view, 'toggle'))
                );
            }
            menu.addItem((item) =>
                item.setTitle('Delete timer').setIcon('trash').onClick(() =>
                    this.handleCommand(editor, view, 'delete'))
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