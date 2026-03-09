import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { TimerState } from './types';
import { renderDisplay, currentElapsed, nowSec } from './timer';
import { TIMER_RE, render } from './editor';

class TimerWidget extends WidgetType {
    private interval: number | null = null;

    constructor(
        readonly id: string,
        readonly state: TimerState,
        readonly elapsed: number,
        readonly startedAt: number,
    ) {
        super();
    }

    eq(other: TimerWidget): boolean {
        return this.id === other.id
            && this.state === other.state
            && this.elapsed === other.elapsed
            && this.startedAt === other.startedAt;
    }

    toDOM(view: EditorView): HTMLElement {
        const el = document.createElement('span');
        el.className = `timer-${this.state}`;

        const update = () => {
            el.textContent = renderDisplay(this);
        };

        update();

        if (this.state === 'running') {
            this.interval = window.setInterval(update, 1000);
        }

        el.onclick = (e) => {
            e.preventDefault();
            const pos = view.posAtDOM(el);
            const line = view.state.doc.lineAt(pos);
            const re = new RegExp(TIMER_RE.source, 'g');
            let m;
            while ((m = re.exec(line.text)) !== null) {
                if (m[1] === this.id) {
                    const from = line.from + m.index;
                    const to = from + m[0].length;
                    
                    let newState: TimerState = 'running';
                    let newElapsed = parseInt(m[3], 10);
                    
                    if (this.state === 'running') {
                        newState = 'paused';
                        newElapsed = currentElapsed({ id: this.id, state: 'running', elapsed: newElapsed, startedAt: parseInt(m[4], 10) });
                    } else if (this.state === 'stopped') {
                        newState = 'running';
                        newElapsed = 0;
                    }
                    
                    const span = render({ id: this.id, state: newState, elapsed: newElapsed, startedAt: nowSec() });
                    view.dispatch({ changes: { from, to, insert: span } });
                    break;
                }
            }
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
        let match;
        while ((match = re.exec(text)) !== null) {
            const start = from + match.index;
            const end = start + match[0].length;
            const widget = new TimerWidget(
                match[1],
                match[2] as TimerState,
                parseInt(match[3], 10),
                parseInt(match[4], 10),
            );
            builder.add(start, end, Decoration.replace({ widget }));
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
