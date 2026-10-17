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
    /** `draft-needs-attention`: red verification/review, blocked turn or a failed push; lands in "Needs you". */
    readonly state: 'open' | 'draft-needs-attention';
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
    readonly updatedAt: number;
}

/** True when the conversation's task pull request needs the human (red checks, conflict, failed push). */
export function taskPullRequestNeedsAttention(pr: QaapTaskPullRequest | undefined): boolean {
    return !!pr && (pr.state === 'draft-needs-attention' || !!pr.lastError);
}
