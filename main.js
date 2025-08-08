'use strict';

const obsidian = require('obsidian');
const { EditorView } = require('@codemirror/view');

// Consolidated Constants
const CONSTANTS = {
    UPDATE_INTERVAL: 1000,
    BASE62_CHARS: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ANALYTICS_VIEW_TYPE: "timer-analytics-view",
    REGEX: {
        ORDERED_LIST: /(^\s*#*\d+\.\s)/,
        UNORDERED_LIST: /(^\s*#*[-/+/*]\s)/,
        HEADER: /(^\s*#+\s)/,
        TIMER_SPAN: /<span class="timer-[rp]"[^>]*>.*?<\/span>/,
        OLD_TIMER: /<span class="timer-btn"[^>]*>.*?<\/span>/,
        NEW_FORMAT: /<span class="(timer-r|timer-p)" id="([^"]+)" data-dur="(\d+)" data-ts="(\d+)">.*?<\/span>/g,
        HASHTAGS: /#\w+/g
    }
};

const LANG = {
    command_name: {
        toggle: "Toggle timer",
        delete: "Delete timer"
    },
    action_start: "Start timer",
    action_paused: "Pause timer",
    action_continue: "Continue timer",
    settings: {
        name: "Tag Timer Settings",
        desc: "Configure timer behavior",
        tutorial: "For detailed instructions, visit: ",
        askforvote: "If you find this plugin helpful, please consider giving it a star on GitHub!🌟",
        issue: "If you encounter any issues, please report them on GitHub along with version and steps to reproduce.",
        sections: {
            basic: { name: "Basic Settings" },
            bycommand: {
                name: "Timer by Command",
                desc: "Use the command palette to toggle timers"
            },
            byeditormenu: {
                name: "Timer by Editor Menu",
                desc: "Right-click in the editor to access timer options"
            }
        },
        autostop: {
            name: "Auto-stop timers",
            desc: "When to automatically stop running timers",
            choice: {
                never: "Never",
                quit: "On Obsidian quit",
                close: "On file close"
            }
        },
        insertlocation: {
            name: "Timer insert location",
            desc: "End of line recommened if you use Day Planner Plugin as well.",
            choice: {
                head: "Beginning of line",
                tail: "End of line"
            }
        }
    }
};

// Consolidated Utility Functions
class TimerUtils {
    static compressId(timestamp = Date.now()) {
        if (timestamp === 0) return 't0';
        let num = timestamp;
        let result = '';
        while (num > 0) {
            result = CONSTANTS.BASE62_CHARS[num % 62] + result;
            num = Math.floor(num / 62);
        }
        return result;
    }

    static formatDuration(totalSeconds) {
        if (totalSeconds === 0) return '0s';
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const parts = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0) parts.push(`${seconds}s`);
        return parts.join(' ');
    }

    static formatTagLabel(tag) {
        return tag.startsWith('#') ? tag.substring(1) : tag;
    }

    static formatTimeDisplay(totalSeconds) {
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    static getCurrentTimestamp() {
        return Math.floor(Date.now() / 1000);
    }

    static getTodayString() {
        return new Date().toISOString().slice(0, 10);
    }
}

class TimerDataUpdater {
    static calculate(action, oldData, now = TimerUtils.getCurrentTimestamp()) {
        const actions = {
            init: () => ({
                class: 'timer-r',
                timerId: TimerUtils.compressId(),
                dur: 0,
                ts: now
            }),
            continue: () => ({ ...oldData, class: 'timer-r', ts: now }),
            pause: () => {
                const elapsed = oldData ? now - oldData.ts : 0;
                return { ...oldData, class: 'timer-p', dur: (oldData.dur || 0) + elapsed, ts: now };
            },
            update: () => {
                if (oldData.class !== 'timer-r') return oldData;
                const updateElapsed = now - oldData.ts;
                return { ...oldData, dur: (oldData.dur || 0) + updateElapsed, ts: now };
            },
            restore: () => {
                const restoreElapsed = oldData ? now - oldData.ts : 0;
                return { ...oldData, class: 'timer-r', dur: (oldData.dur || 0) + restoreElapsed, ts: now };
            },
            forcepause: () => ({ ...oldData, class: 'timer-p' })
        };

        return actions[action] ? actions[action]() : oldData;
    }
}

class TimerManager {
    constructor() {
        this.timers = new Map();
        this.startedIds = new Set();
    }

    startTimer(timerId, initialData, tickCallback) {
        if (this.hasTimer(timerId)) return;
        
        const intervalId = setInterval(() => tickCallback(timerId), CONSTANTS.UPDATE_INTERVAL);
        this.timers.set(timerId, { intervalId, data: initialData });
        this.startedIds.add(timerId);
    }

    stopTimer(timerId) {
        const timer = this.timers.get(timerId);
        if (timer) {
            clearInterval(timer.intervalId);
            this.timers.delete(timerId);
        }
    }

    updateTimerData(timerId, newData) {
        const timer = this.timers.get(timerId);
        if (timer) timer.data = newData;
    }

    getTimerData(timerId) {
        return this.timers.get(timerId)?.data || null;
    }

    hasTimer(timerId) {
        return this.timers.has(timerId);
    }

    isStartedInThisSession(timerId) {
        return this.startedIds.has(timerId);
    }

    getAllTimers() {
        return new Map(Array.from(this.timers.entries()).map(([id, timer]) => [id, timer.data]));
    }

    clearAll() {
        this.timers.forEach(timer => clearInterval(timer.intervalId));
        this.timers.clear();
        this.startedIds.clear();
    }
}

class TimerFileManager {
    constructor(app, settings) {
        this.app = app;
        this.settings = settings;
        this.locations = new Map();
    }

    async getLineText(view, file, lineNum) {
        return view.getMode() === 'source' 
            ? view.editor.getLine(lineNum)
            : (await this.app.vault.read(file)).split('\n')[lineNum] || '';
    }

    async writeTimer(timerId, timerData, view, file, lineNum, parsedResult = null) {
        const newSpan = TimerRenderer.render(timerData);
        
        if (view.getMode() === 'preview') {
            await this.writeTimerPreview(file, lineNum, newSpan, parsedResult);
        } else {
            this.writeTimerSource(view.editor, lineNum, newSpan, parsedResult, timerId);
        }
        
        this.locations.set(timerId, { view, file, lineNum });
        return timerId;
    }

    async writeTimerPreview(file, lineNum, newSpan, parsedResult) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let line = lines[lineNum];
        let modified = false;

        if (line.match(CONSTANTS.REGEX.TIMER_SPAN)) {
            lines[lineNum] = line.replace(CONSTANTS.REGEX.TIMER_SPAN, newSpan);
            modified = true;
        } else if (parsedResult === null) {
            const position = this.calculateInsertPosition({ getLine: () => line }, 0, this.settings.timerInsertLocation);
            lines[lineNum] = this.insertSpanAtPosition(line, newSpan, position);
            modified = true;
        }

        if (modified) {
            await this.app.vault.modify(file, lines.join('\n'));
        }
    }

    writeTimerSource(editor, lineNum, newSpan, parsedResult, timerId) {
        let before, after, needsSpacing = false;

        if (parsedResult?.timerId === timerId) {
            before = parsedResult.beforeIndex;
            after = parsedResult.afterIndex;
        } else {
            const position = this.calculateInsertPosition(editor, lineNum, this.settings.timerInsertLocation);
            before = position.before;
            after = position.after;
            needsSpacing = true;
        }

        const finalSpan = needsSpacing ? ` ${newSpan} ` : newSpan;
        editor.replaceRange(finalSpan, { line: lineNum, ch: before }, { line: lineNum, ch: after });
    }

    insertSpanAtPosition(line, span, position) {
        if (position.before === 0) return `${span} ${line}`;
        if (position.before === line.length) return `${line} ${span}`;
        return `${line.substring(0, position.before)} ${span} ${line.substring(position.before)}`;
    }

    async updateTimer(timerId, timerData, location = null) {
        const timerLocation = location || this.locations.get(timerId);
        if (!timerLocation?.view?.file) {
            return this.settings.autoStopTimers !== 'close';
        }

        const { view, file, lineNum } = timerLocation;
        const lineText = await this.getLineText(view, file, lineNum);
        const parsed = TimerParser.parse(lineText, 'auto', timerId);
        
        if (parsed) {
            await this.writeTimer(timerId, timerData, view, file, lineNum, parsed);
            return true;
        }
        
        const found = await this.findTimerGlobally(timerId);
        if (found) {
            await this.writeTimer(timerId, timerData, found.view, found.file, found.lineNum, found.parsed);
            return true;
        }
        
        console.warn(`Timer ${timerId} not found, stopping timer.`);
        return false;
    }

    async findTimerGlobally(timerId) {
        const location = this.locations.get(timerId);
        if (!location) return null;

        const { view, file } = location;
        const searchMethod = view.getMode() === 'source' ? 
            this.searchInEditor.bind(this) : 
            this.searchInFile.bind(this);
        
        return await searchMethod(view, file, timerId);
    }

    async searchInEditor(view, file, timerId) {
        const editor = view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const parsed = TimerParser.parse(editor.getLine(i), 'auto', timerId);
            if (parsed?.timerId === timerId) {
                return { view, file, lineNum: i, parsed };
            }
        }
        return null;
    }

    async searchInFile(view, file, timerId) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const parsed = TimerParser.parse(lines[i], 'auto', timerId);
            if (parsed?.timerId === timerId) {
                return { view, file, lineNum: i, parsed };
            }
        }
        return null;
    }

    calculateInsertPosition(editor, lineNum, insertLocation) {
        const lineText = editor.getLine(lineNum) || '';
        
        if (insertLocation === 'head') {
            return this.findHeadPosition(lineText);
        } else if (insertLocation === 'tail') {
            return { before: lineText.length, after: lineText.length };
        }
        return { before: 0, after: 0 };
    }

    findHeadPosition(lineText) {
        const patterns = [
            CONSTANTS.REGEX.ORDERED_LIST,
            CONSTANTS.REGEX.UNORDERED_LIST,
            CONSTANTS.REGEX.HEADER
        ];

        for (const pattern of patterns) {
            const match = pattern.exec(lineText);
            if (match) {
                return { before: match[0].length, after: match[0].length };
            }
        }
        return { before: 0, after: 0 };
    }

    clearLocations() {
        this.locations.clear();
    }

    async upgradeOldTimers(file) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].includes('timer-btn')) continue;

            const parsed = TimerParser.parse(lines[i], 'v1');
            if (parsed) {
                modified = true;
                const newSpan = TimerRenderer.render(parsed);
                lines[i] = lines[i].replace(CONSTANTS.REGEX.OLD_TIMER, newSpan);
            }
        }

        if (modified) {
            await this.app.vault.modify(file, lines.join('\n'));
        }
    }
}

