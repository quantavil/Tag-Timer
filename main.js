'use strict';

const obsidian = require('obsidian');

/* ------------------------------ Constants & Lang ------------------------------ */

const CONSTANTS = {
    UPDATE_INTERVAL_MS: 1000, // 1s tick
    BASE62_CHARS: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    RETENTION_DAYS: 30,
    ANALYTICS_VIEW_TYPE: "timer-analytics-view",
    // Drift protection: cap per-step accrual and ignore long gaps (sleep/hibernation/restart)
    MAX_UPDATE_STEP_SEC: 5,      // cap a single accrual step to <= 5s
    SLEEP_GAP_SEC: 60,           // treat gaps > 60s as "sleep" (add 0s; reset timestamp)
    REGEX: {
        ORDERED_LIST: /(^\s*>?\s*\d+\.\s)/,
        UNORDERED_LIST: /(^\s*>?\s*[-+*]\s)/,
        HEADER: /(^\s*#+\s)/,
        TIMER_SPAN: /<span class="timer-[rp]"[^>]*>.*?<\/span>/,
        NEW_FORMAT: /<span class="(timer-r|timer-p)" id="([^"]+)" data-dur="(\d+)" data-ts="(\d+)">.*?<\/span>/g,
        HASHTAGS: /#\w+/g
    }
};

const LANG = {
    command_name: { toggle: "Toggle timer", delete: "Delete timer" },
    action_start: "Start timer", action_paused: "Pause timer", action_continue: "Continue timer",
    settings: {
        name: "Tag timer settings", desc: "Configure timer behavior",
        tutorial: "For detailed instructions, visit: ",
        askforvote: "If you find this plugin helpful, please consider giving it a star on GitHub!🌟",
        issue: "If you encounter any issues, please report them on GitHub along with version and steps to reproduce.",
        sections: { basic: { name: "Basic settings" } },
        autostop: {
            name: "Auto-stop timers", desc: "When to automatically stop running timers",
            choice: { never: "Never", quit: "On Obsidian quit", close: "On file close" }
        },
        insertlocation: {
            name: "Timer insert location",
            desc: "End of line recommended if you use Day Planner Plugin as well.",
            choice: { head: "Beginning of line", tail: "End of line", cursor: "At cursor" }
        }
    }
};

/* ------------------------------ Utilities ------------------------------ */

class TimerUtils {
    static compressId(timestamp = Date.now()) {
        if (timestamp === 0) return 't0';
        let num = timestamp, result = '';
        while (num > 0) { result = CONSTANTS.BASE62_CHARS[num % 62] + result; num = Math.floor(num / 62); }
        return result;
    }
    static formatDuration(totalSeconds) {
        if (!totalSeconds || totalSeconds <= 0) return '0s';
        const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = Math.floor(totalSeconds % 60);
        const parts = []; if (h) parts.push(`${h}h`); if (m) parts.push(`${m}m`); if (s) parts.push(`${s}s`); return parts.join(' ');
    }
    static formatTagLabel(tag) { return tag.startsWith('#') ? tag.slice(1) : tag; }
    static formatTimeDisplay(totalSeconds) {
        const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(totalSeconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
    static getCurrentTimestamp() { return Math.floor(Date.now() / 1000); }
    static startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
    static endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
    static startOfWeekMonday(d) {
        const x = new Date(d); const day = x.getDay(); const diff = x.getDate() - day + (day === 0 ? -6 : 1);
        x.setDate(diff); x.setHours(0, 0, 0, 0); return x;
    }
    static endOfWeekMonday(d) { const s = TimerUtils.startOfWeekMonday(d); const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999); return e; }
    static formatMMMDD(input) { const d = (typeof input === 'string') ? new Date(input) : input; const month = d.toLocaleString('en-US', { month: 'short' }); const day = String(d.getDate()).padStart(2, '0'); return `${month}-${day}`; }
}

/* ------------------------------ Analytics Store ------------------------------ */

class AnalyticsStore {
    constructor(app, retentionDays, path) { this.app = app; this.retentionDays = retentionDays; this.path = path; }
    getCutoffTime() { return Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000); }
    static isInRange(tsISO, start, end) { const t = new Date(tsISO).getTime(); return t >= start.getTime() && t <= end.getTime(); }
    static anchorISO(date) { const d = TimerUtils.startOfDay(date); d.setHours(12, 0, 0, 0); return d.toISOString(); }
    async readRaw() { try { const raw = await this.app.vault.adapter.read(this.path); return raw ? JSON.parse(raw) : []; } catch (_) { return []; } }
    async writeAll(list) { await this.app.vault.adapter.write(this.path, JSON.stringify(list, null, 2)); }
    async readAll() { const data = await this.readRaw(); const cutoff = this.getCutoffTime(); return data.filter(e => new Date(e.timestamp).getTime() >= cutoff); }
    async append(entry) { const all = await this.readRaw(); all.push(entry); await this.writeAll(all); }
    async prune() { const all = await this.readRaw(); const cutoff = this.getCutoffTime(); const pruned = all.filter(e => new Date(e.timestamp).getTime() >= cutoff); if (pruned.length !== all.length) await this.writeAll(pruned); }
    async loadForCharts() { return this.readAll(); }
    async sumTagInRange(tag, start, end) {
        const all = await this.readAll();
        const sum = all.filter(e => e.tags?.includes(tag) && AnalyticsStore.isInRange(e.timestamp, start, end)).reduce((s, e) => s + (e.duration || 0), 0);
        return Math.max(0, sum);
    }
    async setTagTotalForPeriod(tag, newTotal, { start, end }, anchorDate) {
        const safeNew = Math.max(0, Math.floor(Number(newTotal) || 0));
        const current = await this.sumTagInRange(tag, start, end);
        const delta = safeNew - current; if (delta === 0) return;
        const entry = { timestamp: AnalyticsStore.anchorISO(anchorDate), duration: delta, file: "manual-edit", tags: [tag], type: "adjust" };
        await this.append(entry);
    }
}

