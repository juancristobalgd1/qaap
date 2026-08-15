// @ts-nocheck
// Extracted from mobile-projects-sessions-sidebar-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickPickItem } from '@theia/core/lib/browser';
import {
    readStoredAgent,
    SHELL_AGENT_ID,
} from '../common/qaap-agent-task-client';
import { isFailedRunSummary, type QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { collapseOlderFailedDuplicateTitles } from '../common/qaap-failed-duplicate-collapse';
import { QAAP_WORK_HUB_GETTING_STARTED } from '../common/mobile-work-hub-catalog';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { createLucideArrowUpRightIcon, createLucideSortIcon } from '@theia/qaap-adapters/lib/browser/qaap-lucide-icons';
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
import { listQaapAgentTaskVisualStatusLegendEntries, resolveQaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import {
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT,
    QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE,
    resolveSessionsSidebarInitialConversationLimit,
} from '../common/qaap-sessions-sidebar-conversation-limit';
import { MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE, SESSIONS_SIDEBAR_PROJECT_SORT_MODES } from './mobile-projects-sessions-sidebar-ui';
import { partitionAgentConversations } from '../common/qaap-isolated-fork-grouping';

export function createSessionsSidebarSignInHintExtracted(options?: { readonly compact?: boolean }): HTMLElement {
        const hint = document.createElement('div');
        hint.className = 'theia-mobile-projects-inbox-hint theia-mobile-work-hub-sessions-sidebar-signin';
        if (options?.compact) {
            hint.classList.add('theia-mod-compact');
        }
        const text = document.createElement('p');
        text.textContent = nls.localize(
            'qaap/sessionsSidebar/signInHint',
            'Sign in with GitHub to see your agent sessions.',
        );
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-projects-inbox-hint-btn';
        btn.textContent = nls.localize('qaap/sessionsSidebar/signIn', 'Sign in with GitHub');
        btn.addEventListener('click', () => startGithubOAuth());
        hint.append(text, btn);
        return hint;
}

export function renderWorkHubSessionsSidebarListExtracted(ctx: any, host: HTMLElement): void {
        const projects = [...ctx.host.projects].sort((a, b) => ctx.compareSessionsSidebarProjectOrder(a, b));
        const query = ctx.host.query.trim().toLowerCase();
        const signedIn = typeof ctx.readQaapSignedIn === 'function' ? ctx.readQaapSignedIn() : readQaapSignedIn();
        if (projects.length === 0) {
            if (!query && !signedIn) {
                host.append(createSessionsSidebarSignInHintExtracted());
                return;
            }
            const empty = document.createElement('p');
            empty.className = 'theia-mobile-work-hub-sessions-sidebar-empty';
            empty.textContent = query
                ? nls.localize('qaap/sessionsSidebar/noSearchResults', 'No sessions match your search.')
                : nls.localize('qaap/sessionsSidebar/noSessions', 'No agent sessions yet. Start one from Agents.');
            host.append(empty);
            return;
        }
        if (!query && !signedIn) {
            host.append(createSessionsSidebarSignInHintExtracted({ compact: true }));
        }
        const onActivate = (): void => {
            ctx.host.sessionsSidebar?.hideForMobileOverlay();
        };
        ctx.seedSessionsSidebarAccordionDefaults(projects);
        ctx.ensureSessionsSidebarActiveProjectExpanded(projects);
        const pinnedGroups = ctx.collectSessionsSidebarPinnedGroups(projects, query);
        const bypassConversationLimit = query.length > 0;
        if (pinnedGroups.length > 0) {
            host.append(ctx.createSessionsSidebarPinnedSection(pinnedGroups, onActivate, bypassConversationLimit));
        }
        const sectionHead = document.createElement('div');
        sectionHead.className = 'theia-mobile-tasks-inbox-section-head theia-mod-sessions-sidebar-projects-head';
        const sectionLabel = document.createElement('span');
        sectionLabel.className = 'theia-mobile-tasks-inbox-section-label';
        sectionLabel.textContent = nls.localize('qaap/sessionsSidebar/projectsSection', 'Projects');
        sectionHead.append(sectionLabel);
        const sectionActions = document.createElement('div');
        sectionActions.className = 'theia-mobile-work-hub-sessions-sidebar-projects-head-actions';
        const sortBtn = document.createElement('button');
        sortBtn.type = 'button';
        sortBtn.className = 'theia-mobile-work-hub-sessions-sidebar-head-action theia-mod-sort';
        const sortIcon = createLucideSortIcon();
        sortBtn.append(sortIcon);
        sortBtn.title = nls.localize('qaap/sessionsSidebar/sort/title', 'Sort projects');
        sortBtn.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/sort/title', 'Sort projects'));
        sortBtn.setAttribute('aria-haspopup', 'menu');
        sortBtn.setAttribute('aria-expanded', 'false');
        sortBtn.addEventListener('click', event => {
            event.stopPropagation();
            ctx.toggleSessionsSidebarProjectSortPopover(sortBtn);
        });
        const legendBtn = document.createElement('button');
        legendBtn.type = 'button';
        legendBtn.className = 'theia-mobile-work-hub-sessions-sidebar-head-action theia-mod-status-legend';
        const legendIcon = document.createElement('span');
        legendIcon.className = 'codicon codicon-question';
        legendIcon.setAttribute('aria-hidden', 'true');
        legendBtn.append(legendIcon);
        legendBtn.title = nls.localize('qaap/sessionsSidebar/statusLegend/title', 'Status icon meanings');
        legendBtn.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/statusLegend/title', 'Status icon meanings'));
        legendBtn.setAttribute('aria-haspopup', 'dialog');
        legendBtn.setAttribute('aria-expanded', 'false');
        legendBtn.addEventListener('click', event => {
            event.stopPropagation();
            ctx.toggleSessionsSidebarStatusLegendPopover(legendBtn);
        });
        const addProjectBtn = document.createElement('button');
        addProjectBtn.type = 'button';
        addProjectBtn.className = 'theia-mobile-work-hub-sessions-sidebar-head-action theia-mod-add-project';
        const addProjectIcon = document.createElement('span');
        addProjectIcon.className = 'codicon codicon-new-folder';
        addProjectIcon.setAttribute('aria-hidden', 'true');
        addProjectBtn.append(addProjectIcon);
        addProjectBtn.title = nls.localize('qaap/sessionsSidebar/addProject/title', 'Add project');
        addProjectBtn.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/addProject/title', 'Add project'));
        addProjectBtn.setAttribute('aria-haspopup', 'menu');
        addProjectBtn.setAttribute('aria-expanded', 'false');
        addProjectBtn.addEventListener('click', event => {
            event.stopPropagation();
            ctx.toggleSessionsSidebarAddProjectPopover(addProjectBtn);
        });
        sectionActions.append(sortBtn, legendBtn, addProjectBtn);
        sectionHead.append(sectionActions);
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-sessions-sidebar-projects-list';
        let visibleCount = 0;
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
            // Always list the project (accordion) even when it has no sessions yet.
            list.append(ctx.createSessionsSidebarProjectGroup(project, conversations, onActivate, bypassConversationLimit));
            visibleCount++;
        }
        if (visibleCount === 0 && pinnedGroups.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'theia-mobile-work-hub-sessions-sidebar-empty';
            empty.textContent = query
                ? nls.localize('qaap/sessionsSidebar/noSearchResults', 'No sessions match your search.')
                : nls.localize('qaap/sessionsSidebar/noSessions', 'No agent sessions yet. Start one from Agents.');
            host.append(empty);
            return;
        }
        if (visibleCount > 0) {
            host.append(sectionHead, list);
        }
        ctx.syncSessionsSidebarAnimatedListHeights(host);
        ctx.prefetchVisibleSidebarDocuments();
        ctx.bindSessionsSidebarThreadStoreSubscriptions();
}

export function bindSessionsSidebarThreadStoreSubscriptionsExtracted(ctx: any): void {
        ctx.sessionsSidebarThreadStoreDispose.dispose();
        const conversations = ctx.host.conversations;
        if (!conversations || !ctx.isWorkHubSessionsSidebarVisible()) {
            ctx.sessionsSidebarThreadStoreDispose = Disposable.NULL;
            return;
        }
        const disposables = new DisposableCollection();
        for (const entry of ctx.collectSessionsSidebarConversationEntries()) {
            if (entry.summary.source === 'theia-chat') {
                continue;
            }
            const conversationId = entry.summary.id;
            disposables.push(conversations.threadStore.subscribe(
                () => { ctx.scheduleWorkHubSessionsSidebarRefresh(); },
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
        ctx.sessionsSidebarThreadStoreDispose = disposables;
}

export function prefetchVisibleSidebarDocumentsExtracted(ctx: any, limit = 8): void {
        const conversations = ctx.host.conversations;
        if (!conversations) {
            return;
        }
        const ids: string[] = [];
        for (const entry of ctx.collectSessionsSidebarConversationEntries()) {
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

export function syncSessionsSidebarAnimatedListHeightsExtracted(ctx: any, host: HTMLElement): void {
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

export function collectSessionsSidebarPinnedGroupsExtracted(ctx: any, projects: MobileProjectEntry[],
        query: string,): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
        const groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> = [];
        for (const project of projects) {
            let conversations = ctx.host.conversationIndexUi.conversationsForProject(project)
                .filter(summary => ctx.isSessionsSidebarPinnedConversation(summary))
                .sort((a, b) => ctx.host.conversationIndexUi.compareConversationOrder(a, b));
            if (query) {
                conversations = conversations.filter(c => ctx.host.hubQueryUi.conversationMatchesQuery(c, query));
            }
            if (conversations.length > 0) {
                groups.push({ project, conversations });
            }
        }
        return groups;
}

export function createSessionsSidebarPinnedSectionExtracted(ctx: any, groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>,
        onActivate: () => void,
        bypassConversationLimit = false,): HTMLElement {
        const section = document.createElement('section');
        section.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-section';
        const head = document.createElement('div');
        head.className = 'theia-mobile-tasks-inbox-section-head theia-mod-sessions-sidebar-pinned-head';
        const label = document.createElement('span');
        label.className = 'theia-mobile-tasks-inbox-section-label';
        label.textContent = nls.localize('qaap/sessionsSidebar/pinnedSection', 'Pinned');
        head.append(label);
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-sessions-sidebar-pinned-list';
        for (const { project, conversations } of groups) {
            list.append(ctx.createSessionsSidebarPinnedProjectGroup(project, conversations, onActivate, bypassConversationLimit));
        }
        section.append(head, list);
        return section;
}

export function resolveSessionsSidebarCollapsedLimitExtracted(ctx: any, totalConversations: number): number {
        const projectCount = ctx.host.hubQueryUi.projectsForCurrentHubList().length;
        return resolveSessionsSidebarInitialConversationLimit({
            projectCount,
            totalConversations,
            viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
        });
}

export function getSessionsSidebarConversationDisplayLimitExtracted(ctx: any, project: MobileProjectEntry,
        totalCount: number,
        bypassLimit: boolean,): number {
        if (bypassLimit || totalCount === 0) {
            return totalCount;
        }
        const stored = ctx.host.sessionsSidebarVisibleConversationCountByProjectId.get(project.id);
        const limit = stored ?? ctx.resolveSessionsSidebarCollapsedLimit(totalCount);
        return Math.min(limit, totalCount);
}

export function resolveSessionsSidebarVisibleConversationsExtracted(ctx: any, project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        bypassLimit: boolean,): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
        const all = [...conversations];
        if (bypassLimit) {
            return { visible: all, hiddenCount: 0, showLess: false };
        }
        const defaultLimit = ctx.resolveSessionsSidebarCollapsedLimit(all.length);
        const displayLimit = ctx.getSessionsSidebarConversationDisplayLimit(project, all.length, bypassLimit);
        if (all.length <= defaultLimit && !ctx.host.sessionsSidebarVisibleConversationCountByProjectId.has(project.id)) {
            return { visible: all, hiddenCount: 0, showLess: false };
        }
        const visible = all.slice(0, displayLimit);
        const openId = ctx.host.transcriptOpenSummaryId;
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

export function appendSessionsSidebarConversationItemsExtracted(ctx: any, listHost: HTMLElement,
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassLimit: boolean,): void {
        const clearMode = ctx.isClearFailedModeForProject?.(project.id) === true
            || ctx.clearFailedModeProjectId === project.id;
        const collapsed = clearMode
            ? { conversations: [...conversations], hiddenFailedByKeptId: new Map<string, number>() }
            : collapseOlderFailedDuplicateTitles(conversations);
        const partitioned = partitionAgentConversations(collapsed.conversations);
        const { visible, hiddenCount, showLess } = ctx.resolveSessionsSidebarVisibleConversations(
            project,
            partitioned.roots,
            bypassLimit,
        );
        if (visible.length === 0 && partitioned.variantRuns.size === 0) {
            const failedCount = ctx.host.conversationIndexUi.countFailedTasks(project);
            if (failedCount > 0) {
                listHost.append(clearMode
                    ? ctx.createSessionsSidebarClearFailedModeFooter(project)
                    : ctx.createSessionsSidebarClearFailedControl(project, failedCount));
            }
            return;
        }
        const activeInfo = ctx.host.conversationIndexUi.activeInfoForProject(project);
        const parentIds = new Set<string>();
        for (const summary of collapsed.conversations) {
            if (summary.forkedFromId) {
                parentIds.add(summary.forkedFromId);
            }
        }
        const parallel = ctx.host.ensureOverlayUi?.()?.parallel;
        const openConversation = (summary: QaapAgentConversationSummaryDTO): void => {
            ctx.beginSessionsSidebarConversationActivation(summary.id);
            onActivate();
        };
        const selectionFor = (summary: QaapAgentConversationSummaryDTO): { selected: boolean; onToggle: () => void } | undefined => {
            if (!clearMode || !isFailedRunSummary(summary)) {
                return undefined;
            }
            return {
                selected: ctx.selectedFailedConversationIds.has(summary.id),
                onToggle: () => ctx.toggleClearFailedSelection(summary.id),
            };
        };
        for (const summary of visible) {
            const task = ctx.host.conversationIndexUi.summaryToTaskView(summary);
            listHost.append(ctx.host.projectRowsUi.createTaskItem(project, task, activeInfo, summary, parentIds, {
                onActivate: () => openConversation(summary),
                compact: true,
                failedDuplicateCount: collapsed.hiddenFailedByKeptId.get(summary.id) ?? 0,
                selection: selectionFor(summary),
            }));
            const forks = partitioned.forksByParentId.get(summary.id);
            if (forks?.length) {
                if (parallel) {
                    listHost.append(parallel.createVariantRunSection(project, summary.id, [...forks], activeInfo, parentIds, {
                        compact: true,
                        mode: 'isolated-forks',
                        onActivate: openConversation,
                    }));
                } else {
                    for (const fork of forks) {
                        const forkTask = ctx.host.conversationIndexUi.summaryToTaskView(fork);
                        listHost.append(ctx.host.projectRowsUi.createTaskItem(project, forkTask, activeInfo, fork, parentIds, {
                            onActivate: () => openConversation(fork),
                            compact: true,
                            failedDuplicateCount: collapsed.hiddenFailedByKeptId.get(fork.id) ?? 0,
                            selection: selectionFor(fork),
                        }));
                    }
                }
            }
        }
        if (parallel) {
            for (const [runId, summaries] of partitioned.variantRuns) {
                listHost.append(parallel.createVariantRunSection(project, runId, [...summaries], activeInfo, parentIds, {
                    compact: true,
                    onActivate: openConversation,
                }));
            }
        } else {
            for (const summaries of partitioned.variantRuns.values()) {
                for (const summary of summaries) {
                    const task = ctx.host.conversationIndexUi.summaryToTaskView(summary);
                    listHost.append(ctx.host.projectRowsUi.createTaskItem(project, task, activeInfo, summary, parentIds, {
                        onActivate: () => openConversation(summary),
                        compact: true,
                        failedDuplicateCount: collapsed.hiddenFailedByKeptId.get(summary.id) ?? 0,
                        selection: selectionFor(summary),
                    }));
                }
            }
        }
        const failedCount = ctx.host.conversationIndexUi.countFailedTasks(project);
        if (failedCount > 0) {
            listHost.append(clearMode
                ? ctx.createSessionsSidebarClearFailedModeFooter(project)
                : ctx.createSessionsSidebarClearFailedControl(project, failedCount));
        }
        if (bypassLimit) {
            return;
        }
        const totalCount = partitioned.roots.length;
        if (hiddenCount > 0) {
            listHost.append(ctx.createSessionsSidebarShowMoreControl(project, hiddenCount, totalCount));
        } else if (showLess) {
            listHost.append(ctx.createSessionsSidebarShowLessControl(project));
        }
}

export function createSessionsSidebarClearFailedControlExtracted(
    ctx: any,
    project: MobileProjectEntry,
    failedCount: number,
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theia-mobile-work-hub-sessions-sidebar-clear-failed';
    btn.textContent = failedCount === 1
        ? nls.localize('qaap/mobileProjects/clearFailedTasksOne', 'Clear failed run')
        : nls.localize('qaap/mobileProjects/clearFailedTasksMany', 'Clear failed runs ({0})', String(failedCount));
    btn.title = nls.localize(
        'qaap/sessionsSidebar/clearFailedHint',
        'Select failed runs to delete for this project',
    );
    const icon = document.createElement('span');
    icon.className = 'codicon codicon-clear-all';
    icon.setAttribute('aria-hidden', 'true');
    btn.prepend(icon);
    btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const failedIds = ctx.host.conversationIndexUi.vpsTasksForProject(project)
            .filter((summary: QaapAgentConversationSummaryDTO) => isFailedRunSummary(summary))
            .map((summary: QaapAgentConversationSummaryDTO) => summary.id);
        ctx.enterClearFailedMode(project, failedIds);
    });
    return btn;
}

export function createSessionsSidebarClearFailedModeFooterExtracted(
    ctx: any,
    project: MobileProjectEntry,
): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'theia-mobile-work-hub-sessions-sidebar-clear-failed-mode-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'theia-mobile-work-hub-sessions-sidebar-clear-failed-cancel';
    cancelBtn.textContent = nls.localize('qaap/sessionsSidebar/clearFailedCancel', 'Cancel');
    cancelBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        ctx.exitClearFailedMode();
    });

    const selectedCount = [...ctx.selectedFailedConversationIds].filter(id => {
        const summaries = ctx.host.conversationIndexUi.vpsTasksForProject(project) as QaapAgentConversationSummaryDTO[];
        return summaries.some(summary => summary.id === id && isFailedRunSummary(summary));
    }).length;

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'theia-mobile-work-hub-sessions-sidebar-clear-failed-confirm';
    clearBtn.textContent = selectedCount === 0
        ? nls.localize('qaap/sessionsSidebar/clearFailedSelectedNone', 'Clear selected')
        : nls.localize('qaap/sessionsSidebar/clearFailedSelectedMany', 'Clear selected ({0})', String(selectedCount));
    clearBtn.disabled = selectedCount === 0;
    clearBtn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (clearBtn.disabled) {
            return;
        }
        const ids = [...ctx.selectedFailedConversationIds];
        void (async () => {
            const cleared = await ctx.host.onClearFailedTasks(project, ids);
            if (cleared) {
                ctx.exitClearFailedMode();
            }
        })();
    });

    footer.append(cancelBtn, clearBtn);
    return footer;
}

