// @ts-nocheck
// Extracted from mobile-projects-tasks-hub-ui.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationSummaryDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
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
import { parseWorkingDetailTaskLogSegments, shouldShowWorkingDetailTaskLog } from './qaap-sticky-composer-working-detail-task-log';
import { syncStickyComposerStepPillInRoots } from './qaap-sticky-composer-step-pill';
import {
    resolveLatestTranscriptTodos,
    resolveTodoStepProgress,
} from '../common/qaap-transcript-todo-step';
import { resolveAgentMessageSegments } from '../common/qaap-transcript-trace-model';
import { shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import type { MobileProjectsConversations } from './mobile-projects-conversations';

export function bindWorkingDetailTaskLogSubscriptionExtracted(ctx: any, member: WorkHubTeamMember | undefined): void {
        const taskId = shouldShowWorkingDetailTaskLog(member ?? {})
            ? member?.taskId?.trim()
            : undefined;
        if (!taskId || !member) {
            ctx.workingDetailTaskLogDispose.dispose();
            ctx.workingDetailTaskLogDispose = Disposable.NULL;
            ctx.workingDetailTaskLogTaskId = undefined;
            ctx.workingDetailTaskLogSeedToken++;
            return;
        }
        if (ctx.workingDetailTaskLogTaskId === taskId
            && ctx.workingDetailTaskLogDispose !== Disposable.NULL) {
            ctx.paintWorkingDetailTaskLog(member, taskId);
            return;
        }
        ctx.workingDetailTaskLogDispose.dispose();
        ctx.workingDetailTaskLogTaskId = taskId;
        const activeTasks = ctx.host.activeTasks;
        const memberId = member.id;
        const disposables: Disposable[] = [];

        const paint = (): void => {
            if (getWorkingAgentsDetailMemberId() !== memberId) {
                return;
            }
            ctx.paintWorkingDetailTaskLog(member, taskId);
        };

        paint();
        if (activeTasks) {
            disposables.push(activeTasks.onDidTaskOutput(tail => {
                if (tail.taskId !== taskId) {
                    return;
                }
                paint();
            }));
            disposables.push(activeTasks.onDidChange(() => {
                // Task completed/failed — drop the live shimmer while keeping the log.
                paint();
            }));
        }
        ctx.workingDetailTaskLogDispose = Disposable.create(() => {
            for (const disposable of disposables) {
                disposable.dispose();
            }
        });
        void ctx.seedWorkingDetailTaskLogFromServer(memberId, taskId);
}

export function paintWorkingDetailTaskLogExtracted(ctx: any, member: WorkHubTeamMember,
        taskId: string,
        options?: { readonly loading?: boolean },): void {
        const live = getWorkingAgentsDetailMember()
            ?? ctx.host.collectTeamMembersForHub().find(entry => entry.id === member.id)
            ?? member;
        const tail = ctx.host.activeTasks?.getTaskLogTail(taskId);
        const running = live.state === 'running' || live.state === 'streaming';
        const hasText = !!tail?.text?.trim();
        refreshWorkingAgentsDetailCommandLog({
            taskId,
            text: tail?.text ?? '',
            truncated: tail?.truncated === true,
            running,
            loading: options?.loading === true && !hasText && running,
        });
}

export async function seedWorkingDetailTaskLogFromServerExtracted(ctx: any, memberId: string, taskId: string): Promise<void> {
        const token = ++ctx.workingDetailTaskLogSeedToken;
        const activeTasks = ctx.host.activeTasks;
        const memberForLoading = ctx.host.collectTeamMembersForHub()
            .find(entry => entry.id === memberId);
        const existingTail = activeTasks?.getTaskLogTail(taskId);
        if (!existingTail?.text?.trim() && memberForLoading) {
            ctx.paintWorkingDetailTaskLog(memberForLoading, taskId, { loading: true });
        }
        try {
            const detail = await fetchAgentTaskDetail(taskId);
            if (token !== ctx.workingDetailTaskLogSeedToken
                || getWorkingAgentsDetailMemberId() !== memberId
                || ctx.workingDetailTaskLogTaskId !== taskId) {
                return;
            }
            const seeded = activeTasks
                ? activeTasks.seedTaskLog(taskId, detail.log ?? '')
                : { taskId, text: detail.log ?? '', truncated: false };
            const member = ctx.host.collectTeamMembersForHub()
                .find(entry => entry.id === memberId);
            refreshWorkingAgentsDetailCommandLog({
                taskId,
                text: seeded.text,
                truncated: seeded.truncated,
                running: member
                    ? (member.state === 'running' || member.state === 'streaming')
                    : detail.state === 'running',
                loading: false,
                forceScrollToBottom: true,
            });
        } catch {
            /* DETAIL still shows whatever live WS chunks arrived */
            if (token === ctx.workingDetailTaskLogSeedToken
                && getWorkingAgentsDetailMemberId() === memberId
                && memberForLoading) {
                ctx.paintWorkingDetailTaskLog(memberForLoading, taskId, { loading: false });
            }
        }
}

export function resolveWorkingDetailActivityFeedExtracted(ctx: any, member: WorkHubTeamMember): ReturnType<
        typeof resolveWorkingAgentDetailActivityFeedFromConversation
    > {
        const source = resolveWorkingDetailTranscriptSource(ctx, member);
        return resolveWorkingAgentDetailActivityFeedFromConversation(source.document, member, {
            liveSegments: source.liveSegments,
            taskLogSegments: source.taskLogSegments,
        });
}

/** Same transcript DOM as the main chat, for Working DETAIL (Cursor-style panel). */
export function resolveWorkingDetailTranscriptExcerptExtracted(ctx: any, member: WorkHubTeamMember): HTMLElement | undefined {
        const messagesUi = ctx.host.transcriptMessagesUi;
        if (!messagesUi?.createWorkingDetailTranscriptExcerpt) {
            return undefined;
        }
        const source = resolveWorkingDetailTranscriptSource(ctx, member);
        const streaming = source.document?.status === 'streaming'
            || source.document?.status === 'settled'
            || member.state === 'streaming'
            || member.state === 'running';
        return messagesUi.createWorkingDetailTranscriptExcerpt({
            document: source.document,
            liveSegments: source.liveSegments,
            taskLogSegments: source.taskLogSegments,
            streaming,
            conversationId: member.conversationId,
            agentId: member.agentId,
            title: member.title,
        });
}

function resolveWorkingDetailTranscriptSource(ctx: any, member: WorkHubTeamMember): {
        readonly document: import('../common/qaap-agent-conversation-client').QaapAgentConversationDTO | undefined;
        readonly liveSegments: QaapAgentMessageSegmentDTO[] | undefined;
        readonly taskLogSegments: QaapAgentMessageSegmentDTO[] | undefined;
    } {
        const conversationId = member.conversationId?.trim();
        if (conversationId) {
            ctx.host.conversations?.prefetchDocument(conversationId);
        }
        const conversations = ctx.host.conversations;
        const document = conversationId
            ? conversations?.threadStore.getDocument(conversationId)
            : undefined;
        const liveReducer = conversationId
            ? conversations?.threadStore.getLiveReducer(conversationId)
            : undefined;
        const liveSegments = liveReducer && liveReducer.traceEvents.length > 0
            ? [...resolveAgentMessageSegments({
                role: 'agent',
                content: '',
                traceEvents: [...liveReducer.traceEvents],
            })]
            : undefined;
        const taskLogText = member.taskId?.trim()
            ? ctx.host.activeTasks?.getTaskLogTail(member.taskId)?.text
            : undefined;
        const parsedTaskLog = parseWorkingDetailTaskLogSegments(taskLogText);
        return {
            document,
            liveSegments,
            taskLogSegments: parsedTaskLog.length > 0 ? parsedTaskLog : undefined,
        };
}

export function prefetchWorkingDetailDocumentsExtracted(ctx: any, members: readonly WorkHubTeamMember[]): void {
        const conversations = ctx.host.conversations;
        if (!conversations) {
            return;
        }
        const ids = filterWorkingTeamMembers(members)
            .map(member => member.conversationId?.trim())
            .filter((id): id is string => !!id);
        conversations.prefetchDocuments(ids);
}

export async function stopAllWorkingAgentsExtracted(ctx: any, members: readonly WorkHubTeamMember[]): Promise<boolean> {
        const errors: string[] = [];
        const cancelledConversationIds = new Set<string>();
        const cancelJobs: Promise<void>[] = [];

        // 1) Always stop the open sticky-composer / transcript session first (composer Stop).
        const openComposerId = ctx.resolveOpenComposerConversationId();
        try {
            const stoppedOpen = ctx.host.transcriptStickyComposerUi.stopOpenComposerAgentLikeComposerStop();
            if (stoppedOpen && openComposerId) {
                cancelledConversationIds.add(openComposerId);
            }
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }

        // 2) Live hub members + expand snapshot (prefer live — snapshot can be stale/idle-retained).
        const liveWorking = filterWorkingTeamMembers(ctx.host.collectTeamMembersForHub());
        const argWorking = filterWorkingTeamMembers(members);
        const byKey = new Map<string, WorkHubTeamMember>();
        for (const member of [...liveWorking, ...argWorking]) {
            const key = member.conversationId
                ? `c:${member.conversationId}`
                : (member.taskId ? `t:${member.taskId}` : `id:${member.id}`);
            byKey.set(key, member);
        }

        for (const member of byKey.values()) {
            if (member.conversationId) {
                if (cancelledConversationIds.has(member.conversationId)) {
                    continue;
                }
                cancelledConversationIds.add(member.conversationId);
                cancelJobs.push(ctx.cancelWorkingConversationLikeComposerStop(member.conversationId)
                    .catch(err => {
                        errors.push(err instanceof Error ? err.message : String(err));
                    }));
                continue;
            }
            if (member.taskId) {
                const taskId = member.taskId;
                cancelJobs.push(
                    cancelAgentTask(taskId).catch(err => {
                        errors.push(err instanceof Error ? err.message : String(err));
                    }),
                );
            }
        }

        if (cancelJobs.length > 0) {
            await Promise.all(cancelJobs);
        }
        if (errors.length > 0) {
            const message = nls.localize(
                'qaap/workHubChrome/workingStopAllFailed',
                '{0} agent(s) could not be stopped: {1}. They remain visible so you can retry.',
                String(errors.length),
                errors[0],
            );
            ctx.host.messageService?.error(message);
            ctx.host.transcriptComposerSendRefresh?.();
            ctx.updateWorkingPillChrome();
            return false;
        }
        // Stop All clears reading retain + pill immediately (do not keep "1 Working").
        dismissWorkingAgentsExpandForStopAll();
        ctx.host.transcriptComposerSendRefresh?.();
        ctx.updateWorkingPillChrome();
        return true;
}

export async function stopWorkingAgentExtracted(ctx: any, member: WorkHubTeamMember): Promise<boolean> {
        try {
            if (member.conversationId) {
                await ctx.cancelWorkingConversationLikeComposerStop(member.conversationId);
            } else if (member.taskId) {
                await cancelAgentTask(member.taskId);
            } else {
                throw new Error(nls.localize(
                    'qaap/workHubChrome/workingStopUnavailable',
                    'This run no longer has a cancellable session.',
                ));
            }
            ctx.host.transcriptComposerSendRefresh?.();
            ctx.updateWorkingPillChrome();
            return true;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            ctx.host.messageService?.error(nls.localize(
                'qaap/workHubChrome/workingStopFailed',
                'Could not stop this agent: {0}. It remains visible so you can retry.',
                detail,
            ));
            ctx.host.transcriptComposerSendRefresh?.();
            ctx.updateWorkingPillChrome();
            return false;
        }
}

export async function cancelWorkingConversationLikeComposerStopExtracted(ctx: any, conversationId: string): Promise<void> {
        const summary = ctx.host.conversationIndexUi.findSummaryById(conversationId);
        const project = ctx.resolveProjectForConversationId(conversationId);
        if (project && summary) {
            ctx.host.onCancelConversation(project, summary);
            return;
        }
        // Fallback: same transport as onCancelConversation's VPS branch (live WS → HTTP).
        await cancelConversation(conversationId);
}

export function resolveOpenComposerConversationIdExtracted(ctx: any): string | undefined {
        const summary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        if (!summary || isAgentsHubIdleConversationSummary(summary)) {
            return undefined;
        }
        return summary.id;
}

export function collectTeamMembersForTranscriptSectionExtracted(ctx: any): WorkHubTeamMember[] {
        const summary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        const conversationId = summary?.id?.trim();
        if (!conversationId) {
            return [];
        }
        const all = ctx.host.collectTeamMembersForHub();
        // Collect conversation ids that belong to this section: the root conversation plus
        // any forks (parentId chain). Also match VPS tasks whose parentId resolves to
        // a conversation in this section.
        const sectionConversationIds = new Set<string>([conversationId]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const member of all) {
                if (member.kind === 'conversation' && member.parentId
                    && sectionConversationIds.has(member.parentId)
                    && member.conversationId
                    && !sectionConversationIds.has(member.conversationId)) {
                    sectionConversationIds.add(member.conversationId);
                    changed = true;
                }
            }
        }
        return all.filter(member => {
            if (member.conversationId && sectionConversationIds.has(member.conversationId)) {
                return true;
            }
            // VPS subtask: include if its parent conversation is in this section.
            if (member.kind === 'subtask' && member.parentId) {
                const parent = all.find(m => m.id === member.parentId);
                if (parent?.conversationId && sectionConversationIds.has(parent.conversationId)) {
                    return true;
                }
            }
            return false;
        });
}

