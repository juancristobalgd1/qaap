// @ts-nocheck
// Extracted from mobile-projects-project-rows-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { conversationTurnProgressRatio } from '../common/qaap-agent-conversation-list-metrics';
import {
    isConversationAutoApproveEnabled,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { resolveQaapAgentTaskVisualStatus, type QaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import { buildWorkHubInboxRowFingerprintFromSummary } from '../common/qaap-work-hub-inbox-fingerprint';
import {
    QAAP_INBOX_ROW_FP_ATTR,
    QAAP_INBOX_ROW_ID_ATTR,
} from './mobile-projects-hub-incremental-ui';
import { SHELL_AGENT_ID } from '../common/qaap-agent-task-client';
import { formatConversationComposerSessionMeta } from '../common/qaap-conversation-composer-state';
import { readStoredComposerSurface, type QaapComposerSurface } from '../common/qaap-composer-surface';
import { createAgentTaskBadge, createAgentTaskVerificationBadge } from './qaap-agent-ui';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectsService } from './mobile-projects-service';
import { mobileProjectInitials, type MobileProjectEntry, type MobileProjectsHubView } from './mobile-projects-types';
import { attachSwipeToDelete } from './qaap-mobile-swipe-to-delete';

export function createTaskBlockExtracted(ctx: any, project: MobileProjectEntry,
        activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,): HTMLElement {
        const block = document.createElement('div');
        block.className = 'theia-mobile-projects-tasks-block';
        const surface = ctx.detailComposerSurfaceForProject(project);
        const isChatSurface = surface === 'chat';
        const allConversations = isChatSurface
            ? ctx.host.conversationIndexUi.localChatsForProject(project)
            : ctx.host.conversationIndexUi.vpsTasksForProject(project);
        const head = document.createElement('div');
        head.className = 'theia-mobile-projects-tasks-head';
        const headLabel = document.createElement('span');
        headLabel.textContent = isChatSurface
            ? nls.localize('qaap/mobileProjects/chatsHeading', 'Chats')
            : nls.localize('qaap/mobileProjects/tasksHeading', 'Tasks');
        head.append(headLabel);

        if (allConversations.length > 0) {
            const count = document.createElement('span');
            count.className = 'theia-mobile-projects-tasks-count';
            count.textContent = String(allConversations.length);
            head.append(count);
        }
        block.append(head);

        if (allConversations.length === 0) {
            if (isChatSurface) {
                const empty = document.createElement('div');
                empty.className = 'theia-mobile-projects-tasks-empty';
                empty.textContent = nls.localize(
                    'qaap/mobileProjects/chatsEmpty', 'No local chats yet. Start one below.'
                );
                block.append(empty);
                return block;
            }
            const fallbackTasks = ctx.host.conversationIndexUi.fallbackTasksFromProject(project);
            if (fallbackTasks.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'theia-mobile-projects-tasks-empty';
                empty.textContent = nls.localize(
                    'qaap/mobileProjects/tasksEmpty', 'No tasks yet. Create one below.'
                );
                block.append(empty);
                return block;
            }
            const list = document.createElement('div');
            list.className = 'theia-mobile-projects-tasks-list';
            for (const task of fallbackTasks) {
                list.append(ctx.createTaskItem(project, task, activeInfo));
            }
            block.append(list);
            return block;
        }

        const showAll = ctx.host.expandedConversationProjectIds.has(project.id);
        const limit = MOBILE_PROJECTS_CONVERSATIONS_COLLAPSED_LIMIT;
        const visibleConversations = showAll
            ? allConversations
            : allConversations.slice(0, limit);
        const hiddenCount = allConversations.length - visibleConversations.length;
        const tasks = visibleConversations.map(c => ctx.host.conversationIndexUi.summaryToTaskView(c));

        // Pre-compute the set of conversation ids that have at least one descendant fork, so each
        // row can decide which lineage glyph to render (parent / child / both / standalone).
        const parentIds = new Set<string>();
        for (const c of allConversations) {
            if (c.forkedFromId) {
                parentIds.add(c.forkedFromId);
            }
        }

        const list = document.createElement('div');
        list.className = 'theia-mobile-projects-tasks-list';
        for (const group of ctx.groupConversationTasks(tasks)) {
            const section = document.createElement('section');
            section.className = `theia-mobile-projects-conversation-group theia-mod-${group.id}`;
            const groupHead = document.createElement('div');
            groupHead.className = 'theia-mobile-projects-conversation-group-head';
            const groupLabel = document.createElement('span');
            groupLabel.className = 'theia-mobile-projects-conversation-group-label';
            groupLabel.textContent = group.label;
            const groupCount = document.createElement('span');
            groupCount.className = 'theia-mobile-projects-conversation-group-count';
            groupCount.textContent = String(group.tasks.length);
            groupHead.append(groupLabel, groupCount);
            section.append(groupHead);
            for (const task of group.tasks) {
                const summary = visibleConversations.find(c => c.id === task.id);
                section.append(ctx.createTaskItem(project, task, activeInfo, summary, parentIds));
            }
            list.append(section);
        }
        block.append(list);

        if (hiddenCount > 0) {
            const moreRow = document.createElement('div');
            moreRow.className = 'theia-mobile-projects-tasks-more-row';
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'theia-mobile-projects-tasks-more-btn';
            const icon = document.createElement('span');
            icon.className = 'codicon codicon-ellipsis';
            icon.setAttribute('aria-hidden', 'true');
            moreBtn.append(
                icon,
                document.createTextNode(
                    isChatSurface
                        ? nls.localize('qaap/mobileProjects/chatsMore', 'More chats ({0})', String(hiddenCount))
                        : nls.localize('qaap/mobileProjects/tasksMore', 'More tasks ({0})', String(hiddenCount)),
                ),
            );
            moreBtn.addEventListener('click', ev => {
                ev.stopPropagation();
                ctx.host.expandedConversationProjectIds.add(project.id);
                ctx.host.renderList();
            });
            moreRow.append(moreBtn);
            block.append(moreRow);
        }

        return block;
}

export function detailComposerSurfaceForProjectExtracted(ctx: any, project: MobileProjectEntry): QaapComposerSurface {
        if (!ctx.host.homeMode || ctx.host.hubView !== 'repos' || ctx.host.expandedId !== project.id) {
            return 'task';
        }
        const cwd = ctx.host.projectsService.getProjectCwd(project) ?? ctx.host.preparedCwdByProjectId.get(project.id);
        return readStoredComposerSurface(cwd) ?? ctx.host.stickyComposerSurface ?? 'task';
}

export function groupConversationTasksExtracted(ctx: any, tasks: MobileProjectTaskView[]): Array<{
        id: 'working' | 'needs-you' | 'recent' | 'done';
        label: string;
        tasks: MobileProjectTaskView[];
    }> {
        type ConversationGroup = {
            id: 'working' | 'needs-you' | 'recent' | 'done';
            label: string;
            tasks: MobileProjectTaskView[];
        };
        const groups = {
            working: [] as MobileProjectTaskView[],
            needsYou: [] as MobileProjectTaskView[],
            recent: [] as MobileProjectTaskView[],
            done: [] as MobileProjectTaskView[],
        };
        const recentWindowMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        for (const task of tasks) {
            if (task.state === 'running') {
                groups.working.push(task);
            } else if (task.state === 'needs-input' || task.state === 'blocked' || task.state === 'failed' || task.state === 'interrupted' || task.state === 'completed_with_warnings') {
                groups.needsYou.push(task);
            } else if (now - (task.finishedAt ?? task.createdAt) <= recentWindowMs) {
                groups.recent.push(task);
            } else {
                groups.done.push(task);
            }
        }
        const ordered: ConversationGroup[] = [
            {
                id: 'working',
                label: nls.localize('qaap/mobileProjects/taskGroupWorking', 'Working'),
                tasks: groups.working,
            },
            {
                id: 'needs-you',
                label: nls.localize('qaap/mobileProjects/taskGroupNeedsYou', 'Needs you'),
                tasks: groups.needsYou,
            },
            {
                id: 'recent',
                label: nls.localize('qaap/mobileProjects/taskGroupRecent', 'Recent'),
                tasks: groups.recent,
            },
            {
                id: 'done',
                label: nls.localize('qaap/mobileProjects/taskGroupDone', 'Done'),
                tasks: groups.done,
            },
        ];
        return ordered.filter(group => group.tasks.length > 0);
}

