import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
// Extracted from mobile-one-column-shell-contribution.ts

import { Disposable } from '@theia/core/lib/common/disposable';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { MobileProjectsPanel } from './mobile-projects-panel';
import { MobileProjectsPanelFactory } from './mobile-projects-panel-factory';
import {
    installMobileWorkHubBootGuard,
    peekPreferDesktopIde,
    shouldBootstrapMobileAgentsChat,
    shouldPreferWorkHubAgentsLayout,
    QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT,
    QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT,
    setMobileWorkHubComposerHeaderChrome,
    recomputeMobileWorkHubHideIdeSidePanels,
} from './mobile-projects-open';
import { resolveInitialLandingBodyClass } from './mobile-shell-landing-state';
import { MobileShellLandingController } from './mobile-shell-landing-controller';
import {
    MobileShellBottomBarController,
} from './mobile-shell-bottom-bar-controller';
import {
    MobileShellOverlayHostController,
} from './mobile-shell-overlay-host';
import {
    MobileShellSideSheetController,
} from './mobile-shell-side-sheet-controller';
import {
    MobileShellWorkHubBootstrapController,
} from './mobile-shell-work-hub-bootstrap';
import {
    MobileShellIdeFallbackController,
} from './mobile-shell-ide-fallback';
import {
    MobileShellHubNavigationController,
} from './mobile-shell-hub-navigation-controller';
import {
    MobileShellPullRequestPanelController,
} from './mobile-shell-pull-request-panel-controller';
import {
    MobileShellTranscriptChromeController,
} from './mobile-shell-transcript-chrome-controller';
import {
    MobileBottomButtonId,
} from '@theia/qaap-mobile-mechanics/lib/browser/mobile-shell-bottom-bar-widget';

export function setTrackedProjectsPanelExtracted(ctx: MobileOneColumnShellContributionContext, panel: MobileProjectsPanel | undefined): void {
    ctx.projectsPanelTrack?.dispose();
    ctx.projectsPanelTrack = undefined;
    ctx.projectsPanel = panel;
    if (panel) {
        ctx.projectsPanelTrack = ctx.composerPromptService.trackPanel(panel);
    }
}

export function initLandingControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.initBottomBarController();
    ctx.initSideSheetController();
    ctx.initOverlayController();
    ctx.initPullRequestPanelController();
    ctx.initIdeFallbackController();
    ctx.initWorkHubBootstrapController();
    ctx.landingHost = {
        getProjectsPanel: () => ctx.projectsPanel,
        setProjectsPanel: panel => ctx.setTrackedProjectsPanel(panel),
        ensureProjectsPanel: forceHomeMode => ctx.workHubBootstrap.ensureProjectsPanel(forceHomeMode),
        hideProjectsPanel: () => ctx.hideProjectsPanel(),
        tryBootstrapMobileAgentsChat: () => ctx.workHubBootstrap.tryBootstrapMobileAgentsChat(),
        ensureMainContentAfterWorkspaceReload: () => ctx.ensureMainContentAfterWorkspaceReload(),
        refreshProjectBootstrapFromWorkspace: () => { void ctx.projectBootstrap.refreshFromCurrentWorkspace(); },
        ensureDesktopWorkHubSessionsSidebarOpen: () => ctx.ensureDesktopWorkHubSessionsSidebarOpen(),
        syncMobileHubPrimaryBottomChrome: () => ctx.bottomBarController.syncMobileHubPrimaryBottomChrome(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        refreshWorkbenchTopBar: () => ctx.refreshWorkbenchTopBar(),
        scheduleSnapAndUiRefresh: () => ctx.scheduleSnapAndUiRefresh(),
    };
    ctx.landing = new MobileShellLandingController({
        host: ctx.landingHost,
        projectsService: ctx.projectsService,
        sessionState: ctx.sessionState,
        mobileMq: ctx.mobileMq,
    });
    ctx.initHubNavigationController();
    ctx.initTranscriptChromeController();
    ctx.initProjectsPanelFactory();
    ctx.patchWorkHubBootstrapLandingHost();
}

export function initProjectsPanelFactoryExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.projectsPanelFactory = new MobileProjectsPanelFactory({
        deps: {
            projectsService: ctx.projectsService,
            commands: ctx.commands,
            widgetManager: ctx.widgetManager,
            applicationShell: ctx.shell,
            scmService: ctx.scmService,
            mobileProjectChatViewWidgetFactory: ctx.mobileProjectChatViewWidgetFactory,
            chatService: ctx.chatService,
            chatAgentService: ctx.chatAgentService,
            messageService: ctx.messageService,
            variableService: ctx.variableService,
            skillService: ctx.skillService,
            promptService: ctx.promptService,
            quickInputService: ctx.quickInputService,
            fileUploadService: ctx.fileUploadService,
            fileService: ctx.fileService,
            workspaceService: ctx.workspaceService,
            editorManager: ctx.editorManager,
            monacoEditorProvider: ctx.monacoEditorProvider,
            labelProvider: ctx.labelProvider,
            markdownPreviewHandler: ctx.markdownPreviewHandler,
            decorationsService: ctx.decorationsService,
            colorRegistry: ctx.colorRegistry,
            terminalService: ctx.terminalService,
            storageService: ctx.storageService,
            previewSurfaceRegistry: ctx.previewSurfaceRegistry,
            elementInspectorService: ctx.elementInspectorService,
            clipboardService: ctx.clipboardService,
            preferenceService: ctx.preferenceService,
            mcpFrontendService: ctx.mcpFrontendService,
            languageModelRegistry: ctx.languageModelRegistry,
            commitMessageAi: ctx.commitMessageAi,
            composerPromptImprover: ctx.composerPromptImprover,
            composerEditorContextService: ctx.composerEditorContextService,
            workHubProjectSkillRoots: ctx.workHubProjectSkillRoots,
            projectBootstrap: ctx.projectBootstrap,
            agUiFrontendTools: ctx.agUiFrontendTools,
            activeTasks: ctx.activeTasks,
            conversations: ctx.conversations,
            backgroundContext: ctx.backgroundContext,
            inboxStream: ctx.inboxStream,
            conversationFlags: ctx.conversationFlags,
        },
        delegate: {
            onProjectOpen: project => { void ctx.onProjectsPanelOpen(project); },
            onProjectOpenInIde: project => { void ctx.onProjectsPanelOpenInIde(project); },
            onDismiss: () => {
                ctx.landing.onLandingDismissed();
                ctx.scheduleSnapAndUiRefresh();
                ctx.refreshBottomBar();
                ctx.refreshWorkbenchTopBar();
            },
            onWorkspaceOpened: () => ctx.onProjectsWorkspaceOpened(),
            onProjectsChanged: () => { void ctx.refreshProjectsCount().then(() => ctx.refreshBottomBar()); },
            onCurrentProjectActivated: () => ctx.onCurrentProjectActivated(),
            onResumePreview: project => {
                void ctx.commands.executeCommand('qaap.hub.resumePreview', project);
            },
            onOpenAgentOnTask: project => {
                void ctx.commands.executeCommand('qaap.mobile.openAgentOnTask', project);
            },
            onOpenPullRequest: pullRequest => {
                void ctx.openPullRequestFromInbox(pullRequest);
            },
            onShowAgentsHub: () => { void ctx.hubNavigation.openMobileWorkHubLanding('tasks'); },
            onHubLandingViewChanged: () => {
                ctx.syncMobileHubPrimaryBottomChrome();
                ctx.refreshBottomBar();
                ctx.refreshWorkbenchTopBar();
            },
            onEnterActiveTranscript: () => ctx.transcriptChrome.onEnterActiveTranscript(),
            onEnterWorkHubConversation: () => ctx.enforceWorkHubSurfaceIsolation(),
            onExitActiveTranscript: () => { void ctx.transcriptChrome.onExitActiveTranscript(); },
            openWorkHubPreferencesSheet: query => ctx.openWorkHubPreferencesSheet(query),
            openWorkHubBillingSheet: () => ctx.openWorkHubBillingSheet(),
            openWorkHubAiConfigurationSheet: tabId => ctx.openWorkHubAiConfigurationSheet(tabId),
        },
        panelOptions: {
            whenFrontendReady: () => ctx.frontendStateService.reachedState('ready'),
            agentFinishedToast: ctx.agentFinishedToast,
            mobileIdeViewPicker: {
                isVisible: () => ctx.mobileActive && !peekPreferDesktopIde(),
                getOptions: () => ctx.bottomBarController.getMobileIdeHeaderViewButtons(),
                getActiveId: () => ctx.resolveMobileIdeHeaderViewId(),
                onSelect: id => ctx.activateMobileIdeHeaderView(id as MobileBottomButtonId),
            },
        },
    });
}

