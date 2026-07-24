// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Durable run state for the Agent Workflow IR (ADR-001).
 *
 * Pure reducer: it decides which nodes to dispatch next and never performs I/O. Deterministic
 * nodes are dispatched to the job runtime and agent turns to {@code QaapAgentTaskRunner}; both
 * already own process lifecycle, restart recovery and their own concurrency budgets, so this
 * layer only tracks graph position, join arrivals, bindings and the loop budget.
 */

import {
    QaapWorkflowDef,
    QaapWorkflowJoinNode,
    QaapWorkflowNode,
    QaapWorkflowNodeOutcome,
    stepQaapWorkflow,
} from './qaap-workflow-ir';

export type QaapWorkflowRunStatus =
    | 'running'
    /** A human-gate node is dispatched and the run waits for a person. */
    | 'awaiting-human'
    | 'succeeded'
    | 'failed'
    | 'budget-exhausted';

export type QaapWorkflowTerminationReason =
    | 'emit'
    | 'no-edge'
    | 'unknown-node'
    /** A join can never be satisfied because every branch that feeds it has ended. */
    | 'stalled'
    | 'max-node-runs'
    | 'max-visits';

/** Bounds cycles in `edges`; job loops own their own budgets, agent-only graphs need these. */
export interface QaapWorkflowRunBudget {
    /** Total node dispatches allowed in one run. */
    readonly maxNodeRuns: number;
    /** Dispatches allowed for a single node id, so a cycle cannot spin forever. */
    readonly maxVisitsPerNode: number;
}

export const DEFAULT_QAAP_WORKFLOW_RUN_BUDGET: QaapWorkflowRunBudget = {
    maxNodeRuns: 64,
    maxVisitsPerNode: 8,
};

export interface QaapWorkflowRun {
    readonly id: string;
    readonly defId: string;
    readonly defVersion: number;
    readonly status: QaapWorkflowRunStatus;
    /** Dispatched nodes that have not reported an outcome yet. */
    readonly active: readonly string[];
    /** Dispatch count per node id. */
    readonly visits: Readonly<Record<string, number>>;
    /** Join node id → ids of the predecessors that already arrived. */
    readonly joinArrivals: Readonly<Record<string, readonly string[]>>;
    /** Join node ids that already fired, so late arrivals do not dispatch them twice. */
    readonly firedJoins: readonly string[];
    /** Emitted binding keys → artifact reference resolved by the caller. */
    readonly bindings: Readonly<Record<string, string>>;
    readonly nodeRuns: number;
    readonly budget: QaapWorkflowRunBudget;
    readonly terminationReason?: QaapWorkflowTerminationReason;
}

export interface QaapWorkflowAdvanceResult {
    readonly run: QaapWorkflowRun;
    /** Nodes the caller must start now, in declaration order. */
    readonly dispatch: readonly string[];
}

export interface QaapWorkflowStartOptions {
    readonly runId: string;
    readonly budget?: QaapWorkflowRunBudget;
}

const FAILING_OUTCOMES: ReadonlySet<QaapWorkflowNodeOutcome> = new Set([
    'fail',
    'blocked',
    'verdict:fail',
]);

export function startQaapWorkflowRun(
    def: QaapWorkflowDef,
    options: QaapWorkflowStartOptions,
): QaapWorkflowAdvanceResult {
    const run: QaapWorkflowRun = {
        id: options.runId,
        defId: def.id,
        defVersion: def.version,
        status: 'running',
        active: [],
        visits: {},
        joinArrivals: {},
        firedJoins: [],
        bindings: {},
        nodeRuns: 0,
        budget: options.budget ?? DEFAULT_QAAP_WORKFLOW_RUN_BUDGET,
    };
    return dispatchNodes(def, run, [def.entry]);
}

/**
 * Report the outcome of one dispatched node and compute the next frontier. `bindingRef` is stored
 * when the successor is an emit node, so later nodes can resolve artifacts without a rerun.
 */
