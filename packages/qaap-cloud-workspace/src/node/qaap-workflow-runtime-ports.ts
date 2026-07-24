// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Binds the workflow dispatcher's ports to the real runtimes (ADR-001).
 *
 * Agent turns go to {@code QaapAgentTaskRunner} and deterministic steps to {@code QaapJobRuntime};
 * neither lifecycle is reimplemented here. This file only translates a node into a create request
 * and back.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapAgentTaskState } from '../common/qaap-agent-task';
import { QaapJobState } from '../common/qaap-job';
import { QaapWorkflowAgentTurnNode, QaapWorkflowDeterministicNode } from '../common/qaap-workflow-ir';
import { QaapWorkflowPromptRegistry } from '../common/qaap-workflow-prompt-registry';
import { QaapWorkflowRoutingPolicy } from '../common/qaap-workflow-routing';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapJobRuntime } from './qaap-job-runtime';
import {
    QaapWorkflowAgentTurnPort,
    QaapWorkflowDeterministicPort,
    QaapWorkflowDispatchContext,
} from './qaap-workflow-dispatcher';
import {
    QAAP_WORKFLOW_CLASSIFY_RISK_FUNCTION,
    QAAP_WORKFLOW_GIT_DIFF_FUNCTION,
    QAAP_WORKFLOW_VERIFY_FUNCTION,
} from './qaap-workflow-job-functions';
import { QaapWorkflowRunStore } from './qaap-workflow-run-store';

/** Deterministic ops that already have a runtime. Others fail loudly instead of silently passing. */
const FUNCTION_BY_OP: Readonly<Partial<Record<QaapWorkflowDeterministicNode['op'], string>>> = {
    'risk-classify': QAAP_WORKFLOW_CLASSIFY_RISK_FUNCTION,
    'git-diff': QAAP_WORKFLOW_GIT_DIFF_FUNCTION,
    verify: QAAP_WORKFLOW_VERIFY_FUNCTION,
};

@injectable()
export class QaapWorkflowAgentTurnAdapter implements QaapWorkflowAgentTurnPort {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    @inject(QaapWorkflowRunStore)
    protected readonly store: QaapWorkflowRunStore;

    @inject(QaapWorkflowPromptRegistry)
    protected readonly prompts: QaapWorkflowPromptRegistry;

    @inject(QaapWorkflowRoutingPolicy)
    protected readonly routing: QaapWorkflowRoutingPolicy;

    async startAgentTurn(node: QaapWorkflowAgentTurnNode, context: QaapWorkflowDispatchContext): Promise<string> {
        const record = this.store.get(context.ownerLogin, context.runId);
        if (!record) {
            throw new Error(`Workflow run ${context.runId} is not available to dispatch node "${context.nodeId}".`);
        }
        const prompt = this.prompts.resolve(node.promptRef, {
            inputs: record.inputs,
            bindings: record.run.bindings,
        });
        // An unpinned turn declares only capability + tier; the policy maps that onto an installed
        // backend, and an unresolved ref falls back to the runner's own default agent.
        const routed = this.routing.resolve(
            node.capability,
            node.costTier,
            agentRef => this.isAgentAvailable(agentRef),
            node.agentRef,
        );
        const task = this.runner.create({
            title: `${record.def.name} · ${node.id}`,
            prompt,
            cwd: record.cwd,
            agent: routed.agentRef,
            // The graph owns the review (its judge node), so the runner must not review this turn
            // as well. Only writer turns would trigger it; a read-only judge never does.
            externalReview: node.isolation !== 'cwd-readonly',
        }, context.ownerLogin || undefined);
        return task.id;
    }

    protected isAgentAvailable(agentRef: string): boolean {
        return this.runner.listAgents().some(agent => agent.id === agentRef && agent.available);
    }

    async lookupAgentTurn(externalId: string): Promise<{ readonly state: QaapAgentTaskState; readonly log?: string } | undefined> {
        const detail = await this.runner.detail(externalId);
        return detail && { state: detail.state, log: detail.log };
    }
}

@injectable()
export class QaapWorkflowDeterministicAdapter implements QaapWorkflowDeterministicPort {

    @inject(QaapJobRuntime)
    protected readonly jobs: QaapJobRuntime;

    @inject(QaapWorkflowRunStore)
    protected readonly store: QaapWorkflowRunStore;

    async startDeterministic(node: QaapWorkflowDeterministicNode, context: QaapWorkflowDispatchContext): Promise<string> {
        const record = this.store.get(context.ownerLogin, context.runId);
        if (!record) {
            throw new Error(`Workflow run ${context.runId} is not available to dispatch node "${context.nodeId}".`);
        }
        const functionId = FUNCTION_BY_OP[node.op];
        if (!functionId) {
            // 'shell' has no command channel on the node (adding one needs an injection-safe design)
            // and 'parse-sentinel' has no parser yet. Failing here routes the node down the graph's
            // failure edge instead of pretending the step succeeded.
            throw new Error(`Deterministic workflow op "${node.op}" has no runtime yet.`);
        }
        const created = this.jobs.create({
            kind: 'function',
            functionId,
            title: `${record.def.name} · ${node.id}`,
            cwd: record.cwd,
            // One run must never start the same node twice, even if a report is replayed.
            idempotencyKey: `workflow:${context.runId}:${context.nodeId}`,
        }, context.ownerLogin || undefined);
        return created.job.id;
    }

    async lookupDeterministic(externalId: string): Promise<{ readonly state: QaapJobState; readonly result?: unknown } | undefined> {
        const job = this.jobs.get(externalId);
        return job && { state: job.state, result: job.result };
    }
}
