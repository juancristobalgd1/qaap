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
    MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY,
    MOBILE_ONE_COLUMN_LAYOUT_CLASS,
} from '@theia/core/lib/browser/shell/mobile-layout-state';
import { hasQaapLeftRightSplitPanel } from '@theia/qaap-shell/lib/browser/qaap-shell-layout';
import { QaapSidePanelHandler } from '@theia/qaap-shell/lib/browser/qaap-side-panel-handler';
import { QaapDesktopTerminalLayoutContribution } from './qaap-desktop-terminal-layout-contribution';
import { QaapDiffReviewWidget } from './qaap-diff-review-widget';
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
import { LAYOUT_RECOVERY_GRACE_MS } from './mobile-one-column-shell-contribution';

export function isWorkHubSurfacePresentInDomExtracted(ctx: any): boolean {
    if (ctx.projectsPanel?.isVisible()) {
        return true;
    }
    if (typeof document === 'undefined') {
        // Non-DOM (test/SSR) environments never render the hub; treat as present to skip recovery.
        return true;
    }
    if (document.body.classList.contains(QAAP_MOBILE_ACTIVE_TRANSCRIPT_BODY_CLASS)) {
        return true;
    }
    return !!document.querySelector('.theia-mobile-projects.theia-mod-visible')
        || !!document.querySelector('.theia-mobile-agent-transcript-real-chat');
}

export function armLayoutRecoveryGuardExtracted(ctx: any): void {
    if (peekPreferDesktopIde() || typeof window === 'undefined') {
        return;
    }
    const timeout = window.setTimeout(() => {
        void ctx.runLayoutRecoveryGuard();
    }, LAYOUT_RECOVERY_GRACE_MS);
    ctx.toDispose.push(Disposable.create(() => window.clearTimeout(timeout)));
}

export async function runLayoutRecoveryGuardExtracted(ctx: any): Promise<void> {
    const decision = decideLayoutRecovery({
        workHubSurfacePresent: ctx.isWorkHubSurfacePresentInDom(),
        preferDesktopIde: peekPreferDesktopIde(),
        recoveryAlreadyAttempted: ctx.hasLayoutRecoveryBeenAttempted(),
    });
    if (decision === 'noop') {
        return;
    }
    if (decision === 'abort-loop') {
        console.error(
            '[qaap-mobile-shell] Work Hub still absent after a layout-recovery reload; not reloading '
            + `again to avoid a loop. The persisted layout may be corrupt — run the '${RESET_LAYOUT.label}' `
            + 'command or clear localStorage manually.',
        );
        return;
    }
    console.warn(
        '[qaap-mobile-shell] Work Hub failed to mount and no surface is present; clearing the '
        + 'persisted (empty) layout and reloading once to recover.',
    );
    ctx.markLayoutRecoveryAttempted();
    try {
        // Clear the poisoned layout with the proper storage API (same key ShellLayoutRestorer uses).
        await ctx.storageService.setData(SHELL_LAYOUT_STORAGE_KEY, undefined);
    } catch (error) {
        console.error('[qaap-mobile-shell] Failed to clear persisted layout during recovery', error);
    }
    // Reload through RESET_LAYOUT: it disables layout persistence (shouldStoreLayout=false) before
    // reloading, so the unload handler cannot re-serialize the empty shell over our clear.
    try {
        await ctx.commands.executeCommand(RESET_LAYOUT.id);
    } catch (error) {
        console.error('[qaap-mobile-shell] RESET_LAYOUT failed during recovery; forcing reload', error);
        window.location.reload();
    }
}

export function hasLayoutRecoveryBeenAttemptedExtracted(ctx: any): boolean {
    try {
        return typeof sessionStorage !== 'undefined'
            && sessionStorage.getItem(QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY) === '1';
    } catch {
        return false;
    }
}

export function markLayoutRecoveryAttemptedExtracted(ctx: any): void {
    try {
        sessionStorage?.setItem(QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY, '1');
    } catch {
        /* sessionStorage unavailable — loop protection degrades gracefully */
    }
}

export function armAgentsSurfaceWatchdogExtracted(ctx: any): void {
    const interval = window.setInterval(() => {
        // Skip the DOM scan while the tab is hidden — nothing can go blank off-screen, and this
        // avoids a perpetual background querySelector sweep (battery/CPU on mobile).
        if (document.hidden) {
            return;
        }
        ctx.recoverEmptyAgentsSurface();
    }, 2000);
    ctx.toDispose.push(Disposable.create(() => window.clearInterval(interval)));
}