export function advanceQaapWorkflowRun(
    def: QaapWorkflowDef,
    run: QaapWorkflowRun,
    finishedNodeId: string,
    outcome: QaapWorkflowNodeOutcome,
    bindingRef?: string,
): QaapWorkflowAdvanceResult {
    if (run.status !== 'running' && run.status !== 'awaiting-human') {
        return { run, dispatch: [] };
    }
    const byId = new Map(def.nodes.map(node => [node.id, node]));
    if (!byId.has(finishedNodeId)) {
        return { run: terminate(run, 'failed', 'unknown-node'), dispatch: [] };
    }

    const active = run.active.filter(id => id !== finishedNodeId);
    let next: QaapWorkflowRun = { ...run, active, status: 'running' };

    const step = stepQaapWorkflow(def, run.active, finishedNodeId, outcome);
    const targets = step.next;

    if (targets.length === 0) {
        if (active.length > 0) {
            // Other branches are still running; this one just ended.
            return { run: next, dispatch: [] };
        }
        if (hasPendingJoin(next)) {
            // The last live branch died before reaching a join that still expects it.
            return { run: terminate(next, 'failed', 'stalled'), dispatch: [] };
        }
        const status = FAILING_OUTCOMES.has(outcome) ? 'failed' : 'succeeded';
        return { run: terminate(next, status, step.terminalReason ?? 'no-edge'), dispatch: [] };
    }

    const ready: string[] = [];
    for (const target of targets) {
        const node = byId.get(target);
        if (!node) {
            return { run: terminate(next, 'failed', 'unknown-node'), dispatch: [] };
        }
        if (node.kind === 'emit') {
            next = recordEmit(next, node.bindingKey, bindingRef);
            continue;
        }
        if (node.kind === 'join') {
            const joined = recordJoinArrival(def, next, node, finishedNodeId);
            next = joined.run;
            if (joined.fired) {
                ready.push(target);
            }
            continue;
        }
        ready.push(target);
    }

    if (ready.length === 0) {
        if (next.active.length > 0) {
            return { run: next, dispatch: [] };
        }
        if (hasPendingJoin(next)) {
            return { run: terminate(next, 'failed', 'stalled'), dispatch: [] };
        }
        const status = FAILING_OUTCOMES.has(outcome) ? 'failed' : 'succeeded';
        return { run: terminate(next, status, 'emit'), dispatch: [] };
    }

    return dispatchNodes(def, next, ready);
}

function dispatchNodes(
    def: QaapWorkflowDef,
    run: QaapWorkflowRun,
    nodeIds: readonly string[],
): QaapWorkflowAdvanceResult {
    const byId = new Map(def.nodes.map(node => [node.id, node]));
    const visits = { ...run.visits };
    const dispatch: string[] = [];
    let nodeRuns = run.nodeRuns;
    let status: QaapWorkflowRunStatus = 'running';

    for (const nodeId of nodeIds) {
        if (nodeRuns >= run.budget.maxNodeRuns) {
            return { run: terminate({ ...run, visits, nodeRuns }, 'budget-exhausted', 'max-node-runs'), dispatch: [] };
        }
        const visited = (visits[nodeId] ?? 0) + 1;
        if (visited > run.budget.maxVisitsPerNode) {
            return { run: terminate({ ...run, visits, nodeRuns }, 'budget-exhausted', 'max-visits'), dispatch: [] };
        }
        visits[nodeId] = visited;
        nodeRuns++;
        dispatch.push(nodeId);
        if (isHumanGate(byId.get(nodeId))) {
            status = 'awaiting-human';
        }
    }

    return {
        run: {
            ...run,
            status,
            active: [...run.active, ...dispatch],
            visits,
            nodeRuns,
            terminationReason: undefined,
        },
        dispatch,
    };
}

function recordJoinArrival(
    def: QaapWorkflowDef,
    run: QaapWorkflowRun,
    join: QaapWorkflowJoinNode,
    from: string,
): { readonly run: QaapWorkflowRun; readonly fired: boolean } {
    if (run.firedJoins.includes(join.id)) {
        return { run, fired: false };
    }
    const arrived = [...new Set([...(run.joinArrivals[join.id] ?? []), from])];
    const expected = new Set(def.edges.filter(edge => edge.to === join.id).map(edge => edge.from)).size;
    const required = join.wait === 'all' ? expected : join.wait === 'any' ? 1 : Math.min(join.n ?? 1, expected);
    const fired = arrived.length >= required;
    return {
        run: {
            ...run,
            joinArrivals: { ...run.joinArrivals, [join.id]: arrived },
            firedJoins: fired ? [...run.firedJoins, join.id] : run.firedJoins,
        },
        fired,
    };
}

function recordEmit(run: QaapWorkflowRun, bindingKey: string, bindingRef?: string): QaapWorkflowRun {
    return { ...run, bindings: { ...run.bindings, [bindingKey]: bindingRef ?? bindingKey } };
}

function hasPendingJoin(run: QaapWorkflowRun): boolean {
    return Object.keys(run.joinArrivals).some(id => !run.firedJoins.includes(id));
}

function isHumanGate(node: QaapWorkflowNode | undefined): boolean {
    return node?.kind === 'human-gate';
}

function terminate(
    run: QaapWorkflowRun,
    status: QaapWorkflowRunStatus,
    reason: QaapWorkflowTerminationReason,
): QaapWorkflowRun {
    return { ...run, status, active: [], terminationReason: reason };
}
