// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import {
    cancelResearchGoal,
    fetchResearchGoalDetail,
    fetchResearchGoals,
} from '../common/qaap-research-client';
import {
    filterResearchGoalsByQuery,
    researchGoalCwdBasename,
    type ResearchGoal,
    type ResearchMetricSpec,
    type TerminationReason,
} from '../common/qaap-research-goal';
import { bestPrimaryValue, type ResearchExperimentRecord } from '../common/qaap-research-ledger';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsHubView } from './mobile-projects-types';

export interface ResearchGoalDetailCache {
    records: readonly ResearchExperimentRecord[];
    bestPrimary?: number;
}

/** Panel surface for the Research hub list, row actions, and polling while goals are running. */
export interface MobileProjectsHubResearchHost {
    query: string;
    scroll: HTMLElement;
    hubView: MobileProjectsHubView;
    visible: boolean;
    messageService: MessageService | undefined;
    researchGoals: ResearchGoal[];
    researchGoalDetails: Map<string, ResearchGoalDetailCache>;
    researchGoalsLoaded: boolean;
    researchGoalsLoading: boolean;
    researchRefreshTimer: number | undefined;

    refreshResearchGoals(force?: boolean): Promise<void>;
    renderSubtitle(): void;
    renderList(): void;
}

/** Research hub list rendering, cancel row actions, and refresh polling. */
export class MobileProjectsHubResearchUi {

    constructor(protected readonly host: MobileProjectsHubResearchHost) { }

    async refreshResearchGoals(force = false): Promise<void> {
        if (this.host.researchGoalsLoading && !force) {
            return;
        }
        this.host.researchGoalsLoading = true;
        try {
            const response = await fetchResearchGoals();
            this.host.researchGoals = [...response.goals];
            this.host.researchGoalsLoaded = true;
            await this.refreshGoalDetails(response.goals);
        } catch {
            if (!this.host.researchGoalsLoaded) {
                this.host.researchGoals = [];
            }
        } finally {
            this.host.researchGoalsLoading = false;
            if (this.host.visible && this.host.hubView === 'research') {
                this.host.renderList();
            }
        }
    }

    protected async refreshGoalDetails(goals: readonly ResearchGoal[]): Promise<void> {
        const needsDetail = goals.filter(goal =>
            goal.status === 'running'
            || !this.host.researchGoalDetails.has(goal.id)
            || this.host.researchGoalDetails.get(goal.id)?.bestPrimary === undefined,
        );
        await Promise.all(needsDetail.map(async goal => {
            try {
                const detail = await fetchResearchGoalDetail(goal.id);
                const primary = this.primaryMetric(detail.goal);
                const bestPrimary = primary ? bestPrimaryValue(detail.records, primary) : undefined;
                this.host.researchGoalDetails.set(goal.id, {
                    records: detail.records,
                    bestPrimary,
                });
            } catch {
                // Keep stale cache when detail fetch fails.
            }
        }));
    }

    renderResearchHubView(): void {
        if (!this.host.researchGoalsLoaded && !this.host.researchGoalsLoading) {
            void this.host.refreshResearchGoals();
        }
        const goals = this.sortGoalsForDisplay(filterResearchGoalsByQuery(this.host.researchGoals, this.host.query));
        if (!this.host.researchGoalsLoaded && this.host.researchGoalsLoading) {
            this.host.scroll.append(this.createResearchLoadingState());
            this.host.renderSubtitle();
            return;
        }
        if (goals.length === 0) {
            this.host.scroll.append(this.createResearchEmptyState());
            this.host.renderSubtitle();
            return;
        }
        const host = document.createElement('div');
        host.className = 'theia-mobile-hub-research';
        const group = document.createElement('div');
        group.className = 'theia-mobile-hub-research-group';
        for (const goal of goals) {
            group.append(this.createResearchRow(goal));
        }
        host.append(group);
        this.host.scroll.append(host);
        this.host.renderSubtitle();
        this.scheduleResearchRefreshWhileRunning();
    }

    sortGoalsForDisplay(goals: readonly ResearchGoal[]): ResearchGoal[] {
        const rank = (goal: ResearchGoal): number => goal.status === 'running' ? 0 : 1;
        return [...goals].sort((a, b) =>
            rank(a) - rank(b)
            || b.createdAt - a.createdAt
            || a.description.localeCompare(b.description),
        );
    }

    scheduleResearchRefreshWhileRunning(): void {
        window.clearTimeout(this.host.researchRefreshTimer);
        const hasRunning = this.host.researchGoals.some(goal => goal.status === 'running');
        if (!hasRunning || this.host.hubView !== 'research' || !this.host.visible) {
            return;
        }
        this.host.researchRefreshTimer = window.setTimeout(() => {
            void this.host.refreshResearchGoals(true);
        }, 4000);
    }

    createResearchLoadingState(): HTMLElement {
        const loading = document.createElement('div');
        loading.className = 'theia-mobile-projects-empty theia-mod-research-loading';
        const title = document.createElement('strong');
        title.textContent = nls.localize('qaap/mobileProjects/researchLoading', 'Loading research goals…');
        loading.append(title);
        return loading;
    }