class TimerRenderer {
    static render(timerData) {
        const formatted = TimerUtils.formatTimeDisplay(timerData.dur);
        const timerIcon = this.getTimerIcon(timerData);
        
        return `<span class="${timerData.class}" id="${timerData.timerId}" data-dur="${timerData.dur}" data-ts="${timerData.ts}">【${timerIcon}${formatted} 】</span>`;
    }

    static getTimerIcon(timerData) {
        if (timerData.class === 'timer-r') {
            return timerData.dur % 2 === 0 ? '⌛' : '⏳';
        }
        return '⏳';
    }
}

class TimerParser {
    static parse(lineText, version = 'auto', targetTimerId = null) {
        if (version === 'v1') {
            return this.parseOldFormat(lineText);
        }

        const newResult = this.parseNewFormat(lineText, targetTimerId);
        if (newResult) return newResult;

        if (version === 'auto') {
            return this.parseOldFormat(lineText);
        }

        return null;
    }

    static parseNewFormat(lineText, targetTimerId = null) {
        const regex = new RegExp(CONSTANTS.REGEX.NEW_FORMAT.source, 'g');
        let match;
        
        while ((match = regex.exec(lineText)) !== null) {
            const timerId = match[2];
            if (!targetTimerId || targetTimerId === timerId) {
                return {
                    class: match[1],
                    timerId: timerId,
                    dur: parseInt(match[3], 10),
                    ts: parseInt(match[4], 10),
                    beforeIndex: match.index,
                    afterIndex: match.index + match[0].length
                };
            }
        }
        return null;
    }

