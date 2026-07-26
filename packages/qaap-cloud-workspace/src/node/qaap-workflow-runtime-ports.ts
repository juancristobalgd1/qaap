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
import { canEnforceReadOnlyWorkspace } from '../common/qaap-agent-readonly-workspace';
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

/**
 * Set to `'1'` to refuse a `cwd-readonly` node whose backend cannot enforce read-only, instead of
 * running it unrestricted with a warning. Opt-in because fail-closed would break runs that complete
 * today on installations with only unrestrictable agent CLIs.
 */
export const QAAP_WORKFLOW_STRICT_READONLY_ENV = 'QAAP_WORKFLOW_STRICT_READONLY';

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
        const readOnly = node.isolation === 'cwd-readonly';
        if (readOnly) {
            this.assertReadOnlyEnforceable(node, routed, context);
        }
        const task = this.runner.create({
            title: `${record.def.name} · ${node.id}`,
            prompt,
            cwd: record.cwd,
            agent: routed.agentRef,
            // Makes the node's declared isolation a restriction on the spawned CLI instead of a
            // sentence in the prompt. Before this, a `cwd-readonly` judge ran with Edit/Write in hand
            // and was observed writing into the very tree it was grading.
            readOnlyWorkspace: readOnly,
            // The graph owns the review (its judge node), so the runner must not review this turn
            // as well. Only writer turns would trigger it; a read-only judge never does.
            externalReview: !readOnly,
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
     * A `cwd-readonly` node is additionally routed away from every backend that cannot be held to
     * read-only at all (see `qaap-agent-readonly-workspace.ts`): sending an explorer or a judge to a
     * CLI with no restriction mechanism leaves the isolation as prompt text, which is how a judge
     * came to write into the file it was grading.
     *
     * Both constraints are preferred, never required: if excluding the writers — or the
     * unrestrictable backends — leaves nothing installed, the node still runs rather than the change
     * going unreviewed. The judge node's `requireSentinel` still governs the verdict either way, and
     * an unenforceable read-only dispatch is reported by {@link assertReadOnlyEnforceable}.
     */
    protected resolveBackend(
        node: QaapWorkflowAgentTurnNode,
        record: QaapPersistedWorkflowRun,
    ): QaapWorkflowRoutingResult {
        const resolve = (blocked: ReadonlySet<string>, restrictable: boolean): QaapWorkflowRoutingResult => this.routing.resolve(
            node.capability,
            node.costTier,
            agentRef => !blocked.has(agentRef)
                && (!restrictable || canEnforceReadOnlyWorkspace(agentRef))
                && this.isAgentAvailable(agentRef),
            node.agentRef,
        );
        const readOnly = node.isolation === 'cwd-readonly';
        const writers = node.capability === 'judge' ? this.writerAgentsOf(record) : EMPTY_EXCLUSION;
        // Preference order, strongest constraint first, each one dropped only when it leaves nothing
        // installed. Enforceability outranks independence: a judge that shares the writer's model
        // still returns a verdict, while a judge that can edit the code invalidates the verdict
        // itself — which is precisely the failure this ordering exists to prevent.
        const exclusions = writers.size > 0 ? [writers, EMPTY_EXCLUSION] : [EMPTY_EXCLUSION];
        const restrictions = readOnly ? [true, false] : [false];
        let last: QaapWorkflowRoutingResult = { agentRef: undefined, reason: 'fallback' };
        for (const restrictable of restrictions) {
            for (const blocked of exclusions) {
                last = resolve(blocked, restrictable);
                if (last.agentRef) {
                    return last;
                }
            }
        }
        return last;
    }

    /**
     * Fail-closed switch for read-only isolation, opt-in via {@link QAAP_WORKFLOW_STRICT_READONLY_ENV}.
     *
     * Off by default on purpose: turning it on unilaterally would fail every read-only node on an
     * installation whose only agent CLI has no restriction mechanism — runs that complete today. With
     * it off the turn still runs, but the restriction is applied as far as the backend allows and the
     * shortfall is logged here and recorded on the task (`readOnlyEnforcement`), so a partial
     * guarantee is never mistaken for a full one.
     */
    protected assertReadOnlyEnforceable(
        node: QaapWorkflowAgentTurnNode,
        routed: QaapWorkflowRoutingResult,
        context: QaapWorkflowDispatchContext,
    ): void {
        // An undefined ref means the runner picks its own default agent, which is unknown here — the
        // runner resolves and records the real enforcement level once it knows which CLI it spawned.
        if (routed.agentRef && canEnforceReadOnlyWorkspace(routed.agentRef)) {
            return;
        }
        const backend = routed.agentRef ?? 'the runner default agent';
        const detail = `node "${node.id}" of run ${context.runId} declares cwd-readonly, but ${backend} `
            + 'cannot enforce it';
        if (process.env[QAAP_WORKFLOW_STRICT_READONLY_ENV] === '1') {
            throw new Error(`${detail}. Refusing to dispatch (${QAAP_WORKFLOW_STRICT_READONLY_ENV}=1).`);
        }
        console.warn(`[qaap-workflow] ${detail}; dispatching it unrestricted — this turn can modify the run's workspace.`);
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
