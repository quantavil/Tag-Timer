import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { TimerState } from './types';
import { renderDisplay } from './timer';
import { TIMER_RE } from './editor';

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

    toDOM(): HTMLElement {
        const el = document.createElement('span');
        el.className = `timer-${this.state}`;

        const update = () => {
            el.textContent = renderDisplay(this);
        };

        update();

        if (this.state === 'running') {
            this.interval = window.setInterval(update, 1000);
        }

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
