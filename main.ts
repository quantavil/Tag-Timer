import { Plugin, MarkdownView, Menu, Editor, Notice, App, PluginSettingTab, Setting, MarkdownRenderChild, TFile } from 'obsidian';
import { TimerData, TimerSettings, TimerState } from './src/types';
import { generateId, nowSec, currentElapsed, renderDisplay } from './src/timer';
import { parse, render, insertTimer, replaceTimer, removeTimer, TIMER_RE } from './src/editor';
import { timerViewPlugin } from './src/widget';

const DEFAULT_SETTINGS: TimerSettings = { insertPosition: 'tail', lastActiveTime: 0 };

class TimerRenderChild extends MarkdownRenderChild {
    interval: number | null = null;
    constructor(containerEl: HTMLElement, public data: TimerData, public app: App, public sourcePath: string) {
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

        this.containerEl.onclick = async (e) => {
            e.preventDefault();
            const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
            if (!(file instanceof TFile)) return;
            await this.app.vault.process(file, (content) => {
                const re = new RegExp(TIMER_RE.source, 'g');
                return content.replace(re, (match, id, state, elap, started) => {
                    if (id !== this.data.id) return match;
                    let newState: TimerState = 'running';
                    let newElapsed = parseInt(elap, 10);
                    if (state === 'running') {
                        newState = 'paused';
                        newElapsed = currentElapsed({ id: this.data.id, state: 'running', elapsed: newElapsed, startedAt: parseInt(started, 10) });
                    } else if (state === 'stopped') {
                        newState = 'running';
                        newElapsed = 0;
                    }
                    this.data = { id: this.data.id, state: newState, elapsed: newElapsed, startedAt: nowSec() };
                    update();
                    if (newState === 'running' && !this.interval) this.interval = window.setInterval(update, 1000);
                    else if (newState !== 'running' && this.interval) { window.clearInterval(this.interval); this.interval = null; }
                    return render(this.data);
                });
            });
        };
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

        // Crash recovery: check if there's a huge gap since last active
        const now = nowSec();
        if (this.settings.lastActiveTime > 0 && now - this.settings.lastActiveTime > 600) {
            this.saveAllRunningTimers(this.settings.lastActiveTime);
        }
        
        // Save beacon for crash recovery
        this.registerInterval(window.setInterval(() => {
            this.settings.lastActiveTime = nowSec();
            this.saveSettings();
        }, 60000));

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

                ctx.addChild(new TimerRenderChild(span, data, this.app, ctx.sourcePath));
            }
        });

        // Enforce 1 timer per line
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                const line = editor.getCursor().line;
                const lineText = editor.getLine(line);
                const matches = [...lineText.matchAll(new RegExp(TIMER_RE.source, 'g'))];
                if (matches.length > 1) {
                    for (let i = matches.length - 1; i > 0; i--) {
                        const m = matches[i];
                        if (m.index !== undefined) {
                            editor.replaceRange('', { line, ch: m.index }, { line, ch: m.index + m[0].length });
                        }
                    }
                }
            })
        );

        this.addCommand({
            id: 'toggle-timer',
            name: 'Toggle timer',
            hotkeys: [{ modifiers: ['Alt'], key: 's' }],
            editorCallback: (editor, view) => this.handleCommand(editor, view as MarkdownView, 'toggle'),
        });

        this.addCommand({
            id: 'stop-timer',
            name: 'Stop timer',
            editorCallback: (editor, view) => this.handleCommand(editor, view as MarkdownView, 'stop'),
        });

        this.addCommand({
            id: 'reset-timer',
            name: 'Reset timer',
            editorCallback: (editor, view) => this.handleCommand(editor, view as MarkdownView, 'reset'),
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

    handleCommand(editor: Editor, view: MarkdownView, action: 'toggle' | 'delete' | 'stop' | 'reset') {
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
        } else if (action === 'stop') {
            const elapsed = currentElapsed(parsed);
            const data: TimerData = { id: parsed.id, state: 'stopped', elapsed, startedAt: nowSec() };
            replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        } else if (action === 'reset') {
            const data: TimerData = { id: parsed.id, state: 'paused', elapsed: 0, startedAt: nowSec() };
            replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        } else if (parsed.state === 'running') {
            const elapsed = currentElapsed(parsed);
            const data: TimerData = { id: parsed.id, state: 'paused', elapsed, startedAt: nowSec() };
            replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        } else {
            // from paused or stopped to running
            const data: TimerData = { id: parsed.id, state: 'running', elapsed: parsed.elapsed, startedAt: nowSec() };
            if (parsed.state === 'stopped') data.elapsed = 0; // stop restarts from 0 OR keeps it? Usually stop -> running keeps it or resets? Let's keep it, reset is explicit.
            replaceTimer(editor, line, render(data), parsed.start, parsed.end);
        }
    }

    // --- Save running timers on unload ---

    saveAllRunningTimers(referenceTime = nowSec()) {
        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) return;
            const editor = leaf.view.editor;
            for (let i = 0; i < editor.lineCount(); i++) {
                const parsed = parse(editor.getLine(i));
                if (parsed?.state === 'running') {
                    // Temporarily modify startedAt to calculate elapsed up to referenceTime
                    const temp = { ...parsed, startedAt: Math.min(parsed.startedAt, referenceTime) };
                    const elapsed = temp.elapsed + Math.max(0, referenceTime - temp.startedAt);
                    const data: TimerData = { id: parsed.id, state: 'paused', elapsed, startedAt: referenceTime };
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
                menu.addItem((item) =>
                    item.setTitle('Stop timer').setIcon('square').onClick(() =>
                        this.handleCommand(editor, view, 'stop'))
                );
            } else {
                menu.addItem((item) =>
                    item.setTitle('Resume timer').setIcon('play').onClick(() =>
                        this.handleCommand(editor, view, 'toggle'))
                );
            }
            menu.addItem((item) =>
                item.setTitle('Reset timer').setIcon('refresh-cw').onClick(() =>
                    this.handleCommand(editor, view, 'reset'))
            );
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