    static parseOldFormat(lineText) {
        const spanMatch = lineText.match(/<span class="timer-btn"([^>]*)>.*?<\/span>/);
        if (!spanMatch) return null;

        const attrs = this.parseAttributes(spanMatch[1]);
        if (!this.hasRequiredAttributes(attrs)) return null;

        const oldId = attrs.timerId;
        const newId = oldId ? TimerUtils.compressId(parseInt(oldId)) : TimerUtils.compressId();
        
        return {
            class: attrs.Status === 'Running' ? 'timer-r' : 'timer-p',
            timerId: newId,
            dur: parseInt(attrs.AccumulatedTime, 10),
            ts: parseInt(attrs.currentStartTimeStamp, 10),
            beforeIndex: spanMatch.index,
            afterIndex: spanMatch.index + spanMatch[0].length
        };
    }

    static parseAttributes(attrsText) {
        const patterns = {
            timerId: /(?:data-)?timerId="([^"]+)"/,
            Status: /(?:data-)?Status="([^"]+)"/,
            AccumulatedTime: /(?:data-)?AccumulatedTime="(\d+)"/,
            currentStartTimeStamp: /(?:data-)?currentStartTimeStamp="(\d+)"/
        };

        const attrs = {};
        for (const [key, pattern] of Object.entries(patterns)) {
            const match = attrsText.match(pattern);
            if (match) attrs[key] = match[1];
        }
        return attrs;
    }

    static hasRequiredAttributes(attrs) {
        return attrs.timerId && attrs.Status && attrs.AccumulatedTime && attrs.currentStartTimeStamp;
    }
}

class TimerPlugin extends obsidian.Plugin {
    async onload() {
        this.manager = new TimerManager();
        this.default_settings = {
            autoStopTimers: 'quit',
            timerInsertLocation: 'head',
            timersState: {},
            dailyReset: true,
            lastResetDate: '',
            weeklyReset: true, 
            lastWeeklyResetDate: ''  
        };
        
        await this.loadSettings();
        this.fileManager = new TimerFileManager(this.app, this.settings);
        
        await this.handleDailyReset();
        await this.handleWeeklyReset();
        this.setupCommands();
        this.setupEventHandlers();
        this.setupAnalyticsView();
    }

    setupCommands() {
        this.addCommand({
            id: 'toggle-timer',
            icon: 'alarm-clock',
            name: LANG.command_name.toggle,
            editorCallback: (editor, view) => {
                const lineNum = editor.getCursor().line;
                const lineText = editor.getLine(lineNum);
                const parsed = TimerParser.parse(lineText, 'auto');
                
                if (parsed) {
                    const action = parsed.class === 'timer-r' ? 'pause' : 'continue';
                    this.handleTimerAction(action, view, lineNum, parsed);
                } else {
                    this.handleTimerAction('start', view, lineNum);
                }
            },
        });

        this.addCommand({
            id: 'delete-timer',
            icon: 'trash',
            name: LANG.command_name.delete,
            editorCallback: (editor, view) => {
                const lineNum = editor.getCursor().line;
                const lineText = editor.getLine(lineNum);
                const parsed = TimerParser.parse(lineText, 'auto');
                if (parsed) this.handleTimerAction('delete', view, lineNum, parsed);
            },
        });

        this.addCommand({
            id: 'open-timer-analytics',
            name: 'Open Timer Analytics',
            callback: () => this.activateView(false),
        });

        this.addCommand({
            id: 'reset-timer-analytics',
            name: 'Reset Daily Timer Analytics',
            callback: () => this.resetAnalytics(false),
        });

        this.addCommand({
            id: 'open-weekly-timer-analytics',
            name: 'Open Weekly Timer Analytics',
            callback: () => this.activateWeeklyView(),
        });

        this.addCommand({
            id: 'reset-weekly-timer-analytics',
            name: 'Reset Weekly Timer Analytics',
            callback: () => this.resetAnalytics(true),
        });

    }

    setupEventHandlers() {
        this.registerEvent(this.app.workspace.on('editor-menu', this.onEditorMenu.bind(this)));
        this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
        this.app.workspace.onLayoutReady(() => this.restoreAllTimers());
    }

    setupAnalyticsView() {
        this.registerView(CONSTANTS.ANALYTICS_VIEW_TYPE, (leaf) => new TimerAnalyticsView(leaf));
        this.addRibbonIcon("pie-chart", "Open Timer Analytics", () => this.activateView());
        this.addSettingTab(new TimerSettingTab(this.app, this));
    }

