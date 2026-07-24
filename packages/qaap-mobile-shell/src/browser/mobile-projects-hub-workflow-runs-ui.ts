// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { MessageService } from '@theia/core/lib/common/message-service';
import {
    continueWorkflowRun,
    fetchWorkflowRuns,
    fetchWorkflowTemplates,
    filterWorkflowRunsByQuery,
    isWorkflowRunActive,
    startWorkflowRun,
    workflowRunOutcomeKey,
    type QaapWorkflowRunSummary,
    type QaapWorkflowTemplateSummary,
} from '../common/qaap-workflow-run-client';
import type { MobileProjectEntry } from './mobile-projects-types';

/** How often the list refreshes while a run is still executing on the VPS. */
const RUNS_REFRESH_MS = 5_000;

/** Panel surface the workflow-runs section needs; every member already exists on the panel. */
export interface MobileProjectsHubWorkflowRunsHost {
    query: string;
    scroll: HTMLElement;
    projects: MobileProjectEntry[];
    projectsService: { getProjectCwd(project: MobileProjectEntry): string | undefined };
    messageService: MessageService | undefined;
    renderList(): void;
}

/**
 * Dynamic Workflow runs on the Workflows hub tab: list real runs from the backend, start an
 * implement-then-review run on a project, and continue runs parked at a human gate.
 */
export class MobileProjectsHubWorkflowRunsUi {

    protected runs: readonly QaapWorkflowRunSummary[] = [];
    protected templates: readonly QaapWorkflowTemplateSummary[] = [];
    protected loaded = false;
    protected loading = false;
    protected startOpen = false;
    protected busy = false;
    protected refreshTimer: number | undefined;
    /** The rendered section; also the "is this view still on screen" marker for the poll loop. */
    protected section: HTMLElement | undefined;

    constructor(protected readonly host: MobileProjectsHubWorkflowRunsHost) { }

    /** Build the runs section. Appended by the catalog view above the static cards. */
    renderWorkflowRunsSection(): HTMLElement {
        if (!this.loaded && !this.loading) {
            void this.refresh();
        }
        const section = document.createElement('section');
        section.className = 'theia-mobile-hub-catalog-section theia-mobile-hub-workflow-runs';
        this.section = section;

        const head = document.createElement('div');
        head.className = 'theia-mobile-hub-catalog-section-head';
        const title = document.createElement('h2');
        title.className = 'theia-mobile-hub-catalog-section-title';
        title.textContent = nls.localize('qaap/mobileProjects/workflowRunsTitle', 'Agent runs');
        head.append(title);
        if (this.runs.length > 0) {
            const count = document.createElement('span');
            count.className = 'theia-mobile-hub-catalog-section-count';
            count.textContent = String(this.runs.length);
            head.append(count);
        }
        section.append(head);

        const list = document.createElement('div');
        list.className = 'theia-mobile-hub-catalog-cards';
        list.append(this.startOpen ? this.createStartForm() : this.createStartCard());
        for (const summary of filterWorkflowRunsByQuery(this.runs, this.host.query)) {
            list.append(this.createRunCard(summary));
        }
        section.append(list);

        this.scheduleRefreshWhileRunning();
        return section;
    }

