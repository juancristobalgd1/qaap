// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { appendAgentBrandIcon } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import type {
    QaapUsageBucket,
    QaapUsageLimits,
    QaapUsageProviderLimits,
    QaapUsageProviderRow,
    QaapUsageRange,
    QaapUsageSummary,
    QaapUsageTokenBreakdown
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import { UsageChartPathBuilder, UsageStackedSeries } from './usage-chart-path';
import { UsageNumberFormat } from './usage-format';

/** Which measure the Cost and Tokens views show. */
export type UsageMeasure = 'cost' | 'tokens';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 240;
const PLOT_LEFT = 56;
const PLOT_RIGHT = 12;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 28;
const TICK_COUNT = 4;
/** Candidate axis ceilings, as multiples of a power of ten. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

const PROVIDER_LABELS: Record<string, string> = {
    claude: 'Claude',
    codex: 'Codex',
    opencode: 'OpenCode',
    pi: 'Pi',
    grok: 'Grok',
    copilot: 'Copilot',
    antigravity: 'Antigravity'
};

const TOKEN_TYPES: ReadonlyArray<{ key: keyof QaapUsageTokenBreakdown; label: () => string }> = [
    { key: 'input', label: () => nls.localize('qaap/usage/uncachedInput', 'Uncached input') },
    { key: 'cachedInput', label: () => nls.localize('qaap/usage/cachedInput', 'Cached input') },
    { key: 'cacheWrite', label: () => nls.localize('qaap/usage/cacheWrite', 'Cache write') },
    { key: 'output', label: () => nls.localize('qaap/usage/output', 'Output') },
    { key: 'reasoning', label: () => nls.localize('qaap/usage/reasoning', 'Reasoning') }
];

/**
 * Builds the body of the Usage dialog: summary (overview, chart, totals) and limits.
 * It only builds DOM from its inputs; the dialog owns fetching, state and layout.
 */
export class UsageDialogBody {

    protected readonly numbers = new UsageNumberFormat();
    protected readonly paths = new UsageChartPathBuilder();

    providerLabel(provider: string): string {
        return PROVIDER_LABELS[provider] ?? provider;
    }

    /** Summary view for the Cost or Tokens measure. */
    renderSummary(summary: QaapUsageSummary, measure: UsageMeasure, timezone: string): HTMLElement {
        const root = this.element('div', 'theia-qaap-usage-summary');
        if (summary.skippedRecords > 0) {
            root.append(this.element('p', 'theia-qaap-usage-notice', nls.localize(
                'qaap/usage/skippedRecords',
                '{0} malformed or inconsistent usage record(s) were skipped; usage may be incomplete.',
                summary.skippedRecords
            )));
        }
        if (summary.scanning) {
            root.append(this.renderScanning());
        }
        const overview = this.element('div', 'theia-qaap-usage-overview');
        overview.append(this.renderOverviewLeft(summary, measure), this.renderChart(summary, measure, timezone));
        root.append(overview, this.renderTotals(summary));
        return root;
    }

    /** Rate-limit cards, one per provider. `now` drives the reset countdowns. */
    renderLimits(limits: QaapUsageLimits, now: number): HTMLElement {
        const root = this.element('div', 'theia-qaap-usage-limits');
        if (limits.providers.length === 0) {
            root.append(this.element('p', 'theia-qaap-usage-empty', nls.localize('qaap/usage/noLimits', 'No limit information is available.')));
            return root;
        }
        for (const provider of limits.providers) {
            root.append(this.renderLimitCard(provider, now));
        }
        return root;
    }

    /** Singular or plural session label; `count` is passed as the formatted `{0}` argument. */
    protected sessionCountLabel(count: number, singularKey: string, singularText: string, pluralKey: string, pluralText: string): string {
        const formatted = this.numbers.formatInteger(count);
        return count === 1
            ? nls.localize(singularKey, singularText, formatted)
            : nls.localize(pluralKey, pluralText, formatted);
    }

    protected renderScanning(): HTMLElement {
        const block = this.element('div', 'theia-qaap-usage-scanning');
        block.append(
            this.element('p', 'theia-qaap-usage-scanning-text', nls.localize('qaap/usage/scanning', 'Scanning local agent logs…')),
            this.element('div', 'theia-qaap-usage-skeleton')
        );
        return block;
    }