export function createSessionsSidebarShowMoreControlExtracted(ctx: any, project: MobileProjectEntry,
        hiddenCount: number,
        totalCount: number,): HTMLButtonElement {
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'theia-mobile-work-hub-sessions-sidebar-show-more';
        moreBtn.textContent = nls.localize('qaap/sessionsSidebar/showMore', 'Show more');
        const pageSize = MOBILE_PROJECTS_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE;
        moreBtn.title = nls.localize(
            'qaap/sessionsSidebar/showMoreHint',
            'Show {0} more sessions',
            String(Math.min(pageSize, hiddenCount)),
        );
        moreBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const current = ctx.host.sessionsSidebarVisibleConversationCountByProjectId.get(project.id)
                ?? ctx.resolveSessionsSidebarCollapsedLimit(totalCount);
            ctx.host.sessionsSidebarVisibleConversationCountByProjectId.set(
                project.id,
                Math.min(current + pageSize, totalCount),
            );
            ctx.resetSessionsSidebarListFingerprint();
            ctx.host.sessionsSidebar?.refreshList({ force: true });
        });
        return moreBtn;
}

export function createSessionsSidebarShowLessControlExtracted(ctx: any, project: MobileProjectEntry): HTMLButtonElement {
        const lessBtn = document.createElement('button');
        lessBtn.type = 'button';
        lessBtn.className = 'theia-mobile-work-hub-sessions-sidebar-show-more theia-mod-show-less';
        lessBtn.textContent = nls.localize('qaap/sessionsSidebar/showLess', 'Show less');
        lessBtn.title = nls.localize(
            'qaap/sessionsSidebar/showLessHint',
            'Show only the first {0} sessions',
            String(ctx.resolveSessionsSidebarCollapsedLimit(
                ctx.host.conversationIndexUi.conversationsForProject(project).length,
            )),
        );
        lessBtn.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();
            ctx.host.sessionsSidebarVisibleConversationCountByProjectId.delete(project.id);
            ctx.resetSessionsSidebarListFingerprint();
            ctx.host.sessionsSidebar?.refreshList({ force: true });
        });
        return lessBtn;
}