/* ------------------------------ Timer Engine ------------------------------ */

class TimerDataUpdater {
    static elapsedCapped(oldData, now) {
        const gap = Math.max(0, now - (oldData?.ts || now));
        if (gap > CONSTANTS.SLEEP_GAP_SEC) return 0;                     // sleep/hibernation/restart -> ignore
        return Math.min(gap, CONSTANTS.MAX_UPDATE_STEP_SEC);             // cap accrual per step
    }
    static calculate(action, oldData = {}, now = TimerUtils.getCurrentTimestamp()) {
        switch (action) {
            case 'init': return { class: 'timer-r', timerId: TimerUtils.compressId(), dur: 0, ts: now };
            case 'continue': return { ...oldData, class: 'timer-r', ts: now }; // no backfill
            case 'pause': return { ...oldData, class: 'timer-p', dur: (oldData.dur || 0) + TimerDataUpdater.elapsedCapped(oldData, now), ts: now };
            case 'update': return (oldData.class !== 'timer-r') ? oldData : { ...oldData, dur: (oldData.dur || 0) + TimerDataUpdater.elapsedCapped(oldData, now), ts: now };
            case 'restore': return { ...oldData, class: 'timer-r', ts: now }; // do NOT add elapsed on restore
            case 'forcepause': return { ...oldData, class: 'timer-p' };
            default: return oldData;
        }
    }
}

class TimerManager {
    constructor() { this.timers = new Map(); this.startedIds = new Set(); }
    startTimer(timerId, initialData, tick) {
        if (this.timers.has(timerId)) return;
        // Fix: Use window.setInterval
        const intervalId = window.setInterval(() => tick(timerId), CONSTANTS.UPDATE_INTERVAL_MS);
        this.timers.set(timerId, { intervalId, data: initialData }); this.startedIds.add(timerId);
    }
    stopTimer(timerId) { 
        const item = this.timers.get(timerId); 
        if (!item) return; 
        // Fix: Use window.clearInterval
        window.clearInterval(item.intervalId); 
        this.timers.delete(timerId); 
    }
    updateTimerData(timerId, data) { const item = this.timers.get(timerId); if (item) item.data = data; }
    getTimerData(timerId) { return this.timers.get(timerId)?.data || null; }
    hasTimer(timerId) { return this.timers.has(timerId); }
    isStartedInThisSession(timerId) { return this.startedIds.has(timerId); }
    getAllTimers() { return new Map(Array.from(this.timers.entries()).map(([id, t]) => [id, t.data])); }
    clearAll() { 
        // Fix: Use window.clearInterval
        this.timers.forEach(t => window.clearInterval(t.intervalId)); 
        this.timers.clear(); this.startedIds.clear(); 
    }
}

/* ------------------------------ File Manager ------------------------------ */

