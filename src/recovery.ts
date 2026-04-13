import { App, MarkdownView, TFile, Notice } from 'obsidian';
import { nowSec, pauseData, stopData } from './timer';
import { TIMER_RE, parse, extractTimerData, render, replaceTimer } from './editor';

export function pauseTimersInContent(
    content: string,
    refTime: number,
    counter?: { count: number },
): string {
    return content.replace(
        new RegExp(TIMER_RE.source, 'g'),
        (...args) => {
            const data = extractTimerData(args as unknown as RegExpExecArray);
            if (data.state !== 'running') return args[0];
            if (counter) counter.count++;
            return render(pauseData(data, refTime));
        },
    );
}

export function pauseOpenEditorsSync(app: App, ref = nowSec()): Set<string> {
    const handledPaths = new Set<string>();

    app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
        if (!(leaf.view instanceof MarkdownView)) return;
        const file = leaf.view.file;
        if (file) handledPaths.add(file.path);

        const editor = leaf.view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const p = parse(editor.getLine(i));
            if (p?.state !== 'running') continue;

            replaceTimer(editor, i, render(pauseData(p, ref)), p.start, p.end);
        }
    });

    return handledPaths;
}

export async function recoverRunningTimers(app: App, lastActiveTime: number) {
    const ref = lastActiveTime > 0 ? lastActiveTime : nowSec();
    const counter = { count: 0 };
    
    const files = app.vault.getMarkdownFiles();
    for (const file of files) {
        const content = await app.vault.cachedRead(file);
        if (!content.includes('|running|')) continue;
        
        try {
            await app.vault.process(file, (content) =>
                pauseTimersInContent(content, ref, counter)
            );
        } catch (error) {
            console.error(`Timer: recovery failed for ${file.path}`, error);
        }
    }
    
    if (counter.count > 0) {
        new Notice(
            `Recovered ${counter.count} running timer(s) from previous session.`,
        );
    }
}

export async function saveAllRunningTimers(app: App, ref = nowSec()) {
    const handledPaths = pauseOpenEditorsSync(app, ref);

    const files = app.vault.getMarkdownFiles();
    for (const file of files) {
        if (handledPaths.has(file.path)) continue;
        
        const content = await app.vault.cachedRead(file);
        if (!content.includes('|running|')) continue;

        try {
            await app.vault.process(file, (content) =>
                pauseTimersInContent(content, ref),
            );
        } catch (error) {
            console.error(`Timer: save failed for ${file.path}`, error);
        }
    }
}

export async function stopAllRunningTimers(app: App, ref = nowSec()): Promise<number> {
    const handledPaths = new Set<string>();
    let count = 0;

    app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
        if (!(leaf.view instanceof MarkdownView)) return;
        const file = leaf.view.file;
        if (file) handledPaths.add(file.path);

        const editor = leaf.view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const p = parse(editor.getLine(i));
            if (p?.state !== 'running') continue;

            count++;
            replaceTimer(editor, i, render(stopData(p, ref)), p.start, p.end);
        }
    });

    const files = app.vault.getMarkdownFiles();
    for (const file of files) {
        if (handledPaths.has(file.path)) continue;
        
        const content = await app.vault.cachedRead(file);
        if (!content.includes('|running|')) continue;

        try {
            await app.vault.process(file, (content) =>
                 content.replace(
                    new RegExp(TIMER_RE.source, 'g'),
                    (...args) => {
                        const data = extractTimerData(args as unknown as RegExpExecArray);
                        if (data.state !== 'running') return args[0];
                        count++;
                        return render(stopData(data, ref));
                    },
                ),
            );
        } catch (error) {
            console.error(`Timer: stop failed for ${file.path}`, error);
        }
    }
    
    return count;
}
