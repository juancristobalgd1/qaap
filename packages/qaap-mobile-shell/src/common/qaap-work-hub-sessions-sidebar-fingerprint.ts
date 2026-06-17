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

export interface WorkHubSessionsSidebarProjectFingerprint {
    readonly id: string;
    readonly isCurrent: boolean;
}

export interface WorkHubSessionsSidebarFingerprintInput {
    readonly query: string;
    readonly transcriptOpenSummaryId: string | undefined;
    readonly expandedProjectIds: ReadonlySet<string>;
    readonly visibleConversationCountByProjectId: ReadonlyMap<string, number>;
    readonly projects: ReadonlyArray<WorkHubSessionsSidebarProjectFingerprint>;
    readonly conversationsForProject: (projectId: string) => ReadonlyArray<WorkHubSessionsSidebarConversationFingerprint>;
    readonly pinnedConversationIds: ReadonlySet<string>;
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
    return [
        conversation.id,
        conversation.status,
        conversation.priority ? 1 : 0,
        conversation.paused ? 1 : 0,
        options.pinned ? 1 : 0,
        options.isCurrent ? 1 : 0,
        options.visualStatusId,
        conversation.turnProgressCurrent ?? '',
        conversation.turnProgressTotal ?? '',
        title,
    ].join(':');
}

/**
 * Compact fingerprint for the sessions sidebar list. Skips full DOM rebuild when SSE ticks
 * change only live title/progress on streaming rows.
 */
export function buildWorkHubSessionsSidebarFingerprint(input: WorkHubSessionsSidebarFingerprintInput): string {
    return buildWorkHubSessionsSidebarStructureFingerprint(input);
}

/** Layout fingerprint — project groups, visible conversation slots, accordion/pagination chrome. */
export function buildWorkHubSessionsSidebarStructureFingerprint(input: WorkHubSessionsSidebarFingerprintInput): string {
    const parts: string[] = [
        `q:${input.query}`,
        `o:${input.transcriptOpenSummaryId ?? ''}`,
        `e:${[...input.expandedProjectIds].sort().join(',')}`,
    ];
    const visibleCounts = [...input.visibleConversationCountByProjectId.entries()]
        .sort(([left], [right]) => left.localeCompare(right));
    for (const [projectId, count] of visibleCounts) {
        parts.push(`v:${projectId}=${count}`);
    }
    const projects = [...input.projects].sort((left, right) => left.id.localeCompare(right.id));
    for (const project of projects) {
        parts.push(`p:${project.id}:${project.isCurrent ? 1 : 0}`);
        const conversations = input.conversationsForProject(project.id);
        for (const conversation of conversations) {
            const pinned = input.pinnedConversationIds.has(conversation.id);
            parts.push(`c:${buildWorkHubSessionsSidebarStructureSlot(conversation, pinned)}`);
        }
    }
    return parts.join('|');
}
