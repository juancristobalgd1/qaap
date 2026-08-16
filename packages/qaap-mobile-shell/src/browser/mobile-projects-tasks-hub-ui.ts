// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
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
import { applyComposerQuickActionPromptExtracted, bindWorkingDetailConversationSubscriptionExtracted, collectAgentsHubRecentItemsExtracted, createAgentsHubLandingHeroBlockExtracted, createAgentsHubQuickActionsBlockExtracted, createAgentsHubRecentsBlockExtracted, openWorkingAgentsPopoverFromPillExtracted, resolveActiveConversationTodoStepProgressExtracted, shouldEmbedAgentsHubRecentsInWorkspaceTranscriptExtracted, updateStepPillChromeExtracted, updateTasksAttentionChromeExtracted, updateWorkingPillChromeExtracted } from './mobile-projects-tasks-hub-ui-render2';
import { bindWorkingDetailTaskLogSubscriptionExtracted, cancelWorkingConversationLikeComposerStopExtracted, collectTeamMembersForTranscriptSectionExtracted, createTaskSkeletonRowExtracted, createTasksEmptyStateExtracted, createTasksLoadingStateExtracted, isEmptyComposerQuickActionsSurfacePaintedExtracted, markTasksFirstLoadCompleteExtracted, paintWorkingDetailTaskLogExtracted, prefetchWorkingDetailDocumentsExtracted, resolveOpenComposerConversationIdExtracted, resolveWorkingDetailActivityFeedExtracted, resolveWorkingDetailTranscriptExcerptExtracted, seedWorkingDetailTaskLogFromServerExtracted, shouldSuppressWorkingPillForEmptyComposerExtracted, stopAllWorkingAgentsExtracted, stopWorkingAgentExtracted } from './mobile-projects-tasks-hub-ui-streaming2';
import { appendTasksHubTeamSectionExtracted, renderTasksHubViewExtracted } from './mobile-projects-tasks-hub-ui-timeline2';

/** Panel surface for Tasks hub list rendering and Agents Hub landing recents/quick actions. */
export interface MobileProjectsTasksHubHost {
    homeMode: boolean;
    query: string;
    scroll: HTMLElement;
    tasksHubSurface: QaapComposerSurface;
    tasksFirstLoadPending: boolean;
    tasksFirstLoadFallback: number | undefined;
    visible: boolean;
    agentsHubShellActive: boolean;
    projects: MobileProjectEntry[];
    readQaapSignedIn?: () => boolean;
    transcriptSheet: HTMLElement | undefined;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerDraft: string;
    transcriptComposerProject?: MobileProjectEntry;
    transcriptComposerSummary?: QaapAgentConversationSummaryDTO;
    transcriptOpenProject?: MobileProjectEntry;
    transcriptOpenSummary?: QaapAgentConversationSummaryDTO;
    /** Live transcript document — used as Step-pill fallback while threadStore catches up. */
    transcriptLastConv?: import('../common/qaap-agent-conversation-client').QaapAgentConversationDTO;
    transcriptComposerSendRefresh?: (() => void) | undefined;
    stickyComposerDraft: string;
    stickyComposerHost: HTMLElement | undefined;
    titleAttentionEl: HTMLElement;

