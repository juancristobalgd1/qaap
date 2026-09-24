import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
// Extracted from mobile-one-column-shell-contribution.ts

import { toArray } from '@lumino/algorithm';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { Disposable } from '@theia/core/lib/common/disposable';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import {
    matchesMobileOneColumnLayout,
    matchesMobileNarrowViewport,
} from '@theia/core/lib/browser/shell/mobile-layout-state';
import { MobileProjectEntry } from './mobile-projects-types';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { planDesktopIdeWorkspaceOpen } from '../common/qaap-desktop-ide-workspace-plan';
import { MobileSnackbar } from './mobile-snackbar';
import { MobileAgentTaskComposer } from './mobile-agent-task-composer';
import { MobileWorkHubPreferencesSheet } from './mobile-work-hub-preferences-sheet';
import { MobileWorkHubBillingSheet } from './mobile-work-hub-billing-sheet';
import {
    markPreferAgentsSurface,
    markPreferDesktopIde,
    peekPreferDesktopIde,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubSideSheetOpen,
    syncMobileWorkHubHideIdeSidePanelsFromComposerHeader,
} from './mobile-projects-open';
import { QaapMobileProjectsDashboardCommands } from './mobile-projects-dashboard-commands';
import { QaapWorkbenchHistoryNavWidget, QaapWorkbenchRightControlsWidget } from './qaap-workbench-top-bar-widgets';
import {
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    QAAP_WORK_HUB_OVERVIEW_COMMAND,
} from './qaap-workbench-account-menu';
import {
    QAAP_WORK_HUB_AI_CONFIGURATION_COMMAND,
    QAAP_WORK_HUB_AI_FEATURES_COMMAND,
} from '../common/mobile-work-hub-catalog';
import {
    QAAP_WORK_HUB_NEW_AGENT_COMMAND,
    QAAP_WORK_HUB_OPEN_BILLING_COMMAND,
    QAAP_WORK_HUB_OPEN_REPOSITORY_COMMAND,
    QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND,
    QAAP_WORK_HUB_SEARCH_COMMAND,
} from '../common/qaap-work-hub-command-palette';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { writeStoredComposerSurface } from '../common/qaap-composer-surface';
import {
    EXPLORER_VIEW_CONTAINER_ID,
    isMiniBrowserPreviewWidgetId,
    MobileBottomButtonId,
    WORKBENCH_CHAT_VIEW_WIDGET_ID,
} from './mobile-shell-bottom-bar-widget';

