import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { Menu, Notice } from 'obsidian';
import { TimerData } from './types';
import {
    renderDisplay,
    currentElapsed,
    currentRemaining,
    nowSec,
    pauseData,
    resumeData,
    stopData,
    resetData,
    setDisplayedSeconds,
    parseDurationInput,
    formatDuration,
    TIMER_MUTATED_EVENT,
    extractTimerData,
    promptForTimeChange,
} from './timer';
import { TIMER_RE, render } from './editor';

interface LocatedTimer {
    from: number;
    to: number;
}

function locateTimer(view: EditorView, el: HTMLElement, id: string): LocatedTimer | null {
    const pos = view.posAtDOM(el);
    const line = view.state.doc.lineAt(pos);
    const re = new RegExp(TIMER_RE.source, 'g');
    let m: RegExpExecArray | null;

    while ((m = re.exec(line.text)) !== null) {
        if (m[1] === id) {
            const from = line.from + m.index;
            return { from, to: from + m[0].length };
        }
    }

    return null;
}

function emitTimerMutation() {
    window.dispatchEvent(new CustomEvent(TIMER_MUTATED_EVENT));
}

function replaceLocatedTimer(view: EditorView, range: LocatedTimer, data: TimerData) {
    view.dispatch({
        changes: { from: range.from, to: range.to, insert: render(data) },
    });
    emitTimerMutation();
}

function removeLocatedTimer(view: EditorView, range: LocatedTimer) {
    const line = view.state.doc.lineAt(range.from);
    const localFrom = range.from - line.from;
    const localTo = range.to - line.from;

    const hasSpaceBefore = localFrom > 0 && line.text[localFrom - 1] === ' ';
    const hasSpaceAfter = localTo < line.text.length && line.text[localTo] === ' ';

    const from = hasSpaceBefore ? range.from - 1 : range.from;
    const to = (hasSpaceAfter && !hasSpaceBefore) ? range.to + 1 : range.to;

    view.dispatch({
        changes: { from, to, insert: '' },
    });
    emitTimerMutation();
}

class TimerWidget extends WidgetType {
    private interval: number | null = null;

    constructor(readonly data: TimerData) {
        super();
    }

    eq(other: TimerWidget): boolean {
        return this.data.id === other.data.id
            && this.data.kind === other.data.kind
            && this.data.state === other.data.state
            && this.data.elapsed === other.data.elapsed
            && this.data.startedAt === other.data.startedAt
            && this.data.duration === other.data.duration;
    }

    toDOM(view: EditorView): HTMLElement {
        const el = document.createElement('span');
        el.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;

        const finishCountdownIfNeeded = () => {
            if (this.data.kind !== 'countdown' || this.data.state !== 'running') return false;
            if (currentRemaining(this.data) > 0) return false;

            const range = locateTimer(view, el, this.data.id);
            if (!range) return false;

            replaceLocatedTimer(view, range, stopData(this.data, nowSec()));

            if (this.interval !== null) {
                window.clearInterval(this.interval);
                this.interval = null;
            }

            return true;
        };

        const update = () => {
            if (finishCountdownIfNeeded()) return;
            el.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;
            el.textContent = renderDisplay(this.data);
        };

        const openMenu = (event: MouseEvent) => {
            const range = locateTimer(view, el, this.data.id);
            if (!range) return;

            const menu = new Menu();

            if (this.data.state === 'running') {
                menu.addItem((item) =>
                    item.setTitle('Pause')
                        .setIcon('pause')
                        .onClick(() => replaceLocatedTimer(view, range, pauseData(this.data, nowSec()))));
            } else {
                menu.addItem((item) =>
                    item.setTitle(this.data.state === 'stopped' ? 'Start' : 'Resume')
                        .setIcon('play')
                        .onClick(() => replaceLocatedTimer(view, range, resumeData(this.data, nowSec()))));
            }

            menu.addItem((item) =>
                item.setTitle('Stop')
                    .setIcon('square')
                    .onClick(() => replaceLocatedTimer(view, range, stopData(this.data, nowSec()))));

            menu.addItem((item) =>
                item.setTitle('Reset')
                    .setIcon('refresh-cw')
                    .onClick(() => replaceLocatedTimer(view, range, resetData(this.data, nowSec()))));

            menu.addItem((item) =>
                item.setTitle('Change time')
                    .setIcon('clock')
                    .onClick(() => {
                        const currentData = this.data;
                        setTimeout(() => {
                            try {
                                const next = promptForTimeChange(currentData);
                                if (next) replaceLocatedTimer(view, range, next);
                            } catch {
                                new Notice('Invalid time.');
                            }
                        }, 50);
                    }));

            menu.addItem((item) =>
                item.setTitle('Delete')
                    .setIcon('trash')
                    .onClick(() => removeLocatedTimer(view, range)));

            menu.showAtMouseEvent(event);
        };

        update();

        if (this.data.state === 'running') {
            this.interval = window.setInterval(update, 1000);
        }

        el.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            openMenu(event);
        };

        el.oncontextmenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
            openMenu(event);
        };

        return el;
    }

    destroy(): void {
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }
}

function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        const re = new RegExp(TIMER_RE.source, 'g');
        let match: RegExpExecArray | null;

        while ((match = re.exec(text)) !== null) {
            const start = from + match.index;
            const end = start + match[0].length;

            builder.add(
                start,
                end,
                Decoration.replace({
                    widget: new TimerWidget(extractTimerData(match)),
                }),
            );
        }
    }

    return builder.finish();
}

export const timerViewPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                this.decorations = buildDecorations(update.view);
            }
        }
    },
    { decorations: (v) => v.decorations },
);