import { Editor } from 'obsidian';
import { TimerData, TimerKind, TimerState } from './types';

export const TIMER_RE = /⏳\[([^|\]]+)\|(?:(stopwatch|countdown)\|)?(running|paused|stopped)\|(\d+)\|(\d+)(?:\|(\d+))?\]/g;
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
        id: m[1],
        kind: (m[2] as TimerKind) ?? 'stopwatch',
        state: m[3] as TimerState,
        elapsed: parseInt(m[4], 10),
        startedAt: parseInt(m[5], 10),
        duration: parseInt(m[6] ?? '0', 10),
        start: m.index,
        end: re.lastIndex,
    };
}

export function render(data: TimerData): string {
    return `⏳[${data.id}|${data.kind}|${data.state}|${data.elapsed}|${data.startedAt}|${data.duration}]`;
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
    const lineText = editor.getLine(line);
    const removeStart = (start > 0 && lineText[start - 1] === ' ') ? start - 1 : start;
    const removeEnd = (end < lineText.length && lineText[end] === ' ') ? end + 1 : end;
    editor.replaceRange('', { line, ch: removeStart }, { line, ch: removeEnd });
}