class TimerFileManager {
    constructor(app, settings) { this.app = app; this.settings = settings; this.locations = new Map(); }
    async getLineText(view, file, lineNum) {
        return view.getMode && view.getMode() === 'source' ? view.editor.getLine(lineNum) : (await this.app.vault.read(file)).split('\n')[lineNum] || '';
    }
    async writeTimer(timerId, timerData, view, file, lineNum, parsedResult = null) {
        const newSpan = TimerRenderer.render(timerData);
        if (view.getMode && view.getMode() === 'preview') await this.writeTimerPreview(file, lineNum, newSpan, parsedResult);
        else this.writeTimerSource(view.editor, lineNum, newSpan, parsedResult, timerId);
        this.locations.set(timerId, { view, file, lineNum }); return timerId;
    }
    async writeTimerPreview(file, lineNum, newSpan, parsedResult) {
        // Fix: Use Vault.process for atomic updates instead of modify
        await this.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            const line = lines[lineNum] ?? '';
            
            if (line.match(CONSTANTS.REGEX.TIMER_SPAN)) {
                lines[lineNum] = line.replace(CONSTANTS.REGEX.TIMER_SPAN, newSpan);
            } else if (parsedResult === null) {
                const position = this.calculateInsertPosition({ getLine: () => line }, 0, this.settings.timerInsertLocation);
                lines[lineNum] = this.insertSpanAtPosition(line, newSpan, position);
            }
            return lines.join('\n');
        });
    }
    writeTimerSource(editor, lineNum, newSpan, parsedResult, timerId) {
        let before, after;
        if (parsedResult?.timerId === timerId) { before = parsedResult.beforeIndex; after = parsedResult.afterIndex; }
        else { const pos = this.calculateInsertPosition(editor, lineNum, this.settings.timerInsertLocation); before = pos.before; after = pos.after; newSpan = ' ' + newSpan; }
        editor.replaceRange(newSpan, { line: lineNum, ch: before }, { line: lineNum, ch: after });
    }
    insertSpanAtPosition(line, span, pos) { if (pos.before === 0) return `${span} ${line}`; if (pos.before === line.length) return `${line} ${span}`; return `${line.substring(0, pos.before)} ${span} ${line.substring(pos.before)}`; }
    async updateTimer(timerId, timerData, location = null) {
        const loc = location || this.locations.get(timerId); if (!loc?.view?.file) return true;
        const { view, file, lineNum } = loc; const lineText = await this.getLineText(view, file, lineNum); const parsed = TimerParser.parse(lineText, timerId);
        if (parsed) { await this.writeTimer(timerId, timerData, view, file, lineNum, parsed); return true; }
        const found = await this.findTimerGlobally(timerId);
        if (found) { await this.writeTimer(timerId, timerData, found.view, found.file, found.lineNum, found.parsed); return true; }
        console.warn(`Timer ${timerId} not found, stopping timer.`); return false;
    }
    async findTimerGlobally(timerId) {
        const loc = this.locations.get(timerId); if (!loc) return null; const { view, file } = loc;
        const search = (view.getMode && view.getMode() === 'source') ? this.searchInEditor.bind(this) : this.searchInFile.bind(this);
        return await search(view, file, timerId);
    }
    async searchInEditor(view, file, timerId) { const editor = view.editor; for (let i = 0; i < editor.lineCount(); i++) { const parsed = TimerParser.parse(editor.getLine(i), timerId); if (parsed?.timerId === timerId) return { view, file, lineNum: i, parsed }; } return null; }
    async searchInFile(view, file, timerId) { const content = await this.app.vault.read(file); const lines = content.split('\n'); for (let i = 0; i < lines.length; i++) { const parsed = TimerParser.parse(lines[i], timerId); if (parsed?.timerId === timerId) return { view, file, lineNum: i, parsed }; } return null; }
    calculateInsertPosition(editor, lineNum, insertLocation) {
        const lineText = editor.getLine(lineNum) || '';
        if (insertLocation === 'cursor' && editor.getCursor) { const cursor = editor.getCursor(); return { before: cursor.ch, after: cursor.ch }; }
        if (insertLocation === 'head') return this.findHeadPosition(lineText);
        if (insertLocation === 'tail') return { before: lineText.length, after: lineText.length };
        return { before: 0, after: 0 };
    }
    findHeadPosition(lineText) { const patterns = [CONSTANTS.REGEX.ORDERED_LIST, CONSTANTS.REGEX.UNORDERED_LIST, CONSTANTS.REGEX.HEADER]; for (const p of patterns) { const m = p.exec(lineText); if (m) return { before: m[0].length, after: m[0].length }; } return { before: 0, after: 0 }; }
    clearLocations() { this.locations.clear(); }
    async getTimerContext(timerId) {
        const loc = this.locations.get(timerId); if (!loc?.file) return { lineText: '', filePath: '' };
        const { file, lineNum } = loc; let lineText = ''; try { const content = await this.app.vault.read(file); lineText = (content.split('\n')[lineNum]) || ''; } catch (_) { }
        return { lineText, filePath: file.path };
    }
}

/* ------------------------------ Timer Rendering & Parsing ------------------------------ */

class TimerRenderer {
    static render(d) {
        const formatted = TimerUtils.formatTimeDisplay(d.dur);
        const icon = (d.class === 'timer-r') ? (d.dur % 2 === 0 ? '⌛' : '⏳') : '⏳';
        return `<span class="${d.class}" id="${d.timerId}" data-dur="${d.dur}" data-ts="${d.ts}">【${icon}${formatted} 】</span>`;
    }
}

class TimerParser {
    static parse(lineText, targetTimerId = null) {
        const regex = new RegExp(CONSTANTS.REGEX.NEW_FORMAT.source, 'g'); let match;
        while ((match = regex.exec(lineText)) !== null) {
            const id = match[2]; if (!targetTimerId || targetTimerId === id) {
                return { class: match[1], timerId: id, dur: parseInt(match[3], 10), ts: parseInt(match[4], 10), beforeIndex: match.index, afterIndex: match.index + match[0].length };
            }
        }
        return null;
    }
}

/* ------------------------------ Plugin Core ------------------------------ */

