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
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), sec = s % 60;
    if (m < 60) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
    const h = Math.floor(m / 60), rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
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
