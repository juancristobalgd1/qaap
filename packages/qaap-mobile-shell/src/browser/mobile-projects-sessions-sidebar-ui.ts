// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { createLucideArrowUpRightIcon } from '@theia/qaap-adapters/lib/browser/qaap-lucide-icons';
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
import { beginSessionsSidebarConversationActivationExtracted, bindSessionsSidebarInteractionGuardExtracted, buildSessionsSidebarFingerprintInputExtracted, buildSessionsSidebarStructureFingerprintExtracted, buildSidebarRowFingerprintExtracted, collectParentIdsExtracted, collectSessionsSidebarConversationEntriesExtracted, ensureWorkHubSessionsSidebarExtracted, mergeSessionsSidebarProjectsExtracted, openWorkHubSessionsSidebarExtracted, prepareSessionsSidebarDataExtracted, refreshWorkHubSessionsSidebarListExtracted, rememberSessionsSidebarListFingerprintExtracted, resolveWorkHubSessionsSidebarProjectExtracted, seedSessionsSidebarProjectsForPaintExtracted, shouldDeferSessionsSidebarListRefreshExtracted, shouldSkipSessionsSidebarListRenderExtracted, stampSessionsSidebarRowFingerprintsExtracted, toggleWorkHubSessionsSidebarExtracted, tryPatchSessionsSidebarListExtracted } from './mobile-projects-sessions-sidebar-ui-render2';
import { appendSessionsSidebarConversationItemsExtracted, bindSessionsSidebarThreadStoreSubscriptionsExtracted, collectSessionsSidebarPinnedGroupsExtracted, compareSessionsSidebarProjectOrderExtracted, createSessionsSidebarClearFailedControlExtracted, createSessionsSidebarPinnedProjectGroupExtracted, createSessionsSidebarPinnedSectionExtracted, createSessionsSidebarShowLessControlExtracted, createSessionsSidebarShowMoreControlExtracted, ensureSessionsSidebarActiveProjectExpandedExtracted, getSessionsSidebarConversationDisplayLimitExtracted, prefetchVisibleSidebarDocumentsExtracted, renderWorkHubSessionsSidebarListExtracted, resolveSessionsSidebarCollapsedLimitExtracted, resolveSessionsSidebarVisibleConversationsExtracted, seedSessionsSidebarAccordionDefaultsExtracted, syncSessionsSidebarAnimatedListHeightsExtracted, toggleSessionsSidebarAddProjectPopoverExtracted, toggleSessionsSidebarProjectSortPopoverExtracted, toggleSessionsSidebarStatusLegendPopoverExtracted } from './mobile-projects-sessions-sidebar-ui-streaming2';
import { createSessionsSidebarIdeOpenControlExtracted, createSessionsSidebarNewAgentControlExtracted, createSessionsSidebarProjectGroupExtracted, createSessionsSidebarProjectRowHeadExtracted, onSessionsSidebarAccountClickExtracted, onSessionsSidebarViewModeChangeExtracted, onWorkHubSessionsSidebarNewChatExtracted, openEmptyMobileChatSheetExtracted, openSessionsSidebarSearchExtracted } from './mobile-projects-sessions-sidebar-ui-timeline2';

export const MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT = QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT;
export const MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE = QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE;
/** Pause live sidebar sync while the user taps a row (prevents click loss). */
export const SESSIONS_SIDEBAR_INTERACTION_GUARD_MS = 900;
/** Min interval between live sidebar refreshes during SSE (~4 fps). */
export const SESSIONS_SIDEBAR_STREAM_REFRESH_MS = 250;

