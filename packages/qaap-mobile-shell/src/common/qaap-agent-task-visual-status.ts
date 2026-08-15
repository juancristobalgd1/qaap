// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapSidebarGitActionKind } from './qaap-agent-conversation-list-metrics';
import { isFailedRunSummary, type QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

export type QaapAgentTaskVisualStatusId =
    | 'idle'
    | 'queued'
    | 'running'
    | 'needs-you'
    | 'failed'
    | 'pr-ready'
    | 'pr-merged'
    | 'pr-closed'
    | 'pr-draft'
    | 'pr-conflicts'
    | 'checks-failed'
    | 'checks-pending'
    | 'branch'
    | 'committed'
    | 'pushed'
    | 'changes'
    | 'pr-unknown'
    | 'verified'
    | 'warnings'
    | 'background';

export interface QaapAgentTaskVisualStatus {
    readonly id: QaapAgentTaskVisualStatusId;
    readonly labelKey: string;
    readonly label: string;
    readonly className: string;
    readonly iconClass?: string;
    readonly color: string;
    readonly gitPr: boolean;
}

const STATUS_BY_ID: Record<QaapAgentTaskVisualStatusId, QaapAgentTaskVisualStatus> = {
    'idle': {
        id: 'idle',
        labelKey: 'qaap/mobileProjects/taskStateIdle',
        label: 'idle',
        className: 'theia-mod-idle',
        color: 'var(--theia-descriptionForeground)',
        gitPr: false,
    },
    'queued': {
        id: 'queued',
        labelKey: 'qaap/mobileProjects/taskStateQueued',
        label: 'queued',
        className: 'theia-mod-queued',
        iconClass: 'codicon-clock',
        color: 'var(--theia-descriptionForeground)',
        gitPr: false,
    },
    'running': {
        id: 'running',
        labelKey: 'qaap/mobileProjects/taskStateRunning',
        label: 'running',
        className: 'theia-mod-running',
        color: 'var(--theia-charts-green, #4caf7c)',
        gitPr: false,
    },
    'needs-you': {
        id: 'needs-you',
        labelKey: 'qaap/mobileProjects/taskStateNeedsInput',
        label: 'needs you',
        className: 'theia-mod-needs-input',
        iconClass: 'codicon-warning',
        color: 'var(--theia-notificationsWarningIcon-foreground, #cca700)',
        gitPr: false,
    },
    'failed': {
        id: 'failed',
        labelKey: 'qaap/mobileProjects/taskStateFailed',
        label: 'failed',
        className: 'theia-mod-failed',
        iconClass: 'codicon-error',
        color: 'var(--theia-errorForeground, #f14c4c)',
        gitPr: false,
    },
    'pr-ready': {
        id: 'pr-ready',
        labelKey: 'qaap/mobileProjects/taskStatePrReady',
        label: 'PR ready',
        className: 'theia-mod-pr-ready',
        iconClass: 'codicon-git-pull-request',
        color: 'var(--theia-gitDecoration-addedResourceForeground, #2da44e)',
        gitPr: true,
    },
    'pr-merged': {
        id: 'pr-merged',
        labelKey: 'qaap/mobileProjects/taskStatePrMerged',
        label: 'PR merged',
        className: 'theia-mod-pr-merged',
        iconClass: 'codicon-git-merge',
        color: 'var(--theia-charts-purple, #a371f7)',
        gitPr: true,
    },
    'pr-closed': {
        id: 'pr-closed',
        labelKey: 'qaap/mobileProjects/taskStatePrClosed',
        label: 'PR closed',
        className: 'theia-mod-pr-closed',
        iconClass: 'codicon-git-pull-request-closed',
        color: 'var(--theia-errorForeground, #f85149)',
        gitPr: true,
    },
    'pr-draft': {
        id: 'pr-draft',
        labelKey: 'qaap/mobileProjects/taskStatePrDraft',
        label: 'Draft',
        className: 'theia-mod-pr-draft',
        iconClass: 'codicon-git-pull-request-draft',
        color: 'var(--theia-descriptionForeground)',
        gitPr: true,
    },
    'pr-conflicts': {
        id: 'pr-conflicts',
        labelKey: 'qaap/mobileProjects/taskStatePrConflicts',
        label: 'Conflicts',
        className: 'theia-mod-pr-conflicts',
        iconClass: 'codicon-warning',
        color: 'var(--theia-errorForeground, #f85149)',
        gitPr: true,
    },
    'checks-failed': {
        id: 'checks-failed',
        labelKey: 'qaap/mobileProjects/taskStateChecksFailed',
        label: 'Checks failed',
        className: 'theia-mod-checks-failed',
        iconClass: 'codicon-error',
        color: 'var(--theia-errorForeground, #f85149)',
        gitPr: true,
    },
    'checks-pending': {
        id: 'checks-pending',
        labelKey: 'qaap/mobileProjects/taskStateChecksPending',
        label: 'Checks pending',
        className: 'theia-mod-checks-pending',
        iconClass: 'codicon-clock',
        color: 'var(--theia-notificationsWarningIcon-foreground, #bf8700)',
        gitPr: true,
    },
    'branch': {
        id: 'branch',
        labelKey: 'qaap/mobileProjects/taskStateBranch',
        label: 'Branch',
        className: 'theia-mod-branch',
        iconClass: 'codicon-git-branch',
        color: 'var(--theia-gitDecoration-untrackedResourceForeground, #73c991)',
        gitPr: true,
    },
    'committed': {
        id: 'committed',
        labelKey: 'qaap/mobileProjects/taskStateCommitted',
        label: 'Committed',
        className: 'theia-mod-committed',
        iconClass: 'codicon-git-commit',
        color: 'var(--theia-gitDecoration-modifiedResourceForeground, #e2c08d)',
        gitPr: true,
    },
    'pushed': {
        id: 'pushed',
        labelKey: 'qaap/mobileProjects/taskStatePushed',
        label: 'Pushed',
        className: 'theia-mod-pushed',
        iconClass: 'codicon-repo-push',
        color: 'var(--theia-gitDecoration-addedResourceForeground, #2da44e)',
        gitPr: true,
    },
    'changes': {
        id: 'changes',
        labelKey: 'qaap/mobileProjects/taskStateChanges',
        label: 'Changes',
        className: 'theia-mod-changes',
        iconClass: 'codicon-diff-modified',
        color: 'var(--theia-notificationsWarningIcon-foreground, #bf8700)',
        gitPr: true,
    },
    'pr-unknown': {
        id: 'pr-unknown',
        labelKey: 'qaap/mobileProjects/taskStatePrUnknown',
        label: 'PR',
        className: 'theia-mod-pr-unknown',
        iconClass: 'codicon-git-pull-request',
        color: 'var(--theia-descriptionForeground)',
        gitPr: true,
    },
    'warnings': {
        id: 'warnings',
        labelKey: 'qaap/mobileProjects/taskStateWarnings',
        label: 'checks failing',
        className: 'theia-mod-warnings',
        iconClass: 'codicon-warning',
        color: 'var(--theia-notificationsWarningIcon-foreground, #cca700)',
        gitPr: false,
    },
    'verified': {
        id: 'verified',
        labelKey: 'qaap/mobileProjects/taskStateVerified',
        label: 'verified',
        className: 'theia-mod-verified',
        iconClass: 'codicon-pass',
        color: 'var(--theia-charts-green, #4caf7c)',
        gitPr: false,
    },
    'background': {
        id: 'background',
        labelKey: 'qaap/mobileProjects/taskStateBackground',
        label: 'finishing',
        className: 'theia-mod-background',
        iconClass: 'codicon-sync',
        color: 'var(--theia-descriptionForeground)',
        gitPr: false,
    },
};

/** Core sidebar glyphs shown in the sessions status legend (agent + git actions, not every PR edge-case). */
const LEGEND_STATUS_IDS: readonly QaapAgentTaskVisualStatusId[] = [
    'idle',
    'queued',
    'running',
    'needs-you',
    'failed',
    'background',
    'verified',
    'warnings',
    'branch',
    'changes',
    'committed',
    'pushed',
    'pr-ready',
    'pr-merged',
    'pr-closed',
    'pr-draft',
];

export function listQaapAgentTaskVisualStatusLegendEntries(): readonly QaapAgentTaskVisualStatus[] {
    return LEGEND_STATUS_IDS.map(id => STATUS_BY_ID[id]);
}

export function getQaapAgentTaskVisualStatusById(id: QaapAgentTaskVisualStatusId): QaapAgentTaskVisualStatus {
    return STATUS_BY_ID[id];
}

export interface QaapGitPrStatusInput {
    readonly linkedPullRequest?: QaapAgentConversationSummaryDTO['linkedPullRequest'];
    readonly hasGitOperation?: boolean;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly lastGitActionKind?: QaapSidebarGitActionKind;
    readonly worktreeBranch?: string;
}

/**
 * Resolve Git/PR sidebar glyphs. Pull-request lifecycle wins; otherwise map branch /
 * commit / push / local changes so rows are not limited to the PR icon.
 */
export function resolveQaapGitPrVisualStatus(
    summary: QaapGitPrStatusInput,
): QaapAgentTaskVisualStatus | undefined {
    const pullRequest = summary.linkedPullRequest;
    if (pullRequest) {
        if (pullRequest.state === 'merged') {
            return STATUS_BY_ID['pr-merged'];
        }
        if (pullRequest.state === 'closed') {
            return STATUS_BY_ID['pr-closed'];
        }
        if (pullRequest.draft) {
            return STATUS_BY_ID['pr-draft'];
        }
        if (pullRequest.mergeable === false) {
            return STATUS_BY_ID['pr-conflicts'];
        }
        if (pullRequest.tests === 'failing') {
            return STATUS_BY_ID['checks-failed'];
        }
        if (pullRequest.tests === 'pending') {
            return STATUS_BY_ID['checks-pending'];
        }
        if (pullRequest.state === 'open') {
            return STATUS_BY_ID['pr-ready'];
        }
        if (pullRequest.number) {
            return STATUS_BY_ID['pr-unknown'];
        }
    }
    const actionKind = summary.lastGitActionKind;
    if (actionKind === 'push') {
        return STATUS_BY_ID['pushed'];
    }
    if (actionKind === 'commit') {
        return STATUS_BY_ID['committed'];
    }
    if (
        actionKind === 'branch'
        || !!pullRequest?.branch?.trim()
        || !!summary.worktreeBranch?.trim()
    ) {
        return STATUS_BY_ID['branch'];
    }
    if (
        actionKind === 'changes'
        || (summary.linesAdded ?? 0) > 0
        || (summary.linesRemoved ?? 0) > 0
    ) {
        return STATUS_BY_ID['changes'];
    }
    if (summary.hasGitOperation) {
        // Generic git CLI without a more specific verb — show branch, not PR.
        return STATUS_BY_ID['branch'];
    }
    return undefined;
}

export function resolveQaapAgentTaskVisualStatus(
    task: { readonly state: string },
    summary?: Pick<QaapAgentConversationSummaryDTO,
        | 'status'
        | 'priority'
        | 'lastMessageRole'
        | 'messageCount'
        | 'linkedPullRequest'
        | 'lastMessagePreview'
        | 'hasGitOperation'
        | 'lastGitActionKind'
        | 'worktreeBranch'
        | 'linesAdded'
        | 'linesRemoved'>,
    unread = false,
): QaapAgentTaskVisualStatus {
    const state = task.state;
    // isFailedRunSummary also catches turns the agent self-reported as stopped/failed while
    // exiting cleanly — those would otherwise fall through to the generic "needs-you" bucket below
    // (unread + last message from the agent) and paint the same glyph as an ordinary unread reply.
    if (state === 'failed' || state === 'interrupted' || (summary && isFailedRunSummary(summary))) {
        return STATUS_BY_ID['failed'];
    }
    // The agent explicitly asked for the user — highest urgency after failure.
    if (state === 'blocked') {
        return STATUS_BY_ID['needs-you'];
    }
    // Checked before the Git/PR resolution below: a task with red local verification almost
    // always has uncommitted changes, and the generic 'changes' chip would mask the warning.
    if (state === 'completed_with_warnings') {
        return STATUS_BY_ID['warnings'];
    }
    if (state === 'queued') {
        return STATUS_BY_ID['queued'];
    }
    if (state === 'running' || summary?.status === 'streaming') {
        return STATUS_BY_ID['running'];
    }
    if (summary?.status === 'settled') {
        return STATUS_BY_ID['background'];
    }
    if (
        state === 'needs-input'
        || summary?.priority
        || (unread && summary?.lastMessageRole === 'agent' && (summary.messageCount ?? 0) > 0)
    ) {
        return STATUS_BY_ID['needs-you'];
    }
    if (summary) {
        const gitPrStatus = resolveQaapGitPrVisualStatus(summary);
        if (gitPrStatus) {
            return gitPrStatus;
        }
    }
    if (state === 'completed' || state === 'verified' || state === 'ok') {
        return STATUS_BY_ID['verified'];
    }
    return STATUS_BY_ID['idle'];
}

