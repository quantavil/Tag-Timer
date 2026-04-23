import { App } from 'obsidian';
import { VaultAnalytics } from './scanner';
import { formatDuration } from '../timer';

/** Human-friendly relative time: "2m ago", "3h ago", "yesterday" */
function timeAgo(epochSec: number): string {
    const diff = Math.floor(Date.now() / 1000) - epochSec;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 172800) return 'yesterday';
    return `${Math.floor(diff / 86400)}d ago`;
}

function fileName(path: string): string {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    return name.replace(/\.md$/, '');
}

/** Short day names, Monday-first */
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDays(): { key: string; label: string; isToday: boolean }[] {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const day = today.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - mondayOffset);

    const days: { key: string; label: string; isToday: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        days.push({
            key: `${y}-${m}-${dd}`,
            label: DAY_NAMES[i],
            isToday: d.getTime() === today.getTime(),
        });
    }
    return days;
}

function formatHM(seconds: number): string {
    if (seconds === 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
    return `${m}m`;
}

function createSection(parent: HTMLElement, title: string): HTMLElement {
    const section = parent.createDiv({ cls: 'ta-section' });
    section.createDiv({ cls: 'ta-section-title', text: title });
    return section;
}

function createStatRow(parent: HTMLElement, label: string, value: string, cls?: string): void {
    const row = parent.createDiv({ cls: 'ta-stat' });
    row.createSpan({ cls: 'ta-stat-label', text: label });
    row.createSpan({ cls: `ta-stat-value ${cls ?? ''}`.trim(), text: value });
}

export function renderAnalytics(container: HTMLElement, data: VaultAnalytics, app: App): void {
    container.empty();
    container.addClass('timer-analytics-root');

    // ── Empty state ──
    if (data.totalSessions === 0 && data.activeTimers === 0) {
        const empty = container.createDiv({ cls: 'ta-empty' });
        empty.createSpan({ text: 'No timer data found.' });
        empty.createEl('br');
        empty.createSpan({ text: 'Start a timer to see analytics!' });
        return;
    }

    // ── Summary stats ──
    const summary = createSection(container, 'Summary');

    createStatRow(summary, 'Today', formatHM(data.todayTotal));
    createStatRow(summary, 'This Week', formatHM(data.weekTotal));
    createStatRow(summary, 'Sessions', String(data.totalSessions));

    if (data.completedCountdowns > 0) {
        createStatRow(summary, 'Completed 🍅', String(data.completedCountdowns));
    }

    if (data.activeTimers > 0) {
        createStatRow(summary, 'Active now', String(data.activeTimers), 'ta-active');
    }

    if (data.streak > 0) {
        createStatRow(summary, 'Streak', `${data.streak} day${data.streak > 1 ? 's' : ''} 🔥`);
    }

    // ── By File (top 10) ──
    if (data.byFile.size > 0) {
        const fileSection = createSection(container, 'By File');

        const sorted = [...data.byFile.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const maxTime = sorted[0]?.[1] ?? 1;

        for (const [path, seconds] of sorted) {
            const row = fileSection.createDiv({ cls: 'ta-file-row' });
            row.addEventListener('click', () => {
                app.workspace.openLinkText(path, '');
            });

            const info = row.createDiv({ cls: 'ta-file-info' });
            info.createSpan({ cls: 'ta-file-name', text: `📄 ${fileName(path)}` });
            info.createSpan({ cls: 'ta-file-time', text: formatHM(seconds) });

            const barTrack = row.createDiv({ cls: 'ta-bar-track' });
            const bar = barTrack.createDiv({ cls: 'ta-bar' });
            bar.style.width = `${Math.max(4, (seconds / maxTime) * 100)}%`;
        }
    }

    // ── Weekly Trend ──
    const weekSection = createSection(container, 'Weekly Trend');
    const weekDays = getWeekDays();
    const weekMax = weekDays.reduce((max, d) => {
        const sec = data.byDay.get(d.key) ?? 0;
        return sec > max ? sec : max;
    }, 1);

    for (const day of weekDays) {
        const seconds = data.byDay.get(day.key) ?? 0;
        const row = weekSection.createDiv({ cls: `ta-week-row ${day.isToday ? 'ta-today' : ''}` });

        row.createSpan({ cls: 'ta-week-day', text: day.label });

        const barTrack = row.createDiv({ cls: 'ta-bar-track' });
        if (seconds > 0) {
            const bar = barTrack.createDiv({ cls: 'ta-bar' });
            bar.style.width = `${Math.max(4, (seconds / weekMax) * 100)}%`;
        }

        row.createSpan({
            cls: 'ta-week-time',
            text: day.isToday && seconds === 0 ? '(today)' : formatHM(seconds),
        });
    }

    // ── Recent Sessions ──
    if (data.recentSessions.length > 0) {
        const recentSection = createSection(container, 'Recent Sessions');

        for (const s of data.recentSessions) {
            const row = recentSection.createDiv({ cls: 'ta-recent-row' });
            row.addEventListener('click', () => {
                app.workspace.openLinkText(s.filePath, '');
            });

            const icon = s.kind === 'countdown' ? '🍅' : '⏹️';
            row.createSpan({ cls: 'ta-recent-icon', text: icon });
            row.createSpan({ cls: 'ta-recent-duration', text: formatDuration(s.effective) });
            row.createSpan({ cls: 'ta-recent-file', text: fileName(s.filePath) });
            row.createSpan({ cls: 'ta-recent-ago', text: timeAgo(s.startedAt) });
        }
    }
}
