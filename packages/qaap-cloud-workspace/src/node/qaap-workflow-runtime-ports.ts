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
import { randomUUID } from 'crypto';
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
import {
    QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS,
    QaapPersistedWorkflowRun,
    QaapWorkflowRunStore,
} from './qaap-workflow-run-store';

/** Nothing excluded — a plain routing pass. */
const EMPTY_EXCLUSION: ReadonlySet<string> = new Set();
const DISPATCH_CLAIM_POLL_MS = 10;
const DISPATCH_CLAIM_WAIT_MS = QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS + 5_000;

/** Two exclusion tiers blocking the same backends resolve identically; the repeat is dropped. */
function isSameAgentSet(one: ReadonlySet<string>, other: ReadonlySet<string>): boolean {
    return one.size === other.size && [...one].every(agentRef => other.has(agentRef));
}

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
        const claimId = randomUUID();
        const claim = await this.store.claimDispatch(
            context.ownerLogin, context.runId, context.nodeId, context.visit, 'agent', claimId,
        );
        if (claim.status === 'attached') {
            return claim.externalId;
        }
        if (claim.status === 'pending') {
            return this.waitForClaimedAgentTurn(node, context);
        }

        let taskId: string | undefined;
        let routed: QaapWorkflowRoutingResult | undefined;
        try {
            const current = this.store.get(context.ownerLogin, context.runId);
            if (!current) {
                throw new Error(`Workflow run ${context.runId} disappeared while dispatching node "${context.nodeId}".`);
            }
            const prompt = this.prompts.resolve(node.promptRef, {
                inputs: current.inputs,
                bindings: current.run.bindings,
                artifacts: current.artifacts,
            });
            // An unpinned turn declares only capability + tier; the policy maps that onto an installed
            // backend, and an unresolved ref falls back to the runner's own default agent.
            routed = this.resolveBackend(node, current);
            const readOnly = node.isolation === 'cwd-readonly';
            if (readOnly) {
                this.assertReadOnlyEnforceable(node, routed, context);
            }
            const task = this.runner.create({
                title: `${current.def.name} · ${node.id}`,
                prompt,
                cwd: current.cwd,
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
            taskId = task.id;
            // Publishing the id consumes the durable claim. No caller can observe an unclaimed gap:
            // it sees either the pending claim or this attachment, never permission to create too.
            await this.store.completeDispatchClaim(
                context.ownerLogin, context.runId, context.nodeId, context.visit, 'agent', claimId, task.id,
            );
        } catch (error) {
            if (taskId) {
                try {
                    this.runner.cancel(taskId);
                } catch (cancelError) {
                    console.warn(`[qaap-workflow] failed to cancel unclaimed agent task ${taskId}:`, cancelError);
                }
            }
            await this.store.releaseDispatchClaim(context.ownerLogin, context.runId, context.nodeId, claimId)
                .catch(releaseError => console.warn('[qaap-workflow] failed to release agent dispatch claim:', releaseError));
            throw error;
        }
        const task = { id: taskId! };
        if (routed?.agentRef) {
            this.routedAgentByTask.set(task.id, routed.agentRef);
            // Durable, unlike the map above, which only lives until this task reports: a judge
            // dispatched later still has to know who wrote the code.
            await this.store.noteRoutedAgent(context.ownerLogin, context.runId, node.id, routed.agentRef)
                .catch(error => console.warn('[qaap-workflow] failed to persist routed agent metadata:', error));
        }
        return task.id;
    }

    /** Wait for the caller that owns the durable claim, then reuse the id it published. */
    protected async waitForClaimedAgentTurn(
        node: QaapWorkflowAgentTurnNode,
        context: QaapWorkflowDispatchContext,
    ): Promise<string> {
        const deadline = Date.now() + DISPATCH_CLAIM_WAIT_MS;
        while (Date.now() < deadline) {
            const record = this.store.get(context.ownerLogin, context.runId);
            const attached = record?.dispatched[context.nodeId];
            if (attached?.kind === 'agent') {
                return attached.externalId;
            }
            if (!record?.run.active.includes(context.nodeId) || record.run.visits[context.nodeId] !== context.visit) {
                throw new Error(`Workflow node "${context.nodeId}" visit ${context.visit} stopped while waiting for its dispatch claim.`);
            }
            const pending = record.dispatchClaims[context.nodeId];
            if (!pending) {
                // The owner failed before publishing an id and released its claim. Compete for a
                // fresh claim; the store still guarantees that only one retry can win.
                return this.startAgentTurn(node, context);
            }
            if (Date.now() - pending.claimedAt >= QAAP_WORKFLOW_DISPATCH_CLAIM_LEASE_MS) {
                // The creator exceeded its lease. claimDispatch() atomically decides which waiter
                // steals it; losers see the replacement claim and continue waiting.
                return this.startAgentTurn(node, context);
            }
            await new Promise(resolve => setTimeout(resolve, DISPATCH_CLAIM_POLL_MS));
        }
        throw new Error(`Timed out waiting for the dispatch claim of node "${context.nodeId}" visit ${context.visit}.`);
    }

    /**
     * Which backend runs this node.
     *
     * A judge is routed AWAY from every backend that had a hand in what it is about to judge — the
     * writers, the authors of the material flowing into it, and the peers that already judged in
     * this run (see {@link judgeExclusionsOf}). "Independent adversarial review" is only true if a
     * different model performs it, and with one strong backend installed the table would happily
     * pick the same one that just implemented the change — a model grading its own homework,
     * presented as an independent verdict.
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
        // Preference order, strongest constraint first, each one dropped only when it leaves nothing
        // installed. Enforceability outranks independence: a judge that shares the writer's model
        // still returns a verdict, while a judge that can edit the code invalidates the verdict
        // itself — which is precisely the failure this ordering exists to prevent. That is why the
        // independence tiers are the INNER loop: every one of them is tried under the restrictable
        // predicate before any of them is tried without it.
        const exclusions = [
            ...(node.capability === 'judge' ? this.judgeExclusionsOf(node, record) : []),
            EMPTY_EXCLUSION,
        ];
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

    /**
     * Ordered exclusion sets for a judge node, strongest first — each dropped only when it leaves
     * nothing installed.
     *
     * The first tier is full independence: nobody who produced what this node is judging, and
     * nobody who has already judged it. The second is the historical guarantee alone — stay off the
     * writers. So the degradation chain prefers, in order: a fully independent judge, a judge that
     * at least did not write the code, and only then a judge that did. Reviewing with a backend
     * another lens already used still beats not reviewing at all.
     *
     * With a single judge and no read-only author feeding it, the two tiers block exactly the same
     * backends and the repeat is dropped, which is what keeps the one-judge shapes routing exactly
     * as they did before independence was generalized beyond the writers.
     */
    protected judgeExclusionsOf(
        node: QaapWorkflowAgentTurnNode,
        record: QaapPersistedWorkflowRun,
    ): readonly ReadonlySet<string>[] {
        const writers = this.writerAgentsOf(record);
        const independent = new Set([
            ...writers,
            ...this.upstreamAuthorsOf(node, record),
            ...this.peerJudgeAgentsOf(node, record),
        ]);
        const tiers: ReadonlySet<string>[] = [];
        for (const tier of [independent, writers]) {
            // An empty tier is the unconstrained pass that already terminates the chain, and a tier
            // that blocks what a previous one blocked would resolve to the same backend twice.
            if (tier.size > 0 && !tiers.some(previous => isSameAgentSet(previous, tier))) {
                tiers.push(tier);
            }
        }
        return tiers;
    }

    /**
     * Backends that authored what flows INTO this node: its nearest agent-turn ancestors, reached
     * through the deterministic steps and joins in between.
     *
     * This is the general form of "no model grades its own homework". The writer rule only ever
     * caught the model that EDITED the tree, so it saw nothing to exclude in the two places where a
     * judgment rests on something an agent merely wrote down: a plan gate judging a proposal from a
     * read-only plan turn, and a synthesis turn judging three read-only lens reports. In both the
     * author was invisible and the gate could be handed straight back to the author.
     *
     * The walk stops at the first agent-turn on each branch: what THAT turn read is its own
     * business. That is why the explorers behind an implement turn are not excluded from reviewing
     * the implementation — they authored the findings, not the change under review.
     */
    protected upstreamAuthorsOf(
        node: QaapWorkflowAgentTurnNode,
        record: QaapPersistedWorkflowRun,
    ): ReadonlySet<string> {
        const byId = new Map(record.def.nodes.map(candidate => [candidate.id, candidate]));
        const incoming = new Map<string, string[]>();
        for (const edge of record.def.edges) {
            const sources = incoming.get(edge.to);
            if (sources) {
                sources.push(edge.from);
            } else {
                incoming.set(edge.to, [edge.from]);
            }
        }
        const authors = new Set<string>();
        // Seeded with the node itself: this graph has cycles by design — a rejected plan re-enters
        // the plan turn, a failed verification re-enters an implement turn — so an unguarded walk
        // backwards would never terminate.
        const visited = new Set<string>([node.id]);
        const pending = [...(incoming.get(node.id) ?? [])];
        for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
            if (visited.has(id)) {
                continue;
            }
            visited.add(id);
            if (byId.get(id)?.kind === 'agent-turn') {
                const agentRef = record.routedAgents[id];
                if (agentRef) {
                    authors.add(agentRef);
                }
                continue;
            }
            pending.push(...(incoming.get(id) ?? []));
        }
        return authors;
    }

    /**
     * Backends that have already judged in this run.
     *
     * Three lenses on one model are one lens. The dispatcher starts a released batch serially and
     * awaits {@link QaapWorkflowRunStore.noteRoutedAgent} before returning, so lens two genuinely
     * sees where lens one went; without this every lens resolved against an identical blocked set
     * over an identical preference order and landed on the same backend, and a three-eyed review
     * was one opinion reported three times.
     *
     * A node's own earlier visit is not a peer: a re-planned gate or a re-reviewed fix loop must be
     * free to keep its lane, and self-exclusion would also make the single-judge shapes route
     * differently on a second visit — the one thing this generalization must not change.
     */
    protected peerJudgeAgentsOf(
        node: QaapWorkflowAgentTurnNode,
        record: QaapPersistedWorkflowRun,
    ): ReadonlySet<string> {
        const peers = new Set<string>();
        for (const [nodeId, agentRef] of Object.entries(record.routedAgents)) {
            if (nodeId === node.id) {
                continue;
            }
            const candidate = record.def.nodes.find(entry => entry.id === nodeId);
            if (candidate?.kind === 'agent-turn' && candidate.capability === 'judge') {
                peers.add(agentRef);
            }
        }
        return peers;
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
            // A replay of ONE durable visit resolves to the same job, while a graph loop that
            // re-enters this node gets a fresh job and genuinely verifies the repaired workspace.
            // Keying only by run + node reused visit one's terminal result forever and turned
            // verify → fix → verify into verify → fix → the old failed verify.
            idempotencyKey: `workflow:${context.runId}:${context.nodeId}:visit:${context.visit}`,
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
