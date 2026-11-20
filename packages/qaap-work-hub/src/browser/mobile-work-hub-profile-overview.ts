// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { appendAgentBrandIcon } from '@theia/qaap-shared-core/lib/common/qaap-agent-branding';
import { formatQaiqModelDisplayLabel } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-model-catalog';
import { resolveAgentDisplayLabel } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import type { QaapProfileInsights, QaapProfileUsageShare } from '../common/qaap-profile-insights';

const EMPTY_VALUE = '—';

/** The account the Profile header shows. */
export interface MobileWorkHubProfileIdentityView {
    readonly name: string;
    readonly detail: string;
    readonly avatarUrl?: string;
    readonly initials: string;
    readonly providerLabel: string;
}

/**
 * The Profile page's overview: a centered account header, a strip of headline numbers (tokens, peak day, tasks,
 * streaks), and once the history loads, activity insights and model usage. The activity calendar is mounted between
 * the strip and the insights by the owner ({@link calendarSlot}). Rendering only: the owner passes the data in.
 */
export class MobileWorkHubProfileOverview {

    readonly node: HTMLElement;
    /** Where the owner mounts the activity calendar. */
    readonly calendarSlot: HTMLElement;
    protected readonly stats = new Map<'tokens' | 'peak' | 'tasks' | 'current' | 'longest', HTMLElement>();
    protected readonly details: HTMLElement;

    constructor(identity: MobileWorkHubProfileIdentityView, withActivity: boolean) {
        this.node = document.createElement('div');
        this.node.className = 'qaap-profile-overview';
        this.node.append(this.createHero(identity));
        this.calendarSlot = document.createElement('div');
        this.calendarSlot.className = 'qaap-profile-overview-calendar';
        this.details = document.createElement('div');
        this.details.className = 'qaap-profile-overview-details';
        if (withActivity) {
            this.node.append(this.createStatsStrip(), this.calendarSlot, this.details);
        }
    }

