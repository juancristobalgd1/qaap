// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Turns a persisted workflow run into actual work (ADR-001).
 *
 * The dispatcher starts each node the store hands it, remembers where it went, and feeds terminal
 * results back through {@link QaapWorkflowRunStore.report}. It talks to the runtimes through the
 * narrow ports below instead of importing `QaapAgentTaskRunner` / `QaapJobRuntime` directly, so
 * the routing logic is testable without spawning anything, and so neither runtime's lifecycle,
 * budgets or restart recovery are duplicated here.
 */

import { extractAgentFinalMessage } from '../common/qaap-agent-empty-turn';
import { QaapAgentTaskState } from '../common/qaap-agent-task';
import { QaapJobState } from '../common/qaap-job';
import { QaapWorkflowAgentTurnNode, QaapWorkflowDeterministicNode, QaapWorkflowNode } from '../common/qaap-workflow-ir';
import { resolveAgentTurnOutcome, resolveDeterministicOutcome } from '../common/qaap-workflow-outcome';
import { findTimedOutQaapWorkflowNodes, hasQaapWorkflowRunExpired } from '../common/qaap-workflow-run';
import { describeQaapWorkflowStep } from '../common/qaap-workflow-trace';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';

export interface QaapWorkflowDispatchContext {
    readonly runId: string;
    readonly nodeId: string;
    readonly ownerLogin: string;
}

export interface QaapWorkflowAgentTurnPort {
    /** Start a coding-agent turn and return its task id. */
    startAgentTurn(node: QaapWorkflowAgentTurnNode, context: QaapWorkflowDispatchContext): Promise<string>;
    /** Current state of a task, or undefined when the runtime no longer knows it. */
    lookupAgentTurn(externalId: string): Promise<{ readonly state: QaapAgentTaskState; readonly log?: string } | undefined>;
    /**
     * Observe how a dispatched turn ended, so the adapter can track backend health — a CLI that
     * exits non-zero (quota exhausted, auth broken) is put on cooldown and later unpinned turns
     * route around it instead of failing the same way run after run.
     */
    noteAgentTurnResult?(externalId: string, state: QaapAgentTaskState): void;
    /**
     * Stop a turn the run has stopped waiting for. Without it a timed-out node leaves its CLI
     * running: the graph would move on while the abandoned process still edits the same cwd.
     */
    cancelAgentTurn?(externalId: string): Promise<void>;
}

export interface QaapWorkflowDeterministicPort {
    /** Start a deterministic step and return its job id. */
    startDeterministic(node: QaapWorkflowDeterministicNode, context: QaapWorkflowDispatchContext): Promise<string>;
    lookupDeterministic(externalId: string): Promise<{ readonly state: QaapJobState; readonly result?: unknown } | undefined>;
    /** Stop a job the run has stopped waiting for. */
    cancelDeterministic?(externalId: string): Promise<void>;
}

export interface QaapWorkflowPorts {
    readonly agent: QaapWorkflowAgentTurnPort;
    readonly deterministic: QaapWorkflowDeterministicPort;
}

/** Node kinds with no runtime: they are resolved by the graph itself or by a person. */
const NON_DISPATCHABLE: ReadonlySet<QaapWorkflowNode['kind']> = new Set(['emit', 'join', 'human-gate', 'router']);

/**
 * Bookkeeping nodes the dispatcher must settle ITSELF. A fired join is pushed onto the frontier
 * like any other node, so it sits in `active` until something reports an outcome for it — and no
 * runtime ever will. Left unreported, every fan-in graph hung forever at `status: running`.
 * A router has no policy engine yet, so it is rejected at validation; failing it here as well keeps
 * a graph that slipped through from stalling instead.
 */
const SELF_SETTLED: Readonly<Partial<Record<QaapWorkflowNode['kind'], 'success' | 'fail'>>> = {
    join: 'success',
    router: 'fail',
};

/**
 * The text a deterministic node published for later prompts, or undefined when the node declares
 * no `artifactKey` or the runtime returned nothing usable.
 */
function extractNodeArtifact(
    node: QaapWorkflowDeterministicNode,
    result: unknown,
): { readonly key: string; readonly value: string } | undefined {
    if (!node.artifactKey) {
        return undefined;
    }
    const value = (result as { readonly artifact?: unknown } | undefined)?.artifact;
    return typeof value === 'string' && value.length > 0 ? { key: node.artifactKey, value } : undefined;
}

/** What an agent turn hands to later nodes: its final message, under the node's `artifactKey`. */
function extractAgentTurnArtifact(
    node: QaapWorkflowAgentTurnNode,
    log: string | undefined,
): { readonly key: string; readonly value: string } | undefined {
    if (!node.artifactKey) {
        return undefined;
    }
    const value = extractAgentFinalMessage(log).trim();
    return value.length > 0 ? { key: node.artifactKey, value } : undefined;
}

