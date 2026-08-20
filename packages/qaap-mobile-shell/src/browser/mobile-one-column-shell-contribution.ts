// @ts-nocheck
// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
import { ScmService } from '@theia/scm/lib/browser/scm-service';
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
import { activateMainPreviewWidgetExtracted, bootstrapMobilePreviewInBackgroundExtracted, ensureMobilePreviewEditorVisibleExtracted, ensureWelcomeInMainAreaExtracted, openMobilePreviewInMainExtracted, relocatePreviewToMainIfNeededExtracted, toggleMobilePreviewExtracted } from './mobile-one-column-shell-contribution-activity2';
import { ensureWorkHubSurfaceMountedAfterReadyExtracted, initBottomBarControllerExtracted, initHubNavigationControllerExtracted, initIdeFallbackControllerExtracted, initLandingControllerExtracted, initOverlayControllerExtracted, initProjectsPanelFactoryExtracted, initPullRequestPanelControllerExtracted, initSideSheetControllerExtracted, initTranscriptChromeControllerExtracted, initWorkHubBootstrapControllerExtracted, onStartExtracted, patchWorkHubBootstrapLandingHostExtracted, setTrackedProjectsPanelExtracted, syncOverlayEdgeSwipeZonesExtracted } from './mobile-one-column-shell-contribution-render2';
import { armAgentsSurfaceWatchdogExtracted, armBootGuardSafetyTimeoutExtracted, armLayoutRecoveryGuardExtracted, ensureDesktopSidePanelSizesExtracted, ensureDesktopWorkHubSessionsSidebarOpenExtracted, ensureMainContentAfterWorkspaceReloadExtracted, ensureOverlayElementsExtracted, enterMobileLayoutExtracted, forceCenterColumnFullWidthExtracted, hasLayoutRecoveryBeenAttemptedExtracted, hideProjectsPanelExtracted, isWorkHubSurfacePresentInDomExtracted, leaveMobileLayoutExtracted, markLayoutRecoveryAttemptedExtracted, onDidInitializeLayoutExtracted, onStopExtracted, recoverEmptyAgentsSurfaceExtracted, refreshProjectsCountExtracted, requestFullShellRelayoutExtracted, restoreDesktopSplitLayoutExtracted, runLayoutRecoveryGuardExtracted, setSidePanelSizeExtracted, shouldActivateMobileLayoutExtracted, teardownMobileUiExtracted } from './mobile-one-column-shell-contribution-streaming2';
import { activateMobileIdeHeaderViewExtracted, closeStaleMainPreviewWidgetExtracted, enforceWorkHubSurfaceIsolationExtracted, executeAndDismissExtracted, findPreviewWidgetExtracted, getActivePreviewWidgetExtracted, isMobileExploreSheetVisibleExtracted, mountSideSheetWidgetExtracted, onCurrentProjectActivatedExtracted, onProjectsPanelOpenExtracted, onProjectsPanelOpenInIdeExtracted, openAgentTaskComposerExtracted, openConversationInWorkHubExtracted, openDesktopIdeExtracted, openProjectScopedDiffViewExtracted, openWorkHubAiConfigurationSheetExtracted, openWorkHubBillingSheetExtracted, openWorkHubPreferencesSheetExtracted, prepareDesktopIdeWorkspaceFromHubExtracted, prepareSideSheetOpenExtracted, refreshWorkbenchTopBarExtracted, registerCommandsExtracted, relayoutMainPreviewWidgetsExtracted, resolveCurrentProjectForAgentExtracted, resolveMobileIdeHeaderViewIdExtracted, toggleMobileAgentSheetExtracted, toggleMobileExploreSheetExtracted, toggleProjectsPanelExtracted } from './mobile-one-column-shell-contribution-timeline2';

export const GETTING_STARTED_WIDGET_COMMAND = 'getting.started.widget';

/** Grace after the frontend reaches 'ready' before the last-resort blank-shell recovery guard runs. */
export const LAYOUT_RECOVERY_GRACE_MS = 2000;

/**
 * Narrow-viewport workbench: full-width editor, side panels as sheets, bottom activity strip,
 * edge swipes and backdrop; main editor tabs in a horizontally scrollable tab row.
 */