export interface MobileProjectsSessionsSidebarHost {
    sessionsSidebar: MobileWorkHubSessionsSidebar | undefined;
    sessionsSidebarExpandedProjectIds: Set<string>;
    sessionsSidebarVisibleConversationCountByProjectId: Map<string, number>;
    sessionsSidebarAccordionDefaultsApplied: boolean;
    sessionsSidebarContainer?: () => HTMLElement | undefined;
    appearanceModeService?: import('./qaap-appearance-mode-service').QaapAppearanceModeService;
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
        cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
        projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
    };

    ensureOverlayUi?(): {
        parallel: {
            createVariantRunSection(
                project: MobileProjectEntry,
                runId: string,
                summaries: QaapAgentConversationSummaryDTO[],
                activeInfo: ReturnType<import('./mobile-projects-active-tasks').MobileProjectsActiveTasks['getForCwd']>,
                parentIds: ReadonlySet<string>,
                options?: {
                    compact?: boolean;
                    mode?: 'parallel-run' | 'isolated-forks';
                    onActivate?: (summary: QaapAgentConversationSummaryDTO) => void;
                },
            ): HTMLElement;
        };
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
        options?: { onActivate?: () => void; compact?: boolean; failedDuplicateCount?: number },
    ): HTMLElement;
    buildProjectOptionsMenu(project: MobileProjectEntry): HTMLElement;
    toggleCardMenu(row: HTMLElement, menu: HTMLElement, menuBtn: HTMLButtonElement): void;
    buildProjectOptionsMenu(project: MobileProjectEntry): HTMLElement;
    toggleCardMenu(row: HTMLElement, menu: HTMLElement, menuBtn: HTMLButtonElement): void;
    onClearFailedTasks(project: MobileProjectEntry): Promise<void>;
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
    /** Select a project and land on its Agents idle shell (scoped; not the ambiguous workspace default). */
    activateAgentsHubProject(project: MobileProjectEntry): Promise<void>;
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

export type SessionsSidebarProjectSortMode = 'default' | 'lastMessage' | 'createdAt' | 'alphabetical';

export const SESSIONS_SIDEBAR_PROJECT_SORT_MODE_STORAGE_KEY = 'qaap.sessionsSidebar.projectSortMode';

export const SESSIONS_SIDEBAR_PROJECT_SORT_MODES: ReadonlyArray<{ id: SessionsSidebarProjectSortMode; labelKey: string; defaultLabel: string }> = [
    { id: 'default', labelKey: 'qaap/sessionsSidebar/sort/default', defaultLabel: 'Default' },
    { id: 'lastMessage', labelKey: 'qaap/sessionsSidebar/sort/lastMessage', defaultLabel: 'Last user message' },
    { id: 'createdAt', labelKey: 'qaap/sessionsSidebar/sort/createdAt', defaultLabel: 'Created' },
    { id: 'alphabetical', labelKey: 'qaap/sessionsSidebar/sort/alphabetical', defaultLabel: 'Alphabetical' },
];

export class MobileProjectsSessionsSidebarUi {
    constructor(protected readonly host: MobileProjectsSessionsSidebarHost) { }

    protected sessionsSidebarListFingerprint = '';
    protected sessionsSidebarOpeningConversationId: string | undefined;
    protected sessionsSidebarOpeningTimer: number | undefined;
    protected sessionsSidebarInteractionUntil = 0;
    protected sessionsSidebarLastStreamRefreshAt = 0;
    protected sessionsSidebarInteractionBound = false;
    protected sessionsSidebarThreadStoreDispose: Disposable = Disposable.NULL;
    protected sessionsSidebarProjectSortModeValue: SessionsSidebarProjectSortMode = this.readPersistedProjectSortMode();
    protected sessionsSidebarSortPopover: HTMLElement | undefined;
    protected sessionsSidebarAddProjectPopover: HTMLElement | undefined;
    protected sessionsSidebarStatusLegendPopover: HTMLElement | undefined;

    openWorkHubSessionsSidebar(): void {
        openWorkHubSessionsSidebarExtracted(this);
    }
    toggleWorkHubSessionsSidebar(): void {
        toggleWorkHubSessionsSidebarExtracted(this);
    }
    async prepareSessionsSidebarData(): Promise<void> {
        return prepareSessionsSidebarDataExtracted(this);
    }

    protected mergeSessionsSidebarProjects(projects: readonly MobileProjectEntry[]): MobileProjectEntry[] {
        return mergeSessionsSidebarProjectsExtracted(this, projects);
    }

