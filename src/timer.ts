import { TimerData } from './types';

export const TIMER_MUTATED_EVENT = 'obsidian-timer-mutated';

export function generateId(): string {
    return crypto.randomUUID().slice(0, 8);
}

export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function clampSeconds(value: number): number {
    return Math.max(0, Math.floor(value));
}

export function currentElapsed(data: TimerData, ref = nowSec()): number {
    const base = data.state === 'running'
        ? data.elapsed + Math.max(0, ref - data.startedAt)
        : data.elapsed;

    if (data.kind === 'countdown') {
        return Math.min(clampSeconds(base), Math.max(0, data.duration));
    }

    return clampSeconds(base);
}

export function currentRemaining(data: TimerData, ref = nowSec()): number {
    if (data.kind !== 'countdown') return 0;
    return Math.max(0, data.duration - currentElapsed(data, ref));
}

export function pauseData(data: TimerData, ref = nowSec()): TimerData {
    const elapsed = currentElapsed(data, ref);

    if (data.kind === 'countdown' && elapsed >= data.duration) {
        return { ...data, state: 'stopped', elapsed: data.duration, startedAt: ref };
    }

    return { ...data, state: 'paused', elapsed, startedAt: ref };
}

export function resumeData(data: TimerData, ref = nowSec()): TimerData {
    const elapsed = data.state === 'stopped' ? 0 : currentElapsed(data, ref);

    return {
        ...data,
        state: 'running',
        elapsed: data.kind === 'countdown' ? Math.min(elapsed, data.duration) : elapsed,
        startedAt: ref,
    };
}

export function stopData(data: TimerData, ref = nowSec()): TimerData {
    return { ...data, state: 'stopped', elapsed: currentElapsed(data, ref), startedAt: ref };
}

export function resetData(data: TimerData, ref = nowSec()): TimerData {
    return { ...data, state: 'paused', elapsed: 0, startedAt: ref };
}

export function setDisplayedSeconds(data: TimerData, seconds: number, ref = nowSec()): TimerData {
    const value = clampSeconds(seconds);

    if (data.kind === 'countdown') {
        return {
            ...data,
            duration: value,
            elapsed: 0,
            startedAt: ref,
            state: data.state === 'stopped' ? 'paused' : data.state,
        };
    }

    return {
        ...data,
        elapsed: value,
        startedAt: ref,
        state: data.state === 'stopped' ? 'paused' : data.state,
    };
}

export function formatDuration(totalSeconds: number): string {
    const s = clampSeconds(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');

    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function parseDurationInput(raw: string): number | null {
    const value = raw.trim();
    if (!value) return null;

    if (/^\d+$/.test(value)) return parseInt(value, 10) * 60;

    const parts = value.split(':').map((p) => p.trim());
    if (!parts.every((p) => /^\d+$/.test(p))) return null;

    if (parts.length === 2) {
        const [m, s] = parts.map((p) => parseInt(p, 10));
        if (s > 59) return null;
        return m * 60 + s;
    }

    if (parts.length === 3) {
        const [h, m, s] = parts.map((p) => parseInt(p, 10));
        if (m > 59 || s > 59) return null;
        return h * 3600 + m * 60 + s;
    }

    return null;
}

export function playBeep() {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch {}
}

/** Both stopwatch and countdown use ⏳/⌛ when running */
export function renderDisplay(data: TimerData): string {
    const shown = data.kind === 'countdown'
        ? currentRemaining(data)
        : currentElapsed(data);

    let icon: string;

    if (data.state === 'running') {
        icon = '⌛';
    } else if (data.state === 'stopped') {
        icon = '⏹️';
    } else {
        icon = '⏳';
    }

    return `${icon} ${formatDuration(shown)}`;
}