@injectable()
export class MobileOneColumnShellContribution implements FrontendApplicationContribution, CommandContribution, QaapWorkHubDiffDelegate {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FrontendApplicationStateService)
    protected readonly frontendStateService: FrontendApplicationStateService;

    @inject(StatusBarImpl)
    protected readonly statusBar: StatusBarImpl;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(ClipboardService)
    protected readonly clipboardService: ClipboardService;

    @inject(MobileProjectsService)
    protected readonly projectsService: MobileProjectsService;

    @inject(QaapDesktopTerminalLayoutContribution)
    protected readonly desktopTerminalLayout: QaapDesktopTerminalLayoutContribution;

    @inject(MobileProjectsActiveTasks)
    protected readonly activeTasks: MobileProjectsActiveTasks;

    @inject(QaapBackgroundContextProvider)
    protected readonly backgroundContext: QaapBackgroundContextProvider;

    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;

    @inject(MobileWorkHubInboxStream)
    protected readonly inboxStream: MobileWorkHubInboxStream;

    @inject(MobileProjectsConversationFlags)
    protected readonly conversationFlags: MobileProjectsConversationFlags;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileUploadService)
    protected readonly fileUploadService: FileUploadService;

    @inject(MobileProjectsReadmeContribution)
    protected readonly projectsReadme: MobileProjectsReadmeContribution;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ScmService)
    protected readonly scmService: ScmService;

    @inject(ChatService)
    protected readonly chatService: ChatService;

    @inject(AIVariableService)
    protected readonly variableService: AIVariableService;

    @inject(SkillService)
    protected readonly skillService: SkillService;

    @inject(PromptService)
    protected readonly promptService: PromptService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(ChatAgentService)
    protected readonly chatAgentService: ChatAgentService;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(QaapAppearanceModeService)
    protected readonly appearanceModeService: QaapAppearanceModeService;

    @inject(MCPFrontendService) @optional()
    protected readonly mcpFrontendService?: MCPFrontendService;

    @inject(FrontendLanguageModelRegistry) @optional()
    protected readonly languageModelRegistry?: FrontendLanguageModelRegistry;

    @inject(MobileProjectChatViewWidgetFactory)
    protected readonly mobileProjectChatViewWidgetFactory: MobileProjectChatViewWidgetFactory;

    @inject(QaapWorkHubDiffService)
    protected readonly workHubDiff: QaapWorkHubDiffService;

    @inject(QaapCommitMessageAi) @optional()
    protected readonly commitMessageAi?: QaapCommitMessageAi;

    @inject(QaapComposerPromptImprover) @optional()
    protected readonly composerPromptImprover?: QaapComposerPromptImprover;

    @inject(QaapComposerEditorContextService)
    protected readonly composerEditorContextService: QaapComposerEditorContextService;

    @inject(QaapWorkHubComposerPromptService)
    protected readonly composerPromptService: QaapWorkHubComposerPromptService;

    @inject(QaapProjectBootstrapService)
    protected readonly projectBootstrap: QaapProjectBootstrapService;

    @inject(QaapAgentFinishedToastContribution)
    protected readonly agentFinishedToast: QaapAgentFinishedToastContribution;

    @inject(QaapWorkHubProjectSkillRoots)
    protected readonly workHubProjectSkillRoots: QaapWorkHubProjectSkillRoots;

    @inject(QaapAgUiFrontendToolService) @optional()
    protected readonly agUiFrontendTools?: QaapAgUiFrontendToolService;

    @inject(QaapMiniBrowserOpenHandler)
    protected readonly miniBrowserOpenHandler: QaapMiniBrowserOpenHandler;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(MonacoEditorProvider)
    protected readonly monacoEditorProvider: MonacoEditorProvider;

    @inject(LabelProvider)
    protected readonly labelProvider: LabelProvider;

    @inject(DecorationsService)
    protected readonly decorationsService: DecorationsService;

    @inject(ColorRegistry)
    protected readonly colorRegistry: ColorRegistry;

    @inject(MarkdownPreviewHandler)
    protected readonly markdownPreviewHandler: MarkdownPreviewHandler;

    @inject(QaapPreviewSurfaceRegistry)
    protected readonly previewSurfaceRegistry: QaapPreviewSurfaceRegistry;

    @inject(ElementInspectorService)
    protected readonly elementInspectorService: ElementInspectorService;

    @inject(TerminalService)
    protected readonly terminalService: TerminalService;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    @inject(AIConfigurationSelectionService)
    protected readonly aiConfigurationSelectionService: AIConfigurationSelectionService;

    protected readonly toDispose = new DisposableCollection();
    protected readonly mobileMq: MediaQueryList | undefined =
        typeof window !== 'undefined' ? window.matchMedia(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY) : undefined;

    protected bottomBarController!: MobileShellBottomBarController;
    private bottomBarHost!: MobileShellBottomBarHost;
    protected overlayController!: MobileShellOverlayHostController;
    private overlayHost!: MobileShellOverlayHost;
    protected sideSheetController!: MobileShellSideSheetController;
    private sideSheetHost!: MobileShellSideSheetHost;
    protected workHubBootstrap!: MobileShellWorkHubBootstrapController;
    private workHubBootstrapHost!: MobileShellWorkHubBootstrapHost;
    protected ideFallback!: MobileShellIdeFallbackController;
    private ideFallbackHost!: MobileShellIdeFallbackHost;
    protected hubNavigation!: MobileShellHubNavigationController;
    private hubNavigationHost!: MobileShellHubNavigationHost;
    protected pullRequestPanelController!: MobileShellPullRequestPanelController;
    private pullRequestPanelHost!: MobileShellPullRequestPanelHost;
    protected transcriptChrome!: MobileShellTranscriptChromeController;
    private transcriptChromeHost!: MobileShellTranscriptChromeHost;
    protected projectsPanelFactory!: MobileProjectsPanelFactory;
    protected readonly sessionState = new MobileShellSessionState();
    protected get bottomBar(): HTMLElement | undefined { return this.bottomBarController.getBottomBarNode(); }
    protected mobileActive = false;
    protected projectsPanel: MobileProjectsPanel | undefined;
    protected projectsPanelTrack: Disposable | undefined;
    protected agentTaskComposer: MobileAgentTaskComposer | undefined;
    protected workHubPreferencesSheet: MobileWorkHubPreferencesSheet | undefined;
    protected workHubBillingSheet: MobileWorkHubBillingSheet | undefined;
    protected workHubAiConfigurationSheet: MobileWorkHubAiConfigurationSheet | undefined;
    protected projectsCount = 0;
    protected landing!: MobileShellLandingController;
    private landingHost!: MobileShellLandingHost;
    /**
     * True once the user has actively left the mobile landing (Projects panel) in this session,
     * either by opening a workspace from the dashboard or by tapping Focus on the active project.
     * Subsequent re-opens of the Projects view are sheet-style.
     */
    protected get landingLeftThisSession(): boolean {
        return this.sessionState.landingLeftThisSession;
    }
    protected set landingLeftThisSession(value: boolean) {
        this.sessionState.landingLeftThisSession = value;
    }
    protected get transcriptOpenedFromWorkHubLanding(): boolean {
        return this.sessionState.transcriptOpenedFromWorkHubLanding;
    }
    protected set transcriptOpenedFromWorkHubLanding(value: boolean) {
        this.sessionState.transcriptOpenedFromWorkHubLanding = value;
    }

    protected readonly onDismissProjectsPanelEvent = (): void => {
        this.onProjectsWorkspaceOpened();
    };

    protected readonly onLandingHubListChanged = (): void => {
        this.refreshBottomBar();
        this.scheduleSnapAndUiRefresh();
    };

    protected setTrackedProjectsPanel(panel: MobileProjectsPanel | undefined): void {
        setTrackedProjectsPanelExtracted(this, panel);
    }

    @postConstruct()
    protected initLandingController(): void {
        initLandingControllerExtracted(this);
    }

    protected initProjectsPanelFactory(): void {
        initProjectsPanelFactoryExtracted(this);
    }

    protected initTranscriptChromeController(): void {
        initTranscriptChromeControllerExtracted(this);
    }

    protected initPullRequestPanelController(): void {
        initPullRequestPanelControllerExtracted(this);
    }

    protected initHubNavigationController(): void {
        initHubNavigationControllerExtracted(this);
    }

    protected patchWorkHubBootstrapLandingHost(): void {
        patchWorkHubBootstrapLandingHostExtracted(this);
    }

    protected initSideSheetController(): void {
        initSideSheetControllerExtracted(this);
    }

    protected initOverlayController(): void {
        initOverlayControllerExtracted(this);
    }

    protected syncOverlayEdgeSwipeZones(): void {
        syncOverlayEdgeSwipeZonesExtracted(this);
    }

    protected initIdeFallbackController(): void {
        initIdeFallbackControllerExtracted(this);
    }

    protected initWorkHubBootstrapController(): void {
        initWorkHubBootstrapControllerExtracted(this);
    }

    protected initBottomBarController(): void {
        initBottomBarControllerExtracted(this);
    }

    onStart(_app: FrontendApplication): void {
        this.toDispose.push(this.editorManager.onCreated(() => {
            // The classic IDE may asynchronously restore the Welcome widget while the first
            // editor is opening. Do not let that background activation steal focus from the
            // editor the user explicitly opened.
            if (!peekPreferDesktopIde()) {
                return;
            }
            const welcome = this.shell.getWidgetById(GETTING_STARTED_WIDGET_COMMAND);
            if (welcome && this.shell.activeWidget === welcome) {
                void this.shell.closeWidget(welcome.id, { save: false });
            }
        }));
        onStartExtracted(this, _app);
    }

    /**
     * Runs once the frontend reaches 'ready'. `onDidInitializeLayout` fires earlier (state
     * 'initialized_layout') and its async Work Hub mount can silently fail to land when a
     * valid-but-empty persisted layout is restored: `FrontendApplication.initializeLayout` takes the
     * `restoreLayout() === true` branch and skips `createDefaultLayout()` (and every fresh-only
     * `initializeLayout` contribution hook), so the shell restores to a genuinely empty main area and
     * no watchdog can recover a hub root that was never inserted. This guarantees a mount attempt at
     * a point where all async preconditions (workspace ready, 'ready' state) are already satisfied,
     * then arms the last-resort blank-shell recovery.
     */
    protected onFrontendReadyEnsureWorkHub(): void {
        this.ensureWorkHubSurfaceMountedAfterReady();
        this.armLayoutRecoveryGuard();
    }

    protected ensureWorkHubSurfaceMountedAfterReady(): void {
        ensureWorkHubSurfaceMountedAfterReadyExtracted(this);
    }

    protected isWorkHubSurfacePresentInDom(): boolean {
        return isWorkHubSurfacePresentInDomExtracted(this);
    }

    protected armLayoutRecoveryGuard(): void {
        armLayoutRecoveryGuardExtracted(this);
    }

    protected async runLayoutRecoveryGuard(): Promise<void> {
        return runLayoutRecoveryGuardExtracted(this);
    }

    protected hasLayoutRecoveryBeenAttempted(): boolean {
        return hasLayoutRecoveryBeenAttemptedExtracted(this);
    }

    protected markLayoutRecoveryAttempted(): void {
        markLayoutRecoveryAttemptedExtracted(this);
    }

    protected armAgentsSurfaceWatchdog(): void {
        armAgentsSurfaceWatchdogExtracted(this);
    }

    protected recoverEmptyAgentsSurface(): void {
        recoverEmptyAgentsSurfaceExtracted(this);
    }

    protected armBootGuardSafetyTimeout(): void {
        armBootGuardSafetyTimeoutExtracted(this);
    }

    /** Persist Agents surface choice so reload / wide viewport does not fall back to the IDE. */
    protected readonly persistWorkHubSurfacePreference = (): void => {
        if (peekPreferDesktopIde() || !this.workspaceService.opened || this.landing.isProjectsLandingSession()) {
            return;
        }
        if (this.mobileActive || document.body.classList.contains('theia-mobile-mod-workhub-composer-header')) {
            markPreferAgentsSurface();
        }
    };

    onDidInitializeLayout(app: FrontendApplication): void {
        onDidInitializeLayoutExtracted(this, app);
    }

    protected readonly onMediaChange = (): void => {
        this.workHubBootstrap.persistAgentsSurfaceForActiveSession();
        if (this.shouldActivateMobileLayout()) {
            this.enterMobileLayout();
        } else {
            this.leaveMobileLayout();
        }
        // The sessions sidebar can stay open while the window crosses the breakpoint. Reconcile
        // its mount point after the mobile shell transition so it cannot remain over the content.
        this.projectsPanel?.syncSessionsSidebarLayout();
    };

    onStop(_app: FrontendApplication): void {
        onStopExtracted(this, _app);
    }

    protected shouldActivateMobileLayout(): boolean {
        return shouldActivateMobileLayoutExtracted(this);
    }

    /** Agents / Work Hub surface — not when the user explicitly chose the classic IDE. */
    protected shouldActivateWorkHubLayout(): boolean {
        return this.shouldActivateMobileLayout() && !peekPreferDesktopIde();
    }

    protected resizeRaf = 0;
    protected readonly onWindowResize = (): void => {
        // Throttle via rAF: resize fires dozens of times/sec on mobile rotation/viewport
        // adjustments; coalescing to one layout pass per frame avoids reflow storms.
        if (this.resizeRaf) {
            return;
        }
        this.resizeRaf = window.requestAnimationFrame(() => {
            this.resizeRaf = 0;
            this.onMediaChange();
        });
    };

    protected ensureShellHooks(shell: ApplicationShell): void {
        this.sideSheetController.ensureShellHooks(shell, this.toDispose);
    }

    /** Bottom panel is visible with at least one widget (matches Projects “open” semantics for the bar). */
    protected isTerminalBottomPanelOpen(): boolean {
        return this.bottomBarController.isTerminalBottomPanelOpen();
    }

    /** Bottom terminal area is shown (may still be mid expand animation). */
    protected isMobileBottomTerminalVisible(): boolean {
        return this.bottomBarController.isMobileBottomTerminalVisible();
    }

    protected getBottomPanelPendingUpdate(): Promise<void> {
        return this.bottomBarController.getBottomPanelPendingUpdate();
    }

    /** Work Hub landing is active — user has not opened/focused a project in this session yet. */
    protected isProjectsLandingSession(): boolean {
        return this.landing.isProjectsLandingSession();
    }

    protected enterMobileLayout(): void {
        enterMobileLayoutExtracted(this);
    }

    protected leaveMobileLayout(): void {
        leaveMobileLayoutExtracted(this);
    }

    protected async ensureDesktopSidePanelSizes(): Promise<void> {
        return ensureDesktopSidePanelSizesExtracted(this);
    }

    protected async setSidePanelSize(side: 'left' | 'right', size: number): Promise<void> {
        return setSidePanelSizeExtracted(this, side, size);
    }

    protected restoreDesktopSplitLayout(): void {
        restoreDesktopSplitLayoutExtracted(this);
    }

    protected forceCenterColumnFullWidth(): void {
        forceCenterColumnFullWidthExtracted(this);
    }

    protected getBottomAreaSplitPanel(): SplitPanel | undefined {
        return this.bottomBarController.getBottomAreaSplitPanel();
    }

    protected measureMobileBottomPanelHeightPx(): number | undefined {
        return this.bottomBarController.measureMobileBottomPanelHeightPx();
    }

    protected resolveMobileBottomSplitSizes(): [number, number] {
        return this.bottomBarController.resolveMobileBottomSplitSizes();
    }

    protected syncMobileBottomSplit(): void {
        this.bottomBarController.syncMobileBottomSplit();
    }

    protected async applyMobileBottomPanelMaximizedSize(): Promise<void> {
        return this.bottomBarController.applyMobileBottomPanelMaximizedSize();
    }

    protected restoreMobileBottomPanelFromMaximized(): void {
        this.bottomBarController.restoreMobileBottomPanelFromMaximized();
    }

    protected getMaximizedOverlayElement(): HTMLElement | undefined {
        return this.bottomBarController.getMaximizedOverlayElement();
    }

    protected syncMobileMaximizedOverlayInsets(): void {
        this.bottomBarController.syncMobileMaximizedOverlayInsets();
    }

    protected clearMobileMaximizedOverlayInsets(): void {
        this.bottomBarController.clearMobileMaximizedOverlayInsets();
    }

    protected updateMobileShellStateClasses(): void {
        this.bottomBarController.updateMobileShellStateClasses();
    }

    protected requestFullShellRelayout(): void {
        requestFullShellRelayoutExtracted(this);
    }

    protected teardownMobileUi(preserveProjectsLanding = false): void {
        teardownMobileUiExtracted(this, preserveProjectsLanding);
    }

    protected ensureOverlayElements(): void {
        ensureOverlayElementsExtracted(this);
    }

    protected cancelAgentsBootstrap(): void {
        this.workHubBootstrap.cancelAgentsBootstrap();
    }

    protected disposeProjectsPanelForDesktopIde(): void {
        this.ideFallback?.disposeProjectsPanelForDesktopIde();
    }

    protected tryBootstrapMobileAgentsChat(): boolean {
        return this.workHubBootstrap.tryBootstrapMobileAgentsChat();
    }

    protected async restoreAgentsSurfaceAfterReload(): Promise<void> {
        return this.workHubBootstrap.restoreAgentsSurfaceAfterReload();
    }

    protected ensureMobileProjectsHomeVisible(): void {
        this.workHubBootstrap.ensureMobileProjectsHomeVisible();
    }

    protected async ensureMainContentAfterWorkspaceReload(): Promise<void> {
        return ensureMainContentAfterWorkspaceReloadExtracted(this);
    }

    protected ensureProjectsPanel(forceHomeMode?: boolean): void {
        this.workHubBootstrap.ensureProjectsPanel(forceHomeMode);
    }

    protected createProjectsPanel(homeMode: boolean): MobileProjectsPanel {
        return this.projectsPanelFactory.create(homeMode);
    }

    protected ensureDesktopWorkHubSessionsSidebarOpen(): void {
        ensureDesktopWorkHubSessionsSidebarOpenExtracted(this);
    }

    /** Remove every PR overlay node under the app shell (fixes stacked sheets after re-open). */
    protected removeAllMobilePrPanelsFromShell(): void {
        this.pullRequestPanelController.removeAllMobilePrPanelsFromShell();
    }

    protected isPullRequestPanelShown(): boolean {
        return this.pullRequestPanelController.isPullRequestPanelShown();
    }

    protected disposePullRequestPanel(): void {
        this.pullRequestPanelController.disposePullRequestPanel();
    }

    protected openPullRequestPanel(): void {
        this.pullRequestPanelController.openPullRequestPanel();
    }

    protected async openPullRequestFromInbox(pullRequest: QaapGithubPullRequestSummary): Promise<void> {
        return this.pullRequestPanelController.openPullRequestFromInbox(pullRequest);
    }

    protected async refreshProjectsCount(): Promise<void> {
        return refreshProjectsCountExtracted(this);
    }

    protected hideProjectsPanel(): void {
        hideProjectsPanelExtracted(this);
    }

    protected hidePullRequestPanel(): void {
        this.pullRequestPanelController.hidePullRequestPanel();
    }

    registerCommands(registry: CommandRegistry): void {
        registerCommandsExtracted(this, registry);
    }

    protected async openDesktopIde(): Promise<void> {
        return openDesktopIdeExtracted(this);
    }

    protected async prepareDesktopIdeWorkspaceFromHub(selectedProjectId?: string): Promise<boolean> {
        return prepareDesktopIdeWorkspaceFromHubExtracted(this, selectedProjectId);
    }

    /** IDE | Agents switch from classic IDE — restore the Agents execution shell. */
    protected returnToAgentsFromDesktopIde(): void {
        this.ideFallback?.returnToAgentsFromDesktopIde();
    }

    protected toggleWorkHubSessionsSidebar(): void {
        this.ensureProjectsPanel();
        this.projectsPanel?.toggleWorkHubSessionsSidebar();
    }

    protected onEnterActiveTranscript(): void {
        this.transcriptChrome.onEnterActiveTranscript();
    }

    protected enforceWorkHubSurfaceIsolation(): void {
        enforceWorkHubSurfaceIsolationExtracted(this);
    }

    protected async onExitActiveTranscript(): Promise<void> {
        return this.transcriptChrome.onExitActiveTranscript();
    }

    protected async openAgentTaskComposer(project: MobileProjectEntry): Promise<void> {
        return openAgentTaskComposerExtracted(this, project);
    }

    protected async openWorkHubPreferencesSheet(query?: string): Promise<void> {
        return openWorkHubPreferencesSheetExtracted(this, query);
    }

    protected async openWorkHubBillingSheet(): Promise<void> {
        return openWorkHubBillingSheetExtracted(this);
    }

    protected async openWorkHubAiConfigurationSheet(tabId?: string): Promise<void> {
        return openWorkHubAiConfigurationSheetExtracted(this, tabId);
    }

    protected async toggleProjectsPanel(): Promise<void> {
        return toggleProjectsPanelExtracted(this);
    }

    protected async showMobileProjectsHome(preferredHubView?: MobileProjectsHubView): Promise<void> {
        return this.workHubBootstrap.showMobileProjectsHome(preferredHubView);
    }

    /**
     * Abre el Work Hub a pantalla completa y selecciona una pestaña del landing (Home, Agents, Routines).
     */
    protected dismissMobileAgentTranscriptOverlays(): void {
        this.hubNavigation.dismissMobileAgentTranscriptOverlays();
    }

    protected isMobileWorkHubLandingVisible(): boolean {
        return this.hubNavigation.isMobileWorkHubLandingVisible();
    }

    protected syncHubLandingNavigation(view: MobileProjectsHubView): boolean {
        return this.hubNavigation.syncHubLandingNavigation(view);
    }

    protected async finalizeHubLandingNavigation(): Promise<void> {
        return this.hubNavigation.finalizeHubLandingNavigation();
    }

    protected async openMobileWorkHubLanding(view: MobileProjectsHubView): Promise<void> {
        return this.hubNavigation.openMobileWorkHubLanding(view);
    }

    protected async togglePullRequestPanel(): Promise<void> {
        return this.pullRequestPanelController.togglePullRequestPanel();
    }

    protected async onProjectsPanelOpen(project: MobileProjectEntry): Promise<void> {
        return onProjectsPanelOpenExtracted(this, project);
    }

    protected async onProjectsPanelOpenInIde(project: MobileProjectEntry): Promise<void> {
        return onProjectsPanelOpenInIdeExtracted(this, project);
    }

    /**
     * After clone/create/open, keep Work Hub Agents mounted. Disposing the home panel here left
     * an empty IDE shell (collapsed main area + hide-ide CSS) with only snackbars visible.
     */
    protected onProjectsWorkspaceOpened(): void {
        this.landing.retainAgentsHubAfterWorkspaceOpen();
        this.scheduleSnapAndUiRefresh();
    }

    protected async onCurrentProjectActivated(): Promise<void> {
        return onCurrentProjectActivatedExtracted(this);
    }

    protected ensureBottomChromeHost(): HTMLElement {
        return this.bottomBarController.ensureBottomChromeHost();
    }

    protected pinBottomChromeToBody(): void {
        this.bottomBarController.pinBottomChromeToBody();
    }

    protected installBottomChromeTouchScroll(): void {
        this.bottomBarController.installBottomChromeTouchScroll();
    }

    protected unpinBottomChromeFromBody(): void {
        this.bottomBarController.unpinBottomChromeFromBody();
    }

    protected detachBottomBarFromShell(): void {
        this.bottomBarController.detachBottomBarFromShell();
    }

    protected async dismissMobileSideSheets(): Promise<void> {
        return this.sideSheetController.dismissMobileSideSheets();
    }

    protected scheduleSnapAndUiRefresh(): void {
        this.sideSheetController.scheduleSnapAndUiRefresh();
    }

    /** Pause mini-browser dev-server iframes while Work Hub is foreground (avoids Vite HMR console noise). */
    protected syncIdeMiniBrowserPreviewSuspension(): void {
        const userViewingIdePreview = peekPreferDesktopIde() && !!this.getActivePreviewWidget();
        syncQaapMiniBrowserPreviewSuspension(this.shell, userViewingIdePreview);
    }

    protected async prepareSideSheetOpen(side: 'left' | 'right'): Promise<void> {
        return prepareSideSheetOpenExtracted(this, side);
    }

    protected async mountSideSheetWidget(side: 'left' | 'right', widgetId: string): Promise<void> {
        return mountSideSheetWidgetExtracted(this, side, widgetId);
    }

    protected isWorkHubLandingBottomBar(): boolean {
        return this.bottomBarController.isWorkHubLandingBottomBar();
    }

    protected isMobileWorkspaceHubPrimaryBottomBar(): boolean {
        return this.bottomBarController.isMobileWorkspaceHubPrimaryBottomBar();
    }

    protected isMainAgentSurfaceEmpty(): boolean {
        return this.bottomBarController.isMainAgentSurfaceEmpty();
    }

    protected syncMobileHubPrimaryBottomChrome(): void {
        this.bottomBarController.syncMobileHubPrimaryBottomChrome();
    }

    protected getWorkHubLandingBottomButtons(): MobileBottomButton[] {
        return this.bottomBarController.getWorkHubLandingBottomButtons();
    }

    async openConversationInWorkHub(conversationId: string, cwd?: string): Promise<void> {
        return openConversationInWorkHubExtracted(this, conversationId, cwd);
    }

    protected async openProjectScopedDiffView(projectId?: string): Promise<void> {
        return openProjectScopedDiffViewExtracted(this, projectId);
    }

    protected getMobileBottomButtons(): MobileBottomButton[] {
        return this.bottomBarController.getMobileBottomButtons();
    }

    protected isMobileBottomButtonActive(id: MobileBottomButtonId): boolean {
        return this.bottomBarController.isMobileBottomButtonActive(id);
    }

    protected canToggleTerminalBottomPanel(): boolean {
        return this.bottomBarController.canToggleTerminalBottomPanel();
    }

    protected async toggleTerminalBottomPanel(): Promise<void> {
        return this.bottomBarController.toggleTerminalBottomPanel();
    }

    protected refreshWorkbenchTopBar(): void {
        refreshWorkbenchTopBarExtracted(this);
    }

    protected refreshBottomBar(): void {
        this.bottomBarController.refreshBottomBar();
    }

    protected createMobileBottomButton(def: MobileBottomButton): HTMLButtonElement {
        return this.bottomBarController.createMobileBottomButton(def);
    }

    protected installBottomBarLongPress(btn: HTMLButtonElement, def: MobileBottomButton): void {
        this.bottomBarController.installBottomBarLongPress(btn, def);
    }

    protected async showBottomBarSecondaryMenu(anchor: HTMLElement, def: MobileBottomButton): Promise<void> {
        return this.bottomBarController.showBottomBarSecondaryMenu(anchor, def);
    }

    protected removeBottomBarSecondaryMenu(): void {
        this.bottomBarController.removeBottomBarSecondaryMenu();
    }

    protected async getBottomBarSecondaryItems(def: MobileBottomButton): Promise<BottomBarSecondaryItem[]> {
        return this.bottomBarController.getBottomBarSecondaryItems(def);
    }

    protected async getProjectsSecondaryItems(): Promise<BottomBarSecondaryItem[]> {
        return this.bottomBarController.getProjectsSecondaryItems();
    }

    protected getTerminalSecondaryItems(): BottomBarSecondaryItem[] {
        return this.bottomBarController.getTerminalSecondaryItems();
    }

    protected getAgentSecondaryItems(): BottomBarSecondaryItem[] {
        return this.bottomBarController.getAgentSecondaryItems();
    }

    protected getPullRequestSecondaryItems(): BottomBarSecondaryItem[] {
        return this.bottomBarController.getPullRequestSecondaryItems();
    }

    protected getPreviewSecondaryItems(): BottomBarSecondaryItem[] {
        return this.bottomBarController.getPreviewSecondaryItems();
    }

    protected getExploreSecondaryItems(): BottomBarSecondaryItem[] {
        return this.bottomBarController.getExploreSecondaryItems();
    }

    protected async executeAndDismiss(commandId: string): Promise<void> {
        return executeAndDismissExtracted(this, commandId);
    }

    protected async onMobileBottomButtonClick(def: MobileBottomButton, btn: HTMLButtonElement): Promise<void> {
        return this.bottomBarController.onMobileBottomButtonClick(def, btn);
    }

    protected resolveMobileIdeHeaderViewId(): MobileBottomButtonId {
        return resolveMobileIdeHeaderViewIdExtracted(this);
    }

    protected async activateMobileIdeHeaderView(id: MobileBottomButtonId): Promise<void> {
        return activateMobileIdeHeaderViewExtracted(this, id);
    }

    protected relayoutMainPreviewWidgets(): void {
        relayoutMainPreviewWidgetsExtracted(this);
    }

    protected async toggleMobileAgentSheet(): Promise<void> {
        return toggleMobileAgentSheetExtracted(this);
    }

    protected isMobileAgentSheetVisible(): boolean {
        return this.shell.isExpanded('right') && !this.sideSheetController.isSidePanelSheetCollapsedInDom('right');
    }

    protected async resolveCurrentProjectForAgent(): Promise<MobileProjectEntry | undefined> {
        return resolveCurrentProjectForAgentExtracted(this);
    }

    protected async toggleMobileExploreSheet(): Promise<void> {
        return toggleMobileExploreSheetExtracted(this);
    }

    protected isMobileExploreSheetVisible(): boolean {
        return isMobileExploreSheetVisibleExtracted(this);
    }

    protected getActivePreviewWidget(): LuminoWidget | undefined {
        return getActivePreviewWidgetExtracted(this);
    }

    protected findPreviewWidget(): LuminoWidget | undefined {
        return findPreviewWidgetExtracted(this);
    }

    protected getMainPreviewWidget(): LuminoWidget | undefined {
        return this.shell.getWidgets('main').find(widget => isMiniBrowserPreviewWidgetId(widget.id));
    }

    /** True when the preview tab has mini-browser chrome (not a layout-restore shell with no content). */
    protected isMainPreviewWidgetLive(preview: LuminoWidget): boolean {
        return isMainPreviewWidgetLiveHelper(preview);
    }

    protected async closeStaleMainPreviewWidget(): Promise<void> {
        return closeStaleMainPreviewWidgetExtracted(this);
    }

    protected ensureMobilePreviewEditorVisible(): void {
        ensureMobilePreviewEditorVisibleExtracted(this);
    }

    protected async activateMainPreviewWidget(): Promise<boolean> {
        return activateMainPreviewWidgetExtracted(this);
    }

    protected async relocatePreviewToMainIfNeeded(): Promise<void> {
        return relocatePreviewToMainIfNeededExtracted(this);
    }

    protected async toggleMobilePreview(): Promise<void> {
        return toggleMobilePreviewExtracted(this);
    }

    protected async bootstrapMobilePreviewInBackground(): Promise<void> {
        return bootstrapMobilePreviewInBackgroundExtracted(this);
    }

    protected async openMobilePreviewInMain(): Promise<void> {
        return openMobilePreviewInMainExtracted(this);
    }

    /**
     * Open a side sheet and show a view without `toggle` semantics (which would collapse an
     * already-active panel — the usual failure mode for Agent on mobile).
     */
    protected async openMobileSideSheet(side: 'left' | 'right', widgetId: string): Promise<void> {
        return this.sideSheetController.openMobileSideSheet(side, widgetId);
    }

    protected shouldDismissSheetsForButton(id: MobileBottomButtonId): boolean {
        return this.bottomBarController.shouldDismissSheetsForButton(id);
    }

    /** Collapse expanded side sheets and await layout so follow-up UI (e.g. quick input) is stable. */
    protected async dismissSheetsAsync(): Promise<void> {
        return this.sideSheetController.dismissSheetsAsync();
    }

    protected async collapseMobileSideSheets(): Promise<void> {
        return this.sideSheetController.collapseMobileSideSheets();
    }

    protected async collapseMobileSidePanels(): Promise<void> {
        return this.sideSheetController.collapseMobileSidePanels();
    }

    protected settleMobileSidePanelsCollapsed(): void {
        this.sideSheetController.settleMobileSidePanelsCollapsed();
    }

    protected isSidePanelSheetCollapsedInDom(side: 'left' | 'right'): boolean {
        return this.sideSheetController.isSidePanelSheetCollapsedInDom(side);
    }

    protected isAnyMobileSideSheetVisible(): boolean {
        return this.sideSheetController.isAnyMobileSideSheetVisible();
    }

    protected async ensureWelcomeInMainArea(): Promise<void> {
        return ensureWelcomeInMainAreaExtracted(this);
    }

}