export function registerCommandsExtracted(ctx: MobileOneColumnShellContributionContext, registry: CommandRegistry): void {
    registry.registerCommand(QaapMobileProjectsDashboardCommands.TOGGLE, {
        execute: () => {
            if (peekPreferDesktopIde()) {
                ctx.returnToAgentsFromDesktopIde();
                return;
            }
            return ctx.toggleProjectsPanel();
        },
        isEnabled: () => peekPreferDesktopIde()
            || (ctx.shouldActivateMobileLayout() && ctx.workspaceService.opened),
        isVisible: () => peekPreferDesktopIde()
            || (matchesMobileOneColumnLayout() && ctx.workspaceService.opened),
    });
    // Project card "Open agent" button. Submits to the backend agent-task runner so the work
    // is a detached child process, not a tab-bound chat; the agent keeps going after the
    // user closes the tab.
    registry.registerCommand({ id: 'qaap.mobile.openAgentOnTask' }, {
        execute: (project: MobileProjectEntry) => ctx.openAgentTaskComposer(project),
    });
    registry.registerCommand({
        id: 'qaap.mobile.toggleSessionsSidebar',
        label: nls.localize('qaap/mobile/toggleSessionsSidebar', 'Toggle Sessions Sidebar'),
        category: 'Work Hub',
    }, {
        execute: () => ctx.toggleWorkHubSessionsSidebar(),
        isEnabled: () => ctx.mobileActive && ctx.workspaceService.opened,
        isVisible: () => matchesMobileOneColumnLayout() && ctx.workspaceService.opened,
    });
    registry.registerCommand({
        id: QAAP_WORK_HUB_OVERVIEW_COMMAND,
        label: nls.localize('qaap/accountMenu/workHubOverview', 'Work Hub overview'),
    }, {
        execute: () => ctx.openMobileWorkHubLanding('tasks'),
        isEnabled: () => ctx.mobileActive,
        isVisible: () => matchesMobileOneColumnLayout(),
    });
    registry.registerCommand({
        id: QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND,
        label: nls.localize('qaap/accountMenu/settings', 'Settings'),
        category: 'Work Hub',
    }, {
        execute: (query?: string) => ctx.openWorkHubPreferencesSheet(query),
        isEnabled: () => !peekPreferDesktopIde(),
        isVisible: () => !peekPreferDesktopIde(),
    });
    registry.registerCommand({
        id: QAAP_WORK_HUB_OPEN_BILLING_COMMAND,
        label: nls.localize('qaap/accountMenu/billing', 'Billing'),
        category: 'Work Hub',
    }, {
        execute: () => ctx.openWorkHubBillingSheet(),
        isEnabled: () => !peekPreferDesktopIde(),
        isVisible: () => !peekPreferDesktopIde(),
    });
    registry.registerCommand({
        id: QAAP_WORK_HUB_NEW_AGENT_COMMAND,
        label: nls.localize('qaap/sessionsSidebar/newChat', 'New agent'),
        category: 'Work Hub',
    }, {
        execute: () => ctx.projectsPanel?.startNewWorkHubAgent(),
        isEnabled: () => !peekPreferDesktopIde() && !!ctx.projectsPanel,
        isVisible: () => !peekPreferDesktopIde(),
    });
    registry.registerCommand({
        id: QAAP_WORK_HUB_SEARCH_COMMAND,
        label: nls.localize('qaap/workHub/search', 'Search Work Hub…'),
        category: 'Work Hub',
    }, {
        execute: () => ctx.projectsPanel?.openWorkHubSearch(),
        isEnabled: () => !peekPreferDesktopIde() && !!ctx.projectsPanel,
        isVisible: () => !peekPreferDesktopIde(),
    });
    registry.registerCommand({
        id: QAAP_WORK_HUB_OPEN_REPOSITORY_COMMAND,
        label: nls.localize('qaap/mobileProjects/newRepository', 'Add repository'),
        category: 'Work Hub',
    }, {
        execute: () => ctx.projectsPanel?.showOpenRepositoryDialog(),
        isEnabled: () => !peekPreferDesktopIde() && !!ctx.projectsPanel,
        isVisible: () => !peekPreferDesktopIde(),
    });
    // Prefer Work Hub sheets over IDE main-area widgets while the hub is active.
    // registerHandler unshifts, so these win over upstream handlers when enabled.
    registry.registerHandler(CommonCommands.OPEN_PREFERENCES.id, {
        execute: () => ctx.openWorkHubPreferencesSheet(),
        isEnabled: () => !peekPreferDesktopIde(),
        isVisible: () => !peekPreferDesktopIde(),
    });
    registry.registerHandler(QAAP_WORK_HUB_AI_FEATURES_COMMAND, {
        execute: () => ctx.openWorkHubPreferencesSheet('ai-features'),
        isEnabled: () => !peekPreferDesktopIde(),
        isVisible: () => !peekPreferDesktopIde(),
    });
    registry.registerHandler(QAAP_WORK_HUB_AI_CONFIGURATION_COMMAND, {
        // Keep old deep links working, but land them in the organized AI Features settings.
        execute: () => ctx.openWorkHubPreferencesSheet('ai-features'),
        isEnabled: () => !peekPreferDesktopIde(),
        isVisible: () => !peekPreferDesktopIde(),
    });
    // Register the surface-switch command unconditionally. Command contributions are registered
    // once, while the viewport can change later; registering it only during a non-narrow boot
    // made the Work Hub avatar switch silently disappear from the command registry after a
    // responsive transition. The runtime guard keeps the classic IDE on its normal responsive layout.
    registry.registerCommand({
        id: QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
        label: nls.localize('qaap/mobile/openDesktopIde', 'Open IDE'),
    }, {
        execute: () => { void ctx.openDesktopIde(); },
        isEnabled: () => ctx.shouldActivateMobileLayout()
            && !peekPreferDesktopIde(),
        isVisible: () => ctx.shouldActivateWorkHubLayout(),
    });
    // The in-IDE header-view commands remain desktop/one-column IDE commands.
    if (!matchesMobileNarrowViewport()) {
        registry.registerCommand({ id: 'qaap.mobile.ideHeaderView.options' }, {
            execute: () => ctx.bottomBarController.getMobileIdeHeaderViewButtons(),
            isEnabled: () => ctx.workspaceService.opened && matchesMobileOneColumnLayout() && !peekPreferDesktopIde(),
            isVisible: () => ctx.workspaceService.opened && matchesMobileOneColumnLayout() && !peekPreferDesktopIde(),
        });
        registry.registerCommand({ id: 'qaap.mobile.ideHeaderView.active' }, {
            execute: () => ctx.resolveMobileIdeHeaderViewId(),
            isEnabled: () => ctx.workspaceService.opened && matchesMobileOneColumnLayout() && !peekPreferDesktopIde(),
            isVisible: () => ctx.workspaceService.opened && matchesMobileOneColumnLayout() && !peekPreferDesktopIde(),
        });
        registry.registerCommand({ id: 'qaap.mobile.ideHeaderView.activate' }, {
            execute: (id: MobileBottomButtonId) => ctx.activateMobileIdeHeaderView(id),
            isEnabled: () => ctx.workspaceService.opened && matchesMobileOneColumnLayout() && !peekPreferDesktopIde(),
            isVisible: () => ctx.workspaceService.opened && matchesMobileOneColumnLayout() && !peekPreferDesktopIde(),
        });
    }
}