    protected renderOverviewLeft(summary: QaapUsageSummary, measure: UsageMeasure): HTMLElement {
        const left = this.element('div', 'theia-qaap-usage-overview-left');
        const headline = measure === 'cost'
            ? this.numbers.formatUsd(summary.totals.costUsd)
            : this.numbers.formatTokens(summary.totals.tokens);
        left.append(this.element('div', 'theia-qaap-usage-total', headline));
        const subtitle = this.element('div', 'theia-qaap-usage-total-sub');
        subtitle.append(
            this.element('span', undefined, this.sessionCountLabel(summary.totals.sessions, 'qaap/usage/sessionEstimate', '{0} session · API estimate', 'qaap/usage/sessionsEstimate', '{0} sessions · API estimate')),
            this.element('span', 'theia-qaap-usage-info codicon codicon-info')
        );
        subtitle.querySelector('.theia-qaap-usage-info')?.setAttribute('title', nls.localize(
            'qaap/usage/estimateInfo',
            'Estimated from list prices. The cost reported by the CLI is used when it provides one.'
        ));
        left.append(subtitle);
        if (summary.providers.length === 0) {
            left.append(this.element('p', 'theia-qaap-usage-empty', nls.localize('qaap/usage/noUsage', 'No usage in this period.')));
            return left;
        }
        const list = this.element('div', 'theia-qaap-usage-providers');
        for (const row of summary.providers) {
            list.append(this.renderProviderRow(row, summary, measure));
        }
        left.append(list);
        return left;
    }

    protected renderProviderRow(row: QaapUsageProviderRow, summary: QaapUsageSummary, measure: UsageMeasure): HTMLElement {
        const item = this.element('div', `theia-qaap-usage-provider-row theia-qaap-usage-provider-${row.provider}`);
        item.append(this.element('span', 'theia-qaap-usage-provider-dot'));
        appendAgentBrandIcon(item, row.provider, 'sm');
        const names = this.element('div', 'theia-qaap-usage-provider-names');
        names.append(
            this.element('span', 'theia-qaap-usage-provider-name', this.providerLabel(row.provider)),
            this.element('span', 'theia-qaap-usage-provider-sub', this.sessionCountLabel(row.sessions, 'qaap/usage/sessionCountOne', '{0} session', 'qaap/usage/sessionCount', '{0} sessions'))
        );
        const share = measure === 'cost'
            ? this.numbers.formatShare(row.costUsd, summary.totals.costUsd)
            : this.numbers.formatShare(row.tokens, summary.totals.tokens);
        const unit = measure === 'cost' ? nls.localize('qaap/usage/unitCost', 'cost') : nls.localize('qaap/usage/unitTokens', 'tokens');
        names.append(this.element('span', 'theia-qaap-usage-provider-share', nls.localize('qaap/usage/shareOf', '{0} of {1}', share, unit)));
        const value = measure === 'cost' ? this.numbers.formatUsd(row.costUsd) : this.numbers.formatTokens(row.tokens);
        item.append(names, this.element('span', 'theia-qaap-usage-provider-value', value));
        return item;
    }

