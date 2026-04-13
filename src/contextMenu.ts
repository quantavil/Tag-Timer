import { App, Editor, MarkdownView, Notice, Menu } from 'obsidian';
import { TimerSettings } from './types';
import { parse, render, removeTimer, replaceTimer } from './editor';
import { addTimerMenuItems } from './menu';
import { openTimeModal } from './timeModal';
import { handleCommand } from './commands';

export function buildContextMenu(
    app: App,
    settings: TimerSettings,
    menu: Menu,
    editor: Editor,
    view: MarkdownView,
) {
    const line = editor.getCursor().line;
    const parsed = parse(editor.getLine(line));

    if (!parsed) {
        menu.addItem((item) =>
            item.setTitle('Start timer')
                .setIcon('play')
                .onClick(() =>
                    handleCommand(app, settings, editor, view, 'toggle', 'stopwatch'),
                ),
        );

        menu.addItem((item) =>
            item.setTitle('Start countdown')
                .setIcon('timer')
                .onClick(() =>
                    handleCommand(app, settings, editor, view, 'toggle', 'countdown'),
                ),
        );

        return;
    }

    addTimerMenuItems(menu, parsed, {
        replace: (next) => {
            replaceTimer(editor, line, render(next), parsed.start, parsed.end);
        },
        changeTime: () => {
            openTimeModal(app, parsed, (next) => {
                const fresh = parse(editor.getLine(line));
                if (!fresh || fresh.id !== parsed.id) {
                    new Notice('Timer moved or deleted.');
                    return;
                }
                replaceTimer(editor, line, render(next), fresh.start, fresh.end);
            });
        },
        remove: () => {
            removeTimer(editor, line, parsed.start, parsed.end);
            new Notice('Timer deleted');
        },
    });
}