export function createSessionsSidebarPinnedProjectGroupExtracted(ctx: any, project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassConversationLimit = false,): HTMLElement {
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
        ctx.appendSessionsSidebarConversationItems(taskList, project, conversations, onActivate, bypassConversationLimit);
        group.append(projectHead, taskList);
        return group;
}

export function seedSessionsSidebarAccordionDefaultsExtracted(ctx: any, projects: MobileProjectEntry[]): void {
        if (ctx.host.sessionsSidebarAccordionDefaultsApplied) {
            return;
        }
        ctx.host.sessionsSidebarAccordionDefaultsApplied = true;
        for (const project of projects) {
            if (project.isCurrent || ctx.host.conversationIndexUi.countRunningTasks(project) > 0) {
                ctx.host.sessionsSidebarExpandedProjectIds.add(project.id);
            }
        }
        if (projects.length > 0 && ctx.host.sessionsSidebarExpandedProjectIds.size === 0) {
            ctx.host.sessionsSidebarExpandedProjectIds.add(projects[0].id);
        }
}

export function ensureSessionsSidebarActiveProjectExpandedExtracted(ctx: any, projects: MobileProjectEntry[]): void {
        const selectedId = ctx.host.agentsHubSelectedProjectId;
        for (const project of projects) {
            if (
                project.isCurrent
                || project.id === selectedId
                || ctx.host.conversationIndexUi.countRunningTasks(project) > 0
            ) {
                ctx.host.sessionsSidebarExpandedProjectIds.add(project.id);
            }
        }
        const active = ctx.resolveWorkHubSessionsSidebarProject();
        if (active && projects.some(project => project.id === active.id)) {
            ctx.host.sessionsSidebarExpandedProjectIds.add(active.id);
        }
}

