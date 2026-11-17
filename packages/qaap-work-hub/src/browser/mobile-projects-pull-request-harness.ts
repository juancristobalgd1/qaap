// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

/** Pull request reference shared by GitHub summaries and the pull requests recorded on a task. */
export interface MobileProjectsPullRequestHarnessRef {
    readonly owner: string;
    readonly repo: string;
    readonly number?: number;
    /** GitHub web URL (`https://github.com/<owner>/<repo>/pull/<number>`), used when `number` is missing. */
    readonly url?: string;
}

/** Summary fields read to attribute a pull request to the harness that ran the task. */
export type MobileProjectsPullRequestHarnessSummary = Pick<
    QaapAgentConversationSummaryDTO,
    'agentId' | 'lastTurnAgentId' | 'updatedAt' | 'taskPullRequest' | 'linkedPullRequest'
>;

/** Harness agent id per pull request key (see {@link mobileProjectsPullRequestHarnessKey}). */
export type MobileProjectsPullRequestHarnessIndex = ReadonlyMap<string, string>;

const GITHUB_PULL_REQUEST_URL = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i;

/** Case-insensitive `owner/repo#number` key, or `undefined` when the number cannot be resolved. */
export function mobileProjectsPullRequestHarnessKey(ref: MobileProjectsPullRequestHarnessRef): string | undefined {
    let owner = ref.owner?.trim();
    let repo = ref.repo?.trim();
    let number = ref.number;
    if ((number === undefined || !Number.isFinite(number)) && ref.url) {
        const match = GITHUB_PULL_REQUEST_URL.exec(ref.url);
        if (match) {
            owner = owner || match[1];
            repo = repo || match[2];
            number = Number(match[3]);
        }
    }
    if (!owner || !repo || number === undefined || !Number.isFinite(number)) {
        return undefined;
    }
    return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

/**
 * Maps each pull request opened (`taskPullRequest`) or linked (`linkedPullRequest`) by a Qaap task to
 * the harness that ran it: `lastTurnAgentId`, else `agentId`. When several conversations claim the same
 * pull request, the one that opened it beats one that only links it, then the most recently updated wins.
 */
export function indexMobileProjectsPullRequestHarnesses(
    summaries: readonly MobileProjectsPullRequestHarnessSummary[],
): MobileProjectsPullRequestHarnessIndex {
    const best = new Map<string, { agentId: string; rank: number; updatedAt: number }>();
    const consider = (ref: MobileProjectsPullRequestHarnessRef | undefined, rank: number, summary: MobileProjectsPullRequestHarnessSummary): void => {
        const agentId = summary.lastTurnAgentId?.trim() || summary.agentId?.trim();
        const key = ref && agentId ? mobileProjectsPullRequestHarnessKey(ref) : undefined;
        if (!key || !agentId) {
            return;
        }
        const updatedAt = Number.isFinite(summary.updatedAt) ? summary.updatedAt : 0;
        const current = best.get(key);
        if (!current || rank > current.rank || (rank === current.rank && updatedAt > current.updatedAt)) {
            best.set(key, { agentId, rank, updatedAt });
        }
    };
    for (const summary of summaries) {
        consider(summary.taskPullRequest, 2, summary);
        consider(summary.linkedPullRequest, 1, summary);
    }
    const index = new Map<string, string>();
    for (const [key, entry] of best) {
        index.set(key, entry.agentId);
    }
    return index;
}

/** Harness agent id of the task that made this pull request, if any. */
export function resolveMobileProjectsPullRequestHarness(
    index: MobileProjectsPullRequestHarnessIndex,
    pullRequest: MobileProjectsPullRequestHarnessRef,
): string | undefined {
    const key = mobileProjectsPullRequestHarnessKey(pullRequest);
    return key ? index.get(key) : undefined;
}
