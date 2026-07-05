// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { toArray } from '@lumino/algorithm';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { Saveable } from '@theia/core/lib/browser/saveable';
import {
    clearMobileProjectsHomeVisible,
    clearPreferAgentsSurface,
    clearMobileWorkHubBootGuard,
    markMobileProjectsHomeVisible,
    markPreferAgentsSurface,
    peekPreferDesktopIde,
    setMobileWorkHubComposerHeaderChrome,
    syncMobileWorkHubHideIdeSidePanelsFromComposerHeader,
    shouldBootstrapMobileAgentsChat,
    shouldPreferWorkHubAgentsLayout,
    shouldSkipMobileProjectsLanding,
} from './mobile-projects-open';
import type { MobileProjectsHubView } from './mobile-projects-types';
import type { MobileProjectsPanel } from './mobile-projects-panel';
import type { MobileProjectsService } from './mobile-projects-service';
import type { WorkspaceService } from '@theia/workspace/lib/browser';
import { MobileShellSessionState } from './mobile-shell-session-state';

export interface MobileShellWorkHubBootstrapHost {
    isMobileActive(): boolean;
    getProjectsPanel(): MobileProjectsPanel | undefined;
    setProjectsPanel(panel: MobileProjectsPanel | undefined): void;
    shouldActivateMobileLayout(): boolean;
    enterMobileLayout(): void;
    onMediaChange(): void;
    scheduleSnapAndUiRefresh(): void;
    collapseMobileSideSheets(): Promise<void>;
    settleMobileSidePanelsCollapsed(): void;
    ensureWelcomeInMainArea(): Promise<void>;
    ensureDesktopSidePanelSizes(): Promise<void>;
    createProjectsPanel(homeMode: boolean): MobileProjectsPanel;
    appendProjectsPanelToShell(panel: MobileProjectsPanel): void;
    disposeProjectsPanelForDesktopIde(): void;
    syncMobileHubPrimaryBottomChrome(): void;
    refreshBottomBar(): void;
    refreshWorkbenchTopBar(): void;
    ensureDesktopWorkHubSessionsSidebarOpen(): void;
    applyLandingChrome(): void;
    releaseMobileWorkHubBootGuardWhenReady(): Promise<void>;
    isProjectsLandingSession(): boolean;
    hasPendingHubAction(): boolean;
    applyMobileProjectsPanelDismissAfterReload(): void;
    refreshProjectBootstrapFromWorkspace(): void;
}

export interface MobileShellWorkHubBootstrapOptions {
    host: MobileShellWorkHubBootstrapHost;
    shell: ApplicationShell;
    workspaceService: WorkspaceService;
    projectsService: MobileProjectsService;
    sessionState: MobileShellSessionState;
}

/** Work Hub surface bootstrap, agents chat restore, and projects panel lifecycle orchestration. */
export class MobileShellWorkHubBootstrapController {

    protected readonly host: MobileShellWorkHubBootstrapHost;
    protected readonly shell: ApplicationShell;
    protected readonly workspaceService: WorkspaceService;
    protected readonly projectsService: MobileProjectsService;
    protected readonly sessionState: MobileShellSessionState;

    constructor(options: MobileShellWorkHubBootstrapOptions) {
        this.host = options.host;
        this.shell = options.shell;
        this.workspaceService = options.workspaceService;
        this.projectsService = options.projectsService;
        this.sessionState = options.sessionState;
    }

    /** Paint Work Hub immediately; hydrate workspace-dependent state once MRU restore is ready. */
    async bootstrapWorkHubSurfaceAfterLayout(): Promise<void> {
        await this.workspaceService.ready;
        this.host.onMediaChange();
        if (this.host.shouldActivateMobileLayout() && !peekPreferDesktopIde()) {
            if (!this.host.isMobileActive()) {
                this.host.enterMobileLayout();
            }
            if (!this.tryBootstrapMobileAgentsChat()) {
                void this.showMobileProjectsHome('tasks');
            }
            this.host.scheduleSnapAndUiRefresh();
        }
        this.host.onMediaChange();
        if (this.host.isMobileActive()) {
            void this.host.collapseMobileSideSheets();
            if (!peekPreferDesktopIde()) {
                this.host.applyMobileProjectsPanelDismissAfterReload();
                if (!this.tryBootstrapMobileAgentsChat() && !this.host.getProjectsPanel()?.isVisible()) {
                    void this.showMobileProjectsHome('tasks');
                }
            }
            this.host.scheduleSnapAndUiRefresh();
            return;
        }
        if (this.host.shouldActivateMobileLayout() && !peekPreferDesktopIde()) {
            this.host.enterMobileLayout();
            if (!this.tryBootstrapMobileAgentsChat() && !this.host.getProjectsPanel()?.isVisible()) {
                void this.showMobileProjectsHome('tasks');
            }
            this.host.scheduleSnapAndUiRefresh();
            return;
        }
        if (!this.host.shouldActivateMobileLayout()) {
            clearMobileWorkHubBootGuard();
            setMobileWorkHubComposerHeaderChrome(false);
            void this.host.ensureWelcomeInMainArea();
            window.requestAnimationFrame(() => { void this.host.ensureDesktopSidePanelSizes(); });
        }
    }