class TimerPlugin extends obsidian.Plugin {
    async onload() {
        this.manager = new TimerManager();
        this.default_settings = { autoStopTimers: 'quit', timerInsertLocation: 'cursor', timersState: {} };
        await this.loadSettings();
        this.analyticsStore = new AnalyticsStore(this.app, CONSTANTS.RETENTION_DAYS, this.getAnalyticsPath());
        this.fileManager = new TimerFileManager(this.app, this.settings);
        await this.analyticsStore.prune();
        this.setupCommands(); this.setupEventHandlers(); this.setupAnalyticsView();
    }
    async onunload() { try { await this.flushRunningTimers(); } catch (_) { } this.manager.clearAll(); this.fileManager.clearLocations(); }

    /* Commands & UI */
    setupCommands() {
        this.addCommand({
            id: 'toggle-timer', icon: 'alarm-clock', name: LANG.command_name.toggle,
            editorCallback: (editor, view) => {
                const lineNum = editor.getCursor().line; const parsed = TimerParser.parse(editor.getLine(lineNum));
                if (parsed) { const action = parsed.class === 'timer-r' ? 'pause' : 'continue'; this.handleTimerAction(action, view, lineNum, parsed); }
                else this.handleTimerAction('start', view, lineNum);
            },
        });
        this.addCommand({
            id: 'delete-timer', icon: 'trash', name: LANG.command_name.delete,
            editorCallback: (editor, view) => { const lineNum = editor.getCursor().line; const parsed = TimerParser.parse(editor.getLine(lineNum)); if (parsed) this.handleTimerAction('delete', view, lineNum, parsed); },
        });
        // Fix: Sentence case
        this.addCommand({ id: 'open-timer-analytics', name: 'Open timer analytics', callback: () => this.activateView(false) });
    }
    setupEventHandlers() {
        this.registerEvent(this.app.workspace.on('editor-menu', this.onEditorMenu.bind(this)));
        this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
        this.app.workspace.onLayoutReady(() => this.restoreAllTimers());
    }
    setupAnalyticsView() {
        this.registerView(CONSTANTS.ANALYTICS_VIEW_TYPE, (leaf) => new TimerAnalyticsView(leaf));
        // Fix: Sentence case
        this.addRibbonIcon("pie-chart", "Open timer analytics", () => this.activateView());
        this.addSettingTab(new TimerSettingTab(this.app, this));
    }

    /* Timer Actions */
    async handleTimerAction(action, view, lineNum, parsedData = null) {
        const start = async () => {
            const d = TimerDataUpdater.calculate('init', {}); this.manager.startTimer(d.timerId, d, this.onTick.bind(this));
            return this.fileManager.writeTimer(d.timerId, d, view, view.file, lineNum, null);
        };
        const cont = async () => {
            if (!parsedData?.timerId) return; const cur = this.manager.getTimerData(parsedData.timerId) || parsedData;
            const d = TimerDataUpdater.calculate('continue', cur); this.manager.startTimer(parsedData.timerId, d, this.onTick.bind(this));
            return this.fileManager.writeTimer(parsedData.timerId, d, view, view.file, lineNum, parsedData);
        };
        const pause = async () => {
            if (!parsedData?.timerId) return; const cur = this.manager.getTimerData(parsedData.timerId) || parsedData;
            const d = TimerDataUpdater.calculate('pause', cur); this.manager.stopTimer(parsedData.timerId);
            await this.fileManager.writeTimer(parsedData.timerId, d, view, view.file, lineNum, parsedData);
            this.logAnalyticsForLine(d, view.editor.getLine(lineNum), view.file.path);
        };
        const del = async () => {
            if (!parsedData?.timerId) return; this.manager.stopTimer(parsedData.timerId);
            this.fileManager.locations.delete(parsedData.timerId);
            if (view.getMode && view.getMode() === 'source') view.editor.replaceRange('', { line: lineNum, ch: parsedData.beforeIndex }, { line: lineNum, ch: parsedData.afterIndex });
            this.logAnalyticsForLine(parsedData, view.editor.getLine(lineNum), view.file.path);
            this.cleanupTimerState(parsedData.timerId);
        };
        const restore = async () => {
            if (!parsedData?.timerId) return; const d = TimerDataUpdater.calculate('restore', parsedData);
            this.manager.startTimer(parsedData.timerId, d, this.onTick.bind(this));
            await this.fileManager.writeTimer(parsedData.timerId, d, view, view.file, lineNum, parsedData);
        };
        const forcepause = async () => {
            if (!parsedData?.timerId) return; const d = TimerDataUpdater.calculate('forcepause', parsedData);
            await this.fileManager.writeTimer(parsedData.timerId, d, view, view.file, lineNum, parsedData);
        };
        const map = { start, continue: cont, pause, delete: del, restore, forcepause };
        return map[action]?.();
    }

    async onTick(timerId) {
        const old = this.manager.getTimerData(timerId); if (!old || old.class !== 'timer-r') return;
        const d = TimerDataUpdater.calculate('update', old); this.manager.updateTimerData(timerId, d);
        const updated = await this.fileManager.updateTimer(timerId, d);
        if (!updated) {
            if (this.settings.autoStopTimers === 'close') {
                const ctx = await this.fileManager.getTimerContext(timerId);
                await this.logAnalytics(d, ctx.lineText, ctx.filePath);
            }
            this.manager.stopTimer(timerId); this.fileManager.locations.delete(timerId); this.cleanupTimerState(timerId);
        }
    }

