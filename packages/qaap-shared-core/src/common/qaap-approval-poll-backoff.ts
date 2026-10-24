// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Delay before the first approval poll while the transcript is visible and the pending list is changing. */
export const APPROVAL_POLL_BASE_MS = 1_500;
/** Ceiling for the poll delay while the pending approval list stays unchanged. */
export const APPROVAL_POLL_IDLE_MAX_MS = 5_000;
/** Ceiling for the poll delay after consecutive failed polls. */
export const APPROVAL_POLL_ERROR_MAX_MS = 30_000;
/** Hidden tabs do not fetch; the timer only re-checks visibility this often (no network). */
export const APPROVAL_POLL_HIDDEN_CHECK_MS = 5_000;

export interface ApprovalPollState {
    /** Consecutive successful polls that returned the same pending approvals. */
    readonly idlePolls: number;
    /** Consecutive failed polls. */
    readonly failures: number;
}

export const INITIAL_APPROVAL_POLL_STATE: ApprovalPollState = { idlePolls: 0, failures: 0 };

/**
 * Delay until the next poll: exponential backoff on errors, then on unchanged results, capped per
 * case. A hidden document only schedules a cheap visibility re-check, never a request.
 */
export function nextApprovalPollDelayMs(state: ApprovalPollState, documentVisible = true): number {
    if (!documentVisible) {
        return APPROVAL_POLL_HIDDEN_CHECK_MS;
    }
    if (state.failures > 0) {
        return Math.min(APPROVAL_POLL_BASE_MS * 2 ** state.failures, APPROVAL_POLL_ERROR_MAX_MS);
    }
    return Math.min(APPROVAL_POLL_BASE_MS * 2 ** state.idlePolls, APPROVAL_POLL_IDLE_MAX_MS);
}

/** Stable identity of a pending approval list, used to detect changes between polls. */
export function approvalListKey(approvals: readonly { readonly id: string }[]): string {
    return approvals.map(approval => approval.id).join('|');
}

/** Advances the poll state after a poll outcome. A change resets back to the fast cadence. */
export function recordApprovalPollOutcome(
    state: ApprovalPollState,
    outcome: 'changed' | 'unchanged' | 'error',
): ApprovalPollState {
    if (outcome === 'error') {
        return { idlePolls: state.idlePolls, failures: state.failures + 1 };
    }
    if (outcome === 'changed') {
        return INITIAL_APPROVAL_POLL_STATE;
    }
    return { idlePolls: state.idlePolls + 1, failures: 0 };
}