    dispose(): void {
        if (this.refreshTimer !== undefined) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    protected createStartCard(): HTMLElement {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'theia-mobile-hub-catalog-card theia-mobile-hub-workflow-start-card';
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-hub-catalog-card-icon codicon codicon-rocket';
        const body = document.createElement('span');
        body.className = 'theia-mobile-hub-catalog-card-body';
        const cardTitle = document.createElement('span');
        cardTitle.className = 'theia-mobile-hub-catalog-card-title';
        cardTitle.textContent = nls.localize('qaap/mobileProjects/workflowStartTitle', 'Start a workflow');
        const subtitle = document.createElement('span');
        subtitle.className = 'theia-mobile-hub-catalog-card-subtitle';
        subtitle.textContent = nls.localize(
            'qaap/mobileProjects/workflowStartSubtitle',
            'Implement a task, then an independent agent reviews the change.',
        );
        body.append(cardTitle, subtitle);
        card.append(icon, body);
        card.addEventListener('click', () => {
            this.startOpen = true;
            this.host.renderList();
        });
        return card;
    }

    protected createStartForm(): HTMLElement {
        const form = document.createElement('div');
        form.className = 'theia-mobile-hub-catalog-card theia-mobile-hub-workflow-start-form';

        const projectSelect = document.createElement('select');
        projectSelect.className = 'theia-mobile-routine-field';
        projectSelect.setAttribute('aria-label', nls.localize('qaap/mobileProjects/workflowProject', 'Project'));
        for (const project of this.host.projects) {
            const cwd = this.host.projectsService.getProjectCwd(project);
            if (!cwd) {
                continue;
            }
            const option = document.createElement('option');
            option.value = cwd;
            option.textContent = project.name;
            projectSelect.append(option);
        }

        const task = document.createElement('textarea');
        task.className = 'theia-mobile-routine-field';
        task.rows = 3;
        task.placeholder = nls.localize('qaap/mobileProjects/workflowTaskPlaceholder', 'What should the agent do?');

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-hub-workflow-start-actions';
        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'theia-button main';
        start.textContent = nls.localize('qaap/mobileProjects/workflowStart', 'Start');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'theia-button secondary';
        cancel.textContent = nls.localize('qaap/mobileProjects/workflowCancel', 'Cancel');
        actions.append(start, cancel);
        form.append(projectSelect, task, actions);

        cancel.addEventListener('click', () => {
            this.startOpen = false;
            this.host.renderList();
        });
        start.addEventListener('click', () => void this.submitStart(projectSelect.value, task.value));
        if (projectSelect.options.length === 0) {
            start.disabled = true;
            task.placeholder = nls.localize('qaap/mobileProjects/workflowNoProjects', 'Open a project first.');
        }
        return form;
    }

    protected async submitStart(cwd: string, taskText: string): Promise<void> {
        const trimmed = taskText.trim();
        if (this.busy || !cwd || !trimmed) {
            return;
        }
        this.busy = true;
        try {
            const templates = await this.loadTemplates();
            // Default product template; a template picker arrives when there is more than one.
            const template = templates.find(entry => entry.id === 'qaap.implement-then-review') ?? templates[0];
            if (!template) {
                throw new Error(nls.localize('qaap/mobileProjects/workflowNoTemplates', 'No workflow templates are available.'));
            }
            await this.doStartRun({ templateId: template.id, cwd, inputs: { task: trimmed } });
            this.startOpen = false;
            await this.refresh(true);
        } catch (error) {
            this.host.messageService?.error(String(error instanceof Error ? error.message : error));
        } finally {
            this.busy = false;
            this.host.renderList();
        }
    }

    protected createRunCard(summary: QaapWorkflowRunSummary): HTMLElement {
        const card = document.createElement('div');
        card.className = 'theia-mobile-hub-catalog-card theia-mobile-hub-workflow-run-card';
        card.dataset.status = summary.run.status;

        const icon = document.createElement('span');
        icon.className = `theia-mobile-hub-catalog-card-icon codicon ${this.statusIcon(summary)}`;
        const body = document.createElement('span');
        body.className = 'theia-mobile-hub-catalog-card-body';
        const cardTitle = document.createElement('span');
        cardTitle.className = 'theia-mobile-hub-catalog-card-title';
        cardTitle.textContent = this.templateLabel(summary.templateId);
        const subtitle = document.createElement('span');
        subtitle.className = 'theia-mobile-hub-catalog-card-subtitle';
        subtitle.textContent = this.runSubtitle(summary);
        body.append(cardTitle, subtitle);
        card.append(icon, body);

        if (summary.run.status === 'awaiting-human' && summary.run.active.length > 0) {
            const gateNode = summary.run.active[0];
            const resume = document.createElement('button');
            resume.type = 'button';
            resume.className = 'theia-button main theia-mobile-hub-workflow-continue';
            resume.textContent = nls.localize('qaap/mobileProjects/workflowContinue', 'Continue');
            resume.addEventListener('click', () => void this.submitContinue(summary.run.id, gateNode));
            card.append(resume);
        }
        return card;
    }

    protected async submitContinue(runId: string, nodeId: string): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        try {
            await this.doContinueRun(runId, nodeId);
            await this.refresh(true);
        } catch (error) {
            this.host.messageService?.error(String(error instanceof Error ? error.message : error));
        } finally {
            this.busy = false;
            this.host.renderList();
        }
    }

