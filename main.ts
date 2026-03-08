import { Plugin, MarkdownView, WorkspaceLeaf, Menu, Editor, Notice } from 'obsidian';
import { TagTimerSettings, TimerData } from './src/types';
import { CONSTANTS, LANG } from './src/constants';
import { TimerUtils } from './src/utils';
import { AnalyticsStore } from './src/analytics/store';
import { TimerAnalyticsView } from './src/analytics/view';
import { TimerDataUpdater } from './src/timer/data-updater';
import { TimerManager } from './src/timer/manager';
import { TimerFileManager } from './src/timer/file-manager';
import { TimerParser } from './src/timer/parser';
import { TimerSettingTab } from './src/settings';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Chart } from 'chart.js';

const DEFAULT_SETTINGS: TagTimerSettings = {
    autoStopTimers: 'never',
    timerInsertLocation: 'tail',
    timersState: {}
};

export default class TimerPlugin extends Plugin {
    manager!: TimerManager;
    default_settings!: TagTimerSettings;
    settings!: TagTimerSettings;
    analyticsStore!: AnalyticsStore;
    fileManager!: TimerFileManager;

    async onload() {
        this.manager = new TimerManager();
        this.default_settings = DEFAULT_SETTINGS;
        await this.loadSettings();

        const analyticsPath = this.app.vault.configDir + '/plugins/tag-timer/analytics.json';
        this.analyticsStore = new AnalyticsStore(this.app, CONSTANTS.RETENTION_DAYS, analyticsPath);
        this.fileManager = new TimerFileManager(this.app, this.settings);

        this.addCommand({
            id: 'toggle-timer',
            name: LANG.command_name.toggle,
            hotkeys: [{ modifiers: ["Mod", "Shift"], key: "t" }],
            editorCallback: (editor, view) => {
                const lineNum = editor.getCursor().line;
                const parsed = TimerParser.parse(editor.getLine(lineNum));
                if (parsed) {
                    const action = parsed.class === 'timer-r' ? 'pause' : 'continue';
                    this.handleTimerAction(action, view, lineNum, parsed);
                } else this.handleTimerAction('start', view, lineNum);
            }
        });

        this.registerEvent(this.app.workspace.on('editor-menu', this.onEditorMenu.bind(this)));
        this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
        this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));

        this.registerView(CONSTANTS.ANALYTICS_VIEW_TYPE, (leaf) => new TimerAnalyticsView(leaf));
        this.addRibbonIcon('pie-chart', 'Timer Analytics', () => this.activateView());
        this.addSettingTab(new TimerSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => {
            this.restoreAllTimers();
            Chart.register(ChartDataLabels);
        });
    }

    async onunload() {
        await this.flushRunningTimers();
        this.manager.clearAll();
        this.fileManager.clearLocations();
    }

    async handleTimerAction(action: string, view: MarkdownView | any, lineNum: number, parsedData: any = null) {
        if (view.getMode && view.getMode() === 'preview') { new Notice(LANG.notice.update_in_preview); return; }

        const now = TimerUtils.getCurrentTimestamp();
        let timerData: Partial<TimerData> | undefined;

        if (action === 'start') {
            timerData = TimerDataUpdater.calculate('init', {}, now);
            const newId = await this.fileManager.writeTimer(timerData.timerId as string, timerData, view, view.file, lineNum);
            this.manager.startTimer(newId, timerData as TimerData, this.tick.bind(this));
            return;
        }

        const timerId = parsedData?.timerId; if (!timerId) return;

        if (action === 'delete') {
            const editor = view.editor;
            editor.replaceRange('', { line: lineNum, ch: parsedData.beforeIndex }, { line: lineNum, ch: parsedData.afterIndex });
            this.manager.stopTimer(timerId); this.fileManager.locations.delete(timerId);
            this.cleanupTimerState(timerId); new Notice(LANG.notice.deleted); return;
        }

        timerData = TimerDataUpdater.calculate(action, parsedData, now);
        const { class: newClass, dur, ts } = timerData;
        if (dur === undefined || !ts) return; // safety

        if (['pause', 'forcepause'].includes(action)) {
            const ctx = await this.fileManager.getTimerContext(timerId);
            await this.logAnalyticsForLine(timerData, ctx.lineText, ctx.filePath);
            this.manager.stopTimer(timerId); this.cleanupTimerState(timerId);
            const success = await this.fileManager.updateTimer(timerId, timerData, { view, file: view.file, lineNum });
            if (!success) { this.manager.stopTimer(timerId); this.cleanupTimerState(timerId); }
        } else if (action === 'continue' || action === 'restore') {
            const success = await this.fileManager.updateTimer(timerId, timerData, { view, file: view.file, lineNum });
            if (success) this.manager.startTimer(timerId, timerData as TimerData, this.tick.bind(this));
            else { this.manager.stopTimer(timerId); this.cleanupTimerState(timerId); }
        }
    }

    async tick(timerId: string) {
        const old = this.manager.getTimerData(timerId); if (!old || old.class !== 'timer-r') return;
        const now = TimerUtils.getCurrentTimestamp();
        const updated = TimerDataUpdater.calculate('update', old, now);
        this.manager.updateTimerData(timerId, updated as TimerData);
        const success = await this.fileManager.updateTimer(timerId, updated);
        if (!success) { this.manager.stopTimer(timerId); this.cleanupTimerState(timerId); }
    }

    onFileOpen(file: any) {
        if (!file) {
            if (this.settings.autoStopTimers === 'close') {
                const views = this.app.workspace.getLeavesOfType('markdown');
                if (views.length === 0) this.flushRunningTimers();
            }
            return;
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file === file) this.restoreTimersInView(view);
    }

    onLayoutChange() {
        const openFiles = new Set<string>();
        this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
            if (leaf.view instanceof MarkdownView && leaf.view.file) openFiles.add(leaf.view.file.path);
        });
        for (const loc of this.fileManager.locations.values()) {
            if (loc.file?.path && !openFiles.has(loc.file.path)) {
                this.fileManager.clearLocationsForFile(loc.file.path);
            }
        }
    }

    restoreAllTimers() {
        this.app.workspace.getLeavesOfType('markdown').forEach(leaf => { if (leaf.view instanceof MarkdownView) this.restoreTimersInView(leaf.view); });
    }
    restoreTimersInView(view: any) {
        const editor = view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const parsed = TimerParser.parse(editor.getLine(i));
            if (parsed?.class === 'timer-r') {
                const { autoStopTimers } = this.settings;
                const shouldRestore = autoStopTimers === 'never' || (autoStopTimers === 'quit' && this.manager.isStartedInThisSession(parsed.timerId));
                this.handleTimerAction(shouldRestore ? 'restore' : 'forcepause', view, i, parsed);
            }
        }
    }
    async flushRunningTimers() {
        if (this.settings.autoStopTimers === 'never') return; // Avoid double counting across sessions
        const now = TimerUtils.getCurrentTimestamp();
        for (const [timerId, data] of this.manager.getAllTimers()) {
            if (data?.class !== 'timer-r') continue;
            const paused = TimerDataUpdater.calculate('pause', data, now);
            const ctx = await this.fileManager.getTimerContext(timerId);
            await this.logAnalytics(paused as TimerData, ctx.lineText, ctx.filePath);
            this.manager.stopTimer(timerId);
        }
    }

    getAnalyticsPath(): string { return this.app.vault.configDir + '/plugins/tag-timer/analytics.json'; }
    async logAnalyticsForLine(timerData: Partial<TimerData>, lineText: string, filePath: string) { await this.logAnalytics(timerData, lineText, filePath); }
    async logAnalytics(timerData: Partial<TimerData>, lineText: string, filePath: string) {
        const { timerId, dur } = timerData; if (!timerId || typeof dur !== 'number') return;
        this.settings.timersState ||= {}; const lastLogged = this.settings.timersState[timerId] || 0; const increment = dur - lastLogged; if (increment <= 0) return;
        const tags = lineText.match(CONSTANTS.REGEX.HASHTAGS) || [];
        try {
            await this.analyticsStore.append({ timestamp: new Date().toISOString(), duration: increment, file: filePath, tags });
            this.settings.timersState[timerId] = dur; await this.saveSettings();
        } catch (e) { console.error("Error writing analytics data:", e); }
    }
    cleanupTimerState(timerId: string) { if (this.settings.timersState?.[timerId]) { delete this.settings.timersState[timerId]; this.saveSettings(); } }

    onEditorMenu(menu: Menu, editor: Editor, view: MarkdownView) {
        const lineNum = editor.getCursor().line; const parsed = TimerParser.parse(editor.getLine(lineNum));
        const items = parsed ? this.getRunningMenuItems(parsed) : this.getNewTimerMenuItems();
        items.forEach(item => { menu.addItem(mi => mi.setTitle(item.title).setIcon(item.icon).onClick(() => item.action(view, lineNum, parsed))); });
    }
    getRunningMenuItems(parsed: any) {
        const items: any[] = [];
        if (parsed.class === 'timer-r') items.push({ title: LANG.action_paused, icon: 'pause', action: (view: any, lineNum: number, p: any) => this.handleTimerAction('pause', view, lineNum, p) });
        else items.push({ title: LANG.action_continue, icon: 'play', action: (view: any, lineNum: number, p: any) => this.handleTimerAction('continue', view, lineNum, p) });
        items.push({ title: LANG.command_name.delete, icon: 'trash', action: (view: any, lineNum: number, p: any) => this.handleTimerAction('delete', view, lineNum, p) });
        return items;
    }
    getNewTimerMenuItems() { return [{ title: LANG.action_start, icon: 'play', action: (view: any, lineNum: number) => this.handleTimerAction('start', view, lineNum) }]; }

    async loadSettings() { this.settings = Object.assign({}, this.default_settings, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); if (this.fileManager) this.fileManager.settings = this.settings; }
    async updateSetting(key: keyof TagTimerSettings, value: any) { this.settings[key] = value as never; await this.saveSettings(); if (key === 'timerInsertLocation' && this.fileManager) this.fileManager.settings = this.settings; }

    async activateView(showWeekly = false) {
        const leaves = this.app.workspace.getLeavesOfType(CONSTANTS.ANALYTICS_VIEW_TYPE);
        let leaf = leaves[0];
        if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) as WorkspaceLeaf; await leaf.setViewState({ type: CONSTANTS.ANALYTICS_VIEW_TYPE, active: true }); }
        else { this.app.workspace.revealLeaf(leaf); }
        if (leaf.view instanceof TimerAnalyticsView) {
            leaf.view.analyticsStore = this.analyticsStore; leaf.view.showWeekly = showWeekly; leaf.view.onOpen();
        }
    }
}