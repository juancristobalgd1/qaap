// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { codicon, Message, ReactWidget } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { QaapJob, QaapJobFunctionDescriptor, QaapJobResourceClass } from '../common/qaap-job';
import {
    QaapJobLoop,
    QaapJobLoopMetrics,
    QaapJobLoopRound,
    QaapJobLoopRoundDetail,
    QaapJobLoopState,
    QaapJobLoopTerminationReason,
} from '../common/qaap-job-loop';
import {
    QaapCreateJobLoopTemplateRequest,
    QaapJobLoopTemplate,
    QaapJobLoopTemplateExport,
} from '../common/qaap-job-loop-template';
import {
    QAAP_JOB_LOOP_TRIGGER_API_PATH,
    QaapCreateJobLoopTriggerBody,
    QaapJobLoopTrigger,
    QaapUpdateJobLoopTriggerBody,
} from '../common/qaap-job-loop-trigger';
import {
    cancelQaapJobLoop,
    connectQaapJobLoopEvents,
    createQaapJobLoop,
    fetchQaapJobFunctions,
    fetchQaapJobLoopMetrics,
    fetchQaapJobLoopRound,
    fetchQaapJobLoops,
} from './qaap-job-loop-client';
import {
    createQaapJobLoopDraft,
    qaapJobLoopDefinitionToDraft,
    QaapJobLoopBuilder,
} from './qaap-job-loop-builder';
import {
    createQaapJobLoopTemplate,
    createQaapJobLoopTrigger,
    deleteQaapJobLoopTemplate,
    deleteQaapJobLoopTrigger,
    exportQaapJobLoopTemplate,
    fetchQaapJobLoopTemplates,
    fetchQaapJobLoopTriggers,
    fireQaapJobLoopTrigger,
    importQaapJobLoopTemplate,
    runQaapJobLoopTemplate,
    updateQaapJobLoopTemplate,
    updateQaapJobLoopTrigger,
} from './qaap-job-loop-management-client';
import { QaapJobLoopManagement } from './qaap-job-loop-management';

const EMPTY_METRICS: QaapJobLoopMetrics = {
    generatedAt: 0,
    total: 0,
    active: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    budgetExhausted: 0,
    roundsScheduled: 0,
    jobsScheduled: 0,
};

@injectable()
export class QaapJobLoopsWidget extends ReactWidget {

