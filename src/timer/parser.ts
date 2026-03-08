import { TimerData } from '../types';
import { CONSTANTS } from '../constants';

export class TimerParser {
    static parse(line: string, targetId: string | null = null): (TimerData & { beforeIndex: number, afterIndex: number }) | null {
        if (!line) return null;
        const re = new RegExp(CONSTANTS.REGEX.NEW_FORMAT.source, 'g');
        let m; while ((m = re.exec(line)) !== null) {
            if (targetId && m[2] !== targetId) continue;
            return { class: m[1] as 'timer-r' | 'timer-p', timerId: m[2], dur: parseInt(m[3], 10), ts: parseInt(m[4], 10), beforeIndex: m.index, afterIndex: re.lastIndex };
        }
        return null;
    }
}
