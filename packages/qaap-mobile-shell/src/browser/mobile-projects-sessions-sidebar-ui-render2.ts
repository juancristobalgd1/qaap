// @ts-nocheck
// Extracted from mobile-projects-sessions-sidebar-ui.ts

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
import { expandConversationSlots, partitionAgentConversations } from '../common/qaap-isolated-fork-grouping';
import { resolveQaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import {
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
    resolveSessionsSidebarInitialConversationLimit,
} from '../common/qaap-sessions-sidebar-conversation-limit';
import { SESSIONS_SIDEBAR_INTERACTION_GUARD_MS, SESSIONS_SIDEBAR_STREAM_REFRESH_MS } from './mobile-projects-sessions-sidebar-ui';

export function openWorkHubSessionsSidebarExtracted(ctx: any): void {
    const sidebar = ctx.ensureWorkHubSessionsSidebar();
    // Seed before the first paint: loadProjects() omits composer-targetable
    // workspaces (local monorepos, ephemeral folders) that Working still uses.
    ctx.seedSessionsSidebarProjectsForPaint();
    if (!sidebar.isVisible()) {
        sidebar.show();
    } else {
        sidebar.refreshList({ force: true });
    }
    void ctx.prepareSessionsSidebarData().then(() => {
        sidebar.refreshList({ force: true });
    });
}

export function toggleWorkHubSessionsSidebarExtracted(ctx: any): void {
    const sidebar = ctx.ensureWorkHubSessionsSidebar();
    if (sidebar.isVisible()) {
        sidebar.hide();
        return;
    }
    ctx.seedSessionsSidebarProjectsForPaint();
    sidebar.show();
    void ctx.prepareSessionsSidebarData().then(() => {
        sidebar.refreshList({ force: true });
    });
}

export async function prepareSessionsSidebarDataExtracted(ctx: any): Promise<void> {
    ctx.host.activeTasks?.start();
    ctx.host.conversations?.start();
    try {
        ctx.host.projects = await ctx.host.projectsService.loadProjects();
    } catch {
        /* keep in-memory list */
    }
    ctx.host.projects = ctx.mergeSessionsSidebarProjects(ctx.host.projects);
    await ctx.host.conversations?.refreshTheiaChatSessionsForProjects(ctx.host.projects);
    await ctx.host.chatServiceSummariesUi.refreshChatServiceSessionSummaries();
}

export function mergeSessionsSidebarProjectsExtracted(ctx: any, projects: readonly MobileProjectEntry[]): MobileProjectEntry[] {
    const current = ctx.host.projectsService.resolveCurrentWorkspaceProject(projects);
    if (!current) {
        return [...projects];
    }
    const currentUri = current.uri?.toString();
    if (projects.some(project => project.id === current.id
        || (!!currentUri && project.uri?.toString() === currentUri))) {
        return [...projects];
    }
    return [current, ...projects];
}

export function seedSessionsSidebarProjectsForPaintExtracted(ctx: any): void {
    if (ctx.host.projects.length === 0) {
        const cached = ctx.host.projectsService.peekCachedProjects();
        if (cached.length > 0) {
            ctx.host.projects = cached;
        }
    }
    ctx.host.projects = ctx.mergeSessionsSidebarProjects(ctx.host.projects);
}

export function ensureWorkHubSessionsSidebarExtracted(ctx: any): MobileWorkHubSessionsSidebar {
    if (!ctx.host.sessionsSidebar) {
        ctx.host.sessionsSidebar = new MobileWorkHubSessionsSidebar({
            renderSessionList: host => ctx.renderWorkHubSessionsSidebarList(host),
            shouldSkipSessionListRefresh: () => ctx.shouldSkipSessionsSidebarListRender(),
            tryPatchSessionList: host => ctx.tryPatchSessionsSidebarList(host),
            rememberSessionListFingerprint: host => ctx.rememberSessionsSidebarListFingerprint(host),
            shouldDeferSessionListRefresh: () => ctx.shouldDeferSessionsSidebarListRefresh(),
            onSessionListHostReady: host => {
                ctx.bindSessionsSidebarInteractionGuard(host);
                ctx.bindSessionsSidebarThreadStoreSubscriptions();
            },
            onNewChat: () => { void ctx.onWorkHubSessionsSidebarNewChat(); },
            onStartNewProject: () => { void ctx.host.onStartNewProject(); },
            onClose: () => {
                ctx.host.cardMenuUi.closeCardMenu();
                ctx.exitClearFailedMode({ refresh: false });
            },
            storageScope: () => ctx.host.projectsService.getCurrentWorkspaceCwd(),
            onAccountMenu: anchor => { ctx.onSessionsSidebarAccountClick(anchor); },
            onSearch: () => { void ctx.openSessionsSidebarSearch(); },
            isEmbedded: () => (!isDesktopSessionsSidebarLayout() || document.body.classList.contains('theia-mobile-mod-desktop-ide')) && ctx.host.sessionsSidebarContainer?.() !== undefined,
            getAppearanceMode: ctx.host.appearanceModeService
                ? () => ctx.host.appearanceModeService!.getMode()
                : undefined,
            setAppearanceMode: ctx.host.appearanceModeService
                ? mode => ctx.host.appearanceModeService!.setMode(mode)
                : undefined,
            onAppearanceModeChanged: ctx.host.appearanceModeService
                ? listener => ctx.host.appearanceModeService!.onDidChangeMode(listener)
                : undefined,
        });
    }
    const useBodyGrid = isDesktopSessionsSidebarLayout()
        && !document.body.classList.contains('theia-mobile-mod-desktop-ide');
    const embeddedContainer = ctx.host.sessionsSidebarContainer?.();
    const container = useBodyGrid
        ? document.body
        : (embeddedContainer ?? document.body);
    // A panel can be recreated while an earlier async bootstrap is still finishing.  That old
    // panel may have left its sidebar node mounted in <body>; keeping both nodes makes the two
    // dialogs compete for the same grid column and produces the clipped Work Hub paint seen
    // after returning from the IDE.  The sidebar held by the current panel is the single source
    // of truth, so remove any orphaned DOM instances before mounting it.
    const sidebarNode = ctx.host.sessionsSidebar.node;
    for (const orphan of Array.from(document.querySelectorAll<HTMLElement>('.theia-mobile-work-hub-sessions-sidebar'))) {
        if (orphan !== sidebarNode) {
            orphan.remove();
        }
    }
    if (sidebarNode.parentElement !== container) {
        container.append(sidebarNode);
    }
    ctx.host.sessionsSidebar.syncEmbeddedState?.(!useBodyGrid && embeddedContainer !== undefined);
    return ctx.host.sessionsSidebar;
}

export function buildSessionsSidebarFingerprintInputExtracted(ctx: any): WorkHubSessionsSidebarFingerprintInput {
    const pinnedConversationIds = new Set<string>();
    for (const project of ctx.host.projects) {
        for (const summary of ctx.host.conversationIndexUi.conversationsForProject(project)) {
            if (ctx.isSessionsSidebarPinnedConversation(summary)) {
                pinnedConversationIds.add(summary.id);
            }
        }
    }
    return {
        query: ctx.host.query,
        transcriptOpenSummaryId: ctx.host.transcriptOpenSummaryId,
        expandedProjectIds: ctx.host.sessionsSidebarExpandedProjectIds,
        visibleConversationCountByProjectId: ctx.host.sessionsSidebarVisibleConversationCountByProjectId,
        projects: ctx.host.projects.map(project => ({
            id: project.id,
            isCurrent: project.isCurrent,
        })),
        conversationsForProject: projectId => {
            const project = ctx.host.projects.find(entry => entry.id === projectId);
            if (!project) {
                return [];
            }
            return ctx.host.conversationIndexUi.conversationsForProject(project);
        },
        pinnedConversationIds,
    };
}

export function shouldSkipSessionsSidebarListRenderExtracted(ctx: any): boolean {
    if (!ctx.sessionsSidebarListFingerprint) {
        return false;
    }
    if (ctx.sessionsSidebarOpeningConversationId) {
        return true;
    }
    if (ctx.isSessionsSidebarInteractionGuardActive()) {
        return true;
    }
    return false;
}

export function shouldDeferSessionsSidebarListRefreshExtracted(ctx: any): boolean {
    if (ctx.isSessionsSidebarInteractionGuardActive()) {
        return true;
    }
    const now = Date.now();
    if (now - ctx.sessionsSidebarLastStreamRefreshAt < SESSIONS_SIDEBAR_STREAM_REFRESH_MS) {
        return true;
    }
    ctx.sessionsSidebarLastStreamRefreshAt = now;
    return false;
}

export function bindSessionsSidebarInteractionGuardExtracted(ctx: any, listHost: HTMLElement): void {
    if (ctx.sessionsSidebarInteractionBound) {
        return;
    }
    ctx.sessionsSidebarInteractionBound = true;
    const arm = (): void => {
        ctx.sessionsSidebarInteractionUntil = Date.now() + SESSIONS_SIDEBAR_INTERACTION_GUARD_MS;
    };
    listHost.addEventListener('pointerdown', arm, { capture: true });
    listHost.addEventListener('touchstart', arm, { capture: true, passive: true });
}

export function buildSessionsSidebarStructureFingerprintExtracted(ctx: any): string {
    const projects = [...ctx.host.projects].sort((a, b) => ctx.compareSessionsSidebarProjectOrder(a, b));
    const query = ctx.host.query.trim().toLowerCase();
    const pinnedGroups = ctx.collectSessionsSidebarPinnedGroups(projects, query);
    const visibleProjectGroupIds: string[] = [];
    for (const project of projects) {
        let conversations = [...ctx.host.conversationIndexUi.conversationsForProject(project)]
            .filter(summary => !ctx.isSessionsSidebarPinnedConversation(summary))
            .sort((a, b) => ctx.host.conversationIndexUi.compareConversationOrder(a, b));
        if (query) {
            conversations = conversations.filter(c => ctx.host.hubQueryUi.conversationMatchesQuery(c, query));
            if (conversations.length === 0) {
                continue;
            }
        }
        // Without a search query, always include the project group (even with 0 sessions).
        visibleProjectGroupIds.push(project.id);
    }
    const visibleSlots = ctx.collectSessionsSidebarConversationEntries().map(entry => ({
        projectId: entry.project.id,
        conversation: entry.summary,
        pinned: entry.pinned,
    }));
    return buildWorkHubSessionsSidebarVisibleStructureFingerprint({
        query,
        transcriptOpenSummaryId: ctx.host.transcriptOpenSummaryId,
        expandedProjectIds: ctx.host.sessionsSidebarExpandedProjectIds,
        visibleConversationCountByProjectId: ctx.host.sessionsSidebarVisibleConversationCountByProjectId,
        visibleProjectGroupIds,
        pinnedSectionProjectIds: pinnedGroups.map(group => group.project.id),
        visibleSlots,
    });
}

export function rememberSessionsSidebarListFingerprintExtracted(ctx: any, listHost: HTMLElement): void {
    const structure = ctx.buildSessionsSidebarStructureFingerprint();
    ctx.sessionsSidebarListFingerprint = structure;
    listHost.setAttribute(QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR, structure);
    ctx.stampSessionsSidebarRowFingerprints(listHost);
}

export function tryPatchSessionsSidebarListExtracted(ctx: any, listHost: HTMLElement): boolean {
    if (ctx.clearFailedModeProjectId) {
        return false;
    }
    if (ctx.isSessionsSidebarInteractionGuardActive()) {
        return true;
    }
    const structure = ctx.buildSessionsSidebarStructureFingerprint();
    if (listHost.getAttribute(QAAP_SESSIONS_SIDEBAR_STRUCTURE_FP_ATTR) !== structure) {
        return false;
    }
    let patchedAny = false;
    const entries = ctx.collectSessionsSidebarConversationEntries();
    const rowsByConversationId = new Map<string, HTMLElement>();
    for (const row of listHost.querySelectorAll<HTMLElement>(
        '.theia-mobile-projects-task-row[data-qaap-conversation-id]',
    )) {
        const conversationId = row.dataset.qaapConversationId;
        if (conversationId) {
            rowsByConversationId.set(conversationId, row);
        }
    }
    for (const entry of entries) {
        const nextFingerprint = ctx.buildSidebarRowFingerprint(entry);
        const existingRow = rowsByConversationId.get(entry.summary.id);
        if (!existingRow) {
            return false;
        }
        if (existingRow.getAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR) === nextFingerprint) {
            if (entry.summary.status === 'streaming') {
                const task = ctx.host.conversationIndexUi.summaryToTaskView(entry.summary);
                if (ctx.host.projectRowsUi.patchSidebarCompactTaskRow(existingRow, entry.project, task, entry.summary, {
                    isCurrent: ctx.host.transcriptOpenSummaryId === entry.summary.id,
                })) {
                    patchedAny = true;
                }
            }
            continue;
        }
        const task = ctx.host.conversationIndexUi.summaryToTaskView(entry.summary);
        if (ctx.host.projectRowsUi.patchSidebarCompactTaskRow(existingRow, entry.project, task, entry.summary, {
            isCurrent: ctx.host.transcriptOpenSummaryId === entry.summary.id,
        })) {
            existingRow.setAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR, nextFingerprint);
            patchedAny = true;
            continue;
        }
        const parentIds = entry.parentIds;
        const activeInfo = ctx.host.conversationIndexUi.activeInfoForProject(entry.project);
        const nextRow = ctx.host.projectRowsUi.createTaskItem(
            entry.project,
            task,
            activeInfo,
            entry.summary,
            parentIds,
            {
                compact: true,
                onActivate: () => {
                    ctx.beginSessionsSidebarConversationActivation(entry.summary.id);
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

export function stampSessionsSidebarRowFingerprintsExtracted(ctx: any, listHost: HTMLElement): void {
    const rowsByConversationId = new Map<string, HTMLElement>();
    for (const row of listHost.querySelectorAll<HTMLElement>(
        '.theia-mobile-projects-task-row[data-qaap-conversation-id]',
    )) {
        const conversationId = row.dataset.qaapConversationId;
        if (conversationId) {
            rowsByConversationId.set(conversationId, row);
        }
    }
    for (const entry of ctx.collectSessionsSidebarConversationEntries()) {
        const row = rowsByConversationId.get(entry.summary.id);
        if (row) {
            row.setAttribute(QAAP_SESSIONS_SIDEBAR_ROW_FP_ATTR, ctx.buildSidebarRowFingerprint(entry));
        }
    }
}

export function buildSidebarRowFingerprintExtracted(ctx: any, entry: SessionsSidebarConversationEntry,): string {
    const task = ctx.host.conversationIndexUi.summaryToTaskView(entry.summary);
    const unread = ctx.host.conversationIndexUi.isConversationUnread(entry.summary);
    const visualStatusId = resolveQaapAgentTaskVisualStatus(task, entry.summary, unread).id;
    return buildWorkHubSessionsSidebarRowFingerprint(entry.summary, {
        pinned: entry.pinned,
        isCurrent: ctx.host.transcriptOpenSummaryId === entry.summary.id,
        visualStatusId,
    });
}

export function collectSessionsSidebarConversationEntriesExtracted(ctx: any): SessionsSidebarConversationEntry[] {
    const projects = [...ctx.host.projects].sort((a, b) => ctx.compareSessionsSidebarProjectOrder(a, b));
    const query = ctx.host.query.trim().toLowerCase();
    const bypassConversationLimit = query.length > 0;
    const onActivate = (): void => {
        ctx.host.sessionsSidebar?.hideForMobileOverlay();
    };
    const entries: SessionsSidebarConversationEntry[] = [];
    const pinnedGroups = ctx.collectSessionsSidebarPinnedGroups(projects, query);
    for (const { project, conversations } of pinnedGroups) {
        const parentIds = ctx.collectParentIds(conversations);
        const partitioned = partitionAgentConversations(conversations);
        const { visible } = ctx.resolveSessionsSidebarVisibleConversations(
            project,
            partitioned.roots,
            bypassConversationLimit,
        );
        for (const summary of [
            ...expandConversationSlots(visible, partitioned.forksByParentId),
            ...[...partitioned.variantRuns.values()].flat(),
        ]) {
            entries.push({ project, summary, pinned: true, parentIds, onActivate });
        }
    }
    for (const project of projects) {
        let conversations = [...ctx.host.conversationIndexUi.conversationsForProject(project)]
            .filter(summary => !ctx.isSessionsSidebarPinnedConversation(summary))
            .sort((a, b) => ctx.host.conversationIndexUi.compareConversationOrder(a, b));
        if (query) {
            conversations = conversations.filter(c => ctx.host.hubQueryUi.conversationMatchesQuery(c, query));
            if (conversations.length === 0) {
                continue;
            }
        } else if (conversations.length === 0) {
            continue;
        }
        const parentIds = ctx.collectParentIds(conversations);
        const partitioned = partitionAgentConversations(conversations);
        const { visible } = ctx.resolveSessionsSidebarVisibleConversations(
            project,
            partitioned.roots,
            bypassConversationLimit,
        );
        for (const summary of [
            ...expandConversationSlots(visible, partitioned.forksByParentId),
            ...[...partitioned.variantRuns.values()].flat(),
        ]) {
            entries.push({ project, summary, pinned: false, parentIds, onActivate });
        }
    }
    return entries;
}

export function collectParentIdsExtracted(ctx: any, conversations: readonly QaapAgentConversationSummaryDTO[],): ReadonlySet<string> {
    const parentIds = new Set<string>();
    for (const summary of conversations) {
        if (summary.forkedFromId) {
            parentIds.add(summary.forkedFromId);
        }
    }
    return parentIds;
}

export function beginSessionsSidebarConversationActivationExtracted(ctx: any, conversationId: string): void {
    ctx.sessionsSidebarInteractionUntil = Date.now() + SESSIONS_SIDEBAR_INTERACTION_GUARD_MS;
    ctx.sessionsSidebarOpeningConversationId = conversationId;
    if (ctx.sessionsSidebarOpeningTimer !== undefined) {
        window.clearTimeout(ctx.sessionsSidebarOpeningTimer);
    }
    ctx.sessionsSidebarOpeningTimer = window.setTimeout(() => {
        ctx.sessionsSidebarOpeningConversationId = undefined;
        ctx.sessionsSidebarOpeningTimer = undefined;
    }, SESSIONS_SIDEBAR_INTERACTION_GUARD_MS);
}

export function refreshWorkHubSessionsSidebarListExtracted(ctx: any, force = false): void {
    if (force) {
        ctx.resetSessionsSidebarListFingerprint();
    }
    ctx.host.sessionsSidebar?.refreshList(force ? { force: true } : undefined);
}

export function resolveWorkHubSessionsSidebarProjectExtracted(ctx: any): MobileProjectEntry | undefined {
    if (ctx.host.agentsHubSelectedProjectId) {
        const selected = ctx.host.projects.find(p => p.id === ctx.host.agentsHubSelectedProjectId);
        if (selected) {
            return selected;
        }
    }
    return ctx.host.projects.find(p => p.isCurrent)
        ?? ctx.host.resolveHomePinnedProject();
}