    /** Stacked area chart of the daily (or hourly) totals per provider, with a hover tooltip. */
    protected renderChart(summary: QaapUsageSummary, measure: UsageMeasure, timezone: string): HTMLElement {
        const hourly = summary.range === '24h';
        const card = this.element('div', 'theia-qaap-usage-chart');
        const heading = measure === 'cost'
            ? (hourly ? nls.localize('qaap/usage/hourlyCost', 'Hourly cost') : nls.localize('qaap/usage/dailyCost', 'Daily cost'))
            : (hourly ? nls.localize('qaap/usage/hourlyTokens', 'Hourly processed tokens') : nls.localize('qaap/usage/dailyTokens', 'Daily processed tokens'));
        card.append(this.element('h3', 'theia-qaap-usage-section-title', heading));
        const buckets = summary.buckets;
        if (buckets.length === 0) {
            card.append(this.element('p', 'theia-qaap-usage-empty', nls.localize('qaap/usage/noUsage', 'No usage in this period.')));
            return card;
        }
        const series: UsageStackedSeries[] = summary.providers.map(row => ({
            key: row.provider,
            values: buckets.map(bucket => this.bucketValue(bucket, row.provider, measure))
        }));
        const totals = buckets.map((_, index) => series.reduce((sum, entry) => sum + entry.values[index], 0));
        const yMax = this.niceCeiling(Math.max(0, ...totals));
        const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
        const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
        const xAt = (index: number): number => buckets.length <= 1
            ? PLOT_LEFT + plotWidth / 2
            : PLOT_LEFT + index * (plotWidth / (buckets.length - 1));
        const yAt = (value: number): number => PLOT_TOP + plotHeight - (value / yMax) * plotHeight;
        const format = (value: number): string => measure === 'cost' ? this.numbers.formatUsd(value) : this.numbers.formatTokens(value);

        const svg = this.createSvg();
        svg.setAttribute('aria-label', heading);
        for (let tick = 0; tick <= TICK_COUNT; tick++) {
            const value = (yMax * tick) / TICK_COUNT;
            const y = yAt(value);
            svg.append(
                this.svgElement('line', { class: 'theia-qaap-usage-grid', x1: PLOT_LEFT, x2: CHART_WIDTH - PLOT_RIGHT, y1: y, y2: y }),
                this.svgText(format(value), { class: 'theia-qaap-usage-axis', x: PLOT_LEFT - 8, y: y + 4, 'text-anchor': 'end' })
            );
        }
        for (const entry of this.paths.stackedAreaPaths(series, buckets.length, (index, value) => ({ x: xAt(index), y: yAt(value) }))) {
            svg.append(this.svgElement('path', { class: `theia-qaap-usage-area theia-qaap-usage-provider-${entry.key}`, d: entry.path }));
        }
        const labelIndexes = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
        labelIndexes.forEach(index => {
            const anchor = index === 0 ? 'start' : index === buckets.length - 1 ? 'end' : 'middle';
            svg.append(this.svgText(this.bucketLabel(buckets[index].start, hourly, timezone), {
                class: 'theia-qaap-usage-axis',
                x: xAt(index),
                y: CHART_HEIGHT - 8,
                'text-anchor': anchor
            }));
        });
        const cursor = this.svgElement('line', { class: 'theia-qaap-usage-cursor', x1: 0, x2: 0, y1: PLOT_TOP, y2: PLOT_TOP + plotHeight });
        const target = this.svgElement('rect', { class: 'theia-qaap-usage-hover-target', x: PLOT_LEFT, y: PLOT_TOP, width: plotWidth, height: plotHeight });
        svg.append(cursor, target);

        const tooltip = this.element('div', 'theia-qaap-usage-tooltip');
        tooltip.hidden = true;
        const frame = this.element('div', 'theia-qaap-usage-chart-frame');
        frame.append(svg, tooltip);
        const showIndex = (index: number): void => {
            const x = xAt(index);
            cursor.setAttribute('x1', String(x));
            cursor.setAttribute('x2', String(x));
            tooltip.textContent = '';
            tooltip.append(this.tooltipContent(buckets[index], series, index, totals[index], hourly, timezone, measure));
            tooltip.hidden = false;
            tooltip.style.left = `${(x / CHART_WIDTH) * 100}%`;
        };
        target.addEventListener('pointermove', (event: Event) => {
            const pointer = event as PointerEvent;
            const rect = svg.getBoundingClientRect();
            if (rect.width === 0) {
                return;
            }
            const viewX = ((pointer.clientX - rect.left) / rect.width) * CHART_WIDTH;
            const ratio = (viewX - PLOT_LEFT) / plotWidth;
            const index = Math.min(buckets.length - 1, Math.max(0, Math.round(ratio * (buckets.length - 1))));
            showIndex(index);
        });
        target.addEventListener('pointerleave', () => { tooltip.hidden = true; });
        card.append(frame);
        return card;
    }