/** Constructed by the backend module through {@code toDynamicValue}; the ports are adapters. */
export class QaapWorkflowDispatcher {

    constructor(
        protected readonly store: QaapWorkflowRunStore,
        protected readonly ports: QaapWorkflowPorts,
    ) { }

    /** Start every node the store just released, then keep going as outcomes arrive. */
    async dispatch(record: QaapPersistedWorkflowRun, nodeIds: readonly string[]): Promise<void> {
        const byId = new Map(record.def.nodes.map(node => [node.id, node]));
        // Settled after the real work is started: reporting a join can advance (or finish) the run,
        // and a sibling node in the same batch must be running by then, not still queued behind it.
        const selfSettled: Array<{ readonly nodeId: string; readonly outcome: 'success' | 'fail' }> = [];
        for (const nodeId of nodeIds) {
            const node = byId.get(nodeId);
            if (!node || NON_DISPATCHABLE.has(node.kind)) {
                // Human gates wait for a person; emits are already recorded by the reducer.
                const outcome = node && SELF_SETTLED[node.kind];
                if (outcome) {
                    selfSettled.push({ nodeId, outcome });
                }
                continue;
            }
            const context: QaapWorkflowDispatchContext = {
                runId: record.run.id,
                nodeId,
                ownerLogin: record.ownerLogin,
            };
            try {
                const externalId = node.kind === 'agent-turn'
                    ? await this.ports.agent.startAgentTurn(node, context)
                    : await this.ports.deterministic.startDeterministic(node as QaapWorkflowDeterministicNode, context);
                await this.store.attachDispatch(record.ownerLogin, record.run.id, nodeId, node.kind === 'agent-turn' ? 'agent' : 'job', externalId);
            } catch (error) {
                // A node that could not even start is a failed node, not a stuck run.
                console.warn(`[qaap-workflow] failed to start node "${nodeId}":`, error);
                await this.report(record.ownerLogin, record.run.id, nodeId, 'fail', undefined, 'The step could not be started.');
            }
        }
        for (const settled of selfSettled) {
            await this.report(record.ownerLogin, record.run.id, settled.nodeId, settled.outcome);
        }
    }

    /** Route a finished agent task back into its run. Ignores tasks that belong to no workflow. */
    async onAgentTaskFinished(externalId: string, state: QaapAgentTaskState, log?: string): Promise<void> {
        const found = this.store.findByExternalId(externalId);
        if (!found) {
            return;
        }
        const node = found.record.def.nodes.find(entry => entry.id === found.nodeId);
        if (node?.kind !== 'agent-turn') {
            return;
        }
        this.ports.agent.noteAgentTurnResult?.(externalId, state);
        const outcome = resolveAgentTurnOutcome(node, state, log);
        await this.report(
            found.record.ownerLogin,
            found.record.run.id,
            found.nodeId,
            outcome,
            extractAgentTurnArtifact(node, log),
            describeQaapWorkflowStep(node, outcome),
        );
    }

    /** Route a finished job back into its run. Ignores jobs that belong to no workflow. */
    async onJobFinished(externalId: string, state: QaapJobState, result?: unknown): Promise<void> {
        const found = this.store.findByExternalId(externalId);
        if (!found) {
            return;
        }
        const node = found.record.def.nodes.find(entry => entry.id === found.nodeId);
        const outcome = resolveDeterministicOutcome(state, result);
        await this.report(
            found.record.ownerLogin,
            found.record.run.id,
            found.nodeId,
            outcome,
            node?.kind === 'deterministic' ? extractNodeArtifact(node, result) : undefined,
            describeQaapWorkflowStep(node, outcome, result),
        );
    }

    /** Resume a human gate once a person decided to continue. */
    async continueAfterHumanGate(ownerLogin: string, runId: string, nodeId: string): Promise<void> {
        await this.report(ownerLogin, runId, nodeId, 'human:continue');
    }

