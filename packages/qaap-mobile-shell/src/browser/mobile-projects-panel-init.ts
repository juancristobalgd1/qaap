// @ts-nocheck
// Constructor initialization and arrow-function fields extracted from mobile-projects-panel.ts

import { TranscriptOverlayController } from './mobile-projects-transcript-overlay-controller';
import { bindTranscriptOverlayStateAccessors } from './mobile-projects-transcript-overlay-controller';
import type { MobileProjectsTranscriptOverlayHost } from './mobile-projects-transcript-overlay-controller';
import type { MobileProjectsPanelOptions } from './mobile-projects-panel-types';
import { QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT } from './mobile-projects-types';
import { peekPreferDesktopIde } from './mobile-projects-open';

/**
 * Copies options fields onto the panel instance. Extracted from the constructor
 * to keep the main file under control.
 */
export function applyPanelOptions(self: any, options: MobileProjectsPanelOptions): void {
    self.homeMode = !!options.homeMode;
    self.whenFrontendReadyProvider = options.whenFrontendReady;
    self.activeTasks = options.activeTasks;
    self.conversations = options.conversations;
    self.backgroundContext = options.backgroundContext;
    self.inboxStream = options.inboxStream;
    self.conversationFlags = options.conversationFlags;
    self.createChatInputWidget = options.createChatInputWidget;
    self.createChatViewWidget = options.createChatViewWidget;
    self.createDiffReviewWidget = options.createDiffReviewWidget;
    self.pickContextVariable = options.pickContextVariable;
    self.dropComposerFiles = options.dropComposerFiles;
    self.formatContextChip = options.formatContextChip;
    self.resolveAttachmentPreview = options.resolveAttachmentPreview;
    self.getComposerVariables = options.getComposerVariables;
    self.getComposerSkills = options.getComposerSkills;
    self.getComposerSlashCommands = options.getComposerSlashCommands;
    self.chatService = options.chatService;
    self.chatAgentService = options.chatAgentService;
    self.messageService = options.messageService;
    self.resolveVerifyChecks = options.resolveVerifyChecks;
    self.uploadComposerFeedbackImages = options.uploadComposerFeedbackImages;
    self.createTranscriptFilesViewServices = options.createTranscriptFilesViewServices;
    self.createTranscriptTerminalViewServices = options.createTranscriptTerminalViewServices;
    self.previewSurfaceRegistry = options.previewSurfaceRegistry;
    self.previewInspectorDeps = options.previewInspectorDeps;
    self.previewClipboard = options.clipboard;
    self.readPreference = options.readPreference;
    self.preferenceService = options.preferenceService;
    self.appearanceModeService = options.appearanceModeService;
    self.getRegisteredLanguageModels = options.getRegisteredLanguageModels;
    self.quickInputService = options.quickInputService;
    self.commitMessageAi = options.commitMessageAi;
    self.composerPromptImprover = options.composerPromptImprover;
    self.openPreferencesSheet = options.openPreferencesSheet;
    self.openBillingSheet = options.openBillingSheet;
    self.openAiConfigurationSheet = options.openAiConfigurationSheet;
    self.headerOverflowMenuGroups = options.headerOverflowMenuGroups;
    self.sessionsSidebarContainer = options.sessionsSidebarContainer ?? (() => self.shouldEmbedSessionsSidebarInPanel() ? self.root : undefined);
    self.mobileIdeViewPicker = options.mobileIdeViewPicker;
    self.agentFinishedToast = options.agentFinishedToast;
    self.projectBootstrap = options.projectBootstrap;
    self.agUiFrontendTools = options.agUiFrontendTools;
    self.expandComposerDraftForSubmit = options.expandComposerDraftForSubmit;
    self.applyComposerAttachmentsToDraft = options.applyComposerAttachmentsToDraft;
    self.composerEditorContextService = options.composerEditorContextService;
    self.workHubProjectSkillRoots = options.workHubProjectSkillRoots;
    self.openTranscriptChanges = options.openTranscriptChanges;
}

/**
 * Wires `openTranscriptFile` / `openTranscriptReviewFile` callbacks that delegate
 * to the transcript surfaces UI when a project+summary are active.
 */
export function wireTranscriptFileOpeners(self: any, options: MobileProjectsPanelOptions): void {
    const editorOpenFallback = options.openTranscriptFile;
    self.openTranscriptFile = (filePath: string) => {
        if (peekPreferDesktopIde()) {
            return editorOpenFallback?.(filePath);
        }
        const state = self.transcriptController.state;
        const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        if (project && summary) {
            return self.transcriptSurfacesUi.revealTranscriptFile(project, summary, filePath);
        }
        if (editorOpenFallback) {
            return editorOpenFallback(filePath);
        }
    };
    self.openTranscriptReviewFile = (filePath: string) => {
        if (peekPreferDesktopIde()) {
            return options.openTranscriptReviewFile?.(filePath);
        }
        const state = self.transcriptController.state;
        const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        if (project && summary) {
            return self.transcriptSurfacesUi.revealTranscriptReviewFile(project, summary, filePath);
        }
    };
}

/**
 * Creates the root DOM element for the panel.
 */
export function createPanelRoot(self: any): void {
    self.root = document.createElement('div');
    self.root.className = self.homeMode ? 'theia-mobile-projects theia-mod-home' : 'theia-mobile-projects';
    if (!self.homeMode) {
        self.root.setAttribute('role', 'dialog');
        self.root.setAttribute('aria-modal', 'true');
    }
    self.root.setAttribute('aria-hidden', 'true');
    self.root.hidden = true;
}

/**
 * The bootstrap just opened/navigated the IDE mini-browser preview widget. While the Work Hub
 * is the foreground surface that widget sits hidden behind the hub overlay and is suspended to
 * `about:blank`, so every "Open preview" affordance looked like a silent no-op. Mirror the
 * navigation into the hub's own Preview tab — but only for explicit user-initiated opens
 * (pill / link / manual). Agent/auto paths must not yank the transcript to Browser.
 */
export function onBootstrapPreviewOpenedHandler(self: any, event: Event): void {
    if (!self.visible || !self.agentsHubShellActive) {
        return;
    }
    const detail = (event as CustomEvent<{ userInitiated?: boolean }>).detail;
    // Explicit false = agent/auto path. Missing detail = legacy user focusPreview.
    if (detail?.userInitiated === false) {
        return;
    }
    const state = self.transcriptController.state;
    const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    if (!project || !summary) {
        return;
    }
    // The bootstrap is scoped to the ACTIVE workspace. If the open transcript belongs to a
    // different project, surfacing its Preview tab here would show (and let the surface
    // record) another app's preview — never mirror a foreign bootstrap navigation.
    if (!self.projectOwnsActiveBootstrap(project)) {
        return;
    }
    if (self.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
        return;
    }
    self.selectTranscriptTab('preview', project, summary);
}

/** Account button click handler — opens the account menu without surface switching. */
export function onAccountClickHandler(self: any): void {
    // toggleQaapAccountMenu is imported in the main file; delegate via self
    self._toggleAccountMenu(self.accountBtn);
}

/**
 * Auth session changed handler.
 */
export function onAuthSessionChangedHandler(self: any): void {
    if (self.hubView === 'tasks') {
        self.resetInboxPullRequestState();
        void self.refreshInboxPullRequests(undefined, true);
    }
    if (self.refreshProjectsInFlight) {
        return;
    }
    self.refreshProjectsInFlight = self.refreshProjects().finally(() => {
        self.refreshProjectsInFlight = undefined;
    });
}