    protected tooltipContent(
        bucket: QaapUsageBucket,
        series: readonly UsageStackedSeries[],
        index: number,
        total: number,
        hourly: boolean,
        timezone: string,
        measure: UsageMeasure
    ): HTMLElement {
        const content = this.element('div', 'theia-qaap-usage-tooltip-content');
        content.append(this.element('div', 'theia-qaap-usage-tooltip-date', this.bucketLabel(bucket.start, hourly, timezone)));
        const format = (value: number): string => measure === 'cost' ? this.numbers.formatUsd(value) : this.numbers.formatTokens(value);
        for (const entry of series) {
            const value = entry.values[index];
            if (value <= 0) {
                continue;
            }
            const line = this.element('div', `theia-qaap-usage-tooltip-row theia-qaap-usage-provider-${entry.key}`);
            line.append(
                this.element('span', 'theia-qaap-usage-provider-dot'),
                this.element('span', 'theia-qaap-usage-tooltip-name', this.providerLabel(entry.key)),
                this.element('span', 'theia-qaap-usage-tooltip-value', format(value))
            );
            content.append(line);
        }
        content.append(this.element('div', 'theia-qaap-usage-tooltip-total', nls.localize('qaap/usage/total', 'Total') + ` ${format(total)}`));
        return content;
    }

    protected renderTotals(summary: QaapUsageSummary): HTMLElement {
        const section = this.element('section', 'theia-qaap-usage-totals');
        section.append(this.element('h3', 'theia-qaap-usage-section-title', nls.localize('qaap/usage/totals', 'Totals')));
        const grid = this.element('dl', 'theia-qaap-usage-totals-grid');
        const breakdown = summary.totals.breakdown;
        const entries: Array<[string, string]> = [
            [nls.localize('qaap/usage/processedTokens', 'Processed tokens'), this.numbers.formatTokens(summary.totals.tokens)],
            [nls.localize('qaap/usage/cachedInput', 'Cached input'), this.numbers.formatTokens(breakdown.cachedInput)],
            [nls.localize('qaap/usage/uncachedInput', 'Uncached input'), this.numbers.formatTokens(breakdown.input)],
            [nls.localize('qaap/usage/output', 'Output'), this.numbers.formatTokens(breakdown.output)],
            [nls.localize('qaap/usage/cacheSavings', 'Cache savings'), this.numbers.formatUsd(summary.totals.cacheSavingsUsd)]
        ];
        for (const [label, value] of entries) {
            const item = this.element('div', 'theia-qaap-usage-totals-item');
            item.append(this.element('dt', 'theia-qaap-usage-totals-label', label), this.element('dd', 'theia-qaap-usage-totals-value', value));
            grid.append(item);
        }
        section.append(grid, this.renderTypeBar(breakdown));
        return section;
    }

    /** Segmented bar of processed tokens by type. */
    protected renderTypeBar(breakdown: QaapUsageTokenBreakdown): HTMLElement {
        const block = this.element('div', 'theia-qaap-usage-type');
        block.append(this.element('h4', 'theia-qaap-usage-type-title', nls.localize('qaap/usage/tokensByType', 'Tokens by type')));
        const sum = TOKEN_TYPES.reduce((total, type) => total + Math.max(0, breakdown[type.key]), 0);
        const bar = this.element('div', 'theia-qaap-usage-type-bar');
        const legend = this.element('ul', 'theia-qaap-usage-type-legend');
        for (const type of TOKEN_TYPES) {
            const value = Math.max(0, breakdown[type.key]);
            const segment = this.element('span', `theia-qaap-usage-type-segment theia-qaap-usage-type-${type.key}`);
            segment.style.width = sum > 0 ? `${(value / sum) * 100}%` : '0%';
            bar.append(segment);
            const item = this.element('li', `theia-qaap-usage-type-item theia-qaap-usage-type-${type.key}`);
            item.append(
                this.element('span', 'theia-qaap-usage-type-swatch'),
                this.element('span', 'theia-qaap-usage-type-name', type.label()),
                this.element('span', 'theia-qaap-usage-type-amount', this.numbers.formatTokens(value))
            );
            legend.append(item);
        }
        block.append(bar, legend);
        return block;
    }

