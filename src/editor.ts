import { Editor } from 'obsidian';
import { TimerData, TimerKind, TimerState } from './types';

export const TIMER_RE = /⏳\[([^|\]]+)\|(?:(stopwatch|countdown)\|)?(running|paused|stopped)\|(\d+)\|(\d+)(?:\|(\d+))?\]/g;
const LIST_RE = /^(\s*>?\s*(?:\d+\.\s|[-+*]\s|#+\s))/;

export interface ParsedTimer extends TimerData {
    start: number;
    end: number;
}

/** Single source of truth for regex‑match → TimerData */
export function extractTimerData(m: RegExpExecArray | string[]): TimerData {
    return {
        id: m[1],
        kind: (m[2] as TimerKind) ?? 'stopwatch',
        state: m[3] as TimerState,
        elapsed: parseInt(m[4], 10),
        startedAt: parseInt(m[5], 10),
        duration: parseInt(m[6] ?? '0', 10),
    };
}

export function parse(line: string): ParsedTimer | null {
    const re = new RegExp(TIMER_RE.source, 'g');
    const m = re.exec(line);
    if (!m) return null;
    return { ...extractTimerData(m), start: m.index, end: re.lastIndex };
}

export function render(data: TimerData): string {
    return `⏳[${data.id}|${data.kind}|${data.state}|${data.elapsed}|${data.startedAt}|${data.duration}]`;
}

/** Shared space‑trimming logic used by every removal path */
export function computeRemovalRange(
    lineText: string,
    start: number,
    end: number,
): { from: number; to: number } {
    const hasSpaceBefore = start > 0 && lineText[start - 1] === ' ';
    const hasSpaceAfter = end < lineText.length && lineText[end] === ' ';
    return {
        from: hasSpaceBefore ? start - 1 : start,
        to: hasSpaceAfter && !hasSpaceBefore ? end + 1 : end,
    };
}

export function insertTimer(
    editor: Editor,
    line: number,
    span: string,
    position: 'cursor' | 'head' | 'tail',
): void {
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

export function replaceTimer(
    editor: Editor,
    line: number,
    span: string,
    start: number,
    end: number,
): void {
    editor.replaceRange(span, { line, ch: start }, { line, ch: end });
}

export function removeTimer(
    editor: Editor,
    line: number,
    start: number,
    end: number,
): void {
    const r = computeRemovalRange(editor.getLine(line), start, end);
    editor.replaceRange('', { line, ch: r.from }, { line, ch: r.to });
}