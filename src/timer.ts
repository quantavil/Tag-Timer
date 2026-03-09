import { TimerData } from './types';

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TICK_MS = 1000;
const MAX_GAP_SEC = 60;
const MAX_STEP_SEC = 5;

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
    const gap = Math.max(0, nowSec() - data.startedAt);
    if (gap > MAX_GAP_SEC) return data.elapsed;
    return data.elapsed + Math.min(gap, MAX_STEP_SEC);
}

export function formatDuration(totalSeconds: number): string {
    const s = Math.floor(totalSeconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), sec = s % 60;
    if (m < 60) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
    const h = Math.floor(m / 60), rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

type TickCallback = (id: string) => void;

const intervals = new Map<string, number>();

export function startInterval(id: string, onTick: TickCallback): void {
    if (intervals.has(id)) return;
    const handle = window.setInterval(() => onTick(id), TICK_MS);
    intervals.set(id, handle);
}

export function stopInterval(id: string): void {
    const handle = intervals.get(id);
    if (handle !== undefined) {
        window.clearInterval(handle);
        intervals.delete(id);
    }
}

export function stopAllIntervals(): void {
    for (const handle of intervals.values()) window.clearInterval(handle);
    intervals.clear();
}
