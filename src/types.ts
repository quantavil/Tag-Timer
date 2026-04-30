export type TimerState = 'running' | 'paused' | 'stopped';
export type TimerKind = 'stopwatch' | 'countdown';
export type SoundType = 'chime' | 'bell' | 'beep' | 'digital' | 'synth';

export interface TimerData {
    id: string;
    kind: TimerKind;
    state: TimerState;
    elapsed: number;
    startedAt: number;
    duration: number;
}

export interface TimerSettings {
    insertPosition: 'cursor' | 'head' | 'tail';
    lastActiveTime: number;
    defaultCountdownSeconds: number;
    playCompletionSound: boolean;
    soundType: SoundType;
    enableAnalytics: boolean;
}