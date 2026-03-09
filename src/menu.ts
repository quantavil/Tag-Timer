import { Menu } from 'obsidian';
import { TimerData } from './types';
import { pauseData, resumeData, stopData, resetData, nowSec } from './timer';

export interface TimerMenuActions {
    replace(next: TimerData): void;
    changeTime(): void;
    remove(): void;
}

export function addTimerMenuItems(
    menu: Menu,
    data: TimerData,
    actions: TimerMenuActions,
): void {
    if (data.state === 'running') {
        menu.addItem((i) =>
            i.setTitle('Pause').setIcon('pause')
                .onClick(() => actions.replace(pauseData(data, nowSec()))));
    } else {
        menu.addItem((i) =>
            i.setTitle(data.state === 'stopped' ? 'Start' : 'Resume')
                .setIcon('play')
                .onClick(() => actions.replace(resumeData(data, nowSec()))));
    }

    menu.addItem((i) =>
        i.setTitle('Stop').setIcon('square')
            .onClick(() => actions.replace(stopData(data, nowSec()))));

    menu.addItem((i) =>
        i.setTitle('Reset').setIcon('refresh-cw')
            .onClick(() => actions.replace(resetData(data, nowSec()))));

    menu.addItem((i) =>
        i.setTitle('Change time').setIcon('clock')
            .onClick(() => actions.changeTime()));

    menu.addItem((i) =>
        i.setTitle('Delete').setIcon('trash')
            .onClick(() => actions.remove()));
}