export function compareSessionsSidebarProjectOrderExtracted(ctx: any, a: MobileProjectEntry, b: MobileProjectEntry): number {
        const mode = ctx.getSessionsSidebarProjectSortMode?.() ?? 'default';
        if (mode === 'alphabetical') {
            return a.name.localeCompare(b.name);
        }
        if (mode === 'createdAt') {
            const aCreated = ctx.resolveSessionsSidebarProjectCreatedAt(a);
            const bCreated = ctx.resolveSessionsSidebarProjectCreatedAt(b);
            if (aCreated !== bCreated) {
                return bCreated - aCreated; // newest project first
            }
            return a.name.localeCompare(b.name);
        }
        if (mode === 'lastMessage') {
            const aLast = ctx.resolveSessionsSidebarProjectLastMessageAt(a);
            const bLast = ctx.resolveSessionsSidebarProjectLastMessageAt(b);
            if (aLast !== bLast) {
                return bLast - aLast; // most recent user message first
            }
            return a.name.localeCompare(b.name);
        }
        // 'default': running tasks first, then current, then selected, then recent activity, then name.
        const aRunning = ctx.host.conversationIndexUi.countRunningTasks(a) > 0 ? 1 : 0;
        const bRunning = ctx.host.conversationIndexUi.countRunningTasks(b) > 0 ? 1 : 0;
        if (aRunning !== bRunning) {
            return bRunning - aRunning;
        }
        if (a.isCurrent !== b.isCurrent) {
            return a.isCurrent ? -1 : 1;
        }
        const selectedId = ctx.host.agentsHubSelectedProjectId;
        const aSelected = selectedId && a.id === selectedId ? 1 : 0;
        const bSelected = selectedId && b.id === selectedId ? 1 : 0;
        if (aSelected !== bSelected) {
            return bSelected - aSelected;
        }
        const aTime = a.lastActiveAt ? Date.parse(a.lastActiveAt) : NaN;
        const bTime = b.lastActiveAt ? Date.parse(b.lastActiveAt) : NaN;
        const aValid = Number.isFinite(aTime) ? aTime : 0;
        const bValid = Number.isFinite(bTime) ? bTime : 0;
        if (aValid !== bValid) {
            return bValid - aValid;
        }
        return a.name.localeCompare(b.name);
}

