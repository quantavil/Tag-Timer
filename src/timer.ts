import { TimerData } from './types';

export function generateId(): string {
    // We only need a short, reasonably unique string for the editor (e.g. 8 chars of a UUID)
    return crypto.randomUUID().slice(0, 8);
}

export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

export function currentElapsed(data: TimerData): number {
    if (data.state !== 'running') return data.elapsed;
    return data.elapsed + Math.max(0, nowSec() - data.startedAt);
}

export function formatDuration(totalSeconds: number): string {
    const s = Math.floor(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(sec)}`;
    }
    return `${pad(m)}:${pad(sec)}`;
}

export function renderDisplay(data: TimerData): string {
    const cur = currentElapsed(data);
    let icon = '⏳';
    if (data.state === 'running') {
        icon = cur % 2 === 0 ? '⌛' : '⏳';
    } else if (data.state === 'stopped') {
        icon = '⏹️';
    }
    return `${icon} ${formatDuration(cur)}`;
}
