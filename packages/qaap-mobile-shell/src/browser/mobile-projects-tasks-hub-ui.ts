// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import {
    QAAP_AGENTS_HUB_RECENT_LIMIT,
} from '../common/qaap-agents-hub-landing';
import { type QaapComposerSurface } from '../common/qaap-composer-surface';
import { type WorkHubTeamMember } from '../common/qaap-work-hub-team';
import { type WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import { type MobileWorkHubInboxItem } from './mobile-work-hub-inbox';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectEntry } from './mobile-projects-types';
import {
    filterWorkingTeamMembers,
} from './qaap-sticky-composer-working-agents-popover';
import {
    resolveWorkingAgentDetailActivityFeedFromConversation,
} from './qaap-sticky-composer-working-detail-activity';
import {
    resolveTodoStepProgress,
} from '../common/qaap-transcript-todo-step';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import {
    EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS,
    type MobileProjectTaskHistoryDate,
    type MobileProjectTaskHistoryFilters,
    type MobileProjectTaskHistoryState,
} from './mobile-projects-task-history-filters';
import { applyComposerQuickActionPromptExtracted, bindWorkingDetailConversationSubscriptionExtracted, collectAgentsHubRecentItemsExtracted, createAgentsHubLandingHeroBlockExtracted, createAgentsHubQuickActionsBlockExtracted, createAgentsHubRecentsBlockExtracted, openWorkingAgentsPopoverFromPillExtracted, resolveActiveConversationTodoStepProgressExtracted, shouldEmbedAgentsHubRecentsInWorkspaceTranscriptExtracted, updateStepPillChromeExtracted, updateTasksAttentionChromeExtracted, updateWorkingPillChromeExtracted } from './mobile-projects-tasks-hub-ui-render';
import { bindWorkingDetailTaskLogSubscriptionExtracted, cancelWorkingConversationLikeComposerStopExtracted, collectTeamMembersForTranscriptSectionExtracted, createTaskSkeletonRowExtracted, createTasksEmptyStateExtracted, createTasksLoadingStateExtracted, isEmptyComposerQuickActionsSurfacePaintedExtracted, markTasksFirstLoadCompleteExtracted, paintWorkingDetailTaskLogExtracted, prefetchWorkingDetailDocumentsExtracted, resolveOpenComposerConversationIdExtracted, resolveWorkingDetailActivityFeedExtracted, resolveWorkingDetailTranscriptExcerptExtracted, seedWorkingDetailTaskLogFromServerExtracted, shouldSuppressWorkingPillForEmptyComposerExtracted, stopAllWorkingAgentsExtracted, stopWorkingAgentExtracted } from './mobile-projects-tasks-hub-ui-streaming';
import { appendTasksHubTeamSectionExtracted, renderTasksHubViewExtracted } from './mobile-projects-tasks-hub-ui-timeline';

/** Panel surface for Tasks hub list rendering and Agents Hub landing recents/quick actions. */
export interface MobileProjectsTasksHubHost {
    transcriptPreviewRequestPending?: boolean;
    transcriptPreviewRequestRunning?: boolean;
    resolveShellProject?(): MobileProjectEntry | undefined;
    resolveShellSummary?(project: MobileProjectEntry): QaapAgentConversationSummaryDTO | undefined;
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

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public workingDetailActivityDispose: Disposable = Disposable.NULL;
    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public workingDetailActivityConversationId: string | undefined;
    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public workingDetailTaskLogDispose: Disposable = Disposable.NULL;
    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public workingDetailTaskLogTaskId: string | undefined;
    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public workingDetailTaskLogSeedToken = 0;
    protected taskHistoryFilters: MobileProjectTaskHistoryFilters = {
        ...EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS,
    };

    constructor(
        /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
        public readonly host: MobileProjectsTasksHubHost,
    ) { }

    getTaskHistoryFilters(): MobileProjectTaskHistoryFilters {
        return { ...this.taskHistoryFilters };
    }