    shouldUseAgentsHubLanding(): boolean;
    isTasksHubView(): boolean;
    renderAgentsHubExecutionShell(): void;
    teardownAgentsHubExecutionShell(): void;
    localChatsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    vpsTasksForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    conversationMatchesQuery(summary: QaapAgentConversationSummaryDTO, query: string): boolean;
    transcriptMessagesUi: import('./mobile-projects-transcript-messages-ui').MobileProjectsTranscriptMessagesUi;
    transcriptStickyComposerUi: import('./mobile-projects-transcript-sticky-composer-ui').MobileProjectsTranscriptStickyComposerUi;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    activeInfoForProject(project: MobileProjectEntry): ReturnType<MobileProjectsActiveTasks['getForCwd']>;
    summaryToTaskView(conversation: QaapAgentConversationSummaryDTO): MobileProjectTaskView;
    createTaskItem(
        project: MobileProjectEntry,
        task: MobileProjectTaskView,
        activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,
        summary?: QaapAgentConversationSummaryDTO,
        parentIds?: ReadonlySet<string>,
    ): HTMLElement;
    openWorkHubSessionsSidebar(): void;
    collectTeamMembersForHub(): WorkHubTeamMember[];
    onTeamMemberClick(member: WorkHubTeamMember): void;
    onCancelConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void;
    /** Optional — hydrates Working DETAIL activity feed from cached transcripts. */
    conversations?: MobileProjectsConversations;
    /** Optional — live VPS task WS + command-output tails for Working DETAIL. */
    activeTasks?: MobileProjectsActiveTasks;
    /** Optional toast surface for Stop All / Working chrome failures. */
    messageService?: { error(message: string): void };
    collectChatHubGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; summaries: QaapAgentConversationSummaryDTO[] }>;
    collectTasksInboxGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }>;
    createChatEmptyState(): HTMLElement;
    createInboxProjectGroup(project: MobileProjectEntry, items: MobileWorkHubInboxItem[]): HTMLElement;
    renderList(): void;
    openDesktopIdeFromAgentsHub(): Promise<void>;
    getFilteredTeamHubState(): {
        members: WorkHubTeamMember[];
        filteredApprovals: WorkHubApprovalItem[];
    };
    countTasksAttention(): { needsYou: number; running: number };
    renderSubtitle(): void;
    ensureOverlayUi(): {
        teamHub: {
            renderSections(
                host: HTMLElement,
                members: WorkHubTeamMember[],
                options: {
                    searchQuery: string;
                    approvals: WorkHubApprovalItem[];
                    embedded: boolean;
                },
            ): boolean;
        };
    };
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
    hubIncrementalUi: import('./mobile-projects-hub-incremental-ui').MobileProjectsHubIncrementalUi;
    onNewClick(): Promise<void>;
    onStartNewProject(): Promise<void>;
}

/** Tasks hub inbox rendering and Agents Hub landing recents / quick-action prompts. */
export class MobileProjectsTasksHubUi {

    protected workingDetailActivityDispose: Disposable = Disposable.NULL;
    protected workingDetailActivityConversationId: string | undefined;
    protected workingDetailTaskLogDispose: Disposable = Disposable.NULL;
    protected workingDetailTaskLogTaskId: string | undefined;
    protected workingDetailTaskLogSeedToken = 0;

    constructor(protected readonly host: MobileProjectsTasksHubHost) { }