    async handleTimerAction(action, view, lineNum, parsedData = null) {
        const handlers = {
            start: () => {
                const initialData = TimerDataUpdater.calculate('init', {});
                this.manager.startTimer(initialData.timerId, initialData, this.onTick.bind(this));
                return this.fileManager.writeTimer(initialData.timerId, initialData, view, view.file, lineNum, null);
            },
            continue: () => {
                if (!parsedData?.timerId) return;
                const currentData = this.manager.getTimerData(parsedData.timerId) || parsedData;
                const newData = TimerDataUpdater.calculate('continue', currentData);
                this.manager.startTimer(parsedData.timerId, newData, this.onTick.bind(this));
                return this.fileManager.writeTimer(parsedData.timerId, newData, view, view.file, lineNum, parsedData);
            },
            pause: () => {
                if (!parsedData?.timerId) return;
                const currentData = this.manager.getTimerData(parsedData.timerId) || parsedData;
                const newData = TimerDataUpdater.calculate('pause', currentData);
                this.manager.stopTimer(parsedData.timerId);
                this.fileManager.writeTimer(parsedData.timerId, newData, view, view.file, lineNum, parsedData);
                this.logAnalytics(newData, view.editor.getLine(lineNum), view.file.path);
            },
            delete: () => {
                if (!parsedData?.timerId) return;
                this.manager.stopTimer(parsedData.timerId);
                this.fileManager.locations.delete(parsedData.timerId);
                if (view.getMode() === 'source') {
                    view.editor.replaceRange('', 
                        { line: lineNum, ch: parsedData.beforeIndex }, 
                        { line: lineNum, ch: parsedData.afterIndex });
                }
                this.logAnalytics(parsedData, view.editor.getLine(lineNum), view.file.path);
                this.cleanupTimerState(parsedData.timerId);
            },
            restore: () => {
                if (!parsedData?.timerId) return;
                const newData = TimerDataUpdater.calculate('restore', parsedData);
                this.manager.startTimer(parsedData.timerId, newData, this.onTick.bind(this));
                this.fileManager.writeTimer(parsedData.timerId, newData, view, view.file, lineNum, parsedData);
            },
            forcepause: () => {
                if (!parsedData?.timerId) return;
                const newData = TimerDataUpdater.calculate('forcepause', parsedData);
                this.fileManager.writeTimer(parsedData.timerId, newData, view, view.file, lineNum, parsedData);
            }
        };

        return handlers[action]?.();
    }

    // Individual handler methods for backward compatibility
    handleStart(view, lineNum) { return this.handleTimerAction('start', view, lineNum); }
    handleContinue(view, lineNum, parsedData) { return this.handleTimerAction('continue', view, lineNum, parsedData); }
    handlePause(view, lineNum, parsedData) { return this.handleTimerAction('pause', view, lineNum, parsedData); }
    handleDelete(view, lineNum, parsedData) { return this.handleTimerAction('delete', view, lineNum, parsedData); }
    handleRestore(view, lineNum, parsedData) { return this.handleTimerAction('restore', view, lineNum, parsedData); }
    handleForcePause(view, lineNum, parsedData) { return this.handleTimerAction('forcepause', view, lineNum, parsedData); }

    onunload() {
        this.manager.clearAll();
        this.fileManager.clearLocations();
    }

    onEditorMenu(menu, editor, view) {
        const lineNum = editor.getCursor().line;
        const lineText = editor.getLine(lineNum);
        const parsed = TimerParser.parse(lineText, 'auto');

        const menuItems = parsed ? this.getRunningMenuItems(parsed) : this.getNewTimerMenuItems();
        
        menuItems.forEach(item => {
            menu.addItem(menuItem => 
                menuItem.setTitle(item.title)
                         .setIcon(item.icon)
                         .onClick(() => item.action(view, lineNum, parsed))
            );
        });
    }

    getRunningMenuItems(parsed) {
        const items = [];
        
        if (parsed.class === 'timer-r') {
            items.push({
                title: LANG.action_paused,
                icon: 'pause',
                action: (view, lineNum, parsed) => this.handlePause(view, lineNum, parsed)
            });
        } else {
            items.push({
                title: LANG.action_continue,
                icon: 'play',
                action: (view, lineNum, parsed) => this.handleContinue(view, lineNum, parsed)
            });
        }
        
        items.push({
            title: LANG.command_name.delete,
            icon: 'trash',
            action: (view, lineNum, parsed) => this.handleDelete(view, lineNum, parsed)
        });
        
        return items;
    }

    getNewTimerMenuItems() {
        return [{
            title: LANG.action_start,
            icon: 'play',
            action: (view, lineNum) => this.handleStart(view, lineNum)
        }];
    }

    async onTick(timerId) {
        const oldData = this.manager.getTimerData(timerId);
        if (!oldData || oldData.class !== 'timer-r') return;

        const newData = TimerDataUpdater.calculate('update', oldData);
        this.manager.updateTimerData(timerId, newData);

        const updated = await this.fileManager.updateTimer(timerId, newData);
        if (!updated) {
            this.manager.stopTimer(timerId);
        }
    }

    async onFileOpen(file) {
        if (file) {
            await this.fileManager.upgradeOldTimers(file);
            const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
            if (view?.file === file) {
                this.restoreTimersInView(view);
            }
        }
    }

