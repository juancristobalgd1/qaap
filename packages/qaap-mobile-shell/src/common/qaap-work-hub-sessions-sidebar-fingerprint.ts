// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface WorkHubSessionsSidebarConversationFingerprint {
    readonly id: string;
    readonly status: string;
    readonly title: string;
    readonly updatedAt: number;
    readonly messageCount: number;
    readonly priority?: boolean;
    readonly paused?: boolean;
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

/**
 * Compact fingerprint for the sessions sidebar list. Skips full DOM rebuild when SSE ticks
 * change only the open transcript (not reflected in sidebar rows).
 */
export function buildWorkHubSessionsSidebarFingerprint(input: WorkHubSessionsSidebarFingerprintInput): string {
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
        const conversations = [...input.conversationsForProject(project.id)]
            .sort((left, right) => left.id.localeCompare(right.id));
        for (const conversation of conversations) {
            const pinned = input.pinnedConversationIds.has(conversation.id) ? 1 : 0;
            parts.push([
                'c',
                conversation.id,
                conversation.status,
                conversation.updatedAt,
                conversation.messageCount,
                conversation.priority ? 1 : 0,
                conversation.paused ? 1 : 0,
                pinned,
                conversation.title,
            ].join(':'));
        }
    }
    return parts.join('|');
}
