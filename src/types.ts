export type TimerState = 'running' | 'paused' | 'stopped';

export interface TimerData {
    id: string;
    state: TimerState;
    elapsed: number;
    startedAt: number;
}

export interface TimerSettings {
    insertPosition: 'cursor' | 'head' | 'tail';
    lastActiveTime: number;
}
