import {
    Plugin, MarkdownView, Menu, Editor, Notice,
    App, PluginSettingTab, Setting, MarkdownRenderChild, TFile,
} from 'obsidian';
import { TimerData, TimerSettings, TimerState } from './src/types';
import { generateId, nowSec, currentElapsed, renderDisplay } from './src/timer';
import { parse, render, insertTimer, replaceTimer, removeTimer, TIMER_RE } from './src/editor';
import { timerViewPlugin } from './src/widget';

const DEFAULT_SETTINGS: TimerSettings = {
    insertPosition: 'tail',
    lastActiveTime: 0,
    runningTimerFiles: [],
};

/* ── Reading-view widget ─────────────────────────────────────────── */

class TimerRenderChild extends MarkdownRenderChild {
    interval: number | null = null;

    constructor(
        containerEl: HTMLElement,
        public data: TimerData,
        public app: App,
        public sourcePath: string,
    ) {
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
                        newElapsed = currentElapsed({
                            id: this.data.id, state: 'running',
                            elapsed: newElapsed, startedAt: parseInt(started, 10),
                        });
                    } else if (state === 'stopped') {
                        newState = 'running';
                        newElapsed = 0;
                    }
                    this.data = {
                        id: this.data.id, state: newState,
                        elapsed: newElapsed, startedAt: nowSec(),
                    };
                    update();
                    if (newState === 'running' && !this.interval) {
                        this.interval = window.setInterval(update, 1000);
                    } else if (newState !== 'running' && this.interval) {
                        window.clearInterval(this.interval);
                        this.interval = null;
                    }
                    return render(this.data);
                });
            });
            // vault.process triggers vault 'modify' → registry updates automatically
        };
    }

    onunload() {
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }
}

/* ── Main plugin ─────────────────────────────────────────────────── */

export default class TimerPlugin extends Plugin {
    settings!: TimerSettings;
    private beforeUnloadRef: (() => void) | null = null;
    private enforcingLimit = false;

