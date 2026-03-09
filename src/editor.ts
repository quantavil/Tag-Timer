import { Editor } from 'obsidian';
import { TimerData } from './types';
import { formatDuration } from './timer';

const TIMER_RE = /<span class="(timer-running|timer-paused)" id="([^"]+)" data-elapsed="(\d+)" data-started-at="(\d+)">[^<]*<\/span>/g;
const LIST_RE = /^(\s*>?\s*(?:\d+\.\s|[-+*]\s|#+\s))/;

export interface ParsedTimer extends TimerData {
    start: number;
    end: number;
}

export function parse(line: string): ParsedTimer | null {
    const re = new RegExp(TIMER_RE.source, 'g');
    const m = re.exec(line);
    if (!m) return null;
    return {
        state: m[1] === 'timer-running' ? 'running' : 'paused',
        id: m[2],
        elapsed: parseInt(m[3], 10),
        startedAt: parseInt(m[4], 10),
        start: m.index,
        end: re.lastIndex,
    };
}

export function render(data: TimerData): string {
    const icon = data.state === 'running' ? (data.elapsed % 2 === 0 ? '⌛' : '⏳') : '⏳';
    const time = formatDuration(data.elapsed);
    return `<span class="timer-${data.state}" id="${data.id}" data-elapsed="${data.elapsed}" data-started-at="${data.startedAt}">${icon} ${time}</span>`;
}

export function insertTimer(editor: Editor, line: number, span: string, position: 'cursor' | 'head' | 'tail'): void {
    if (position === 'cursor') {
        const ch = editor.getCursor().ch;
        editor.replaceRange(' ' + span, { line, ch });
    } else if (position === 'head') {
        const lineText = editor.getLine(line);
        const m = LIST_RE.exec(lineText);
        const ch = m ? m[0].length : 0;
        editor.replaceRange(span + ' ', { line, ch });
    } else {
        const ch = editor.getLine(line).length;
        editor.replaceRange(' ' + span, { line, ch });
    }
}

export function replaceTimer(editor: Editor, line: number, span: string, start: number, end: number): void {
    editor.replaceRange(span, { line, ch: start }, { line, ch: end });
}

export function removeTimer(editor: Editor, line: number, start: number, end: number): void {
    // Also remove a leading or trailing space around the span
    const lineText = editor.getLine(line);
    const removeStart = (start > 0 && lineText[start - 1] === ' ') ? start - 1 : start;
    const removeEnd = (end < lineText.length && lineText[end] === ' ') ? end + 1 : end;
    editor.replaceRange('', { line, ch: removeStart }, { line, ch: removeEnd });
}
