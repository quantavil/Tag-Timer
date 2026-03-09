export type TimerState = 'running' | 'paused';

export interface TimerData {
    id: string;
    state: TimerState;
    elapsed: number;
    startedAt: number;
}

export interface TimerSettings {
    insertPosition: 'cursor' | 'head' | 'tail';
}