    /**
     * Boot reconciliation: every node dispatched before the restart is checked against its runtime.
     * Nodes that finished while the backend was down are reported with their real outcome; nodes the
     * runtime no longer knows are interrupted, so a run can never hang on a process that is gone.
     */
    async reconcileOnBoot(): Promise<void> {
        // Every tenant, not just the anonymous bucket: a run left mid-flight by any owner must be
        // reconciled or it hangs forever on a process that no longer exists.
        for (const record of this.store.listAllUnfinished()) {
            // Bookkeeping nodes never get a `dispatched` entry, so a run parked on one (written by
            // a build that did not settle joins) would survive every restart. Settle them first.
            for (const nodeId of record.run.active) {
                if (record.dispatched[nodeId]) {
                    continue;
                }
                const outcome = SELF_SETTLED[record.def.nodes.find(node => node.id === nodeId)?.kind ?? 'emit'];
                if (outcome) {
                    await this.report(record.ownerLogin, record.run.id, nodeId, outcome);
                }
            }
            for (const entry of Object.values(record.dispatched)) {
                const node = record.def.nodes.find(candidate => candidate.id === entry.nodeId);
                if (entry.kind === 'agent' && node?.kind === 'agent-turn') {
                    const task = await this.ports.agent.lookupAgentTurn(entry.externalId);
                    if (!task) {
                        await this.store.interrupt(record.ownerLogin, record.run.id, entry.nodeId).then(
                            result => this.dispatch(result.record, result.dispatch),
                        );
                        continue;
                    }
                    if (task.state !== 'running' && task.state !== 'queued') {
                        await this.onAgentTaskFinished(entry.externalId, task.state, task.log);
                    }
                    continue;
                }
                const job = await this.ports.deterministic.lookupDeterministic(entry.externalId);
                if (!job) {
                    await this.store.interrupt(record.ownerLogin, record.run.id, entry.nodeId).then(
                        result => this.dispatch(result.record, result.dispatch),
                    );
                    continue;
                }
                if (job.state !== 'running' && job.state !== 'queued' && job.state !== 'waiting' && job.state !== 'retry_wait') {
                    await this.onJobFinished(entry.externalId, job.state, job.result);
                }
            }
        }
    }

    /**
     * Enforce the runs' own wall clocks. Called on a timer AND at boot, because a deadline is
     * persisted state, not a live timer: a run that expires while the backend is down must be
     * expired when it comes back, not resumed as if no time had passed.
     *
     * A timed-out NODE routes the graph's failure edge — the run may still repair itself. An
     * expired RUN is terminal. Either way the abandoned process is cancelled, never left editing
     * the workspace behind the graph's back.
     */
    async sweepDeadlines(now: number): Promise<void> {
        for (const record of this.store.listAllUnfinished()) {
            if (hasQaapWorkflowRunExpired(record.run, record.createdAt, now)) {
                console.warn(`[qaap-workflow] run ${record.run.id} exceeded its wall clock; stopping it.`);
                await Promise.all(Object.values(record.dispatched).map(entry => this.cancelDispatched(entry)));
                await this.store.expire(record.ownerLogin, record.run.id);
                continue;
            }
            const dispatchedAt: Record<string, number> = {};
            for (const entry of Object.values(record.dispatched)) {
                dispatchedAt[entry.nodeId] = entry.dispatchedAt;
            }
            for (const nodeId of findTimedOutQaapWorkflowNodes(record.run, dispatchedAt, now)) {
                const entry = record.dispatched[nodeId];
                console.warn(`[qaap-workflow] node "${nodeId}" of run ${record.run.id} exceeded its wall clock; failing it.`);
                // Report BEFORE cancelling: the cancellation's own terminal event then arrives for a
                // node that already left `active`, where the store drops it as stale. The other
                // order would let 'cancelled' (blocked) win the race over the timeout's 'fail'.
                await this.report(
                    record.ownerLogin, record.run.id, nodeId, 'fail', undefined,
                    `Stopped after ${Math.round((now - entry.dispatchedAt) / 60_000)} min: the run's node wall clock ran out.`,
                );
                await this.cancelDispatched(entry);
            }
        }
    }

    protected async cancelDispatched(entry: { readonly kind: 'agent' | 'job'; readonly externalId: string }): Promise<void> {
        try {
            await (entry.kind === 'agent'
                ? this.ports.agent.cancelAgentTurn?.(entry.externalId)
                : this.ports.deterministic.cancelDeterministic?.(entry.externalId));
        } catch (error) {
            // A process that cannot be cancelled must not stop the sweep from freeing the run.
            console.warn(`[qaap-workflow] failed to cancel ${entry.kind} ${entry.externalId}:`, error);
        }
    }

    protected async report(
        ownerLogin: string,
        runId: string,
        nodeId: string,
        outcome: Parameters<QaapWorkflowRunStore['report']>[3],
        artifact?: { readonly key: string; readonly value: string },
        detail?: string,
    ): Promise<void> {
        const result = await this.store.report(ownerLogin, runId, nodeId, outcome, undefined, artifact, detail);
        if (result.dispatch.length > 0) {
            await this.dispatch(result.record, result.dispatch);
        }
    }
}