    protected seedSessionsSidebarProjectsForPaint(): void {
        seedSessionsSidebarProjectsForPaintExtracted(this);
    }
    isWorkHubSessionsSidebarVisible(): boolean {
        return this.host.sessionsSidebar?.isVisible() === true;
    }
    ensureWorkHubSessionsSidebar(): MobileWorkHubSessionsSidebar {
        return ensureWorkHubSessionsSidebarExtracted(this);
    }

    /** Reconcile the sidebar mount point after a responsive layout transition. */
    syncWorkHubSessionsSidebarLayout(): void {
        const sidebar = this.host.sessionsSidebar;
        if (!sidebar?.isVisible()) {
            return;
        }
        ensureWorkHubSessionsSidebarExtracted(this);
        sidebar.syncDesktopLayout();
    }

    protected buildSessionsSidebarFingerprintInput(): WorkHubSessionsSidebarFingerprintInput {
        return buildSessionsSidebarFingerprintInputExtracted(this);
    }

    shouldSkipSessionsSidebarListRender(): boolean {
        return shouldSkipSessionsSidebarListRenderExtracted(this);
    }

    shouldDeferSessionsSidebarListRefresh(): boolean {
        return shouldDeferSessionsSidebarListRefreshExtracted(this);
    }

    protected isSessionsSidebarInteractionGuardActive(): boolean {
        return Date.now() < this.sessionsSidebarInteractionUntil;
    }

    protected bindSessionsSidebarInteractionGuard(listHost: HTMLElement): void {
        bindSessionsSidebarInteractionGuardExtracted(this, listHost);
    }

    protected buildSessionsSidebarStructureFingerprint(): string {
        return buildSessionsSidebarStructureFingerprintExtracted(this);
    }

    rememberSessionsSidebarListFingerprint(listHost: HTMLElement): void {
        rememberSessionsSidebarListFingerprintExtracted(this, listHost);
    }

    tryPatchSessionsSidebarList(listHost: HTMLElement): boolean {
        return tryPatchSessionsSidebarListExtracted(this, listHost);
    }

    protected stampSessionsSidebarRowFingerprints(listHost: HTMLElement): void {
        stampSessionsSidebarRowFingerprintsExtracted(this, listHost);
    }

    protected buildSidebarRowFingerprint(entry: SessionsSidebarConversationEntry,): string {
        return buildSidebarRowFingerprintExtracted(this, entry);
    }

    protected collectSessionsSidebarConversationEntries(): SessionsSidebarConversationEntry[] {
        return collectSessionsSidebarConversationEntriesExtracted(this);
    }

    protected collectParentIds(conversations: readonly QaapAgentConversationSummaryDTO[],): ReadonlySet<string> {
        return collectParentIdsExtracted(this, conversations);
    }

    resetSessionsSidebarListFingerprint(): void {
        this.sessionsSidebarListFingerprint = '';
    }

    protected beginSessionsSidebarConversationActivation(conversationId: string): void {
        beginSessionsSidebarConversationActivationExtracted(this, conversationId);
    }

    scheduleWorkHubSessionsSidebarRefresh(): void {
        this.host.sessionsSidebar?.scheduleRefreshList();
    }

    refreshWorkHubSessionsSidebarList(force = false): void {
        refreshWorkHubSessionsSidebarListExtracted(this, force);
    }
    resolveWorkHubSessionsSidebarProject(): MobileProjectEntry | undefined {
        return resolveWorkHubSessionsSidebarProjectExtracted(this);
    }
    renderWorkHubSessionsSidebarList(host: HTMLElement): void {
        renderWorkHubSessionsSidebarListExtracted(this, host);
    }

    readQaapSignedIn(): boolean {
        return readQaapSignedIn();
    }

    protected bindSessionsSidebarThreadStoreSubscriptions(): void {
        bindSessionsSidebarThreadStoreSubscriptionsExtracted(this);
    }

