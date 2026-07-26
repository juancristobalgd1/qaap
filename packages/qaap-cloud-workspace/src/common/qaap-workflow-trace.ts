// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * What a run actually did, node by node (ADR-001).
 *
 * The graph state says WHERE a run ended; it never said WHY. Diagnosing the audit's runs meant
 * reading `~/.qaap/workflow-runs/index.json` and agent logs by hand — which is not something a
 * product may ask of the person whose task just failed, and is also the missing precondition for
 * any UI over these runs.
 *
 * Entries are generated, never raw: a step's detail is a short phrase this module composes from the
 * step's own result, so repository output (a failing test's stderr, say, which may print secrets)
 * never travels out through the API.
 */

import { QaapWorkflowNode, QaapWorkflowNodeOutcome } from './qaap-workflow-ir';

/** Longest generated detail; entries are a diagnosis, not a log. */
const MAX_DETAIL_CHARS = 160;
/** Oldest entries are dropped past this, so one looping run cannot grow the shared index forever. */
export const MAX_QAAP_WORKFLOW_TRACE_ENTRIES = 200;

export interface QaapWorkflowTraceEntry {
    readonly nodeId: string;
    readonly kind: QaapWorkflowNode['kind'];
    readonly outcome: QaapWorkflowNodeOutcome;
    /** When the node was dispatched; absent for nodes the graph settles itself (joins). */
    readonly startedAt?: number;
    readonly finishedAt: number;
    readonly durationMs?: number;
    /** Backend that ran it, for an agent turn. */
    readonly agentRef?: string;
    /** Agent task id or job id, so a client can open the underlying log. */
    readonly externalId?: string;
    /** Short generated phrase: why this step ended the way it did. */
    readonly detail?: string;
}

/** A deterministic step's result, as far as the trace cares. */
interface DeterministicResultShape {
    readonly failedScript?: unknown;
    readonly scripts?: unknown;
    readonly files?: unknown;
    readonly truncated?: unknown;
}

/**
 * One line explaining a finished step, composed from what the step itself reported. Returns
 * undefined when the outcome already says everything (a plain `success` on an agent turn).
 */
export function describeQaapWorkflowStep(
    node: QaapWorkflowNode | undefined,
    outcome: QaapWorkflowNodeOutcome,
    result?: unknown,
): string | undefined {
    if (node?.kind === 'deterministic') {
        return cap(describeDeterministic(node.op, outcome, result as DeterministicResultShape | undefined));
    }
    if (node?.kind === 'agent-turn') {
        return cap(describeAgentTurn(outcome));
    }
    if (node?.kind === 'human-gate' && outcome === 'human:continue') {
        return 'A person approved it.';
    }
    if (node?.kind === 'join') {
        return 'Every branch it waits for arrived.';
    }
    return undefined;
}

function describeDeterministic(
    op: string,
    outcome: QaapWorkflowNodeOutcome,
    result: DeterministicResultShape | undefined,
): string | undefined {
    if (op === 'verify') {
        if (typeof result?.failedScript === 'string') {
            return `\`npm run ${result.failedScript}\` failed.`;
        }
        const scripts = Array.isArray(result?.scripts) ? result.scripts.filter(entry => typeof entry === 'string') : [];
        return scripts.length > 0 ? `Passed: ${scripts.join(', ')}.` : 'Nothing to verify in this workspace.';
    }
    if (op === 'risk-classify') {
        const files = Array.isArray(result?.files) ? result.files.length : 0;
        const risk = outcome === 'risk:high' ? 'High risk' : 'Low risk';
        return `${risk}: ${files} file${files === 1 ? '' : 's'} changed since the run started.`;
    }
    if (op === 'git-diff') {
        return outcome === 'success'
            ? `Captured the change${result?.truncated === true ? ' (truncated)' : ''}.`
            : 'Could not capture the change.';
    }
    return undefined;
}

function describeAgentTurn(outcome: QaapWorkflowNodeOutcome): string | undefined {
    switch (outcome) {
        case 'verdict:pass':
            return 'The reviewer passed the change.';
        case 'verdict:fail':
            return 'The reviewer rejected the change.';
        case 'verdict:inconclusive':
            // The single most confusing outcome to see without an explanation.
            return 'The reviewer produced no verdict, so the change was not cleared.';
        case 'blocked':
            return 'The turn stopped and asked for input.';
        case 'fail':
            return 'The turn did not complete its work.';
        default:
            return undefined;
    }
}

function cap(detail: string | undefined): string | undefined {
    if (!detail) {
        return undefined;
    }
    const normalized = detail.replace(/\s+/g, ' ').trim();
    return normalized.length > MAX_DETAIL_CHARS ? `${normalized.slice(0, MAX_DETAIL_CHARS)}…` : normalized;
}

/** Append an entry, keeping only the most recent {@link MAX_QAAP_WORKFLOW_TRACE_ENTRIES}. */
export function appendQaapWorkflowTrace(
    trace: readonly QaapWorkflowTraceEntry[],
    entry: QaapWorkflowTraceEntry,
): readonly QaapWorkflowTraceEntry[] {
    const next = [...trace, entry];
    return next.length > MAX_QAAP_WORKFLOW_TRACE_ENTRIES
        ? next.slice(next.length - MAX_QAAP_WORKFLOW_TRACE_ENTRIES)
        : next;
}