export function initTranscriptChromeControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.transcriptChromeHost = {
        getProjectsPanel: () => ctx.projectsPanel,
        openMobileWorkHubLanding: view => ctx.hubNavigation.openMobileWorkHubLanding(view),
        syncMobileHubPrimaryBottomChrome: () => ctx.bottomBarController.syncMobileHubPrimaryBottomChrome(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        refreshWorkbenchTopBar: () => ctx.refreshWorkbenchTopBar(),
    };
    ctx.transcriptChrome = new MobileShellTranscriptChromeController({
        host: ctx.transcriptChromeHost,
        sessionState: ctx.sessionState,
    });
}

export function initPullRequestPanelControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.pullRequestPanelHost = {
        scheduleSnapAndUiRefresh: () => ctx.scheduleSnapAndUiRefresh(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        dismissSheetsAsync: () => ctx.sideSheetController.dismissSheetsAsync(),
        hideProjectsPanel: () => ctx.hideProjectsPanel(),
    };
    ctx.pullRequestPanelController = new MobileShellPullRequestPanelController({
        host: ctx.pullRequestPanelHost,
        shell: ctx.shell,
    });
}

export function initHubNavigationControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.hubNavigationHost = {
        isMobileActive: () => ctx.mobileActive,
        enterMobileLayout: () => ctx.enterMobileLayout(),
        getProjectsPanel: () => ctx.projectsPanel,
        applyLandingChrome: () => ctx.landing.applyLandingChrome(),
        warmLiveTransport: () => ctx.conversations.warmLiveTransport(),
        startActiveTasks: () => ctx.activeTasks.start(),
        syncMobileHubPrimaryBottomChrome: () => ctx.bottomBarController.syncMobileHubPrimaryBottomChrome(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        refreshWorkbenchTopBar: () => ctx.refreshWorkbenchTopBar(),
        ensureDesktopWorkHubSessionsSidebarOpen: () => ctx.ensureDesktopWorkHubSessionsSidebarOpen(),
        hidePullRequestPanel: () => ctx.pullRequestPanelController.hidePullRequestPanel(),
        dismissSheetsAsync: () => ctx.sideSheetController.dismissSheetsAsync(),
        collapseMobileSidePanels: () => ctx.sideSheetController.collapseMobileSidePanels(),
        showMobileProjectsHome: view => ctx.workHubBootstrap.showMobileProjectsHome(view),
        syncOverlayEdgeSwipeZones: () => ctx.syncOverlayEdgeSwipeZones(),
    };
    ctx.hubNavigation = new MobileShellHubNavigationController({
        host: ctx.hubNavigationHost,
        shell: ctx.shell,
        projectsService: ctx.projectsService,
        sessionState: ctx.sessionState,
    });
}

export function patchWorkHubBootstrapLandingHostExtracted(ctx: MobileOneColumnShellContributionContext): void {
    Object.assign(ctx.workHubBootstrapHost, {
        applyLandingChrome: () => ctx.landing.applyLandingChrome(),
        releaseMobileWorkHubBootGuardWhenReady: () => ctx.landing.releaseMobileWorkHubBootGuardWhenReady(),
        isProjectsLandingSession: () => ctx.landing.isProjectsLandingSession(),
        hasPendingHubAction: () => ctx.landing.hasPendingHubAction(),
        applyMobileProjectsPanelDismissAfterReload: () => ctx.landing.applyMobileProjectsPanelDismissAfterReload(),
    });
}

