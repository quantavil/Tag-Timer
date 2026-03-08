import { App } from 'obsidian';
import { AnalyticsEntry } from '../types';

export class AnalyticsStore {
    app: App;
    retentionDays: number;
    path: string;
    private writeLock: Promise<void> = Promise.resolve();

    constructor(app: App, retentionDays: number, activePath: string) {
        this.app = app; this.retentionDays = retentionDays; this.path = activePath;
    }
    async readRaw(): Promise<AnalyticsEntry[]> {
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(this.path))) return [];
        try { const content = await adapter.read(this.path); return JSON.parse(content) || []; } catch (e) { console.error("Error reading analytics:", e); return []; }
    }
    private async writeAll(data: AnalyticsEntry[]): Promise<void> { await this.app.vault.adapter.write(this.path, JSON.stringify(data, null, 2)); }

    async append(entry: AnalyticsEntry): Promise<void> {
        this.writeLock = this.writeLock.then(async () => {
            const all = await this.readRaw(); all.push(entry); await this.writeAll(all);
        }).catch(e => console.error("Error appending to analytics:", e));
        return this.writeLock;
    }
    async loadForCharts(): Promise<AnalyticsEntry[]> {
        const data = await this.readRaw(); const now = new Date();
        const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - this.retentionDays).getTime();
        return data.filter((e: AnalyticsEntry) => { const t = new Date(e.timestamp).getTime(); return t >= cutoff; });
    }
    async cleanup(): Promise<void> {
        this.writeLock = this.writeLock.then(async () => {
            const data = await this.readRaw(); const now = new Date();
            const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - this.retentionDays).getTime();
            const filtered = data.filter((e: AnalyticsEntry) => { const t = new Date(e.timestamp).getTime(); return t >= cutoff; });
            if (filtered.length < data.length) await this.writeAll(filtered);
        }).catch(e => console.error("Error cleaning analytics:", e));
        return this.writeLock;
    }
    async setTagTotalForPeriod(tagToSet: string, newTotalDuration: number, periodRange: { start: Date, end: Date }, anchorDate: Date): Promise<void> {
        this.writeLock = this.writeLock.then(async () => {
            const all = await this.readRaw(); const s = periodRange.start.getTime(), e = periodRange.end.getTime();
            let sum = 0;
            const filtered = all.filter((entry: AnalyticsEntry) => {
                const t = new Date(entry.timestamp).getTime();
                if (t >= s && t <= e && (entry.tags || []).includes(tagToSet) && entry.type !== 'adjust') { sum += entry.duration; return false; }
                return true;
            });
            if (newTotalDuration > 0) {
                filtered.push({ timestamp: anchorDate.toISOString(), duration: newTotalDuration, file: 'manual_adjustment', tags: [tagToSet], type: 'adjust' });
            }
            await this.writeAll(filtered.sort((a: AnalyticsEntry, b: AnalyticsEntry) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
        }).catch(e => console.error("Error updating tag total:", e));
        return this.writeLock;
    }
}
