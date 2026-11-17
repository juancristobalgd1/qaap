// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// DOM-free rules of the right panel's "Pull request" view: which pull request a task or project
// follows, how its checks and review read, and which comments are recent. The DOM lives in
// `qaap-work-hub-aux-pull-request-view.ts`.

import type {
    QaapGithubPullRequestCheck,
    QaapGithubPullRequestSummary,
    QaapGithubPullRequestTimelineEvent,
} from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

/** The pull request the view follows. `number` wins when known; otherwise the head `branch` is looked up. */
export interface QaapWorkHubPullRequestTarget {
    readonly owner: string;
    readonly repo: string;
    readonly number?: number;
    readonly branch?: string;
    /** What the view follows (a task conversation or a project). Switching scope always refetches. */
    readonly scope: string;
}

/** The project fields the target needs (structural, so specs need no full project entry). */
export interface QaapWorkHubPullRequestProjectSource {
    readonly github?: { readonly owner: string; readonly name: string };
    /** The project's current branch. */
    readonly branch?: string;
}

/** A pull request reference recorded on a conversation (opened by Qaap or linked to it). */
export interface QaapWorkHubPullRequestRefSource {
    readonly owner: string;
    readonly repo: string;
    readonly number?: number;
    readonly branch?: string;
}

/** The conversation fields the target needs. */
export interface QaapWorkHubPullRequestTaskSource {
    readonly id: string;
    readonly taskPullRequest?: QaapWorkHubPullRequestRefSource;
    readonly linkedPullRequest?: QaapWorkHubPullRequestRefSource;
}

/**
 * Picks the pull request for the panel. With a task, the reference recorded on it wins (exact number,
 * else its branch); a task without a recorded reference uses its own head branch `qaap/task/<id>` on the
 * project's repository. Without a task, the project's repository and current branch are used.
 */
export function resolveQaapWorkHubPullRequestTarget(
    project: QaapWorkHubPullRequestProjectSource,
    task?: QaapWorkHubPullRequestTaskSource,
): QaapWorkHubPullRequestTarget | undefined {
    if (task) {
        const ref = task.taskPullRequest ?? task.linkedPullRequest;
        const repoOwner = ref?.owner ?? project.github?.owner;
        const repoName = ref?.repo ?? project.github?.name;
        if (!repoOwner || !repoName) {
            return undefined;
        }
        const taskBranch = ref?.branch ?? `qaap/task/${task.id}`;
        return { owner: repoOwner, repo: repoName, number: ref?.number, branch: taskBranch, scope: `task:${task.id}` };
    }
    if (!project.github) {
        return undefined;
    }
    const currentBranch = project.branch?.trim();
    if (!currentBranch) {
        return undefined;
    }
    const { owner, name } = project.github;
    return { owner, repo: name, branch: currentBranch, scope: `project:${owner}/${name}` };
}

/** Identity of a target: a change means the view must refetch. */
export function qaapWorkHubPullRequestTargetKey(target: QaapWorkHubPullRequestTarget): string {
    return `${target.scope}|${target.owner.toLowerCase()}/${target.repo.toLowerCase()}#${target.number ?? ''}@${target.branch ?? ''}`;
}

export interface QaapWorkHubPullRequestChecksSummary {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly pending: number;
    /** Neutral, skipped and stale checks: shown in the total but not as passed or failed. */
    readonly skipped: number;
    /** The checks that failed, in the order GitHub reported them. */
    readonly failedChecks: readonly QaapGithubPullRequestCheck[];
}

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);

/** Counts check runs: `success` passes, failing conclusions fail, anything not completed is pending. */
export function summarizePullRequestChecks(checks: readonly QaapGithubPullRequestCheck[] | undefined): QaapWorkHubPullRequestChecksSummary {
    const list = checks ?? [];
    const failedChecks = list.filter(check => check.status === 'completed' && !!check.conclusion && FAILED_CONCLUSIONS.has(check.conclusion));
    const pending = list.filter(check => check.status !== 'completed').length;
    const passed = list.filter(check => check.status === 'completed' && check.conclusion === 'success').length;
    return {
        total: list.length,
        passed,
        failed: failedChecks.length,
        pending,
        skipped: list.length - passed - failedChecks.length - pending,
        failedChecks,
    };
}

export type QaapWorkHubPullRequestDisplayState = 'open' | 'draft' | 'merged' | 'closed';

/** Open, draft, merged or closed. A summary without a state (search results) reads as open. */
export function pullRequestDisplayState(pr: Pick<QaapGithubPullRequestSummary, 'state' | 'draft'>): QaapWorkHubPullRequestDisplayState {
    if (pr.state === 'merged') {
        return 'merged';
    }
    if (pr.state === 'closed') {
        return 'closed';
    }
    return pr.draft ? 'draft' : 'open';
}

export type QaapWorkHubPullRequestReviewStatus = 'changes-requested' | 'approved' | 'review-requested' | 'commented' | 'none';

/**
 * Review state from the latest review per reviewer: any `changes_requested` wins, then any approval,
 * then people still asked to review, then comments only.
 */
export function summarizePullRequestReview(pr: Pick<QaapGithubPullRequestSummary, 'reviews' | 'requestedReviewers'>): QaapWorkHubPullRequestReviewStatus {
    const states = new Set((pr.reviews ?? []).map(review => review.state));
    if (states.has('changes_requested')) {
        return 'changes-requested';
    }
    if (states.has('approved')) {
        return 'approved';
    }
    if ((pr.requestedReviewers ?? []).length > 0) {
        return 'review-requested';
    }
    return states.has('commented') ? 'commented' : 'none';
}

/** The newest comments and review bodies, newest first. GitHub's timeline is oldest first. */
export function recentPullRequestComments(
    pr: Pick<QaapGithubPullRequestSummary, 'timeline'>,
    limit = 3,
): readonly QaapGithubPullRequestTimelineEvent[] {
    return (pr.timeline ?? [])
        .filter(event => (event.kind === 'commented' || event.kind === 'reviewed') && !!event.text?.trim())
        .slice(-limit)
        .reverse();
}