    /* Lifecycle Helpers */
    async onFileOpen(file) {
        const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view?.file === file) this.restoreTimersInView(view);
    }
    restoreAllTimers() {
        this.app.workspace.getLeavesOfType('markdown').forEach(leaf => { if (leaf.view instanceof obsidian.MarkdownView) this.restoreTimersInView(leaf.view); });
    }
    restoreTimersInView(view) {
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
            await this.logAnalytics(paused, ctx.lineText, ctx.filePath);
            this.manager.stopTimer(timerId);
        }
    }

    /* Analytics */
    getAnalyticsPath() { return this.app.vault.configDir + '/plugins/tag-timer/analytics.json'; }
    async logAnalyticsForLine(timerData, lineText, filePath) { await this.logAnalytics(timerData, lineText, filePath); }
    async logAnalytics(timerData, lineText, filePath) {
        const { timerId, dur } = timerData; if (!timerId) return;
        this.settings.timersState ||= {}; const lastLogged = this.settings.timersState[timerId] || 0; const increment = dur - lastLogged; if (increment <= 0) return;
        const tags = lineText.match(CONSTANTS.REGEX.HASHTAGS) || [];
        try {
            await this.analyticsStore.append({ timestamp: new Date().toISOString(), duration: increment, file: filePath, tags });
            this.settings.timersState[timerId] = dur; await this.saveSettings();
        } catch (e) { console.error("Error writing analytics data:", e); }
    }
    cleanupTimerState(timerId) { if (this.settings.timersState?.[timerId]) { delete this.settings.timersState[timerId]; this.saveSettings(); } }

    /* Menu */
    onEditorMenu(menu, editor, view) {
        const lineNum = editor.getCursor().line; const parsed = TimerParser.parse(editor.getLine(lineNum));
        const items = parsed ? this.getRunningMenuItems(parsed) : this.getNewTimerMenuItems();
        items.forEach(item => { menu.addItem(mi => mi.setTitle(item.title).setIcon(item.icon).onClick(() => item.action(view, lineNum, parsed))); });
    }
    getRunningMenuItems(parsed) {
        const items = [];
        if (parsed.class === 'timer-r') items.push({ title: LANG.action_paused, icon: 'pause', action: (view, lineNum, p) => this.handleTimerAction('pause', view, lineNum, p) });
        else items.push({ title: LANG.action_continue, icon: 'play', action: (view, lineNum, p) => this.handleTimerAction('continue', view, lineNum, p) });
        items.push({ title: LANG.command_name.delete, icon: 'trash', action: (view, lineNum, p) => this.handleTimerAction('delete', view, lineNum, p) });
        return items;
    }
    getNewTimerMenuItems() { return [{ title: LANG.action_start, icon: 'play', action: (view, lineNum) => this.handleTimerAction('start', view, lineNum) }]; }

    /* Settings */
    async loadSettings() { this.settings = Object.assign({}, this.default_settings, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); if (this.fileManager) this.fileManager.settings = this.settings; }
    async updateSetting(key, value) { this.settings[key] = value; await this.saveSettings(); if (key === 'timerInsertLocation' && this.fileManager) this.fileManager.settings = this.settings; }

    /* Analytics View Activation */
    async activateView(showWeekly = false) {
        const leaves = this.app.workspace.getLeavesOfType(CONSTANTS.ANALYTICS_VIEW_TYPE);
        let leaf = leaves[0];
        if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: CONSTANTS.ANALYTICS_VIEW_TYPE, active: true }); }
        else { this.app.workspace.revealLeaf(leaf); }
        if (leaf.view instanceof TimerAnalyticsView) {
            leaf.view.analyticsStore = this.analyticsStore; leaf.view.showWeekly = showWeekly; leaf.view.onOpen();
        }
    }
}

/* ------------------------------ Settings Tab ------------------------------ */

class TimerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    display() {
        const { containerEl } = this; containerEl.empty(); const lang = LANG.settings;
        // Fix: Use setHeading instead of h1
        new obsidian.Setting(containerEl).setName(lang.name).setHeading();
        containerEl.createEl('p', { text: lang.desc });
        const tutorial = containerEl.createDiv({ cls: 'tutorial-info' }); const p = tutorial.createEl('p');
        p.appendText(lang.tutorial); p.createEl('a', { text: 'GitHub', href: 'https://github.com/quantavil/tag-timer', target: '_blank' });
        containerEl.createEl('p', { text: lang.askforvote }); containerEl.createEl('p', { text: lang.issue });
        
        // Fix: Use setHeading instead of h3
        new obsidian.Setting(containerEl).setName(lang.sections.basic.name).setHeading();

        new obsidian.Setting(containerEl)
            .setName(lang.autostop.name).setDesc(lang.autostop.desc)
            .addDropdown(dd => dd.addOption('never', lang.autostop.choice.never).addOption('quit', lang.autostop.choice.quit).addOption('close', lang.autostop.choice.close)
                .setValue(this.plugin.settings.autoStopTimers).onChange(async v => this.plugin.updateSetting('autoStopTimers', v)));

