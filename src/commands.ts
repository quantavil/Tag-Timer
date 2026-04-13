import { App, Editor, MarkdownView, Notice } from 'obsidian';
import { TimerData, TimerKind, TimerSettings } from './types';
import { generateId, nowSec, pauseData, resumeData, stopData, resetData } from './timer';
import { parse, render, insertTimer, replaceTimer, removeTimer } from './editor';
import { openTimeModal } from './timeModal';

export function handleCommand(
    app: App,
    settings: TimerSettings,
    editor: Editor,
    view: MarkdownView,
    action: 'toggle' | 'delete' | 'stop' | 'reset' | 'change',
    createKind: TimerKind = 'stopwatch',
) {
    if ((view as { getMode?: () => string }).getMode?.() === 'preview') {
        new Notice('Switch to edit mode to use timers.');
        return;
    }

    const line = editor.getCursor().line;
    const parsed = parse(editor.getLine(line));

    if (!parsed) {
        if (action !== 'toggle') {
            new Notice('No timer found on current line.');
            return;
        }

        const defaultCountdown = Math.max(
            1,
            settings.defaultCountdownSeconds,
        );

        const data: TimerData = {
            id: generateId(),
            kind: createKind,
            state: 'running',
            elapsed: 0,
            startedAt: nowSec(),
            duration: createKind === 'countdown' ? defaultCountdown : 0,
        };

        insertTimer(editor, line, render(data), settings.insertPosition);
        return;
    }

    if (action === 'delete') {
        removeTimer(editor, line, parsed.start, parsed.end);
        new Notice('Timer deleted');
        return;
    }

    if (action === 'change') {
        openTimeModal(app, parsed, (next) => {
            const fresh = parse(editor.getLine(line));
            if (!fresh || fresh.id !== parsed.id) {
                new Notice('Timer moved or deleted.');
                return;
            }
            replaceTimer(editor, line, render(next), fresh.start, fresh.end);
        });
        return;
    }

    let next: TimerData;

    if (action === 'stop') {
        next = stopData(parsed, nowSec());
    } else if (action === 'reset') {
        next = resetData(parsed, nowSec());
    } else {
        next = parsed.state === 'running'
            ? pauseData(parsed, nowSec())
            : resumeData(parsed, nowSec());
    }

    replaceTimer(editor, line, render(next), parsed.start, parsed.end);
}
