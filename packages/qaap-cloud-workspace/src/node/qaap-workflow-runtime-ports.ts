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
import { resolveQaapWorkflowTaskKind } from '../common/qaap-workflow-model-routing';
import { QaapWorkflowPromptRegistry } from '../common/qaap-workflow-prompt-registry';
import { QaapWorkflowRoutingPolicy, QaapWorkflowRoutingResult } from '../common/qaap-workflow-routing';
import { QaapAgentHealthTracker } from './qaap-agent-health';
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
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';

/** Nothing excluded — a plain routing pass. */
const EMPTY_EXCLUSION: ReadonlySet<string> = new Set();

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

    @inject(QaapAgentHealthTracker)
    protected readonly agentHealth: QaapAgentHealthTracker;

    /** Task id → the routed backend, so a terminal event can be attributed to the agent that ran it. */
    protected readonly routedAgentByTask = new Map<string, string>();

    async startAgentTurn(node: QaapWorkflowAgentTurnNode, context: QaapWorkflowDispatchContext): Promise<string> {
        const record = this.store.get(context.ownerLogin, context.runId);
        if (!record) {
            throw new Error(`Workflow run ${context.runId} is not available to dispatch node "${context.nodeId}".`);
        }
        const prompt = this.prompts.resolve(node.promptRef, {
            inputs: record.inputs,
            bindings: record.run.bindings,
            artifacts: record.artifacts,
        });
        // An unpinned turn declares only capability + tier; the policy maps that onto an installed
        // backend, and an unresolved ref falls back to the runner's own default agent.
        const routed = this.resolveBackend(node, record);
        const task = this.runner.create({
            title: `${record.def.name} · ${node.id}`,
            prompt,
            cwd: record.cwd,
            agent: routed.agentRef,
            // The graph owns the review (its judge node), so the runner must not review this turn
            // as well. Only writer turns would trigger it; a read-only judge never does.
            externalReview: node.isolation !== 'cwd-readonly',
            // Hands the orchestrator's own capability/costTier evaluation to model routing, so a
            // cheap explore/measure turn and a premium implement/judge turn land on different
            // models instead of both falling through to the runner's prompt-text heuristic.
            taskKind: resolveQaapWorkflowTaskKind(node.capability, node.costTier),
        }, context.ownerLogin || undefined);
        if (routed.agentRef) {
            this.routedAgentByTask.set(task.id, routed.agentRef);
            // Durable, unlike the map above, which only lives until this task reports: a judge
            // dispatched later still has to know who wrote the code.
            await this.store.noteRoutedAgent(context.ownerLogin, context.runId, node.id, routed.agentRef);
        }
        return task.id;
    }

    /**
     * Which backend runs this node.
     *
     * A judge is routed AWAY from every backend that already wrote in this run: "independent
     * adversarial review" is only true if a different model performs it, and with one strong
     * backend installed the table would happily pick the same one that just implemented the change
     * — a model grading its own homework, presented as an independent verdict.
     *
     * Independence is preferred, never required: if excluding the writers leaves nothing installed,
     * the same backend reviews rather than the change going unreviewed. The judge node's
     * `requireSentinel` still governs the verdict either way.
     */
    protected resolveBackend(
        node: QaapWorkflowAgentTurnNode,
        record: QaapPersistedWorkflowRun,
    ): QaapWorkflowRoutingResult {
        const resolve = (blocked: ReadonlySet<string>): QaapWorkflowRoutingResult => this.routing.resolve(
            node.capability,
            node.costTier,
            agentRef => !blocked.has(agentRef) && this.isAgentAvailable(agentRef),
            node.agentRef,
        );
        if (node.capability !== 'judge') {
            return resolve(EMPTY_EXCLUSION);
        }
        const writers = this.writerAgentsOf(record);
        const independent = writers.size > 0 ? resolve(writers) : undefined;
        return independent?.agentRef ? independent : resolve(EMPTY_EXCLUSION);
    }

    /** Backends that already ran a node allowed to modify the workspace in this run. */
    protected writerAgentsOf(record: QaapPersistedWorkflowRun): ReadonlySet<string> {
        const writers = new Set<string>();
        for (const [nodeId, agentRef] of Object.entries(record.routedAgents)) {
            const node = record.def.nodes.find(candidate => candidate.id === nodeId);
            if (node?.kind === 'agent-turn' && node.isolation !== 'cwd-readonly') {
                writers.add(agentRef);
            }
        }
        return writers;
    }

    noteAgentTurnResult(externalId: string, state: QaapAgentTaskState): void {
        const agentRef = this.routedAgentByTask.get(externalId);
        if (!agentRef) {
            return;
        }
        this.routedAgentByTask.delete(externalId);
        if (state === 'failed') {
            this.agentHealth.noteFailure(agentRef);
        } else {
            this.agentHealth.noteSuccess(agentRef);
        }
    }

    protected isAgentAvailable(agentRef: string): boolean {
        if (this.agentHealth.isCoolingDown(agentRef)) {
            return false;
        }
        return this.runner.listAgents().some(agent => agent.id === agentRef && agent.available);
    }

    async lookupAgentTurn(externalId: string): Promise<{ readonly state: QaapAgentTaskState; readonly log?: string } | undefined> {
        const detail = await this.runner.detail(externalId);
        return detail && { state: detail.state, log: detail.log };
    }

    async cancelAgentTurn(externalId: string): Promise<void> {
        // A timed-out turn is not a healthy backend that happened to be slow: leaving it out of the
        // health tracker would keep routing later turns to a CLI that wedges.
        this.noteAgentTurnResult(externalId, 'failed');
        this.runner.cancel(externalId);
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
            // Measure against where the repository was when the run started, not against HEAD:
            // an agent that commits its work leaves a clean tree and would look like no change.
            input: {
                ...(record.baseRef ? { baseRef: record.baseRef } : {}),
                // Only the verify op reads it; the others ignore an extra key.
                ...(record.goalCheckScript ? { script: record.goalCheckScript } : {}),
            },
            // One run must never start the same node twice, even if a report is replayed.
            idempotencyKey: `workflow:${context.runId}:${context.nodeId}`,
        }, context.ownerLogin || undefined);
        return created.job.id;
    }

    async lookupDeterministic(externalId: string): Promise<{ readonly state: QaapJobState; readonly result?: unknown } | undefined> {
        const job = this.jobs.get(externalId);
        return job && { state: job.state, result: job.result };
    }

    async cancelDeterministic(externalId: string): Promise<void> {
        this.jobs.cancel(externalId);
    }
}