    static readonly ID = 'qaap-job-loops';
    static readonly LABEL = nls.localize('qaap/jobLoops/label', 'Job Loops');

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileService)
    protected readonly fileService: FileService;

    protected loops: QaapJobLoop[] = [];
    protected metrics = EMPTY_METRICS;
    protected expandedLoopId: string | undefined;
    protected selectedRoundKey: string | undefined;
    protected readonly roundDetails = new Map<string, QaapJobLoopRoundDetail>();
    protected readonly cancelling = new Set<string>();
    protected streamDisposables = new DisposableCollection();
    protected refreshPromise: Promise<void> | undefined;
    protected refreshTimer: number | undefined;
    protected loading = true;
    protected loadFailed = false;
    protected builderOpen = false;
    protected builderDraft = createQaapJobLoopDraft();
    protected functions: QaapJobFunctionDescriptor[] = [];
    protected builderBusy = false;
    protected builderError: string | undefined;
    protected activeView: 'runs' | 'automation' = 'runs';
    protected templates: QaapJobLoopTemplate[] = [];
    protected triggers: QaapJobLoopTrigger[] = [];
    protected selectedTemplateId: string | undefined;
    protected editingTemplateId: string | undefined;
    protected managementBusy = false;
    protected managementLoading = true;
    protected managementError: string | undefined;
    protected managementRefreshPromise: Promise<void> | undefined;
    protected webhookSecret: string | undefined;
    protected webhookUrl: string | undefined;
    protected savingTemplate = false;

    @postConstruct()
    protected init(): void {
        this.id = QaapJobLoopsWidget.ID;
        this.title.label = QaapJobLoopsWidget.LABEL;
        this.title.caption = QaapJobLoopsWidget.LABEL;
        this.title.iconClass = codicon('type-hierarchy-sub');
        this.title.closable = true;
        this.addClass('qaap-job-loops');
        void this.populateBuilderCwd();
    }

    protected async populateBuilderCwd(): Promise<void> {
        const root = this.workspaceService.tryGetRoots()[0];
        if (!root || this.builderDraft.cwd) {
            return;
        }
        const cwd = await this.fileService.fsPath(root.resource);
        this.builderDraft = {
            ...this.builderDraft,
            cwd,
            nodes: this.builderDraft.nodes.map(node => ({ ...node, cwd })),
        };
        this.update();
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        this.streamDisposables.dispose();
        this.streamDisposables = new DisposableCollection();
        this.streamDisposables.push(connectQaapJobLoopEvents(event => {
            if (event.type === 'snapshot') {
                this.loops = [...event.payload.loops];
                this.metrics = event.payload.metrics;
                this.loading = false;
                this.loadFailed = false;
                this.update();
                return;
            }
            for (const key of this.roundDetails.keys()) {
                if (key.startsWith(`${event.payload.loopId}:`)) {
                    this.roundDetails.delete(key);
                }
            }
            this.scheduleRefresh();
        }));
        void Promise.all([this.refresh(), this.refreshManagement()]);
    }

    protected override onBeforeDetach(message: Message): void {
        this.streamDisposables.dispose();
        if (this.refreshTimer !== undefined) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        super.onBeforeDetach(message);
    }

    protected scheduleRefresh(): void {
        if (this.refreshTimer !== undefined) {
            return;
        }
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh().then(() => this.refreshSelectedRound());
        }, 80);
    }

    protected refresh(): Promise<void> {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = Promise.all([fetchQaapJobLoops(), fetchQaapJobLoopMetrics()])
            .then(([loops, metrics]) => {
                this.loops = loops;
                this.metrics = metrics;
                this.loadFailed = false;
            })
            .catch(() => {
                this.loadFailed = true;
            })
            .finally(() => {
                this.loading = false;
                this.refreshPromise = undefined;
                this.update();
            });
        return this.refreshPromise;
    }

    protected render(): React.ReactNode {
        return (
            <div className='qaap-job-loops-body'>
                {this.renderHeader()}
                {this.renderNavigation()}
                {this.builderOpen && <QaapJobLoopBuilder
                    draft={this.builderDraft}
                    functions={this.functions}
                    busy={this.builderBusy}
                    savingTemplate={this.savingTemplate}
                    error={this.builderError}
                    onChange={draft => { this.builderDraft = draft; this.builderError = undefined; this.update(); }}
                    onCreate={request => this.createLoop(request)}
                    onSaveTemplate={request => this.saveTemplate(request)}
                    onClose={() => { this.builderOpen = false; this.editingTemplateId = undefined; this.builderError = undefined; this.update(); }}
                />}
                {this.activeView === 'runs' ? this.renderRuns() : this.renderManagement()}
            </div>
        );
    }

    protected renderNavigation(): React.ReactNode {
        return <div className='qaap-job-loops-navigation' role='tablist' aria-label={nls.localize('qaap/jobLoops/views', 'Job loop views')}>
            <button type='button' role='tab' aria-selected={this.activeView === 'runs'} onClick={() => { this.activeView = 'runs'; this.update(); }}>
                {nls.localize('qaap/jobLoops/runsView', 'Runs')}
            </button>
            <button type='button' role='tab' aria-selected={this.activeView === 'automation'} onClick={() => void this.openManagement()}>
                {nls.localize('qaap/jobLoops/automationView', 'Templates and automation')}
            </button>
        </div>;
    }

    protected renderRuns(): React.ReactNode {
        return this.loading && this.loops.length === 0
            ? <div className='qaap-job-loops-empty'>{nls.localize('qaap/jobLoops/loading', 'Loading job loops…')}</div>
            : this.loadFailed && this.loops.length === 0
                ? <div className='qaap-job-loops-empty'>{nls.localize('qaap/jobLoops/loadFailed', 'Could not load job loops.')}</div>
                : this.loops.length === 0
                    ? <div className='qaap-job-loops-empty'>
                        {nls.localize('qaap/jobLoops/empty', 'No graph loops yet. Use Create loop to build one.')}
                    </div>
                    : <div className='qaap-job-loops-list'>{this.loops.map(loop => this.renderLoop(loop))}</div>;
    }

    protected renderManagement(): React.ReactNode {
        if (this.managementLoading && this.templates.length === 0 && this.triggers.length === 0) {
            return <div className='qaap-job-loops-empty'>{nls.localize('qaap/jobLoops/loadingAutomation', 'Loading templates and automation…')}</div>;
        }
        return <QaapJobLoopManagement
            templates={this.templates}
            triggers={this.triggers}
            busy={this.managementBusy}
            error={this.managementError}
            selectedTemplateId={this.selectedTemplateId}
            webhookSecret={this.webhookSecret}
            webhookUrl={this.webhookUrl}
            onSelectTemplate={template => { this.selectedTemplateId = template.id; this.update(); }}
            onEditTemplate={template => this.editTemplate(template)}
            onRunTemplate={template => this.runTemplate(template)}
            onExportTemplate={template => this.exportTemplate(template)}
            onImportTemplate={() => this.chooseTemplateImport()}
            onDeleteTemplate={template => this.removeTemplate(template)}
            onCreateTrigger={request => this.createTrigger(request)}
            onUpdateTrigger={(trigger, request) => this.updateTrigger(trigger, request)}
            onSetTriggerEnabled={(trigger, enabled) => this.updateTrigger(trigger, { enabled })}
            onFireTrigger={trigger => this.fireTrigger(trigger)}
            onDeleteTrigger={trigger => this.removeTrigger(trigger)}
            onDismissWebhookSecret={() => { this.webhookSecret = undefined; this.webhookUrl = undefined; this.update(); }}
        />;
    }

    protected renderHeader(): React.ReactNode {
        const refreshLabel = nls.localize('qaap/jobLoops/refresh', 'Refresh');
        const createLabel = nls.localize('qaap/jobLoops/create', 'Create loop');
        const cards = [
            [nls.localize('qaap/jobLoops/metricActive', 'Active'), this.metrics.active],
            [nls.localize('qaap/jobLoops/metricGoals', 'Goals reached'), this.metrics.succeeded],
            [nls.localize('qaap/jobLoops/metricRounds', 'Rounds'), this.metrics.roundsScheduled],
            [nls.localize('qaap/jobLoops/metricJobs', 'Jobs'), this.metrics.jobsScheduled],
        ] as const;
        return (
            <div className='qaap-job-loops-metrics'>
                {cards.map(([label, value]) => (
                    <div className='qaap-job-loops-metric' key={label}>
                        <span className='qaap-job-loops-metric-value'>{String(value)}</span>
                        <span className='qaap-job-loops-metric-label'>{label}</span>
                    </div>
                ))}
                <button
                    type='button'
                    className='qaap-job-loops-create'
                    onClick={() => void this.openCreate()}
                >
                    {createLabel}
                </button>
                <button
                    type='button'
                    className={`qaap-job-loops-refresh ${codicon('refresh')}`}
                    aria-label={refreshLabel}
                    title={refreshLabel}
                    onClick={() => void (this.activeView === 'runs' ? this.refresh() : this.refreshManagement())}
                />
            </div>
        );
    }

    protected async openBuilder(): Promise<void> {
        this.builderOpen = true;
        this.builderError = undefined;
        this.update();
        if (this.functions.length > 0) {
            return;
        }
        try {
            this.functions = await fetchQaapJobFunctions();
        } catch (error) {
            this.builderError = error instanceof Error
                ? error.message
                : nls.localize('qaap/jobLoops/functionsFailed', 'Could not load job functions.');
        }
        this.update();
    }

    /** Open the builder from the command palette after the widget is activated. */
    async openCreate(): Promise<void> {
        if (this.editingTemplateId) {
            this.builderDraft = createQaapJobLoopDraft(this.builderDraft.cwd);
        }
        this.editingTemplateId = undefined;
        await this.openBuilder();
    }

    /** Open template and trigger administration from the command palette. */
    async openAutomation(): Promise<void> {
        await this.openManagement();
    }

    protected async createLoop(request: import('../common/qaap-job-loop').QaapCreateJobLoopRequest): Promise<void> {
        this.builderBusy = true;
        this.builderError = undefined;
        this.update();
        try {
            const result = await createQaapJobLoop(request);
            this.builderOpen = false;
            this.editingTemplateId = undefined;
            this.builderDraft = createQaapJobLoopDraft(this.builderDraft.cwd);
            await this.refresh();
            const loop = this.loops.find(candidate => candidate.id === result.loop.id) ?? result.loop;
            await this.toggleLoop(loop);
        } catch (error) {
            this.builderError = error instanceof Error
                ? error.message
                : nls.localize('qaap/jobLoops/createFailed', 'Could not create job loop.');
        } finally {
            this.builderBusy = false;
            this.update();
        }
    }

    protected refreshManagement(): Promise<void> {
        if (this.managementRefreshPromise) {
            return this.managementRefreshPromise;
        }
        this.managementRefreshPromise = Promise.all([
            fetchQaapJobLoopTemplates(),
            fetchQaapJobLoopTriggers(),
        ]).then(([templates, triggers]) => {
            this.templates = templates;
            this.triggers = triggers;
            if (this.selectedTemplateId && !templates.some(template => template.id === this.selectedTemplateId)) {
                this.selectedTemplateId = undefined;
            }
            this.managementError = undefined;
        }).catch(error => {
            this.managementError = this.errorMessage(
                error,
                nls.localize('qaap/jobLoops/automationLoadFailed', 'Could not load templates and automation.'),
            );
        }).finally(() => {
            this.managementLoading = false;
            this.managementRefreshPromise = undefined;
            this.update();
        });
        return this.managementRefreshPromise;
    }

    protected async openManagement(): Promise<void> {
        this.activeView = 'automation';
        this.update();
        await this.refreshManagement();
    }

    protected async saveTemplate(request: QaapCreateJobLoopTemplateRequest): Promise<void> {
        if (this.savingTemplate) { return; }
        this.savingTemplate = true;
        this.builderError = undefined;
        this.update();
        try {
            const existing = this.editingTemplateId
                ? this.templates.find(template => template.id === this.editingTemplateId)
                : undefined;
            const template = existing
                ? await updateQaapJobLoopTemplate(existing.id, {
                    revision: existing.revision,
                    name: request.name,
                    definition: request.definition,
                })
                : await createQaapJobLoopTemplate(request);
            this.selectedTemplateId = template.id;
            this.editingTemplateId = undefined;
            this.builderOpen = false;
            this.activeView = 'automation';
            await this.refreshManagement();
        } catch (error) {
            this.builderError = this.errorMessage(error, nls.localize('qaap/jobLoops/templateSaveFailed', 'Could not save the job loop template.'));
        } finally {
            this.savingTemplate = false;
            this.update();
        }
    }

    protected async editTemplate(template: QaapJobLoopTemplate): Promise<void> {
        this.selectedTemplateId = template.id;
        this.editingTemplateId = template.id;
        this.builderDraft = qaapJobLoopDefinitionToDraft(template.definition, template.name, template.description);
        await this.openBuilder();
    }

    protected async runTemplate(template: QaapJobLoopTemplate): Promise<void> {
        await this.withManagementAction(async () => {
            const result = await runQaapJobLoopTemplate(template.id, { idempotencyKey: crypto.randomUUID() });
            this.activeView = 'runs';
            await this.refresh();
            const loop = this.loops.find(candidate => candidate.id === result.loop.id) ?? result.loop;
            this.expandedLoopId = undefined;
            await this.toggleLoop(loop);
        });
    }

    protected async exportTemplate(template: QaapJobLoopTemplate): Promise<void> {
        await this.withManagementAction(async () => {
            const document = await exportQaapJobLoopTemplate(template.id);
            const url = URL.createObjectURL(new Blob([JSON.stringify(document, undefined, 2)], { type: 'application/json' }));
            try {
                const link = window.document.createElement('a');
                link.href = url;
                link.download = `${this.safeFileName(template.name)}.qaap-loop.json`;
                link.click();
            } finally {
                URL.revokeObjectURL(url);
            }
        });
    }

    protected chooseTemplateImport(): void {
        const input = window.document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) { void this.importTemplateFile(file); }
        };
        input.click();
    }

    protected async importTemplateFile(file: File): Promise<void> {
        await this.withManagementAction(async () => {
            if (file.size > 512 * 1024) {
                throw new Error(nls.localize('qaap/jobLoops/importTooLarge', 'The template import must not exceed 512 KiB.'));
            }
            let document: QaapJobLoopTemplateExport;
            try {
                document = JSON.parse(await file.text()) as QaapJobLoopTemplateExport;
            } catch {
                throw new Error(nls.localize('qaap/jobLoops/importInvalidJson', 'The selected template is not valid JSON.'));
            }
            const result = await importQaapJobLoopTemplate({ document });
            this.selectedTemplateId = result.template.id;
            await this.refreshManagement();
        });
    }

    protected async removeTemplate(template: QaapJobLoopTemplate): Promise<void> {
        if (!window.confirm(nls.localize('qaap/jobLoops/deleteTemplateConfirm', 'Delete template "{0}"?', template.name))) {
            return;
        }
        await this.withManagementAction(async () => {
            await deleteQaapJobLoopTemplate(template.id, template.revision);
            await this.refreshManagement();
        });
    }

    protected async createTrigger(request: QaapCreateJobLoopTriggerBody): Promise<void> {
        await this.withManagementAction(async () => {
            const result = await createQaapJobLoopTrigger(request);
            this.webhookSecret = result.webhookSecret;
            this.webhookUrl = result.webhookSecret
                ? `${window.location.origin}${QAAP_JOB_LOOP_TRIGGER_API_PATH}/${encodeURIComponent(result.trigger.id)}/webhook`
                : undefined;
            this.selectedTemplateId = result.trigger.templateId;
            await this.refreshManagement();
        });
    }

    protected async updateTrigger(trigger: QaapJobLoopTrigger, request: QaapUpdateJobLoopTriggerBody): Promise<void> {
        await this.withManagementAction(async () => {
            await updateQaapJobLoopTrigger(trigger.id, request);
            await this.refreshManagement();
        });
    }

    protected async fireTrigger(trigger: QaapJobLoopTrigger): Promise<void> {
        await this.withManagementAction(async () => {
            await fireQaapJobLoopTrigger(trigger.id);
            this.activeView = 'runs';
            await Promise.all([this.refresh(), this.refreshManagement()]);
        });
    }

    protected async removeTrigger(trigger: QaapJobLoopTrigger): Promise<void> {
        if (!window.confirm(nls.localize('qaap/jobLoops/deleteTriggerConfirm', 'Delete trigger "{0}"?', trigger.title))) {
            return;
        }
        await this.withManagementAction(async () => {
            await deleteQaapJobLoopTrigger(trigger.id);
            await this.refreshManagement();
        });
    }

    protected async withManagementAction(operation: () => Promise<void>): Promise<void> {
        if (this.managementBusy) { return; }
        this.managementBusy = true;
        this.managementError = undefined;
        this.update();
        try {
            await operation();
        } catch (error) {
            this.managementError = this.errorMessage(
                error,
                nls.localize('qaap/jobLoops/automationOperationFailed', 'The template or automation operation failed.'),
            );
            throw error;
        } finally {
            this.managementBusy = false;
            this.update();
        }
    }

    protected errorMessage(error: unknown, fallback: string): string {
        return error instanceof Error && error.message ? error.message : fallback;
    }

    protected safeFileName(value: string): string {
        return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'job-loop-template';
    }

    protected renderLoop(loop: QaapJobLoop): React.ReactNode {
        const expanded = loop.id === this.expandedLoopId;
        const progress = Math.min(100, Math.round((loop.iteration / loop.maxIterations) * 100));
        const cancelLabel = nls.localize('qaap/jobLoops/cancel', 'Cancel loop');
        return (
            <article className='qaap-job-loops-item' key={loop.id}>
                <div className='qaap-job-loops-row'>
                    <button
                        type='button'
                        className='qaap-job-loops-toggle'
                        aria-expanded={expanded}
                        onClick={() => void this.toggleLoop(loop)}
                    >
                        <span className={`qaap-job-loops-state qaap-job-loops-state--${loop.state}`}>
                            {this.stateLabel(loop.state)}
                        </span>
                        <span className='qaap-job-loops-title' title={loop.title}>{loop.title}</span>
                        <span className='qaap-job-loops-iteration'>
                            {nls.localize(
                                'qaap/jobLoops/roundProgress',
                                '{0}/{1} rounds',
                                String(loop.iteration),
                                String(loop.maxIterations),
                            )}
                        </span>
                        <i className={codicon(expanded ? 'chevron-down' : 'chevron-right')} />
                    </button>
                    {loop.state === 'running' && (
                        <button
                            type='button'
                            className={`qaap-job-loops-cancel ${codicon('stop-circle')}`}
                            disabled={this.cancelling.has(loop.id)}
                            aria-label={cancelLabel}
                            title={cancelLabel}
                            onClick={() => void this.cancelLoop(loop.id)}
                        />
                    )}
                </div>
                <div className='qaap-job-loops-progress' aria-hidden='true'>
                    <span style={{ width: `${progress}%` }} />
                </div>
                {expanded && this.renderExpandedLoop(loop)}
            </article>
        );
    }

    protected renderExpandedLoop(loop: QaapJobLoop): React.ReactNode {
        const selected = this.selectedRoundKey ? this.roundDetails.get(this.selectedRoundKey) : undefined;
        return (
            <div className='qaap-job-loops-expanded'>
                <div className='qaap-job-loops-summary'>
                    <span>{this.terminationLabel(loop)}</span>
                    <span>{nls.localize('qaap/jobLoops/jobsScheduled', '{0} jobs scheduled', String(loop.jobsScheduled))}</span>
                </div>
                <div className='qaap-job-loops-rounds' role='list'>
                    {loop.rounds.map(round => this.renderRoundButton(loop, round))}
                </div>
                {selected && selected.loopId === loop.id
                    ? this.renderRoundDetail(selected)
                    : <div className='qaap-job-loops-detail-placeholder'>
                        {nls.localize('qaap/jobLoops/selectRound', 'Select a round to inspect its graph.')}
                    </div>}
            </div>
        );
    }

    protected renderRoundButton(loop: QaapJobLoop, round: QaapJobLoopRound): React.ReactNode {
        const key = this.roundKey(loop.id, round.iteration);
        const selected = key === this.selectedRoundKey;
        const outcome = round.finishedAt === undefined ? 'running' : round.conditionMatched ? 'matched' : 'missed';
        return (
            <button
                type='button'
                role='listitem'
                key={key}
                className={`qaap-job-loops-round qaap-mod-${outcome}${selected ? ' qaap-mod-selected' : ''}`}
                onClick={() => void this.selectRound(loop.id, round.iteration)}
            >
                <span>{nls.localize('qaap/jobLoops/roundNumber', 'Round {0}', String(round.iteration))}</span>
                <i className={codicon(outcome === 'matched' ? 'check' : outcome === 'running' ? 'sync' : 'circle-outline')} />
            </button>
        );
    }

    protected renderRoundDetail(detail: QaapJobLoopRoundDetail): React.ReactNode {
        const idToKey = new Map(Object.entries(detail.graph?.jobsByKey ?? {}).map(([key, id]) => [id, key]));
        return (
            <div className='qaap-job-loops-graph'>
                {Object.entries(detail.jobs).map(([key, job]) => {
                    const dependencies = job.dependsOn.map(id => idToKey.get(id) ?? id.slice(0, 8));
                    return this.renderGraphNode(key, job, dependencies);
                })}
            </div>
        );
    }

    protected renderGraphNode(key: string, job: QaapJob, dependencies: readonly string[]): React.ReactNode {
        return (
            <div className='qaap-job-loops-node' key={job.id}>
                <span className={`qaap-job-loops-node-state qaap-mod-${job.state}`} />
                <div className='qaap-job-loops-node-body'>
                    <strong>{key}</strong>
                    <span>{job.title}</span>
                    {dependencies.length > 0 && (
                        <small>{nls.localize('qaap/jobLoops/dependsOn', 'After: {0}', dependencies.join(', '))}</small>
                    )}
                </div>
                <span className='qaap-job-loops-node-meta'>
                    {nls.localize(
                        'qaap/jobLoops/jobMetadata',
                        '{0} · attempt {1}',
                        this.resourceClassLabel(job.resourceClass),
                        String(job.attempt),
                    )}
                </span>
            </div>
        );
    }

    protected async toggleLoop(loop: QaapJobLoop): Promise<void> {
        if (this.expandedLoopId === loop.id) {
            this.expandedLoopId = undefined;
            this.selectedRoundKey = undefined;
            this.update();
            return;
        }
        this.expandedLoopId = loop.id;
        const latest = loop.rounds[loop.rounds.length - 1];
        this.selectedRoundKey = latest ? this.roundKey(loop.id, latest.iteration) : undefined;
        this.update();
        if (latest) {
            await this.loadRound(loop.id, latest.iteration);
        }
    }

    protected async selectRound(loopId: string, iteration: number): Promise<void> {
        this.selectedRoundKey = this.roundKey(loopId, iteration);
        this.update();
        await this.loadRound(loopId, iteration);
    }

    protected async loadRound(loopId: string, iteration: number): Promise<void> {
        const key = this.roundKey(loopId, iteration);
        if (this.roundDetails.has(key)) {
            return;
        }
        const detail = await fetchQaapJobLoopRound(loopId, iteration).catch(() => undefined);
        if (detail) {
            this.roundDetails.set(key, detail);
            if (this.selectedRoundKey === key) {
                this.update();
            }
        }
    }

    protected refreshSelectedRound(): void {
        const key = this.selectedRoundKey;
        if (!key) {
            return;
        }
        const separator = key.lastIndexOf(':');
        const loopId = key.slice(0, separator);
        const iteration = Number(key.slice(separator + 1));
        void this.loadRound(loopId, iteration);
    }

    protected async cancelLoop(loopId: string): Promise<void> {
        if (this.cancelling.has(loopId)) {
            return;
        }
        this.cancelling.add(loopId);
        this.update();
        try {
            await cancelQaapJobLoop(loopId);
            await this.refresh();
        } finally {
            this.cancelling.delete(loopId);
            this.update();
        }
    }

    protected roundKey(loopId: string, iteration: number): string {
        return `${loopId}:${iteration}`;
    }

    protected stateLabel(state: QaapJobLoopState): string {
        switch (state) {
            case 'running': return nls.localize('qaap/jobLoops/stateRunning', 'Running');
            case 'succeeded': return nls.localize('qaap/jobLoops/stateSucceeded', 'Goal reached');
            case 'failed': return nls.localize('qaap/jobLoops/stateFailed', 'Failed');
            case 'cancelled': return nls.localize('qaap/jobLoops/stateCancelled', 'Cancelled');
            case 'budget_exhausted': return nls.localize('qaap/jobLoops/stateBudget', 'Budget reached');
        }
    }

    protected resourceClassLabel(resourceClass: QaapJobResourceClass): string {
        switch (resourceClass) {
            case 'cpu': return nls.localize('qaap/jobLoops/resourceCpu', 'CPU');
            case 'io': return nls.localize('qaap/jobLoops/resourceIo', 'I/O');
            case 'network': return nls.localize('qaap/jobLoops/resourceNetwork', 'Network');
            case 'workspace': return nls.localize('qaap/jobLoops/resourceWorkspace', 'Workspace');
            case 'deployment': return nls.localize('qaap/jobLoops/resourceDeployment', 'Deployment');
        }
    }

    protected terminationLabel(loop: QaapJobLoop): string {
        if (!loop.terminationReason) {
            return nls.localize('qaap/jobLoops/inProgress', 'Condition is still being evaluated.');
        }
        return nls.localize(
            'qaap/jobLoops/termination',
            'Stopped: {0}',
            this.terminationReasonLabel(loop.terminationReason),
        );
    }

    protected terminationReasonLabel(reason: QaapJobLoopTerminationReason): string {
        switch (reason) {
            case 'goal_reached': return nls.localize('qaap/jobLoops/reasonGoalReached', 'goal reached');
            case 'max_iterations': return nls.localize('qaap/jobLoops/reasonMaxIterations', 'iteration limit');
            case 'max_duration': return nls.localize('qaap/jobLoops/reasonMaxDuration', 'time limit');
            case 'job_budget': return nls.localize('qaap/jobLoops/reasonJobBudget', 'job budget');
            case 'graph_failed': return nls.localize('qaap/jobLoops/reasonGraphFailed', 'graph failed');
            case 'graph_missing': return nls.localize('qaap/jobLoops/reasonGraphMissing', 'graph unavailable');
            case 'graph_creation_failed': return nls.localize('qaap/jobLoops/reasonGraphCreationFailed', 'graph creation failed');
            case 'binding_missing': return nls.localize('qaap/jobLoops/reasonBindingMissing', 'binding value unavailable');
            case 'cancelled': return nls.localize('qaap/jobLoops/reasonCancelled', 'cancelled');
        }
    }
}