    restoreAllTimers() {
        this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
            if (leaf.view instanceof obsidian.MarkdownView) {
                this.restoreTimersInView(leaf.view);
            }
        });
    }

    restoreTimersInView(view) {
        const editor = view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const lineText = editor.getLine(i);
            const parsed = TimerParser.parse(lineText, 'auto');
            
            if (parsed?.class === 'timer-r') {
                const { autoStopTimers } = this.settings;
                const shouldRestore = autoStopTimers === 'never' || 
                    (autoStopTimers === 'quit' && this.manager.isStartedInThisSession(parsed.timerId));
                
                const action = shouldRestore ? 'restore' : 'forcepause';
                this.handleTimerAction(action, view, i, parsed);
            }
        }
    }

    async activateView(showWeekly = false) {
        const leaves = this.app.workspace.getLeavesOfType(CONSTANTS.ANALYTICS_VIEW_TYPE);
        let leaf = leaves[0];

        if (!leaf) {
            leaf = this.app.workspace.getRightLeaf(false);
            await leaf.setViewState({
                type: CONSTANTS.ANALYTICS_VIEW_TYPE,
                active: true,
            });
        } else {
            this.app.workspace.revealLeaf(leaf);
        }

        if (leaf.view instanceof TimerAnalyticsView) {
            leaf.view.showWeekly = showWeekly;
            leaf.view.onOpen();
        }
    }

    async resetAnalytics(weekly = false) {
        const type = weekly ? 'weekly' : 'daily';
        const confirmation = confirm(`Are you sure you want to delete all ${type} analytics data?`);
        if (!confirmation) return;

        const path = weekly ? this.getWeeklyAnalyticsPath() : this.getAnalyticsPath();
        await this.app.vault.adapter.write(path, JSON.stringify([], null, 2));

        const leaves = this.app.workspace.getLeavesOfType(CONSTANTS.ANALYTICS_VIEW_TYPE);
        if (leaves.length > 0) {
            const view = leaves[0].view;
            if ((weekly && view.showWeekly) || (!weekly && !view.showWeekly)) {
                view.onOpen();
            }
        }
    }

    

    

    getAnalyticsPath() {
        return this.app.vault.configDir + '/plugins/tag-timer/analytics.json';
    }

    getWeeklyAnalyticsPath() {
    return this.app.vault.configDir + '/plugins/tag-timer/weekly-analytics.json';
    }

    async loadSettings() {
        this.settings = Object.assign({}, this.default_settings, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        if (this.fileManager) {
            this.fileManager.settings = this.settings;
        }
    }

    async updateSetting(key, value) {
        this.settings[key] = value;
        await this.saveSettings();
        this.onSettingChanged(key, value);
    }

    onSettingChanged(key, value) {
        const handlers = {
            autoStopTimers: () => this.updateAutoStopBehavior?.(),
            timerInsertLocation: () => { this.fileManager.settings = this.settings; },
            dailyReset: () => value && this.handleDailyReset(),
            weeklyReset: () => value && this.handleWeeklyReset()
        };
        handlers[key]?.();
    }

    cleanupTimerState(timerId) {
        if (this.settings.timersState?.[timerId]) {
            delete this.settings.timersState[timerId];
            this.saveSettings();
        }
    }

    async logAnalytics(timerData, lineText, filePath) {
        const { timerId, dur } = timerData;
        if (!timerId) return;

        if (!this.settings.timersState) {
            this.settings.timersState = {};
        }

        const lastLoggedDur = this.settings.timersState[timerId] || 0;
        const durationIncrement = dur - lastLoggedDur;

        if (durationIncrement <= 0) return;

        const tags = lineText.match(CONSTANTS.REGEX.HASHTAGS) || [];
        const analyticsData = {
            timestamp: new Date().toISOString(),
            duration: durationIncrement,
            file: filePath,
            tags: tags
        };

        try {
            // Log to daily analytics
            const dailyPath = this.getAnalyticsPath();
            let dailyAnalytics = await this.loadAnalyticsData(dailyPath);
            dailyAnalytics.push(analyticsData);
            await this.app.vault.adapter.write(dailyPath, JSON.stringify(dailyAnalytics, null, 2));

            // Log to weekly analytics
            const weeklyPath = this.getWeeklyAnalyticsPath();
            let weeklyAnalytics = await this.loadAnalyticsData(weeklyPath);
            weeklyAnalytics.push(analyticsData);
            await this.app.vault.adapter.write(weeklyPath, JSON.stringify(weeklyAnalytics, null, 2));

            this.settings.timersState[timerId] = dur;
            await this.saveSettings();
        } catch (e) {
            console.error("Error writing analytics data:", e);
        }
    }

    async loadAnalyticsData(analyticsPath) {
        try {
            const rawData = await this.app.vault.adapter.read(analyticsPath);
            return rawData ? JSON.parse(rawData) : [];
        } catch (readError) {
            return [];
        }
    }

    async handleDailyReset() {
        if (!this.settings.dailyReset) return;

        const today = TimerUtils.getTodayString();
        if (this.settings.lastResetDate !== today) {
            const analyticsPath = this.getAnalyticsPath();
            await this.app.vault.adapter.write(analyticsPath, JSON.stringify([], null, 2));
            this.settings.lastResetDate = today;
            await this.saveSettings();

            const leaves = this.app.workspace.getLeavesOfType(CONSTANTS.ANALYTICS_VIEW_TYPE);
            if (leaves.length > 0) {
                leaves[0].view.onOpen();
            }
        }
    }

    async handleWeeklyReset() {
        if (!this.settings.weeklyReset) return;

        const today = new Date();
        const currentWeek = this.getWeekString(today);
        
        if (this.settings.lastWeeklyResetDate !== currentWeek) {
            const weeklyPath = this.getWeeklyAnalyticsPath();
            await this.app.vault.adapter.write(weeklyPath, JSON.stringify([], null, 2));
            this.settings.lastWeeklyResetDate = currentWeek;
            await this.saveSettings();
        }
    }

    getWeekString(date) {
        const startOfWeek = new Date(date);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
        startOfWeek.setDate(diff);
        return startOfWeek.toISOString().slice(0, 10);
    }
}

class TimerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        const lang = LANG.settings;

        this.createHeader(containerEl, lang);
        this.createBasicSettings(containerEl, lang);
    }

    createHeader(containerEl, lang) {
        containerEl.createEl('h1', { text: lang.name });
        containerEl.createEl('p', { text: lang.desc });

        const tutorialInfo = containerEl.createEl('div', { cls: 'tutorial-info' });
        const tutorialP = tutorialInfo.createEl('p');
        tutorialP.appendText(lang.tutorial);
        tutorialP.createEl('a', {
            text: 'GitHub',
            href: 'https://github.com/quantavil/tag-timer',
            target: '_blank'
        });
        containerEl.createEl('p', { text: lang.askforvote });
        containerEl.createEl('p', { text: lang.issue });
    }

    createBasicSettings(containerEl, lang) {
        containerEl.createEl('h3', { text: lang.sections.basic.name });

        new obsidian.Setting(containerEl)
            .setName("Daily Analytics Reset")
            .setDesc("Automatically reset all analytics data at the start of a new day.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.dailyReset)
                .onChange(async (value) => {
                    await this.plugin.updateSetting('dailyReset', value);
                }));
        
        new obsidian.Setting(containerEl)
            .setName("Weekly Analytics Reset")
            .setDesc("Automatically reset weekly analytics data at the start of a new week (Monday).")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.weeklyReset)
                .onChange(async (value) => {
                    await this.plugin.updateSetting('weeklyReset', value);
                }));

        new obsidian.Setting(containerEl)
            .setName(lang.autostop.name)
            .setDesc(lang.autostop.desc)
            .addDropdown(dd => dd
                .addOption('never', lang.autostop.choice.never)
                .addOption('quit', lang.autostop.choice.quit)
                .addOption('close', lang.autostop.choice.close)
                .setValue(this.plugin.settings.autoStopTimers)
                .onChange(async (value) => {
                    await this.plugin.updateSetting('autoStopTimers', value);
                }));

        new obsidian.Setting(containerEl)
            .setName(lang.insertlocation.name)
            .setDesc(lang.insertlocation.desc)
            .addDropdown(dd => dd
                .addOption('head', lang.insertlocation.choice.head)
                .addOption('tail', lang.insertlocation.choice.tail)
                .setValue(this.plugin.settings.timerInsertLocation)
                .onChange(async (value) => {
                    await this.plugin.updateSetting('timerInsertLocation', value);
                }));
    }
}

class TimerChartManager {
    constructor(app, view) {
        this.app = app;
        this.view = view;
    }

    createBarChartCard(chartGrid, analytics) {
        const barCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        const header = barCard.createDiv({ cls: "analytics-card-header" });
        header.createEl("h3", { text: "Analytics" });

        const toggleButton = header.createEl("button", { 
            text: this.view.showWeekly ? "Show Daily" : "Show Weekly",
            cls: "analytics-toggle-button"
        });
        toggleButton.addEventListener('click', () => {
            this.view.showWeekly = !this.view.showWeekly;
            this.view.onOpen();
        });

        const barCanvasContainer = barCard.createDiv({ cls: "canvas-container" });
        const barChartCanvas = barCanvasContainer.createEl("canvas");
        this.createBarChart(barChartCanvas, analytics);
    }

    createDoughnutChartCard(chartGrid, analytics) {
        const doughnutCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        doughnutCard.createEl("h3", { text: this.view.showWeekly ? "This Week's Focus" : "Today's Focus" });
        const doughnutCanvasContainer = doughnutCard.createDiv({ cls: "canvas-container" });
        const doughnutChartCanvas = doughnutCanvasContainer.createEl("canvas");
        this.createDoughnutChart(doughnutChartCanvas, analytics);

        const targetDate = this.view.showWeekly ? this.getCurrentWeekString() : TimerUtils.getTodayString();
        const periodTotal = analytics
            .filter(entry => this.view.showWeekly ? 
                this.isInCurrentWeek(entry.timestamp) : 
                entry.timestamp.slice(0, 10) === targetDate)
            .reduce((total, entry) => total + entry.duration, 0);

        const periodTotalEl = doughnutCard.createEl("p", { cls: "daily-total" });
        periodTotalEl.setText(`${this.view.showWeekly ? "This Week's" : "Today's"} Total: ${TimerUtils.formatDuration(periodTotal)}`);
    }

    getCurrentWeekString() {
        const today = new Date();
        const startOfWeek = new Date(today);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        return startOfWeek.toISOString().slice(0, 10);
    }

    isInCurrentWeek(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        const weekStart = new Date(today);
        const day = weekStart.getDay();
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
        weekStart.setDate(diff);
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        return date >= weekStart && date <= weekEnd;
    }