export function initSideSheetControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.sideSheetHost = {
        isMobileActive: () => ctx.mobileActive,
        forceCenterColumnFullWidth: () => ctx.forceCenterColumnFullWidth(),
        persistAgentsSurfaceForActiveSession: () => ctx.workHubBootstrap.persistAgentsSurfaceForActiveSession(),
        updateMobileShellStateClasses: () => ctx.bottomBarController.updateMobileShellStateClasses(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        updateBackdropVisibility: () => ctx.overlayController.updateBackdropVisibility(),
        syncIdeMiniBrowserPreviewSuspension: () => ctx.syncIdeMiniBrowserPreviewSuspension(),
        getBottomPanelPendingUpdate: () => ctx.bottomBarController.getBottomPanelPendingUpdate(),
        prepareSideSheetOpen: side => ctx.prepareSideSheetOpen(side),
        mountSideSheetWidget: (side, widgetId) => ctx.mountSideSheetWidget(side, widgetId),
    };
    ctx.sideSheetController = new MobileShellSideSheetController({
        host: ctx.sideSheetHost,
        shell: ctx.shell,
        commands: ctx.commands,
        bottomBarController: ctx.bottomBarController,
    });
}

export function initOverlayControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.overlayHost = {
        isMobileActive: () => ctx.mobileActive,
        isWorkspaceOpened: () => ctx.workspaceService.opened,
        shouldMountEdgeSwipeZones: () => peekPreferDesktopIde(),
        toggleProjectsPanel: () => ctx.toggleProjectsPanel(),
        isAnyMobileSideSheetVisible: () => ctx.sideSheetController.isAnyMobileSideSheetVisible(),
        requestSheetRelayout: () => ctx.sideSheetController.requestSheetRelayout(),
        relayoutMobileSidePanelHandler: side => ctx.sideSheetController.relayoutMobileSidePanelHandler(side),
    };
    ctx.overlayController = new MobileShellOverlayHostController({
        host: ctx.overlayHost,
        shell: ctx.shell,
    });
}

export function syncOverlayEdgeSwipeZonesExtracted(ctx: MobileOneColumnShellContributionContext): void {
    if (!ctx.mobileActive) {
        return;
    }
    ctx.overlayController.syncEdgeSwipeZones();
}

export function initIdeFallbackControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.ideFallbackHost = {
        isMobileActive: () => ctx.mobileActive,
        shouldActivateMobileLayout: () => ctx.shouldActivateMobileLayout(),
        enterMobileLayout: () => ctx.enterMobileLayout(),
        leaveMobileLayout: () => ctx.leaveMobileLayout(),
        onMediaChange: () => ctx.onMediaChange(),
        cancelAgentsBootstrap: () => ctx.workHubBootstrap.cancelAgentsBootstrap(),
        getProjectsPanel: () => ctx.projectsPanel,
        setProjectsPanel: panel => ctx.setTrackedProjectsPanel(panel),
        tryBootstrapMobileAgentsChat: () => ctx.workHubBootstrap.tryBootstrapMobileAgentsChat(),
        restoreAgentsSurfaceAfterReload: () => ctx.workHubBootstrap.restoreAgentsSurfaceAfterReload(),
        syncMobileHubPrimaryBottomChrome: () => ctx.bottomBarController.syncMobileHubPrimaryBottomChrome(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        refreshWorkbenchTopBar: () => ctx.refreshWorkbenchTopBar(),
        syncWorkHubSessionsSidebarLayout: () => ctx.projectsPanel?.syncSessionsSidebarLayout(),
        forceCenterColumnFullWidth: () => ctx.forceCenterColumnFullWidth(),
        scheduleSnapAndUiRefresh: () => ctx.scheduleSnapAndUiRefresh(),
        ensureDesktopSidePanelSizes: () => ctx.ensureDesktopSidePanelSizes(),
        requestFullShellRelayout: () => ctx.requestFullShellRelayout(),
        syncOverlayEdgeSwipeZones: () => ctx.syncOverlayEdgeSwipeZones(),
    };
    ctx.ideFallback = new MobileShellIdeFallbackController({
        host: ctx.ideFallbackHost,
        sessionState: ctx.sessionState,
    });
}