export function recoverEmptyAgentsSurfaceExtracted(ctx: any): void {
    if (peekPreferDesktopIde()) {
        return;
    }
    const root = document.querySelector<HTMLElement>(
        '.theia-mobile-projects.theia-mod-home.theia-mod-visible.theia-mod-agents-hub-landing',
    );
    const scroll = root?.querySelector<HTMLElement>(':scope > .theia-mobile-projects-scroll');
    if (!root || !scroll || scroll.querySelector(
        '.theia-mobile-agents-hub-inline-execution, .theia-mobile-tasks-hub-root.theia-mod-agents-loading, .theia-mobile-agent-transcript-empty',
    )) {
        return;
    }
    if (ctx.projectsPanel?.node !== root) {
        root.remove();
        if (!ctx.projectsPanel?.node.isConnected) {
            ctx.projectsPanel?.dispose();
            ctx.setTrackedProjectsPanel(undefined);
        }
        ctx.tryBootstrapMobileAgentsChat();
        return;
    }
    if (!ctx.projectsPanel) {
        ctx.tryBootstrapMobileAgentsChat();
        return;
    }
    ctx.projectsPanel.ensureAgentsHubExecutionShellRendered();
    ctx.projectsPanel.refreshHubChrome();
}

export function armBootGuardSafetyTimeoutExtracted(ctx: any): void {
    const timeout = window.setTimeout(() => {
        if (document.documentElement.classList.contains('theia-mobile-workhub-boot')) {
            console.warn('[qaap-mobile-shell] Boot guard still active after 15s — clearing to prevent blank screen');
            clearMobileWorkHubBootGuard();
        }
    }, 15000);
    ctx.toDispose.push(Disposable.create(() => window.clearTimeout(timeout)));
}

export function onDidInitializeLayoutExtracted(ctx: any, app: FrontendApplication): void {
    ctx.ensureShellHooks(app.shell);
    void ctx.workHubBootstrap.bootstrapWorkHubSurfaceAfterLayout().finally(() => {
        ctx.recoverEmptyAgentsSurface();
    });
    window.requestAnimationFrame(() => ctx.recoverEmptyAgentsSurface());
}

export function onStopExtracted(ctx: any, _app: FrontendApplication): void {
    ctx.workHubDiff.setDelegate(undefined);
    ctx.mobileMq?.removeEventListener('change', ctx.onMediaChange);
    window.removeEventListener('resize', ctx.onWindowResize);
    if (ctx.resizeRaf) {
        window.cancelAnimationFrame(ctx.resizeRaf);
        ctx.resizeRaf = 0;
    }
    window.removeEventListener(QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT, ctx.onDismissProjectsPanelEvent);
    window.removeEventListener(QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT, ctx.onLandingHubListChanged);
    ctx.teardownMobileUi();
    ctx.toDispose.dispose();
}

export function shouldActivateMobileLayoutExtracted(ctx: any): boolean {
    // Classic IDE always uses the normal desktop layout — never the mobile one-column view.
    if (peekPreferDesktopIde()) {
        return false;
    }
    if (Boolean(ctx.mobileMq?.matches)) {
        return true;
    }
    if (shouldBootstrapMobileAgentsChat()) {
        return true;
    }
    if (shouldPreferWorkHubAgentsLayout()) {
        return true;
    }
    // Desktop also starts in Work Hub. The classic IDE is entered only through "Open IDE".
    return true;
}

export function enterMobileLayoutExtracted(ctx: any): void {
    ctx.ensureShellHooks(ctx.shell);
    if (ctx.mobileActive) {
        if (!ctx.projectsPanel?.isVisible()
            && !ctx.projectsPanel?.isAgentsHubShellActive()) {
            ctx.tryBootstrapMobileAgentsChat();
        }
        return;
    }
    ctx.mobileActive = true;
    ctx.shell.node.classList.add(MOBILE_ONE_COLUMN_LAYOUT_CLASS);
    ctx.forceCenterColumnFullWidth();
    ctx.ensureOverlayElements();
    // Restored layout often leaves a side sheet expanded; collapse so the editor column is visible.
    void ctx.collapseMobileSideSheets().then(() => {
        if (ctx.landingLeftThisSession && ctx.workspaceService.opened) {
            markPreferAgentsSurface();
        }
        ctx.landing.applyMobileProjectsPanelDismissAfterReload();
        if (!ctx.tryBootstrapMobileAgentsChat()) {
            ctx.ensureMobileProjectsHomeVisible();
        }
        ctx.scheduleSnapAndUiRefresh();
    });
}