    getBaseChartOptions() {
        const isDarkTheme = document.body.classList.contains('theme-dark');
        const textColor = isDarkTheme ? 'white' : '#333333';
        
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const value = context.raw;
                            return `${context.label}: ${TimerUtils.formatDuration(value)}`;
                        }
                    },
                    backgroundColor: isDarkTheme ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                    borderWidth: 1
                },
                legend: {
                    labels: {
                        color: textColor
                    }
                }
            }
        };
    }

    createChart(canvas, type, data, specificOptions = {}) {
        const baseOptions = this.getBaseChartOptions();
        const mergedOptions = { ...baseOptions, ...specificOptions };
        return new Chart(canvas.getContext('2d'), { type, data, options: mergedOptions });
    }

    createBarChart(canvas, analytics) {
        const tagTotals = this.calculateTagTotals(analytics);
        const sortedTags = Object.entries(tagTotals).sort(([, a], [, b]) => a - b);
        const isDarkTheme = document.body.classList.contains('theme-dark');
        const textColor = isDarkTheme ? 'white' : '#333333';

        const isLabelOutside = (context) => {
            const value = context.dataset.data[context.dataIndex];
            const maxValue = Math.max(...context.dataset.data);
            return (value / maxValue) * 100 < 20;
        };

        const chartOptions = {
            indexAxis: 'y',
            scales: {
                x: { 
                    display: false,
                    grid: {
                        display: false
                    }
                },
                y: {
                    ticks: { 
                        color: textColor, 
                        font: { size: 14 } 
                    },
                    grid: { 
                        display: false,
                        color: isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false },
                datalabels: {
                    anchor: 'end',
                    align: (context) => isLabelOutside(context) ? 'end' : 'start',
                    color: isDarkTheme ? 'white' : '#333333',
                    font: { size: 14, weight: 'bold' },
                    formatter: (value) => TimerUtils.formatDuration(value) + '  ',
                    offset: (context) => isLabelOutside(context) ? 4 : -4,
                }
            }
        };

        const chartData = {
            labels: sortedTags.map(([tag]) => TimerUtils.formatTagLabel(tag)),
            datasets: [{
                label: 'Total Time',
                data: sortedTags.map(([, duration]) => duration),
                backgroundColor: this.createGradient(canvas),
                borderColor: isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                borderWidth: 1,
                borderRadius: 6,
                hoverBackgroundColor: isDarkTheme ? 'rgba(54, 162, 235, 1)' : 'rgba(54, 162, 235, 0.9)'
            }]
        };

        const chart = this.createChart(canvas, 'bar', chartData, chartOptions);
        this.addChartContextMenu(canvas, chart, sortedTags);
    }

    createGradient(canvas) {
        return (context) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return null;

            const isDarkTheme = document.body.classList.contains('theme-dark');
            const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);

            if (isDarkTheme) {
                gradient.addColorStop(0, 'rgba(54, 162, 235, 0.8)');
                gradient.addColorStop(1, 'rgba(153, 102, 255, 0.8)');
            } else {
                gradient.addColorStop(0, 'rgba(54, 162, 235, 0.7)');
                gradient.addColorStop(1, 'rgba(153, 102, 255, 0.7)');
            }

            return gradient;
        };
    }

    addChartContextMenu(canvas, chart, sortedTags) {
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
            if (points.length) {
                const firstPoint = points[0];
                const label = chart.data.labels[firstPoint.index];
                const tag = `#${label}`;
                const currentValue = sortedTags[firstPoint.index][1];

                const menu = new obsidian.Menu();
                
                menu.addItem((item) =>
                    item.setTitle(`Edit "${label}"`)
                        .setIcon("pencil")
                        .onClick(() => {
                            this.showEditModal(tag, currentValue, this.view.showWeekly);
                        })
                );

                menu.addItem((item) =>
                    item.setTitle(`Delete "${label}"`)
                        .setIcon("trash")
                        .onClick(() => {
                            this.deleteTagData(tag, this.view.showWeekly).then(() => {
                                this.view.onOpen();
                            });
                        })
                );
                menu.showAtMouseEvent(e);
            }
        });
    }

    showEditModal(tag, currentValue, isWeekly) {
        const modal = new obsidian.Modal(this.app);
        modal.contentEl.createEl("h2", { text: `Edit time for ${tag}` });
    
        let newTimeInSeconds = currentValue;
    
        const input = new obsidian.TextComponent(modal.contentEl)
            .setValue(String(currentValue))
            .onChange((value) => {
                newTimeInSeconds = parseInt(value, 10);
            });
        
        input.inputEl.type = 'number';
        input.inputEl.style.width = '100%';
    
        new obsidian.Setting(modal.contentEl)
            .addButton((btn) =>
                btn
                .setButtonText("Save")
                .setCta()
                .onClick(() => {
                    if (!isNaN(newTimeInSeconds) && newTimeInSeconds >= 0) {
                        this.updateTagTime(tag, newTimeInSeconds, isWeekly).then(() => {
                            modal.close();
                            this.view.onOpen();
                        });
                    } else {
                        new obsidian.Notice("Please enter a valid number for seconds.");
                    }
                })
            );
    
        modal.open();
    }

    async updateTagTime(tagToUpdate, newTotalDuration, isWeekly) {
        const path = isWeekly ? this.view.weeklyAnalyticsPath : this.view.analyticsPath;
        try {
            const rawData = await this.app.vault.adapter.read(path);
            let analytics = JSON.parse(rawData);
    
            const otherEntries = analytics.filter(entry => !entry.tags.includes(tagToUpdate));
    
            const newEntry = {
                timestamp: new Date().toISOString(),
                duration: newTotalDuration,
                file: "manual-edit",
                tags: [tagToUpdate]
            };
    
            const updatedAnalytics = [...otherEntries, newEntry];
    
            await this.app.vault.adapter.write(path, JSON.stringify(updatedAnalytics, null, 2));
        } catch (e) {
            console.error(`Error updating tag data: ${e}`);
        }
    }

    calculateTagTotals(analytics) {
        const tagTotals = {};
        analytics.forEach(entry => {
            (entry.tags || []).forEach(tag => {
                tagTotals[tag] = (tagTotals[tag] || 0) + entry.duration;
            });
        });
        return tagTotals;
    }

    createDoughnutChart(canvas, analytics) {
        const today = TimerUtils.getTodayString();
        const dailyTagTotals = this.calculateTagTotalsForPeriod(analytics, this.view.showWeekly ? this.getCurrentWeekString() : today);
        const isDarkTheme = document.body.classList.contains('theme-dark');
        const textColor = isDarkTheme ? 'white' : '#333333';

        if (Object.keys(dailyTagTotals).length === 0) {
            const p = canvas.parentElement.createEl('p', { text: `No data for ${this.view.showWeekly ? 'this week' : 'today'}.` });
            p.style.textAlign = 'center';
            canvas.remove();
            return;
        }

        const chartData = {
            labels: Object.keys(dailyTagTotals).map(tag => TimerUtils.formatTagLabel(tag)),
            datasets: [{
                label: `Time Spent ${this.view.showWeekly ? 'This Week' : 'Today'}`,
                data: Object.values(dailyTagTotals),
                backgroundColor: this.getDoughnutColors(),
                borderColor: isDarkTheme ? '#333333' : '#ffffff',
                borderWidth: 2,
                hoverOffset: 8
            }]
        };

        const chartOptions = {
            plugins: {
                legend: {
                    position: 'top',
                    labels: { 
                        color: textColor, 
                        font: { size: 14 } 
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const label = context.label || '';
                            const value = context.raw;
                            const total = context.chart.getDatasetMeta(0).total;
                            const percentage = ((value / total) * 100).toFixed(2);
                            return `${label}: ${TimerUtils.formatDuration(value)} (${percentage}%)`;
                        }
                    },
                    backgroundColor: isDarkTheme ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: isDarkTheme ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                    borderWidth: 1
                },
                datalabels: {
                    color: isDarkTheme ? 'white' : '#333333',
                    font: { size: 12, weight: 'bold' },
                    align: 'center',
                    anchor: 'center',
                    formatter: (value, context) => {
                        const total = context.chart.getDatasetMeta(0).total;
                        const percentage = ((value / total) * 100).toFixed(1);
                        return `${percentage}%`;
                    }
                }
            }
        };

        this.createChart(canvas, 'doughnut', chartData, chartOptions);
    }

    calculateTagTotalsForPeriod(analytics, targetDate) {
        const totals = {};
        const isWeekly = this.view.showWeekly;

        analytics.forEach(entry => {
            const entryDate = new Date(entry.timestamp);
            const isInPeriod = isWeekly ? this.isInCurrentWeek(entry.timestamp) : entry.timestamp.slice(0, 10) === targetDate;

            if (isInPeriod) {
                (entry.tags || []).forEach(tag => {
                    totals[tag] = (totals[tag] || 0) + entry.duration;
                });
            }
        });

        return totals;
    }

    getDoughnutColors() {
        return [
            '#9050deff',
            '#3678e3ff',
            '#A55B4Bff',
            '#1daec4ff',
            '#d8324eff',
            '#26c2aeff',
            '#28c088ff',
            '#cd742cff',
            '#dc549aff',
            '#5c69dbff',
            '#70839dff',
            '#065084ff',
            '#4F1C51ff'
        ];
    }

    async deleteTagData(tagToDelete, showWeekly) {
        const path = showWeekly ? this.view.weeklyAnalyticsPath : this.view.analyticsPath;
        try {
            const rawData = await this.app.vault.adapter.read(path);
            let analytics = JSON.parse(rawData);
            const updatedAnalytics = analytics.filter(entry => !entry.tags.includes(tagToDelete));
            await this.app.vault.adapter.write(path, JSON.stringify(updatedAnalytics, null, 2));
        } catch (e) {
            console.error(`Error deleting tag data: ${e}`);
        }
    }
}

