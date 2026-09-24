// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface WorkHubSessionsSidebarConversationFingerprint {
    readonly id: string;
    readonly status: string;
    readonly title: string;
    /** Volatile summary fields are available to callers, but are intentionally ignored by the list fingerprint. */
    readonly updatedAt: number;
    readonly messageCount: number;
    readonly priority?: boolean;
    readonly paused?: boolean;
    readonly turnProgressCurrent?: number;
    readonly turnProgressTotal?: number;
}

export const QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR = 'data-qaap-sessions-sidebar-structure-fp';
export const QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR = 'data-qaap-sessions-sidebar-row-fp';

/** Stable slot for sidebar structure — conversation ids and chrome, not live title/progress text. */
export function buildWorkHubSessionsSidebarStructureSlot(
    conversation: WorkHubSessionsSidebarConversationFingerprint,
    pinned: boolean,
): string {
    return [
        conversation.id,
        conversation.status,
        conversation.priority ? 1 : 0,
        conversation.paused ? 1 : 0,
        pinned ? 1 : 0,
    ].join(':');
}

/** Per-row fingerprint for in-place sidebar row patches during SSE. */
export function buildWorkHubSessionsSidebarRowFingerprint(
    conversation: WorkHubSessionsSidebarConversationFingerprint,
    options: {
        readonly pinned: boolean;
        readonly isCurrent: boolean;
        readonly visualStatusId: string;
    },
): string {
    const title = conversation.status === 'streaming' ? '' : conversation.title;
    const turnCurrent = conversation.status === 'streaming' ? '' : (conversation.turnProgressCurrent ?? '');
    const turnTotal = conversation.status === 'streaming' ? '' : (conversation.turnProgressTotal ?? '');
    return [
        conversation.id,
        conversation.status,
        conversation.priority ? 1 : 0,
        conversation.paused ? 1 : 0,
        options.pinned ? 1 : 0,
        options.isCurrent ? 1 : 0,
        options.visualStatusId,
        turnCurrent,
        turnTotal,
        title,
    ].join(':');
}

export interface WorkHubSessionsSidebarVisibleStructureSlot {
    readonly projectId: string;
    readonly conversation: WorkHubSessionsSidebarConversationFingerprint;
    readonly pinned: boolean;
}

/** Layout fingerprint from visible sidebar slots only (matches rendered DOM). */
export function buildWorkHubSessionsSidebarVisibleStructureFingerprint(
    options: {
        readonly query: string;
        readonly transcriptOpenSummaryId: string | undefined;
        readonly expandedProjectIds: ReadonlySet<string>;
        readonly visibleConversationCountByProjectId: ReadonlyMap<string, number>;
        readonly visibleProjectGroupIds: readonly string[];
        readonly pinnedSectionProjectIds: readonly string[];
        readonly visibleSlots: readonly WorkHubSessionsSidebarVisibleStructureSlot[];
    },
): string {
    const parts: string[] = [
        `q:${options.query}`,
        `o:${options.transcriptOpenSummaryId ?? ''}`,
        `e:${[...options.expandedProjectIds].sort().join(',')}`,
    ];
    const visibleCounts = [...options.visibleConversationCountByProjectId.entries()]
        .sort(([left], [right]) => left.localeCompare(right));
    for (const [projectId, count] of visibleCounts) {
        parts.push(`v:${projectId}=${count}`);
    }
    for (const projectId of options.pinnedSectionProjectIds) {
        parts.push(`ps:${projectId}`);
    }
    for (const projectId of options.visibleProjectGroupIds) {
        parts.push(`pg:${projectId}`);
    }
    for (const slot of options.visibleSlots) {
        parts.push(`c:${buildWorkHubSessionsSidebarStructureSlot(slot.conversation, slot.pinned)}`);
    }
    return parts.join('|');
}

