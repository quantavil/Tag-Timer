import { CONSTANTS } from './constants';

export class TimerUtils {
    static getCurrentTimestamp(): number { return Math.floor(Date.now() / 1000); }
    static startOfDay(dateStart: Date): Date { const d = new Date(dateStart); d.setHours(0, 0, 0, 0); return d; }
    static endOfDay(dateEnd: Date): Date { const d = new Date(dateEnd); d.setHours(23, 59, 59, 999); return d; }
    static startOfWeekMonday(dateStart: Date): Date { const d = new Date(dateStart); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff); d.setHours(0, 0, 0, 0); return d; }
    static endOfWeekMonday(dateEnd: Date): Date { const d = this.startOfWeekMonday(dateEnd); d.setDate(d.getDate() + 6); d.setHours(23, 59, 59, 999); return d; }
    static formatMMMDD(date: Date): string { const split = date.toDateString().split(' '); return `${split[1]} ${split[2]}`; }
    static formatTagLabel(tag: string): string { return tag.startsWith('#') ? tag.substring(1) : tag; }
    static formatDuration(totalSeconds: number): string {
        if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`;
        const mins = Math.floor(totalSeconds / 60); const secs = Math.floor(totalSeconds % 60);
        if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
        const hrs = Math.floor(mins / 60); const remainingMins = mins % 60;
        return remainingMins > 0 ? `${hrs}h ${remainingMins}m` : `${hrs}h`;
    }
    static compressId(): string {
        let t = Date.now(), res = '';
        while (t > 0) { res = CONSTANTS.BASE62_CHARS[t % 62] + res; t = Math.floor(t / 62); }
        return res;
    }
}
