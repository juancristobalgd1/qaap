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
    replayResearchGoal,
} from '../common/qaap-research-client';
import {
    filterResearchGoalsByQuery,
    formatResearchGoalActiveDuration,
    researchGoalCwdBasename,
    type ResearchGoal,
    type ResearchMetricSpec,
    type TerminationReason,
} from '../common/qaap-research-goal';
import {
    bestPrimaryValue,
    summarizeResearchGoalLedger,
    type ExperimentVerdict,
    type ResearchExperimentRecord,
} from '../common/qaap-research-ledger';
import { MobileSnackbar } from './mobile-snackbar';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';
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
    researchInteractionLock: boolean;
    researchSheet: HTMLElement | undefined;
    researchExpandedGoalIds: Set<string>;

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
        if (this.host.researchInteractionLock || this.host.researchSheet) {
            return;
        }
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
                'Tap + to start a research goal on your VPS.',
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

    researchRowHeaderSubtitle(goal: ResearchGoal, nowMs = Date.now()): string {
        const parts: string[] = [
            researchGoalCwdBasename(goal.cwd),
            this.statusLabel(goal),
        ];
        const activeDuration = formatResearchGoalActiveDuration(goal, nowMs);
        if (activeDuration) {
            parts.push(activeDuration);
        }
        if (goal.status === 'running') {
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
        }
        return parts.join(' · ');
    }

    researchResultLines(goal: ResearchGoal): string[] {
        if (goal.status === 'running') {
            return [];
        }
        const lines: string[] = [];
        const primary = this.primaryMetric(goal);
        const detail = this.host.researchGoalDetails.get(goal.id);
        const best = detail?.bestPrimary;
        if (primary !== undefined && best !== undefined) {
            if (primary.target !== undefined) {
                lines.push(nls.localize(
                    'qaap/mobileProjects/researchResultBestVsTarget',
                    'Best {0} vs target {1}',
                    this.formatMetricValue(primary, best),
                    String(primary.target),
                ));
            } else {
                lines.push(nls.localize(
                    'qaap/mobileProjects/researchResultBest',
                    'Best {0}',
                    this.formatMetricValue(primary, best),
                ));
            }
        }
        if (goal.terminationReason) {
            lines.push(this.terminationReasonLabel(goal.terminationReason));
        }
        const ledger = summarizeResearchGoalLedger(detail?.records ?? []);
        if (ledger.experimentRoundCount > 0) {
            lines.push(nls.localize(
                'qaap/mobileProjects/researchResultRoundCount',
                '{0} rounds',
                String(ledger.experimentRoundCount),
            ));
        }
        return lines;
    }

    isResearchGoalExpanded(goalId: string): boolean {
        return this.host.researchExpandedGoalIds.has(goalId);
    }

    async toggleResearchGoalExpanded(goalId: string): Promise<void> {
        if (this.host.researchExpandedGoalIds.has(goalId)) {
            this.host.researchExpandedGoalIds.delete(goalId);
        } else {
            this.host.researchExpandedGoalIds.add(goalId);
            if (!this.host.researchGoalDetails.has(goalId)) {
                try {
                    const detail = await fetchResearchGoalDetail(goalId);
                    const primary = this.primaryMetric(detail.goal);
                    const bestPrimary = primary ? bestPrimaryValue(detail.records, primary) : undefined;
                    this.host.researchGoalDetails.set(goalId, {
                        records: detail.records,
                        bestPrimary,
                    });
                } catch {
                    // Keep expand state; panel falls back to empty rounds.
                }
            }
        }
        this.host.renderList();
    }

    experimentRecordsForDisplay(records: readonly ResearchExperimentRecord[]): ResearchExperimentRecord[] {
        return records.filter(record => !record.preflight && record.round > 0);
    }

    verdictLabel(verdict: ExperimentVerdict): string {
        switch (verdict) {
            case 'improved':
                return nls.localize('qaap/mobileProjects/researchVerdictImproved', 'Improved');
            case 'regressed':
                return nls.localize('qaap/mobileProjects/researchVerdictRegressed', 'Regressed');
            case 'neutral':
                return nls.localize('qaap/mobileProjects/researchVerdictNeutral', 'Neutral');
            case 'failed':
                return nls.localize('qaap/mobileProjects/researchVerdictFailed', 'Failed');
            case 'noop':
                return nls.localize('qaap/mobileProjects/researchVerdictNoop', 'No-op');
        }
    }

    formatRoundSummary(record: ResearchExperimentRecord): string {
        const parts: string[] = [
            nls.localize('qaap/mobileProjects/researchRoundLabel', 'Round {0}', String(record.round)),
        ];
        if (record.verdict) {
            parts.push(this.verdictLabel(record.verdict));
        }
        if (record.metrics.length > 0) {
            parts.push(record.metrics.map(metric => `${metric.name}=${metric.value}`).join(', '));
        }
        return parts.join(' · ');
    }

    createResearchRow(goal: ResearchGoal): HTMLElement {
        const isExpanded = this.isResearchGoalExpanded(goal.id);
        const row = document.createElement('article');
        row.className = 'theia-mobile-hub-research-row';
        if (goal.status === 'running') {
            row.classList.add('theia-mod-running');
        } else {
            row.classList.add('theia-mod-finished');
        }
        if (isExpanded) {
            row.classList.add('theia-mod-expanded');
        }

        const head = document.createElement('div');
        head.className = 'theia-mobile-hub-research-row-head';
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.setAttribute('aria-expanded', String(isExpanded));

        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-hub-research-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');

        const main = document.createElement('div');
        main.className = 'theia-mobile-hub-research-main';

        const title = document.createElement('span');
        title.className = 'theia-mobile-hub-research-title';
        title.textContent = this.descriptionSnippet(goal.description);
        const meta = document.createElement('span');
        meta.className = 'theia-mobile-hub-research-meta';
        this.syncResearchRowMeta(meta, goal);
        main.append(title, meta);

        const trailing = document.createElement('div');
        trailing.className = 'theia-mobile-hub-research-trailing';
        trailing.addEventListener('click', ev => ev.stopPropagation());
        trailing.addEventListener('pointerdown', ev => ev.stopPropagation());

        if (goal.status === 'running') {
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'theia-mobile-hub-research-cancel q-icon-button codicon codicon-debug-stop';
            cancel.title = nls.localize('qaap/mobileProjects/researchStop', 'Stop research goal');
            cancel.setAttribute('aria-label', cancel.title);
            cancel.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                void this.cancelGoal(goal);
            });
            trailing.append(cancel);
        } else {
            const play = document.createElement('button');
            play.type = 'button';
            play.className = 'theia-mobile-hub-research-play q-icon-button codicon codicon-debug-start';
            play.title = nls.localize('qaap/mobileProjects/researchPlay', 'Start research');
            play.setAttribute('aria-label', play.title);
            play.disabled = this.host.researchInteractionLock;
            play.addEventListener('click', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                void this.playGoal(goal);
            });
            trailing.append(play);
        }

        head.append(chevron, main, trailing);
        head.addEventListener('click', () => {
            void this.toggleResearchGoalExpanded(goal.id);
        });
        head.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                void this.toggleResearchGoalExpanded(goal.id);
            }
        });
        row.append(head);

        if (!isExpanded) {
            const results = this.createResearchRowResults(goal);
            if (results) {
                const separator = document.createElement('div');
                separator.className = 'theia-mobile-hub-research-results-separator';
                separator.setAttribute('aria-hidden', 'true');
                row.append(separator, results);
            }
        } else {
            row.append(this.createResearchRowExpandedPanel(goal));
        }

        return row;
    }

    createResearchRowExpandedPanel(goal: ResearchGoal): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'theia-mobile-hub-research-detail';

        const description = document.createElement('div');
        description.className = 'theia-mobile-hub-research-detail-description';
        description.textContent = goal.description;
        panel.append(description);

        const summary = this.createResearchDetailSummary(goal);
        if (summary) {
            panel.append(summary);
        }

        const records = this.experimentRecordsForDisplay(
            this.host.researchGoalDetails.get(goal.id)?.records ?? [],
        );
        if (records.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-hub-research-detail-empty';
            empty.textContent = nls.localize('qaap/mobileProjects/researchNoRoundsYet', 'No rounds yet');
            panel.append(empty);
        } else {
            const roundsHost = document.createElement('div');
            roundsHost.className = 'theia-mobile-hub-research-rounds';
            for (const record of records) {
                roundsHost.append(this.createResearchRoundDetails(record));
            }
            panel.append(roundsHost);
        }

        return panel;
    }

    protected createResearchDetailSummary(goal: ResearchGoal): HTMLElement | undefined {
        const lines = this.researchExpandedSummaryLines(goal);
        if (lines.length === 0) {
            return undefined;
        }
        const summary = document.createElement('div');
        summary.className = 'theia-mobile-hub-research-detail-summary';
        for (const line of lines) {
            const lineEl = document.createElement('div');
            lineEl.className = 'theia-mobile-hub-research-detail-summary-line';
            lineEl.textContent = line;
            summary.append(lineEl);
        }
        return summary;
    }

    researchExpandedSummaryLines(goal: ResearchGoal): string[] {
        const lines: string[] = [];
        const primary = this.primaryMetric(goal);
        const detail = this.host.researchGoalDetails.get(goal.id);
        const best = detail?.bestPrimary;
        if (primary !== undefined && best !== undefined) {
            if (primary.target !== undefined) {
                lines.push(nls.localize(
                    'qaap/mobileProjects/researchResultBestVsTarget',
                    'Best {0} vs target {1}',
                    this.formatMetricValue(primary, best),
                    String(primary.target),
                ));
            } else {
                lines.push(nls.localize(
                    'qaap/mobileProjects/researchResultBest',
                    'Best {0}',
                    this.formatMetricValue(primary, best),
                ));
            }
        }
        if (goal.terminationReason) {
            lines.push(this.terminationReasonLabel(goal.terminationReason));
        }
        const ledger = summarizeResearchGoalLedger(detail?.records ?? []);
        if (ledger.experimentRoundCount > 0) {
            lines.push(nls.localize(
                'qaap/mobileProjects/researchResultRoundCount',
                '{0} rounds',
                String(ledger.experimentRoundCount),
            ));
        }
        return lines;
    }

    createResearchRoundDetails(record: ResearchExperimentRecord): HTMLDetailsElement {
        const details = document.createElement('details');
        details.className = 'theia-mobile-hub-research-round';

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-hub-research-round-summary';
        summary.textContent = this.formatRoundSummary(record);

        const body = document.createElement('div');
        body.className = 'theia-mobile-hub-research-round-body';

        if (record.symptom) {
            this.appendResearchDetailField(body, nls.localize('qaap/mobileProjects/researchFieldSymptom', 'Symptom'), record.symptom);
        }
        this.appendResearchDetailField(
            body,
            nls.localize('qaap/mobileProjects/researchFieldHypothesis', 'Hypothesis'),
            record.hypothesis,
        );
        if (record.lever) {
            this.appendResearchDetailField(body, nls.localize('qaap/mobileProjects/researchFieldLever', 'Lever'), record.lever);
        }
        if (record.notes) {
            this.appendResearchDetailField(body, nls.localize('qaap/mobileProjects/researchFieldNotes', 'Notes'), record.notes);
        }
        if (record.metrics.length > 0) {
            const metricsText = record.metrics
                .map(metric => `${metric.name}=${metric.value} (${metric.direction})`)
                .join('\n');
            this.appendResearchDetailField(
                body,
                nls.localize('qaap/mobileProjects/researchFieldMetrics', 'Metrics'),
                metricsText,
            );
        }
        if (Object.keys(record.declaredConfig).length > 0) {
            this.appendResearchDetailField(
                body,
                nls.localize('qaap/mobileProjects/researchFieldConfig', 'Config'),
                JSON.stringify(record.declaredConfig, undefined, 2),
                'theia-mobile-hub-research-detail-field-value theia-mod-pre',
            );
        }
        if (record.sha) {
            this.appendResearchDetailField(body, nls.localize('qaap/mobileProjects/researchFieldSha', 'SHA'), record.sha);
        }
        if (record.baselineSha) {
            this.appendResearchDetailField(
                body,
                nls.localize('qaap/mobileProjects/researchFieldBaselineSha', 'Baseline SHA'),
                record.baselineSha,
            );
        }

        details.append(summary, body);
        return details;
    }

    protected appendResearchDetailField(
        parent: HTMLElement,
        label: string,
        value: string,
        valueClassName = 'theia-mobile-hub-research-detail-field-value',
    ): void {
        const field = document.createElement('div');
        field.className = 'theia-mobile-hub-research-detail-field';
        const labelEl = document.createElement('span');
        labelEl.className = 'theia-mobile-hub-research-detail-field-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.className = valueClassName;
        valueEl.textContent = value;
        field.append(labelEl, valueEl);
        parent.append(field);
    }

    protected createResearchRowResults(goal: ResearchGoal): HTMLElement | undefined {
        const lines = this.researchResultLines(goal);
        if (lines.length === 0) {
            return undefined;
        }
        const results = document.createElement('div');
        results.className = 'theia-mobile-hub-research-results';
        for (const line of lines) {
            const lineEl = document.createElement('span');
            lineEl.className = 'theia-mobile-hub-research-results-line';
            lineEl.textContent = line;
            results.append(lineEl);
        }
        return results;
    }

    protected syncResearchRowMeta(meta: HTMLElement, goal: ResearchGoal): void {
        if (goal.status === 'running') {
            sharedSecondTicker.register({
                element: meta,
                render: nowMs => {
                    meta.textContent = this.researchRowHeaderSubtitle(goal, nowMs);
                },
            });
            return;
        }
        sharedSecondTicker.unregister(meta);
        meta.textContent = this.researchRowHeaderSubtitle(goal);
    }

    async cancelGoal(goal: ResearchGoal): Promise<void> {
        if (this.host.researchInteractionLock) {
            return;
        }
        this.host.researchInteractionLock = true;
        try {
            await cancelResearchGoal(goal.id);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/researchCancelled', 'Research goal cancelled'),
                { kind: 'success', duration: 1800 },
            );
        } catch (error) {
            this.host.messageService?.error(error instanceof Error ? error.message : String(error));
        } finally {
            this.host.researchInteractionLock = false;
            await this.host.refreshResearchGoals(true);
        }
    }

    async playGoal(goal: ResearchGoal): Promise<void> {
        if (this.host.researchInteractionLock || goal.status === 'running') {
            return;
        }
        this.host.researchInteractionLock = true;
        try {
            await replayResearchGoal(goal.id);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/researchStarted', 'Research started on the VPS'),
                { kind: 'success', duration: 2200 },
            );
        } catch (error) {
            this.host.messageService?.error(error instanceof Error ? error.message : String(error));
        } finally {
            this.host.researchInteractionLock = false;
            await this.host.refreshResearchGoals(true);
        }
    }
}