    /** Remember Agents for reload / wide viewport before the media query drops mobile layout. */
    persistAgentsSurfaceForActiveSession(): void {
        if (peekPreferDesktopIde() || !this.workspaceService.opened || this.host.isProjectsLandingSession()) {
            return;
        }
        if (!this.host.isMobileActive() || !this.sessionState.landingLeftThisSession) {
            return;
        }
        if (document.body.classList.contains('theia-mobile-mod-workhub-composer-header')) {
            markPreferAgentsSurface();
        }
    }

    shouldContinueAgentsBootstrap(epoch: number): boolean {
        return epoch === this.sessionState.agentsBootstrapEpoch
            && !peekPreferDesktopIde()
            && shouldBootstrapMobileAgentsChat();
    }

    cancelAgentsBootstrap(): void {
        this.sessionState.cancelAgentsBootstrap();
    }

    /**
     * Open the inline agentic chat shell when a workspace is already targeted — skips the IDE
     * flash and the project-list landing. Returns true when bootstrap was started.
     */
    tryBootstrapMobileAgentsChat(): boolean {
        if (peekPreferDesktopIde() || !shouldBootstrapMobileAgentsChat()) {
            return false;
        }
        if (!this.host.isMobileActive()) {
            this.host.enterMobileLayout();
        }
        const panel = this.host.getProjectsPanel();
        if (panel?.isVisible() && panel.isHomeMode() && panel.getHubView() === 'tasks') {
            if (panel.isAgentsHubExecutionSurfaceReady()) {
                this.sessionState.landingLeftThisSession = true;
                markPreferAgentsSurface();
                document.body.classList.remove('theia-mobile-mod-landing');
                setMobileWorkHubComposerHeaderChrome(true);
                this.host.syncMobileHubPrimaryBottomChrome();
                this.host.refreshBottomBar();
                void this.prepareWorkHubIdePanelsHidden().then(() => this.host.releaseMobileWorkHubBootGuardWhenReady());
                return true;
            }
            panel.ensureAgentsHubExecutionShellRendered();
            if (panel.isAgentsHubExecutionSurfaceReady()) {
                this.sessionState.landingLeftThisSession = true;
                markPreferAgentsSurface();
                document.body.classList.remove('theia-mobile-mod-landing');
                setMobileWorkHubComposerHeaderChrome(true);
                this.host.syncMobileHubPrimaryBottomChrome();
                this.host.refreshBottomBar();
                void this.prepareWorkHubIdePanelsHidden().then(() => this.host.releaseMobileWorkHubBootGuardWhenReady());
                return true;
            }
        }
        if (this.sessionState.agentsBootstrapStarted) {
            if (panel?.isVisible() && panel.isHomeMode() && panel.getHubView() === 'tasks') {
                panel.ensureAgentsHubExecutionShellRendered();
            }
            return true;
        }
        this.sessionState.agentsBootstrapStarted = true;
        const epoch = this.sessionState.agentsBootstrapEpoch;
        this.sessionState.landingLeftThisSession = true;
        document.body.classList.remove('theia-mobile-mod-landing');
        void this.restoreAgentsSurfaceAfterReload(epoch);
        return true;
    }

    /** Close restored IDE editor tabs so the Work Hub surface can take the main area after reload. */
    async collapseIdeMainAreaForWorkHub(): Promise<void> {
        const widgets = [...toArray(this.shell.mainPanel.widgets())];
        if (widgets.length === 0) {
            return;
        }
        for (const widget of widgets) {
            // Auto-save dirty editors before the discard-close so switching to Work Hub never
            // silently drops unsaved changes; a clean widget skips straight to close.
            if (Saveable.isDirty(widget)) {
                await Saveable.save(widget).catch(() => undefined);
            }
            await this.shell.closeWidget(widget.id, { save: false });
        }
    }

