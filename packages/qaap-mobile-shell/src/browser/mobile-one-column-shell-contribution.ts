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
import { SplitPanel, Widget as LuminoWidget } from '@lumino/widgets';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
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
    MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY,
} from '@theia/core/lib/browser/shell/mobile-layout-state';
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
import { ScmService } from '@theia/scm/lib/browser/scm-service';
import { MobileProjectsReadmeContribution } from './mobile-projects-readme-contribution';
import { MobileProjectEntry, type MobileProjectsHubView } from './mobile-projects-types';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { ElementInspectorService } from '@theia/qaap-element-inspector/lib/browser/element-inspector-service';
import { MobileAgentTaskComposer } from './mobile-agent-task-composer';
import { MobileWorkHubPreferencesSheet } from './mobile-work-hub-preferences-sheet';
import { MobileWorkHubBillingSheet } from './mobile-work-hub-billing-sheet';
import { MCPFrontendService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import {
    markPreferAgentsSurface,
    peekPreferDesktopIde,
} from './mobile-projects-open';
import { QaapMiniBrowserOpenHandler } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-open-handler';
import { syncQaapMiniBrowserPreviewSuspension } from '@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QaapAgentFinishedToastContribution } from './qaap-agent-finished-toast-contribution';
import { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';
import { QaapAgUiFrontendToolService } from './qaap-ag-ui-frontend-tool-service';
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
    BottomBarSecondaryItem,
    isMiniBrowserPreviewWidgetId,
    MobileBottomButton,
    MobileBottomButtonId,
} from './mobile-shell-bottom-bar-widget';
import { isMainPreviewWidgetLive as isMainPreviewWidgetLiveHelper } from './mobile-one-column-shell-helpers';
import { activateMainPreviewWidgetExtracted, bootstrapMobilePreviewInBackgroundExtracted, ensureMobilePreviewEditorVisibleExtracted, ensureWelcomeInMainAreaExtracted, openMobilePreviewInMainExtracted, relocatePreviewToMainIfNeededExtracted, toggleMobilePreviewExtracted } from './mobile-one-column-shell-contribution-activity';
import { ensureWorkHubSurfaceMountedAfterReadyExtracted, initBottomBarControllerExtracted, initLandingControllerExtracted, initHubNavigationControllerExtracted, initIdeFallbackControllerExtracted, initOverlayControllerExtracted, initProjectsPanelFactoryExtracted, initPullRequestPanelControllerExtracted, initSideSheetControllerExtracted, initTranscriptChromeControllerExtracted, initWorkHubBootstrapControllerExtracted, onStartExtracted, patchWorkHubBootstrapLandingHostExtracted, setTrackedProjectsPanelExtracted, syncOverlayEdgeSwipeZonesExtracted } from './mobile-one-column-shell-contribution-render';
import { armAgentsSurfaceWatchdogExtracted, armBootGuardSafetyTimeoutExtracted, armLayoutRecoveryGuardExtracted, ensureDesktopSidePanelSizesExtracted, ensureDesktopWorkHubSessionsSidebarOpenExtracted, ensureMainContentAfterWorkspaceReloadExtracted, ensureOverlayElementsExtracted, enterMobileLayoutExtracted, forceCenterColumnFullWidthExtracted, hasLayoutRecoveryBeenAttemptedExtracted, hideProjectsPanelExtracted, isWorkHubSurfacePresentInDomExtracted, leaveMobileLayoutExtracted, markLayoutRecoveryAttemptedExtracted, onDidInitializeLayoutExtracted, onStopExtracted, recoverEmptyAgentsSurfaceExtracted, refreshProjectsCountExtracted, requestFullShellRelayoutExtracted, restoreDesktopSplitLayoutExtracted, runLayoutRecoveryGuardExtracted, setSidePanelSizeExtracted, shouldActivateMobileLayoutExtracted, teardownMobileUiExtracted } from './mobile-one-column-shell-contribution-streaming';
import { activateMobileIdeHeaderViewExtracted, closeStaleMainPreviewWidgetExtracted, enforceWorkHubSurfaceIsolationExtracted, executeAndDismissExtracted, findPreviewWidgetExtracted, getActivePreviewWidgetExtracted, isMobileExploreSheetVisibleExtracted, mountSideSheetWidgetExtracted, onCurrentProjectActivatedExtracted, onProjectsPanelOpenExtracted, onProjectsPanelOpenInIdeExtracted, openAgentTaskComposerExtracted, openConversationInWorkHubExtracted, openDesktopIdeExtracted, openWorkHubAiConfigurationSheetExtracted, openWorkHubBillingSheetExtracted, openWorkHubPreferencesSheetExtracted, prepareDesktopIdeWorkspaceFromHubExtracted, prepareSideSheetOpenExtracted, refreshWorkbenchTopBarExtracted, registerCommandsExtracted, relayoutMainPreviewWidgetsExtracted, resolveCurrentProjectForAgentExtracted, resolveMobileIdeHeaderViewIdExtracted, toggleMobileAgentSheetExtracted, toggleMobileExploreSheetExtracted, toggleProjectsPanelExtracted } from './mobile-one-column-shell-contribution-timeline';

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
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly shell: ApplicationShell;

    @inject(FrontendApplicationStateService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly frontendStateService: FrontendApplicationStateService;

    @inject(StatusBarImpl)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly statusBar: StatusBarImpl;

    @inject(CommandRegistry)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly commands: CommandRegistry;

    @inject(MessageService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly messageService: MessageService;

    @inject(ClipboardService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly clipboardService: ClipboardService;

    @inject(MobileProjectsService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly projectsService: MobileProjectsService;

    @inject(QaapDesktopTerminalLayoutContribution)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly desktopTerminalLayout: QaapDesktopTerminalLayoutContribution;

    @inject(MobileProjectsActiveTasks)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly activeTasks: MobileProjectsActiveTasks;

    @inject(QaapBackgroundContextProvider)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly backgroundContext: QaapBackgroundContextProvider;

    @inject(MobileProjectsConversations)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly conversations: MobileProjectsConversations;

    @inject(MobileWorkHubInboxStream)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly inboxStream: MobileWorkHubInboxStream;

    @inject(MobileProjectsConversationFlags)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly conversationFlags: MobileProjectsConversationFlags;

    @inject(WorkspaceService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly workspaceService: WorkspaceService;

    @inject(FileUploadService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly fileUploadService: FileUploadService;

    @inject(MobileProjectsReadmeContribution)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly projectsReadme: MobileProjectsReadmeContribution;

    @inject(WidgetManager)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly widgetManager: WidgetManager;

    @inject(ScmService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly scmService: ScmService;

    @inject(ChatService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly chatService: ChatService;

    @inject(AIVariableService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly variableService: AIVariableService;

    @inject(SkillService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly skillService: SkillService;

    @inject(PromptService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly promptService: PromptService;

    @inject(QuickInputService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly quickInputService: QuickInputService;

    @inject(ChatAgentService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly chatAgentService: ChatAgentService;

    @inject(PreferenceService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly preferenceService: PreferenceService;

    @inject(QaapAppearanceModeService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly appearanceModeService: QaapAppearanceModeService;

    @inject(ThemeService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly themeService: ThemeService;

    @inject(MCPFrontendService) @optional()
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly mcpFrontendService?: MCPFrontendService;

    @inject(FrontendLanguageModelRegistry) @optional()
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly languageModelRegistry?: FrontendLanguageModelRegistry;

    @inject(MobileProjectChatViewWidgetFactory)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly mobileProjectChatViewWidgetFactory: MobileProjectChatViewWidgetFactory;

    @inject(QaapWorkHubDiffService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly workHubDiff: QaapWorkHubDiffService;

    @inject(QaapCommitMessageAi) @optional()
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly commitMessageAi?: QaapCommitMessageAi;

    @inject(QaapComposerPromptImprover) @optional()
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly composerPromptImprover?: QaapComposerPromptImprover;

    @inject(QaapComposerEditorContextService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly composerEditorContextService: QaapComposerEditorContextService;

    @inject(QaapWorkHubComposerPromptService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly composerPromptService: QaapWorkHubComposerPromptService;

    @inject(QaapProjectBootstrapService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly projectBootstrap: QaapProjectBootstrapService;

    @inject(QaapAgentFinishedToastContribution)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly agentFinishedToast: QaapAgentFinishedToastContribution;

    @inject(QaapWorkHubProjectSkillRoots)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly workHubProjectSkillRoots: QaapWorkHubProjectSkillRoots;

    @inject(QaapAgUiFrontendToolService) @optional()
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly agUiFrontendTools?: QaapAgUiFrontendToolService;

    @inject(QaapMiniBrowserOpenHandler)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly miniBrowserOpenHandler: QaapMiniBrowserOpenHandler;

    @inject(FileService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly fileService: FileService;

    @inject(EditorManager)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly editorManager: EditorManager;

    @inject(MonacoEditorProvider)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly monacoEditorProvider: MonacoEditorProvider;

    @inject(LabelProvider)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly labelProvider: LabelProvider;

    @inject(DecorationsService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly decorationsService: DecorationsService;

    @inject(ColorRegistry)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly colorRegistry: ColorRegistry;

    @inject(MarkdownPreviewHandler)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly markdownPreviewHandler: MarkdownPreviewHandler;

    @inject(QaapPreviewSurfaceRegistry)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly previewSurfaceRegistry: QaapPreviewSurfaceRegistry;

    @inject(ElementInspectorService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly elementInspectorService: ElementInspectorService;

    @inject(TerminalService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly terminalService: TerminalService;

    @inject(StorageService)
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly storageService: StorageService;

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly toDispose = new DisposableCollection();
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly mobileMq: MediaQueryList | undefined =
        typeof window !== 'undefined' ? window.matchMedia(MOBILE_ONE_COLUMN_LAYOUT_MEDIA_QUERY) : undefined;

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public bottomBarController!: MobileShellBottomBarController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public bottomBarHost!: MobileShellBottomBarHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public overlayController!: MobileShellOverlayHostController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public overlayHost!: MobileShellOverlayHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public sideSheetController!: MobileShellSideSheetController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public sideSheetHost!: MobileShellSideSheetHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public workHubBootstrap!: MobileShellWorkHubBootstrapController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public workHubBootstrapHost!: MobileShellWorkHubBootstrapHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ideFallback!: MobileShellIdeFallbackController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ideFallbackHost!: MobileShellIdeFallbackHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public hubNavigation!: MobileShellHubNavigationController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public hubNavigationHost!: MobileShellHubNavigationHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public pullRequestPanelController!: MobileShellPullRequestPanelController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public pullRequestPanelHost!: MobileShellPullRequestPanelHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public transcriptChrome!: MobileShellTranscriptChromeController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public transcriptChromeHost!: MobileShellTranscriptChromeHost;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public projectsPanelFactory!: MobileProjectsPanelFactory;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly sessionState = new MobileShellSessionState();
    protected get bottomBar(): HTMLElement | undefined { return this.bottomBarController.getBottomBarNode(); }
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public mobileActive = false;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public projectsPanel: MobileProjectsPanel | undefined;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public projectsPanelTrack: Disposable | undefined;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public agentTaskComposer: MobileAgentTaskComposer | undefined;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public workHubPreferencesSheet: MobileWorkHubPreferencesSheet | undefined;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public workHubBillingSheet: MobileWorkHubBillingSheet | undefined;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public projectsCount = 0;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public landing!: MobileShellLandingController;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public landingHost!: MobileShellLandingHost;
    /**
     * True once the user has actively left the mobile landing (Projects panel) in this session,
     * either by opening a workspace from the dashboard or by tapping Focus on the active project.
     * Subsequent re-opens of the Projects view are sheet-style.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public get landingLeftThisSession(): boolean {
        return this.sessionState.landingLeftThisSession;
    }
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public set landingLeftThisSession(value: boolean) {
        this.sessionState.landingLeftThisSession = value;
    }
    protected get transcriptOpenedFromWorkHubLanding(): boolean {
        return this.sessionState.transcriptOpenedFromWorkHubLanding;
    }
    protected set transcriptOpenedFromWorkHubLanding(value: boolean) {
        this.sessionState.transcriptOpenedFromWorkHubLanding = value;
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly onDismissProjectsPanelEvent = (): void => {
        this.onProjectsWorkspaceOpened();
    };

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly onLandingHubListChanged = (): void => {
        this.refreshBottomBar();
        this.scheduleSnapAndUiRefresh();
    };

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public setTrackedProjectsPanel(panel: MobileProjectsPanel | undefined): void {
        setTrackedProjectsPanelExtracted(this, panel);
    }

    @postConstruct()
    protected initLandingController(): void {
        initLandingControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initProjectsPanelFactory(): void {
        initProjectsPanelFactoryExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initTranscriptChromeController(): void {
        initTranscriptChromeControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initPullRequestPanelController(): void {
        initPullRequestPanelControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initHubNavigationController(): void {
        initHubNavigationControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public patchWorkHubBootstrapLandingHost(): void {
        patchWorkHubBootstrapLandingHostExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initSideSheetController(): void {
        initSideSheetControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initOverlayController(): void {
        initOverlayControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public syncOverlayEdgeSwipeZones(): void {
        syncOverlayEdgeSwipeZonesExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initIdeFallbackController(): void {
        initIdeFallbackControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initWorkHubBootstrapController(): void {
        initWorkHubBootstrapControllerExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public initBottomBarController(): void {
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
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public onFrontendReadyEnsureWorkHub(): void {
        this.ensureWorkHubSurfaceMountedAfterReady();
        this.armLayoutRecoveryGuard();
    }

    protected ensureWorkHubSurfaceMountedAfterReady(): void {
        ensureWorkHubSurfaceMountedAfterReadyExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public isWorkHubSurfacePresentInDom(): boolean {
        return isWorkHubSurfacePresentInDomExtracted(this);
    }

    protected armLayoutRecoveryGuard(): void {
        armLayoutRecoveryGuardExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async runLayoutRecoveryGuard(): Promise<void> {
        return runLayoutRecoveryGuardExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public hasLayoutRecoveryBeenAttempted(): boolean {
        return hasLayoutRecoveryBeenAttemptedExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public markLayoutRecoveryAttempted(): void {
        markLayoutRecoveryAttemptedExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public armAgentsSurfaceWatchdog(): void {
        armAgentsSurfaceWatchdogExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public recoverEmptyAgentsSurface(): void {
        recoverEmptyAgentsSurfaceExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public armBootGuardSafetyTimeout(): void {
        armBootGuardSafetyTimeoutExtracted(this);
    }

    /**
     * Persist Agents surface choice so reload / wide viewport does not fall back to the IDE.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public readonly persistWorkHubSurfacePreference = (): void => {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly onMediaChange = (): void => {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public shouldActivateMobileLayout(): boolean {
        return shouldActivateMobileLayoutExtracted(this);
    }

    /**
     * Agents / Work Hub surface — not when the user explicitly chose the classic IDE.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public shouldActivateWorkHubLayout(): boolean {
        return this.shouldActivateMobileLayout() && !peekPreferDesktopIde();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public resizeRaf = 0;
    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public readonly onWindowResize = (): void => {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ensureShellHooks(shell: ApplicationShell): void {
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

    /**
     * Work Hub landing is active — user has not opened/focused a project in this session yet.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public isProjectsLandingSession(): boolean {
        return this.landing.isProjectsLandingSession();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public enterMobileLayout(): void {
        enterMobileLayoutExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public leaveMobileLayout(): void {
        leaveMobileLayoutExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async ensureDesktopSidePanelSizes(): Promise<void> {
        return ensureDesktopSidePanelSizesExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async setSidePanelSize(side: 'left' | 'right', size: number): Promise<void> {
        return setSidePanelSizeExtracted(this, side, size);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public restoreDesktopSplitLayout(): void {
        restoreDesktopSplitLayoutExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public forceCenterColumnFullWidth(): void {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public restoreMobileBottomPanelFromMaximized(): void {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public requestFullShellRelayout(): void {
        requestFullShellRelayoutExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public teardownMobileUi(preserveProjectsLanding = false): void {
        teardownMobileUiExtracted(this, preserveProjectsLanding);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ensureOverlayElements(): void {
        ensureOverlayElementsExtracted(this);
    }

    protected cancelAgentsBootstrap(): void {
        this.workHubBootstrap.cancelAgentsBootstrap();
    }

    protected disposeProjectsPanelForDesktopIde(): void {
        this.ideFallback?.disposeProjectsPanelForDesktopIde();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public tryBootstrapMobileAgentsChat(): boolean {
        return this.workHubBootstrap.tryBootstrapMobileAgentsChat();
    }

    protected async restoreAgentsSurfaceAfterReload(): Promise<void> {
        return this.workHubBootstrap.restoreAgentsSurfaceAfterReload();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ensureMobileProjectsHomeVisible(): void {
        this.workHubBootstrap.ensureMobileProjectsHomeVisible();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async ensureMainContentAfterWorkspaceReload(): Promise<void> {
        return ensureMainContentAfterWorkspaceReloadExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ensureProjectsPanel(forceHomeMode?: boolean): void {
        this.workHubBootstrap.ensureProjectsPanel(forceHomeMode);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public createProjectsPanel(homeMode: boolean): MobileProjectsPanel {
        return this.projectsPanelFactory.create(homeMode);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ensureDesktopWorkHubSessionsSidebarOpen(): void {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openPullRequestFromInbox(pullRequest: QaapGithubPullRequestSummary): Promise<void> {
        return this.pullRequestPanelController.openPullRequestFromInbox(pullRequest);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async refreshProjectsCount(): Promise<void> {
        return refreshProjectsCountExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public hideProjectsPanel(): void {
        hideProjectsPanelExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public hidePullRequestPanel(): void {
        this.pullRequestPanelController.hidePullRequestPanel();
    }

    registerCommands(registry: CommandRegistry): void {
        registerCommandsExtracted(this, registry);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openDesktopIde(): Promise<void> {
        return openDesktopIdeExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async prepareDesktopIdeWorkspaceFromHub(selectedProjectId?: string): Promise<boolean> {
        return prepareDesktopIdeWorkspaceFromHubExtracted(this, selectedProjectId);
    }

    /**
     * IDE | Agents switch from classic IDE — restore the Agents execution shell.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public returnToAgentsFromDesktopIde(): void {
        this.ideFallback?.returnToAgentsFromDesktopIde();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public toggleWorkHubSessionsSidebar(): void {
        this.ensureProjectsPanel();
        this.projectsPanel?.toggleWorkHubSessionsSidebar();
    }

    protected onEnterActiveTranscript(): void {
        this.transcriptChrome.onEnterActiveTranscript();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public enforceWorkHubSurfaceIsolation(): void {
        enforceWorkHubSurfaceIsolationExtracted(this);
    }

    protected async onExitActiveTranscript(): Promise<void> {
        return this.transcriptChrome.onExitActiveTranscript();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openAgentTaskComposer(project: MobileProjectEntry): Promise<void> {
        return openAgentTaskComposerExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openWorkHubPreferencesSheet(query?: string): Promise<void> {
        return openWorkHubPreferencesSheetExtracted(this, query);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openWorkHubBillingSheet(options?: { readonly afterCheckout?: boolean }): Promise<void> {
        return openWorkHubBillingSheetExtracted(this, options);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openWorkHubAiConfigurationSheet(tabId?: string): Promise<void> {
        return openWorkHubAiConfigurationSheetExtracted(this, tabId);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async toggleProjectsPanel(): Promise<void> {
        return toggleProjectsPanelExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async showMobileProjectsHome(preferredHubView?: MobileProjectsHubView): Promise<void> {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openMobileWorkHubLanding(view: MobileProjectsHubView): Promise<void> {
        return this.hubNavigation.openMobileWorkHubLanding(view);
    }

    protected async togglePullRequestPanel(): Promise<void> {
        return this.pullRequestPanelController.togglePullRequestPanel();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async onProjectsPanelOpen(project: MobileProjectEntry): Promise<void> {
        return onProjectsPanelOpenExtracted(this, project);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async onProjectsPanelOpenInIde(project: MobileProjectEntry): Promise<void> {
        return onProjectsPanelOpenInIdeExtracted(this, project);
    }

    /**
     * After clone/create/open, keep Work Hub Agents mounted. Disposing the home panel here left
     * an empty IDE shell (collapsed main area + hide-ide CSS) with only snackbars visible.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public onProjectsWorkspaceOpened(): void {
        this.landing.retainAgentsHubAfterWorkspaceOpen();
        this.scheduleSnapAndUiRefresh();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async onCurrentProjectActivated(): Promise<void> {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public scheduleSnapAndUiRefresh(): void {
        this.sideSheetController.scheduleSnapAndUiRefresh();
    }

    /**
     * Pause mini-browser dev-server iframes while Work Hub is foreground (avoids Vite HMR console noise).
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public syncIdeMiniBrowserPreviewSuspension(): void {
        const userViewingIdePreview = peekPreferDesktopIde() && !!this.getActivePreviewWidget();
        syncQaapMiniBrowserPreviewSuspension(this.shell, userViewingIdePreview);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async prepareSideSheetOpen(side: 'left' | 'right'): Promise<void> {
        return prepareSideSheetOpenExtracted(this, side);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async mountSideSheetWidget(side: 'left' | 'right', widgetId: string): Promise<void> {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public syncMobileHubPrimaryBottomChrome(): void {
        this.bottomBarController.syncMobileHubPrimaryBottomChrome();
    }

    protected getWorkHubLandingBottomButtons(): MobileBottomButton[] {
        return this.bottomBarController.getWorkHubLandingBottomButtons();
    }

    async openConversationInWorkHub(conversationId: string, cwd?: string): Promise<void> {
        return openConversationInWorkHubExtracted(this, conversationId, cwd);
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public refreshWorkbenchTopBar(): void {
        refreshWorkbenchTopBarExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public refreshBottomBar(): void {
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

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async executeAndDismiss(commandId: string): Promise<void> {
        return executeAndDismissExtracted(this, commandId);
    }

    protected async onMobileBottomButtonClick(def: MobileBottomButton, btn: HTMLButtonElement): Promise<void> {
        return this.bottomBarController.onMobileBottomButtonClick(def, btn);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public resolveMobileIdeHeaderViewId(): MobileBottomButtonId {
        return resolveMobileIdeHeaderViewIdExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async activateMobileIdeHeaderView(id: MobileBottomButtonId): Promise<void> {
        return activateMobileIdeHeaderViewExtracted(this, id);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public relayoutMainPreviewWidgets(): void {
        relayoutMainPreviewWidgetsExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async toggleMobileAgentSheet(): Promise<void> {
        return toggleMobileAgentSheetExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public isMobileAgentSheetVisible(): boolean {
        return this.shell.isExpanded('right') && !this.sideSheetController.isSidePanelSheetCollapsedInDom('right');
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async resolveCurrentProjectForAgent(): Promise<MobileProjectEntry | undefined> {
        return resolveCurrentProjectForAgentExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async toggleMobileExploreSheet(): Promise<void> {
        return toggleMobileExploreSheetExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public isMobileExploreSheetVisible(): boolean {
        return isMobileExploreSheetVisibleExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public getActivePreviewWidget(): LuminoWidget | undefined {
        return getActivePreviewWidgetExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public findPreviewWidget(): LuminoWidget | undefined {
        return findPreviewWidgetExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public getMainPreviewWidget(): LuminoWidget | undefined {
        return this.shell.getWidgets('main').find(widget => isMiniBrowserPreviewWidgetId(widget.id));
    }

    /**
     * True when the preview tab has mini-browser chrome (not a layout-restore shell with no content).
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public isMainPreviewWidgetLive(preview: LuminoWidget): boolean {
        return isMainPreviewWidgetLiveHelper(preview);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async closeStaleMainPreviewWidget(): Promise<void> {
        return closeStaleMainPreviewWidgetExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public ensureMobilePreviewEditorVisible(): void {
        ensureMobilePreviewEditorVisibleExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async activateMainPreviewWidget(): Promise<boolean> {
        return activateMainPreviewWidgetExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async relocatePreviewToMainIfNeeded(): Promise<void> {
        return relocatePreviewToMainIfNeededExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async toggleMobilePreview(): Promise<void> {
        return toggleMobilePreviewExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async bootstrapMobilePreviewInBackground(): Promise<void> {
        return bootstrapMobilePreviewInBackgroundExtracted(this);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async openMobilePreviewInMain(): Promise<void> {
        return openMobilePreviewInMainExtracted(this);
    }

    /**
     * Open a side sheet and show a view without `toggle` semantics (which would collapse an
     * already-active panel — the usual failure mode for Agent on mobile).
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public async openMobileSideSheet(side: 'left' | 'right', widgetId: string): Promise<void> {
        return this.sideSheetController.openMobileSideSheet(side, widgetId);
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public shouldDismissSheetsForButton(id: MobileBottomButtonId): boolean {
        return this.bottomBarController.shouldDismissSheetsForButton(id);
    }

    /**
     * Collapse expanded side sheets and await layout so follow-up UI (e.g. quick input) is stable.
     * @internal Used by the extracted mobile-one-column-shell-contribution-* modules.
     */
    public async dismissSheetsAsync(): Promise<void> {
        return this.sideSheetController.dismissSheetsAsync();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async collapseMobileSideSheets(): Promise<void> {
        return this.sideSheetController.collapseMobileSideSheets();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async collapseMobileSidePanels(): Promise<void> {
        return this.sideSheetController.collapseMobileSidePanels();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public settleMobileSidePanelsCollapsed(): void {
        this.sideSheetController.settleMobileSidePanelsCollapsed();
    }

    protected isSidePanelSheetCollapsedInDom(side: 'left' | 'right'): boolean {
        return this.sideSheetController.isSidePanelSheetCollapsedInDom(side);
    }

    protected isAnyMobileSideSheetVisible(): boolean {
        return this.sideSheetController.isAnyMobileSideSheetVisible();
    }

    /** @internal Used by the extracted mobile-one-column-shell-contribution-* modules. */
    public async ensureWelcomeInMainArea(): Promise<void> {
        return ensureWelcomeInMainAreaExtracted(this);
    }

}