export function isEmptyComposerQuickActionsSurfacePaintedExtracted(ctx: any): boolean {
        for (const host of [ctx.host.transcriptComposerHost, ctx.host.stickyComposerHost]) {
            if (host?.isConnected && host.classList.contains('theia-mod-show-quick-actions')) {
                return true;
            }
        }
        const scroll = ctx.host.scroll;
        if (scroll?.isConnected) {
            return scroll.querySelector('.theia-mobile-agent-transcript-empty-welcome') !== null;
        }
        return false;
}

export function shouldSuppressWorkingPillForEmptyComposerExtracted(ctx: any): boolean {
        if (ctx.isEmptyComposerQuickActionsSurfacePainted()) {
            return true;
        }
        const summary = ctx.host.transcriptComposerSummary ?? ctx.host.transcriptOpenSummary;
        if (!summary) {
            return false;
        }
        if (isAgentsHubIdleConversationSummary(summary)) {
            return true;
        }
        if (summary.id.startsWith('pending-new-chat-')) {
            return true;
        }
        const cached = ctx.host.transcriptLastConv?.id === summary.id
            ? ctx.host.transcriptLastConv
            : undefined;
        if (cached) {
            return shouldShowTranscriptEmptyQuickActions(cached, cached);
        }
        const conv = {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
        };
        return shouldShowTranscriptEmptyQuickActions(conv, undefined);
}

