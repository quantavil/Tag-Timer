Use a backward-compatible 6-part token and add a click menu.

Old timers still parse:
`⏳[id|running|12|1700000000]`

New timers write as:
`⏳[id|countdown|running|0|1700000000|1500]`

## `src/types.ts`

```ts
export type TimerState = 'running' | 'paused' | 'stopped';
export type TimerKind = 'stopwatch' | 'countdown';

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
    runningTimerFiles: string[];
    defaultCountdownSeconds: number;
}
```

## `src/timer.ts`

```ts
import { TimerData } from './types';

export const TIMER_MUTATED_EVENT = 'obsidian-timer-mutated';

export function generateId(): string {
    return crypto.randomUUID().slice(0, 8);
}

export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function clampSeconds(value: number): number {
    return Math.max(0, Math.floor(value));
}

export function currentElapsed(data: TimerData, ref = nowSec()): number {
    const base = data.state === 'running'
        ? data.elapsed + Math.max(0, ref - data.startedAt)
        : data.elapsed;

    if (data.kind === 'countdown') {
        return Math.min(clampSeconds(base), Math.max(0, data.duration));
    }

    return clampSeconds(base);
}

export function currentRemaining(data: TimerData, ref = nowSec()): number {
    if (data.kind !== 'countdown') return 0;
    return Math.max(0, data.duration - currentElapsed(data, ref));
}

export function pauseData(data: TimerData, ref = nowSec()): TimerData {
    const elapsed = currentElapsed(data, ref);

    if (data.kind === 'countdown' && elapsed >= data.duration) {
        return {
            ...data,
            state: 'stopped',
            elapsed: data.duration,
            startedAt: ref,
        };
    }

    return {
        ...data,
        state: 'paused',
        elapsed,
        startedAt: ref,
    };
}

export function resumeData(data: TimerData, ref = nowSec()): TimerData {
    const elapsed = data.state === 'stopped' ? 0 : currentElapsed(data, ref);

    return {
        ...data,
        state: 'running',
        elapsed: data.kind === 'countdown' ? Math.min(elapsed, data.duration) : elapsed,
        startedAt: ref,
    };
}

export function stopData(data: TimerData, ref = nowSec()): TimerData {
    return {
        ...data,
        state: 'stopped',
        elapsed: currentElapsed(data, ref),
        startedAt: ref,
    };
}

export function resetData(data: TimerData, ref = nowSec()): TimerData {
    return {
        ...data,
        state: 'paused',
        elapsed: 0,
        startedAt: ref,
    };
}

export function setDisplayedSeconds(data: TimerData, seconds: number, ref = nowSec()): TimerData {
    const value = clampSeconds(seconds);

    if (data.kind === 'countdown') {
        return {
            ...data,
            duration: value,
            elapsed: 0,
            startedAt: ref,
            state: data.state === 'stopped' ? 'paused' : data.state,
        };
    }

    return {
        ...data,
        elapsed: value,
        startedAt: ref,
        state: data.state === 'stopped' ? 'paused' : data.state,
    };
}

export function formatDuration(totalSeconds: number): string {
    const s = clampSeconds(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(sec)}`;
    }

    return `${pad(m)}:${pad(sec)}`;
}

export function parseDurationInput(raw: string): number | null {
    const value = raw.trim();
    if (!value) return null;

    if (/^\d+$/.test(value)) {
        return parseInt(value, 10) * 60;
    }

    const parts = value.split(':').map((part) => part.trim());
    if (!parts.every((part) => /^\d+$/.test(part))) return null;

    if (parts.length === 2) {
        const [m, s] = parts.map((part) => parseInt(part, 10));
        if (s > 59) return null;
        return m * 60 + s;
    }

    if (parts.length === 3) {
        const [h, m, s] = parts.map((part) => parseInt(part, 10));
        if (m > 59 || s > 59) return null;
        return h * 3600 + m * 60 + s;
    }

    return null;
}