    runSubtitle(summary: QaapWorkflowRunSummary): string {
        const status = this.statusLabel(summary.run.status);
        const outcome = workflowRunOutcomeKey(summary);
        if (summary.run.status === 'running' && summary.run.active.length > 0) {
            return `${status} · ${summary.run.active.join(', ')}`;
        }
        return outcome ? `${status} · ${this.outcomeLabel(outcome)}` : status;
    }

    protected statusLabel(status: QaapWorkflowRunSummary['run']['status']): string {
        switch (status) {
            case 'running': return nls.localize('qaap/mobileProjects/workflowRunning', 'Running');
            case 'awaiting-human': return nls.localize('qaap/mobileProjects/workflowAwaiting', 'Needs your decision');
            case 'succeeded': return nls.localize('qaap/mobileProjects/workflowSucceeded', 'Done');
            case 'failed': return nls.localize('qaap/mobileProjects/workflowFailed', 'Failed');
            case 'budget-exhausted': return nls.localize('qaap/mobileProjects/workflowBudget', 'Stopped at budget');
        }
    }

    protected outcomeLabel(bindingKey: string): string {
        switch (bindingKey) {
            case 'review.passed': return nls.localize('qaap/mobileProjects/workflowReviewPassed', 'review passed');
            case 'review.failed': return nls.localize('qaap/mobileProjects/workflowReviewFailed', 'review found problems');
            case 'review.skipped': return nls.localize('qaap/mobileProjects/workflowReviewSkipped', 'low risk, review skipped');
            case 'review.inconclusive': return nls.localize('qaap/mobileProjects/workflowReviewInconclusive', 'review inconclusive');
            case 'verify.failed': return nls.localize('qaap/mobileProjects/workflowVerifyFailed', 'verification failing');
            default: return bindingKey;
        }
    }

    protected statusIcon(summary: QaapWorkflowRunSummary): string {
        switch (summary.run.status) {
            case 'running': return 'codicon-sync~spin';
            case 'awaiting-human': return 'codicon-report';
            case 'succeeded': return 'codicon-pass';
            default: return 'codicon-error';
        }
    }

    protected templateLabel(templateId: string): string {
        const template = this.templates.find(entry => entry.id === templateId);
        return template?.name ?? templateId;
    }

    protected async refresh(force = false): Promise<void> {
        if (this.loading && !force) {
            return;
        }
        this.loading = true;
        try {
            const [runs, templates] = await Promise.all([this.loadRuns(), this.loadTemplates()]);
            this.runs = [...runs].sort((left, right) => right.updatedAt - left.updatedAt);
            this.templates = templates;
            const firstLoad = !this.loaded;
            this.loaded = true;
            if (firstLoad || force) {
                this.host.renderList();
            }
        } catch {
            // The workflows tab must render even when the backend lacks the API (older server).
            this.loaded = true;
        } finally {
            this.loading = false;
        }
    }

    protected scheduleRefreshWhileRunning(): void {
        if (this.refreshTimer !== undefined) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        if (!this.runs.some(isWorkflowRunActive)) {
            return;
        }
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = undefined;
            // Stop polling once the section left the DOM (tab switched, panel closed).
            if (!this.section?.isConnected) {
                return;
            }
            void this.refresh(true);
        }, RUNS_REFRESH_MS);
    }

    /** Client seams, overridable in tests. */
    protected loadRuns(): Promise<readonly QaapWorkflowRunSummary[]> {
        return fetchWorkflowRuns();
    }

    protected loadTemplates(): Promise<readonly QaapWorkflowTemplateSummary[]> {
        if (this.templates.length > 0) {
            return Promise.resolve(this.templates);
        }
        return fetchWorkflowTemplates();
    }

    protected doStartRun(body: { templateId: string; cwd: string; inputs: Record<string, string> }): Promise<unknown> {
        return startWorkflowRun(body);
    }

    protected doContinueRun(runId: string, nodeId: string): Promise<unknown> {
        return continueWorkflowRun(runId, nodeId);
    }
}
