// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    classifyMissionControlLane,
    classifyMissionControlSurface,
    type MissionControlItem,
} from './mobile-work-mission-control';
import { resolveMissionControlFailure } from './qaap-work-mission-control-failure';
import { taskPullRequestNeedsAttention } from '@theia/qaap-shared-core/lib/common/qaap-task-pull-request';
import { QaapTaskPlan } from '@theia/qaap-shared-core/lib/common/qaap-task-plan';
import { nls } from '@theia/core/lib/common/nls';

export interface CollectMissionControlItemsInput {
    readonly projects: readonly MobileProjectEntry[];
    readonly conversationsForProject: (project: MobileProjectEntry) => readonly QaapAgentConversationSummaryDTO[];
    readonly isUnread: (summary: QaapAgentConversationSummaryDTO) => boolean;
    readonly resolveAgentLabel: (agentId: string) => string;
    readonly matchesQuery?: (summary: QaapAgentConversationSummaryDTO, query: string) => boolean;
    readonly query?: string;
    /** Clock for the plan auto-run countdown label. */
    readonly now?: () => number;
}

/** Chip labels of a task plan parent ("Plan ready · runs in 40s", "Subtasks 2/3") and of its subtask children. */
export interface MissionControlPlanLabels {
    readonly planLabel?: string;
    readonly subtaskLabel?: string;
}

const SUBTASK_TITLE_PREFIX = /^(\d+)\/(\d+) · /;

/**
 * `planLabel` for a conversation that owns an active or failed plan; `subtaskLabel` for a subtask child,
 * from its "k/N · " title prefix or, failing that, its index in the parent's plan.
 */
export function resolveMissionControlPlanLabels(
    summary: QaapAgentConversationSummaryDTO,
    findSummary: (id: string) => QaapAgentConversationSummaryDTO | undefined,
    now: number,
): MissionControlPlanLabels {
    const labels: { planLabel?: string; subtaskLabel?: string } = {};
    const plan = summary.taskPlan;
    if (plan) {
        const progress = QaapTaskPlan.progress(plan);
        switch (plan.state) {
            case 'awaiting-approval': {
                const seconds = plan.autoRun && plan.autoRunAt !== undefined ? Math.max(0, Math.ceil((plan.autoRunAt - now) / 1000)) : undefined;
                labels.planLabel = seconds !== undefined
                    ? nls.localize('qaap/taskPlan/mcReadyCountdown', 'Plan ready · runs in {0}s', String(seconds))
                    : nls.localize('qaap/taskPlan/mcReady', 'Plan ready');
                break;
            }
            case 'running':
                labels.planLabel = nls.localize('qaap/taskPlan/mcSubtasks', 'Subtasks {0}/{1}', String(progress.done), String(progress.total));
                break;
            case 'integrating':
                labels.planLabel = nls.localize('qaap/taskPlan/mcIntegrating', 'Integrating subtasks');
                break;
            case 'failed':
                labels.planLabel = nls.localize('qaap/taskPlan/mcFailed', 'Plan failed');
                break;
        }
    }
    if (summary.parentConversationId) {
        const position = resolveSubtaskPosition(summary, findSummary);
        if (position) {
            labels.subtaskLabel = nls.localize('qaap/taskPlan/mcSubtask', 'Subtask {0}/{1}', String(position.index), String(position.total));
        }
    }
    return labels;
}

function resolveSubtaskPosition(
    summary: QaapAgentConversationSummaryDTO,
    findSummary: (id: string) => QaapAgentConversationSummaryDTO | undefined,
): { readonly index: number; readonly total: number } | undefined {
    const match = SUBTASK_TITLE_PREFIX.exec(summary.title ?? '');
    if (match) {
        return { index: Number(match[1]), total: Number(match[2]) };
    }
    const plan = summary.parentConversationId ? findSummary(summary.parentConversationId)?.taskPlan : undefined;
    const index = plan?.subtasks.findIndex(subtask =>
        subtask.id === summary.taskPlanSubtaskId || (!!subtask.conversationId && subtask.conversationId === summary.id)) ?? -1;
    return plan && index >= 0 ? { index: index + 1, total: plan.subtasks.length } : undefined;
}

/** Aggregates cross-project agent conversations into mission-control rows. */
export function collectMissionControlItems(input: CollectMissionControlItemsInput): MissionControlItem[] {
    const query = input.query?.trim().toLowerCase() ?? '';
    const items: MissionControlItem[] = [];
    const seenConversationIds = new Set<string>();
    const now = input.now?.() ?? Date.now();
    const summariesById = new Map<string, QaapAgentConversationSummaryDTO>();
    for (const project of input.projects) {
        for (const summary of input.conversationsForProject(project)) {
            summariesById.set(summary.id, summary);
        }
    }
    for (const project of input.projects) {
        for (const summary of input.conversationsForProject(project)) {
            if (seenConversationIds.has(summary.id)) {
                continue;
            }
            if (query && input.matchesQuery && !input.matchesQuery(summary, query)) {
                continue;
            }
            const unread = input.isUnread(summary);
            const failure = resolveMissionControlFailure(summary);
            const planLabels = resolveMissionControlPlanLabels(summary, id => summariesById.get(id), now);
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
                hasPullRequest: !!summary.linkedPullRequest?.number || !!summary.taskPullRequest?.number,
                failureKind: failure?.kind,
                ...(planLabels.planLabel ? { planLabel: planLabels.planLabel } : {}),
                ...(planLabels.subtaskLabel ? { subtaskLabel: planLabels.subtaskLabel } : {}),
                ...(summary.taskPullRequestEnabled !== false && summary.taskPullRequest && taskPullRequestNeedsAttention(summary.taskPullRequest) ? {
                    pullRequestAttention: {
                        number: summary.taskPullRequest.number,
                        url: summary.taskPullRequest.url,
                        repository: `${summary.taskPullRequest.owner}/${summary.taskPullRequest.repo}`,
                        ...(summary.taskPullRequest.state === 'awaiting-consent' ? { reason: 'consent' as const }
                            : summary.taskPullRequest.state === 'needs-sign-in' ? { reason: 'sign-in' as const } : {}),
                    },
                } : {}),
            });
            seenConversationIds.add(summary.id);
        }
    }
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return items;
}
