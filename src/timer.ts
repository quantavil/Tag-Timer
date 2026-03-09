import { TimerData } from './types';

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateId(): string {
    let t = Date.now(), res = '';
    while (t > 0) { res = BASE62[t % 62] + res; t = Math.floor(t / 62); }
    return res;
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
    const icon = data.state === 'running' ? (cur % 2 === 0 ? '⌛' : '⏳') : '⏳';
    return `${icon} ${formatDuration(cur)}`;
}
