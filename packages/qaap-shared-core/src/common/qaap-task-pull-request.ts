// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The pull request the backend opened for a conversation's task (`refs/heads/qaap/task/<id>`), kept
 * on the conversation so later turns push to the same branch and rewrite the same evidence section.
 */
export interface QaapTaskPullRequest {
    readonly owner: string;
    readonly repo: string;
    /** Set once the pull request exists; absent while only a failure has been recorded. */
    readonly number?: number;
    readonly url?: string;
    /** GraphQL node id, used to flip the draft state. */
    readonly nodeId?: string;
    /** Head branch name (`qaap/task/<conversationId>`). */
    readonly branch: string;
    readonly baseBranch?: string;
    /** Commit the branch was cut from (diffstat base). */
    readonly baseSha?: string;
    /** Last commit pushed to {@link branch}. */
    readonly headSha?: string;
    /**
     * - `open`: the PR is green and up to date.
     * - `draft-needs-attention`: red verification/review, blocked turn or conflict; lands in "Needs you".
     * - `awaiting-consent`: the work is ready but the owner has not yet allowed Qaap to open pull requests
     *   on this repository (one-time consent per user and repository); nothing was pushed.
     * - `needs-sign-in`: no usable GitHub token for the owner (sign in again); nothing was pushed.
     */
    readonly state: QaapTaskPullRequestState;
    /** Last user message whose turn is already part of {@link headSha}. */
    readonly lastUserMessageId?: string;
    /** Last commit pushed to `refs/qaap/evidence/<conversationId>`. */
    readonly evidenceSha?: string;
    /** Evidence ids (screenshots) contained in {@link evidenceSha}. */
    readonly evidenceIds?: readonly string[];
    /** Repository visibility as GitHub reported it when the PR was opened. */
    readonly repoPrivate?: boolean;
    /** Why the last attempt did not produce an up-to-date pull request. */
    readonly lastError?: string;
    /** Newest checkpoint-restore (`restoredFrom` snapshot) already reflected in the branch. */
    readonly restoreSeenAt?: number;
    /** Set when the branch was rebuilt from its base after a rewind or a checkpoint restore. */
    readonly rebuiltAt?: number;
    /** What happened the last time the remote branch had moved under us. */
    readonly divergence?: QaapTaskPullRequestDivergence;
    readonly updatedAt: number;
}

export type QaapTaskPullRequestState = 'open' | 'draft-needs-attention' | 'awaiting-consent' | 'needs-sign-in';

/** Someone else pushed to the task branch: either we built on their commit, or we moved to a new branch. */
export interface QaapTaskPullRequestDivergence {
    readonly at: number;
    /** The foreign remote head we found. */
    readonly remoteSha: string;
    readonly resolution: 'built-on-remote' | 'new-branch';
    /** For `new-branch`: the branch and PR we left behind. */
    readonly previousBranch?: string;
    readonly previousNumber?: number;
}

/** POST body of `/agent-conversations/:id/task-pull-request/consent`. */
export interface QaapTaskPullRequestConsentRequest {
    /** `true`: allow Qaap to open PRs on this repository from now on. `false` ("Not now"): turn it off for this conversation. */
    readonly allow: boolean;
}

/** True when the task pull request needs the human: red, awaiting consent, sign-in, or a failed update. */
export function taskPullRequestNeedsAttention(pr: QaapTaskPullRequest | undefined): boolean {
    return !!pr && (pr.state !== 'open' || !!pr.lastError);
}

/** True when the work is ready and only the owner's one-time consent for the repository is missing. */
export function taskPullRequestAwaitsConsent(pr: QaapTaskPullRequest | undefined): boolean {
    return pr?.state === 'awaiting-consent';
}