    protected renderLimitCard(provider: QaapUsageProviderLimits, now: number): HTMLElement {
        const card = this.element('section', `theia-qaap-usage-limit-card theia-qaap-usage-provider-${provider.provider}`);
        const head = this.element('header', 'theia-qaap-usage-limit-head');
        appendAgentBrandIcon(head, provider.provider, 'sm');
        head.append(this.element('span', 'theia-qaap-usage-provider-name', this.providerLabel(provider.provider)));
        card.append(head);
        if (provider.status !== 'ok' || provider.windows.length === 0) {
            const reason = provider.status === 'error'
                ? nls.localize('qaap/usage/limitError', 'Could not read limits: {0}', provider.reason ?? '')
                : provider.reason ?? nls.localize('qaap/usage/limitUnavailable', 'Limits are unavailable.');
            card.append(this.element('p', 'theia-qaap-usage-limit-reason', reason));
            return card;
        }
        for (const window of provider.windows) {
            const used = Math.min(100, Math.max(0, window.usedPercent));
            const row = this.element('div', 'theia-qaap-usage-limit-window');
            const top = this.element('div', 'theia-qaap-usage-limit-top');
            top.append(
                this.element('span', 'theia-qaap-usage-limit-label', window.label),
                this.element('span', 'theia-qaap-usage-limit-left', nls.localize('qaap/usage/percentLeft', '{0} left', this.numbers.formatPercent(100 - used)))
            );
            const track = this.element('div', 'theia-qaap-usage-limit-track');
            const fill = this.element('span', 'theia-qaap-usage-limit-fill');
            fill.style.width = `${used}%`;
            track.append(fill);
            row.append(top, track);
            const countdown = this.numbers.formatResetCountdown(window.resetsAt, now);
            if (countdown !== undefined) {
                const chip = this.element('span', 'theia-qaap-usage-limit-reset', `↻ ${countdown}`);
                chip.title = nls.localize('qaap/usage/resetsIn', 'Resets in {0}', countdown);
                row.append(chip);
            }
            card.append(row);
        }
        return card;
    }

    protected bucketValue(bucket: QaapUsageBucket, provider: string, measure: UsageMeasure): number {
        const entry = bucket.perProvider[provider];
        if (!entry) {
            return 0;
        }
        const value = measure === 'cost' ? entry.costUsd : entry.tokens;
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    protected bucketLabel(start: string, hourly: boolean, timezone: string): string {
        const date = new Date(start);
        if (Number.isNaN(date.getTime())) {
            return start;
        }
        const options: Intl.DateTimeFormatOptions = hourly
            ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
            : { month: 'short', day: 'numeric' };
        try {
            return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(date);
        } catch {
            return new Intl.DateTimeFormat('en-US', options).format(date);
        }
    }

    /** Smallest "nice" ceiling at or above `value`, so the axis ends on a round number. */
    protected niceCeiling(value: number): number {
        if (!(value > 0)) {
            return 1;
        }
        const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
        const normalized = value / magnitude;
        const step = NICE_STEPS.find(candidate => candidate >= normalized) ?? 10;
        return step * magnitude;
    }

    protected createSvg(): SVGSVGElement {
        return this.svgElement('svg', {
            class: 'theia-qaap-usage-svg',
            viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
            role: 'img'
        });
    }

    protected svgText(text: string, attributes: Record<string, string | number>): SVGTextElement {
        const node = this.svgElement('text', attributes);
        node.textContent = text;
        return node;
    }

    protected svgElement<K extends 'svg' | 'line' | 'path' | 'rect' | 'text'>(
        tag: K,
        attributes: Record<string, string | number>
    ): SVGElementTagNameMap[K] {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [name, value] of Object.entries(attributes)) {
            node.setAttribute(name, String(value));
        }
        return node;
    }

    protected element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }
}

/** Range choices shown by the dialog, in display order. */
export const USAGE_RANGE_OPTIONS: ReadonlyArray<{ value: QaapUsageRange; label: () => string }> = [
    { value: '24h', label: () => nls.localize('qaap/usage/range24h', 'Past 24h') },
    { value: '7d', label: () => nls.localize('qaap/usage/range7d', '7 days') },
    { value: '30d', label: () => nls.localize('qaap/usage/range30d', '30 days') },
    { value: '90d', label: () => nls.localize('qaap/usage/range90d', '90 days') }
];
