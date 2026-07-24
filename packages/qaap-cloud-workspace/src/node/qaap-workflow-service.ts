// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Wires the workflow planner into the running backend (ADR-001).
 *
 * Subscribes both runtimes' terminal events, reconciles unfinished runs once at boot, and offers
 * the one entry point that starts a run. Everything it does is a no-op until a run exists, so
 * binding it changes no existing behaviour.
 */

import { DisposableCollection } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { isQaapAgentTaskFinished } from '../common/qaap-agent-task';
import { isQaapJobFinished } from '../common/qaap-job';
import { QaapWorkflowDef } from '../common/qaap-workflow-ir';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapJobRuntime } from './qaap-job-runtime';
import { QaapWorkflowDispatcher } from './qaap-workflow-dispatcher';
import {
    QaapPersistedWorkflowRun,
    QaapStartWorkflowRunOptions,
    QaapWorkflowRunStore,
} from './qaap-workflow-run-store';

@injectable()
export class QaapWorkflowService implements BackendApplicationContribution {

    @inject(QaapWorkflowRunStore)
    protected readonly store: QaapWorkflowRunStore;

    @inject(QaapWorkflowDispatcher)
    protected readonly dispatcher: QaapWorkflowDispatcher;

    @inject(QaapAgentTaskRunner)
    protected readonly tasks: QaapAgentTaskRunner;

    @inject(QaapJobRuntime)
    protected readonly jobs: QaapJobRuntime;

    protected readonly toDispose = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.tasks.onDidChangeTask(event => {
            if (isQaapAgentTaskFinished(event.task.state)) {
                void this.onAgentTaskFinished(event.task.id);
            }
        }));
        this.toDispose.push(this.jobs.onDidChangeJob(event => {
            if (event.type !== 'output' && isQaapJobFinished(event.job.state)) {
                void this.dispatcher.onJobFinished(event.job.id, event.job.state, this.jobs.get(event.job.id)?.result)
                    .catch(error => console.warn('[qaap-workflow] failed to route a finished job:', error));
            }
        }));
    }

    onStart(): void {
        void this.dispatcher.reconcileOnBoot()
            .catch(error => console.warn('[qaap-workflow] boot reconciliation failed:', error));
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    /** Start a workflow run and dispatch its entry nodes. */
    async start(def: QaapWorkflowDef, options: QaapStartWorkflowRunOptions): Promise<QaapPersistedWorkflowRun> {
        const started = await this.store.start(def, options);
        await this.dispatcher.dispatch(started.record, started.dispatch);
        return this.store.get(options.ownerLogin, started.record.run.id) ?? started.record;
    }

    /** Resume a run parked at a human gate. */
    continueAfterHumanGate(ownerLogin: string | undefined, runId: string, nodeId: string): Promise<void> {
        return this.dispatcher.continueAfterHumanGate(ownerLogin ?? '', runId, nodeId);
    }

    protected async onAgentTaskFinished(taskId: string): Promise<void> {
        try {
            // The log is only read for tasks that belong to a run, so unrelated tasks cost nothing.
            if (!this.store.findByExternalId(taskId)) {
                return;
            }
            const detail = await this.tasks.detail(taskId);
            if (detail) {
                await this.dispatcher.onAgentTaskFinished(taskId, detail.state, detail.log);
            }
        } catch (error) {
            console.warn('[qaap-workflow] failed to route a finished agent task:', error);
        }
    }
}
