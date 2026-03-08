import { TimerData } from '../types';
import { CONSTANTS } from '../constants';
import { TimerUtils } from '../utils';

export class TimerDataUpdater {
    static elapsedCapped(oldData: Partial<TimerData>, now: number) {
        const gap = Math.max(0, now - (oldData?.ts || now));
        if (gap > CONSTANTS.SLEEP_GAP_SEC) return 0;                     // sleep/hibernation/restart -> ignore
        return Math.min(gap, CONSTANTS.MAX_UPDATE_STEP_SEC);             // cap accrual per step
    }
    static calculate(action: string, oldData: Partial<TimerData> = {}, now = TimerUtils.getCurrentTimestamp()): Partial<TimerData> {
        switch (action) {
            case 'init': return { class: 'timer-r', timerId: TimerUtils.compressId(), dur: 0, ts: now };
            case 'continue': return { ...oldData, class: 'timer-r', ts: now }; // no backfill
            case 'pause': return { ...oldData, class: 'timer-p', dur: (oldData.dur || 0) + TimerDataUpdater.elapsedCapped(oldData, now), ts: now };
            case 'update': return (oldData.class !== 'timer-r') ? oldData : { ...oldData, dur: (oldData.dur || 0) + TimerDataUpdater.elapsedCapped(oldData, now), ts: now };
            case 'restore': return { ...oldData, class: 'timer-r', ts: now }; // do NOT add elapsed on restore
            case 'forcepause': return { ...oldData, class: 'timer-p' };
            default: return oldData;
        }
    }
}
