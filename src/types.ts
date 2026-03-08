export interface TimerData {
    class: 'timer-r' | 'timer-p';
    timerId: string;
    dur: number;
    ts: number;
}

export interface AnalyticsEntry {
    timestamp: string;
    duration: number;
    file: string;
    tags: string[];
    type?: 'adjust';
}

export interface TagTimerSettings {
    autoStopTimers: 'never' | 'quit' | 'close';
    timerInsertLocation: 'head' | 'tail' | 'cursor';
    timersState: Record<string, number>;
}
