// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    clearMobileWorkHubBootGuard,
    clearPreferAgentsSurface,
    clearPreferDesktopIde,
    markPreferAgentsSurface,
    markPreferDesktopIde,
    setMobileActiveTranscriptChrome,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubHideBottomChrome,
} from './mobile-projects-open';
import type { MobileProjectsPanel } from './mobile-projects-panel';
import { MobileShellSessionState } from './mobile-shell-session-state';
import { matchesMobileNarrowViewport } from '@theia/core/lib/browser/shell/mobile-layout-state';

export interface MobileShellIdeFallbackHost {
    isMobileActive(): boolean;
    shouldActivateMobileLayout(): boolean;
    enterMobileLayout(): void;
    leaveMobileLayout(): void;
    onMediaChange(): void;
    cancelAgentsBootstrap(): void;
    getProjectsPanel(): MobileProjectsPanel | undefined;
    setProjectsPanel(panel: MobileProjectsPanel | undefined): void;
    tryBootstrapMobileAgentsChat(): boolean;
    restoreAgentsSurfaceAfterReload(): Promise<void>;
    syncMobileHubPrimaryBottomChrome(): void;
    refreshBottomBar(): void;
    refreshWorkbenchTopBar(): void;
    syncWorkHubSessionsSidebarLayout(): void;
    forceCenterColumnFullWidth(): void;
    scheduleSnapAndUiRefresh(): void;
    ensureDesktopSidePanelSizes(): Promise<void>;
    requestFullShellRelayout(): void;
    syncOverlayEdgeSwipeZones(): void;
}

export interface MobileShellIdeFallbackOptions {
    host: MobileShellIdeFallbackHost;
    sessionState: MobileShellSessionState;
}

/** Classic IDE entry/exit while keeping IDE and Work Hub as explicit, persistent session surfaces. */
export class MobileShellIdeFallbackController {

    protected readonly host: MobileShellIdeFallbackHost;
    protected readonly sessionState: MobileShellSessionState;

    constructor(options: MobileShellIdeFallbackOptions) {
        this.host = options.host;
        this.sessionState = options.sessionState;
    }

    disposeProjectsPanelForDesktopIde(): void {
        const panel = this.host.getProjectsPanel();
        if (!panel) {
            return;
        }
        panel.hide();
        panel.dispose();
        if (panel.node.parentElement) {
            panel.node.parentElement.removeChild(panel.node);
        }
        this.host.setProjectsPanel(undefined);
    }

    openDesktopIde(): void {
        const preserveNarrowMobileLayout = this.host.isMobileActive() && matchesMobileNarrowViewport();
        this.host.cancelAgentsBootstrap();
        clearPreferAgentsSurface();
        markPreferDesktopIde();
        setMobileWorkHubComposerHeaderChrome(false);
        setMobileWorkHubHideBottomChrome(false);
        setMobileActiveTranscriptChrome(false);
        document.body.classList.remove('theia-mobile-mod-landing');
        clearMobileWorkHubBootGuard();
        this.disposeProjectsPanelForDesktopIde();
        if (preserveNarrowMobileLayout) {
            this.host.forceCenterColumnFullWidth();
            this.host.syncMobileHubPrimaryBottomChrome();
            this.host.refreshBottomBar();
            this.host.refreshWorkbenchTopBar();
            this.host.requestFullShellRelayout();
            this.host.scheduleSnapAndUiRefresh();
            this.host.syncOverlayEdgeSwipeZones();
            return;
        }
        // Classic IDE always uses the normal responsive layout (never the mobile one-column view).
        this.host.leaveMobileLayout();
        this.host.syncOverlayEdgeSwipeZones();
        this.host.onMediaChange();
        window.requestAnimationFrame(() => {
            void this.host.ensureDesktopSidePanelSizes();
            this.host.requestFullShellRelayout();
        });
    }

    /** IDE | Agents switch from classic IDE — restore the Agents execution shell. */
    returnToAgentsFromDesktopIde(): void {
        this.host.cancelAgentsBootstrap();
        clearPreferDesktopIde();
        markPreferAgentsSurface();
        setMobileWorkHubComposerHeaderChrome(true);
        this.sessionState.landingLeftThisSession = true;
        document.body.classList.remove('theia-mobile-mod-landing');
        if (!this.host.isMobileActive() && this.host.shouldActivateMobileLayout()) {
            this.host.enterMobileLayout();
        }
        const reconcileWorkHubLayout = (): void => {
            this.host.syncWorkHubSessionsSidebarLayout();
            this.host.requestFullShellRelayout();
        };
        if (!this.host.tryBootstrapMobileAgentsChat()) {
            void this.host.restoreAgentsSurfaceAfterReload().finally(reconcileWorkHubLayout);
        }
        // Bootstrap may recreate the panel asynchronously. Reconcile now and on the next paint;
        // the bootstrap controller repeats this after the restored panel is actually visible.
        reconcileWorkHubLayout();
        window.requestAnimationFrame(reconcileWorkHubLayout);
        this.host.refreshBottomBar();
        this.host.refreshWorkbenchTopBar();
        this.host.syncOverlayEdgeSwipeZones();
    }
}