export async function openDesktopIdeExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    if (!ctx.ideFallback) {
        return;
    }

    // Switch the visible shell synchronously. Workspace/project discovery may involve the
    // network, and waiting for it made the avatar switch look like a lost click. The existing
    // workspace is already enough to show the classic IDE; preparation can continue in the
    // background and may still reload/open the correct project when the hub has one selected.
    const selectedProjectId = ctx.projectsPanel?.getAgentsHubSelectedProjectId?.();
    ctx.ideFallback.openDesktopIde();
    try {
        await ctx.prepareDesktopIdeWorkspaceFromHub(selectedProjectId);
    } catch (error) {
        // The surface switch has already succeeded. Do not turn a project-list refresh failure
        // into an unhandled rejection that makes the control appear intermittent.
        console.warn('[qaap-mobile-shell] desktop IDE workspace preparation failed', error);
    }
}

export async function prepareDesktopIdeWorkspaceFromHubExtracted(ctx: MobileOneColumnShellContributionContext, selectedProjectId?: string): Promise<boolean> {
    const projects = await ctx.projectsService.loadProjects();
    const plan = planDesktopIdeWorkspaceOpen(
        projects.map(project => ({
            id: project.id,
            cwd: ctx.projectsService.getProjectCwd(project),
        })),
        ctx.projectsService.getCurrentWorkspaceCwd(),
        selectedProjectId,
    );
    if (plan.kind === 'reload-empty') {
        MobileSnackbar.show(
            nls.localize(
                'qaap/mobile/openDesktopIdeEmptyWorkspace',
                'Opening the IDE without a folder. Pin a project in Work Hub to open it directly.',
            ),
            { duration: 4200 },
        );
        markPreferDesktopIde();
        await ctx.workspaceService.close();
        return false;
    }
    if (plan.kind === 'open-project') {
        const project = projects[plan.projectIndex];
        if (!project) {
            return false;
        }
        let cwd = ctx.projectsService.getProjectCwd(project);
        if (!cwd && project.github) {
            cwd = await ctx.projectsService.prepareProjectCwd(project);
        }
        if (!cwd) {
            MobileSnackbar.show(
                nls.localize('qaap/mobile/openDesktopIdeNeedsProject', 'Open a project from Work Hub before opening the IDE.'),
                { kind: 'warning' },
            );
            return false;
        }
        const current = ctx.projectsService.getCurrentWorkspaceCwd();
        if (current !== cwd) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobile/openDesktopIdeOpeningProject',
                    'Opening {0} in the IDE…',
                    project.name || project.id,
                ),
                { duration: 2800 },
            );
            markPreferDesktopIde();
            await ctx.projectsService.openInCurrentWindowAsync(project);
        }
    }
    return true;
}

export function enforceWorkHubSurfaceIsolationExtracted(ctx: MobileOneColumnShellContributionContext): void {
    if (peekPreferDesktopIde()) {
        return;
    }
    markPreferAgentsSurface();
    setMobileWorkHubComposerHeaderChrome(true);
    syncMobileWorkHubHideIdeSidePanelsFromComposerHeader();
    void ctx.sideSheetController.collapseMobileSidePanels();
    ctx.sideSheetController.settleMobileSidePanelsCollapsed();
    ctx.scheduleSnapAndUiRefresh();
    ctx.refreshBottomBar();
    ctx.refreshWorkbenchTopBar();
}