    setTaskHistoryFilter(key: 'projectId' | 'state' | 'date', value: string): void {
        if (key === 'projectId') {
            this.taskHistoryFilters = { ...this.taskHistoryFilters, projectId: value };
        } else if (key === 'state') {
            this.taskHistoryFilters = {
                ...this.taskHistoryFilters,
                state: value as MobileProjectTaskHistoryState,
            };
        } else {
            this.taskHistoryFilters = {
                ...this.taskHistoryFilters,
                date: value as MobileProjectTaskHistoryDate,
            };
        }
        this.host.renderList();
    }

    clearTaskHistoryFilters(): void {
        this.taskHistoryFilters = { ...EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS };
        this.host.renderList();
    }

    collectAgentsHubRecentItems(projects: MobileProjectEntry[], limit = QAAP_AGENTS_HUB_RECENT_LIMIT, scopeProject?: MobileProjectEntry,): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
        return collectAgentsHubRecentItemsExtracted(this, projects, limit, scopeProject);
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
     * @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules.
     */
    public lastStepPillConversationId: string | undefined;
    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public lastStepPillProgress: ReturnType<typeof resolveTodoStepProgress> | undefined;

    updateStepPillChrome(): void {
        updateStepPillChromeExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public resolveActiveConversationTodoStepProgress(): ReturnType<typeof resolveTodoStepProgress> {
        return resolveActiveConversationTodoStepProgressExtracted(this);
    }

    /**
     * Subscribe to threadStore / VPS task output for the DETAIL member so prefetch,
     * live deltas, and command log chunks repaint the Cursor-style DETAIL body.
     * @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules.
     */
    public bindWorkingDetailActivitySubscription(member: WorkHubTeamMember | undefined): void {
        this.bindWorkingDetailConversationSubscription(member);
        this.bindWorkingDetailTaskLogSubscription(member);
    }

    protected bindWorkingDetailConversationSubscription(member: WorkHubTeamMember | undefined): void {
        bindWorkingDetailConversationSubscriptionExtracted(this, member);
    }

    protected bindWorkingDetailTaskLogSubscription(member: WorkHubTeamMember | undefined): void {
        bindWorkingDetailTaskLogSubscriptionExtracted(this, member);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public paintWorkingDetailTaskLog(member: WorkHubTeamMember, taskId: string, options?: { readonly loading?: boolean },): void {
        paintWorkingDetailTaskLogExtracted(this, member, taskId, options);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public async seedWorkingDetailTaskLogFromServer(memberId: string, taskId: string): Promise<void> {
        return seedWorkingDetailTaskLogFromServerExtracted(this, memberId, taskId);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public resolveWorkingDetailActivityFeed(member: WorkHubTeamMember): ReturnType<
        typeof resolveWorkingAgentDetailActivityFeedFromConversation
    > {
        return resolveWorkingDetailActivityFeedExtracted(this, member);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public resolveWorkingDetailTranscriptExcerpt(member: WorkHubTeamMember): HTMLElement | undefined {
        return resolveWorkingDetailTranscriptExcerptExtracted(this, member);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public prefetchWorkingDetailDocuments(members: readonly WorkHubTeamMember[]): void {
        prefetchWorkingDetailDocumentsExtracted(this, members);
    }

    async stopAllWorkingAgents(members: readonly WorkHubTeamMember[]): Promise<boolean> {
        return stopAllWorkingAgentsExtracted(this, members);
    }

    async stopWorkingAgent(member: WorkHubTeamMember): Promise<boolean> {
        return stopWorkingAgentExtracted(this, member);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public async cancelWorkingConversationLikeComposerStop(conversationId: string): Promise<void> {
        return cancelWorkingConversationLikeComposerStopExtracted(this, conversationId);
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public resolveProjectForConversationId(conversationId: string): MobileProjectEntry | undefined {
        return this.host.projects.find(entry => this.host.conversationIndexUi.conversationsForProject(entry)
            .some(summary => summary.id === conversationId));
    }

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public resolveOpenComposerConversationId(): string | undefined {
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

    /** @internal Used by the extracted mobile-projects-tasks-hub-ui-* modules. */
    public isEmptyComposerQuickActionsSurfacePainted(): boolean {
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
