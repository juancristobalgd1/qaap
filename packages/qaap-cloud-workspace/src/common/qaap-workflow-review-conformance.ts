// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Bridges the existing adversarial-review decision onto the workflow graph (ADR-001, Next #2).
 *
 * The live review path in {@code QaapAgentTaskRunner.reviewTaskChanges} decides, for a `high-risk`
 * QAAP_AGENT_REVIEW mode: skip a low-risk diff, else run the reviewer and map its verdict to
 * passed / failed / inconclusive. This module expresses the same decision as workflow outcomes,
 * reusing the very helpers the runner uses ({@link resolveTaskReviewRisk},
 * {@link parseAgentReviewVerdict}), so the eventual swap of the runner onto the planner is a
 * behaviour-preserving change proven by {@code qaap-workflow-review-conformance.spec.ts}, not a
 * rewrite that silently drifts.
 */

import { parseAgentReviewVerdict, QaapReviewChangedFile, resolveTaskReviewRisk } from './qaap-agent-review';
import { QaapWorkflowNodeOutcome, QaapWorkflowReviewMode } from './qaap-workflow-ir';

/** The four terminal states the review flow can reach, named as in {@link QaapAgentTaskReview}. */
export type QaapReviewDecision = 'skipped' | 'passed' | 'failed' | 'inconclusive';

/** Binding key emitted by the implement-then-review template for each decision. */
export const REVIEW_DECISION_BINDING: Readonly<Record<QaapReviewDecision, string>> = {
    skipped: 'review.skipped',
    passed: 'review.passed',
    failed: 'review.failed',
    inconclusive: 'review.inconclusive',
};

/**
 * The runner's own decision for a finished, edited task. Mirrors the branch order in
 * {@code reviewTaskChanges}: `off` never reviews; `high-risk` skips a low-risk diff; otherwise the
 * verdict decides, and a missing verdict is inconclusive (fail-open), never a pass.
 */
export function runnerReviewDecision(
    changedFiles: readonly QaapReviewChangedFile[],
    reviewerOutput: string | undefined,
    mode: QaapWorkflowReviewMode = 'high-risk',
): QaapReviewDecision {
    if (mode === 'off') {
        return 'skipped';
    }
    if (mode === 'high-risk' && resolveTaskReviewRisk(changedFiles) === 'low') {
        return 'skipped';
    }
    const verdict = parseAgentReviewVerdict(reviewerOutput);
    if (!verdict) {
        return 'inconclusive';
    }
    return verdict.status;
}

/** The risk-classify node's outcome for the same inputs. */
export function riskOutcome(changedFiles: readonly QaapReviewChangedFile[]): QaapWorkflowNodeOutcome {
    return resolveTaskReviewRisk(changedFiles) === 'high' ? 'risk:high' : 'risk:low';
}

/** The judge node's outcome for the same reviewer output. */
export function judgeOutcome(reviewerOutput: string | undefined): QaapWorkflowNodeOutcome {
    const verdict = parseAgentReviewVerdict(reviewerOutput);
    if (!verdict) {
        return 'verdict:inconclusive';
    }
    return verdict.status === 'passed' ? 'verdict:pass' : 'verdict:fail';
}