export async function openAgentTaskComposerExtracted(ctx: MobileOneColumnShellContributionContext, project: MobileProjectEntry): Promise<void> {
    if (!project) {
        return;
    }
    const cwd = ctx.projectsService.getProjectCwd(project);
    if (!ctx.agentTaskComposer) {
        ctx.agentTaskComposer = new MobileAgentTaskComposer(ctx.activeTasks, {
            onSubmitted: () => {
                MobileSnackbar.show(
                    nls.localize('qaap/mobileProjects/agentTaskQueued', 'Agent task started'),
                    { kind: 'success' }
                );
            },
        }, ctx.backgroundContext);
        document.body.appendChild(ctx.agentTaskComposer.node);
        ctx.toDispose.push(Disposable.create(() => {
            ctx.agentTaskComposer?.dispose();
            ctx.agentTaskComposer?.node.parentElement?.removeChild(ctx.agentTaskComposer.node);
            ctx.agentTaskComposer = undefined;
        }));
    }
    await ctx.agentTaskComposer.show(project, cwd);
}

export async function openWorkHubPreferencesSheetExtracted(ctx: MobileOneColumnShellContributionContext, query?: string): Promise<void> {
    if (!ctx.workHubPreferencesSheet) {
        ctx.workHubPreferencesSheet = new MobileWorkHubPreferencesSheet(
            ctx.widgetManager,
            ctx.preferenceService,
            ctx.appearanceModeService,
            ctx.themeService,
            () => ctx.openWorkHubBillingSheet(),
            () => {
                const panel = ctx.projectsPanel;
                if (!panel?.isVisible()) {
                    return undefined;
                }
                return panel.node.querySelector<HTMLElement>(':scope > .theia-mobile-projects-scroll') ?? panel.node;
            },
            () => {
                const panel = ctx.projectsPanel;
                if (!panel?.isVisible()) {
                    return undefined;
                }
                return panel.sessionsSidebarUi.ensureWorkHubSessionsSidebar();
            },
        );
        ctx.toDispose.push(Disposable.create(() => {
            ctx.workHubPreferencesSheet?.dispose();
            ctx.workHubPreferencesSheet = undefined;
        }));
    }
    await ctx.workHubPreferencesSheet.show(query);
}

export async function openWorkHubBillingSheetExtracted(ctx: MobileOneColumnShellContributionContext, options?: { readonly afterCheckout?: boolean }): Promise<void> {
    if (!ctx.workHubBillingSheet) {
        ctx.workHubBillingSheet = new MobileWorkHubBillingSheet();
        document.body.appendChild(ctx.workHubBillingSheet.node);
        ctx.toDispose.push(Disposable.create(() => {
            ctx.workHubBillingSheet?.dispose();
            ctx.workHubBillingSheet = undefined;
        }));
    }
    await ctx.workHubBillingSheet.show(options);
}

export async function openWorkHubAiConfigurationSheetExtracted(ctx: MobileOneColumnShellContributionContext, _tabId?: string): Promise<void> {
    // Preserve callers used by the composer and old deep links while removing the
    // standalone AI Configuration surface from the product UI.
    await openWorkHubPreferencesSheetExtracted(ctx, 'ai-features');
}

export async function toggleProjectsPanelExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    if (ctx.projectsPanel?.isHomeMode() && ctx.projectsPanel.isVisible()) {
        return;
    }
    ctx.hidePullRequestPanel();
    await ctx.dismissSheetsAsync();
    if (ctx.shell.isExpanded('bottom')) {
        await ctx.shell.collapsePanel('bottom');
    }
    await ctx.showMobileProjectsHome('tasks');
}

export async function onProjectsPanelOpenExtracted(ctx: MobileOneColumnShellContributionContext, project: MobileProjectEntry): Promise<void> {
    ctx.landing.leaveMobileProjectsLandingNow();
    try {
        if (project.isCurrent) {
            await ctx.onCurrentProjectActivated();
            return;
        }
        await ctx.projectsService.openInCurrentWindowAsync(project);
    } finally {
        ctx.scheduleSnapAndUiRefresh();
    }
}

export async function onProjectsPanelOpenInIdeExtracted(ctx: MobileOneColumnShellContributionContext, project: MobileProjectEntry): Promise<void> {
    try {
        if (project.isCurrent) {
            const cwd = ctx.projectsService.getCurrentWorkspaceCwd();
            if (cwd && isQaapWorkspaceContainerPath(cwd)) {
                markPreferDesktopIde();
                await ctx.projectsService.openInCurrentWindowAsync(project);
                return;
            }
            ctx.ideFallback?.openDesktopIde();
            await ctx.onCurrentProjectActivated();
            return;
        }
        markPreferDesktopIde();
        await ctx.projectsService.openInCurrentWindowAsync(project);
    } finally {
        if (!peekPreferDesktopIde()) {
            ctx.scheduleSnapAndUiRefresh();
        }
    }
}

export async function onCurrentProjectActivatedExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    const opened = await ctx.projectsReadme.openReadmeForCurrentWorkspace();
    if (opened) {
        return;
    }
    // No README to show: focus an existing editor if any, so the user lands in the editor area.
    const widgets = toArray(ctx.shell.mainPanel.widgets());
    const target = ctx.shell.activeWidget && widgets.includes(ctx.shell.activeWidget)
        ? ctx.shell.activeWidget
        : widgets[0];
    if (target) {
        void ctx.shell.activateWidget(target.id);
    }
}

export async function prepareSideSheetOpenExtracted(ctx: MobileOneColumnShellContributionContext, side: 'left' | 'right'): Promise<void> {
    const other: 'left' | 'right' = side === 'left' ? 'right' : 'left';
    // Explicit intent to reveal an IDE side sheet in the Work Hub — the only thing that may
    // un-hide the left/right panel while Work Hub is the surface. Cleared when the sheet collapses.
    setMobileWorkHubSideSheetOpen(true);
    ctx.hideProjectsPanel();
    ctx.hidePullRequestPanel();
    if (ctx.shell.isExpanded(other)) {
        await ctx.shell.collapsePanel(other);
    }
}

export async function mountSideSheetWidgetExtracted(ctx: MobileOneColumnShellContributionContext, side: 'left' | 'right', widgetId: string): Promise<void> {
    const widget = await ctx.widgetManager.getOrCreateWidget(widgetId);
    const area = widget.isAttached ? ctx.shell.getAreaFor(widget) : undefined;
    if (!widget.isAttached || area !== side) {
        await ctx.shell.addWidget(widget, { area: side });
    }
    await ctx.shell.activateWidget(widgetId);
    if (!ctx.shell.isExpanded(side)) {
        ctx.shell.expandPanel(side);
    }
}

/**
 * Push-notification deep-link: open the Work Hub on the agent session that raised the
 * notification. Always lands on the home-mode (Work Hub) panel — the IDE-style
 * (non-home) projects panel must never appear from a notification tap on mobile.
 */
export async function openConversationInWorkHubExtracted(ctx: MobileOneColumnShellContributionContext, conversationId: string, cwd?: string): Promise<void> {
    try {
        const { getConversation, conversationToSummary } = await import('../common/qaap-agent-conversation-client');
        const dto = await getConversation(conversationId);
        const summary = conversationToSummary(dto);
        const normalize = (value: string | undefined): string => (value ?? '').replace(/\/+$/, '');
        // The task cwd (worktree runs included) and the conversation cwd can differ — accept either.
        const candidateCwds = new Set([normalize(cwd), normalize(summary.cwd)].filter(value => value !== ''));
        const projects = await ctx.projectsService.loadProjects();
        const project = projects.find(candidate => candidateCwds.has(normalize(ctx.projectsService.getProjectCwd(candidate))))
            ?? projects.find(candidate => candidate.isCurrent)
            ?? projects[0];
        if (!project) {
            return;
        }
        // Mount the unified Agents Work Hub (disposes any IDE-style non-home panel).
        await ctx.showMobileProjectsHome('tasks');
        const panel = ctx.projectsPanel;
        if (!panel) {
            return;
        }
        await panel.openConversationSummary(project, summary);
        ctx.refreshBottomBar();
        ctx.refreshWorkbenchTopBar();
    } catch (error) {
        console.error('[qaap-mobile-shell] failed to open conversation from notification', error);
    }
}

export function refreshWorkbenchTopBarExtracted(ctx: MobileOneColumnShellContributionContext): void {
    for (const widget of toArray(ctx.shell.topPanel.widgets)) {
        if (widget instanceof QaapWorkbenchHistoryNavWidget) {
            widget.refreshChrome();
        }
        if (widget instanceof QaapWorkbenchRightControlsWidget) {
            widget.refreshChrome();
        }
    }
}

export async function executeAndDismissExtracted(ctx: MobileOneColumnShellContributionContext, commandId: string): Promise<void> {
    try {
        await ctx.commands.executeCommand(commandId);
    } catch (e) {
        console.error(`[qaap-mobile-shell] secondary action failed: ${commandId}`, e);
    }
    ctx.scheduleSnapAndUiRefresh();
}

