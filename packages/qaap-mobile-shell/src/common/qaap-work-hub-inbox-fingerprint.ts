// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

export interface WorkHubInboxRowFingerprintInput {
    readonly rowKey: string;
    readonly status: string;
    readonly title: string;
    readonly updatedAt: number;
    readonly messageCount: number;
    readonly turnProgressCurrent?: number;
    readonly turnProgressTotal?: number;
    readonly priority?: boolean;
    readonly paused?: boolean;
    readonly linkedPullRequestNumber?: number;
    readonly agentId?: string;
    readonly unread?: boolean;
    readonly visualStatusId: string;
    readonly isCurrent?: boolean;
}

export interface WorkHubInboxProjectGroupFingerprintInput {
    readonly projectId: string;
    readonly itemCount: number;
    readonly rows: ReadonlyArray<{ readonly rowKey: string }>;
    readonly variantRunIds: ReadonlyArray<string>;
}

export interface WorkHubInboxStructureFingerprintInput {
    readonly hubKind: string;
    readonly query: string;
    readonly groups: ReadonlyArray<WorkHubInboxProjectGroupFingerprintInput>;
    readonly emptyState?: string;
    readonly loading?: boolean;
    readonly teamEmbedded?: boolean;
}

/** Compact per-row fingerprint — only fields that affect inbox row DOM. */
export function buildWorkHubInboxRowFingerprint(input: WorkHubInboxRowFingerprintInput): string {
    return [
        input.rowKey,
        input.status,
        input.updatedAt,
        input.messageCount,
        input.turnProgressCurrent ?? '',
        input.turnProgressTotal ?? '',
        input.priority ? 1 : 0,
        input.paused ? 1 : 0,
        input.linkedPullRequestNumber ?? '',
        input.agentId ?? '',
        input.unread ? 1 : 0,
        input.visualStatusId,
        input.isCurrent ? 1 : 0,
        input.title,
    ].join(':');
}

export function buildWorkHubInboxRowFingerprintFromSummary(
    summary: QaapAgentConversationSummaryDTO,
    options: {
        readonly rowKey: string;
        readonly visualStatusId: string;
        readonly unread?: boolean;
        readonly isCurrent?: boolean;
    },
): string {
    return buildWorkHubInboxRowFingerprint({
        rowKey: options.rowKey,
        status: summary.status,
        title: summary.title,
        updatedAt: summary.updatedAt,
        messageCount: summary.messageCount,
        turnProgressCurrent: summary.turnProgressCurrent,
        turnProgressTotal: summary.turnProgressTotal,
        priority: summary.priority,
        paused: summary.paused,
        linkedPullRequestNumber: summary.linkedPullRequest?.number,
        agentId: summary.agentId,
        unread: options.unread,
        visualStatusId: options.visualStatusId,
        isCurrent: options.isCurrent,
    });
}

export function buildWorkHubInboxStructureFingerprint(input: WorkHubInboxStructureFingerprintInput): string {
    const parts: string[] = [
        `k:${input.hubKind}`,
        `q:${input.query}`,
        `e:${input.emptyState ?? ''}`,
        `l:${input.loading ? 1 : 0}`,
        `t:${input.teamEmbedded ? 1 : 0}`,
    ];
    const groups = [...input.groups].sort((left, right) => left.projectId.localeCompare(right.projectId));
    for (const group of groups) {
        parts.push(`p:${group.projectId}:${group.itemCount}`);
        for (const row of group.rows) {
            parts.push(`r:${row.rowKey}`);
        }
        const variantRuns = [...group.variantRunIds].sort();
        for (const runId of variantRuns) {
            parts.push(`v:${runId}`);
        }
    }
    return parts.join('|');
}
