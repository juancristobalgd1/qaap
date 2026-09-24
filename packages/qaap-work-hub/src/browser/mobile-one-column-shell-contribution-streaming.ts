import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
// Extracted from mobile-one-column-shell-contribution.ts

import { toArray } from '@lumino/algorithm';
import { MessageLoop } from '@lumino/messaging';
import { Widget as LuminoWidget } from '@lumino/widgets';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { RESET_LAYOUT } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import {
    matchesMobileOneColumnLayout,
    MOBILE_ONE_COLUMN_LAYOUT_CLASS,
} from '@theia/core/lib/browser/shell/mobile-layout-state';
import { hasQaapLeftRightSplitPanel } from '@theia/qaap-shell/lib/browser/qaap-shell-layout';
import { QaapSidePanelHandler } from '@theia/qaap-shell/lib/browser/qaap-side-panel-handler';
import {
    clearMobileWorkHubBootGuard,
    markPreferAgentsSurface,
    peekPreferDesktopIde,
    shouldBootstrapMobileAgentsChat,
    shouldPreferWorkHubAgentsLayout,
    QAAP_MOBILE_ACTIVE_TRANSCRIPT_BODY_CLASS,
    QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT,
    QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT,
    setMobileActiveTranscriptChrome,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubHideBottomChrome,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import { hasDesktopSessionsSidebarCollapsed } from './mobile-work-hub-sessions-sidebar';
import { QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import {
    decideLayoutRecovery,
    QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY,
    SHELL_LAYOUT_STORAGE_KEY,
} from './mobile-shell-layout-recovery';
import {
    MOBILE_BOTTOM_OPEN_CLASS,
} from '@theia/qaap-mobile-shell/lib/browser/mobile-shell-bottom-bar-widget';
import { LAYOUT_RECOVERY_GRACE_MS } from './mobile-one-column-shell-contribution';

export function isWorkHubSurfacePresentInDomExtracted(ctx: MobileOneColumnShellContributionContext): boolean {
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

export function armLayoutRecoveryGuardExtracted(ctx: MobileOneColumnShellContributionContext): void {
    if (peekPreferDesktopIde() || typeof window === 'undefined') {
        return;
    }
    const timeout = window.setTimeout(() => {
        void ctx.runLayoutRecoveryGuard();
    }, LAYOUT_RECOVERY_GRACE_MS);
    ctx.toDispose.push(Disposable.create(() => window.clearTimeout(timeout)));
}

export async function runLayoutRecoveryGuardExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
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

export function hasLayoutRecoveryBeenAttemptedExtracted(ctx: MobileOneColumnShellContributionContext): boolean {
    try {
        return typeof sessionStorage !== 'undefined'
            && sessionStorage.getItem(QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY) === '1';
    } catch {
        return false;
    }
}

export function markLayoutRecoveryAttemptedExtracted(ctx: MobileOneColumnShellContributionContext): void {
    try {
        sessionStorage?.setItem(QAAP_LAYOUT_RECOVERY_ATTEMPTED_KEY, '1');
    } catch {
        /* sessionStorage unavailable — loop protection degrades gracefully */
    }
}

export function armAgentsSurfaceWatchdogExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export function recoverEmptyAgentsSurfaceExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export function armBootGuardSafetyTimeoutExtracted(ctx: MobileOneColumnShellContributionContext): void {
    const timeout = window.setTimeout(() => {
        if (document.documentElement.classList.contains('theia-mobile-workhub-boot')) {
            console.warn('[qaap-mobile-shell] Boot guard still active after 15s — clearing to prevent blank screen');
            clearMobileWorkHubBootGuard();
        }
    }, 15000);
    ctx.toDispose.push(Disposable.create(() => window.clearTimeout(timeout)));
}

export function onDidInitializeLayoutExtracted(ctx: MobileOneColumnShellContributionContext, app: FrontendApplication): void {
    ctx.ensureShellHooks(app.shell);
    void ctx.workHubBootstrap.bootstrapWorkHubSurfaceAfterLayout().finally(() => {
        ctx.recoverEmptyAgentsSurface();
    });
    window.requestAnimationFrame(() => ctx.recoverEmptyAgentsSurface());
}

export function onStopExtracted(ctx: MobileOneColumnShellContributionContext, _app: FrontendApplication): void {
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

export function shouldActivateMobileLayoutExtracted(ctx: MobileOneColumnShellContributionContext): boolean {
    // Classic IDE always uses the normal responsive layout — never the mobile one-column view.
    // Keep the body marker as a runtime fallback while a persisted preference is hydrating.
    if (peekPreferDesktopIde() || document.body.classList.contains(QAAP_MOBILE_DESKTOP_IDE_BODY_CLASS)) {
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

export function enterMobileLayoutExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export function leaveMobileLayoutExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export async function ensureDesktopSidePanelSizesExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
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

export async function setSidePanelSizeExtracted(ctx: MobileOneColumnShellContributionContext, side: 'left' | 'right', size: number): Promise<void> {
    const handler = side === 'left' ? ctx.shell.leftPanelHandler : ctx.shell.rightPanelHandler;
    if (handler instanceof QaapSidePanelHandler) {
        await handler.applyPanelSize(size);
    }
}

export function restoreDesktopSplitLayoutExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export function forceCenterColumnFullWidthExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export function requestFullShellRelayoutExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export function teardownMobileUiExtracted(ctx: MobileOneColumnShellContributionContext, preserveProjectsLanding = false): void {
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

export function ensureOverlayElementsExtracted(ctx: MobileOneColumnShellContributionContext): void {
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

export async function ensureMainContentAfterWorkspaceReloadExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
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

export function ensureDesktopWorkHubSessionsSidebarOpenExtracted(ctx: MobileOneColumnShellContributionContext): void {
    if (matchesMobileOneColumnLayout() || peekPreferDesktopIde() || hasDesktopSessionsSidebarCollapsed()) {
        return;
    }
    const panel = ctx.projectsPanel;
    if (!panel?.isVisible() || !panel.isHomeMode() || panel.isWorkHubSessionsSidebarVisible()) {
        return;
    }
    panel.openWorkHubSessionsSidebar();
}

export async function refreshProjectsCountExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
    try {
        const projects = await ctx.projectsService.loadProjects();
        ctx.projectsCount = projects.length;
    } catch {
        ctx.projectsCount = 0;
    }
}

export function hideProjectsPanelExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.projectsPanel?.hide();
    ctx.landing.applyLandingChrome();
    ctx.refreshBottomBar();
    ctx.refreshWorkbenchTopBar();
}