    /**
     * Critical mode boundary: IDE widgets must never bleed into Work Hub. These are separate
     * workspaces with separate visual ownership; Work Hub owns its own Plan/Chat/Preview/Files/
     * Terminal surfaces, while restored workbench widgets belong exclusively to the IDE.
     *
     * The mini-browser preview is an IDE widget restored by the workbench shell; close it whenever
     * Work Hub becomes primary so it cannot overlay the agent UI.
     */
    protected async closeIdeOnlyWidgetsForWorkHub(): Promise<void> {
        const widgets = new Map<string, { id: string; node: HTMLElement }>();
        for (const area of ['main', 'left', 'right', 'bottom'] as ApplicationShell.Area[]) {
            for (const widget of this.shell.getWidgets(area)) {
                if (this.isIdeOnlyWidgetForWorkHub(widget)) {
                    widgets.set(widget.id, widget);
                }
            }
        }
        await Promise.all([...widgets.values()].map(widget => this.shell.closeWidget(widget.id, { save: false })));
    }

    protected isIdeOnlyWidgetForWorkHub(widget: { id: string; node: HTMLElement }): boolean {
        return widget.id.startsWith('mini-browser:')
            || widget.node.classList.contains('qaap-mini-browser-shell')
            || !!widget.node.querySelector(':scope .qaap-mini-browser-shell, :scope .theia-mini-browser');
    }

    /** After reload: return to the Agents execution shell instead of restoring IDE editor tabs. */
    async restoreAgentsSurfaceAfterReload(epoch: number = this.sessionState.agentsBootstrapEpoch): Promise<void> {
        try {
            if (!this.shouldContinueAgentsBootstrap(epoch)) {
                return;
            }
            await this.workspaceService.ready;
            if (!this.shouldContinueAgentsBootstrap(epoch)) {
                return;
            }
            await this.collapseIdeMainAreaForWorkHub();
            if (!this.shouldContinueAgentsBootstrap(epoch)) {
                return;
            }
            document.body.classList.remove('theia-mobile-mod-landing');
            const existingPanel = this.host.getProjectsPanel();
            if (existingPanel && !existingPanel.isHomeMode()) {
                existingPanel.hide();
                existingPanel.dispose();
                existingPanel.node.parentElement?.removeChild(existingPanel.node);
                this.host.setProjectsPanel(undefined);
            }
            this.ensureProjectsPanel(true);
            const panel = this.host.getProjectsPanel();
            if (!panel || !this.shouldContinueAgentsBootstrap(epoch)) {
                return;
            }
            this.projectsService.setHubView('tasks');
            panel.preferComposerSurface('task');
            setMobileWorkHubComposerHeaderChrome(true);
            await panel.show({ preferredHubView: 'tasks' });
            panel.ensureAgentsHubExecutionShellRendered();
            if (!this.shouldContinueAgentsBootstrap(epoch)) {
                panel.hide();
                this.host.disposeProjectsPanelForDesktopIde();
                return;
            }
            await this.prepareWorkHubIdePanelsHidden();
            await this.host.releaseMobileWorkHubBootGuardWhenReady();
            markPreferAgentsSurface();
            void this.finishAgentsSurfaceBootstrap(epoch, panel);
        } finally {
            if (epoch === this.sessionState.agentsBootstrapEpoch) {
                this.sessionState.agentsBootstrapStarted = false;
            }
            // Safety: if bootstrap was aborted or failed, clear the boot guard so the user doesn't
            // see a permanent blank screen. The 15s safety timeout in onStart is the ultimate fallback.
            if (document.documentElement.classList.contains('theia-mobile-workhub-boot')) {
                clearMobileWorkHubBootGuard();
            }
        }
    }

    /** Collapse restored IDE side sheets before revealing Work Hub (avoids Explorer flash). */
    protected async prepareWorkHubIdePanelsHidden(): Promise<void> {
        await this.closeIdeOnlyWidgetsForWorkHub();
        await this.host.collapseMobileSideSheets();
        this.host.settleMobileSidePanelsCollapsed();
    }

    /** Non-blocking chrome refresh after the composer is visible (TTI path). */
    protected finishAgentsSurfaceBootstrap(epoch: number, panel: MobileProjectsPanel): void {
        void (async () => {
            if (!this.shouldContinueAgentsBootstrap(epoch)) {
                panel.hide();
                this.host.disposeProjectsPanelForDesktopIde();
                return;
            }
            this.host.refreshProjectBootstrapFromWorkspace();
            this.host.ensureDesktopWorkHubSessionsSidebarOpen();
            await this.host.collapseMobileSideSheets();
            this.host.settleMobileSidePanelsCollapsed();
            syncMobileWorkHubHideIdeSidePanelsFromComposerHeader();
            if (!this.shouldContinueAgentsBootstrap(epoch)) {
                panel.hide();
                this.host.disposeProjectsPanelForDesktopIde();
                return;
            }
            this.host.syncMobileHubPrimaryBottomChrome();
            this.host.refreshBottomBar();
            this.host.refreshWorkbenchTopBar();
        })();
    }

