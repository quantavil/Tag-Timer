import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { App, Menu, Notice } from 'obsidian';
import { TimerData } from './types';
import {
    renderDisplay,
    currentRemaining,
    nowSec,
    stopData,
    TIMER_MUTATED_EVENT,
    playBeep,
} from './timer';
import { TimerSettings } from './types';
import { timerRegex, render, extractTimerData, computeRemovalRange } from './editor';
import { addTimerMenuItems } from './menu';
import { openTimeModal } from './timeModal';
import { addLongPress } from './longPress';

/* Module‑level app ref, set once from plugin.onload */
let _app: App | null = null;
let _settings: TimerSettings | null = null;

export function setWidgetApp(app: App) {
    _app = app;
}

export function setWidgetSettings(s: TimerSettings) {
    _settings = s;
}

interface LocatedTimer {
    from: number;
    to: number;
}

function locateTimer(view: EditorView, el: HTMLElement, id: string): LocatedTimer | null {
    const pos = view.posAtDOM(el);
    const line = view.state.doc.lineAt(pos);
    const re = timerRegex();
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
    const r = computeRemovalRange(
        line.text,
        range.from - line.from,
        range.to - line.from,
    );
    view.dispatch({
        changes: { from: line.from + r.from, to: line.from + r.to, insert: '' },
    });
    emitTimerMutation();
}

class TimerWidget extends WidgetType {
    private interval: number | null = null;
    private isFirstRender = true;

    constructor(public data: TimerData) {
        super();
    }

    eq(other: TimerWidget): boolean {
        return (
            this.data.id === other.data.id &&
            this.data.kind === other.data.kind &&
            this.data.state === other.data.state &&
            this.data.elapsed === other.data.elapsed &&
            this.data.startedAt === other.data.startedAt &&
            this.data.duration === other.data.duration
        );
    }

    toDOM(view: EditorView): HTMLElement {
        const el = document.createElement('span');
        el.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;

        /** Always re‑locate before mutating so positions are never stale */
        const locate = (): LocatedTimer | null => locateTimer(view, el, this.data.id);

        const finishCountdownIfNeeded = (): boolean => {
            if (this.data.kind !== 'countdown' || this.data.state !== 'running') return false;
            if (currentRemaining(this.data) > 0) return false;

            if (this.isFirstRender) {
                // Expired while closed. Prevent file mutation during read/render phase.
                // Let the background expiry scanner handle the file write.
                this.data = stopData(this.data, nowSec());
                return false;
            }

            const range = locate();
            if (!range) return false;

            new Notice('Timer finished!');
            if (_settings?.playCompletionSound) playBeep();
            
            replaceLocatedTimer(view, range, stopData(this.data, nowSec()));

            if (this.interval !== null) {
                window.clearInterval(this.interval);
                this.interval = null;
            }

            return true;
        };

        const update = () => {
            if (finishCountdownIfNeeded()) return;
            this.isFirstRender = false;
            el.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;
            el.textContent = renderDisplay(this.data);
        };

        const openMenu = (event: MouseEvent) => {
            const menu = new Menu();

            addTimerMenuItems(menu, this.data, {
                replace: (next) => {
                    const range = locate();
                    if (range) replaceLocatedTimer(view, range, next);
                },
                changeTime: () => {
                    if (!_app) return;
                    openTimeModal(_app, this.data, (next) => {
                        const range = locate();
                        if (range) replaceLocatedTimer(view, range, next);
                    });
                },
                remove: () => {
                    const range = locate();
                    if (range) removeLocatedTimer(view, range);
                },
            });

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

        addLongPress(el, openMenu);

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
        const re = timerRegex();
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
            if (update.docChanged || update.viewportChanged) {
                this.decorations = buildDecorations(update.view);
            }
        }
    },
    { decorations: (v) => v.decorations },
);