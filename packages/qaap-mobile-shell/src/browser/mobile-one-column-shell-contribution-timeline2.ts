// @ts-nocheck
// Extracted from mobile-one-column-shell-contribution.ts

import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { toArray } from '@lumino/algorithm';
import { MessageLoop } from '@lumino/messaging';
import { SplitPanel, Widget as LuminoWidget } from '@lumino/widgets';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { RESET_LAYOUT } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { StatusBarImpl } from '@theia/core/lib/browser/status-bar/status-bar';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { ChatService } from '@theia/ai-chat';
import { AIVariableService, FrontendLanguageModelRegistry, PromptService } from '@theia/ai-core';
import { SkillService } from '@theia/ai-core/lib/browser/skill-service';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { QuickInputService } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileUploadService } from '@theia/filesystem/lib/common/upload/file-upload';
import {
    matchesMobileOneColumnLayout,
    matchesMobileNarrowViewport,
    MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY,
    MOBILE_ONE_COLUMN_LAYOUT_CLASS,
} from '@theia/core/lib/browser/shell/mobile-layout-state';
import { hasQaapLeftRightSplitPanel } from '@theia/qaap-shell/lib/browser/qaap-shell-layout';
import { QaapSidePanelHandler } from '@theia/qaap-shell/lib/browser/qaap-side-panel-handler';
import { QaapDesktopTerminalLayoutContribution } from './qaap-desktop-terminal-layout-contribution';
import { QaapCommitMessageAi } from './qaap-commit-message-ai';
import { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import { QaapComposerEditorContextService } from './qaap-composer-editor-context-service';
import { QaapWorkHubComposerPromptService } from './qaap-work-hub-composer-prompt-service';
import { QaapWorkHubDiffDelegate, QaapWorkHubDiffService } from './qaap-work-hub-diff-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import { MobileProjectsService } from './mobile-projects-service';
import { MobileProjectsPanel } from './mobile-projects-panel';
import { MobileProjectsPanelFactory } from './mobile-projects-panel-factory';
import { QaapAppearanceModeService } from './qaap-appearance-mode-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { MobileProjectChatViewWidgetFactory } from './mobile-project-ai-chat-input-widget';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import { LabelProvider } from '@theia/core/lib/browser';
import { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import { DecorationsService } from '@theia/core/lib/browser/decorations-service';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { MarkdownPreviewHandler } from '@theia/preview/lib/browser/markdown/markdown-preview-handler';
import { MobileProjectsReadmeContribution } from './mobile-projects-readme-contribution';
import { MobileProjectEntry, type MobileProjectsHubView } from './mobile-projects-types';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { planDesktopIdeWorkspaceOpen } from '../common/qaap-desktop-ide-workspace-plan';
import { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { ElementInspectorService } from '@theia/qaap-element-inspector/lib/browser/element-inspector-service';
import { MobileSnackbar } from './mobile-snackbar';
import { MobileAgentTaskComposer } from './mobile-agent-task-composer';
import { MobileWorkHubPreferencesSheet } from './mobile-work-hub-preferences-sheet';
import { MobileWorkHubBillingSheet } from './mobile-work-hub-billing-sheet';
import { MobileWorkHubAiConfigurationSheet } from './mobile-work-hub-ai-configuration-sheet';
import { AIConfigurationSelectionService } from '@theia/ai-ide/lib/browser/ai-configuration/ai-configuration-service';
import { MCPFrontendService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import {
    clearMobileWorkHubBootGuard,
    installMobileWorkHubBootGuard,
    markPreferAgentsSurface,
    markPreferDesktopIde,
    peekPreferDesktopIde,
    shouldBootstrapMobileAgentsChat,
    shouldPreferWorkHubAgentsLayout,
    QAAP_MOBILE_ACTIVE_TRANSCRIPT_BODY_CLASS,
    QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT,
    QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT,
    setMobileActiveTranscriptChrome,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubHideBottomChrome,
    setMobileWorkHubSideSheetOpen,
    recomputeMobileWorkHubHideIdeSidePanels,
    syncMobileWorkHubHideIdeSidePanelsFromComposerHeader,
} from './mobile-projects-open';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { QaapMiniBrowserOpenHandler } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-open-handler';
import { syncQaapMiniBrowserPreviewSuspension } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QaapAgentFinishedToastContribution } from './qaap-agent-finished-toast-contribution';
import { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';
import { QaapAgUiFrontendToolService } from './qaap-ag-ui-frontend-tool-service';
import { QaapMobileProjectsDashboardCommands } from './mobile-projects-dashboard-commands';
import { QaapWorkbenchHistoryNavWidget, QaapWorkbenchRightControlsWidget } from './qaap-workbench-top-bar-widgets';
import {
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    QAAP_WORK_HUB_OVERVIEW_COMMAND,
} from './qaap-workbench-account-menu';
import {
    QAAP_WORK_HUB_AI_CONFIGURATION_COMMAND,
    QAAP_WORK_HUB_AI_CONFIGURATION_DEFAULT_TAB,
    QAAP_WORK_HUB_AI_FEATURES_COMMAND,
} from '../common/mobile-work-hub-catalog';
import { resolveAiConfigurationTabArg } from '../common/qaap-ai-configuration-command-link';
import {
    QAAP_WORK_HUB_NEW_AGENT_COMMAND,
    QAAP_WORK_HUB_OPEN_BILLING_COMMAND,
    QAAP_WORK_HUB_OPEN_REPOSITORY_COMMAND,
    QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND,
    QAAP_WORK_HUB_SEARCH_COMMAND,
} from '../common/qaap-work-hub-command-palette';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { hasDesktopSessionsSidebarCollapsed } from './mobile-work-hub-sessions-sidebar';
import { writeStoredComposerSurface } from '../common/qaap-composer-surface';
import { resolveInitialLandingBodyClass } from './mobile-shell-landing-state';
import { MobileShellLandingController, type MobileShellLandingHost } from './mobile-shell-landing-controller';
import {
    MobileShellBottomBarController,
    type MobileShellBottomBarHost,
} from './mobile-shell-bottom-bar-controller';
import {
    MobileShellOverlayHostController,
    type MobileShellOverlayHost,
} from './mobile-shell-overlay-host';
import {
    MobileShellSideSheetController,
    type MobileShellSideSheetHost,
} from './mobile-shell-side-sheet-controller';
import {
    MobileShellWorkHubBootstrapController,
    type MobileShellWorkHubBootstrapHost,
} from './mobile-shell-work-hub-bootstrap';
import {
    MobileShellIdeFallbackController,
    type MobileShellIdeFallbackHost,
} from './mobile-shell-ide-fallback';
import {
    MobileShellHubNavigationController,
    type MobileShellHubNavigationHost,
} from './mobile-shell-hub-navigation-controller';
import {
    MobileShellPullRequestPanelController,
    type MobileShellPullRequestPanelHost,
} from './mobile-shell-pull-request-panel-controller';
import {
    MobileShellTranscriptChromeController,
    type MobileShellTranscriptChromeHost,
} from './mobile-shell-transcript-chrome-controller';
import { MobileShellSessionState } from './mobile-shell-session-state';
import {
    decideLayoutRecovery,
    QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY,
    SHELL_LAYOUT_STORAGE_KEY,
} from './mobile-shell-layout-recovery';
import {
    BottomBarSecondaryItem,
    EXPLORER_VIEW_CONTAINER_ID,
    isMiniBrowserPreviewWidgetId,
    MOBILE_BOTTOM_OPEN_CLASS,
    MobileBottomButton,
    MobileBottomButtonId,
    WORKBENCH_CHAT_VIEW_WIDGET_ID,
} from './mobile-shell-bottom-bar-widget';
import { isMainPreviewWidgetLive as isMainPreviewWidgetLiveHelper } from './mobile-one-column-shell-helpers';

export function registerCommandsExtracted(ctx: any, registry: CommandRegistry): void {
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
        execute: (tabId?: unknown) => ctx.openWorkHubAiConfigurationSheet(
            resolveAiConfigurationTabArg(tabId, QAAP_WORK_HUB_AI_CONFIGURATION_DEFAULT_TAB),
        ),
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

export async function openDesktopIdeExtracted(ctx: any): Promise<void> {
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

export async function prepareDesktopIdeWorkspaceFromHubExtracted(ctx: any, selectedProjectId?: string): Promise<boolean> {
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

export function enforceWorkHubSurfaceIsolationExtracted(ctx: any): void {
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

export async function openAgentTaskComposerExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
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

export async function openWorkHubPreferencesSheetExtracted(ctx: any, query?: string): Promise<void> {
    if (!ctx.workHubPreferencesSheet) {
        ctx.workHubPreferencesSheet = new MobileWorkHubPreferencesSheet(ctx.widgetManager, ctx.preferenceService);
        document.body.appendChild(ctx.workHubPreferencesSheet.node);
        ctx.toDispose.push(Disposable.create(() => {
            ctx.workHubPreferencesSheet?.dispose();
            ctx.workHubPreferencesSheet = undefined;
        }));
    }
    await ctx.workHubPreferencesSheet.show(query);
}

export async function openWorkHubBillingSheetExtracted(ctx: any): Promise<void> {
    if (!ctx.workHubBillingSheet) {
        ctx.workHubBillingSheet = new MobileWorkHubBillingSheet();
        document.body.appendChild(ctx.workHubBillingSheet.node);
        ctx.toDispose.push(Disposable.create(() => {
            ctx.workHubBillingSheet?.dispose();
            ctx.workHubBillingSheet = undefined;
        }));
    }
    await ctx.workHubBillingSheet.show();
}

export async function openWorkHubAiConfigurationSheetExtracted(ctx: any, tabId?: string): Promise<void> {
    if (!ctx.workHubAiConfigurationSheet) {
        ctx.workHubAiConfigurationSheet = new MobileWorkHubAiConfigurationSheet(
            ctx.widgetManager,
            ctx.aiConfigurationSelectionService,
        );
        document.body.appendChild(ctx.workHubAiConfigurationSheet.node);
        ctx.toDispose.push(Disposable.create(() => {
            ctx.workHubAiConfigurationSheet?.dispose();
            ctx.workHubAiConfigurationSheet = undefined;
        }));
    }
    await ctx.workHubAiConfigurationSheet.show(tabId);
}

export async function toggleProjectsPanelExtracted(ctx: any): Promise<void> {
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

export async function onProjectsPanelOpenExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
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

export async function onProjectsPanelOpenInIdeExtracted(ctx: any, project: MobileProjectEntry): Promise<void> {
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

export async function onCurrentProjectActivatedExtracted(ctx: any): Promise<void> {
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

export async function prepareSideSheetOpenExtracted(ctx: any, side: 'left' | 'right'): Promise<void> {
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

export async function mountSideSheetWidgetExtracted(ctx: any, side: 'left' | 'right', widgetId: string): Promise<void> {
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
export async function openConversationInWorkHubExtracted(ctx: any, conversationId: string, cwd?: string): Promise<void> {
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

export async function openProjectScopedDiffViewExtracted(ctx: any, projectId?: string): Promise<void> {
    ctx.hidePullRequestPanel();
    await ctx.dismissSheetsAsync();
    if (ctx.shell.isExpanded('bottom')) {
        await ctx.shell.collapsePanel('bottom');
    }
    if (ctx.projectsPanel?.isHomeMode()) {
        ctx.projectsPanel.hide();
        ctx.projectsPanel.dispose();
        ctx.projectsPanel.node.parentElement?.removeChild(ctx.projectsPanel.node);
        ctx.setTrackedProjectsPanel(undefined);
    }
    ctx.ensureProjectsPanel(false);
    const panel = ctx.projectsPanel;
    if (!panel) {
        return;
    }
    document.body.classList.remove('theia-mobile-mod-landing');
    await panel.show();
    const resolvedProjectId = projectId ?? (await ctx.projectsService.loadProjects())
        .find(project => project.isCurrent)?.id;
    await panel.openProjectDiffView(resolvedProjectId);
    ctx.refreshBottomBar();
    ctx.refreshWorkbenchTopBar();
}

export function refreshWorkbenchTopBarExtracted(ctx: any): void {
    for (const widget of toArray(ctx.shell.topPanel.widgets)) {
        if (widget instanceof QaapWorkbenchHistoryNavWidget) {
            widget.refreshChrome();
        }
        if (widget instanceof QaapWorkbenchRightControlsWidget) {
            widget.refreshChrome();
        }
    }
}

export async function executeAndDismissExtracted(ctx: any, commandId: string): Promise<void> {
    try {
        await ctx.commands.executeCommand(commandId);
    } catch (e) {
        console.error(`[qaap-mobile-shell] secondary action failed: ${commandId}`, e);
    }
    ctx.scheduleSnapAndUiRefresh();
}

export function resolveMobileIdeHeaderViewIdExtracted(ctx: any): MobileBottomButtonId {
    if (ctx.bottomBarController.isMobileBottomButtonActive('agent')) {
        return 'agent';
    }
    const active = ctx.bottomBarController.getMobileIdeHeaderViewButtons()
        .find(def => ctx.bottomBarController.isMobileBottomButtonActive(def.id));
    return active?.id ?? 'editor';
}

export async function activateMobileIdeHeaderViewExtracted(ctx: any, id: MobileBottomButtonId): Promise<void> {
    await ctx.bottomBarController.activateMobileIdeHeaderView(id);
    ctx.refreshBottomBar();
    ctx.refreshWorkbenchTopBar();
}

export function relayoutMainPreviewWidgetsExtracted(ctx: any): void {
    for (const widget of toArray(ctx.shell.mainPanel.widgets())) {
        if (widget.id.startsWith('mini-browser:')) {
            ctx.sideSheetController.relayoutSheetTree(widget);
        }
    }
}

export async function toggleMobileAgentSheetExtracted(ctx: any): Promise<void> {
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

export async function resolveCurrentProjectForAgentExtracted(ctx: any): Promise<MobileProjectEntry | undefined> {
    try {
        const projects = await ctx.projectsService.loadProjects();
        return ctx.projectsService.resolveCurrentWorkspaceProject(projects);
    } catch {
        return undefined;
    }
}

export async function toggleMobileExploreSheetExtracted(ctx: any): Promise<void> {
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

export function isMobileExploreSheetVisibleExtracted(ctx: any): boolean {
    if (!ctx.shell.isExpanded('left') || ctx.sideSheetController.isSidePanelSheetCollapsedInDom('left')) {
        return false;
    }
    const currentTitle = ctx.shell.leftPanelHandler.tabBar.currentTitle;
    return currentTitle?.owner?.id === EXPLORER_VIEW_CONTAINER_ID;
}

export function getActivePreviewWidgetExtracted(ctx: any): LuminoWidget | undefined {
    const active = ctx.shell.activeWidget ?? ctx.shell.currentWidget;
    if (isMiniBrowserPreviewWidgetId(active?.id) && active && ctx.shell.getAreaFor(active) === 'main') {
        return active;
    }
    return undefined;
}

export function findPreviewWidgetExtracted(ctx: any): LuminoWidget | undefined {
    for (const area of ['main', 'right', 'left', 'bottom'] as ApplicationShell.Area[]) {
        const match = ctx.shell.getWidgets(area).find(widget => isMiniBrowserPreviewWidgetId(widget.id));
        if (match) {
            return match;
        }
    }
    return undefined;
}

export async function closeStaleMainPreviewWidgetExtracted(ctx: any): Promise<void> {
    const preview = ctx.getMainPreviewWidget();
    if (!preview || ctx.isMainPreviewWidgetLive(preview)) {
        return;
    }
    await ctx.shell.closeWidget(preview.id, { save: false });
}