function positionSessionsSidebarHeadPopover(popover: HTMLElement, anchor: HTMLElement): void {
        const margin = 8;
        const gap = 6;
        const anchorRect = anchor.getBoundingClientRect();
        const popoverWidth = popover.offsetWidth;
        const popoverHeight = popover.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        let top = anchorRect.bottom + gap;
        if (top + popoverHeight > viewportHeight - margin) {
            const aboveTop = anchorRect.top - gap - popoverHeight;
            top = aboveTop >= margin ? aboveTop : Math.max(margin, viewportHeight - margin - popoverHeight);
        }
        let left = anchorRect.right - popoverWidth;
        left = Math.max(margin, Math.min(left, viewportWidth - popoverWidth - margin));
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
}

function dismissSessionsSidebarHeadPopoverOnOutside(
        popover: HTMLElement,
        anchor: HTMLElement,
        onDismiss: () => void,
): () => void {
        const isInside = (target: EventTarget | null): boolean => {
            if (!(target instanceof Node)) {
                return false;
            }
            return popover.contains(target) || anchor.contains(target);
        };
        const handlePointerDown = (event: PointerEvent): void => {
            if (isInside(event.target)) {
                return;
            }
            onDismiss();
        };
        const handleClick = (event: MouseEvent): void => {
            if (isInside(event.target)) {
                return;
            }
            onDismiss();
        };
        const handleKeydown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
                window.setTimeout(() => anchor.focus(), 0);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('click', handleClick, true);
        document.addEventListener('keydown', handleKeydown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('keydown', handleKeydown, true);
        };
}