    /**
     * Projects landing visible on every mobile session — even when a workspace is already open,
     * the user must explicitly tap into it from the dashboard. Once the user has left the landing
     * in this session, this method is a no-op.
     */
    ensureMobileProjectsHomeVisible(): void {
        if (!this.host.isMobileActive() || this.sessionState.landingLeftThisSession || shouldSkipMobileProjectsLanding()) {
            return;
        }
        if (shouldPreferWorkHubAgentsLayout() || shouldBootstrapMobileAgentsChat()) {
            return;
        }
        if (this.host.hasPendingHubAction()) {
            this.sessionState.landingLeftThisSession = true;
            clearMobileProjectsHomeVisible();
            this.host.refreshProjectBootstrapFromWorkspace();
            return;
        }
        markMobileProjectsHomeVisible();
        document.body.classList.add('theia-mobile-mod-landing');
        this.ensureProjectsPanel();
        const panel = this.host.getProjectsPanel();
        if (panel?.isHomeMode() && !panel.isVisible()) {
            void panel.show().then(() => {
                if (this.sessionState.landingLeftThisSession || shouldSkipMobileProjectsLanding()) {
                    panel.hide();
                    document.body.classList.remove('theia-mobile-mod-landing');
                    return;
                }
                this.host.applyLandingChrome();
                this.host.syncMobileHubPrimaryBottomChrome();
                this.host.refreshBottomBar();
            });
        } else {
            this.host.applyLandingChrome();
            this.host.syncMobileHubPrimaryBottomChrome();
            this.host.refreshBottomBar();
        }
    }

    ensureProjectsPanel(forceHomeMode?: boolean): void {
        const panel = this.host.getProjectsPanel();
        if (panel && forceHomeMode !== undefined && panel.isHomeMode() !== forceHomeMode) {
            panel.hide();
            panel.dispose();
            panel.node.parentElement?.removeChild(panel.node);
            this.host.setProjectsPanel(undefined);
        }
        if (this.host.getProjectsPanel()) {
            return;
        }
        const homeMode = forceHomeMode ?? (this.host.isMobileActive() && !this.sessionState.landingLeftThisSession);
        const newPanel = this.host.createProjectsPanel(homeMode);
        this.host.setProjectsPanel(newPanel);
        this.host.appendProjectsPanelToShell(newPanel);
        if (forceHomeMode === undefined && homeMode && !shouldSkipMobileProjectsLanding()) {
            void newPanel.show().then(() => {
                if (this.sessionState.landingLeftThisSession || shouldSkipMobileProjectsLanding()) {
                    this.host.getProjectsPanel()?.hide();
                    document.body.classList.remove('theia-mobile-mod-landing');
                    return;
                }
                this.host.applyLandingChrome();
            });
        }
    }

    async showMobileProjectsHome(preferredHubView?: MobileProjectsHubView): Promise<void> {
        this.sessionState.landingLeftThisSession = false;
        clearPreferAgentsSurface();
        if (preferredHubView === 'home' || preferredHubView === undefined) {
            markMobileProjectsHomeVisible();
        } else {
            clearMobileProjectsHomeVisible();
            markPreferAgentsSurface();
        }
        document.body.classList.add('theia-mobile-mod-landing');
        const panel = this.host.getProjectsPanel();
        if (panel && !panel.isHomeMode()) {
            panel.hide();
            panel.dispose();
            panel.node.parentElement?.removeChild(panel.node);
            this.host.setProjectsPanel(undefined);
        }
        this.ensureProjectsPanel(true);
        const resolved = this.host.getProjectsPanel();
        if (!resolved) {
            return;
        }
        if (preferredHubView !== undefined && preferredHubView !== 'home') {
            this.projectsService.setHubView(preferredHubView);
        }
        await resolved.show(preferredHubView !== undefined ? { preferredHubView } : undefined);
        this.host.applyLandingChrome();
        this.host.syncMobileHubPrimaryBottomChrome();
        this.host.refreshBottomBar();
        this.host.refreshWorkbenchTopBar();
    }

}
