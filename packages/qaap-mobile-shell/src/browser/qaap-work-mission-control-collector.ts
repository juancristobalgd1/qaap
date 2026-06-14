// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    classifyMissionControlLane,
    classifyMissionControlSurface,
    type MissionControlItem,
} from './mobile-work-mission-control';
import { resolveMissionControlFailure } from './qaap-work-mission-control-failure';

export interface CollectMissionControlItemsInput {
    readonly projects: readonly MobileProjectEntry[];
    readonly conversationsForProject: (project: MobileProjectEntry) => readonly QaapAgentConversationSummaryDTO[];
    readonly isUnread: (summary: QaapAgentConversationSummaryDTO) => boolean;
    readonly resolveAgentLabel: (agentId: string) => string;
    readonly matchesQuery?: (summary: QaapAgentConversationSummaryDTO, query: string) => boolean;
    readonly query?: string;
}

/** Aggregates cross-project agent conversations into mission-control rows. */
export function collectMissionControlItems(input: CollectMissionControlItemsInput): MissionControlItem[] {
    const query = input.query?.trim().toLowerCase() ?? '';
    const items: MissionControlItem[] = [];
    const seenConversationIds = new Set<string>();
    for (const project of input.projects) {
        for (const summary of input.conversationsForProject(project)) {
            if (seenConversationIds.has(summary.id)) {
                continue;
            }
            if (summary.parallelRunId) {
                continue;
            }
            if (query && input.matchesQuery && !input.matchesQuery(summary, query)) {
                continue;
            }
            const unread = input.isUnread(summary);
            const failure = resolveMissionControlFailure(summary);
            items.push({
                key: `${project.id}:${summary.id}`,
                conversationId: summary.id,
                projectId: project.id,
                projectName: project.name,
                projectColor: project.color,
                title: summary.title?.trim() || 'Untitled',
                preview: failure?.preview ?? summary.lastMessagePreview,
                lane: classifyMissionControlLane(summary, unread),
                surface: classifyMissionControlSurface(summary),
                agentLabel: input.resolveAgentLabel(summary.agentId),
                updatedAt: summary.updatedAt,
                progressCurrent: summary.turnProgressCurrent,
                progressTotal: summary.turnProgressTotal,
                linesAdded: summary.linesAdded,
                linesRemoved: summary.linesRemoved,
                hasPullRequest: !!summary.linkedPullRequest?.number,
                failureKind: failure?.kind,
            });
            seenConversationIds.add(summary.id);
        }
    }
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return items;
}
