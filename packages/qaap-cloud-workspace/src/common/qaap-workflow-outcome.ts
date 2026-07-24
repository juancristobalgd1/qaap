// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Maps runtime results onto workflow edge outcomes (ADR-001).
 *
 * Pure translation layer: the graph routes on {@link QaapWorkflowNodeOutcome}, the runtimes report
 * their own states, and every mapping decision lives here so it can be tested without spawning.
 */

import { parseAgentReviewVerdict } from './qaap-agent-review';
import { QaapAgentTaskState } from './qaap-agent-task';
import { QaapJobState } from './qaap-job';
import { QaapWorkflowAgentTurnNode, QaapWorkflowNodeOutcome } from './qaap-workflow-ir';

export const QAAP_WORKFLOW_OUTCOMES: readonly QaapWorkflowNodeOutcome[] = [
    'success',
    'fail',
    'blocked',
    'risk:low',
    'risk:high',
    'verdict:pass',
    'verdict:fail',
    'verdict:inconclusive',
    'human:continue',
];

export function isQaapWorkflowOutcome(value: unknown): value is QaapWorkflowNodeOutcome {
    return typeof value === 'string' && (QAAP_WORKFLOW_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Outcome of a finished agent turn.
 *
 * Nodes with `requireSentinel` route on the `@@QAAP:VERDICT@@` marker in the task log; a turn that
 * produced no marker is `verdict:inconclusive` rather than a pass, so a silent reviewer can never
 * wave a change through.
 */
export function resolveAgentTurnOutcome(
    node: QaapWorkflowAgentTurnNode,
    state: QaapAgentTaskState,
    log?: string,
): QaapWorkflowNodeOutcome {
    if (node.requireSentinel) {
        if (state === 'cancelled') {
            return 'blocked';
        }
        if (state === 'failed' || state === 'interrupted') {
            return 'fail';
        }
        const verdict = parseAgentReviewVerdict(log);
        if (!verdict) {
            return 'verdict:inconclusive';
        }
        return verdict.status === 'passed' ? 'verdict:pass' : 'verdict:fail';
    }
    switch (state) {
        case 'completed':
            return 'success';
        // Self-verification was still red after the fix budget: a blocking state by product
        // contract, so the graph gets 'fail' and can route to its own repair branch.
        case 'completed_with_warnings':
            return 'fail';
        case 'blocked':
            return 'blocked';
        case 'failed':
        case 'interrupted':
            return 'fail';
        // A user cancel is not a failure to retry: routing it as 'blocked' stops the branch
        // instead of kicking off repair loops over work the user deliberately stopped.
        case 'cancelled':
            return 'blocked';
        default:
            return 'fail';
    }
}

/**
 * Outcome of a finished deterministic job. A job whose result carries an explicit outcome (a
 * risk classifier returning `risk:high`, for instance) wins over the generic state mapping.
 */
export function resolveDeterministicOutcome(state: QaapJobState, result?: unknown): QaapWorkflowNodeOutcome {
    if (state === 'succeeded') {
        const declared = (result as { readonly outcome?: unknown } | undefined)?.outcome;
        return isQaapWorkflowOutcome(declared) ? declared : 'success';
    }
    return state === 'cancelled' ? 'blocked' : 'fail';
}