    async onload() {
        await this.loadSettings();
        this.registerEditorExtension(timerViewPlugin);

        /* ── Crash / unclean-exit recovery ────────────────────────── */
        await this.recoverRunningTimers();

        /* ── Periodic beacon + registry sync (every 30 s) ────────── */
        this.registerInterval(
            window.setInterval(() => {
                this.syncRegistryFromOpenEditors();
                this.settings.lastActiveTime = nowSec();
                this.saveSettings();
            }, 30_000),
        );

        /* ── Keep registry in sync via vault events ──────────────── */
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.updateRegistryForFile(file);
                }
            }),
        );
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                const i = this.settings.runningTimerFiles.indexOf(oldPath);
                if (i !== -1) {
                    this.settings.runningTimerFiles[i] = file.path;
                    this.saveSettings();
                }
            }),
        );
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                const i = this.settings.runningTimerFiles.indexOf(file.path);
                if (i !== -1) {
                    this.settings.runningTimerFiles.splice(i, 1);
                    this.saveSettings();
                }
            }),
        );

        /* ── Safety-net: pause open editors on window close ──────── */
        this.beforeUnloadRef = () => this.pauseOpenEditorsSync();
        window.addEventListener('beforeunload', this.beforeUnloadRef);

        /* ── Post-processor (reading view) ───────────────────────── */
        this.registerMarkdownPostProcessor((el, ctx) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const hits: { node: Text; match: RegExpExecArray }[] = [];
            let node;
            while ((node = walker.nextNode() as Text | null)) {
                const re = new RegExp(TIMER_RE.source, 'g');
                let m;
                while ((m = re.exec(node.textContent ?? '')) !== null) {
                    hits.push({ node, match: m });
                }
            }
            for (const { node, match } of hits) {
                const data: TimerData = {
                    id: match[1],
                    state: match[2] as TimerState,
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

        /* ── Enforce one timer per line (with re-entrancy guard) ─── */
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                if (this.enforcingLimit) return;
                const line = editor.getCursor().line;
                const lineText = editor.getLine(line);
                const matches = [...lineText.matchAll(new RegExp(TIMER_RE.source, 'g'))];
                if (matches.length > 1) {
                    this.enforcingLimit = true;
                    try {
                        for (let i = matches.length - 1; i > 0; i--) {
                            const m = matches[i];
                            if (m.index !== undefined) {
                                editor.replaceRange(
                                    '', { line, ch: m.index },
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

        /* ── Commands ────────────────────────────────────────────── */
        this.addCommand({
            id: 'toggle-timer',
            name: 'Toggle timer',
            hotkeys: [{ modifiers: ['Alt'], key: 's' }],
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'toggle'),
        });
        this.addCommand({
            id: 'stop-timer',
            name: 'Stop timer',
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'stop'),
        });
        this.addCommand({
            id: 'reset-timer',
            name: 'Reset timer',
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'reset'),
        });
        this.addCommand({
            id: 'delete-timer',
            name: 'Delete timer',
            hotkeys: [{ modifiers: ['Alt'], key: 'd' }],
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'delete'),
        });

        /* ── Context menu ────────────────────────────────────────── */
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (view instanceof MarkdownView) this.buildContextMenu(menu, editor, view);
            }),
        );

        this.addSettingTab(new TimerSettingTab(this.app, this));
    }

    async onunload() {
        if (this.beforeUnloadRef) {
            window.removeEventListener('beforeunload', this.beforeUnloadRef);
            this.beforeUnloadRef = null;
        }
        await this.saveAllRunningTimers();
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Registry helpers
     * ═══════════════════════════════════════════════════════════════ */

    private trackFile(path: string) {
        if (!this.settings.runningTimerFiles.includes(path)) {
            this.settings.runningTimerFiles.push(path);
        }
    }

    private untrackFile(path: string) {
        const i = this.settings.runningTimerFiles.indexOf(path);
        if (i !== -1) this.settings.runningTimerFiles.splice(i, 1);
    }

    /**
     * Reacts to vault 'modify' events.  Uses the in-memory cache so the
     * cost is just a regex test, not a disk read.
     */
    private async updateRegistryForFile(file: TFile) {
        try {
            const content = await this.app.vault.cachedRead(file);
            const hasRunning = /⏳\[[^|]+\|running\|/.test(content);
            const tracked = this.settings.runningTimerFiles.includes(file.path);

            if (hasRunning && !tracked) {
                this.trackFile(file.path);
                await this.saveSettings();
            } else if (!hasRunning && tracked) {
                this.untrackFile(file.path);
                await this.saveSettings();
            }
        } catch {
            /* file may vanish between event and handler */
        }
    }

    /**
     * Periodic full scan of every open editor.  Non-open files are left
     * in the registry untouched (we cannot verify them without a disk read).
     */
    private syncRegistryFromOpenEditors() {
        const openState = new Map<string, boolean>(); // path → hasRunning

        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) return;
            const file = leaf.view.file;
            if (!file || openState.has(file.path)) return;

            const editor = leaf.view.editor;
            let running = false;
            for (let i = 0; i < editor.lineCount(); i++) {
                if (editor.getLine(i).includes('|running|')) {
                    running = true;
                    break;
                }
            }
            openState.set(file.path, running);
        });

        const updated = new Set(this.settings.runningTimerFiles);
        for (const [path, running] of openState) {
            if (running) updated.add(path);
            else updated.delete(path);
        }
        this.settings.runningTimerFiles = [...updated];
    }

    /** Immediate registry refresh after a command mutates a timer. */
    private refreshRegistryForEditor(editor: Editor, view: MarkdownView) {
        const file = view.file;
        if (!file) return;

        let hasRunning = false;
        for (let i = 0; i < editor.lineCount(); i++) {
            if (editor.getLine(i).includes('|running|')) {
                hasRunning = true;
                break;
            }
        }
        if (hasRunning) this.trackFile(file.path);
        else this.untrackFile(file.path);

        this.saveSettings();
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Crash / unclean-exit recovery
     * ═══════════════════════════════════════════════════════════════ */

    /**
     * On load the registry should be empty (saveAllRunningTimers clears it).
     * If it is NOT empty the previous session ended without a clean save
     * (crash, force-quit, power loss).  We pause every still-running timer
     * at lastActiveTime so elapsed stays as accurate as possible.
     */
    private async recoverRunningTimers() {
        const tracked = [...(this.settings.runningTimerFiles ?? [])];
        if (tracked.length === 0) return;

        const ref =
            this.settings.lastActiveTime > 0
                ? this.settings.lastActiveTime
                : nowSec();

        const counter = { count: 0 };

        for (const path of tracked) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;

            try {
                await this.app.vault.process(file, (content) => this.pauseTimersInContent(content, ref, counter));
            } catch (e) {
                console.error(`Timer: recovery failed for ${path}`, e);
            }
        }

        this.settings.runningTimerFiles = [];
        this.settings.lastActiveTime = nowSec();
        await this.saveSettings();

        if (counter.count > 0) {
            new Notice(`Recovered ${counter.count} running timer(s) from previous session.`);
        }
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Save / pause helpers
     * ═══════════════════════════════════════════════════════════════ */

    /** Replaces running timers with paused ones in raw file content using a reference time. */
    private pauseTimersInContent(content: string, refTime: number, counter?: { count: number }): string {
        return content.replace(
            new RegExp(TIMER_RE.source, 'g'),
            (m, id, state, elap, started) => {
                if (state !== 'running') return m;
                if (counter) counter.count++;
                const elapsed = parseInt(elap, 10) + Math.max(0, refTime - parseInt(started, 10));
                return render({ id, state: 'paused', elapsed, startedAt: refTime });
            },
        );
    }

    /**
     * Synchronous, editor-only.  Used as the `beforeunload` safety-net
     * because async work is unreliable in that handler.
     * Returns a set of file paths that were processed.
     */
    private pauseOpenEditorsSync(ref = nowSec()): Set<string> {
        const handledPaths = new Set<string>();
        this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) return;
            const file = leaf.view.file;
            if (file) handledPaths.add(file.path);

            const editor = leaf.view.editor;
            for (let i = 0; i < editor.lineCount(); i++) {
                const p = parse(editor.getLine(i));
                if (p?.state !== 'running') continue;
                const elapsed = p.elapsed + Math.max(0, ref - p.startedAt);
                replaceTimer(
                    editor, i,
                    render({ id: p.id, state: 'paused', elapsed, startedAt: ref }),
                    p.start, p.end,
                );
            }
        });
        return handledPaths;
    }

    /**
     * Two-phase save used by `onunload`:
     *  1. Sync phase  – pauses timers in every open editor (reliable even
     *     during shutdown).
     *  2. Async phase – uses vault.process for tracked files that are NOT
     *     currently open (best-effort; if it doesn't complete, the crash-
     *     recovery path handles it on next load).
     */
    async saveAllRunningTimers(ref = nowSec()) {
        // Phase 1 – open editors (synchronous)
        const handledPaths = this.pauseOpenEditorsSync(ref);

        // Phase 2 – non-open tracked files (async, best-effort)
        for (const path of [...this.settings.runningTimerFiles]) {
            if (handledPaths.has(path)) continue;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;

            try {
                await this.app.vault.process(file, (content) => this.pauseTimersInContent(content, ref));
            } catch (e) {
                console.error(`Timer: save failed for ${path}`, e);
            }
        }

        this.settings.runningTimerFiles = [];
        await this.saveSettings();
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Core command handler
     * ═══════════════════════════════════════════════════════════════ */

    handleCommand(
        editor: Editor,
        view: MarkdownView,
        action: 'toggle' | 'delete' | 'stop' | 'reset',
    ) {
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
            this.refreshRegistryForEditor(editor, view);
            return;
        }

        if (!parsed) {
            const id = generateId();
            const data: TimerData = {
                id,
                state: 'running',
                elapsed: 0,
                startedAt: nowSec(),
            };
            insertTimer(editor, line, render(data), this.settings.insertPosition);
        } else if (action === 'stop') {
            const elapsed = currentElapsed(parsed);
            replaceTimer(
                editor, line,
                render({ id: parsed.id, state: 'stopped', elapsed, startedAt: nowSec() }),
                parsed.start, parsed.end,
            );
        } else if (action === 'reset') {
            replaceTimer(
                editor, line,
                render({ id: parsed.id, state: 'paused', elapsed: 0, startedAt: nowSec() }),
                parsed.start, parsed.end,
            );
        } else if (parsed.state === 'running') {
            const elapsed = currentElapsed(parsed);
            replaceTimer(
                editor, line,
                render({ id: parsed.id, state: 'paused', elapsed, startedAt: nowSec() }),
                parsed.start, parsed.end,
            );
        } else {
            // paused / stopped → running
            const elapsed = parsed.state === 'stopped' ? 0 : parsed.elapsed;
            replaceTimer(
                editor, line,
                render({ id: parsed.id, state: 'running', elapsed, startedAt: nowSec() }),
                parsed.start, parsed.end,
            );
        }

        this.refreshRegistryForEditor(editor, view);
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Context menu
     * ═══════════════════════════════════════════════════════════════ */

    buildContextMenu(menu: Menu, editor: Editor, view: MarkdownView) {
        const line = editor.getCursor().line;
        const parsed = parse(editor.getLine(line));

        if (!parsed) {
            menu.addItem((item) =>
                item.setTitle('Start timer').setIcon('play')
                    .onClick(() => this.handleCommand(editor, view, 'toggle')));
        } else {
            if (parsed.state === 'running') {
                menu.addItem((item) =>
                    item.setTitle('Pause timer').setIcon('pause')
                        .onClick(() => this.handleCommand(editor, view, 'toggle')));
                menu.addItem((item) =>
                    item.setTitle('Stop timer').setIcon('square')
                        .onClick(() => this.handleCommand(editor, view, 'stop')));
            } else {
                menu.addItem((item) =>
                    item.setTitle('Resume timer').setIcon('play')
                        .onClick(() => this.handleCommand(editor, view, 'toggle')));
            }
            menu.addItem((item) =>
                item.setTitle('Reset timer').setIcon('refresh-cw')
                    .onClick(() => this.handleCommand(editor, view, 'reset')));
            menu.addItem((item) =>
                item.setTitle('Delete timer').setIcon('trash')
                    .onClick(() => this.handleCommand(editor, view, 'delete')));
        }
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Settings
     * ═══════════════════════════════════════════════════════════════ */

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

/* ── Settings tab ────────────────────────────────────────────────── */

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
                    }),
            );
    }
}