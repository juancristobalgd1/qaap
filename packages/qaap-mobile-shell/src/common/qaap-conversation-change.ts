// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';

/** Summary fields that may change on a live conversation tick. */
export type QaapConversationSummaryField =
    | 'status'
    | 'title'
    | 'updatedAt'
    | 'messageCount'
    | 'lastMessagePreview'
    | 'lastMessageRole'
    | 'turnProgress'
    | 'priority'
    | 'paused'
    | 'contextUsage'
    | 'linesChanged'
    | 'linkedPullRequest'
    | 'activityLabel'
    | 'autoApprove'
    | 'agentModel'
    | 'approvalPolicyId';

export type QaapConversationChangeKind =
    | 'snapshot'
    | 'created'
    | 'updated'
    | 'deleted'
    | 'message'
    | 'message_delta'
    | 'document_loaded';

/** Typed change notification for selective Work Hub / transcript refresh. */
export interface QaapConversationChangeEvent {
    readonly kind: QaapConversationChangeKind;
    readonly conversationId?: string;
    readonly cwd?: string;
    readonly changedFields?: readonly QaapConversationSummaryField[];
    /** When true, cwd bucket sort order may have changed (streaming, priority). */
    readonly listOrderChanged?: boolean;
}

const SUMMARY_FIELD_KEYS: readonly (keyof QaapAgentConversationSummaryDTO)[] = [
    'status',
    'title',
    'updatedAt',
    'messageCount',
    'lastMessagePreview',
    'lastMessageRole',
    'priority',
    'paused',
    'contextUsage',
    'linesAdded',
    'linesRemoved',
    'linkedPullRequest',
    'activityLabel',
    'autoApprove',
    'agentModel',
    'approvalPolicyId',
    'turnProgressCurrent',
    'turnProgressTotal',
];

function fieldFromSummaryKey(key: keyof QaapAgentConversationSummaryDTO): QaapConversationSummaryField | undefined {
    switch (key) {
        case 'linesAdded':
        case 'linesRemoved':
            return 'linesChanged';
        case 'turnProgressCurrent':
        case 'turnProgressTotal':
            return 'turnProgress';
        default:
            return key as QaapConversationSummaryField;
    }
}

/** Diff two summary rows — used to skip full hub rebuilds during streaming preview ticks. */
export function computeSummaryChangedFields(
    previous: QaapAgentConversationSummaryDTO | undefined,
    next: QaapAgentConversationSummaryDTO,
): readonly QaapConversationSummaryField[] {
    if (!previous) {
        return SUMMARY_FIELD_KEYS
            .map(fieldFromSummaryKey)
            .filter((field): field is QaapConversationSummaryField => field !== undefined);
    }
    const changed = new Set<QaapConversationSummaryField>();
    for (const key of SUMMARY_FIELD_KEYS) {
        const prevValue = previous[key];
        const nextValue = next[key];
        if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
            const field = fieldFromSummaryKey(key);
            if (field) {
                changed.add(field);
            }
        }
    }
    return [...changed];
}

/** True when only volatile preview/progress fields changed — safe to patch chrome in-place. */
export function isPreviewOnlySummaryChange(fields: readonly QaapConversationSummaryField[]): boolean {
    if (fields.length === 0) {
        return true;
    }
    return fields.every(field =>
        field === 'lastMessagePreview'
        || field === 'updatedAt'
        || field === 'turnProgress'
        || field === 'contextUsage'
        || field === 'activityLabel',
    );
}

/** True for SSE preview ticks that should not rebuild hub/sidebar structure. */
export function isPreviewOnlyConversationChange(change: QaapConversationChangeEvent): boolean {
    return change.kind === 'message_delta'
        && !!change.changedFields
        && isPreviewOnlySummaryChange(change.changedFields)
        && !change.listOrderChanged;
}

export function streamingSortOrderMayChange(
    previous: QaapAgentConversationSummaryDTO | undefined,
    next: QaapAgentConversationSummaryDTO,
): boolean {
    if (!previous) {
        return true;
    }
    if (previous.status !== next.status) {
        return true;
    }
    if (!!previous.priority !== !!next.priority || !!previous.paused !== !!next.paused) {
        return true;
    }
    return false;
}