    collectAgentsHubRecentItems(projects: MobileProjectEntry[], limit = QAAP_AGENTS_HUB_RECENT_LIMIT, scopeProject?: MobileProjectEntry,): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
        return collectAgentsHubRecentItemsExtracted(this, projects, limit = QAAP_AGENTS_HUB_RECENT_LIMIT, scopeProject);
    }

    shouldEmbedAgentsHubRecentsInWorkspaceTranscript(): boolean {
        return shouldEmbedAgentsHubRecentsInWorkspaceTranscriptExtracted(this);
    }

    createAgentsHubLandingHeroBlock(): HTMLElement {
        return createAgentsHubLandingHeroBlockExtracted(this);
    }

    readQaapSignedIn(): boolean {
        return this.host.readQaapSignedIn?.() ?? readQaapSignedIn();
    }

    createAgentsHubQuickActionsBlock(): HTMLElement {
        return createAgentsHubQuickActionsBlockExtracted(this);
    }

    applyComposerQuickActionPrompt(prompt: string): void {
        applyComposerQuickActionPromptExtracted(this, prompt);
    }

    createAgentsHubRecentsBlock(project: MobileProjectEntry): HTMLElement {
        return createAgentsHubRecentsBlockExtracted(this, project);
    }

    updateTasksAttentionChrome(): void {
        updateTasksAttentionChromeExtracted(this);
    }

    updateWorkingPillChrome(): void {
        updateWorkingPillChromeExtracted(this);
    }

    openWorkingAgentsPopoverFromPill(anchor: HTMLButtonElement): void {
        openWorkingAgentsPopoverFromPillExtracted(this, anchor);
    }

    /**
     * Sticky last-known Step progress so SSE/render gaps don't unmount the pill
     * (and its open menu) while the transcript is still painting.
     */
    protected lastStepPillConversationId: string | undefined;
    protected lastStepPillProgress: ReturnType<typeof resolveTodoStepProgress> | undefined;

    updateStepPillChrome(): void {
        updateStepPillChromeExtracted(this);
    }

    protected resolveActiveConversationTodoStepProgress(): ReturnType<typeof resolveTodoStepProgress> {
        return resolveActiveConversationTodoStepProgressExtracted(this);
    }

    /**
     * Subscribe to threadStore / VPS task output for the DETAIL member so prefetch,
     * live deltas, and command log chunks repaint the Cursor-style DETAIL body.
     */
    protected bindWorkingDetailActivitySubscription(member: WorkHubTeamMember | undefined): void {
        this.bindWorkingDetailConversationSubscription(member);
        this.bindWorkingDetailTaskLogSubscription(member);
    }

    protected bindWorkingDetailConversationSubscription(member: WorkHubTeamMember | undefined): void {
        bindWorkingDetailConversationSubscriptionExtracted(this, member);
    }

    protected bindWorkingDetailTaskLogSubscription(member: WorkHubTeamMember | undefined): void {
        bindWorkingDetailTaskLogSubscriptionExtracted(this, member);
    }

    protected paintWorkingDetailTaskLog(member: WorkHubTeamMember, taskId: string, options?: { readonly loading?: boolean },): void {
        paintWorkingDetailTaskLogExtracted(this, member, taskId, options);
    }

    protected async seedWorkingDetailTaskLogFromServer(memberId: string, taskId: string): Promise<void> {
        return seedWorkingDetailTaskLogFromServerExtracted(this, memberId, taskId);
    }

    protected resolveWorkingDetailActivityFeed(member: WorkHubTeamMember): ReturnType<
        typeof resolveWorkingAgentDetailActivityFeedFromConversation
    > {
        return resolveWorkingDetailActivityFeedExtracted(this, member);
    }

    protected resolveWorkingDetailTranscriptExcerpt(member: WorkHubTeamMember): HTMLElement | undefined {
        return resolveWorkingDetailTranscriptExcerptExtracted(this, member);
    }

    protected prefetchWorkingDetailDocuments(members: readonly WorkHubTeamMember[]): void {
        prefetchWorkingDetailDocumentsExtracted(this, members);
    }

    async stopAllWorkingAgents(members: readonly WorkHubTeamMember[]): Promise<boolean> {
        return stopAllWorkingAgentsExtracted(this, members);
    }

    async stopWorkingAgent(member: WorkHubTeamMember): Promise<boolean> {
        return stopWorkingAgentExtracted(this, member);
    }

    protected async cancelWorkingConversationLikeComposerStop(conversationId: string): Promise<void> {
        return cancelWorkingConversationLikeComposerStopExtracted(this, conversationId);
    }

    protected resolveProjectForConversationId(conversationId: string): MobileProjectEntry | undefined {
        return this.host.projects.find(entry => this.host.conversationIndexUi.conversationsForProject(entry)
            .some(summary => summary.id === conversationId));
    }

    protected resolveOpenComposerConversationId(): string | undefined {
        return resolveOpenComposerConversationIdExtracted(this);
    }

    /**
     * Live working agents/subagents only — same filter as the Working expand list.
     * Do not dual-count raw `status===streaming` summaries (paused/stale rows used to
     * keep a ghost "1 Working" pill after the team member settled).
     */
    countWorkingAgentsForPill(): number {
        return filterWorkingTeamMembers(this.host.collectTeamMembersForHub()).length;
    }

    /**
     * Working agents scoped to the currently open transcript section only — the conversation
     * itself plus its forks/subagents (matched via conversationId or parentId chain). The
     * transcript composer pill is per-section, not global.
     */
    countWorkingAgentsForTranscriptPill(): number {
        const sectionMembers = this.collectTeamMembersForTranscriptSection();
        return filterWorkingTeamMembers(sectionMembers).length;
    }

    collectTeamMembersForTranscriptSection(): WorkHubTeamMember[] {
        return collectTeamMembersForTranscriptSectionExtracted(this);
    }

    protected isEmptyComposerQuickActionsSurfacePainted(): boolean {
        return isEmptyComposerQuickActionsSurfacePaintedExtracted(this);
    }

    shouldSuppressWorkingPillForEmptyComposer(): boolean {
        return shouldSuppressWorkingPillForEmptyComposerExtracted(this);
    }

    markTasksFirstLoadComplete(render: boolean): void {
        markTasksFirstLoadCompleteExtracted(this, render);
    }

    createTasksLoadingState(): HTMLElement {
        return createTasksLoadingStateExtracted(this);
    }

    createTaskSkeletonRow(): HTMLElement {
        return createTaskSkeletonRowExtracted(this);
    }

    createTasksEmptyState(): HTMLElement {
        return createTasksEmptyStateExtracted(this);
    }

    appendTasksHubTeamSection(container: HTMLElement): boolean {
        return appendTasksHubTeamSectionExtracted(this, container);
    }

    renderTasksHubView(projects: MobileProjectEntry[]): void {
        renderTasksHubViewExtracted(this, projects);
    }
}