export function resolveMobileIdeHeaderViewIdExtracted(ctx: MobileOneColumnShellContributionContext): MobileBottomButtonId {
    if (ctx.bottomBarController.isMobileBottomButtonActive('agent')) {
        return 'agent';
    }
    const active = ctx.bottomBarController.getMobileIdeHeaderViewButtons()
        .find(def => ctx.bottomBarController.isMobileBottomButtonActive(def.id));
    return active?.id ?? 'editor';
}

export async function activateMobileIdeHeaderViewExtracted(ctx: MobileOneColumnShellContributionContext, id: MobileBottomButtonId): Promise<void> {
    await ctx.bottomBarController.activateMobileIdeHeaderView(id);
    ctx.refreshBottomBar();
    ctx.refreshWorkbenchTopBar();
}

export function relayoutMainPreviewWidgetsExtracted(ctx: MobileOneColumnShellContributionContext): void {
    for (const widget of toArray(ctx.shell.mainPanel.widgets())) {
        if (widget.id.startsWith('mini-browser:')) {
            ctx.sideSheetController.relayoutSheetTree(widget);
        }
    }
}

export async function toggleMobileAgentSheetExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    ctx.hideProjectsPanel();
    ctx.hidePullRequestPanel();
    if (ctx.isMobileAgentSheetVisible()) {
        await ctx.collapseMobileSidePanels();
        ctx.scheduleSnapAndUiRefresh();
        return;
    }
    const project = await ctx.resolveCurrentProjectForAgent();
    if (project) {
        const cwd = ctx.projectsService.getProjectCwd(project);
        writeStoredComposerSurface(cwd, 'chat');
        ctx.projectsPanel?.preferComposerSurface('chat', cwd);
    }
    // Mobile "Agent" opens Theia AI Chat in the right sheet.
    await ctx.openMobileSideSheet('right', WORKBENCH_CHAT_VIEW_WIDGET_ID);
    ctx.scheduleSnapAndUiRefresh();
}

export async function resolveCurrentProjectForAgentExtracted(ctx: MobileOneColumnShellContributionContext): Promise<MobileProjectEntry | undefined> {
    try {
        const projects = await ctx.projectsService.loadProjects();
        return ctx.projectsService.resolveCurrentWorkspaceProject(projects);
    } catch {
        return undefined;
    }
}

export async function toggleMobileExploreSheetExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    ctx.hideProjectsPanel();
    ctx.hidePullRequestPanel();
    if (ctx.isMobileExploreSheetVisible()) {
        await ctx.collapseMobileSidePanels();
        syncMobileWorkHubHideIdeSidePanelsFromComposerHeader();
        ctx.scheduleSnapAndUiRefresh();
        return;
    }
    await ctx.openMobileSideSheet('left', EXPLORER_VIEW_CONTAINER_ID);
    ctx.scheduleSnapAndUiRefresh();
}

export function isMobileExploreSheetVisibleExtracted(ctx: MobileOneColumnShellContributionContext): boolean {
    if (!ctx.shell.isExpanded('left') || ctx.sideSheetController.isSidePanelSheetCollapsedInDom('left')) {
        return false;
    }
    const currentTitle = ctx.shell.leftPanelHandler.tabBar.currentTitle;
    return currentTitle?.owner?.id === EXPLORER_VIEW_CONTAINER_ID;
}

export function getActivePreviewWidgetExtracted(ctx: MobileOneColumnShellContributionContext): LuminoWidget | undefined {
    const active = ctx.shell.activeWidget ?? ctx.shell.currentWidget;
    if (isMiniBrowserPreviewWidgetId(active?.id) && active && ctx.shell.getAreaFor(active) === 'main') {
        return active;
    }
    return undefined;
}

export function findPreviewWidgetExtracted(ctx: MobileOneColumnShellContributionContext): LuminoWidget | undefined {
    for (const area of ['main', 'right', 'left', 'bottom'] as ApplicationShell.Area[]) {
        const match = ctx.shell.getWidgets(area).find(widget => isMiniBrowserPreviewWidgetId(widget.id));
        if (match) {
            return match;
        }
    }
    return undefined;
}

export async function closeStaleMainPreviewWidgetExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    const preview = ctx.getMainPreviewWidget();
    if (!preview || ctx.isMainPreviewWidgetLive(preview)) {
        return;
    }
    await ctx.shell.closeWidget(preview.id, { save: false });
}