export function initWorkHubBootstrapControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.workHubBootstrapHost = {
        isMobileActive: () => ctx.mobileActive,
        getProjectsPanel: () => ctx.projectsPanel,
        setProjectsPanel: panel => ctx.setTrackedProjectsPanel(panel),
        shouldActivateMobileLayout: () => ctx.shouldActivateMobileLayout(),
        enterMobileLayout: () => ctx.enterMobileLayout(),
        onMediaChange: () => ctx.onMediaChange(),
        scheduleSnapAndUiRefresh: () => ctx.scheduleSnapAndUiRefresh(),
        collapseMobileSideSheets: () => ctx.collapseMobileSideSheets(),
        settleMobileSidePanelsCollapsed: () => ctx.settleMobileSidePanelsCollapsed(),
        ensureWelcomeInMainArea: () => ctx.ensureWelcomeInMainArea(),
        ensureDesktopSidePanelSizes: () => ctx.ensureDesktopSidePanelSizes(),
        createProjectsPanel: homeMode => ctx.createProjectsPanel(homeMode),
        appendProjectsPanelToShell: panel => { ctx.shell.node.appendChild(panel.node); },
        disposeProjectsPanelForDesktopIde: () => ctx.ideFallback?.disposeProjectsPanelForDesktopIde(),
        syncMobileHubPrimaryBottomChrome: () => ctx.bottomBarController.syncMobileHubPrimaryBottomChrome(),
        refreshBottomBar: () => ctx.bottomBarController.refreshBottomBar(),
        refreshWorkbenchTopBar: () => ctx.refreshWorkbenchTopBar(),
        ensureDesktopWorkHubSessionsSidebarOpen: () => ctx.ensureDesktopWorkHubSessionsSidebarOpen(),
        syncWorkHubSessionsSidebarLayout: () => ctx.projectsPanel?.syncSessionsSidebarLayout(),
        applyLandingChrome: () => undefined,
        releaseMobileWorkHubBootGuardWhenReady: async () => undefined,
        isProjectsLandingSession: () => false,
        hasPendingHubAction: () => false,
        applyMobileProjectsPanelDismissAfterReload: () => undefined,
        refreshProjectBootstrapFromWorkspace: () => { void ctx.projectBootstrap.refreshFromCurrentWorkspace(); },
    };
    ctx.workHubBootstrap = new MobileShellWorkHubBootstrapController({
        host: ctx.workHubBootstrapHost,
        shell: ctx.shell,
        workspaceService: ctx.workspaceService,
        projectsService: ctx.projectsService,
        sessionState: ctx.sessionState,
    });
}

export function initBottomBarControllerExtracted(ctx: MobileOneColumnShellContributionContext): void {
    ctx.bottomBarHost = {
        isMobileActive: () => ctx.mobileActive,
        getLandingLeftThisSession: () => ctx.sessionState.landingLeftThisSession,
        getProjectsCount: () => ctx.projectsCount,
        getProjectsPanel: () => ctx.projectsPanel,
        isMobileWorkHubLandingVisible: () => ctx.hubNavigation.isMobileWorkHubLandingVisible(),
        isPullRequestPanelShown: () => ctx.pullRequestPanelController.isPullRequestPanelShown(),
        isMobileAgentSheetVisible: () => ctx.isMobileAgentSheetVisible(),
        isMobileExploreSheetVisible: () => ctx.isMobileExploreSheetVisible(),
        getActivePreviewWidget: () => ctx.getActivePreviewWidget(),
        isSidePanelSheetCollapsedInDom: side => ctx.sideSheetController.isSidePanelSheetCollapsedInDom(side),
        scheduleSnapAndUiRefresh: () => ctx.sideSheetController.scheduleSnapAndUiRefresh(),
        refreshWorkbenchTopBar: () => ctx.refreshWorkbenchTopBar(),
        hideProjectsPanel: () => ctx.hideProjectsPanel(),
        hidePullRequestPanel: () => ctx.pullRequestPanelController.hidePullRequestPanel(),
        toggleProjectsPanel: () => ctx.toggleProjectsPanel(),
        togglePullRequestPanel: () => ctx.pullRequestPanelController.togglePullRequestPanel(),
        openMobileWorkHubLanding: view => ctx.hubNavigation.openMobileWorkHubLanding(view),
        collapseMobileSidePanels: () => ctx.sideSheetController.collapseMobileSidePanels(),
        dismissSheetsAsync: () => ctx.sideSheetController.dismissSheetsAsync(),
        settleMobileSidePanelsCollapsed: () => ctx.sideSheetController.settleMobileSidePanelsCollapsed(),
        onProjectsPanelOpen: project => ctx.onProjectsPanelOpen(project),
        refreshProjectsCount: () => ctx.refreshProjectsCount(),
        toggleMobileAgentSheet: () => ctx.toggleMobileAgentSheet(),
        toggleMobilePreview: () => ctx.toggleMobilePreview(),
        toggleMobileExploreSheet: () => ctx.toggleMobileExploreSheet(),
        openPullRequestPanel: () => ctx.pullRequestPanelController.openPullRequestPanel(),
        executeAndDismiss: commandId => ctx.executeAndDismiss(commandId),
        relayoutMainPreviewWidgets: () => ctx.relayoutMainPreviewWidgets(),
        conversationsStart: () => ctx.conversations.start(),
        inboxStreamStart: () => ctx.inboxStream.start(),
        syncOverlayEdgeSwipeZones: () => ctx.syncOverlayEdgeSwipeZones(),
    };
    ctx.bottomBarController = new MobileShellBottomBarController({
        host: ctx.bottomBarHost,
        shell: ctx.shell,
        statusBar: ctx.statusBar,
        commands: ctx.commands,
        projectsService: ctx.projectsService,
        projectBootstrap: ctx.projectBootstrap,
        mobileMq: ctx.mobileMq,
    });
}

