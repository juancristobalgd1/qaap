// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickPickItem } from '@theia/core/lib/browser';
import {
    readStoredAgent,
    SHELL_AGENT_ID,
} from '../common/qaap-agent-task-client';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { QAAP_WORK_HUB_GETTING_STARTED } from '../common/mobile-work-hub-catalog';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { buildQaapAccountMenuEntries, toggleQaapAccountMenu, type MobileViewToggleId } from './qaap-workbench-account-menu';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileWorkHubSessionsSidebar, isDesktopSessionsSidebarLayout } from './mobile-work-hub-sessions-sidebar';
import {
    buildWorkHubSessionsSidebarRowFingerprint,
    buildWorkHubSessionsSidebarVisibleStructureFingerprint,
    QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR,
    QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR,
    type WorkHubSessionsSidebarFingerprintInput,
} from '../common/qaap-work-hub-sessions-sidebar-fingerprint';
import { resolveQaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import {
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
    resolveSessionsSidebarInitialConversationLimit,
} from '../common/qaap-sessions-sidebar-conversation-limit';

export const MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT = QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT;
export const MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE = QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE;
/** Pause live sidebar sync while the user taps a row (prevents click loss). */
const SESSIONS_SIDEBAR_INTERACTION_GUARD_MS = 900;
/** Min interval between live sidebar refreshes during SSE (~4 fps). */
const SESSIONS_SIDEBAR_STREAM_REFRESH_MS = 250;

export interface MobileProjectsSessionsSidebarHost {
    sessionsSidebar: MobileWorkHubSessionsSidebar | undefined;
    sessionsSidebarExpandedProjectIds: Set<string>;
    sessionsSidebarVisibleConversationCountByProjectId: Map<string, number>;
    sessionsSidebarAccordionDefaultsApplied: boolean;
    sessionsSidebarContainer?: () => HTMLElement | undefined;
    projects: MobileProjectEntry[];
    query: string;
    transcriptOpenSummaryId: string | undefined;
    activeTasks?: import('./mobile-projects-active-tasks').MobileProjectsActiveTasks;
    conversations?: import('./mobile-projects-conversations').MobileProjectsConversations;
    projectsService: import('./mobile-projects-service').MobileProjectsService;
    commands: import('@theia/core/lib/common/command').CommandRegistry;
    quickInputService?: import('@theia/core/lib/browser').QuickInputService;
    delegate: {
        onProjectOpenInIde?(project: MobileProjectEntry): void | Promise<void>;
        onShowRoutinesHub?(): void | Promise<void>;
        cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
        projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
    };

    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    chatServiceSummariesUi: import('./mobile-projects-chat-service-summaries-ui').MobileProjectsChatServiceSummariesUi;
    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
    projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
    compareChatInboxProjectOrder(a: MobileProjectEntry, b: MobileProjectEntry): number;
    createTaskItem(
        project: MobileProjectEntry,
        task: import('./mobile-projects-active-tasks').MobileProjectTaskView,
        activeInfo: ReturnType<import('./mobile-projects-active-tasks').MobileProjectsActiveTasks['getForCwd']>,
        summary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO | undefined,
        parentIds: ReadonlySet<string>,
        options?: { onActivate?: () => void; compact?: boolean },
    ): HTMLElement;
    buildProjectOptionsMenu(project: MobileProjectEntry): HTMLElement;
    toggleCardMenu(row: HTMLElement, menu: HTMLElement, menuBtn: HTMLButtonElement): void;
    buildProjectOptionsMenu(project: MobileProjectEntry): HTMLElement;
    toggleCardMenu(row: HTMLElement, menu: HTMLElement, menuBtn: HTMLButtonElement): void;
    resolveHomePinnedProject(): MobileProjectEntry | undefined;
    shouldUseAgentsHubLanding(): boolean;
    isProjectDetailView(): boolean;
    transcriptSheet: HTMLElement | undefined;
    agentsHubInlineActive: boolean;
    agentsHubSelectedProjectId: string | undefined;
    visible: boolean;
    transcriptSheetUi: import('./mobile-projects-transcript-sheet-ui').MobileProjectsTranscriptSheetUi;
    transcriptStickyComposerUi: import('./mobile-projects-transcript-sticky-composer-ui').MobileProjectsTranscriptStickyComposerUi;
    executionSurfaceTabsUi: import('./mobile-projects-execution-surface-tabs-ui').MobileProjectsExecutionSurfaceTabsUi;
    closeAgentsHubSession(): void;
    resetAgentsHubIdleTranscriptShell(project: MobileProjectEntry): void;
    renderHeader(): void;
    renderSubtitle(): void;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    closeCurrentWorkspace(): Promise<void>;
    openConversationSummary(project: MobileProjectEntry, summary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO): Promise<void>;
    runCatalogAction(action: import('../common/mobile-work-hub-catalog').WorkHubCatalogAction): Promise<void>;
    onNewClick(): Promise<void>;
    onStartNewProject(): Promise<void>;
}

interface SessionsSidebarConversationEntry {
    readonly project: MobileProjectEntry;
    readonly summary: QaapAgentConversationSummaryDTO;
    readonly pinned: boolean;
    readonly parentIds: ReadonlySet<string>;
    readonly onActivate?: () => void;
}

function cssEscapeAttribute(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
}

export class MobileProjectsSessionsSidebarUi {
    constructor(protected readonly host: MobileProjectsSessionsSidebarHost) { }

    protected sessionsSidebarListFingerprint = '';
    protected sessionsSidebarOpeningConversationId: string | undefined;
    protected sessionsSidebarOpeningTimer: number | undefined;
    protected sessionsSidebarInteractionUntil = 0;
    protected sessionsSidebarLastStreamRefreshAt = 0;
    protected sessionsSidebarInteractionBound = false;
    protected sessionsSidebarThreadStoreDispose: Disposable = Disposable.NULL;

    openWorkHubSessionsSidebar(): void {
        const sidebar = this.ensureWorkHubSessionsSidebar();
        if (!sidebar.isVisible()) {
            sidebar.show();
        }
        void this.prepareSessionsSidebarData().then(() => {
            sidebar.refreshList({ force: true });
        });
    }
    toggleWorkHubSessionsSidebar(): void {
        const sidebar = this.ensureWorkHubSessionsSidebar();
        if (sidebar.isVisible()) {
            sidebar.hide();
            return;
        }
        sidebar.show();
        void this.prepareSessionsSidebarData().then(() => {
            sidebar.refreshList({ force: true });
        });
    }
    async prepareSessionsSidebarData(): Promise<void> {
        this.host.activeTasks?.start();
        this.host.conversations?.start();
        try {
            this.host.projects = await this.host.projectsService.loadProjects();
        } catch {
            /* keep in-memory list */
        }
        await this.host.conversations?.refreshTheiaChatSessionsForProjects(this.host.projects);
        await this.host.chatServiceSummariesUi.refreshChatServiceSessionSummaries();
    }
    isWorkHubSessionsSidebarVisible(): boolean {
        return this.host.sessionsSidebar?.isVisible() === true;
    }
    ensureWorkHubSessionsSidebar(): MobileWorkHubSessionsSidebar {
        if (!this.host.sessionsSidebar) {
            this.host.sessionsSidebar = new MobileWorkHubSessionsSidebar({
                renderSessionList: host => this.renderWorkHubSessionsSidebarList(host),
                shouldSkipSessionListRefresh: () => this.shouldSkipSessionsSidebarListRender(),
                tryPatchSessionList: host => this.tryPatchSessionsSidebarList(host),
                rememberSessionListFingerprint: host => this.rememberSessionsSidebarListFingerprint(host),
                shouldDeferSessionListRefresh: () => this.shouldDeferSessionsSidebarListRefresh(),
                onSessionListHostReady: host => {
                    this.bindSessionsSidebarInteractionGuard(host);
                    this.bindSessionsSidebarThreadStoreSubscriptions();
                },
                onNewChat: () => { void this.onWorkHubSessionsSidebarNewChat(); },
                onStartNewProject: () => { void this.host.onStartNewProject(); },
                onClose: () => {
                    this.host.cardMenuUi.closeCardMenu();
                },
                storageScope: () => this.host.projectsService.getCurrentWorkspaceCwd(),
                onAccountMenu: anchor => { this.onSessionsSidebarAccountClick(anchor); },
                onSearch: () => { void this.openSessionsSidebarSearch(); },
                onExtensions: () => { void this.host.commands.executeCommand('workbench.view.extensions'); },
                onAutomations: () => { void this.onWorkHubSessionsSidebarAutomations(); },
                isEmbedded: () => (!isDesktopSessionsSidebarLayout() || document.body.classList.contains('theia-mobile-mod-desktop-ide')) && this.host.sessionsSidebarContainer?.() !== undefined,
            });
        }
        const useBodyGrid = isDesktopSessionsSidebarLayout()
            && !document.body.classList.contains('theia-mobile-mod-desktop-ide');
        const container = useBodyGrid
            ? document.body
            : (this.host.sessionsSidebarContainer?.() ?? document.body);
        if (this.host.sessionsSidebar.node.parentElement !== container) {
            container.append(this.host.sessionsSidebar.node);
        }
        return this.host.sessionsSidebar;
    }

    protected buildSessionsSidebarFingerprintInput(): WorkHubSessionsSidebarFingerprintInput {
        const pinnedConversationIds = new Set<string>();
        for (const project of this.host.projects) {
            for (const summary of this.host.conversationIndexUi.conversationsForProject(project)) {
                if (this.isSessionsSidebarPinnedConversation(summary)) {
                    pinnedConversationIds.add(summary.id);
                }
            }
        }
        return {
            query: this.host.query,
            transcriptOpenSummaryId: this.host.transcriptOpenSummaryId,
            expandedProjectIds: this.host.sessionsSidebarExpandedProjectIds,
            visibleConversationCountByProjectId: this.host.sessionsSidebarVisibleConversationCountByProjectId,
            projects: this.host.projects.map(project => ({
                id: project.id,
                isCurrent: project.isCurrent,
            })),
            conversationsForProject: projectId => {
                const project = this.host.projects.find(entry => entry.id === projectId);
                if (!project) {
                    return [];
                }
                return this.host.conversationIndexUi.conversationsForProject(project);
            },
            pinnedConversationIds,
        };
    }

    shouldSkipSessionsSidebarListRender(): boolean {
        if (!this.sessionsSidebarListFingerprint) {
            return false;
        }
        if (this.sessionsSidebarOpeningConversationId) {
            return true;
        }
        if (this.isSessionsSidebarInteractionGuardActive()) {
            return true;
        }
        return false;
    }

    shouldDeferSessionsSidebarListRefresh(): boolean {
        if (this.isSessionsSidebarInteractionGuardActive()) {
            return true;
        }
        const now = Date.now();
        if (now - this.sessionsSidebarLastStreamRefreshAt < SESSIONS_SIDEBAR_STREAM_REFRESH_MS) {
            return true;
        }
        this.sessionsSidebarLastStreamRefreshAt = now;
        return false;
    }

    protected isSessionsSidebarInteractionGuardActive(): boolean {
        return Date.now() < this.sessionsSidebarInteractionUntil;
    }

    protected bindSessionsSidebarInteractionGuard(listHost: HTMLElement): void {
        if (this.sessionsSidebarInteractionBound) {
            return;
        }
        this.sessionsSidebarInteractionBound = true;
        const arm = (): void => {
            this.sessionsSidebarInteractionUntil = Date.now() + SESSIONS_SIDEBAR_INTERACTION_GUARD_MS;
        };
        listHost.addEventListener('pointerdown', arm, { capture: true });
        listHost.addEventListener('touchstart', arm, { capture: true, passive: true });
    }

    protected buildSessionsSidebarStructureFingerprint(): string {
        const projects = [...this.host.projects].sort((a, b) => this.host.compareChatInboxProjectOrder(a, b));
        const query = this.host.query.trim().toLowerCase();
        const pinnedGroups = this.collectSessionsSidebarPinnedGroups(projects, query);
        const visibleProjectGroupIds: string[] = [];
        for (const project of projects) {
            let conversations = [...this.host.conversationIndexUi.conversationsForProject(project)]
                .filter(summary => !this.isSessionsSidebarPinnedConversation(summary))
                .sort((a, b) => this.host.conversationIndexUi.compareConversationOrder(a, b));
            if (query) {
                conversations = conversations.filter(c => this.host.hubQueryUi.conversationMatchesQuery(c, query));
                if (conversations.length === 0) {
                    continue;
                }
            } else if (conversations.length === 0) {
                continue;
            }
            visibleProjectGroupIds.push(project.id);
        }
        const visibleSlots = this.collectSessionsSidebarConversationEntries().map(entry => ({
            projectId: entry.project.id,
            conversation: entry.summary,
            pinned: entry.pinned,
        }));
        return buildWorkHubSessionsSidebarVisibleStructureFingerprint({
            query,
            transcriptOpenSummaryId: this.host.transcriptOpenSummaryId,
            expandedProjectIds: this.host.sessionsSidebarExpandedProjectIds,
            visibleConversationCountByProjectId: this.host.sessionsSidebarVisibleConversationCountByProjectId,
            visibleProjectGroupIds,
            pinnedSectionProjectIds: pinnedGroups.map(group => group.project.id),
            visibleSlots,
        });
    }

    rememberSessionsSidebarListFingerprint(listHost: HTMLElement): void {
        const structure = this.buildSessionsSidebarStructureFingerprint();
        this.sessionsSidebarListFingerprint = structure;
        listHost.setAttribute(QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR, structure);
        this.stampSessionsSidebarRowFingerprints(listHost);
    }

    tryPatchSessionsSidebarList(listHost: HTMLElement): boolean {
        if (this.isSessionsSidebarInteractionGuardActive()) {
            return true;
        }
        const structure = this.buildSessionsSidebarStructureFingerprint();
        if (listHost.getAttribute(QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR) !== structure) {
            return false;
        }
        let patchedAny = false;
        const entries = this.collectSessionsSidebarConversationEntries();
        for (const entry of entries) {
            const nextFingerprint = this.buildSidebarRowFingerprint(entry);
            const existingRow = listHost.querySelector<HTMLElement>(
                `.theia-mobile-projects-task-row[data-qaap-conversation-id="${cssEscapeAttribute(entry.summary.id)}"]`,
            );
            if (!existingRow) {
                return false;
            }
            if (existingRow.getAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR) === nextFingerprint) {
                if (entry.summary.status === 'streaming') {
                    const task = this.host.conversationIndexUi.summaryToTaskView(entry.summary);
                    if (this.host.projectRowsUi.patchSidebarCompactTaskRow(existingRow, entry.project, task, entry.summary, {
                        isCurrent: this.host.transcriptOpenSummaryId === entry.summary.id,
                    })) {
                        patchedAny = true;
                    }
                }
                continue;
            }
            const task = this.host.conversationIndexUi.summaryToTaskView(entry.summary);
            if (this.host.projectRowsUi.patchSidebarCompactTaskRow(existingRow, entry.project, task, entry.summary, {
                isCurrent: this.host.transcriptOpenSummaryId === entry.summary.id,
            })) {
                existingRow.setAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR, nextFingerprint);
                patchedAny = true;
                continue;
            }
            const parentIds = entry.parentIds;
            const activeInfo = this.host.conversationIndexUi.activeInfoForProject(entry.project);
            const nextRow = this.host.projectRowsUi.createTaskItem(
                entry.project,
                task,
                activeInfo,
                entry.summary,
                parentIds,
                {
                    compact: true,
                    onActivate: () => {
                        this.beginSessionsSidebarConversationActivation(entry.summary.id);
                        entry.onActivate?.();
                    },
                },
            );
            nextRow.setAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR, nextFingerprint);
            existingRow.replaceWith(nextRow);
            patchedAny = true;
        }
        if (patchedAny) {
            listHost.classList.add('theia-mod-live-sync');
            window.requestAnimationFrame(() => listHost.classList.remove('theia-mod-live-sync'));
        }
        return true;
    }

    protected stampSessionsSidebarRowFingerprints(listHost: HTMLElement): void {
        for (const entry of this.collectSessionsSidebarConversationEntries()) {
            const row = listHost.querySelector<HTMLElement>(
                `.theia-mobile-projects-task-row[data-qaap-conversation-id="${cssEscapeAttribute(entry.summary.id)}"]`,
            );
            if (row) {
                row.setAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR, this.buildSidebarRowFingerprint(entry));
            }
        }
    }

    protected buildSidebarRowFingerprint(
        entry: SessionsSidebarConversationEntry,
    ): string {
        const task = this.host.conversationIndexUi.summaryToTaskView(entry.summary);
        const unread = this.host.conversationIndexUi.isConversationUnread(entry.summary);
        const visualStatusId = resolveQaapAgentTaskVisualStatus(task, entry.summary, unread).id;
        return buildWorkHubSessionsSidebarRowFingerprint(entry.summary, {
            pinned: entry.pinned,
            isCurrent: this.host.transcriptOpenSummaryId === entry.summary.id,
            visualStatusId,
        });
    }

    protected collectSessionsSidebarConversationEntries(): SessionsSidebarConversationEntry[] {
        const projects = [...this.host.projects].sort((a, b) => this.host.compareChatInboxProjectOrder(a, b));
        const query = this.host.query.trim().toLowerCase();
        const bypassConversationLimit = query.length > 0;
        const onActivate = (): void => {
            this.host.sessionsSidebar?.hideForMobileOverlay();
        };
        const entries: SessionsSidebarConversationEntry[] = [];
        const pinnedGroups = this.collectSessionsSidebarPinnedGroups(projects, query);
        for (const { project, conversations } of pinnedGroups) {
            const parentIds = this.collectParentIds(conversations);
            const { visible } = this.resolveSessionsSidebarVisibleConversations(
                project,
                conversations,
                bypassConversationLimit,
            );
            for (const summary of visible) {
                entries.push({ project, summary, pinned: true, parentIds, onActivate });
            }
        }
        for (const project of projects) {
            let conversations = [...this.host.conversationIndexUi.conversationsForProject(project)]
                .filter(summary => !this.isSessionsSidebarPinnedConversation(summary))
                .sort((a, b) => this.host.conversationIndexUi.compareConversationOrder(a, b));
            if (query) {
                conversations = conversations.filter(c => this.host.hubQueryUi.conversationMatchesQuery(c, query));
                if (conversations.length === 0) {
                    continue;
                }
            } else if (conversations.length === 0) {
                continue;
            }
            const parentIds = this.collectParentIds(conversations);
            const { visible } = this.resolveSessionsSidebarVisibleConversations(
                project,
                conversations,
                bypassConversationLimit,
            );
            for (const summary of visible) {
                entries.push({ project, summary, pinned: false, parentIds, onActivate });
            }
        }
        return entries;
    }

    protected collectParentIds(
        conversations: readonly QaapAgentConversationSummaryDTO[],
    ): ReadonlySet<string> {
        const parentIds = new Set<string>();
        for (const summary of conversations) {
            if (summary.forkedFromId) {
                parentIds.add(summary.forkedFromId);
            }
        }
        return parentIds;
    }

    resetSessionsSidebarListFingerprint(): void {
        this.sessionsSidebarListFingerprint = '';
    }

    protected beginSessionsSidebarConversationActivation(conversationId: string): void {
        this.sessionsSidebarInteractionUntil = Date.now() + SESSIONS_SIDEBAR_INTERACTION_GUARD_MS;
        this.sessionsSidebarOpeningConversationId = conversationId;
        if (this.sessionsSidebarOpeningTimer !== undefined) {
            window.clearTimeout(this.sessionsSidebarOpeningTimer);
        }
        this.sessionsSidebarOpeningTimer = window.setTimeout(() => {
            this.sessionsSidebarOpeningConversationId = undefined;
            this.sessionsSidebarOpeningTimer = undefined;
        }, SESSIONS_SIDEBAR_INTERACTION_GUARD_MS);
    }

    scheduleWorkHubSessionsSidebarRefresh(): void {
        this.host.sessionsSidebar?.scheduleRefreshList();
    }

    refreshWorkHubSessionsSidebarList(force = false): void {
        if (force) {
            this.resetSessionsSidebarListFingerprint();
        }
        this.host.sessionsSidebar?.refreshList(force ? { force: true } : undefined);
    }
    resolveWorkHubSessionsSidebarProject(): MobileProjectEntry | undefined {
        if (this.host.agentsHubSelectedProjectId) {
            const selected = this.host.projects.find(p => p.id === this.host.agentsHubSelectedProjectId);
            if (selected) {
                return selected;
            }
        }
        return this.host.projects.find(p => p.isCurrent)
            ?? this.host.resolveHomePinnedProject();
    }
    renderWorkHubSessionsSidebarList(host: HTMLElement): void {
        const projects = [...this.host.projects].sort((a, b) => this.host.compareChatInboxProjectOrder(a, b));
        const query = this.host.query.trim().toLowerCase();
        if (projects.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'theia-mobile-work-hub-sessions-sidebar-empty';
            empty.textContent = query
                ? nls.localize('qaap/sessionsSidebar/noSearchResults', 'No sessions match your search.')
                : nls.localize('qaap/sessionsSidebar/noSessions', 'No agent sessions yet. Start one from Agents.');
            host.append(empty);
            return;
        }
        const onActivate = (): void => {
            this.host.sessionsSidebar?.hideForMobileOverlay();
        };
        this.seedSessionsSidebarAccordionDefaults(projects);
        const pinnedGroups = this.collectSessionsSidebarPinnedGroups(projects, query);
        const bypassConversationLimit = query.length > 0;
        if (pinnedGroups.length > 0) {
            host.append(this.createSessionsSidebarPinnedSection(pinnedGroups, onActivate, bypassConversationLimit));
        }
        const sectionHead = document.createElement('div');
        sectionHead.className = 'theia-mobile-tasks-inbox-section-head theia-mod-sessions-sidebar-projects-head';
        const sectionLabel = document.createElement('span');
        sectionLabel.className = 'theia-mobile-tasks-inbox-section-label';
        sectionLabel.textContent = nls.localize('qaap/sessionsSidebar/projectsSection', 'Projects');
        sectionHead.append(sectionLabel);
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-sessions-sidebar-projects-list';
        let visibleCount = 0;
        for (const project of projects) {
            let conversations = [...this.host.conversationIndexUi.conversationsForProject(project)]
                .filter(summary => !this.isSessionsSidebarPinnedConversation(summary))
                .sort((a, b) => this.host.conversationIndexUi.compareConversationOrder(a, b));
            if (query) {
                conversations = conversations.filter(c => this.host.hubQueryUi.conversationMatchesQuery(c, query));
                if (conversations.length === 0) {
                    continue;
                }
            } else if (conversations.length === 0) {
                continue;
            }
            list.append(this.createSessionsSidebarProjectGroup(project, conversations, onActivate, bypassConversationLimit));
            visibleCount++;
        }
        if (visibleCount === 0 && pinnedGroups.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'theia-mobile-work-hub-sessions-sidebar-empty';
            empty.textContent = nls.localize(
                'qaap/sessionsSidebar/noSearchResults',
                'No sessions match your search.',
            );
            host.append(empty);
            return;
        }
        if (visibleCount > 0) {
            host.append(sectionHead, list);
        }
        this.syncSessionsSidebarAnimatedListHeights(host);
        this.prefetchVisibleSidebarDocuments();
        this.bindSessionsSidebarThreadStoreSubscriptions();
    }

    protected bindSessionsSidebarThreadStoreSubscriptions(): void {
        this.sessionsSidebarThreadStoreDispose.dispose();
        const conversations = this.host.conversations;
        if (!conversations || !this.isWorkHubSessionsSidebarVisible()) {
            this.sessionsSidebarThreadStoreDispose = Disposable.NULL;
            return;
        }
        const disposables = new DisposableCollection();
        for (const entry of this.collectSessionsSidebarConversationEntries()) {
            if (entry.summary.source === 'theia-chat') {
                continue;
            }
            const conversationId = entry.summary.id;
            disposables.push(conversations.threadStore.subscribe(
                () => { this.scheduleWorkHubSessionsSidebarRefresh(); },
                snapshot => {
                    const summary = snapshot.summariesById.get(conversationId);
                    if (!summary) {
                        return undefined;
                    }
                    return [
                        summary.status,
                        summary.updatedAt,
                        summary.turnProgressCurrent,
                        summary.turnProgressTotal,
                        summary.lastMessagePreview,
                        summary.activityLabel,
                    ].join(':');
                },
                conversationId,
            ));
        }
        this.sessionsSidebarThreadStoreDispose = disposables;
    }

    protected prefetchVisibleSidebarDocuments(limit = 8): void {
        const conversations = this.host.conversations;
        if (!conversations) {
            return;
        }
        const ids: string[] = [];
        for (const entry of this.collectSessionsSidebarConversationEntries()) {
            if (ids.length >= limit) {
                break;
            }
            if (entry.summary.source === 'theia-chat' || entry.summary.id.startsWith('pending-')) {
                continue;
            }
            ids.push(entry.summary.id);
        }
        conversations.prefetchDocuments(ids);
    }
    syncSessionsSidebarAnimatedListHeights(host: HTMLElement): void {
        window.requestAnimationFrame(() => {
            const lists = host.querySelectorAll<HTMLElement>(
                '.theia-mobile-work-hub-sessions-sidebar-project-group:not(.theia-mod-collapsed) .theia-mobile-projects-chats-list, '
                + '.theia-mobile-work-hub-sessions-sidebar-project-group:not(.theia-mod-collapsed) .theia-mobile-work-hub-sessions-sidebar-projects-list',
            );
            for (const list of lists) {
                list.style.removeProperty('--qaap-sessions-sidebar-list-height');
            }
        });
    }
    isSessionsSidebarPinnedConversation(summary: QaapAgentConversationSummaryDTO): boolean {
        const flags = this.host.conversationIndexUi.resolveConversationFlags(summary);
        return flags.priority && !flags.paused;
    }
    collectSessionsSidebarPinnedGroups(
        projects: MobileProjectEntry[],
        query: string,
    ): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
        const groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> = [];
        for (const project of projects) {
            let conversations = this.host.conversationIndexUi.conversationsForProject(project)
                .filter(summary => this.isSessionsSidebarPinnedConversation(summary))
                .sort((a, b) => this.host.conversationIndexUi.compareConversationOrder(a, b));
            if (query) {
                conversations = conversations.filter(c => this.host.hubQueryUi.conversationMatchesQuery(c, query));
            }
            if (conversations.length > 0) {
                groups.push({ project, conversations });
            }
        }
        return groups;
    }
    createSessionsSidebarPinnedSection(
        groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>,
        onActivate: () => void,
        bypassConversationLimit = false,
    ): HTMLElement {
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-section';
        const head = document.createElement('div');
        head.className = 'theia-mobile-tasks-inbox-section-head theia-mod-sessions-sidebar-pinned-head';
        const label = document.createElement('span');
        label.className = 'theia-mobile-tasks-inbox-section-label';
        label.textContent = nls.localize('qaap/sessionsSidebar/pinnedSection', 'Anclados');
        head.append(label);
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-list';
        for (const { project, conversations } of groups) {
            list.append(this.createSessionsSidebarPinnedProjectGroup(project, conversations, onActivate, bypassConversationLimit));
        }
        section.append(head, list);
        return section;
    }
    protected resolveSessionsSidebarCollapsedLimit(totalConversations: number): number {
        const projectCount = this.host.hubQueryUi.projectsForCurrentHubList().length;
        return resolveSessionsSidebarInitialConversationLimit({
            projectCount,
            totalConversations,
            viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
        });
    }
    getSessionsSidebarConversationDisplayLimit(
        project: MobileProjectEntry,
        totalCount: number,
        bypassLimit: boolean,
    ): number {
        if (bypassLimit || totalCount === 0) {
            return totalCount;
        }
        const stored = this.host.sessionsSidebarVisibleConversationCountByProjectId.get(project.id);
        const limit = stored ?? this.resolveSessionsSidebarCollapsedLimit(totalCount);
        return Math.min(limit, totalCount);
    }
    resolveSessionsSidebarVisibleConversations(
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        bypassLimit: boolean,
    ): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
        const all = [...conversations];
        if (bypassLimit) {
            return { visible: all, hiddenCount: 0, showLess: false };
        }
        const defaultLimit = this.resolveSessionsSidebarCollapsedLimit(all.length);
        const displayLimit = this.getSessionsSidebarConversationDisplayLimit(project, all.length, bypassLimit);
        if (all.length <= defaultLimit && !this.host.sessionsSidebarVisibleConversationCountByProjectId.has(project.id)) {
            return { visible: all, hiddenCount: 0, showLess: false };
        }
        const visible = all.slice(0, displayLimit);
        const openId = this.host.transcriptOpenSummaryId;
        if (openId && displayLimit > 0) {
            const openIndex = all.findIndex(c => c.id === openId);
            if (openIndex >= displayLimit) {
                visible[displayLimit - 1] = all[openIndex]!;
            }
        }
        const hiddenCount = Math.max(0, all.length - displayLimit);
        const showLess = displayLimit > defaultLimit && hiddenCount === 0;
        return { visible, hiddenCount, showLess };
    }
    appendSessionsSidebarConversationItems(
        listHost: HTMLElement,
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassLimit: boolean,
    ): void {
        const { visible, hiddenCount, showLess } = this.resolveSessionsSidebarVisibleConversations(project, conversations, bypassLimit);
        if (visible.length === 0) {
            return;
        }
        const activeInfo = this.host.conversationIndexUi.activeInfoForProject(project);
        const parentIds = new Set<string>();
        for (const summary of conversations) {
            if (summary.forkedFromId) {
                parentIds.add(summary.forkedFromId);
            }
        }
        for (const summary of visible) {
            const task = this.host.conversationIndexUi.summaryToTaskView(summary);
            listHost.append(this.host.projectRowsUi.createTaskItem(project, task, activeInfo, summary, parentIds, {
                onActivate: () => {
                    this.beginSessionsSidebarConversationActivation(summary.id);
                    onActivate();
                },
                compact: true,
            }));
        }
        if (bypassLimit) {
            return;
        }
        const totalCount = conversations.length;
        if (hiddenCount > 0) {
            listHost.append(this.createSessionsSidebarShowMoreControl(project, hiddenCount, totalCount));
        } else if (showLess) {
            listHost.append(this.createSessionsSidebarShowLessControl(project));
        }
    }
    createSessionsSidebarShowMoreControl(
        project: MobileProjectEntry,
        hiddenCount: number,
        totalCount: number,
    ): HTMLButtonElement {
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'theia-mobile-work-hub-sessions-sidebar-show-more';
        moreBtn.textContent = nls.localize('qaap/sessionsSidebar/showMore', 'Mostrar más');
        const pageSize = MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE;
        moreBtn.title = nls.localize(
            'qaap/sessionsSidebar/showMoreHint',
            'Show {0} more sessions',
            String(Math.min(pageSize, hiddenCount)),
        );
        moreBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const current = this.host.sessionsSidebarVisibleConversationCountByProjectId.get(project.id)
                ?? this.resolveSessionsSidebarCollapsedLimit(totalCount);
            this.host.sessionsSidebarVisibleConversationCountByProjectId.set(
                project.id,
                Math.min(current + pageSize, totalCount),
            );
            this.resetSessionsSidebarListFingerprint();
            this.host.sessionsSidebar?.refreshList({ force: true });
        });
        return moreBtn;
    }
    createSessionsSidebarShowLessControl(project: MobileProjectEntry): HTMLButtonElement {
        const lessBtn = document.createElement('button');
        lessBtn.type = 'button';
        lessBtn.className = 'theia-mobile-work-hub-sessions-sidebar-show-more theia-mod-show-less';
        lessBtn.textContent = nls.localize('qaap/sessionsSidebar/showLess', 'Mostrar menos');
        lessBtn.title = nls.localize(
            'qaap/sessionsSidebar/showLessHint',
            'Show only the first {0} sessions',
            String(this.resolveSessionsSidebarCollapsedLimit(
                this.host.conversationIndexUi.conversationsForProject(project).length,
            )),
        );
        lessBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            this.host.sessionsSidebarVisibleConversationCountByProjectId.delete(project.id);
            this.resetSessionsSidebarListFingerprint();
            this.host.sessionsSidebar?.refreshList({ force: true });
        });
        return lessBtn;
    }
    createSessionsSidebarPinnedProjectGroup(
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassConversationLimit = false,
    ): HTMLElement {
        const group = document.createElement('div');
        group.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-project';
        const projectHead = document.createElement('div');
        projectHead.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-project-head';
        const folder = document.createElement('span');
        folder.className = 'codicon codicon-folder theia-mobile-work-hub-sessions-sidebar-pinned-project-icon';
        folder.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-project-name';
        name.textContent = project.name;
        projectHead.append(folder, name);
        const taskList = document.createElement('div');
        taskList.className = 'theia-mobile-projects-chats-list theia-mod-sessions-sidebar-pinned-tasks';
        this.appendSessionsSidebarConversationItems(taskList, project, conversations, onActivate, bypassConversationLimit);
        group.append(projectHead, taskList);
        return group;
    }
    seedSessionsSidebarAccordionDefaults(projects: MobileProjectEntry[]): void {
        if (this.host.sessionsSidebarAccordionDefaultsApplied) {
            return;
        }
        this.host.sessionsSidebarAccordionDefaultsApplied = true;
        for (const project of projects) {
            if (project.isCurrent || this.host.conversationIndexUi.countRunningTasks(project) > 0) {
                this.host.sessionsSidebarExpandedProjectIds.add(project.id);
            }
        }
        if (projects.length > 0 && this.host.sessionsSidebarExpandedProjectIds.size === 0) {
            this.host.sessionsSidebarExpandedProjectIds.add(projects[0].id);
        }
    }
    createSessionsSidebarProjectGroup(
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassConversationLimit = false,
    ): HTMLElement {
        const expanded = this.host.sessionsSidebarExpandedProjectIds.has(project.id);
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-sessions-sidebar-project-group';
        if (!expanded) {
            section.classList.add('theia-mod-collapsed');
        }
        const toggleExpand = (): void => {
            const willExpand = section.classList.contains('theia-mod-collapsed');
            section.classList.toggle('theia-mod-collapsed');
            head.setAttribute('aria-expanded', String(willExpand));
            if (willExpand) {
                this.host.sessionsSidebarExpandedProjectIds.add(project.id);
            } else {
                this.host.sessionsSidebarExpandedProjectIds.delete(project.id);
            }
        };
        const head = this.createSessionsSidebarProjectRowHead(project, expanded, toggleExpand);
        const list = document.createElement('div');
        list.className = 'theia-mobile-projects-chats-list';
        this.appendSessionsSidebarConversationItems(list, project, conversations, onActivate, bypassConversationLimit);
        section.append(head, list);
        return section;
    }
    createSessionsSidebarProjectRowHead(
        project: MobileProjectEntry,
        expanded: boolean,
        onToggleExpand: () => void,
    ): HTMLElement {
        const row = document.createElement('div');
        row.className = 'theia-mobile-work-hub-sessions-sidebar-project-row-wrap';
        if (project.isCurrent) {
            row.classList.add('theia-mod-current');
        }
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'theia-mobile-work-hub-sessions-sidebar-project-row';
        head.setAttribute('aria-expanded', String(expanded));
        const chevron = document.createElement('span');
        chevron.className = 'codicon codicon-chevron-right theia-mobile-work-hub-sessions-sidebar-project-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        const dot = document.createElement('span');
        dot.className = 'theia-mobile-work-hub-sessions-sidebar-project-dot';
        dot.style.background = project.color;
        dot.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'theia-mobile-work-hub-sessions-sidebar-project-name';
        name.textContent = project.name;
        head.append(chevron, dot, name);
        head.addEventListener('click', ev => {
            ev.stopPropagation();
            onToggleExpand();
        });
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-work-hub-sessions-sidebar-project-actions';
        if (project.isCurrent) {
            actions.append(this.createSessionsSidebarIdeOpenBadge());
        }
        actions.append(this.createSessionsSidebarIdeOpenControl(project));
        const menu = this.host.cardMenuUi.buildProjectOptionsMenu(project);
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'theia-mobile-projects-card-menu-btn theia-mobile-projects-row-menu';
        menuBtn.setAttribute('aria-label', nls.localize('qaap/mobileProjects/cardMenu', 'Project options'));
        menuBtn.setAttribute('aria-haspopup', 'menu');
        menuBtn.setAttribute('aria-expanded', 'false');
        const menuIcon = document.createElement('span');
        menuIcon.className = 'codicon codicon-kebab-vertical';
        menuIcon.setAttribute('aria-hidden', 'true');
        menuBtn.append(menuIcon);
        menuBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            this.host.cardMenuUi.toggleCardMenu(row, menu, menuBtn);
        });
        row.append(head, actions, menuBtn, menu);
        return row;
    }
    createSessionsSidebarIdeOpenControl(project: MobileProjectEntry): HTMLButtonElement {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'theia-mobile-projects-row-meta-open theia-mobile-work-hub-sessions-sidebar-project-open';
        const openLabel = nls.localize('qaap/mobileProjects/openInIde', 'Open in IDE');
        openBtn.setAttribute('aria-label', openLabel);
        openBtn.title = openLabel;
        const openIcon = document.createElement('span');
        openIcon.className = 'codicon codicon-link-external';
        openIcon.setAttribute('aria-hidden', 'true');
        openBtn.append(openIcon);
        openBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            this.host.sessionsSidebar?.hide();
            void this.host.delegate.onProjectOpenInIde?.(project);
        });
        openBtn.addEventListener('keydown', ev => ev.stopPropagation());
        return openBtn;
    }
    createSessionsSidebarIdeOpenBadge(): HTMLSpanElement {
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-work-hub-sessions-sidebar-ide-badge';
        const label = document.createElement('span');
        label.className = 'theia-mobile-work-hub-sessions-sidebar-ide-badge-label';
        label.textContent = nls.localize('qaap/mobileProjects/ideOpen', 'IDE open');
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-work-hub-sessions-sidebar-ide-badge-close';
        close.setAttribute('aria-label', nls.localize('qaap/mobileProjects/closeWorkspace', 'Close workspace'));
        close.title = close.getAttribute('aria-label') ?? '';
        close.textContent = '×';
        close.addEventListener('click', ev => {
            ev.stopPropagation();
            void this.host.closeCurrentWorkspace();
        });
        close.addEventListener('keydown', ev => ev.stopPropagation());
        badge.append(label, close);
        return badge;
    }
    async onWorkHubSessionsSidebarNewChat(): Promise<void> {
        const project = this.resolveWorkHubSessionsSidebarProject();
        if (!project) {
            await this.host.onNewClick();
            return;
        }
        await this.openEmptyMobileChatSheet(project);
    }
    async openEmptyMobileChatSheet(project: MobileProjectEntry): Promise<void> {
        this.host.sessionsSidebar?.hide();
        if (this.host.shouldUseAgentsHubLanding() && !this.host.isProjectDetailView()) {
            if (this.host.transcriptSheet) {
                this.host.transcriptSheetUi.closeTranscriptSheet();
            }
            if (this.host.agentsHubInlineActive) {
                this.host.closeAgentsHubSession();
            } else {
                this.host.resetAgentsHubIdleTranscriptShell(project);
            }
            const cwd = this.host.projectsService.getProjectCwd(project);
            const defaultAgent = (cwd ? readStoredAgent(cwd) : undefined)
                ?? this.host.activeTasks?.getDefaultAgent()
                ?? SHELL_AGENT_ID;
            this.host.transcriptStickyComposerUi.resetToProjectComposerDefaults(project, defaultAgent);
            this.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
            if (this.host.visible) {
                this.host.renderHeader();
                this.host.renderSubtitle();
            }
            this.host.stickyComposerRenderUi.renderStickyComposer();
            return;
        }
        const cwd = this.host.projectsService.getProjectCwd(project);
        const agentId = (cwd ? readStoredAgent(cwd) : undefined)
            ?? this.host.activeTasks?.getDefaultAgent()
            ?? SHELL_AGENT_ID;
        const summary: QaapAgentConversationSummaryDTO = {
            id: `pending-new-chat-${project.id}-${Date.now()}`,
            cwd: cwd ?? '',
            workspacePath: cwd,
            agentId,
            title: nls.localize('qaap/mobileProjects/newChatTitle', 'New agent'),
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
        };
        await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
    }
    async onWorkHubSessionsSidebarAutomations(): Promise<void> {
        this.host.sessionsSidebar?.hide();
        await this.host.delegate.onShowRoutinesHub?.();
    }
    onSessionsSidebarAccountClick(anchor: HTMLButtonElement): void {
        const viewToggle = {
            activeId: 'agent' as MobileViewToggleId,
            onSelect: (id: MobileViewToggleId) => {
                void this.host.commands.executeCommand('qaap.mobile.ideHeaderView.activate', id);
            },
        };
        toggleQaapAccountMenu(
            anchor,
            this.host.commands,
            buildQaapAccountMenuEntries(readQaapSignedIn()),
            {
                section: QAAP_WORK_HUB_GETTING_STARTED,
                onCatalogAction: action => { void this.host.runCatalogAction(action); },
            },
            {
                placement: 'above',
                anchorGap: 2,
                onMenuAction: () => { this.host.sessionsSidebar?.hide(); },
            },
            viewToggle,
        );
    }
    async openSessionsSidebarSearch(): Promise<void> {
        if (!this.host.quickInputService) {
            return;
        }
        const project = this.resolveWorkHubSessionsSidebarProject();
        if (!project) {
            return;
        }
        const conversations = [...this.host.conversationIndexUi.conversationsForProject(project)]
            .sort((a, b) => b.updatedAt - a.updatedAt);
        type SessionPickItem = QuickPickItem & { summary: QaapAgentConversationSummaryDTO };
        const quickPick = this.host.quickInputService.createQuickPick<SessionPickItem>();
        quickPick.placeholder = nls.localize('qaap/sessionsSidebar/searchPlaceholder', 'Search sessions');
        quickPick.items = conversations.map(summary => ({
            label: summary.title?.trim() || nls.localize('qaap/mobileProjects/untitledChat', 'Untitled chat'),
            description: summary.agentId,
            summary,
        }));
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            if (selected?.summary) {
                this.host.sessionsSidebar?.hide();
                void this.host.openConversationSummary(project, selected.summary);
            }
            quickPick.hide();
        });
        quickPick.show();
    }
}