class TimerAnalyticsView extends obsidian.ItemView {
    constructor(leaf) {
        super(leaf);
        this.chartjsLoaded = false;
        this.analyticsPath = this.app.vault.configDir + '/plugins/tag-timer/analytics.json';
        this.weeklyAnalyticsPath = this.app.vault.configDir + '/plugins/tag-timer/weekly-analytics.json';  
        this.showWeekly = false;
        this.chartManager = new TimerChartManager(this.app, this);
    }

    getViewType() {
        return CONSTANTS.ANALYTICS_VIEW_TYPE;
    }

    getDisplayText() {
        return "Timer Analytics";
    }

    getIcon() {
        return "pie-chart";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("analytics-container");

        if (!this.chartjsLoaded) {
            await this.loadChartJS(container);
        } else {
            this.renderAnalytics();
        }
    }

    async loadChartJS(container) {
        return new Promise((resolve) => {
            const chartScript = document.createElement('script');
            chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            chartScript.onload = () => {
                const datalabelsScript = document.createElement('script');
                datalabelsScript.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0/dist/chartjs-plugin-datalabels.min.js';
                datalabelsScript.onload = () => {
                    this.chartjsLoaded = true;
                    Chart.register(ChartDataLabels);
                    this.renderAnalytics();
                    resolve();
                };
                container.appendChild(datalabelsScript);
            };
            container.appendChild(chartScript);
        });
    }

    async renderAnalytics() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("analytics-container");

        const analyticsPath = this.showWeekly ? this.weeklyAnalyticsPath : this.analyticsPath;
        const analytics = await this.loadAnalyticsData(analyticsPath);

        if (analytics.length === 0) {
            container.createEl("p", { text: `No ${this.showWeekly ? 'weekly' : 'daily'} analytics data found.` });
            return;
        }

        const chartGrid = container.createDiv({ cls: "chart-grid" });

        this.chartManager.createBarChartCard(chartGrid, analytics);
        this.chartManager.createDoughnutChartCard(chartGrid, analytics);
        this.createResetButton(container);
    }

    async loadAnalyticsData(path = null) {
        const targetPath = path || (this.showWeekly ? this.weeklyAnalyticsPath : this.analyticsPath);
        try {
            const rawData = await this.app.vault.adapter.read(targetPath);
            return JSON.parse(rawData);
        } catch (e) {
            return [];
        }
    }

    createResetButton(container) {
        const resetButton = container.createEl("button", { 
            text: `Reset ${this.showWeekly ? 'Weekly' : 'Daily'} Analytics`, 
            cls: "reset-analytics-button" 
        });
        
        resetButton.addEventListener('click', (e) => {
            const menu = new obsidian.Menu();
            menu.addItem((item) =>
                item.setTitle(`Confirm Reset ${this.showWeekly ? 'Weekly' : 'Daily'}`)
                    .setIcon("trash")
                    .onClick(async () => {
                        const path = this.showWeekly ? this.weeklyAnalyticsPath : this.analyticsPath;
                        await this.app.vault.adapter.write(path, JSON.stringify([], null, 2));
                        this.onOpen();
                    })
            );
            menu.showAtMouseEvent(e);
        });
    }

    async onClose() {
        // Nothing to clean up
    }
}

module.exports = TimerPlugin;