export function leaveMobileLayoutExtracted(ctx: any): void {
    if (!ctx.mobileActive) {
        return;
    }
    const preserveProjectsLanding = ctx.isProjectsLandingSession();
    ctx.mobileActive = false;
    ctx.restoreMobileBottomPanelFromMaximized();
    ctx.shell.node.classList.remove(MOBILE_ONE_COLUMN_LAYOUT_CLASS);
    ctx.teardownMobileUi(preserveProjectsLanding);
    if (preserveProjectsLanding) {
        window.requestAnimationFrame(() => ctx.requestFullShellRelayout());
        return;
    }
    ctx.restoreDesktopSplitLayout();
    window.requestAnimationFrame(() => {
        void ctx.ensureDesktopSidePanelSizes();
        ctx.requestFullShellRelayout();
    });
}

export async function ensureDesktopSidePanelSizesExtracted(ctx: any): Promise<void> {
    if (ctx.shouldActivateMobileLayout() || !hasQaapLeftRightSplitPanel(ctx.shell)) {
        return;
    }
    ctx.restoreDesktopSplitLayout();
    const splitWidth = ctx.shell.leftRightSplitPanel.node.clientWidth;
    if (splitWidth <= 0) {
        return;
    }
    const target = Math.max(280, Math.min(360, Math.round(splitWidth * 0.22)));
    if (ctx.shell.isExpanded('left')) {
        await ctx.setSidePanelSize('left', target);
    }
    if (ctx.shell.isExpanded('right')) {
        await ctx.setSidePanelSize('right', target);
    }
    ctx.requestFullShellRelayout();
    await ctx.desktopTerminalLayout.ensureDesktopTerminalNormal();
}

export async function setSidePanelSizeExtracted(ctx: any, side: 'left' | 'right', size: number): Promise<void> {
    const handler = side === 'left' ? ctx.shell.leftPanelHandler : ctx.shell.rightPanelHandler;
    if (handler instanceof QaapSidePanelHandler) {
        await handler.applyPanelSize(size);
    }
}

export function restoreDesktopSplitLayoutExtracted(ctx: any): void {
    if (!hasQaapLeftRightSplitPanel(ctx.shell)) {
        return;
    }
    try {
        // Leave desktop sidebars collapsed by default; individual views restore/expand themselves.
        ctx.shell.leftRightSplitPanel.setRelativeSizes([0, 1, 0]);
    } catch {
        /* layout not ready */
    }
    const bottomSplit = ctx.bottomBarController.getBottomAreaSplitPanel();
    if (bottomSplit) {
        try {
            bottomSplit.setRelativeSizes([1, 0]);
        } catch {
            /* layout not ready */
        }
    }
}

export function forceCenterColumnFullWidthExtracted(ctx: any): void {
    if (!hasQaapLeftRightSplitPanel(ctx.shell)) {
        return;
    }
    try {
        // Side sheets are `position: fixed` overlays — center must always keep full split width
        // so the editor stack and bottom (terminal) panel can lay out inside #theia-bottom-split-panel.
        ctx.shell.leftRightSplitPanel.setRelativeSizes([0, 1, 0]);
    } catch {
        /* layout not ready */
    }
    ctx.bottomBarController.syncMobileBottomSplit();
}

export function requestFullShellRelayoutExtracted(ctx: any): void {
    MessageLoop.sendMessage(ctx.shell, LuminoWidget.ResizeMessage.UnknownSize);
    MessageLoop.postMessage(ctx.shell, LuminoWidget.Msg.FitRequest);
    MessageLoop.postMessage(ctx.shell, LuminoWidget.Msg.UpdateRequest);
    MessageLoop.postMessage(ctx.shell.mainPanel, LuminoWidget.Msg.FitRequest);
    if (!hasQaapLeftRightSplitPanel(ctx.shell)) {
        return;
    }
    const split = ctx.shell.leftRightSplitPanel;
    MessageLoop.sendMessage(split, LuminoWidget.ResizeMessage.UnknownSize);
    MessageLoop.postMessage(split, LuminoWidget.Msg.FitRequest);
    MessageLoop.postMessage(split, LuminoWidget.Msg.UpdateRequest);
    for (const child of toArray(split.widgets)) {
        MessageLoop.sendMessage(child, LuminoWidget.ResizeMessage.UnknownSize);
        MessageLoop.postMessage(child, LuminoWidget.Msg.FitRequest);
        MessageLoop.postMessage(child, LuminoWidget.Msg.UpdateRequest);
    }
    if (ctx.shell.isExpanded('left')) {
        ctx.sideSheetController.relayoutMobileSidePanelHandler('left');
    }
    if (ctx.shell.isExpanded('right')) {
        ctx.sideSheetController.relayoutMobileSidePanelHandler('right');
    }
    MessageLoop.postMessage(ctx.shell.mainPanel, LuminoWidget.Msg.UpdateRequest);
}

