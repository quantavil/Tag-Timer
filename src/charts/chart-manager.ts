import { App, Modal, TextComponent, Setting, Notice, Menu } from 'obsidian';
import { Chart } from 'chart.js';
import { AnalyticsEntry } from '../types';
import { TimerUtils } from '../utils';
import { TimerAnalyticsView } from '../analytics/view';

export class TimerChartManager {
    app: App;
    view: TimerAnalyticsView;
    barChartInstance: Chart | null = null;
    doughnutChartInstance: Chart | null = null;

    constructor(app: App, view: TimerAnalyticsView) { this.app = app; this.view = view; }
    createBarChartCard(chartGrid: any, analytics: AnalyticsEntry[]) {
        const barCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        const header = barCard.createDiv({ cls: "analytics-card-header" });
        const titleGroup = header.createDiv({ cls: "analytics-title-group" });
        const leftArrow = titleGroup.createEl("button", { cls: "analytics-arrow", text: "<" });
        titleGroup.createEl("h3", { text: "Analytics", cls: "analytics-title" });
        const rightArrow = titleGroup.createEl("button", { cls: "analytics-arrow", text: ">" });
        const controls = header.createDiv({ cls: "analytics-controls" });
        const toggleButton = controls.createEl("button", { text: this.view.showWeekly ? "Show daily" : "Show weekly", cls: "analytics-toggle-button" });
        toggleButton.addEventListener('click', () => { this.view.showWeekly = !this.view.showWeekly; this.view.onOpen(); });
        leftArrow.addEventListener('click', () => { const d = new Date(this.view.anchorDate); d.setDate(d.getDate() - (this.view.showWeekly ? 7 : 1)); this.view.anchorDate = d; this.view.onOpen(); });
        rightArrow.addEventListener('click', () => {
            const next = new Date(this.view.anchorDate); next.setDate(next.getDate() + (this.view.showWeekly ? 7 : 1));
            if (TimerUtils.startOfDay(next) <= TimerUtils.startOfDay(new Date())) { this.view.anchorDate = next; this.view.onOpen(); }
        });
        const barCanvas = barCard.createDiv({ cls: "canvas-container" }).createEl("canvas");
        this.createBarChart(barCanvas, analytics);
    }
    createDoughnutChartCard(chartGrid: any, analytics: AnalyticsEntry[]) {
        if (this.view.showWeekly) {
            const barCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
            const { start } = this.view.getPeriodRange();
            barCard.createEl("h3", { text: `Weekly Focus (Starting ${TimerUtils.formatMMMDD(start)})` });
            const canvas = barCard.createDiv({ cls: "canvas-container" }).createEl("canvas");
            this.createDailyBarChart(canvas, analytics);
            return;
        }
        const doughnutCard = chartGrid.createDiv({ cls: "analytics-card chart-card" });
        doughnutCard.createEl("h3", { text: `Focus (${TimerUtils.formatMMMDD(this.view.anchorDate)})` });
        const doughnutCanvas = doughnutCard.createDiv({ cls: "canvas-container" }).createEl("canvas");
        this.createDoughnutChart(doughnutCanvas, analytics);
    }

