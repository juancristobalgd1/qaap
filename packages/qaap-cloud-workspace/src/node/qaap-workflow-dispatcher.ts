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

import { QaapAgentTaskState } from '../common/qaap-agent-task';
import { QaapJobState } from '../common/qaap-job';
import { QaapWorkflowAgentTurnNode, QaapWorkflowDeterministicNode, QaapWorkflowNode } from '../common/qaap-workflow-ir';
import { resolveAgentTurnOutcome, resolveDeterministicOutcome } from '../common/qaap-workflow-outcome';
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
}

export interface QaapWorkflowDeterministicPort {
    /** Start a deterministic step and return its job id. */
    startDeterministic(node: QaapWorkflowDeterministicNode, context: QaapWorkflowDispatchContext): Promise<string>;
    lookupDeterministic(externalId: string): Promise<{ readonly state: QaapJobState; readonly result?: unknown } | undefined>;
}

export interface QaapWorkflowPorts {
    readonly agent: QaapWorkflowAgentTurnPort;
    readonly deterministic: QaapWorkflowDeterministicPort;
}

/** Node kinds the dispatcher cannot start: they are resolved by the graph or by a person. */
const NON_DISPATCHABLE: ReadonlySet<QaapWorkflowNode['kind']> = new Set(['emit', 'join', 'human-gate', 'router']);

/** Constructed by the backend module through {@code toDynamicValue}; the ports are adapters. */
export class QaapWorkflowDispatcher {

    constructor(
        protected readonly store: QaapWorkflowRunStore,
        protected readonly ports: QaapWorkflowPorts,
    ) { }

    /** Start every node the store just released, then keep going as outcomes arrive. */
    async dispatch(record: QaapPersistedWorkflowRun, nodeIds: readonly string[]): Promise<void> {
        const byId = new Map(record.def.nodes.map(node => [node.id, node]));
        for (const nodeId of nodeIds) {
            const node = byId.get(nodeId);
            if (!node || NON_DISPATCHABLE.has(node.kind)) {
                // Human gates wait for a person; joins and emits are pure graph bookkeeping.
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
                await this.report(record.ownerLogin, record.run.id, nodeId, 'fail');
            }
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
        await this.report(found.record.ownerLogin, found.record.run.id, found.nodeId, resolveAgentTurnOutcome(node, state, log));
    }

    /** Route a finished job back into its run. Ignores jobs that belong to no workflow. */
    async onJobFinished(externalId: string, state: QaapJobState, result?: unknown): Promise<void> {
        const found = this.store.findByExternalId(externalId);
        if (!found) {
            return;
        }
        await this.report(
            found.record.ownerLogin,
            found.record.run.id,
            found.nodeId,
            resolveDeterministicOutcome(state, result),
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

    protected async report(
        ownerLogin: string,
        runId: string,
        nodeId: string,
        outcome: Parameters<QaapWorkflowRunStore['report']>[3],
    ): Promise<void> {
        const result = await this.store.report(ownerLogin, runId, nodeId, outcome);
        if (result.dispatch.length > 0) {
            await this.dispatch(result.record, result.dispatch);
        }
    }
}