export function renderDisplay(data: TimerData): string {
    const shown = data.kind === 'countdown'
        ? currentRemaining(data)
        : currentElapsed(data);

    let icon = data.kind === 'countdown' ? '⏲️' : '⏱️';

    if (data.state === 'running') {
        icon = shown % 2 === 0
            ? (data.kind === 'countdown' ? '⏲️' : '⌛')
            : '⏳';
    } else if (data.state === 'stopped') {
        icon = '⏹️';
    }

    return `${icon} ${formatDuration(shown)}`;
}
```

## `src/editor.ts`

```ts
import { Editor } from 'obsidian';
import { TimerData, TimerKind, TimerState } from './types';

export const TIMER_RE = /⏳\[([^|\]]+)\|(?:(stopwatch|countdown)\|)?(running|paused|stopped)\|(\d+)\|(\d+)(?:\|(\d+))?\]/g;
const LIST_RE = /^(\s*>?\s*(?:\d+\.\s|[-+*]\s|#+\s))/;

export interface ParsedTimer extends TimerData {
    start: number;
    end: number;
}

export function parse(line: string): ParsedTimer | null {
    const re = new RegExp(TIMER_RE.source, 'g');
    const m = re.exec(line);
    if (!m) return null;

    return {
        id: m[1],
        kind: (m[2] as TimerKind) ?? 'stopwatch',
        state: m[3] as TimerState,
        elapsed: parseInt(m[4], 10),
        startedAt: parseInt(m[5], 10),
        duration: parseInt(m[6] ?? '0', 10),
        start: m.index,
        end: re.lastIndex,
    };
}

export function render(data: TimerData): string {
    return `⏳[${data.id}|${data.kind}|${data.state}|${data.elapsed}|${data.startedAt}|${data.duration}]`;
}

export function insertTimer(editor: Editor, line: number, span: string, position: 'cursor' | 'head' | 'tail'): void {
    if (position === 'cursor') {
        const ch = editor.getCursor().ch;
        editor.replaceRange(' ' + span, { line, ch });
    } else if (position === 'head') {
        const lineText = editor.getLine(line);
        const m = LIST_RE.exec(lineText);
        const ch = m ? m[0].length : 0;
        editor.replaceRange(span + ' ', { line, ch });
    } else {
        const ch = editor.getLine(line).length;
        editor.replaceRange(' ' + span, { line, ch });
    }
}

export function replaceTimer(editor: Editor, line: number, span: string, start: number, end: number): void {
    editor.replaceRange(span, { line, ch: start }, { line, ch: end });
}

export function removeTimer(editor: Editor, line: number, start: number, end: number): void {
    const lineText = editor.getLine(line);
    const removeStart = (start > 0 && lineText[start - 1] === ' ') ? start - 1 : start;
    const removeEnd = (end < lineText.length && lineText[end] === ' ') ? end + 1 : end;
    editor.replaceRange('', { line, ch: removeStart }, { line, ch: removeEnd });
}
```

## `src/widget.ts`

```ts
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

    const from = localFrom > 0 && line.text[localFrom - 1] === ' '
        ? range.from - 1
        : range.from;

    const to = localTo < line.text.length && line.text[localTo] === ' '
        ? range.to + 1
        : range.to;

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
        el.className = `timer-${this.data.state}`;

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
            el.className = `timer-${this.data.state}`;
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
                        const shown = this.data.kind === 'countdown'
                            ? currentRemaining(this.data)
                            : currentElapsed(this.data);

                        const raw = window.prompt(
                            'Set time. Use mm:ss, hh:mm:ss, or a whole number for minutes.',
                            formatDuration(shown),
                        );

                        if (raw === null) return;

                        const secs = parseDurationInput(raw);
                        if (secs === null) {
                            new Notice('Invalid time.');
                            return;
                        }

                        replaceLocatedTimer(view, range, setDisplayedSeconds(this.data, secs, nowSec()));
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
                    widget: new TimerWidget({
                        id: match[1],
                        kind: (match[2] as TimerData['kind']) ?? 'stopwatch',
                        state: match[3] as TimerData['state'],
                        elapsed: parseInt(match[4], 10),
                        startedAt: parseInt(match[5], 10),
                        duration: parseInt(match[6] ?? '0', 10),
                    }),
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
```

## Main plugin file

### 1. Update imports

```ts
import { TimerData, TimerSettings, TimerState, TimerKind } from './src/types';
import {
    generateId,
    nowSec,
    currentElapsed,
    currentRemaining,
    renderDisplay,
    pauseData,
    resumeData,
    stopData,
    resetData,
    setDisplayedSeconds,
    parseDurationInput,
    formatDuration,
    TIMER_MUTATED_EVENT,
} from './src/timer';
```

### 2. Update defaults

```ts
const DEFAULT_SETTINGS: TimerSettings = {
    insertPosition: 'tail',
    lastActiveTime: 0,
    runningTimerFiles: [],
    defaultCountdownSeconds: 25 * 60,
};
```

### 3. Add these helpers under `DEFAULT_SETTINGS`

```ts
function toTimerData(
    id: string,
    kind: string | undefined,
    state: string,
    elapsed: string,
    startedAt: string,
    duration: string | undefined,
): TimerData {
    return {
        id,
        kind: (kind as TimerKind) ?? 'stopwatch',
        state: state as TimerState,
        elapsed: parseInt(elapsed, 10),
        startedAt: parseInt(startedAt, 10),
        duration: parseInt(duration ?? '0', 10),
    };
}

function updateTimerInContent(
    content: string,
    targetId: string,
    mutator: (data: TimerData) => TimerData | null,
): string {
    const re = new RegExp(TIMER_RE.source, 'g');

    return content.replace(re, (match, id, kind, state, elapsed, startedAt, duration) => {
        if (id !== targetId) return match;
        const next = mutator(toTimerData(id, kind, state, elapsed, startedAt, duration));
        return next ? render(next) : '';
    });
}
```

### 4. Replace `TimerRenderChild` with this

```ts
class TimerRenderChild extends MarkdownRenderChild {
    interval: number | null = null;
    private finishing = false;

    constructor(
        containerEl: HTMLElement,
        public data: TimerData,
        public app: App,
        public sourcePath: string,
    ) {
        super(containerEl);
    }

    private syncInterval() {
        if (this.data.state === 'running') {
            if (this.interval === null) {
                this.interval = window.setInterval(() => this.refresh(), 1000);
            }
        } else if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }

    private refresh() {
        if (
            !this.finishing
            && this.data.kind === 'countdown'
            && this.data.state === 'running'
            && currentRemaining(this.data) === 0
        ) {
            this.finishing = true;
            void this.mutate((data) => stopData(data, nowSec())).finally(() => {
                this.finishing = false;
            });
            return;
        }

        this.containerEl.className = `timer-${this.data.state}`;
        this.containerEl.textContent = renderDisplay(this.data);
        this.syncInterval();
    }

    private async mutate(mutator: (data: TimerData) => TimerData | null) {
        const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
        if (!(file instanceof TFile)) return;

        let nextData: TimerData | null = null;

        await this.app.vault.process(file, (content) =>
            updateTimerInContent(content, this.data.id, (data) => {
                nextData = mutator(data);
                return nextData;
            }),
        );

        if (nextData) {
            this.data = nextData;
            this.refresh();
        } else {
            this.containerEl.remove();
            if (this.interval !== null) {
                window.clearInterval(this.interval);
                this.interval = null;
            }
        }
    }

    private openMenu(event: MouseEvent) {
        const menu = new Menu();

        if (this.data.state === 'running') {
            menu.addItem((item) =>
                item.setTitle('Pause')
                    .setIcon('pause')
                    .onClick(() => void this.mutate((data) => pauseData(data, nowSec()))));
        } else {
            menu.addItem((item) =>
                item.setTitle(this.data.state === 'stopped' ? 'Start' : 'Resume')
                    .setIcon('play')
                    .onClick(() => void this.mutate((data) => resumeData(data, nowSec()))));
        }

        menu.addItem((item) =>
            item.setTitle('Stop')
                .setIcon('square')
                .onClick(() => void this.mutate((data) => stopData(data, nowSec()))));

        menu.addItem((item) =>
            item.setTitle('Reset')
                .setIcon('refresh-cw')
                .onClick(() => void this.mutate((data) => resetData(data, nowSec()))));

        menu.addItem((item) =>
            item.setTitle('Change time')
                .setIcon('clock')
                .onClick(() => {
                    const shown = this.data.kind === 'countdown'
                        ? currentRemaining(this.data)
                        : currentElapsed(this.data);

                    const raw = window.prompt(
                        'Set time. Use mm:ss, hh:mm:ss, or a whole number for minutes.',
                        formatDuration(shown),
                    );

                    if (raw === null) return;

                    const secs = parseDurationInput(raw);
                    if (secs === null) {
                        new Notice('Invalid time.');
                        return;
                    }

                    void this.mutate((data) => setDisplayedSeconds(data, secs, nowSec()));
                }));

        menu.addItem((item) =>
            item.setTitle('Delete')
                .setIcon('trash')
                .onClick(() => void this.mutate(() => null)));

        menu.showAtMouseEvent(event);
    }

    onload() {
        this.refresh();

        this.containerEl.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openMenu(event);
        };

        this.containerEl.oncontextmenu = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openMenu(event);
        };
    }

    onunload() {
        if (this.interval !== null) {
            window.clearInterval(this.interval);
            this.interval = null;
        }
    }
}
```

### 5. Add this property to `TimerPlugin`

```ts
private timerMutatedRef: ((evt: Event) => void) | null = null;
```

### 6. In `onload()`, after the `beforeunload` listener, add

```ts
this.timerMutatedRef = () => {
    this.syncRegistryFromOpenEditors();
    void this.saveSettings();
};
window.addEventListener(TIMER_MUTATED_EVENT, this.timerMutatedRef);
```

### 7. In `onunload()`, remove it too

```ts
if (this.timerMutatedRef) {
    window.removeEventListener(TIMER_MUTATED_EVENT, this.timerMutatedRef);
    this.timerMutatedRef = null;
}
```

### 8. Replace the markdown post-processor block with this

```ts
this.registerMarkdownPostProcessor((el, ctx) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let node: Node | null;

    while ((node = walker.nextNode()) !== null) {
        nodes.push(node as Text);
    }

    for (const textNode of nodes) {
        const text = textNode.textContent ?? '';
        const re = new RegExp(TIMER_RE.source, 'g');
        let m: RegExpExecArray | null;
        let last = 0;
        let changed = false;

        const frag = document.createDocumentFragment();

        while ((m = re.exec(text)) !== null) {
            changed = true;

            if (m.index > last) {
                frag.append(text.slice(last, m.index));
            }

            const data = toTimerData(m[1], m[2], m[3], m[4], m[5], m[6]);
            const span = document.createElement('span');
            span.className = `timer-${data.state}`;
            frag.appendChild(span);
            ctx.addChild(new TimerRenderChild(span, data, this.app, ctx.sourcePath));

            last = m.index + m[0].length;
        }

        if (!changed) continue;

        if (last < text.length) {
            frag.append(text.slice(last));
        }

        textNode.parentNode?.replaceChild(frag, textNode);
    }
});
```

### 9. Add the countdown command inside `onload()`

```ts
this.addCommand({
    id: 'toggle-countdown',
    name: 'Start/pause countdown',
    hotkeys: [{ modifiers: ['Alt'], key: 'c' }],
    editorCallback: (e, v) => this.handleCommand(e, v as MarkdownView, 'toggle', 'countdown'),
});
```

### 10. Replace `updateRegistryForFile`

```ts
private async updateRegistryForFile(file: TFile) {
    try {
        const content = await this.app.vault.cachedRead(file);
        const hasRunning = /⏳\[[^\]]*\|running\|/.test(content);
        const tracked = this.settings.runningTimerFiles.includes(file.path);

        if (hasRunning && !tracked) {
            this.trackFile(file.path);
            await this.saveSettings();
        } else if (!hasRunning && tracked) {
            this.untrackFile(file.path);
            await this.saveSettings();
        }
    } catch {
        /* file may vanish between event and handler */
    }
}
```

### 11. Replace `pauseTimersInContent`

```ts
private pauseTimersInContent(content: string, refTime: number, counter?: { count: number }): string {
    return content.replace(
        new RegExp(TIMER_RE.source, 'g'),
        (match, id, kind, state, elapsed, startedAt, duration) => {
            const data = toTimerData(id, kind, state, elapsed, startedAt, duration);
            if (data.state !== 'running') return match;
            if (counter) counter.count++;
            return render(pauseData(data, refTime));
        },
    );
}
```

### 12. Replace `pauseOpenEditorsSync`

```ts
private pauseOpenEditorsSync(ref = nowSec()): Set<string> {
    const handledPaths = new Set<string>();

    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
        if (!(leaf.view instanceof MarkdownView)) return;
        const file = leaf.view.file;
        if (file) handledPaths.add(file.path);

        const editor = leaf.view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const p = parse(editor.getLine(i));
            if (p?.state !== 'running') continue;

            replaceTimer(
                editor,
                i,
                render(pauseData(p, ref)),
                p.start,
                p.end,
            );
        }
    });

    return handledPaths;
}
```

### 13. Replace `handleCommand`

```ts
handleCommand(
    editor: Editor,
    view: MarkdownView,
    action: 'toggle' | 'delete' | 'stop' | 'reset' | 'change',
    createKind: TimerKind = 'stopwatch',
) {
    if ((view as any).getMode?.() === 'preview') {
        new Notice('Switch to edit mode to use timers.');
        return;
    }

    const line = editor.getCursor().line;
    const parsed = parse(editor.getLine(line));

    if (!parsed) {
        if (action === 'delete') {
            new Notice('No timer found on current line.');
            return;
        }

        if (action !== 'toggle') {
            new Notice('No timer found on current line.');
            return;
        }

        const data: TimerData = {
            id: generateId(),
            kind: createKind,
            state: 'running',
            elapsed: 0,
            startedAt: nowSec(),
            duration: createKind === 'countdown' ? this.settings.defaultCountdownSeconds : 0,
        };

        insertTimer(editor, line, render(data), this.settings.insertPosition);
        this.refreshRegistryForEditor(editor, view);
        return;
    }

    if (action === 'delete') {
        removeTimer(editor, line, parsed.start, parsed.end);
        new Notice('Timer deleted');
        this.refreshRegistryForEditor(editor, view);
        return;
    }

    if (action === 'change') {
        const shown = parsed.kind === 'countdown'
            ? currentRemaining(parsed)
            : currentElapsed(parsed);

        const raw = window.prompt(
            'Set time. Use mm:ss, hh:mm:ss, or a whole number for minutes.',
            formatDuration(shown),
        );

        if (raw === null) return;

        const secs = parseDurationInput(raw);
        if (secs === null) {
            new Notice('Invalid time.');
            return;
        }

        replaceTimer(
            editor,
            line,
            render(setDisplayedSeconds(parsed, secs, nowSec())),
            parsed.start,
            parsed.end,
        );

        this.refreshRegistryForEditor(editor, view);
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
    this.refreshRegistryForEditor(editor, view);
}
```

### 14. Replace `buildContextMenu`

```ts
buildContextMenu(menu: Menu, editor: Editor, view: MarkdownView) {
    const line = editor.getCursor().line;
    const parsed = parse(editor.getLine(line));

    if (!parsed) {
        menu.addItem((item) =>
            item.setTitle('Start timer')
                .setIcon('play')
                .onClick(() => this.handleCommand(editor, view, 'toggle', 'stopwatch')));

        menu.addItem((item) =>
            item.setTitle('Start countdown')
                .setIcon('timer')
                .onClick(() => this.handleCommand(editor, view, 'toggle', 'countdown')));

        return;
    }

    if (parsed.state === 'running') {
        menu.addItem((item) =>
            item.setTitle('Pause')
                .setIcon('pause')
                .onClick(() => this.handleCommand(editor, view, 'toggle')));
    } else {
        menu.addItem((item) =>
            item.setTitle(parsed.state === 'stopped' ? 'Start' : 'Resume')
                .setIcon('play')
                .onClick(() => this.handleCommand(editor, view, 'toggle')));
    }

    menu.addItem((item) =>
        item.setTitle('Stop')
            .setIcon('square')
            .onClick(() => this.handleCommand(editor, view, 'stop')));

    menu.addItem((item) =>
        item.setTitle('Reset')
            .setIcon('refresh-cw')
            .onClick(() => this.handleCommand(editor, view, 'reset')));

    menu.addItem((item) =>
        item.setTitle('Change time')
            .setIcon('clock')
            .onClick(() => this.handleCommand(editor, view, 'change')));

    menu.addItem((item) =>
        item.setTitle('Delete')
            .setIcon('trash')
            .onClick(() => this.handleCommand(editor, view, 'delete')));
}
```

### 15. Add the new setting in `TimerSettingTab.display()`

Put this after the insert-position setting:

```ts
new Setting(containerEl)
    .setName('Default countdown')
    .setDesc('Used by Alt+C. Use mm:ss, hh:mm:ss, or a whole number for minutes.')
    .addText((text) => {
        text.setPlaceholder('25:00');
        text.setValue(formatDuration(this.plugin.settings.defaultCountdownSeconds));

        const save = async () => {
            const secs = parseDurationInput(text.inputEl.value);
            if (secs === null || secs <= 0) {
                new Notice('Invalid countdown.');
                text.setValue(formatDuration(this.plugin.settings.defaultCountdownSeconds));
                return;
            }

            this.plugin.settings.defaultCountdownSeconds = secs;
            await this.plugin.saveSettings();
            text.setValue(formatDuration(secs));
        };

        text.inputEl.addEventListener('blur', () => {
            void save();
        });

        text.inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                void save();
                text.inputEl.blur();
            }
        });
    });