    protected prefetchVisibleSidebarDocuments(limit = 8): void {
        prefetchVisibleSidebarDocumentsExtracted(this, limit = 8);
    }
    syncSessionsSidebarAnimatedListHeights(host: HTMLElement): void {
        syncSessionsSidebarAnimatedListHeightsExtracted(this, host);
    }
    isSessionsSidebarPinnedConversation(summary: QaapAgentConversationSummaryDTO): boolean {
        const flags = this.host.conversationIndexUi.resolveConversationFlags(summary);
        return flags.priority && !flags.paused;
    }
    collectSessionsSidebarPinnedGroups(projects: MobileProjectEntry[], query: string,): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
        return collectSessionsSidebarPinnedGroupsExtracted(this, projects, query);
    }
    createSessionsSidebarPinnedSection(groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>, onActivate: () => void, bypassConversationLimit = false,): HTMLElement {
        return createSessionsSidebarPinnedSectionExtracted(this, groups, onActivate, bypassConversationLimit);
    }
    protected resolveSessionsSidebarCollapsedLimit(totalConversations: number): number {
        return resolveSessionsSidebarCollapsedLimitExtracted(this, totalConversations);
    }
    getSessionsSidebarConversationDisplayLimit(project: MobileProjectEntry, totalCount: number, bypassLimit: boolean,): number {
        return getSessionsSidebarConversationDisplayLimitExtracted(this, project, totalCount, bypassLimit);
    }
    resolveSessionsSidebarVisibleConversations(project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], bypassLimit: boolean,): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
        return resolveSessionsSidebarVisibleConversationsExtracted(this, project, conversations, bypassLimit);
    }
    appendSessionsSidebarConversationItems(listHost: HTMLElement, project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], onActivate: () => void, bypassLimit: boolean,): void {
        appendSessionsSidebarConversationItemsExtracted(this, listHost, project, conversations, onActivate, bypassLimit);
    }
    createSessionsSidebarClearFailedControl(project: MobileProjectEntry, failedCount: number): HTMLButtonElement {
        return createSessionsSidebarClearFailedControlExtracted(this, project, failedCount);
    }
    createSessionsSidebarShowMoreControl(project: MobileProjectEntry, hiddenCount: number, totalCount: number,): HTMLButtonElement {
        return createSessionsSidebarShowMoreControlExtracted(this, project, hiddenCount, totalCount);
    }
    createSessionsSidebarShowLessControl(project: MobileProjectEntry): HTMLButtonElement {
        return createSessionsSidebarShowLessControlExtracted(this, project);
    }
    createSessionsSidebarPinnedProjectGroup(project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], onActivate: () => void, bypassConversationLimit = false,): HTMLElement {
        return createSessionsSidebarPinnedProjectGroupExtracted(this, project, conversations, onActivate, bypassConversationLimit);
    }
    seedSessionsSidebarAccordionDefaults(projects: MobileProjectEntry[]): void {
        seedSessionsSidebarAccordionDefaultsExtracted(this, projects);
    }

    ensureSessionsSidebarActiveProjectExpanded(projects: MobileProjectEntry[]): void {
        ensureSessionsSidebarActiveProjectExpandedExtracted(this, projects);
    }

    compareSessionsSidebarProjectOrder(a: MobileProjectEntry, b: MobileProjectEntry): number {
        return compareSessionsSidebarProjectOrderExtracted(this, a, b);
    }
    getSessionsSidebarProjectSortMode(): SessionsSidebarProjectSortMode {
        return this.sessionsSidebarProjectSortModeValue;
    }
    setSessionsSidebarProjectSortMode(mode: SessionsSidebarProjectSortMode): void {
        if (this.sessionsSidebarProjectSortModeValue === mode) {
            return;
        }
        this.sessionsSidebarProjectSortModeValue = mode;
        try {
            window.localStorage.setItem(SESSIONS_SIDEBAR_PROJECT_SORT_MODE_STORAGE_KEY, mode);
        } catch {
            /* ignore quota / privacy-mode failures */
        }
        this.resetSessionsSidebarListFingerprint();
        this.refreshWorkHubSessionsSidebarList(true);
    }
    protected readPersistedProjectSortMode(): SessionsSidebarProjectSortMode {
        try {
            const raw = window.localStorage.getItem(SESSIONS_SIDEBAR_PROJECT_SORT_MODE_STORAGE_KEY);
            if (raw && SESSIONS_SIDEBAR_PROJECT_SORT_MODES.some(entry => entry.id === raw)) {
                return raw as SessionsSidebarProjectSortMode;
            }
        } catch {
            /* ignore */
        }
        return 'default';
    }
    /** Earliest conversation createdAt for a project (falls back to lastActiveAt / 0). */
    resolveSessionsSidebarProjectCreatedAt(project: MobileProjectEntry): number {
        const conversations = this.host.conversationIndexUi.conversationsForProject(project);
        let earliest = Number.POSITIVE_INFINITY;
        for (const summary of conversations) {
            if (Number.isFinite(summary.createdAt) && summary.createdAt < earliest) {
                earliest = summary.createdAt;
            }
        }
        if (Number.isFinite(earliest)) {
            return earliest;
        }
        return project.lastActiveAt ? Date.parse(project.lastActiveAt) || 0 : 0;
    }
    /** Most recent conversation updatedAt for a project (falls back to lastActiveAt / 0). */
    resolveSessionsSidebarProjectLastMessageAt(project: MobileProjectEntry): number {
        const conversations = this.host.conversationIndexUi.conversationsForProject(project);
        let latest = 0;
        for (const summary of conversations) {
            if (Number.isFinite(summary.updatedAt) && summary.updatedAt > latest) {
                latest = summary.updatedAt;
            }
        }
        if (latest > 0) {
            return latest;
        }
        return project.lastActiveAt ? Date.parse(project.lastActiveAt) || 0 : 0;
    }
    toggleSessionsSidebarProjectSortPopover(anchor: HTMLButtonElement): void {
        toggleSessionsSidebarProjectSortPopoverExtracted(this, anchor);
    }
    toggleSessionsSidebarAddProjectPopover(anchor: HTMLButtonElement): void {
        toggleSessionsSidebarAddProjectPopoverExtracted(this, anchor);
    }
    toggleSessionsSidebarStatusLegendPopover(anchor: HTMLButtonElement): void {
        toggleSessionsSidebarStatusLegendPopoverExtracted(this, anchor);
    }
    closeSessionsSidebarHeadPopovers(): void {
        this.sessionsSidebarSortPopover?.remove();
        this.sessionsSidebarSortPopover = undefined;
        this.sessionsSidebarAddProjectPopover?.remove();
        this.sessionsSidebarAddProjectPopover = undefined;
        this.sessionsSidebarStatusLegendPopover?.remove();
        this.sessionsSidebarStatusLegendPopover = undefined;
    }
    createSessionsSidebarProjectGroup(project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], onActivate: () => void, bypassConversationLimit = false,): HTMLElement {
        return createSessionsSidebarProjectGroupExtracted(this, project, conversations, onActivate, bypassConversationLimit);
    }
    createSessionsSidebarProjectRowHead(project: MobileProjectEntry, expanded: boolean, onToggleExpand: () => void,): HTMLElement {
        return createSessionsSidebarProjectRowHeadExtracted(this, project, expanded, onToggleExpand);
    }
    createSessionsSidebarIdeOpenControl(project: MobileProjectEntry): HTMLButtonElement {
        return createSessionsSidebarIdeOpenControlExtracted(this, project);
    }
    createSessionsSidebarNewAgentControl(project: MobileProjectEntry): HTMLButtonElement {
        return createSessionsSidebarNewAgentControlExtracted(this, project);
    }
    async onWorkHubSessionsSidebarNewChat(): Promise<void> {
        return onWorkHubSessionsSidebarNewChatExtracted(this);
    }
    async openEmptyMobileChatSheet(project: MobileProjectEntry): Promise<void> {
        return openEmptyMobileChatSheetExtracted(this, project);
    }
    onSessionsSidebarAccountClick(anchor: HTMLButtonElement): void {
        onSessionsSidebarAccountClickExtracted(this, anchor);
    }

    onSessionsSidebarViewModeChange(id: MobileViewToggleId): void {
        onSessionsSidebarViewModeChangeExtracted(this, id);
    }
    async openSessionsSidebarSearch(): Promise<void> {
        return openSessionsSidebarSearchExtracted(this);
    }
}