        new obsidian.Setting(containerEl)
            .setName(lang.insertlocation.name).setDesc(lang.insertlocation.desc)
            .addDropdown(dd => dd.addOption('head', lang.insertlocation.choice.head).addOption('tail', lang.insertlocation.choice.tail).addOption('cursor', lang.insertlocation.choice.cursor)
                .setValue(this.plugin.settings.timerInsertLocation).onChange(async v => this.plugin.updateSetting('timerInsertLocation', v)));
    }
}

/* ------------------------------ Analytics Charts ------------------------------ */

class TimerChartManager {
    constructor(app, view) { this.app = app; this.view = view; }
    createBarChartCard(chartGrid, analytics) {
        const barCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        const header = barCard.createDiv({ cls: "analytics-card-header" });
        const titleGroup = header.createDiv({ cls: "analytics-title-group" });
        const leftArrow = titleGroup.createEl("button", { cls: "analytics-arrow", text: "<" });
        titleGroup.createEl("h3", { text: "Analytics", cls: "analytics-title" });
        const rightArrow = titleGroup.createEl("button", { cls: "analytics-arrow", text: ">" });
        const controls = header.createDiv({ cls: "analytics-controls" });
        // Fix: Sentence case
        const toggleButton = controls.createEl("button", { text: this.view.showWeekly ? "Show daily" : "Show weekly", cls: "analytics-toggle-button" });
        toggleButton.addEventListener('click', () => { this.view.showWeekly = !this.view.showWeekly; this.view.onOpen(); });
        leftArrow.addEventListener('click', () => { const d = new Date(this.view.anchorDate); d.setDate(d.getDate() - (this.view.showWeekly ? 7 : 1)); this.view.anchorDate = d; this.view.onOpen(); });
        rightArrow.addEventListener('click', () => {
            const next = new Date(this.view.anchorDate); next.setDate(next.getDate() + (this.view.showWeekly ? 7 : 1));
            if (TimerUtils.startOfDay(next) <= TimerUtils.startOfDay(new Date())) { this.view.anchorDate = next; this.view.onOpen(); }
        });
        const barCanvas = barCard.createDiv({ cls: "canvas-container" }).createEl("canvas");
        this.createBarChart(barCanvas, analytics);
    }
    createDoughnutChartCard(chartGrid, analytics) {
        if (this.view.showWeekly) {
            const barCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
            const { start } = this.view.getPeriodRange();
            barCard.createEl("h3", { text: `Weekly Focus (Starting ${TimerUtils.formatMMMDD(start)})` });
            const canvas = barCard.createDiv({ cls: "canvas-container" }).createEl("canvas");
            this.createDailyBarChart(canvas, analytics);
            return;
        }
        const doughnutCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        doughnutCard.createEl("h3", { text: `Focus (${TimerUtils.formatMMMDD(this.view.anchorDate)})` });
        const doughnutCanvas = doughnutCard.createDiv({ cls: "canvas-container" }).createEl("canvas");
        this.createDoughnutChart(doughnutCanvas, analytics);
    }