function bindSessionsSidebarHeadPopoverKeyboard(
        popover: HTMLElement,
        anchor: HTMLButtonElement,
        initialIndex = 0,
        onDismiss: () => void,
): () => void {
        const items = [...popover.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')];
        const focusAt = (index: number): void => {
            if (items.length === 0) {
                return;
            }
            const normalized = (index + items.length) % items.length;
            items.forEach((item, itemIndex) => item.tabIndex = itemIndex === normalized ? 0 : -1);
            items[normalized].focus();
        };
        items.forEach((item, index) => item.tabIndex = index === initialIndex ? 0 : -1);
        const handleKeydown = (event: KeyboardEvent): void => {
            const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusAt(currentIndex + 1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                focusAt(currentIndex - 1);
            } else if (event.key === 'Home') {
                event.preventDefault();
                focusAt(0);
            } else if (event.key === 'End') {
                event.preventDefault();
                focusAt(items.length - 1);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
                window.setTimeout(() => anchor.focus(), 0);
            }
        };
        popover.addEventListener('keydown', handleKeydown);
        window.requestAnimationFrame(() => focusAt(initialIndex));
        return () => popover.removeEventListener('keydown', handleKeydown);
}

export function toggleSessionsSidebarProjectSortPopoverExtracted(ctx: any, anchor: HTMLButtonElement): void {
        if (ctx.sessionsSidebarSortPopover) {
            ctx.closeSessionsSidebarHeadPopovers();
            return;
        }
        ctx.closeSessionsSidebarHeadPopovers();
        const popover = document.createElement('div');
        popover.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover theia-mod-sort';
        popover.setAttribute('role', 'menu');
        popover.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/sort/title', 'Sort projects'));
        const currentMode = ctx.getSessionsSidebarProjectSortMode();
        for (const entry of SESSIONS_SIDEBAR_PROJECT_SORT_MODES) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item';
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', entry.id === currentMode ? 'true' : 'false');
            const label = document.createElement('span');
            label.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item-label';
            label.textContent = nls.localize(entry.labelKey, entry.defaultLabel);
            const check = document.createElement('span');
            check.className = 'codicon codicon-check theia-mobile-work-hub-sessions-sidebar-head-popover-item-check';
            check.setAttribute('aria-hidden', 'true');
            check.style.visibility = entry.id === currentMode ? 'visible' : 'hidden';
            item.append(label, check);
            item.addEventListener('click', () => {
                ctx.setSessionsSidebarProjectSortMode(entry.id);
                ctx.closeSessionsSidebarHeadPopovers();
            });
            popover.append(item);
        }
        document.body.append(popover);
        ctx.sessionsSidebarSortPopover = popover;
        anchor.setAttribute('aria-expanded', 'true');
        window.requestAnimationFrame(() => positionSessionsSidebarHeadPopover(popover, anchor));
        const dismissCleanup = dismissSessionsSidebarHeadPopoverOnOutside(popover, anchor, () => {
            ctx.closeSessionsSidebarHeadPopovers();
        });
        const originalClose = ctx.closeSessionsSidebarHeadPopovers.bind(ctx);
        const keyboardCleanup = bindSessionsSidebarHeadPopoverKeyboard(
            popover,
            anchor,
            Math.max(0, SESSIONS_SIDEBAR_PROJECT_SORT_MODES.findIndex(entry => entry.id === currentMode)),
            () => ctx.closeSessionsSidebarHeadPopovers(),
        );
        ctx.closeSessionsSidebarHeadPopovers = (): void => {
            dismissCleanup();
            keyboardCleanup();
            popover.remove();
            ctx.sessionsSidebarSortPopover = undefined;
            anchor.setAttribute('aria-expanded', 'false');
            ctx.closeSessionsSidebarHeadPopovers = originalClose;
        };
}