    /** Fills the strip and the insights from the task history. */
    setInsights(insights: QaapProfileInsights): void {
        this.setStat('tasks', formatCount(insights.tasks));
        this.setStat('peak', insights.peakDay
            ? new Date(insights.peakDay.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : EMPTY_VALUE);
        this.setStat('current', formatDays(insights.currentStreakDays));
        this.setStat('longest', formatDays(insights.longestStreakDays));
        this.details.replaceChildren(this.createInsightsSection(insights), this.createModelUsageSection(insights.models));
    }

    /** Tokens over the usage window; `undefined` when the usage data is unavailable. */
    setTokens(tokens: number | undefined): void {
        this.setStat('tokens', tokens === undefined ? EMPTY_VALUE : formatCompact(tokens));
    }

    /** The task history could not be read: the numbers stay empty and say so. */
    showHistoryError(): void {
        for (const key of ['peak', 'tasks', 'current', 'longest'] as const) {
            this.setStat(key, EMPTY_VALUE);
        }
        const message = document.createElement('p');
        message.className = 'qaap-profile-overview-empty';
        message.textContent = nls.localize('qaap/workHubSettings/profile/historyUnavailable', 'Your activity could not be loaded right now.');
        this.details.replaceChildren(message);
    }

    protected createHero(identity: MobileWorkHubProfileIdentityView): HTMLElement {
        const hero = document.createElement('header');
        hero.className = 'qaap-profile-overview-hero';
        const avatar = document.createElement('div');
        avatar.className = 'qaap-profile-overview-avatar';
        if (identity.avatarUrl) {
            const image = document.createElement('img');
            image.src = identity.avatarUrl;
            image.alt = '';
            image.draggable = false;
            image.referrerPolicy = 'no-referrer';
            image.decoding = 'async';
            avatar.append(image);
        } else {
            avatar.textContent = identity.initials;
        }
        const name = document.createElement('h2');
        name.className = 'qaap-profile-overview-name';
        name.textContent = identity.name;
        const meta = document.createElement('div');
        meta.className = 'qaap-profile-overview-meta';
        if (identity.detail) {
            const detail = document.createElement('span');
            detail.className = 'qaap-profile-overview-login';
            detail.textContent = identity.detail;
            meta.append(detail);
        }
        const provider = document.createElement('span');
        provider.className = 'qaap-profile-overview-provider';
        provider.textContent = identity.providerLabel;
        meta.append(provider);
        hero.append(avatar, name, meta);
        return hero;
    }

    protected createStatsStrip(): HTMLElement {
        const strip = document.createElement('dl');
        strip.className = 'qaap-profile-overview-stats';
        const cells: ReadonlyArray<['tokens' | 'peak' | 'tasks' | 'current' | 'longest', string]> = [
            ['tokens', nls.localize('qaap/workHubSettings/profile/statTokens', 'Tokens (90 days)')],
            ['peak', nls.localize('qaap/workHubSettings/profile/statPeakDay', 'Peak day')],
            ['tasks', nls.localize('qaap/workHubSettings/profile/statTasks', 'Total tasks')],
            ['current', nls.localize('qaap/workHubSettings/profile/statCurrentStreak', 'Current streak')],
            ['longest', nls.localize('qaap/workHubSettings/profile/statLongestStreak', 'Longest streak')],
        ];
        for (const [key, label] of cells) {
            const cell = document.createElement('div');
            cell.className = 'qaap-profile-overview-stat';
            cell.dataset.stat = key;
            const value = document.createElement('dd');
            value.className = 'qaap-profile-overview-stat-value';
            value.textContent = EMPTY_VALUE;
            const term = document.createElement('dt');
            term.className = 'qaap-profile-overview-stat-label';
            term.textContent = label;
            cell.append(value, term);
            strip.append(cell);
            this.stats.set(key, value);
        }
        return strip;
    }

    protected setStat(key: 'tokens' | 'peak' | 'tasks' | 'current' | 'longest', value: string): void {
        const element = this.stats.get(key);
        if (element) {
            element.textContent = value;
        }
    }

    protected createInsightsSection(insights: QaapProfileInsights): HTMLElement {
        const section = createSection(nls.localize('qaap/workHubSettings/profile/insightsTitle', 'Activity insights'));
        const list = document.createElement('dl');
        list.className = 'qaap-profile-overview-insights';
        const topHarness = insights.harnesses[0];
        const rows: Array<[string, string]> = [
            [
                nls.localize('qaap/workHubSettings/profile/mostUsedHarness', 'Most used harness'),
                topHarness ? `${resolveAgentDisplayLabel(topHarness.agentId)} · ${formatPercent(topHarness.share)}` : EMPTY_VALUE,
            ],
            [
                nls.localize('qaap/workHubSettings/profile/mostActiveHour', 'Most active hour'),
                insights.mostActiveHour === undefined ? EMPTY_VALUE : formatHour(insights.mostActiveHour),
            ],
            [nls.localize('qaap/workHubSettings/profile/harnessesUsed', 'Harnesses used'), formatCount(insights.harnesses.length)],
            [nls.localize('qaap/workHubSettings/profile/projects', 'Projects'), formatCount(insights.projects)],
            [nls.localize('qaap/workHubSettings/profile/messages', 'Total messages'), formatCount(insights.messages)],
        ];
        for (const [label, value] of rows) {
            const row = document.createElement('div');
            row.className = 'qaap-profile-overview-insight';
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value;
            row.append(term, description);
            list.append(row);
        }
        section.append(list);
        return section;
    }

    protected createModelUsageSection(models: readonly QaapProfileUsageShare[]): HTMLElement {
        const section = createSection(nls.localize('qaap/workHubSettings/profile/modelUsageTitle', 'Model usage'));
        if (models.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'qaap-profile-overview-empty';
            empty.textContent = nls.localize('qaap/workHubSettings/profile/noModelUsage', 'Run a task to see which models you use.');
            section.append(empty);
            return section;
        }
        const list = document.createElement('ul');
        list.className = 'qaap-profile-overview-models';
        for (const model of models) {
            const item = document.createElement('li');
            item.className = 'qaap-profile-overview-model';
            const head = document.createElement('div');
            head.className = 'qaap-profile-overview-model-head';
            appendAgentBrandIcon(head, model.agentId, 'sm');
            const label = document.createElement('span');
            label.className = 'qaap-profile-overview-model-label';
            label.textContent = formatQaiqModelDisplayLabel({ modelId: model.modelId ?? '' });
            label.title = `${resolveAgentDisplayLabel(model.agentId)} · ${model.modelId ?? ''}`;
            const share = document.createElement('span');
            share.className = 'qaap-profile-overview-model-share';
            share.textContent = formatPercent(model.share);
            head.append(label, share);
            const bar = document.createElement('div');
            bar.className = 'qaap-profile-overview-model-bar';
            bar.setAttribute('role', 'presentation');
            const fill = document.createElement('span');
            fill.className = 'qaap-profile-overview-model-fill';
            fill.style.setProperty('--qaap-profile-share', `${Math.max(2, Math.round(model.share * 100))}%`);
            bar.append(fill);
            item.append(head, bar);
            list.append(item);
        }
        section.append(list);
        return section;
    }
}

function createSection(title: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'qaap-profile-overview-section';
    const heading = document.createElement('h3');
    heading.className = 'qaap-profile-overview-section-title';
    heading.textContent = title;
    section.append(heading);
    return section;
}

function formatCount(value: number): string {
    return new Intl.NumberFormat().format(value);
}

function formatCompact(value: number): string {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatPercent(share: number): string {
    return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

function formatDays(days: number): string {
    return days === 1
        ? nls.localize('qaap/workHubSettings/profile/oneDay', '1 day')
        : nls.localize('qaap/workHubSettings/profile/days', '{0} days', formatCount(days));
}

function formatHour(hour: number): string {
    return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric' });
}
