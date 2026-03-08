import { TimerData } from '../types';
import { TimerUtils } from '../utils';

export class TimerRenderer {
    static render(d: TimerData): string {
        const icon = (d.class === 'timer-r') ? (d.dur % 2 === 0 ? '⌛' : '⏳') : '⏳';
        const formatted = TimerUtils.formatDuration(d.dur);
        return `<span class="${d.class}" id="${d.timerId}" data-dur="${d.dur}" data-ts="${d.ts}">${icon} ${formatted}</span>`;
    }
}
