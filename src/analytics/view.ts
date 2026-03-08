import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Chart } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { CONSTANTS } from '../constants';
import { TimerUtils } from '../utils';
import { AnalyticsStore } from './store';
import { TimerChartManager } from '../charts/chart-manager';

export class TimerAnalyticsView extends ItemView {
    chartjsLoaded: boolean;
    analyticsPath: string;
    showWeekly: boolean;
    anchorDate: Date;
    chartManager: TimerChartManager;
    analyticsStore: AnalyticsStore;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.analyticsPath = this.app.vault.configDir + '/plugins/tag-timer/analytics.json';
        this.showWeekly = false; this.anchorDate = new Date();
        this.chartManager = new TimerChartManager(this.app, this);
        // analyticsStore is injected by main.ts during activateView
    }
    getViewType() { return CONSTANTS.ANALYTICS_VIEW_TYPE; }
    getDisplayText() { return "Timer Analytics"; }
    getIcon() { return "pie-chart"; }

    async onOpen() {
        // ChartJS is already bundled via esbuild and registered in main.ts
        await this.renderAnalytics();
    }
    async renderAnalytics() {
        const container = this.containerEl.children[1]; container.empty(); container.addClass("analytics-container");
        const analytics = await this.analyticsStore.loadForCharts();
        if (analytics.length === 0) { container.createEl("p", { text: `No analytics data found (last ${CONSTANTS.RETENTION_DAYS} days).` }); return; }
        const grid = container.createDiv({ cls: "chart-grid" });
        this.chartManager.createBarChartCard(grid, analytics);
        this.chartManager.createDoughnutChartCard(grid, analytics);
    }
    getPeriodRange() {
        if (this.showWeekly) return { start: TimerUtils.startOfWeekMonday(this.anchorDate), end: TimerUtils.endOfWeekMonday(this.anchorDate) };
        return { start: TimerUtils.startOfDay(this.anchorDate), end: TimerUtils.endOfDay(this.anchorDate) };
    }
    async onClose() { /* no-op */ }
}