export function markTasksFirstLoadCompleteExtracted(ctx: any, render: boolean): void {
        if (ctx.host.tasksFirstLoadFallback !== undefined) {
            window.clearTimeout(ctx.host.tasksFirstLoadFallback);
            ctx.host.tasksFirstLoadFallback = undefined;
        }
        if (!ctx.host.tasksFirstLoadPending) {
            return;
        }
        ctx.host.tasksFirstLoadPending = false;
        if (render && ctx.host.visible && ctx.host.hubQueryUi.isTasksHubView()) {
            ctx.host.renderList();
        }
}

export function createTasksLoadingStateExtracted(ctx: any): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-tasks-skeleton-list';
        list.setAttribute('aria-busy', 'true');
        list.setAttribute('aria-label', nls.localize('qaap/mobileProjects/tasksLoading', 'Loading tasks…'));
        for (let i = 0; i < 4; i++) {
            list.append(ctx.createTaskSkeletonRow());
        }
        return list;
}

export function createTaskSkeletonRowExtracted(ctx: any): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-tasks-skeleton-row q-card';
        const avatar = document.createElement('div');
        avatar.className = 'q-skeleton theia-mobile-tasks-skeleton-avatar';
        const body = document.createElement('div');
        body.className = 'theia-mobile-tasks-skeleton-body';
        const title = document.createElement('div');
        title.className = 'q-skeleton q-skeleton-text theia-mobile-tasks-skeleton-title';
        const meta = document.createElement('div');
        meta.className = 'q-skeleton q-skeleton-text theia-mobile-tasks-skeleton-meta';
        body.append(title, meta);
        row.append(avatar, body);
        return row;
}

export function createTasksEmptyStateExtracted(ctx: any): HTMLElement {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-projects-empty';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-server-process';
        const title = document.createElement('strong');
        title.textContent = ctx.host.query
            ? nls.localize('qaap/mobileProjects/noTasksSearchResults', 'No matching tasks')
            : nls.localize('qaap/mobileProjects/noTasks', 'No VPS tasks yet');
        const body = document.createElement('span');
        body.textContent = ctx.host.query
            ? nls.localize(
                'qaap/mobileProjects/noTasksSearchResultsBody',
                'Try a task title, agent name, or branch.',
            )
            : nls.localize(
                'qaap/mobileProjects/noTasksBody',
                'Delegate work from a project — it keeps running on the server when you close the app.',
            );
        empty.append(icon, title, body);
        return empty;
}