    filterByPeriod(analytics: AnalyticsEntry[]) {
        const { start, end } = this.view.getPeriodRange(); const s = start.getTime(), e = end.getTime();
        return analytics.filter((a: AnalyticsEntry) => { const t = new Date(a.timestamp).getTime(); return t >= s && t <= e; });
    }
    calculateTagTotals(list: AnalyticsEntry[]) {
        const totals: Record<string, number> = {}; list.forEach((entry: AnalyticsEntry) => (entry.tags || []).forEach((tag: string) => { totals[tag] = (totals[tag] || 0) + entry.duration; })); return totals;
    }
    getBaseChartOptions() {
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        return {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: { label: (ctx: any) => `${ctx.label}: ${TimerUtils.formatDuration(ctx.raw)}` },
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: text, bodyColor: text, borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)', borderWidth: 1
                },
                legend: { labels: { color: text } }
            }
        };
    }
    createChart(canvas: any, type: any, data: any, specificOptions: any = {}, plugins: any[] = []) {
        const base = this.getBaseChartOptions(); const options = { ...base, ...specificOptions, plugins: { ...base.plugins, ...specificOptions.plugins } };
        return new Chart(canvas.getContext('2d'), { type, data, options, plugins });
    }
    createGradient(canvas: any, axis = 'x') {
        return (ctx: any) => {
            const chart = ctx.chart; const { ctx: c, chartArea } = chart; if (!chartArea) return null;
            const isDark = document.body.classList.contains('theme-dark');
            const grad = axis === 'y' ? c.createLinearGradient(chartArea.left, 0, chartArea.right, 0) : c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            if (isDark) { grad.addColorStop(0, 'rgba(54, 162, 235, 0.8)'); grad.addColorStop(1, 'rgba(153, 102, 255, 0.8)'); }
            else { grad.addColorStop(0, 'rgba(54, 162, 235, 0.7)'); grad.addColorStop(1, 'rgba(153, 102, 255, 0.7)'); }
            return grad;
        };
    }

    createBarChart(canvas: any, analytics: AnalyticsEntry[]) {
        const periodData = this.filterByPeriod(analytics);
        const tagTotals = this.calculateTagTotals(periodData);
        const sorted = Object.entries(tagTotals).filter(([, sec]) => sec > 0).sort(([, a], [, b]) => b - a);
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        const isOutside = (ctx: any) => { const value = ctx.dataset.data[ctx.dataIndex]; const max = Math.max(...ctx.dataset.data); return (value / max) * 100 < 20; };
        const chartData = {
            labels: sorted.map(([tag]) => TimerUtils.formatTagLabel(tag)),
            datasets: [{
                label: 'Total time',
                data: sorted.map(([, sec]) => sec),
                backgroundColor: this.createGradient(canvas, 'y'),
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                borderWidth: 1, borderRadius: 6, hoverBackgroundColor: isDark ? 'rgba(54, 162, 235, 1)' : 'rgba(54, 162, 235, 0.9)'
            }]
        };
        const options = {
            indexAxis: 'y',
            scales: {
                x: { display: false, grid: { display: false } },
                y: { ticks: { color: text, font: { size: 14 } }, grid: { display: false } }
            },
            plugins: {
                legend: { display: false }, tooltip: { enabled: false },
                datalabels: {
                    anchor: 'end', align: (ctx: any) => isOutside(ctx) ? 'end' : 'start', color: text, font: { size: 14, weight: 'bold' },
                    formatter: (v: any) => `${TimerUtils.formatDuration(v)}  `, offset: (ctx: any) => isOutside(ctx) ? 4 : -4,
                }
            }
        };
        if (this.barChartInstance) this.barChartInstance.destroy();
        const chart = this.createChart(canvas, 'bar', chartData, options);
        this.barChartInstance = chart;
        this.addChartContextMenu(canvas, chart, sorted);
    }

    createDailyBarChart(canvas: any, analytics: AnalyticsEntry[]) {
        const { start } = this.view.getPeriodRange();
        const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
        const period = this.filterByPeriod(analytics);
        const totals = days.map(day => {
            const s = TimerUtils.startOfDay(day).getTime(), e = TimerUtils.endOfDay(day).getTime();
            return period.filter(a => { const t = new Date(a.timestamp).getTime(); return t >= s && t <= e; }).reduce((sum, a) => sum + a.duration, 0);
        });
        const labels = days.map(d => TimerUtils.formatMMMDD(d));
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        const options = {
            scales: {
                y: { beginAtZero: true, ticks: { color: text, callback: (v: any) => TimerUtils.formatDuration(v) }, grid: { color: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' } },
                x: { ticks: { color: text }, grid: { display: false } }
            }, plugins: { legend: { display: false } }
        };
        const data = {
            labels, datasets: [{
                label: 'Daily total', data: totals, backgroundColor: this.createGradient(canvas, 'x'),
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)', borderWidth: 1, borderRadius: 6
            }]
        };
        if (this.barChartInstance) this.barChartInstance.destroy();
        this.barChartInstance = this.createChart(canvas, 'bar', data, options);
    }

    createDoughnutChart(canvas: any, analytics: AnalyticsEntry[]) {
        const periodData = this.filterByPeriod(analytics);
        const tagTotals = this.calculateTagTotals(periodData);
        const isDark = document.body.classList.contains('theme-dark'); const text = isDark ? 'white' : '#333333';
        if (Object.keys(tagTotals).length === 0) {
            const p = canvas.parentElement.createEl('p', { text: `No data for selected period.` });
            p.addClass('timer-text-center');
            canvas.remove(); return;
        }
        const total = Object.values(tagTotals).reduce((s, v) => s + v, 0);
        const data = {
            labels: Object.keys(tagTotals).map(tag => TimerUtils.formatTagLabel(tag)),
            datasets: [{ label: `Time spent`, data: Object.values(tagTotals), backgroundColor: this.getDoughnutColors(), borderColor: isDark ? '#333333' : '#ffffff', borderWidth: 2, hoverOffset: 8 }]
        };
        const centerText = {
            id: 'centerText',
            afterDraw: (chart: any) => {
                const { ctx, chartArea } = chart; if (!chartArea?.width || !chartArea?.height) return;
                ctx.save(); const cx = (chartArea.left + chartArea.right) / 2; const cy = (chartArea.top + chartArea.bottom) / 2;
                ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(TimerUtils.formatDuration(total), cx, cy); ctx.restore();
            }
        };
        const options = {
            plugins: {
                legend: { position: 'top', labels: { color: text, font: { size: 14 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx: any) => {
                            const value = ctx.raw; const tot = ctx.chart.getDatasetMeta(0).total;
                            const pct = ((value / tot) * 100).toFixed(2); return `${ctx.label}: ${TimerUtils.formatDuration(value)} (${pct}%)`;
                        }
                    },
                    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: text, bodyColor: text, borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', borderWidth: 1
                },
                datalabels: {
                    color: text, font: { size: 12, weight: 'bold' }, align: 'center', anchor: 'center',
                    formatter: (v: any, ctx: any) => { const tot = ctx.chart.getDatasetMeta(0).total; return `${((v / tot) * 100).toFixed(1)}%`; }
                }
            }
        };
        if (this.doughnutChartInstance) this.doughnutChartInstance.destroy();
        this.doughnutChartInstance = this.createChart(canvas, 'doughnut', data, options, [centerText]);
    }

    getDoughnutColors() {
        return ['#9050deff', '#3678e3ff', '#A55B4Bff', '#1daec4ff', '#d8324eff', '#26c2aeff', '#28c088ff', '#cd742cff', '#dc549aff', '#5c69dbff', '#70839dff', '#065084ff', '#4F1C51ff'];
    }

    addChartContextMenu(canvas: any, chart: any, sortedTags: any[]) {
        canvas.addEventListener('contextmenu', (e: any) => {
            e.preventDefault();
            const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true); if (!points.length) return;
            const idx = points[0].index; const label = chart.data.labels[idx]; const tag = `#${label}`; const currentValue = sortedTags[idx][1];
            // @ts-ignore
            const menu = new Menu(this.app);
            menu.addItem((item: any) => item.setTitle(`Edit "${label}" (this period)`).setIcon("pencil").onClick(() => this.showEditModal(tag, currentValue)));
            menu.addItem((item: any) => item.setTitle(`Clear "${label}" (this period)`).setIcon("trash").onClick(async () => {
                await this.deleteTagData(tag);
                this.view.onOpen();
            }));
            menu.showAtMouseEvent(e);
        });
    }
    showEditModal(tag: string, currentValue: number) {
        const modal = new Modal(this.app); modal.contentEl.createEl("h2", { text: `Edit time for ${tag}` });
        let newSeconds = currentValue;
        const input = new TextComponent(modal.contentEl).setValue(String(currentValue)).onChange((v: string) => { newSeconds = parseInt(v, 10); });
        input.inputEl.type = 'number';
        input.inputEl.addClass('timer-modal-input');
        new Setting(modal.contentEl).addButton((btn: any) => btn.setButtonText("Save").setCta().onClick(async () => {
            if (!isNaN(newSeconds) && newSeconds >= 0) { await this.updateTagTime(tag, newSeconds); modal.close(); this.view.onOpen(); }
            else new Notice("Please enter a valid number of seconds.");
        }));
        modal.open();
    }
    async updateTagTime(tagToUpdate: string, newTotalDuration: number) {
        const range = this.view.getPeriodRange(); let anchorDateForAdjustment = this.view.anchorDate;
        if (this.view.showWeekly) anchorDateForAdjustment = range.start;
        await this.view.analyticsStore.setTagTotalForPeriod(tagToUpdate, newTotalDuration, range, anchorDateForAdjustment);
    }
    async deleteTagData(tagToDelete: string) {
        const range = this.view.getPeriodRange(); let anchorDateForAdjustment = this.view.anchorDate;
        if (this.view.showWeekly) anchorDateForAdjustment = range.start;
        await this.view.analyticsStore.setTagTotalForPeriod(tagToDelete, 0, range, anchorDateForAdjustment);
    }
}
