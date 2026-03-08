import { TimerData } from '../types';
import { CONSTANTS } from '../constants';

export class TimerManager {
    timers: Map<string, { intervalId: number, data: TimerData }>;
    startedIds: Set<string>;
    constructor() { this.timers = new Map(); this.startedIds = new Set(); }
    startTimer(timerId: string, initialData: TimerData, tick: (timerId: string) => void) {
        if (this.timers.has(timerId)) return;
        const intervalId = window.setInterval(() => tick(timerId), CONSTANTS.UPDATE_INTERVAL_MS);
        this.timers.set(timerId, { intervalId, data: initialData }); this.startedIds.add(timerId);
    }
    stopTimer(timerId: string) {
        const item = this.timers.get(timerId);
        if (!item) return;
        window.clearInterval(item.intervalId);
        this.timers.delete(timerId);
    }
    updateTimerData(timerId: string, data: TimerData) { const item = this.timers.get(timerId); if (item) item.data = data; }
    getTimerData(timerId: string) { return this.timers.get(timerId)?.data || null; }
    hasTimer(timerId: string) { return this.timers.has(timerId); }
    isStartedInThisSession(timerId: string) { return this.startedIds.has(timerId); }
    getAllTimers() { return new Map(Array.from(this.timers.entries()).map(([id, t]) => [id, t.data])); }
    clearAll() {
        this.timers.forEach(t => window.clearInterval(t.intervalId));
        this.timers.clear(); this.startedIds.clear();
    }
}
