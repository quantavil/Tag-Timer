import { App } from 'obsidian';
import { TimerData, TimerKind, TimerState } from '../types';
import { timerRegex, extractTimerData } from '../editor';
import { currentElapsed } from '../timer';

export interface TimerSession {
    id: string;
    kind: TimerKind;
    state: TimerState;
    elapsed: number;
    /** Clamped: min(elapsed, duration) for countdowns, else elapsed */
    effective: number;
    startedAt: number;
    duration: number;
    filePath: string;
}

export interface VaultAnalytics {
    sessions: TimerSession[];
    todayTotal: number;
    weekTotal: number;
    totalSessions: number;
    completedCountdowns: number;
    activeTimers: number;
    streak: number;
    longestSession: number;
    byFile: Map<string, number>;
    byDay: Map<string, number>;
    recentSessions: TimerSession[];
}

function effectiveTime(data: TimerData): number {
    if (data.kind === 'countdown') {
        return Math.min(data.elapsed, Math.max(0, data.duration));
    }
    return data.elapsed;
}

function startOfDayEpoch(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

function startOfWeekEpoch(date: Date): number {
    const d = new Date(date);
    const day = d.getDay();
    // Monday = start of week
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

function dateKey(epochSec: number): string {
    const d = new Date(epochSec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function computeStreak(byDay: Map<string, number>): number {
    if (byDay.size === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    const cursor = new Date(today);

    // Check today first — if no entry today, start from yesterday
    const todayKey = dateKey(Math.floor(cursor.getTime() / 1000));
    if (!byDay.has(todayKey)) {
        cursor.setDate(cursor.getDate() - 1);
    }

    while (true) {
        const key = dateKey(Math.floor(cursor.getTime() / 1000));
        if (!byDay.has(key)) break;
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
}

export async function scanVault(app: App): Promise<VaultAnalytics> {
    const now = new Date();
    const todayStart = startOfDayEpoch(now);
    const weekStart = startOfWeekEpoch(now);

    const sessions: TimerSession[] = [];
    let todayTotal = 0;
    let weekTotal = 0;
    let totalSessions = 0;
    let completedCountdowns = 0;
    let activeTimers = 0;
    let longestSession = 0;
    const byFile = new Map<string, number>();
    const byDay = new Map<string, number>();

    const files = app.vault.getMarkdownFiles();

    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        if (!content.includes('⏳[')) continue;

        const re = timerRegex();
        let m: RegExpExecArray | null;

        while ((m = re.exec(content)) !== null) {
            const data = extractTimerData(m);
            const isRunning = data.state === 'running';
            const isPaused = data.state === 'paused';

            if (isRunning) activeTimers++;

            const nowSec = Math.floor(now.getTime() / 1000);
            const eff = currentElapsed(data, nowSec);
            
            const session: TimerSession = {
                ...data,
                effective: eff,
                filePath: file.path,
            };

            // Only completed sessions populate the recent list
            if (!isRunning && !isPaused) {
                sessions.push(session);
                totalSessions++;

                if (eff > longestSession) longestSession = eff;

                if (data.kind === 'countdown' && eff >= data.duration && data.duration > 0) {
                    completedCountdowns++;
                }
            }

            // All timers contribute their elapsed time to today's totals
            byFile.set(file.path, (byFile.get(file.path) ?? 0) + eff);

            // For running timers, attribute their live effective time to today. For paused/stopped, use their last state change timestamp.
            const timestamp = isRunning ? nowSec : data.startedAt;
            
            const dk = dateKey(timestamp);
            byDay.set(dk, (byDay.get(dk) ?? 0) + eff);

            if (timestamp >= todayStart) {
                todayTotal += eff;
            }

            if (timestamp >= weekStart) {
                weekTotal += eff;
            }
        }
    }

    // Sort recent sessions by startedAt desc, take last 10
    const recentSessions = sessions
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 10);

    const streak = computeStreak(byDay);

    return {
        sessions,
        todayTotal,
        weekTotal,
        totalSessions,
        completedCountdowns,
        activeTimers,
        streak,
        longestSession,
        byFile,
        byDay,
        recentSessions,
    };
}
