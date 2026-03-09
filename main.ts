import {
    Plugin,
    MarkdownView,
    Menu,
    Editor,
    Notice,
    App,
    PluginSettingTab,
    Setting,
    MarkdownRenderChild,
    TFile,
} from 'obsidian';
import { TimerData, TimerSettings, TimerState, TimerKind } from './src/types';
import {
    generateId,
    nowSec,
    currentElapsed,
    currentRemaining,
    renderDisplay,
    pauseData,
    resumeData,
    stopData,
    resetData,
    setDisplayedSeconds,
    parseDurationInput,
    formatDuration,
    TIMER_MUTATED_EVENT,
    extractTimerData,
    promptForTimeChange,
} from './src/timer';
import { parse, render, insertTimer, replaceTimer, removeTimer, TIMER_RE } from './src/editor';
import { timerViewPlugin } from './src/widget';

const DEFAULT_SETTINGS: TimerSettings = {
    insertPosition: 'tail',
    lastActiveTime: 0,
    runningTimerFiles: [],
    defaultCountdownSeconds: 25 * 60,
};

function updateTimerInContent(
    content: string,
    targetId: string,
    mutator: (data: TimerData) => TimerData | null,
): string {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const re = new RegExp(TIMER_RE.source, 'g');
        let m: RegExpExecArray | null;

        while ((m = re.exec(line)) !== null) {
            if (m[1] !== targetId) continue;

            const current = extractTimerData(m);
            const next = mutator(current);
            const start = m.index;
            const end = start + m[0].length;

            if (next === null) {
                const hasSpaceBefore = start > 0 && line[start - 1] === ' ';
                const hasSpaceAfter = end < line.length && line[end] === ' ';

                const removeStart = hasSpaceBefore ? start - 1 : start;
                const removeEnd = (hasSpaceAfter && !hasSpaceBefore) ? end + 1 : end;

                lines[i] = line.slice(0, removeStart) + line.slice(removeEnd);
            } else {
                lines[i] = line.slice(0, start) + render(next) + line.slice(end);
            }

            return lines.join('\n');
        }
    }

    return content;
}

/* ── Reading-view widget ─────────────────────────────────────────── */

class TimerRenderChild extends MarkdownRenderChild {
    interval: number | null = null;
    private finishing = false;

    constructor(
        containerEl: HTMLElement,
        public data: TimerData,
        public app: App,
        public sourcePath: string,
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
            !this.finishing
            && this.data.kind === 'countdown'
            && this.data.state === 'running'
            && currentRemaining(this.data) === 0
        ) {
            this.finishing = true;
            void this.mutate((data) => stopData(data, nowSec())).finally(() => {
                this.finishing = false;
            });
            return;
        }