    filterByPeriod(analytics) {
        const { start, end } = this.view.getPeriodRange(); const s = start.getTime(), e = end.getTime();
        return analytics.filter(a => { const t = new Date(a.timestamp).getTime(); return t >= s && t <= e; });
    }
    calculateTagTotals(list) {
        const totals = {}; list.forEach(entry => (entry.tags || []).forEach(tag => { totals[tag] = (totals[tag] || 0) + entry.duration; })); return totals;
    }
    getBaseChartOptions() {
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        return {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: { label: (ctx) => `${ctx.label}: ${TimerUtils.formatDuration(ctx.raw)}` },
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: text, bodyColor: text, borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)', borderWidth: 1
                },
                legend: { labels: { color: text } }
            }
        };
    }
    createChart(canvas, type, data, specificOptions = {}, plugins = []) {
        const base = this.getBaseChartOptions(); const options = { ...base, ...specificOptions, plugins: { ...base.plugins, ...specificOptions.plugins } };
        return new Chart(canvas.getContext('2d'), { type, data, options, plugins });
    }
    createGradient(canvas, axis = 'x') {
        return (ctx) => {
            const chart = ctx.chart; const { ctx: c, chartArea } = chart; if (!chartArea) return null;
            const isDark = document.body.classList.contains('theme-dark');
            const grad = axis === 'y' ? c.createLinearGradient(chartArea.left, 0, chartArea.right, 0) : c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            if (isDark) { grad.addColorStop(0, 'rgba(54, 162, 235, 0.8)'); grad.addColorStop(1, 'rgba(153, 102, 255, 0.8)'); }
            else { grad.addColorStop(0, 'rgba(54, 162, 235, 0.7)'); grad.addColorStop(1, 'rgba(153, 102, 255, 0.7)'); }
            return grad;
        };
    }

    createBarChart(canvas, analytics) {
        const periodData = this.filterByPeriod(analytics);
        const tagTotals = this.calculateTagTotals(periodData);
        const sorted = Object.entries(tagTotals).filter(([, sec]) => sec > 0).sort(([, a], [, b]) => b - a);
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        const isOutside = (ctx) => { const value = ctx.dataset.data[ctx.dataIndex]; const max = Math.max(...ctx.dataset.data); return (value / max) * 100 < 20; };
        const chartData = {
            labels: sorted.map(([tag]) => TimerUtils.formatTagLabel(tag)),
            datasets: [{
                // Fix: Sentence case
                label: 'Total time',
                data: sorted.map(([, sec]) => sec),
                backgroundColor: this.createGradient(canvas, 'y'),
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                borderWidth: 1, borderRadius: 6, hoverBackgroundColor: isDark ? 'rgba(54, 162, 235, 1)' : 'rgba(54, 162, 235, 0.9)'
            }]
        };
        const options = {
            indexAxis: 'y',
            scales: {
                x: { display: false, grid: { display: false } },
                y: { ticks: { color: text, font: { size: 14 } }, grid: { display: false } }
            },
            plugins: {
                legend: { display: false }, tooltip: { enabled: false },
                datalabels: {
                    anchor: 'end', align: (ctx) => isOutside(ctx) ? 'end' : 'start', color: text, font: { size: 14, weight: 'bold' },
                    formatter: (v) => `${TimerUtils.formatDuration(v)}  `, offset: (ctx) => isOutside(ctx) ? 4 : -4,
                }
            }
        };
        const chart = this.createChart(canvas, 'bar', chartData, options);
        this.addChartContextMenu(canvas, chart, sorted);
    }

    createDailyBarChart(canvas, analytics) {
        const { start } = this.view.getPeriodRange();
        const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
        const period = this.filterByPeriod(analytics);
        const totals = days.map(day => {
            const s = TimerUtils.startOfDay(day).getTime(), e = TimerUtils.endOfDay(day).getTime();
            return period.filter(a => { const t = new Date(a.timestamp).getTime(); return t >= s && t <= e; }).reduce((sum, a) => sum + a.duration, 0);
        });
        const labels = days.map(d => TimerUtils.formatMMMDD(d));
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        const options = {
            scales: {
                y: { beginAtZero: true, ticks: { color: text, callback: (v) => TimerUtils.formatDuration(v) }, grid: { color: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' } },
                x: { ticks: { color: text }, grid: { display: false } }
            }, plugins: { legend: { display: false } }
        };
        const data = {
            labels, datasets: [{
                // Fix: Sentence case
                label: 'Daily total', data: totals, backgroundColor: this.createGradient(canvas, 'x'),
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)', borderWidth: 1, borderRadius: 6
            }]
        };
        this.createChart(canvas, 'bar', data, options);
    }

    createDoughnutChart(canvas, analytics) {
        const periodData = this.filterByPeriod(analytics);
        const tagTotals = this.calculateTagTotals(periodData);
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        if (Object.keys(tagTotals).length === 0) { 
            // Fix: Use createEl
            const p = canvas.parentElement.createEl('p', { text: `No data for selected period.` }); 
            // Fix: No hardcoded styles, use class
            p.addClass('timer-text-center');
            canvas.remove(); return; 
        }
        const total = Object.values(tagTotals).reduce((s, v) => s + v, 0);
        const data = {
            labels: Object.keys(tagTotals).map(tag => TimerUtils.formatTagLabel(tag)),
            datasets: [{ label: `Time spent`, data: Object.values(tagTotals), backgroundColor: this.getDoughnutColors(), borderColor: isDark ? '#333333' : '#ffffff', borderWidth: 2, hoverOffset: 8 }]
        };
        const centerText = {
            id: 'centerText',
            afterDraw: (chart) => {
                const { ctx, chartArea } = chart; if (!chartArea?.width || !chartArea?.height) return;
                ctx.save(); const cx = (chartArea.left + chartArea.right) / 2; const cy = (chartArea.top + chartArea.bottom) / 2;
                ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(TimerUtils.formatDuration(total), cx, cy); ctx.restore();
            }
        };
        const options = {
            plugins: {
                legend: { position: 'top', labels: { color: text, font: { size: 14 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const value = ctx.raw; const tot = ctx.chart.getDatasetMeta(0).total;
                            const pct = ((value / tot) * 100).toFixed(2); return `${ctx.label}: ${TimerUtils.formatDuration(value)} (${pct}%)`;
                        }
                    },
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: text, bodyColor: text, borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', borderWidth: 1
                },
                datalabels: {
                    color: text, font: { size: 12, weight: 'bold' }, align: 'center', anchor: 'center',
                    formatter: (v, ctx) => { const tot = ctx.chart.getDatasetMeta(0).total; return `${((v / tot) * 100).toFixed(1)}%`; }
                }
            }
        };
        this.createChart(canvas, 'doughnut', data, options, [centerText]);
    }

    getDoughnutColors() {
        return ['#9050deff', '#3678e3ff', '#A55B4Bff', '#1daec4ff', '#d8324eff', '#26c2aeff', '#28c088ff', '#cd742cff', '#dc549aff', '#5c69dbff', '#70839dff', '#065084ff', '#4F1C51ff'];
    }

    addChartContextMenu(canvas, chart, sortedTags) {
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true); if (!points.length) return;
            const idx = points[0].index; const label = chart.data.labels[idx]; const tag = `#${label}`; const currentValue = sortedTags[idx][1];
            const menu = new obsidian.Menu();
            menu.addItem((item) => item.setTitle(`Edit "${label}" (this period)`).setIcon("pencil").onClick(() => this.showEditModal(tag, currentValue)));
            // Fix: Use async/await instead of Promise chain
            menu.addItem((item) => item.setTitle(`Clear "${label}" (this period)`).setIcon("trash").onClick(async () => {
                await this.deleteTagData(tag);
                this.view.onOpen();
            }));
            menu.showAtMouseEvent(e);
        });
    }
    showEditModal(tag, currentValue) {
        const modal = new obsidian.Modal(this.app); modal.contentEl.createEl("h2", { text: `Edit time for ${tag}` });
        let newSeconds = currentValue;
        const input = new obsidian.TextComponent(modal.contentEl).setValue(String(currentValue)).onChange((v) => { newSeconds = parseInt(v, 10); });
        input.inputEl.type = 'number'; 
        // Fix: Use class instead of style
        input.inputEl.addClass('timer-modal-input');
        new obsidian.Setting(modal.contentEl).addButton((btn) => btn.setButtonText("Save").setCta().onClick(async () => {
            if (!isNaN(newSeconds) && newSeconds >= 0) { await this.updateTagTime(tag, newSeconds); modal.close(); this.view.onOpen(); }
            else new obsidian.Notice("Please enter a valid number of seconds.");
        }));
        modal.open();
    }
    async updateTagTime(tagToUpdate, newTotalDuration) {
        const range = this.view.getPeriodRange(); let anchorDateForAdjustment = this.view.anchorDate;
        if (this.view.showWeekly) anchorDateForAdjustment = range.start;
        await this.view.analyticsStore.setTagTotalForPeriod(tagToUpdate, newTotalDuration, range, anchorDateForAdjustment);
    }
    async deleteTagData(tagToDelete) {
        const range = this.view.getPeriodRange(); let anchorDateForAdjustment = this.view.anchorDate;
        if (this.view.showWeekly) anchorDateForAdjustment = range.start;
        await this.view.analyticsStore.setTagTotalForPeriod(tagToDelete, 0, range, anchorDateForAdjustment);
    }
}

