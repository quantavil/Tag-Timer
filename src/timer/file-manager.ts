import { App, MarkdownView, MarkdownFileInfo } from 'obsidian';
import { TagTimerSettings, TimerData } from '../types';
import { CONSTANTS } from '../constants';
import { TimerRenderer } from '../timer/renderer';
import { TimerParser } from '../timer/parser';

export class TimerFileManager {
    app: App;
    settings: TagTimerSettings;
    locations: Map<string, { view: MarkdownView | MarkdownFileInfo | any, file: any, lineNum: number }>;

    constructor(app: App, settings: TagTimerSettings) { this.app = app; this.settings = settings; this.locations = new Map(); }
    async getLineText(view: any, file: any, lineNum: number): Promise<string> {
        return view.getMode && view.getMode() === 'source' ? view.editor.getLine(lineNum) : (await this.app.vault.read(file)).split('\n')[lineNum] || '';
    }
    async writeTimer(timerId: string, timerData: Partial<TimerData>, view: any, file: any, lineNum: number, parsedResult: any = null): Promise<string> {
        const newSpan = TimerRenderer.render(timerData as TimerData);
        if (view.getMode && view.getMode() === 'preview') await this.writeTimerPreview(file, lineNum, newSpan, parsedResult);
        else this.writeTimerSource(view.editor, lineNum, newSpan, parsedResult, timerId);
        this.locations.set(timerId, { view, file, lineNum }); return timerId;
    }
    async writeTimerPreview(file: any, lineNum: number, newSpan: string, parsedResult: any) {
        await this.app.vault.process(file, (data: string) => {
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
    writeTimerSource(editor: any, lineNum: number, newSpan: string, parsedResult: any, timerId: string) {
        let before, after;
        if (parsedResult?.timerId === timerId) { before = parsedResult.beforeIndex; after = parsedResult.afterIndex; }
        else { const pos = this.calculateInsertPosition(editor, lineNum, this.settings.timerInsertLocation); before = pos.before; after = pos.after; newSpan = ' ' + newSpan; }
        editor.replaceRange(newSpan, { line: lineNum, ch: before }, { line: lineNum, ch: after });
    }
    insertSpanAtPosition(line: string, span: string, pos: { before: number, after: number }) { if (pos.before === 0) return `${span} ${line}`; if (pos.before === line.length) return `${line} ${span}`; return `${line.substring(0, pos.before)} ${span} ${line.substring(pos.before)}`; }
    async updateTimer(timerId: string, timerData: Partial<TimerData>, location: any = null): Promise<boolean> {
        const loc = location || this.locations.get(timerId); if (!loc?.view?.file) return true;
        const { view, file, lineNum } = loc; const lineText = await this.getLineText(view, file, lineNum); const parsed = TimerParser.parse(lineText, timerId);
        if (parsed) { await this.writeTimer(timerId, timerData, view, file, lineNum, parsed); return true; }
        const found = await this.findTimerGlobally(timerId);
        if (found) { await this.writeTimer(timerId, timerData, found.view, found.file, found.lineNum, found.parsed); return true; }
        console.warn(`Timer ${timerId} not found, stopping timer.`); return false;
    }
    async findTimerGlobally(timerId: string): Promise<any> {
        const loc = this.locations.get(timerId); if (!loc) return null; const { view, file } = loc;
        const search = (view.getMode && view.getMode() === 'source') ? this.searchInEditor.bind(this) : this.searchInFile.bind(this);
        return await search(view, file, timerId);
    }
    async searchInEditor(view: any, file: any, timerId: string): Promise<any> { const editor = view.editor; for (let i = 0; i < editor.lineCount(); i++) { const parsed = TimerParser.parse(editor.getLine(i), timerId); if (parsed?.timerId === timerId) return { view, file, lineNum: i, parsed }; } return null; }
    async searchInFile(view: any, file: any, timerId: string): Promise<any> { const content = await this.app.vault.read(file); const lines = content.split('\n'); for (let i = 0; i < lines.length; i++) { const parsed = TimerParser.parse(lines[i], timerId); if (parsed?.timerId === timerId) return { view, file, lineNum: i, parsed }; } return null; }
    calculateInsertPosition(editor: any, lineNum: number, insertLocation: string): { before: number, after: number } {
        const lineText: string = editor.getLine(lineNum) || '';
        if (insertLocation === 'cursor' && editor.getCursor) { const cursor = editor.getCursor(); return { before: cursor.ch, after: cursor.ch }; }
        if (insertLocation === 'head') return this.findHeadPosition(lineText);
        if (insertLocation === 'tail') return { before: lineText.length, after: lineText.length };
        return { before: 0, after: 0 };
    }
    findHeadPosition(lineText: string): { before: number, after: number } { const patterns = [CONSTANTS.REGEX.ORDERED_LIST, CONSTANTS.REGEX.UNORDERED_LIST, CONSTANTS.REGEX.HEADER]; for (const p of patterns) { const m = p.exec(lineText); if (m) return { before: m[0].length, after: m[0].length }; } return { before: 0, after: 0 }; }
    clearLocations() { this.locations.clear(); }
    clearLocationsForFile(filePath: string) {
        for (const [timerId, loc] of this.locations.entries()) {
            if (loc.file?.path === filePath || loc.file === filePath) {
                this.locations.delete(timerId);
            }
        }
    }
    async getTimerContext(timerId: string): Promise<{ lineText: string, filePath: string }> {
        const loc = this.locations.get(timerId); if (!loc?.file) return { lineText: '', filePath: '' };
        const { file, lineNum } = loc; let lineText = ''; try { const content = await this.app.vault.read(file); lineText = (content.split('\n')[lineNum]) || ''; } catch (_) { }
        return { lineText, filePath: file.path };
    }
}
