import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { scanVault } from './scanner';
import { renderAnalytics } from './renderer';

export const ANALYTICS_VIEW_TYPE = 'tag-timer-analytics';

export class AnalyticsView extends ItemView {
    private scanning = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return ANALYTICS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Timer Analytics';
    }

    getIcon(): string {
        return 'bar-chart-2';
    }

    async onOpen(): Promise<void> {
        await this.refresh();
    }

    async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    async refresh(): Promise<void> {
        if (this.scanning) return;
        this.scanning = true;

        try {
            const container = this.contentEl;
            container.empty();
            container.addClass('timer-analytics-root');

            // Header with refresh button
            const header = container.createDiv({ cls: 'ta-header' });
            const refreshBtn = header.createEl('button', {
                cls: 'ta-refresh clickable-icon',
                attr: { 'aria-label': 'Refresh analytics' },
            });
            setIcon(refreshBtn, 'refresh-cw');
            refreshBtn.addEventListener('click', () => void this.refresh());

            // Timestamp
            const now = new Date();
            const ts = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            header.createSpan({ cls: 'ta-timestamp', text: `Scanned ${ts}` });

            // Body
            const body = container.createDiv({ cls: 'ta-body' });
            const data = await scanVault(this.app);
            renderAnalytics(body, data, this.app);
        } finally {
            this.scanning = false;
        }
    }
}