```

This gives you countdown mode, default countdown length in settings, `Alt+C`, and click-to-open timer actions in both edit and reading view.

No required CSS change.

With the code as written, countdown uses the same state classes:
`.timer-running`, `.timer-paused`, `.timer-stopped`

So your current CSS will still work.

A small improvement is worth doing though: make countdown look different from stopwatch.

Change the class assignment in both edit-view and reading-view from:

```ts
el.className = `timer-${this.data.state}`;
```

to:

```ts
el.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;
```

And in reading view:

```ts
this.containerEl.className = `timer-badge timer-${this.data.kind} timer-${this.data.state}`;
```

Then update CSS like this:

```css
.timer-badge {
    font-family: var(--font-monospace);
    font-weight: 700;
    font-size: 0.85em;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
    user-select: none;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.timer-running {
    color: var(--text-success);
    background: rgba(var(--color-green-rgb), 0.15);
    border: 1px solid rgba(var(--color-green-rgb), 0.4);
    animation: timer-pulse 2s infinite;
}

.timer-paused {
    color: var(--text-warning);
    background: rgba(var(--color-orange-rgb), 0.15);
    border: 1px solid rgba(var(--color-orange-rgb), 0.4);
}

.timer-stopped {
    color: var(--text-muted);
    background: var(--background-modifier-active-hover);
    border: 1px solid var(--background-modifier-border);
}

.timer-countdown {
    letter-spacing: 0.02em;
}

.timer-countdown.timer-running {
    color: var(--text-accent);
    background: rgba(var(--color-blue-rgb), 0.15);
    border: 1px solid rgba(var(--color-blue-rgb), 0.4);
}

.timer-badge:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    filter: brightness(1.1);
}

@keyframes timer-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(var(--color-green-rgb), 0.4); }
    50% { box-shadow: 0 0 0 6px rgba(var(--color-green-rgb), 0); }
}

@media (prefers-reduced-motion: reduce) {
    .timer-badge {
        animation: none !important;
        transition: none !important;
    }
}
```

Also, your current reduced-motion rule is too broad because it disables animation for everything in Obsidian. The scoped version above is safer.