export function onStartExtracted(ctx: MobileOneColumnShellContributionContext, _app: FrontendApplication): void {
    ctx.workHubDiff.setDelegate(ctx);
    ctx.landing.syncFromStorage();
    installMobileWorkHubBootGuard();
    ctx.armBootGuardSafetyTimeout();
    ctx.armAgentsSurfaceWatchdog();
    switch (resolveInitialLandingBodyClass(ctx.mobileMq?.matches === true)) {
        case 'agents':
            ctx.landingLeftThisSession = true;
            document.body.classList.remove('theia-mobile-mod-landing');
            setMobileWorkHubComposerHeaderChrome(true);
            break;
        case 'landing':
            document.body.classList.add('theia-mobile-mod-landing');
            // The landing case sets no composer chrome; recompute so restored IDE side panels
            // start hidden here too (no Explorer flash before the hub overlay mounts).
            recomputeMobileWorkHubHideIdeSidePanels();
            break;
        case 'none':
            setMobileWorkHubComposerHeaderChrome(false);
            break;
    }
    ctx.mobileMq?.addEventListener('change', ctx.onMediaChange);
    window.addEventListener('resize', ctx.onWindowResize);
    window.addEventListener(QAAP_MOBILE_PROJECTS_DISMISS_PANEL_EVENT, ctx.onDismissProjectsPanelEvent);
    window.addEventListener(QAAP_MOBILE_LANDING_HUB_LIST_CHANGED_EVENT, ctx.onLandingHubListChanged);
    ctx.landing.installAuthListener(ctx.toDispose);
    window.addEventListener('beforeunload', ctx.persistWorkHubSurfacePreference);
    ctx.toDispose.push(Disposable.create(() => {
        window.removeEventListener('beforeunload', ctx.persistWorkHubSurfacePreference);
    }));
    if (ctx.mobileMq?.matches || shouldPreferWorkHubAgentsLayout() || shouldBootstrapMobileAgentsChat()) {
        window.requestAnimationFrame(() => ctx.onMediaChange());
    }
    // Root safety + last-resort recovery, wired off 'ready' so they run on EVERY boot regardless
    // of whether the layout was restored (empty or not) or freshly created. See below.
    void ctx.frontendStateService.reachedState('ready').then(async () => {
        ctx.onFrontendReadyEnsureWorkHub();
        try {
            const { handleQaapBillingReturn } = await import('./qaap-billing-return');
            const billingReturn = await handleQaapBillingReturn();
            if (billingReturn.openBilling) {
                await ctx.openWorkHubBillingSheet({ afterCheckout: true });
            }
        } catch (error) {
            console.warn('[qaap-billing] return handler failed', error);
        }
    });
}

export function ensureWorkHubSurfaceMountedAfterReadyExtracted(ctx: MobileOneColumnShellContributionContext): void {
    if (peekPreferDesktopIde() || !ctx.shouldActivateWorkHubLayout()) {
        return;
    }
    if (ctx.isWorkHubSurfacePresentInDom() || ctx.sessionState.agentsBootstrapStarted) {
        return;
    }
    if (!ctx.mobileActive) {
        ctx.enterMobileLayout();
        return;
    }
    ctx.ensureOverlayElements();
    if (!ctx.tryBootstrapMobileAgentsChat()) {
        ctx.ensureMobileProjectsHomeVisible();
    }
    ctx.scheduleSnapAndUiRefresh();
}