export function teardownMobileUiExtracted(ctx: any, preserveProjectsLanding = false): void {
    ctx.bottomBarController.removeBottomBarSecondaryMenu();
    ctx.overlayController.removeBackdrop();
    setMobileWorkHubHideBottomChrome(false);
    setMobileWorkHubComposerHeaderChrome(false);
    setMobileActiveTranscriptChrome(false);
    document.body.classList.remove('theia-mobile-mod-landing');
    ctx.bottomBarController.unpinBottomChromeFromBody();
    ctx.bottomBarController.detachBottomBarFromShell();
    ctx.overlayController.teardown();
    if (preserveProjectsLanding) {
        ctx.landing.applyLandingChrome();
        ctx.shell.node.classList.remove(MOBILE_BOTTOM_OPEN_CLASS);
        return;
    }
    ctx.hideProjectsPanel();
    if (ctx.projectsPanel) {
        ctx.projectsPanel.dispose();
        if (ctx.projectsPanel.node.parentElement) {
            ctx.projectsPanel.node.parentElement.removeChild(ctx.projectsPanel.node);
        }
    }
    ctx.setTrackedProjectsPanel(undefined);
    ctx.pullRequestPanelController.disposePullRequestPanel();
    ctx.shell.node.classList.remove(MOBILE_BOTTOM_OPEN_CLASS);
}

export function ensureOverlayElementsExtracted(ctx: any): void {
    if (!ctx.mobileActive) {
        return;
    }
    ctx.overlayController.removeBackdrop();
    ctx.bottomBarController.ensureBottomBarWidget();
    ctx.bottomBarController.pinBottomChromeToBody();
    ctx.overlayController.ensureMounted();
    ctx.landing.applyMobileProjectsPanelDismissAfterReload();
    if (peekPreferDesktopIde()) {
        ctx.syncMobileHubPrimaryBottomChrome();
        ctx.refreshBottomBar();
        ctx.refreshWorkbenchTopBar();
    } else {
        ctx.ensureProjectsPanel();
        if (!ctx.tryBootstrapMobileAgentsChat()) {
            ctx.ensureMobileProjectsHomeVisible();
        }
    }
    void ctx.refreshProjectsCount();
    if (!peekPreferDesktopIde()) {
        ctx.refreshBottomBar();
    }
    ctx.overlayController.updateBackdropVisibility();
}

export async function ensureMainContentAfterWorkspaceReloadExtracted(ctx: any): Promise<void> {
    if (!ctx.landingLeftThisSession || !ctx.workspaceService.opened) {
        return;
    }
    if (shouldBootstrapMobileAgentsChat() || shouldPreferWorkHubAgentsLayout()) {
        return;
    }
    const fillMain = async (): Promise<void> => {
        if (toArray(ctx.shell.mainPanel.widgets()).length > 0) {
            return;
        }
        await ctx.ensureWelcomeInMainArea();
        if (toArray(ctx.shell.mainPanel.widgets()).length === 0) {
            await ctx.projectsReadme.retryPendingReadmeOpen();
        }
    };
    await fillMain();
    for (const delayMs of [400, 1200, 2500]) {
        window.setTimeout(() => { void fillMain(); }, delayMs);
    }
}

export function ensureDesktopWorkHubSessionsSidebarOpenExtracted(ctx: any): void {
    if (matchesMobileOneColumnLayout() || peekPreferDesktopIde() || hasDesktopSessionsSidebarCollapsed()) {
        return;
    }
    const panel = ctx.projectsPanel;
    if (!panel?.isVisible() || !panel.isHomeMode() || panel.isWorkHubSessionsSidebarVisible()) {
        return;
    }
    panel.openWorkHubSessionsSidebar();
}

export async function refreshProjectsCountExtracted(ctx: any): Promise<void> {
    try {
        const projects = await ctx.projectsService.loadProjects();
        ctx.projectsCount = projects.length;
    } catch {
        ctx.projectsCount = 0;
    }
}

export function hideProjectsPanelExtracted(ctx: any): void {
    ctx.projectsPanel?.hide();
    ctx.landing.applyLandingChrome();
    ctx.refreshBottomBar();
    ctx.refreshWorkbenchTopBar();
}

