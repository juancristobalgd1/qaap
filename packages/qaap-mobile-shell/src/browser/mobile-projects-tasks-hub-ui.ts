// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
import type { MobileProjectsConversations } from './mobile-projects-conversations';

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

    collectAgentsHubRecentItems(
        projects: MobileProjectEntry[],
        limit = QAAP_AGENTS_HUB_RECENT_LIMIT,
        scopeProject?: MobileProjectEntry,
    ): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
        const query = this.host.query.trim().toLowerCase();
        const entries: Array<{
            project: MobileProjectEntry;
            summary: QaapAgentConversationSummaryDTO;
            updatedAt: number;
        }> = [];
        const scope = scopeProject ? [scopeProject] : projects;
        for (const project of scope) {
            const conversations = [
                ...this.host.conversationIndexUi.localChatsForProject(project),
                ...this.host.conversationIndexUi.vpsTasksForProject(project),
            ];
            for (const summary of conversations) {
                if (query && !this.host.hubQueryUi.conversationMatchesQuery(summary, query)) {
                    continue;
                }
                entries.push({ project, summary, updatedAt: summary.updatedAt });
            }
        }
        entries.sort((a, b) => b.updatedAt - a.updatedAt);
        return entries.slice(0, Math.max(0, limit)).map(({ project, summary }) => ({ project, summary }));
    }

    shouldEmbedAgentsHubRecentsInWorkspaceTranscript(): boolean {
        return QAAP_AGENTS_HUB_LANDING_ENABLED
            && this.host.transcriptSheet?.parentElement === document.body
            && !document.body.classList.contains('theia-mobile-mod-landing');
    }

    createAgentsHubLandingHeroBlock(): HTMLElement {
        const hero = document.createElement('section');
        hero.className = 'theia-mobile-agents-hub-landing-hero';
        hero.setAttribute(
            'aria-label',
            nls.localize('qaap/agentsHub/landingHeroAria', 'New project'),
        );

        const title = document.createElement('h2');
        title.className = 'theia-mobile-agents-hub-landing-hero-title';
        title.textContent = nls.localize('qaap/agentsHub/landingHeroTitle', 'Start something new');

        const body = document.createElement('p');
        body.className = 'theia-mobile-agents-hub-landing-hero-body';
        body.textContent = nls.localize(
            'qaap/agentsHub/landingHeroBody',
            'Create a fresh workspace and delegate the first task to an agent.',
        );

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agents-hub-landing-hero-actions';

        const startNew = document.createElement('button');
        startNew.type = 'button';
        startNew.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-primary theia-mobile-agents-hub-landing-hero-cta';
        const startNewIcon = document.createElement('span');
        startNewIcon.className = 'codicon codicon-new-folder theia-mobile-agents-hub-onboarding-btn-icon';
        startNewIcon.setAttribute('aria-hidden', 'true');
        const startNewLabel = document.createElement('span');
        startNewLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        startNewLabel.textContent = nls.localize('qaap/mobileOpenRepo/startNewProject', 'Start new project');
        startNew.append(startNewIcon, startNewLabel);
        startNew.addEventListener('click', () => { void this.host.onStartNewProject(); });

        const addRepo = document.createElement('button');
        addRepo.type = 'button';
        addRepo.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-ghost theia-mobile-agents-hub-landing-hero-secondary';
        const addRepoIcon = document.createElement('span');
        addRepoIcon.className = 'codicon codicon-repo-clone theia-mobile-agents-hub-onboarding-btn-icon';
        addRepoIcon.setAttribute('aria-hidden', 'true');
        const addRepoLabel = document.createElement('span');
        addRepoLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        addRepoLabel.textContent = nls.localize('qaap/mobileProjects/newRepository', 'Add repository');
        addRepo.append(addRepoIcon, addRepoLabel);
        addRepo.addEventListener('click', () => { void this.host.onNewClick(); });

        actions.append(startNew, addRepo);
        hero.append(title, body, actions);
        return hero;
    }

    createAgentsHubQuickActionsBlock(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'theia-mobile-agent-transcript-empty-actions';
        container.setAttribute('role', 'group');
        container.setAttribute(
            'aria-label',
            nls.localize('qaap/agentsHub/quickActions', 'Quick actions'),
        );
        for (const action of QAAP_AGENTS_HUB_QUICK_ACTIONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theia-mobile-agent-transcript-empty-action';
            const iconWrap = document.createElement('span');
            iconWrap.className = 'theia-mobile-agent-transcript-empty-action-icon';
            const icon = document.createElement('i');
            icon.className = `codicon codicon-${action.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            iconWrap.append(icon);
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-transcript-empty-action-label';
            label.textContent = nls.localize(action.labelKey, action.labelDefault);
            btn.append(iconWrap, label);
            bindStickyComposerControlClick(btn, () => {
                this.applyComposerQuickActionPrompt(nls.localize(action.promptKey, action.promptDefault));
            });
            container.append(btn);
        }
        return container;
    }

    applyComposerQuickActionPrompt(prompt: string): void {
        const trimmed = prompt.trim();
        if (!trimmed) {
            return;
        }
        if (this.host.transcriptComposerHost?.isConnected) {
            this.host.transcriptComposerDraft = trimmed;
            this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
            this.host.transcriptMessagesUi.focusTranscriptComposerInput();
            return;
        }
        this.host.stickyComposerDraft = trimmed;
        this.host.stickyComposerRenderUi.renderStickyComposer();
        window.requestAnimationFrame(() => {
            const input = this.host.stickyComposerHost?.querySelector<HTMLTextAreaElement>(
                '.theia-mobile-projects-sticky-composer-input',
            );
            if (!input) {
                return;
            }
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
        });
    }

    createAgentsHubRecentsBlock(project: MobileProjectEntry): HTMLElement {
        const recents = this.collectAgentsHubRecentItems(this.host.projects, QAAP_AGENTS_HUB_RECENT_LIMIT, project);
        const block = document.createElement('section');
        block.className = 'theia-mobile-agents-hub-landing theia-mod-transcript-recents';
        if (recents.length === 0) {
            return block;
        }
        const head = document.createElement('div');
        head.className = 'theia-mobile-agents-hub-landing-section-head';
        const label = document.createElement('span');
        label.className = 'theia-mobile-agents-hub-landing-section-label q-overline';
        label.textContent = nls.localize('qaap/agentsHub/sessionsSection', 'Sessions');
        const count = document.createElement('span');
        count.className = 'theia-mobile-agents-hub-landing-section-count';
        count.textContent = String(recents.length);
        head.append(label, count);
        const list = document.createElement('div');
        list.className = 'theia-mobile-projects-chats-list theia-mobile-agents-hub-landing-list';
        const parentIds = new Set<string>();
        for (const entry of recents) {
            if (entry.summary.forkedFromId) {
                parentIds.add(entry.summary.forkedFromId);
            }
        }
        const activeInfo = this.host.conversationIndexUi.activeInfoForProject(project);
        for (const { summary } of recents) {
            const task = this.host.conversationIndexUi.summaryToTaskView(summary);
            list.append(this.host.projectRowsUi.createTaskItem(project, task, activeInfo, summary, parentIds));
        }
        block.append(head, list);
        const viewAll = document.createElement('button');
        viewAll.type = 'button';
        viewAll.className = 'theia-mobile-agents-hub-landing-view-all';
        viewAll.textContent = nls.localize('qaap/agentsHub/viewAllSessions', 'View all sessions');
        viewAll.addEventListener('click', () => {
            this.host.openWorkHubSessionsSidebar();
        });
        block.append(viewAll);
        return block;
    }

    updateTasksAttentionChrome(): void {
        this.updateWorkingPillChrome();
        if (!this.host.homeMode || !this.host.hubQueryUi.isTasksHubView() || this.host.tasksHubSurface === 'chat' || this.host.shouldUseAgentsHubLanding()) {
            this.host.titleAttentionEl.hidden = true;
            this.host.titleAttentionEl.setAttribute('aria-hidden', 'true');
            return;
        }
        const { needsYou } = this.host.countTasksAttention();
        if (needsYou <= 0) {
            this.host.titleAttentionEl.hidden = true;
            this.host.titleAttentionEl.setAttribute('aria-hidden', 'true');
            return;
        }
        this.host.titleAttentionEl.hidden = false;
        this.host.titleAttentionEl.setAttribute('aria-hidden', 'false');
        this.host.titleAttentionEl.textContent = String(needsYou);
        this.host.titleAttentionEl.title = nls.localize(
            'qaap/mobileProjects/tasksAttentionTitle',
            '{0} tasks need your attention',
            String(needsYou),
        );
    }

    /**
     * Cursor-style "N Working" pill above the sticky composer (Changes/Commit row).
     * Visible when ≥1 agent is actively working; click expands the agents panel in place.
     *
     * Important: do NOT gate the count on `isTasksHubView()`. Transcript overlays leave the
     * tasks-hub surface while the sticky composer (and open Working menu) stay mounted —
     * forcing count=0 there was closing the expand panel on every transcript re-render.
     */
    updateWorkingPillChrome(): void {
        const rawCount = this.countWorkingAgentsForPill();
        noteWorkingPillChromeCount(rawCount);
        // After Stop All, hide the pill until a new live working agent appears (attention
        // count can lag behind cancel; reading-retain must not keep "1 Working").
        const realCount = isWorkingPillSuppressedAfterStopAll() ? 0 : rawCount;
        const reading = isWorkingAgentsExpandPinnedOpen() && !isWorkingPillSuppressedAfterStopAll();
        // Never auto-collapse while the user is reading (list or detail). Summary/settled
        // often drops the working count to 0 (streaming → idle); only ✕ / Escape / Stop All
        // / pill toggle may close in that case.
        if (realCount <= 0 && !reading) {
            closeWorkingAgentsPopover(true);
        }
        // Keep chrome alive while home/transcript composers exist, or while an expand session
        // is still open (pill may be briefly parked during remount).
        const composerMounted = !!(
            this.host.stickyComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-inner')
            || this.host.transcriptComposerHost?.querySelector('.theia-mobile-projects-sticky-composer-inner')
        );
        const count = (realCount > 0 || reading)
            && (this.host.homeMode || composerMounted || reading)
            ? Math.max(realCount, reading ? 1 : 0)
            : 0;
        syncStickyComposerWorkingPillInRoots(
            [this.host.stickyComposerHost, this.host.transcriptComposerHost],
            {
                count,
                forceHide: isWorkingPillSuppressedAfterStopAll(),
                onOpen: anchor => this.openWorkingAgentsPopoverFromPill(anchor),
            },
        );
        this.updateStepPillChrome();
        if (count > 0 || reading) {
            const roots = [this.host.stickyComposerHost, this.host.transcriptComposerHost];
            let pill: HTMLButtonElement | undefined;
            for (const root of roots) {
                const candidate = root?.querySelector<HTMLButtonElement>('.theia-mobile-sticky-composer-working-pill');
                if (candidate) {
                    pill = candidate;
                    break;
                }
            }
            const members = this.host.collectTeamMembersForHub();
            if (pill && (isWorkingAgentsPopoverOpen() || isWorkingAgentsExpandSessionOpen())) {
                restoreWorkingAgentsExpandIfNeeded({
                    anchor: pill,
                    members,
                    transcriptOverlay: !!pill.closest('.theia-mobile-agent-transcript-root'),
                    onSelect: member => this.host.onTeamMemberClick(member),
                    onStopAll: working => {
                        void this.stopAllWorkingAgents(working);
                    },
                    resolveDetailActivityFeed: member => this.resolveWorkingDetailActivityFeed(member),
                    onDetailMemberChange: member => this.bindWorkingDetailActivitySubscription(member),
                });
            } else if (isWorkingAgentsPopoverOpen()) {
                syncWorkingAgentsExpandContent(members);
            }
        }
    }

    openWorkingAgentsPopoverFromPill(anchor: HTMLButtonElement): void {
        const members = this.host.collectTeamMembersForHub();
        const transcriptOverlay = !!anchor.closest('.theia-mobile-agent-transcript-root');
        this.prefetchWorkingDetailDocuments(members);
        openWorkingAgentsPopover({
            anchor,
            members,
            transcriptOverlay,
            onSelect: member => this.host.onTeamMemberClick(member),
            onStopAll: working => {
                void this.stopAllWorkingAgents(working);
            },
            resolveDetailActivityFeed: member => this.resolveWorkingDetailActivityFeed(member),
            onDetailMemberChange: member => this.bindWorkingDetailActivitySubscription(member),
        });
    }

    /**
     * Sticky last-known Step progress so SSE/render gaps don't unmount the pill
     * (and its open menu) while the transcript is still painting.
     */
    protected lastStepPillConversationId: string | undefined;
    protected lastStepPillProgress: ReturnType<typeof resolveTodoStepProgress> | undefined;

    /**
     * "Step X/Y" pill to the right of Working when the active conversation has a
     * parseable TodoWrite checklist. Hover/click opens the plan to-do menu.
     */
    updateStepPillChrome(): void {
        const progress = this.resolveActiveConversationTodoStepProgress();
        syncStickyComposerStepPillInRoots(
            [this.host.stickyComposerHost, this.host.transcriptComposerHost],
            { progress },
        );
    }

    protected resolveActiveConversationTodoStepProgress(): ReturnType<typeof resolveTodoStepProgress> {
        const summary = this.host.transcriptComposerSummary ?? this.host.transcriptOpenSummary;
        const conversationId = summary?.id?.trim();
        if (!conversationId) {
            this.lastStepPillConversationId = undefined;
            this.lastStepPillProgress = undefined;
            return undefined;
        }
        const document = this.host.conversations?.threadStore.getDocument(conversationId);
        const liveConv = this.host.transcriptLastConv?.id === conversationId
            ? this.host.transcriptLastConv
            : undefined;
        const messages = document?.messages?.length
            ? document.messages
            : liveConv?.messages;
        if (!messages?.length) {
            // Best-effort warm: live/chrome refresh will re-sync once the doc lands.
            this.host.conversations?.prefetchDocument(conversationId);
            // Keep the previous Step chrome for this conversation during transient gaps.
            if (this.lastStepPillConversationId === conversationId) {
                return this.lastStepPillProgress;
            }
            return undefined;
        }
        const items = resolveLatestTranscriptTodos(messages);
        const progress = items ? resolveTodoStepProgress(items) : undefined;
        this.lastStepPillConversationId = conversationId;
        this.lastStepPillProgress = progress;
        return progress;
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
        const conversationId = member?.conversationId?.trim();
        if (!conversationId || !member) {
            this.workingDetailActivityDispose.dispose();
            this.workingDetailActivityDispose = Disposable.NULL;
            this.workingDetailActivityConversationId = undefined;
            return;
        }
        if (this.workingDetailActivityConversationId === conversationId
            && this.workingDetailActivityDispose !== Disposable.NULL) {
            // Same live thread — keep the existing subscription; still warm the cache.
            this.host.conversations?.prefetchDocument(conversationId);
            refreshWorkingAgentsDetailActivityFeed();
            return;
        }
        this.workingDetailActivityDispose.dispose();
        this.workingDetailActivityConversationId = conversationId;
        const conversations = this.host.conversations;
        if (!conversations) {
            this.workingDetailActivityDispose = Disposable.NULL;
            return;
        }
        const memberId = member.id;
        conversations.prefetchDocument(conversationId);
        this.workingDetailActivityDispose = conversations.threadStore.subscribe(
            () => {
                if (getWorkingAgentsDetailMemberId() !== memberId) {
                    return;
                }
                refreshWorkingAgentsDetailActivityFeed();
            },
            snapshot => snapshot.document,
            conversationId,
        );
    }

    /**
     * Live VPS command output for DETAIL members without a conversationId.
     * Seeds from HTTP detail when opening mid-run, then appends WS `output` chunks.
     */
    protected bindWorkingDetailTaskLogSubscription(member: WorkHubTeamMember | undefined): void {
        const taskId = shouldShowWorkingDetailTaskLog(member ?? {})
            ? member?.taskId?.trim()
            : undefined;
        if (!taskId || !member) {
            this.workingDetailTaskLogDispose.dispose();
            this.workingDetailTaskLogDispose = Disposable.NULL;
            this.workingDetailTaskLogTaskId = undefined;
            this.workingDetailTaskLogSeedToken++;
            return;
        }
        if (this.workingDetailTaskLogTaskId === taskId
            && this.workingDetailTaskLogDispose !== Disposable.NULL) {
            this.paintWorkingDetailTaskLog(member, taskId);
            return;
        }
        this.workingDetailTaskLogDispose.dispose();
        this.workingDetailTaskLogTaskId = taskId;
        const activeTasks = this.host.activeTasks;
        const memberId = member.id;
        const disposables: Disposable[] = [];

        const paint = (): void => {
            if (getWorkingAgentsDetailMemberId() !== memberId) {
                return;
            }
            this.paintWorkingDetailTaskLog(member, taskId);
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
        this.workingDetailTaskLogDispose = Disposable.create(() => {
            for (const disposable of disposables) {
                disposable.dispose();
            }
        });
        void this.seedWorkingDetailTaskLogFromServer(memberId, taskId);
    }

    protected paintWorkingDetailTaskLog(
        member: WorkHubTeamMember,
        taskId: string,
        options?: { readonly loading?: boolean },
    ): void {
        const live = getWorkingAgentsDetailMember()
            ?? this.host.collectTeamMembersForHub().find(entry => entry.id === member.id)
            ?? member;
        const tail = this.host.activeTasks?.getTaskLogTail(taskId);
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

    protected async seedWorkingDetailTaskLogFromServer(memberId: string, taskId: string): Promise<void> {
        const token = ++this.workingDetailTaskLogSeedToken;
        const activeTasks = this.host.activeTasks;
        const memberForLoading = this.host.collectTeamMembersForHub()
            .find(entry => entry.id === memberId);
        const existingTail = activeTasks?.getTaskLogTail(taskId);
        if (!existingTail?.text?.trim() && memberForLoading) {
            this.paintWorkingDetailTaskLog(memberForLoading, taskId, { loading: true });
        }
        try {
            const detail = await fetchAgentTaskDetail(taskId);
            if (token !== this.workingDetailTaskLogSeedToken
                || getWorkingAgentsDetailMemberId() !== memberId
                || this.workingDetailTaskLogTaskId !== taskId) {
                return;
            }
            const seeded = activeTasks
                ? activeTasks.seedTaskLog(taskId, detail.log ?? '')
                : { taskId, text: detail.log ?? '', truncated: false };
            const member = this.host.collectTeamMembersForHub()
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
            if (token === this.workingDetailTaskLogSeedToken
                && getWorkingAgentsDetailMemberId() === memberId
                && memberForLoading) {
                this.paintWorkingDetailTaskLog(memberForLoading, taskId, { loading: false });
            }
        }
    }

    protected resolveWorkingDetailActivityFeed(member: WorkHubTeamMember): ReturnType<
        typeof resolveWorkingAgentDetailActivityFeedFromConversation
    > {
        const conversationId = member.conversationId?.trim();
        if (conversationId) {
            this.host.conversations?.prefetchDocument(conversationId);
        }
        const conversations = this.host.conversations;
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
        return resolveWorkingAgentDetailActivityFeedFromConversation(document, member, {
            liveSegments,
        });
    }

    protected prefetchWorkingDetailDocuments(members: readonly WorkHubTeamMember[]): void {
        const conversations = this.host.conversations;
        if (!conversations) {
            return;
        }
        const ids = filterWorkingTeamMembers(members)
            .map(member => member.conversationId?.trim())
            .filter((id): id is string => !!id);
        conversations.prefetchDocuments(ids);
    }

    /**
     * Stop All = composer Stop for every working agent/session, then clear Working chrome.
     * Uses {@link MobileProjectsTasksHubHost.onCancelConversation} (same as sticky-composer
     * `onStop`) plus task cancel for running VPS subtasks without a conversation id.
     */
    async stopAllWorkingAgents(members: readonly WorkHubTeamMember[]): Promise<void> {
        const errors: string[] = [];
        const cancelledConversationIds = new Set<string>();
        const cancelJobs: Promise<void>[] = [];

        // 1) Always stop the open sticky-composer / transcript session first (composer Stop).
        const stoppedOpen = this.host.transcriptStickyComposerUi.stopOpenComposerAgentLikeComposerStop();
        const openComposerId = this.resolveOpenComposerConversationId();
        if (stoppedOpen && openComposerId) {
            cancelledConversationIds.add(openComposerId);
        }

        // 2) Live hub members + expand snapshot (prefer live — snapshot can be stale/idle-retained).
        const liveWorking = filterWorkingTeamMembers(this.host.collectTeamMembersForHub());
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
                cancelJobs.push(this.cancelWorkingConversationLikeComposerStop(member.conversationId)
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
                'Could not stop all agents: {0}',
                errors[0],
            );
            this.host.messageService?.error(message);
        }
        // Stop All clears reading retain + pill immediately (do not keep "1 Working").
        dismissWorkingAgentsExpandForStopAll();
        this.host.transcriptComposerSendRefresh?.();
        this.updateWorkingPillChrome();
    }

    /**
     * Composer Stop for one conversation id: resolve summary via index, then
     * {@link MobileProjectsTasksHubHost.onCancelConversation} (WS/HTTP cancel inside).
     */
    protected async cancelWorkingConversationLikeComposerStop(conversationId: string): Promise<void> {
        const summary = this.host.conversationIndexUi.findSummaryById(conversationId);
        const project = this.resolveProjectForConversationId(conversationId);
        if (project && summary) {
            this.host.onCancelConversation(project, summary);
            return;
        }
        // Fallback: same transport as onCancelConversation's VPS branch (live WS → HTTP).
        await cancelConversation(conversationId);
    }

    protected resolveProjectForConversationId(conversationId: string): MobileProjectEntry | undefined {
        return this.host.projects.find(entry => this.host.conversationIndexUi.conversationsForProject(entry)
            .some(summary => summary.id === conversationId));
    }

    protected resolveOpenComposerConversationId(): string | undefined {
        const summary = this.host.transcriptComposerSummary ?? this.host.transcriptOpenSummary;
        if (!summary || isAgentsHubIdleConversationSummary(summary)) {
            return undefined;
        }
        return summary.id;
    }

    /**
     * Live working agents/subagents only — same filter as the Working expand list.
     * Do not dual-count raw `status===streaming` summaries (paused/stale rows used to
     * keep a ghost "1 Working" pill after the team member settled).
     */
    countWorkingAgentsForPill(): number {
        return filterWorkingTeamMembers(this.host.collectTeamMembersForHub()).length;
    }

    /** Flips the one-shot first-load flag once conversations arrive or the safety timeout fires. */
    markTasksFirstLoadComplete(render: boolean): void {
        if (this.host.tasksFirstLoadFallback !== undefined) {
            window.clearTimeout(this.host.tasksFirstLoadFallback);
            this.host.tasksFirstLoadFallback = undefined;
        }
        if (!this.host.tasksFirstLoadPending) {
            return;
        }
        this.host.tasksFirstLoadPending = false;
        if (render && this.host.visible && this.host.hubQueryUi.isTasksHubView()) {
            this.host.renderList();
        }
    }

    createTasksLoadingState(): HTMLElement {
        const list = document.createElement('div');
        list.className = 'theia-mobile-tasks-skeleton-list';
        list.setAttribute('aria-busy', 'true');
        list.setAttribute('aria-label', nls.localize('qaap/mobileProjects/tasksLoading', 'Loading tasks…'));
        for (let i = 0; i < 4; i++) {
            list.append(this.createTaskSkeletonRow());
        }
        return list;
    }

    createTaskSkeletonRow(): HTMLElement {
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

    createTasksEmptyState(): HTMLElement {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-projects-empty';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-server-process';
        const title = document.createElement('strong');
        title.textContent = this.host.query
            ? nls.localize('qaap/mobileProjects/noTasksSearchResults', 'No matching tasks')
            : nls.localize('qaap/mobileProjects/noTasks', 'No VPS tasks yet');
        const body = document.createElement('span');
        body.textContent = this.host.query
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

    appendTasksHubTeamSection(container: HTMLElement): boolean {
        const { members, filteredApprovals } = this.host.getFilteredTeamHubState();
        const teamHost = document.createElement('div');
        teamHost.className = 'theia-mobile-hub-team-root theia-mod-embedded-in-tasks';
        const rendered = this.host.ensureOverlayUi().teamHub.renderSections(teamHost, members, {
            searchQuery: this.host.query,
            approvals: filteredApprovals,
            embedded: true,
        });
        if (rendered) {
            container.append(teamHost);
        }
        return rendered;
    }

    renderTasksHubView(projects: MobileProjectEntry[]): void {
        if (this.host.shouldUseAgentsHubLanding()) {
            void projects;
            this.host.renderAgentsHubExecutionShell();
            return;
        }
        if (this.host.agentsHubShellActive) {
            this.host.teardownAgentsHubExecutionShell();
        }
        const root = document.createElement('div');
        root.className = 'theia-mobile-tasks-hub-root';
        if (this.host.tasksHubSurface === 'chat') {
            const groups = this.host.collectChatHubGroups(projects);
            if (groups.length === 0) {
                root.append(this.host.createChatEmptyState());
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
                    host.append(this.host.createInboxProjectGroup(group.project, items));
                }
                root.append(host);
            }
            this.host.hubIncrementalUi.rememberRenderedStructure('chat-inbox', groups.map(group => ({
                project: group.project,
                items: group.summaries.map(summary => ({
                    kind: 'conversation' as const,
                    project: group.project,
                    summary,
                    sortAt: summary.updatedAt,
                    priority: 0,
                })),
            })));
            this.host.scroll.append(root);
            this.updateTasksAttentionChrome();
            this.host.renderSubtitle();
            return;
        }

        const groups = this.host.collectTasksInboxGroups(projects);
        const teamRendered = this.appendTasksHubTeamSection(root);

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
                inbox.append(this.host.createInboxProjectGroup(group.project, group.items));
            }
            root.append(inbox);
            this.host.hubIncrementalUi.rememberRenderedStructure('tasks-inbox', groups, { teamEmbedded: teamRendered });
        }

        if (!teamRendered && groups.length === 0) {
            if (this.host.tasksFirstLoadPending && !this.host.query.trim()) {
                root.append(this.createTasksLoadingState());
            } else {
                root.append(this.createTasksEmptyState());
            }
        }
        this.host.scroll.append(root);
        this.updateTasksAttentionChrome();
        this.host.renderSubtitle();
    }
}
