import { App, TFile, Notice } from 'obsidian';
import { TimerData } from './types';
import { timerRegex, extractTimerData, render, computeRemovalRange } from './editor';
import { TIMER_MUTATED_EVENT } from './timer';

export function updateTimerInContent(
    content: string,
    targetId: string,
    mutator: (data: TimerData) => TimerData | null,
): string {
    const re = timerRegex();
    let m: RegExpExecArray | null;

    while ((m = re.exec(content)) !== null) {
        if (m[1] !== targetId) continue;

        const current = extractTimerData(m);
        const next = mutator(current);
        const start = m.index;
        const end = start + m[0].length;

        if (next === null) {
            const r = computeRemovalRange(content, start, end);
            return content.slice(0, r.from) + content.slice(r.to);
        } else {
            return content.slice(0, start) + render(next) + content.slice(end);
        }
    }

    return content;
}

export async function mutateTimerInFile(
    app: App,
    file: TFile,
    targetId: string,
    mutator: (data: TimerData) => TimerData | null,
): Promise<TimerData | null> {
    let nextData: TimerData | null = null;
    try {
        await app.vault.process(file, (content) =>
            updateTimerInContent(content, targetId, (data) => {
                nextData = mutator(data);
                return nextData;
            }),
        );
    } catch (error) {
        console.error('Timer: failed to update timer', error);
        new Notice('Failed to update timer.');
        return null;
    }

    window.dispatchEvent(new CustomEvent(TIMER_MUTATED_EVENT));
    return nextData;
}