    createResearchEmptyState(): HTMLElement {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-projects-empty theia-mod-research-empty';
        const title = document.createElement('strong');
        title.textContent = this.host.query
            ? nls.localize('qaap/mobileProjects/researchEmpty', 'No research goals match your search')
            : nls.localize('qaap/mobileProjects/researchEmptyAll', 'No research goals yet');
        const body = document.createElement('span');
        body.textContent = this.host.query
            ? nls.localize(
                'qaap/mobileProjects/researchEmptySearchBody',
                'Try another keyword or clear the search.',
            )
            : nls.localize(
                'qaap/mobileProjects/researchEmptyBody',
                'Create goals with curl against /services/qaap-research/goals.',
            );
        empty.append(title, body);
        return empty;
    }

    primaryMetric(goal: ResearchGoal): ResearchMetricSpec | undefined {
        return goal.metrics.find(metric => metric.primary);
    }

    descriptionSnippet(description: string): string {
        const singleLine = description.replace(/\s+/g, ' ').trim();
        if (singleLine.length <= 72) {
            return singleLine;
        }
        return `${singleLine.slice(0, 69)}…`;
    }

    terminationReasonLabel(reason: TerminationReason): string {
        switch (reason) {
            case 'reached-target':
                return nls.localize('qaap/mobileProjects/researchTerminationReachedTarget', 'Reached target');
            case 'budget-exhausted':
                return nls.localize('qaap/mobileProjects/researchTerminationBudget', 'Budget exhausted');
            case 'stagnated':
                return nls.localize('qaap/mobileProjects/researchTerminationStagnated', 'Stagnated');
            case 'infra-broken':
                return nls.localize('qaap/mobileProjects/researchTerminationInfra', 'Infra broken');
            case 'cancelled':
                return nls.localize('qaap/mobileProjects/researchTerminationCancelled', 'Cancelled');
        }
    }

    statusLabel(goal: ResearchGoal): string {
        switch (goal.status) {
            case 'running':
                return nls.localize('qaap/mobileProjects/researchStatusRunning', 'Running');
            case 'completed':
                return nls.localize('qaap/mobileProjects/researchStatusCompleted', 'Completed');
            case 'cancelled':
                return nls.localize('qaap/mobileProjects/researchStatusCancelled', 'Cancelled');
            case 'failed':
                return nls.localize('qaap/mobileProjects/researchStatusFailed', 'Failed');
        }
    }

    formatMetricValue(metric: ResearchMetricSpec, value: number): string {
        return `${metric.name} ${value}`;
    }

    researchRowSubtitle(goal: ResearchGoal): string {
        const parts: string[] = [
            researchGoalCwdBasename(goal.cwd),
            this.statusLabel(goal),
        ];
        const primary = this.primaryMetric(goal);
        if (primary?.target !== undefined) {
            parts.push(nls.localize(
                'qaap/mobileProjects/researchTarget',
                'target {0}',
                String(primary.target),
            ));
        }
        const best = this.host.researchGoalDetails.get(goal.id)?.bestPrimary;
        if (primary !== undefined && best !== undefined) {
            parts.push(nls.localize(
                'qaap/mobileProjects/researchBest',
                'best {0}',
                this.formatMetricValue(primary, best),
            ));
        }
        if (goal.status !== 'running' && goal.terminationReason) {
            parts.push(this.terminationReasonLabel(goal.terminationReason));
        }
        return parts.join(' · ');
    }

    createResearchRow(goal: ResearchGoal): HTMLElement {
        const row = document.createElement('article');
        row.className = 'theia-mobile-hub-research-row';
        if (goal.status === 'running') {
            row.classList.add('theia-mod-running');
        }

        const main = document.createElement('div');
        main.className = 'theia-mobile-hub-research-main';

        const title = document.createElement('span');
        title.className = 'theia-mobile-hub-research-title';
        title.textContent = this.descriptionSnippet(goal.description);
        const meta = document.createElement('span');
        meta.className = 'theia-mobile-hub-research-meta';
        meta.textContent = this.researchRowSubtitle(goal);
        main.append(title, meta);

        const trailing = document.createElement('div');
        trailing.className = 'theia-mobile-hub-research-trailing';
        trailing.addEventListener('click', ev => ev.stopPropagation());
        trailing.addEventListener('pointerdown', ev => ev.stopPropagation());

        if (goal.status === 'running') {
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'theia-mobile-hub-research-cancel q-icon-button codicon codicon-close';
            cancel.title = nls.localize('qaap/mobileProjects/researchCancel', 'Cancel research goal');
            cancel.setAttribute('aria-label', cancel.title);
            cancel.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                void this.cancelGoal(goal);
            });
            trailing.append(cancel);
        }

        row.append(main, trailing);
        return row;
    }

    async cancelGoal(goal: ResearchGoal): Promise<void> {
        try {
            await cancelResearchGoal(goal.id);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/researchCancelled', 'Research goal cancelled'),
                { kind: 'success', duration: 1800 },
            );
        } catch (error) {
            this.host.messageService?.error(error instanceof Error ? error.message : String(error));
        } finally {
            await this.host.refreshResearchGoals(true);
        }
    }
}
