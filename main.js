'use strict';

const obsidian = require('obsidian');
const { EditorView } = require('@codemirror/view');

// Regex constants
const UPDATE_INTERVAL = 1000;
const ORDERED_LIST = /(^\s*#*\d+\.\s)/;
const UNORDERED_LIST = /(^\s*#*[-/+/*]\s)/;
const HEADER = /(^\s*#+\s)/;

const BASE62_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function compressId(timestamp) {
    if (!timestamp) timestamp = Date.now();
    let num = timestamp;
    if (num === 0) return 't0';

    let result = '';
    while (num > 0) {
        result = BASE62_CHARS[num % 62] + result;
        num = Math.floor(num / 62);
    }
    return result;
}

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

class TimerDataUpdater {
    static calculate(action, oldData, now = Math.floor(Date.now() / 1000)) {
        let newData;
        switch (action) {
            case 'init':
                newData = {
                    class: 'timer-r',
                    timerId: compressId(),
                    dur: 0,
                    ts: now
                };
                break;
            case 'continue':
                newData = { ...oldData, class: 'timer-r', ts: now };
                break;
            case 'pause':
                const elapsed = oldData ? now - oldData.ts : 0;
                newData = { ...oldData, class: 'timer-p', dur: (oldData.dur || 0) + elapsed, ts: now };
                break;
            case 'update':
                if (oldData.class !== 'timer-r') return oldData;
                const updateElapsed = now - oldData.ts;
                newData = { ...oldData, dur: (oldData.dur || 0) + updateElapsed, ts: now };
                break;
            case 'restore':
                const restoreElapsed = oldData ? now - oldData.ts : 0;
                newData = { ...oldData, class: 'timer-r', dur: (oldData.dur || 0) + restoreElapsed, ts: now };
                break;
            case 'forcepause':
                newData = { ...oldData, class: 'timer-p' };
                break;
            default:
                newData = oldData;
                break;
        }
        return newData;
    }
}

class TimerManager {
    constructor() {
        this.timers = new Map(); // timerId -> { intervalId, data }
        this.startedIds = new Set(); // Tracks all timerIds started in this session
    }

    startTimer(timerId, initialData, tickCallback) {
        if (this.hasTimer(timerId)) {
            return;
        }
        const intervalId = setInterval(() => {
            tickCallback(timerId);
        }, UPDATE_INTERVAL);
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
        if (timer) {
            timer.data = newData;
        }
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
        this.locations = new Map(); // timerId -> { view, file, lineNum }
    }

    async writeTimer(timerId, timerData, view, file, lineNum, parsedResult = null) {
        if (view.getMode() === 'preview') {
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            let modified = false;
            let line = lines[lineNum];
            const newSpan = TimerRenderer.render(timerData);
            const timerRE = /<span class="timer-[rp]"[^>]*>.*?<\/span>/;

            if (line.match(timerRE)) {
                lines[lineNum] = line.replace(timerRE, newSpan);
                modified = true;
            } else if (parsedResult === null) {
                const position = this.calculateInsertPosition({ getLine: () => line }, 0, this.settings.timerInsertLocation);
                if (position.before === 0) {
                    lines[lineNum] = newSpan + ' ' + line;
                } else if (position.before === line.length) {
                    lines[lineNum] = line + ' ' + newSpan;
                } else {
                    lines[lineNum] = line.substring(0, position.before) + ' ' + newSpan + ' ' + line.substring(position.before);
                }
                modified = true;
            }

            if (modified) {
                await this.app.vault.modify(file, lines.join('\n'));
            }
        } else { // Source mode
            const editor = view.editor;
            const newSpan = TimerRenderer.render(timerData);
            let before, after;
            let needsSpacing = false;

            if (parsedResult && parsedResult.timerId === timerId) {
                before = parsedResult.beforeIndex;
                after = parsedResult.afterIndex;
            } else {
                const position = this.calculateInsertPosition(editor, lineNum, this.settings.timerInsertLocation);
                before = position.before;
                after = position.after;
                needsSpacing = true;
            }

            const finalSpan = needsSpacing ? ' ' + newSpan + ' ' : newSpan;
            editor.replaceRange(finalSpan, { line: lineNum, ch: before }, { line: lineNum, ch: after });
        }
        this.locations.set(timerId, { view, file, lineNum });
        return timerId;
    }

    async updateTimerByIdWithSearch(timerId, timerData) {
        const location = this.locations.get(timerId);
        if (!location || !location.view.file) {
            return this.settings.autoStopTimers !== 'close';
        }

        const { view, file, lineNum } = location;
        let lineText;
        if (view.getMode() === 'source') {
            lineText = view.editor.getLine(lineNum);
        } else if (view.getMode() === 'preview') {
            const content = await this.app.vault.read(file);
            lineText = content.split('\n')[lineNum] || '';
        }

        const parsed = TimerParser.parse(lineText, 'auto', timerId);
        if (parsed) {
            this.writeTimer(timerId, timerData, view, file, lineNum, parsed);
            return true;
        } else {
            const found = await this.findTimerGlobally(timerId);
            if (found) {
                this.writeTimer(timerId, timerData, found.view, found.file, found.lineNum, found.parsed);
                return true;
            } else {
                console.warn(`Timer with ID ${timerId} not found in file ${file.path}, stopping timer.`);
                return false;
            }
        }
    }

    async findTimerGlobally(timerId) {
        const location = this.locations.get(timerId);
        if (!location) return null;

        const { view, file } = location;
        if (view.getMode() === 'source') {
            const editor = view.editor;
            for (let i = 0; i < editor.lineCount(); i++) {
                const parsed = TimerParser.parse(editor.getLine(i), 'auto', timerId);
                if (parsed && parsed.timerId === timerId) {
                    return { view, file, lineNum: i, parsed };
                }
            }
        } else if (view.getMode() === 'preview') {
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const parsed = TimerParser.parse(lines[i], 'auto', timerId);
                if (parsed && parsed.timerId === timerId) {
                    return { view, file, lineNum: i, parsed };
                }
            }
        }
        return null;
    }

    calculateInsertPosition(editor, lineNum, insertLocation) {
        const lineText = editor.getLine(lineNum) || '';
        if (insertLocation === 'head') {

            const orderedListMatch = ORDERED_LIST.exec(lineText);
            if (orderedListMatch) return { before: orderedListMatch[0].length, after: orderedListMatch[0].length };

            const ulMatch = UNORDERED_LIST.exec(lineText);
            if (ulMatch) return { before: ulMatch[0].length, after: ulMatch[0].length };

            const headerMatch = HEADER.exec(lineText);
            if (headerMatch) return { before: headerMatch[0].length, after: headerMatch[0].length };

            return { before: 0, after: 0 };
        } else if (insertLocation === 'tail') {
            return { before: lineText.length, after: lineText.length };
        }
        return { before: 0, after: 0 }; // Default to head
    }

    clearLocations() {
        this.locations.clear();
    }

    async upgradeOldTimers(file) {
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let modified = false;
        const oldSpanRegex = /<span class="timer-btn"[^>]*>.*?<\/span>/;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (!line.includes('timer-btn')) continue;

            const parsed = TimerParser.parse(line, 'v1');
            if (parsed) {
                modified = true;
                const newSpan = TimerRenderer.render(parsed);
                lines[i] = line.replace(oldSpanRegex, newSpan);
            }
        }

        if (modified) {
            await this.app.vault.modify(file, lines.join('\n'));
        }
    }
}

class TimerRenderer {
    static render(timerData) {
        const totalSeconds = timerData.dur;
        const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        const formatted = `${hours}:${minutes}:${seconds}`;
        
        let timerIcon = '⏳';
        if (timerData.class === 'timer-r') {
            timerIcon = totalSeconds % 2 === 0 ? '⌛' : '⏳';
        }

        return `<span class="${timerData.class}" id="${timerData.timerId}" data-dur="${timerData.dur}" data-ts="${timerData.ts}">【${timerIcon}${formatted} 】</span>`;
    }
}

class TimerParser {
    static parse(lineText, version = 'auto', targetTimerId = null) {
        const tpl = document.createElement('template');
        tpl.innerHTML = lineText;

        if (version === 'v1' || version === 'auto') {
            const oldSelector = targetTimerId ? `.timer-btn[timerId="${targetTimerId}"]` : '.timer-btn';
            const oldTimer = tpl.content.querySelector(oldSelector);
            if (oldTimer) return this.parseOldFormat(lineText, oldTimer);
        }
        if (version === 'v2' || version === 'auto') {
            const newSelector = targetTimerId ? `.timer-r[id="${targetTimerId}"], .timer-p[id="${targetTimerId}"]` : '.timer-r, .timer-p';
            const newTimer = tpl.content.querySelector(newSelector);
            if (newTimer) return this.parseNewFormat(lineText, newTimer);
        }
        return null;
    }

    static parseOldFormat(lineText, timerEl) {
        const oldId = timerEl.getAttribute('timerId') || timerEl.getAttribute('data-timerId');
        const status = timerEl.getAttribute('Status') || timerEl.getAttribute('data-Status');
        const dur = parseInt(timerEl.getAttribute('AccumulatedTime') || timerEl.getAttribute('data-AccumulatedTime'), 10);
        const ts = parseInt(timerEl.getAttribute('currentStartTimeStamp') || timerEl.getAttribute('data-currentStartTimeStamp'), 10);
        const newId = oldId ? compressId(parseInt(oldId)) : compressId();
        const regex = new RegExp(`<span[^>]*timerId="${oldId}"[^>]*>.*?<\/span>`);
        const match = lineText.match(regex);
        if (!match) return null;

        return {
            class: status === 'Running' ? 'timer-r' : 'timer-p',
            timerId: newId,
            dur: dur,
            ts: ts,
            beforeIndex: match.index,
            afterIndex: match.index + match[0].length
        };
    }

    static parseNewFormat(lineText, timerEl) {
        const timerId = timerEl.id;
        const regex = new RegExp(`<span[^>]*id="${timerId}"[^>]*>.*?<\/span>`);
        const match = lineText.match(regex);
        if (!match) return null;

        return {
            class: timerEl.className,
            timerId: timerId,
            dur: parseInt(timerEl.dataset.dur, 10),
            ts: parseInt(timerEl.dataset.ts, 10),
            beforeIndex: match.index,
            afterIndex: match.index + match[0].length
        };
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
            lastResetDate: ''
        };
        await this.loadSettings();
        this.fileManager = new TimerFileManager(this.app, this.settings);

        this.handleDailyReset();

        this.addCommand({
            id: 'toggle-timer',
            icon: 'alarm-clock',
            name: LANG.command_name.toggle,
            editorCallback: (editor, view) => {
                const lineNum = editor.getCursor().line;
                const lineText = editor.getLine(lineNum);
                const parsed = TimerParser.parse(lineText, 'auto');
                if (parsed) {
                    if (parsed.class === 'timer-r') this.handlePause(view, lineNum, parsed);
                    else if (parsed.class === 'timer-p') this.handleContinue(view, lineNum, parsed);
                } else {
                    this.handleStart(view, lineNum);
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
                if (parsed) this.handleDelete(view, lineNum, parsed);
            },
        });

        this.registerEvent(this.app.workspace.on('editor-menu', this.onEditorMenu.bind(this)));
        this.registerEvent(this.app.workspace.on('file-open', this.onFileOpen.bind(this)));
        this.app.workspace.onLayoutReady(() => this.restoreAllTimers());

        this.addSettingTab(new TimerSettingTab(this.app, this));

        this.registerView(
            ANALYTICS_VIEW_TYPE,
            (leaf) => new TimerAnalyticsView(leaf)
        );

        this.addRibbonIcon("pie-chart", "Open Timer Analytics", () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-timer-analytics',
            name: 'Open Timer Analytics',
            callback: () => {
                this.activateView();
            },
        });

        this.addCommand({
            id: 'reset-timer-analytics',
            name: 'Reset Timer Analytics',
            callback: async () => {
                const confirmation = confirm("Are you sure you want to delete all analytics data?");
                if (confirmation) {
                    const analyticsPath = this.app.vault.configDir + '/plugins/text-block-timer/analytics.json';
                    await this.app.vault.adapter.write(analyticsPath, JSON.stringify([], null, 2));
                    // Refresh the view if it's open
                    const leaves = this.app.workspace.getLeavesOfType(ANALYTICS_VIEW_TYPE);
                    if (leaves.length > 0) {
                        leaves[0].view.onOpen();
                    }
                }
            },
        });
    }

    onunload() {
        this.manager.clearAll();
        this.fileManager.clearLocations();
    }

    onEditorMenu(menu, editor, view) {
        const lineNum = editor.getCursor().line;
        const lineText = editor.getLine(lineNum);
        const parsed = TimerParser.parse(lineText, 'auto');

        if (parsed) {
            if (parsed.class === 'timer-r') {
                menu.addItem(item => item.setTitle(LANG.action_paused).setIcon('pause').onClick(() => this.handlePause(view, lineNum, parsed)));
            } else {
                menu.addItem(item => item.setTitle(LANG.action_continue).setIcon('play').onClick(() => this.handleContinue(view, lineNum, parsed)));
            }
            menu.addItem(item => item.setTitle(LANG.command_name.delete).setIcon('trash').onClick(() => this.handleDelete(view, lineNum, parsed)));
        } else {
            menu.addItem(item => item.setTitle(LANG.action_start).setIcon('play').onClick(() => this.handleStart(view, lineNum)));
        }
    }

    

    handleStart(view, lineNum) {
        const initialData = TimerDataUpdater.calculate('init', {});
        this.manager.startTimer(initialData.timerId, initialData, this.onTick.bind(this));
        this.fileManager.writeTimer(initialData.timerId, initialData, view, view.file, lineNum, null);
    }

    handleContinue(view, lineNum, parsedData) {
        if (!parsedData?.timerId) return;
        const { timerId } = parsedData;
        const currentData = this.manager.getTimerData(timerId) || parsedData;
        const newData = TimerDataUpdater.calculate('continue', currentData);
        this.manager.startTimer(timerId, newData, this.onTick.bind(this));
        this.fileManager.writeTimer(timerId, newData, view, view.file, lineNum, parsedData);
    }

    handlePause(view, lineNum, parsedData) {
        if (!parsedData?.timerId) return;
        const { timerId } = parsedData;
        const currentData = this.manager.getTimerData(timerId) || parsedData;
        const newData = TimerDataUpdater.calculate('pause', currentData);
        this.manager.stopTimer(timerId);
        this.fileManager.writeTimer(timerId, newData, view, view.file, lineNum, parsedData);
        this.logAnalytics(newData, view.editor.getLine(lineNum), view.file.path);
    }

    handleDelete(view, lineNum, parsedData) {
        if (!parsedData?.timerId) return;
        const { timerId } = parsedData;
        this.manager.stopTimer(timerId);
        this.fileManager.locations.delete(timerId);
        if (view.getMode() === 'source') {
            view.editor.replaceRange('', { line: lineNum, ch: parsedData.beforeIndex }, { line: lineNum, ch: parsedData.afterIndex });
        }
        this.logAnalytics(parsedData, view.editor.getLine(lineNum), view.file.path);
        // Clean up the state for the deleted timer
        if (this.settings.timersState && this.settings.timersState[timerId]) {
            delete this.settings.timersState[timerId];
            this.saveSettings();
        }
    }

    handleRestore(view, lineNum, parsedData) {
        if (!parsedData?.timerId) return;
        const { timerId } = parsedData;
        const newData = TimerDataUpdater.calculate('restore', parsedData);
        this.manager.startTimer(timerId, newData, this.onTick.bind(this));
        this.fileManager.writeTimer(timerId, newData, view, view.file, lineNum, parsedData);
    }

    handleForcePause(view, lineNum, parsedData) {
        if (!parsedData?.timerId) return;
        const newData = TimerDataUpdater.calculate('forcepause', parsedData);
        this.fileManager.writeTimer(parsedData.timerId, newData, view, view.file, lineNum, parsedData);
    }

    async onTick(timerId) {
        const oldData = this.manager.getTimerData(timerId);
        if (!oldData || oldData.class !== 'timer-r') return;

        const newData = TimerDataUpdater.calculate('update', oldData);
        this.manager.updateTimerData(timerId, newData);

        const updated = await this.fileManager.updateTimerByIdWithSearch(timerId, newData);
        if (!updated) {
            this.manager.stopTimer(timerId);
        }
    }

    async onFileOpen(file) {
        if (file) {
            await this.fileManager.upgradeOldTimers(file);
            const view = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
            if (view && view.file === file) {
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
                if (autoStopTimers === 'never' || (autoStopTimers === 'quit' && this.manager.isStartedInThisSession(parsed.timerId))) {
                    this.handleRestore(view, i, parsed);
                } else {
                    this.handleForcePause(view, i, parsed);
                }
            }
        }
    }

    async activateView() {
        this.app.workspace.detachLeavesOfType(ANALYTICS_VIEW_TYPE);

        await this.app.workspace.getRightLeaf(false).setViewState({
            type: ANALYTICS_VIEW_TYPE,
            active: true,
        });

        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(ANALYTICS_VIEW_TYPE)[0]
        );
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

    async logAnalytics(timerData, lineText, filePath) {
        const { timerId, dur } = timerData;
        if (!timerId) return;

        // Ensure timersState exists
        if (!this.settings.timersState) {
            this.settings.timersState = {};
        }

        const lastLoggedDur = this.settings.timersState[timerId] || 0;
        const durationIncrement = dur - lastLoggedDur;

        // Only log if there's a positive increment
        if (durationIncrement <= 0) {
            return;
        }

        const tags = lineText.match(/#\w+/g) || [];
        const analyticsData = {
            timestamp: new Date().toISOString(),
            duration: durationIncrement,
            file: filePath,
            tags: tags
        };

        const analyticsPath = this.app.vault.configDir + '/plugins/text-block-timer/analytics.json';
        try {
            let analytics = [];
            try {
                const rawData = await this.app.vault.adapter.read(analyticsPath);
                if (rawData) {
                    analytics = JSON.parse(rawData);
                }
            } catch (readError) {
                // File might not exist, which is fine.
            }
            
            analytics.push(analyticsData);
            await this.app.vault.adapter.write(analyticsPath, JSON.stringify(analytics, null, 2));

            // Update the state and save
            this.settings.timersState[timerId] = dur;
            await this.saveSettings();

        } catch (e) {
            console.error("Error writing analytics data:", e);
        }
    }

    async handleDailyReset() {
        if (!this.settings.dailyReset) return;

        const today = new Date().toISOString().slice(0, 10);
        if (this.settings.lastResetDate !== today) {
            const analyticsPath = this.app.vault.configDir + '/plugins/text-block-timer/analytics.json';
            await this.app.vault.adapter.write(analyticsPath, JSON.stringify([], null, 2));
            this.settings.lastResetDate = today;
            await this.saveSettings();

            // Refresh the view if it's open
            const leaves = this.app.workspace.getLeavesOfType(ANALYTICS_VIEW_TYPE);
            if (leaves.length > 0) {
                leaves[0].view.onOpen();
            }
        }
    }
    
}

class TimerSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    processPath(filePath) {
        // This logic seems intended to ensure directory paths end with a slash.
        if (filePath.endsWith('/') || filePath.split('/').pop().includes('.')) {
            return filePath;
        }
        return filePath + '/';
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        const lang = LANG.settings;

        containerEl.createEl('h1', { text: lang.name });
        containerEl.createEl('p', { text: lang.desc });

        const tutorialInfo = containerEl.createEl('div', { cls: 'tutorial-info' });
        const tutorialP = tutorialInfo.createEl('p');
        tutorialP.appendText(lang.tutorial);
        tutorialP.createEl('a', {
            text: 'GitHub',
            href: 'https://github.com/quantavil/text-block-timer',
            target: '_blank'
        });
        containerEl.createEl('p', { text: lang.askforvote });
        containerEl.createEl('p', { text: lang.issue });

        containerEl.createEl('h3', { text: lang.sections.basic.name });

        new obsidian.Setting(containerEl)
            .setName("Daily Analytics Reset")
            .setDesc("Automatically reset all analytics data at the start of a new day.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.dailyReset)
                .onChange(async (value) => {
                    this.plugin.settings.dailyReset = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName(lang.autostop.name).setDesc(lang.autostop.desc)
            .addDropdown(dd => dd
                .addOption('never', lang.autostop.choice.never)
                .addOption('quit', lang.autostop.choice.quit)
                .addOption('close', lang.autostop.choice.close)
                .setValue(this.plugin.settings.autoStopTimers)
                .onChange(async (value) => {
                    this.plugin.settings.autoStopTimers = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName(lang.insertlocation.name).setDesc(lang.insertlocation.desc)
            .addDropdown(dd => dd
                .addOption('head', lang.insertlocation.choice.head)
                .addOption('tail', lang.insertlocation.choice.tail)
                .setValue(this.plugin.settings.timerInsertLocation)
                .onChange(async (value) => {
                    this.plugin.settings.timerInsertLocation = value;
                    await this.plugin.saveSettings();
                }));
    }
}

module.exports = TimerPlugin;

const ANALYTICS_VIEW_TYPE = "timer-analytics-view";

class TimerAnalyticsView extends obsidian.ItemView {
    constructor(leaf) {
        super(leaf);
        this.chartjsLoaded = false;
        this.analyticsPath = this.app.vault.configDir + '/plugins/text-block-timer/analytics.json';
    }

    getViewType() {
        return ANALYTICS_VIEW_TYPE;
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
            const chartScript = document.createElement('script');
            chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            chartScript.onload = () => {
                const datalabelsScript = document.createElement('script');
                datalabelsScript.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0/dist/chartjs-plugin-datalabels.min.js';
                datalabelsScript.onload = () => {
                    this.chartjsLoaded = true;
                    Chart.register(ChartDataLabels);
                    this.renderAnalytics();
                };
                container.appendChild(datalabelsScript);
            };
            container.appendChild(chartScript);
        } else {
            this.renderAnalytics();
        }
    }

    async renderAnalytics() {
        const container = this.containerEl.children[1];
        container.empty(); // Clear previous content
        container.addClass("analytics-container");

        let analytics = [];
        try {
            const rawData = await this.app.vault.adapter.read(this.analyticsPath);
            analytics = JSON.parse(rawData);
        } catch (e) {
            container.createEl("p", { text: "No analytics data found." });
            return;
        }

        if (analytics.length === 0) {
            container.createEl("p", { text: "No analytics data found." });
            return;
        }

        const chartGrid = container.createDiv({ cls: "chart-grid" });

        // Tag Totals - Horizontal Bar Chart
        const barCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        barCard.createEl("h3", { text: "Analytics" });
        const barCanvasContainer = barCard.createDiv({cls: "canvas-container"});
        const barChartCanvas = barCanvasContainer.createEl("canvas");
        this.createBarChart(barChartCanvas, analytics);

        // Daily Distribution - Doughnut Chart
        const doughnutCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        doughnutCard.createEl("h3", { text: "Today's Focus" });
        const doughnutCanvasContainer = doughnutCard.createDiv({cls: "canvas-container"});
        const doughnutChartCanvas = doughnutCanvasContainer.createEl("canvas");
        this.createDoughnutChart(doughnutChartCanvas, analytics);

        const today = new Date().toISOString().slice(0, 10);
        const dailyTotal = analytics
            .filter(entry => entry.timestamp.slice(0, 10) === today)
            .reduce((total, entry) => total + entry.duration, 0);

        const dailyTotalEl = doughnutCard.createEl("p", { cls: "daily-total" });
        dailyTotalEl.setText(`Today's Total: ${this.formatDuration(dailyTotal)}`);


        // Reset Button at the bottom
        const resetButton = container.createEl("button", { text: "Reset All Analytics", cls: "reset-analytics-button" });
        resetButton.addEventListener('click', (e) => {
            const menu = new obsidian.Menu();
            menu.addItem((item) =>
                item
                    .setTitle("Confirm Reset")
                    .setIcon("trash")
                    .onClick(async () => {
                        await this.app.vault.adapter.write(this.analyticsPath, JSON.stringify([], null, 2));
                        this.onOpen(); // Refresh the view
                    })
            );
            menu.showAtMouseEvent(e);
        });
    }

    createBarChart(canvas, analytics) {
        const tagTotals = {};
        analytics.forEach(entry => {
            (entry.tags || []).forEach(tag => {
                if (!tagTotals[tag]) {
                    tagTotals[tag] = 0;
                }
                tagTotals[tag] += entry.duration;
            });
        });

        const sortedTags = Object.entries(tagTotals).sort(([, a], [, b]) => a - b);

        const chart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: sortedTags.map(([tag]) => this.formatTagLabel(tag)),
                datasets: [{
                    label: 'Total Time',
                    data: sortedTags.map(([, duration]) => duration),
                    backgroundColor: (context) => {
                        const chart = context.chart;
                        const {ctx, chartArea} = chart;

                        if (!chartArea) {
                            return null;
                        }
                        const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
                        gradient.addColorStop(0, 'rgba(54, 162, 235, 0.8)');
                        gradient.addColorStop(1, 'rgba(153, 102, 255, 0.8)');
                        return gradient;
                    },
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    borderRadius: 6,
                    hoverBackgroundColor: 'rgba(54, 162, 235, 1)'
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false,
                    },
                    y: {
                        ticks: {
                            color: 'white',
                            font: {
                                size: 14
                            }
                        },
                        grid: {
                            display: false
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    layout : {
                        padding: {
                            right: 50,
                        }
                    },
                    tooltip: {
                        enabled: false
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'start',
                        color: 'white',
                        font: {
                            size: 14,
                            weight: 'bold'
                        },
                        formatter: (value) => this.formatDuration(value),
                        clamp: true
                    }
                }
            }
        });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
            if (points.length) {
                const firstPoint = points[0];
                const label = chart.data.labels[firstPoint.index];
                const tagToDelete = `#${label}`;

                const menu = new obsidian.Menu();
                menu.addItem((item) =>
                    item
                        .setTitle(`Delete "${label}"`)
                        .setIcon("trash")
                        .onClick(() => {
                            this.deleteTagData(tagToDelete).then(() => {
                                this.onOpen();
                            });
                        })
                );
                menu.showAtMouseEvent(e);
            }
        });
    }

    createDoughnutChart(canvas, analytics) {
        const today = new Date().toISOString().slice(0, 10);
        const dailyTagTotals = {};
        analytics
            .filter(entry => entry.timestamp.slice(0, 10) === today)
            .forEach(entry => {
                (entry.tags || []).forEach(tag => {
                    if (!dailyTagTotals[tag]) {
                        dailyTagTotals[tag] = 0;
                    }
                    dailyTagTotals[tag] += entry.duration;
                });
            });

        if (Object.keys(dailyTagTotals).length === 0) {
            const p = canvas.parentElement.createEl('p', {text: 'No data for today.'});
            p.style.textAlign = 'center';
            canvas.remove();
            return;
        }

        new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(dailyTagTotals).map(tag => this.formatTagLabel(tag)),
                datasets: [{
                    label: 'Time Spent Today',
                    data: Object.values(dailyTagTotals),
                    backgroundColor: [
                        '#1E88E5', // Blue
                        '#F4511E', // Deep Orange
                        '#FBBC05', // Google Yellow
                        '#34A853', // Google Green
                        '#8E44AD', // Wisteria
                        '#E91E63', // Pink
                        '#00ACC1', // Cyan
                        '#FDD835', // Yellow
                        '#7CB342', // Light Green
                        '#5E35B1'  // Deep Purple
                    ],
                    borderColor: '#333333',
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: 'white',
                            font: {
                                size: 14
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.raw;
                                const total = context.chart.getDatasetMeta(0).total;
                                const percentage = ((value / total) * 100).toFixed(2);
                                return `${label}: ${this.formatDuration(value)} (${percentage}%)`;
                            }
                        }
                    },
                    datalabels: {
                        color: 'white',
                        font: {
                            size: 12,
                            weight: 'bold'
                        },
                        align: 'center',
                        anchor: 'center',
                        formatter: (value, context) => {
                            const total = context.chart.getDatasetMeta(0).total;
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${percentage}%`;
                        }
                    }
                }
            }
        });
    }


    formatDuration(totalSeconds) {
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

    formatTagLabel(tag) {
        return tag.startsWith('#') ? tag.substring(1) : tag;
    }

    async onClose() {
        // Nothing to clean up.
    }

    async deleteTagData(tagToDelete) {
        const analyticsPath = this.app.vault.configDir + '/plugins/text-block-timer/analytics.json';
        try {
            const rawData = await this.app.vault.adapter.read(analyticsPath);
            let analytics = JSON.parse(rawData);
            const updatedAnalytics = analytics.filter(entry => !entry.tags.includes(tagToDelete));
            await this.app.vault.adapter.write(analyticsPath, JSON.stringify(updatedAnalytics, null, 2));
        } catch (e) {
            console.error(`Error deleting tag data: ${e}`);
        }
    }
}