export function toggleSessionsSidebarAddProjectPopoverExtracted(ctx: any, anchor: HTMLButtonElement): void {
        if (ctx.sessionsSidebarAddProjectPopover) {
            ctx.closeSessionsSidebarHeadPopovers();
            return;
        }
        ctx.closeSessionsSidebarHeadPopovers();
        const popover = document.createElement('div');
        popover.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover theia-mod-add-project';
        popover.setAttribute('role', 'menu');
        popover.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/addProject/title', 'Add project'));
        const startNew = document.createElement('button');
        startNew.type = 'button';
        startNew.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item';
        startNew.setAttribute('role', 'menuitem');
        const startNewIcon = document.createElement('span');
        startNewIcon.className = 'codicon codicon-repo theia-mobile-work-hub-sessions-sidebar-head-popover-item-icon';
        startNewIcon.setAttribute('aria-hidden', 'true');
        const startNewLabel = document.createElement('span');
        startNewLabel.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item-label';
        startNewLabel.textContent = nls.localize('qaap/mobileOpenRepo/startNewProject', 'Start new project');
        startNew.append(startNewIcon, startNewLabel);
        startNew.addEventListener('click', () => {
            ctx.closeSessionsSidebarHeadPopovers();
            void ctx.host.onStartNewProject();
        });
        const addRepo = document.createElement('button');
        addRepo.type = 'button';
        addRepo.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item';
        addRepo.setAttribute('role', 'menuitem');
        const addRepoIcon = document.createElement('span');
        addRepoIcon.className = 'codicon codicon-repo-clone theia-mobile-work-hub-sessions-sidebar-head-popover-item-icon';
        addRepoIcon.setAttribute('aria-hidden', 'true');
        const addRepoLabel = document.createElement('span');
        addRepoLabel.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item-label';
        addRepoLabel.textContent = nls.localize('qaap/mobileProjects/newRepository', 'Add repository');
        addRepo.append(addRepoIcon, addRepoLabel);
        addRepo.addEventListener('click', () => {
            ctx.closeSessionsSidebarHeadPopovers();
            void ctx.host.onNewClick();
        });
        popover.append(startNew, addRepo);
        document.body.append(popover);
        ctx.sessionsSidebarAddProjectPopover = popover;
        anchor.setAttribute('aria-expanded', 'true');
        window.requestAnimationFrame(() => positionSessionsSidebarHeadPopover(popover, anchor));
        const dismissCleanup = dismissSessionsSidebarHeadPopoverOnOutside(popover, anchor, () => {
            ctx.closeSessionsSidebarHeadPopovers();
        });
        const originalClose = ctx.closeSessionsSidebarHeadPopovers.bind(ctx);
        const keyboardCleanup = bindSessionsSidebarHeadPopoverKeyboard(
            popover,
            anchor,
            0,
            () => ctx.closeSessionsSidebarHeadPopovers(),
        );
        ctx.closeSessionsSidebarHeadPopovers = (): void => {
            dismissCleanup();
            keyboardCleanup();
            popover.remove();
            ctx.sessionsSidebarAddProjectPopover = undefined;
            anchor.setAttribute('aria-expanded', 'false');
            ctx.closeSessionsSidebarHeadPopovers = originalClose;
        };
}

