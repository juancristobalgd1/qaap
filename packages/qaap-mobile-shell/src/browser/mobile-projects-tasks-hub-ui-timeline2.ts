// @ts-nocheck
// Extracted from mobile-projects-tasks-hub-ui.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    isAgentsHubIdleConversationSummary,
    QAAP_AGENTS_HUB_LANDING_ENABLED,
    QAAP_AGENTS_HUB_QUICK_ACTIONS,
    QAAP_AGENTS_HUB_RECENT_LIMIT,
} from '../common/qaap-agents-hub-landing';
import { bindStickyComposerControlClick } from '../common/qaap-sticky-composer-control-click';
import { type QaapComposerSurface } from '../common/qaap-composer-surface';
import { type WorkHubTeamMember } from '../common/qaap-work-hub-team';
import { cancelConversation } from '../common/qaap-agent-conversation-client';
import { cancelAgentTask, fetchAgentTaskDetail } from '../common/qaap-agent-task-client';
import { type WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import { type MobileWorkHubInboxItem } from './mobile-work-hub-inbox';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectEntry } from './mobile-projects-types';
import { syncStickyComposerWorkingPillInRoots } from './qaap-sticky-composer-working-pill';
import {
    closeWorkingAgentsPopover,
    dismissWorkingAgentsExpandForStopAll,
    filterWorkingTeamMembers,
    getWorkingAgentsDetailMember,
    getWorkingAgentsDetailMemberId,
    isWorkingAgentsExpandPinnedOpen,
    isWorkingAgentsExpandSessionOpen,
    isWorkingAgentsPopoverOpen,
    isWorkingPillSuppressedAfterStopAll,
    noteWorkingPillChromeCount,
    openWorkingAgentsPopover,
    refreshWorkingAgentsDetailActivityFeed,
    refreshWorkingAgentsDetailCommandLog,
    restoreWorkingAgentsExpandIfNeeded,
    syncWorkingAgentsExpandContent,
} from './qaap-sticky-composer-working-agents-popover';
import {
    resolveWorkingAgentDetailActivityFeedFromConversation,
} from './qaap-sticky-composer-working-detail-activity';
import { shouldShowWorkingDetailTaskLog } from './qaap-sticky-composer-working-detail-task-log';
import { syncStickyComposerStepPillInRoots } from './qaap-sticky-composer-step-pill';
import {
    resolveLatestTranscriptTodos,
    resolveTodoStepProgress,
} from '../common/qaap-transcript-todo-step';
import { resolveAgentMessageSegments } from '../common/qaap-transcript-trace-model';
import { shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import type { MobileProjectsConversations } from './mobile-projects-conversations';

export function appendTasksHubTeamSectionExtracted(ctx: any, container: HTMLElement): boolean {
        const { members, filteredApprovals } = ctx.host.getFilteredTeamHubState();
        const teamHost = document.createElement('div');
        teamHost.className = 'theia-mobile-hub-team-root theia-mod-embedded-in-tasks';
        const rendered = ctx.host.ensureOverlayUi().teamHub.renderSections(teamHost, members, {
            searchQuery: ctx.host.query,
            approvals: filteredApprovals,
            embedded: true,
        });
        if (rendered) {
            container.append(teamHost);
        }
        return rendered;
}

export function renderTasksHubViewExtracted(ctx: any, projects: MobileProjectEntry[]): void {
        if (ctx.host.shouldUseAgentsHubLanding()) {
            void projects;
            ctx.host.renderAgentsHubExecutionShell();
            return;
        }
        if (ctx.host.agentsHubShellActive) {
            ctx.host.teardownAgentsHubExecutionShell();
        }
        const root = document.createElement('div');
        root.className = 'theia-mobile-tasks-hub-root';
        if (ctx.host.tasksHubSurface === 'chat') {
            const groups = ctx.host.collectChatHubGroups(projects);
            if (groups.length === 0) {
                root.append(ctx.host.createChatEmptyState());
            } else {
                const host = document.createElement('div');
                host.className = 'theia-mobile-projects-chats-inbox theia-mod-local-chat';
                for (const group of groups) {
                    const items: MobileWorkHubInboxItem[] = group.summaries.map(summary => ({
                        kind: 'conversation',
                        project: group.project,
                        summary,
                        sortAt: summary.updatedAt,
                        priority: 0,
                    }));
                    host.append(ctx.host.createInboxProjectGroup(group.project, items));
                }
                root.append(host);
            }
            ctx.host.hubIncrementalUi.rememberRenderedStructure('chat-inbox', groups.map(group => ({
                project: group.project,
                items: group.summaries.map(summary => ({
                    kind: 'conversation' as const,
                    project: group.project,
                    summary,
                    sortAt: summary.updatedAt,
                    priority: 0,
                })),
            })));
            ctx.host.scroll.append(root);
            ctx.updateTasksAttentionChrome();
            ctx.host.renderSubtitle();
            return;
        }

        const groups = ctx.host.collectTasksInboxGroups(projects);
        const teamRendered = ctx.appendTasksHubTeamSection(root);

        if (groups.length > 0) {
            const inbox = document.createElement('div');
            inbox.className = 'theia-mobile-projects-chats-inbox theia-mod-tasks-inbox';
            if (teamRendered) {
                const inboxHead = document.createElement('div');
                inboxHead.className = 'theia-mobile-tasks-inbox-section-head';
                const inboxLabel = document.createElement('span');
                inboxLabel.className = 'theia-mobile-tasks-inbox-section-label';
                inboxLabel.textContent = nls.localize('qaap/mobileProjects/tasksInboxSection', 'By project');
                inboxHead.append(inboxLabel);
                inbox.append(inboxHead);
            }
            for (const group of groups) {
                inbox.append(ctx.host.createInboxProjectGroup(group.project, group.items));
            }
            root.append(inbox);
            ctx.host.hubIncrementalUi.rememberRenderedStructure('tasks-inbox', groups, { teamEmbedded: teamRendered });
        }

        if (!teamRendered && groups.length === 0) {
            if (ctx.host.tasksFirstLoadPending && !ctx.host.query.trim()) {
                root.append(ctx.createTasksLoadingState());
            } else {
                root.append(ctx.createTasksEmptyState());
            }
        }
        ctx.host.scroll.append(root);
        ctx.updateTasksAttentionChrome();
        ctx.host.renderSubtitle();
}