/* ------------------------------ Analytics View ------------------------------ */

class TimerAnalyticsView extends obsidian.ItemView {
    constructor(leaf) {
        super(leaf);
        this.chartjsLoaded = false;
        this.analyticsPath = this.app.vault.configDir + '/plugins/tag-timer/analytics.json';
        this.showWeekly = false; this.anchorDate = new Date();
        this.chartManager = new TimerChartManager(this.app, this);
        this.analyticsStore = new AnalyticsStore(this.app, CONSTANTS.RETENTION_DAYS, this.analyticsPath);
    }
    getViewType() { return CONSTANTS.ANALYTICS_VIEW_TYPE; }
    getDisplayText() { return "Timer Analytics"; }
    getIcon() { return "pie-chart"; }

    async onOpen() {
        const container = this.containerEl.children[1]; container.empty(); container.addClass("analytics-container");
        if (!this.chartjsLoaded) await this.loadChartJS(container); else await this.renderAnalytics();
    }
    async loadChartJS(container) {
        return new Promise((resolve) => {
            // Fix: Use createEl instead of document.createElement
            // Note: createEl appends by default, so we capture reference but don't need explicit appendChild if attached to container
            // However, logic below handles nested loading.
            const chartScript = container.createEl('script', { attr: { src: 'https://cdn.jsdelivr.net/npm/chart.js' } });
            chartScript.onload = () => {
                const datalabelsScript = container.createEl('script', { attr: { src: 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js' } });
                datalabelsScript.onload = async () => { this.chartjsLoaded = true; Chart.register(ChartDataLabels); await this.renderAnalytics(); resolve(); };
            };
        });
    }
    async renderAnalytics() {
        const container = this.containerEl.children[1]; container.empty(); container.addClass("analytics-container");
        const analytics = await this.analyticsStore.loadForCharts();
        if (analytics.length === 0) { container.createEl("p", { text: `No analytics data found (last ${CONSTANTS.RETENTION_DAYS} days).` }); return; }
        const grid = container.createDiv({ cls: "chart-grid" });
        this.chartManager.createBarChartCard(grid, analytics);
        this.chartManager.createDoughnutChartCard(grid, analytics);
    }
    getPeriodRange() {
        if (this.showWeekly) return { start: TimerUtils.startOfWeekMonday(this.anchorDate), end: TimerUtils.endOfWeekMonday(this.anchorDate) };
        return { start: TimerUtils.startOfDay(this.anchorDate), end: TimerUtils.endOfDay(this.anchorDate) };
    }
    async onClose() { /* no-op */ }
}

/* ------------------------------ Export ------------------------------ */

module.exports = TimerPlugin;