function createSessionsSidebarStatusLegendGlyph(status: ReturnType<typeof listQaapAgentTaskVisualStatusLegendEntries>[number]): HTMLElement {
        const glyph = document.createElement('span');
        glyph.className = `theia-mobile-work-hub-sessions-sidebar-status-legend-glyph theia-mobile-projects-task-dot ${status.className}`;
        glyph.setAttribute('aria-hidden', 'true');
        if (status.id === 'running') {
            glyph.classList.add('theia-mod-legend-running');
            const spin = document.createElement('span');
            spin.className = 'codicon codicon-loading codicon-modifier-spin theia-mobile-projects-task-leading-glyph';
            glyph.append(spin);
            return glyph;
        }
        if (status.id === 'idle') {
            glyph.style.background = status.color;
            return glyph;
        }
        if (status.iconClass) {
            const icon = document.createElement('span');
            icon.className = `theia-mobile-projects-task-leading-glyph codicon ${status.iconClass}`;
            glyph.append(icon);
        }
        return glyph;
}

export function toggleSessionsSidebarStatusLegendPopoverExtracted(ctx: any, anchor: HTMLButtonElement): void {
        if (ctx.sessionsSidebarStatusLegendPopover) {
            ctx.closeSessionsSidebarHeadPopovers();
            return;
        }
        ctx.closeSessionsSidebarHeadPopovers();
        const popover = document.createElement('div');
        popover.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover theia-mod-status-legend';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', nls.localize('qaap/sessionsSidebar/statusLegend/title', 'Status icon meanings'));
        const list = document.createElement('div');
        list.className = 'theia-mobile-work-hub-sessions-sidebar-status-legend-list';
        list.setAttribute('role', 'list');
        for (const status of listQaapAgentTaskVisualStatusLegendEntries()) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item theia-mod-legend-row';
            row.setAttribute('role', 'listitem');
            const label = document.createElement('span');
            label.className = 'theia-mobile-work-hub-sessions-sidebar-head-popover-item-label';
            label.textContent = nls.localize(status.labelKey, status.label);
            row.append(createSessionsSidebarStatusLegendGlyph(status), label);
            list.append(row);
        }
        popover.append(list);
        document.body.append(popover);
        ctx.sessionsSidebarStatusLegendPopover = popover;
        anchor.setAttribute('aria-expanded', 'true');
        window.requestAnimationFrame(() => positionSessionsSidebarHeadPopover(popover, anchor));
        const dismissCleanup = dismissSessionsSidebarHeadPopoverOnOutside(popover, anchor, () => {
            ctx.closeSessionsSidebarHeadPopovers();
        });
        const originalClose = ctx.closeSessionsSidebarHeadPopovers.bind(ctx);
        ctx.closeSessionsSidebarHeadPopovers = (): void => {
            dismissCleanup();
            popover.remove();
            ctx.sessionsSidebarStatusLegendPopover = undefined;
            anchor.setAttribute('aria-expanded', 'false');
            ctx.closeSessionsSidebarHeadPopovers = originalClose;
        };
}