        this.containerEl.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;
        this.containerEl.textContent = renderDisplay(this.data);
        this.syncInterval();
    }

    private async mutate(mutator: (data: TimerData) => TimerData | null) {
        const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
        if (!(file instanceof TFile)) return;

        let nextData: TimerData | null = null;

        try {
            await this.app.vault.process(file, (content) =>
                updateTimerInContent(content, this.data.id, (data) => {
                    nextData = mutator(data);
                    return nextData;
                }),
            );
        } catch (error) {
            console.error('Timer: failed to update reading-view timer', error);
            new Notice('Failed to update timer.');
            return;
        }

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

        window.dispatchEvent(new CustomEvent(TIMER_MUTATED_EVENT));
    }

    private openMenu(event: MouseEvent) {
        const menu = new Menu();

        if (this.data.state === 'running') {
            menu.addItem((item) =>
                item.setTitle('Pause')
                    .setIcon('pause')
                    .onClick(() => void this.mutate((data) => pauseData(data, nowSec()))));
        } else {
            menu.addItem((item) =>
                item.setTitle(this.data.state === 'stopped' ? 'Start' : 'Resume')
                    .setIcon('play')
                    .onClick(() => void this.mutate((data) => resumeData(data, nowSec()))));
        }

        menu.addItem((item) =>
            item.setTitle('Stop')
                .setIcon('square')
                .onClick(() => void this.mutate((data) => stopData(data, nowSec()))));

        menu.addItem((item) =>
            item.setTitle('Reset')
                .setIcon('refresh-cw')
                .onClick(() => void this.mutate((data) => resetData(data, nowSec()))));

        menu.addItem((item) =>
            item.setTitle('Change time')
                .setIcon('clock')
                .onClick(() => {
                    const currentData = this.data;
                    const mutateFn = this.mutate.bind(this);
                    
                    setTimeout(() => {
                        try {
                            const next = promptForTimeChange(currentData);
                            if (next) void mutateFn(() => next);
                        } catch {
                            new Notice('Invalid time.');
                        }
                    }, 50);
                }));

        menu.addItem((item) =>
            item.setTitle('Delete')
                .setIcon('trash')
                .onClick(() => void this.mutate(() => null)));

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
    private timerMutatedRef: ((evt: Event) => void) | null = null;
    private enforcingLimit = false;

    async onload() {
        await this.loadSettings();
        this.registerEditorExtension(timerViewPlugin);

        await this.recoverRunningTimers();

        this.registerInterval(
            window.setInterval(() => {
                this.syncRegistryFromOpenEditors();
                this.settings.lastActiveTime = nowSec();
                void this.saveSettings();
            }, 30_000),
        );

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    void this.updateRegistryForFile(file);
                }
            }),
        );

        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                const i = this.settings.runningTimerFiles.indexOf(oldPath);
                if (i !== -1) {
                    this.settings.runningTimerFiles[i] = file.path;
                    void this.saveSettings();
                }
            }),
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                const i = this.settings.runningTimerFiles.indexOf(file.path);
                if (i !== -1) {
                    this.settings.runningTimerFiles.splice(i, 1);
                    void this.saveSettings();
                }
            }),
        );

        this.beforeUnloadRef = () => this.pauseOpenEditorsSync();
        window.addEventListener('beforeunload', this.beforeUnloadRef);

        this.timerMutatedRef = () => {
            this.syncRegistryFromOpenEditors();
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
                const re = new RegExp(TIMER_RE.source, 'g');
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
                    ctx.addChild(new TimerRenderChild(span, data, this.app, ctx.sourcePath));

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
                const matches = [...lineText.matchAll(new RegExp(TIMER_RE.source, 'g'))];

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
            hotkeys: [{ modifiers: ['Alt'], key: 's' }],
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'toggle', 'stopwatch'),
        });

        this.addCommand({
            id: 'toggle-countdown',
            name: 'Start/pause countdown',
            hotkeys: [{ modifiers: ['Alt'], key: 'c' }],
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'toggle', 'countdown'),
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
            id: 'change-timer-time',
            name: 'Change timer/countdown time',
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'change'),
        });

        this.addCommand({
            id: 'delete-timer',
            name: 'Delete timer',
            hotkeys: [{ modifiers: ['Alt'], key: 'd' }],
            editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'delete'),
        });

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (view instanceof MarkdownView) {
                    this.buildContextMenu(menu, editor, view);
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

    private async updateRegistryForFile(file: TFile) {
        try {
            const content = await this.app.vault.cachedRead(file);
            const hasRunning = /⏳\[[^\]]*\|running\|/.test(content);
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

    private syncRegistryFromOpenEditors() {
        const openState = new Map<string, boolean>();

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

        void this.saveSettings();
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Crash / unclean-exit recovery
     * ═══════════════════════════════════════════════════════════════ */

    private async recoverRunningTimers() {
        const tracked = [...(this.settings.runningTimerFiles ?? [])];
        if (tracked.length === 0) return;

        const ref = this.settings.lastActiveTime > 0 ? this.settings.lastActiveTime : nowSec();
        const counter = { count: 0 };

        for (const path of tracked) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;

            try {
                await this.app.vault.process(file, (content) => this.pauseTimersInContent(content, ref, counter));
            } catch (error) {
                console.error(`Timer: recovery failed for ${path}`, error);
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

    private pauseTimersInContent(content: string, refTime: number, counter?: { count: number }): string {
        return content.replace(
            new RegExp(TIMER_RE.source, 'g'),
            (...matchArgs) => {
                const data = extractTimerData(matchArgs as unknown as RegExpExecArray);
                if (data.state !== 'running') return matchArgs[0];
                if (counter) counter.count++;
                return render(pauseData(data, refTime));
            },
        );
    }

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

                replaceTimer(
                    editor,
                    i,
                    render(pauseData(p, ref)),
                    p.start,
                    p.end,
                );
            }
        });

        return handledPaths;
    }

    async saveAllRunningTimers(ref = nowSec()) {
        const handledPaths = this.pauseOpenEditorsSync(ref);

        for (const path of [...this.settings.runningTimerFiles]) {
            if (handledPaths.has(path)) continue;
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;

            try {
                await this.app.vault.process(file, (content) => this.pauseTimersInContent(content, ref));
            } catch (error) {
                console.error(`Timer: save failed for ${path}`, error);
            }
        }

        this.settings.runningTimerFiles = [];
        this.settings.lastActiveTime = ref;
        await this.saveSettings();
    }

    /* ═══════════════════════════════════════════════════════════════
     *  Core command handler
     * ═══════════════════════════════════════════════════════════════ */

    handleCommand(
        editor: Editor,
        view: MarkdownView,
        action: 'toggle' | 'delete' | 'stop' | 'reset' | 'change',
        createKind: TimerKind = 'stopwatch',
    ) {
        if ((view as { getMode?: () => string }).getMode?.() === 'preview') {
            new Notice('Switch to edit mode to use timers.');
            return;
        }

        const line = editor.getCursor().line;
        const parsed = parse(editor.getLine(line));

        if (!parsed) {
            if (action !== 'toggle') {
                new Notice('No timer found on current line.');
                return;
            }

            const defaultCountdown = Math.max(
                1,
                this.settings.defaultCountdownSeconds || DEFAULT_SETTINGS.defaultCountdownSeconds,
            );

            const data: TimerData = {
                id: generateId(),
                kind: createKind,
                state: 'running',
                elapsed: 0,
                startedAt: nowSec(),
                duration: createKind === 'countdown' ? defaultCountdown : 0,
            };

            insertTimer(editor, line, render(data), this.settings.insertPosition);
            this.refreshRegistryForEditor(editor, view);
            return;
        }

        if (action === 'delete') {
            removeTimer(editor, line, parsed.start, parsed.end);
            new Notice('Timer deleted');
            this.refreshRegistryForEditor(editor, view);
            return;
        }

        if (action === 'change') {
            setTimeout(() => {
                try {
                    const next = promptForTimeChange(parsed);
                    if (next) {
                        replaceTimer(editor, line, render(next), parsed.start, parsed.end);
                        this.refreshRegistryForEditor(editor, view);
                    }
                } catch {
                    new Notice('Invalid time.');
                }
            }, 50);
            return;
        }

        let next: TimerData;

        if (action === 'stop') {
            next = stopData(parsed, nowSec());
        } else if (action === 'reset') {
            next = resetData(parsed, nowSec());
        } else {
            next = parsed.state === 'running'
                ? pauseData(parsed, nowSec())
                : resumeData(parsed, nowSec());
        }

        replaceTimer(editor, line, render(next), parsed.start, parsed.end);
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
                item.setTitle('Start timer')
                    .setIcon('play')
                    .onClick(() => this.handleCommand(editor, view, 'toggle', 'stopwatch')));

            menu.addItem((item) =>
                item.setTitle('Start countdown')
                    .setIcon('timer')
                    .onClick(() => this.handleCommand(editor, view, 'toggle', 'countdown')));

            return;
        }

        if (parsed.state === 'running') {
            menu.addItem((item) =>
                item.setTitle('Pause')
                    .setIcon('pause')
                    .onClick(() => this.handleCommand(editor, view, 'toggle')));
        } else {
            menu.addItem((item) =>
                item.setTitle(parsed.state === 'stopped' ? 'Start' : 'Resume')
                    .setIcon('play')
                    .onClick(() => this.handleCommand(editor, view, 'toggle')));
        }

        menu.addItem((item) =>
            item.setTitle('Stop')
                .setIcon('square')
                .onClick(() => this.handleCommand(editor, view, 'stop')));

        menu.addItem((item) =>
            item.setTitle('Reset')
                .setIcon('refresh-cw')
                .onClick(() => this.handleCommand(editor, view, 'reset')));

        menu.addItem((item) =>
            item.setTitle('Change time')
                .setIcon('clock')
                .onClick(() => this.handleCommand(editor, view, 'change')));

        menu.addItem((item) =>
            item.setTitle('Delete')
                .setIcon('trash')
                .onClick(() => this.handleCommand(editor, view, 'delete')));
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

        new Setting(containerEl)
            .setName('Default countdown')
            .setDesc('Used by Alt+C. Use mm:ss, hh:mm:ss, or a whole number for minutes.')
            .addText((text) => {
                text.setPlaceholder('25:00');
                text.setValue(formatDuration(this.plugin.settings.defaultCountdownSeconds));

                const save = async () => {
                    const secs = parseDurationInput(text.inputEl.value);
                    if (secs === null || secs <= 0) {
                        new Notice('Invalid countdown.');
                        text.setValue(formatDuration(this.plugin.settings.defaultCountdownSeconds));
                        return;
                    }

                    this.plugin.settings.defaultCountdownSeconds = secs;
                    await this.plugin.saveSettings();
                    text.setValue(formatDuration(secs));
                };

                text.inputEl.addEventListener('blur', () => {
                    void save();
                });

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