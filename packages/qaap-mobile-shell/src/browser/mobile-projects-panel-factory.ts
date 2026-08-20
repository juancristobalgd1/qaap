// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import type { LabelProvider } from '@theia/core/lib/browser';
import type { ColorRegistry } from '@theia/core/lib/browser/color-registry';
import type { DecorationsService } from '@theia/core/lib/browser/decorations-service';
import type { StorageService } from '@theia/core/lib/browser/storage-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { MessageService } from '@theia/core/lib/common/message-service';
import type { PreferenceService } from '@theia/core/lib/common/preferences';
import type { QaapAppearanceModeService } from './qaap-appearance-mode-service';
import type { MCPFrontendService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import type { QuickInputService } from '@theia/core';
import type { AIVariableService, FrontendLanguageModelRegistry, PromptService } from '@theia/ai-core';
import type { SkillService } from '@theia/ai-core/lib/browser/skill-service';
import type { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import type { ChatService } from '@theia/ai-chat';
import type { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import type { FileUploadService } from '@theia/filesystem/lib/common/upload/file-upload';
import type { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { EditorManager } from '@theia/editor/lib/browser';
import type { MonacoEditorProvider } from '@theia/monaco/lib/browser/monaco-editor-provider';
import type { MarkdownPreviewHandler } from '@theia/preview/lib/browser/markdown/markdown-preview-handler';
import type { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import type { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import type { ScmService } from '@theia/scm/lib/browser/scm-service';
import type { WorkspaceService } from '@theia/workspace/lib/browser';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { ElementInspectorService } from '@theia/qaap-element-inspector/lib/browser/element-inspector-service';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { applyComposerAttachmentsToPrompt } from '../common/qaap-composer-attachment-prompt';
import { expandComposerSkillSlashCommands } from '../common/qaap-composer-skill-submit';
import { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsPanel, MobileProjectsPanelDelegate, MobileProjectsPanelOptions } from './mobile-projects-panel';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import { MobileProjectChatViewWidgetFactory } from './mobile-project-ai-chat-input-widget';
import { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import { QaapCommitMessageAi } from './qaap-commit-message-ai';
import { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QaapAgUiFrontendToolService } from './qaap-ag-ui-frontend-tool-service';
import { resolveAgentVerifyChecksForCwd } from './qaap-agent-verify-checks-resolver';
import { openTranscriptWorkspaceChange, openTranscriptWorkspaceChanges, openTranscriptWorkspaceFile, createTranscriptFilesViewServices } from './qaap-transcript-file-open';
import { createTranscriptTerminalViewServices } from './qaap-transcript-terminal-view';
import { pickMobileContextVariable } from './qaap-mobile-context-attach-menu';
import { attachDeviceFilesOptimistic } from './qaap-mobile-composer-device-attach';
import { QAAP_WORK_HUB_AI_CONFIGURATION_MCP_TAB } from '../common/mobile-work-hub-catalog';
import { resolveStickyComposerAttachmentPreview } from './qaap-sticky-composer-attachment-preview';
import { resolveStickyComposerContextChip } from './qaap-sticky-composer-context-ui';
import { resolvePinnedEditorContextVariable } from './qaap-composer-editor-context-resolver';
import { QaapComposerEditorContextService } from './qaap-composer-editor-context-service';
import type { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';
import { resolvePreviewFeedbackVariable } from '../common/qaap-preview-feedback-context';
import { uploadInlineComposerImagesToWorkspace } from './qaap-mobile-composer-device-attach';

export interface MobileProjectsPanelFactoryDelegate {
    onProjectOpen(project: MobileProjectEntry): void;
    onProjectOpenInIde(project: MobileProjectEntry): void;
    onDismiss(): void;
    onWorkspaceOpened(): void;
    onProjectsChanged(): void;
    onCurrentProjectActivated(): void | Promise<void>;
    onResumePreview(project: MobileProjectEntry): void;
    onOpenAgentOnTask(project: MobileProjectEntry): void;
    onOpenPullRequest(pullRequest: QaapGithubPullRequestSummary): void;
    onShowAgentsHub(): void;
    onHubLandingViewChanged(): void;
    onEnterActiveTranscript(): void;
    onEnterWorkHubConversation(): void;
    onExitActiveTranscript(): void;
    openWorkHubPreferencesSheet(query?: string): Promise<void>;
    openWorkHubBillingSheet(): Promise<void>;
    openWorkHubAiConfigurationSheet(tabId?: string): Promise<void>;
}

export interface MobileProjectsPanelFactoryDeps {
    projectsService: MobileProjectsService;
    commands: CommandRegistry;
    widgetManager: WidgetManager;
    applicationShell: ApplicationShell;
    scmService: ScmService;
    mobileProjectChatViewWidgetFactory: MobileProjectChatViewWidgetFactory;
    chatService: ChatService;
    chatAgentService: ChatAgentService;
    messageService: MessageService;
    variableService: AIVariableService;
    skillService: SkillService;
    promptService: PromptService;
    quickInputService: QuickInputService;
    fileUploadService: FileUploadService;
    fileService: FileService;
    workspaceService: WorkspaceService;
    editorManager: EditorManager;
    monacoEditorProvider: MonacoEditorProvider;
    labelProvider: LabelProvider;
    markdownPreviewHandler: MarkdownPreviewHandler;
    decorationsService: DecorationsService;
    colorRegistry: ColorRegistry;
    terminalService: TerminalService;
    storageService: StorageService;
    previewSurfaceRegistry: QaapPreviewSurfaceRegistry;
    elementInspectorService: ElementInspectorService;
    clipboardService: ClipboardService;
    preferenceService: PreferenceService;
    appearanceModeService?: QaapAppearanceModeService;
    mcpFrontendService?: MCPFrontendService;
    languageModelRegistry?: FrontendLanguageModelRegistry;
    commitMessageAi?: QaapCommitMessageAi;
    composerPromptImprover?: QaapComposerPromptImprover;
    projectBootstrap: QaapProjectBootstrapService;
    agUiFrontendTools?: QaapAgUiFrontendToolService;
    composerEditorContextService: QaapComposerEditorContextService;
    workHubProjectSkillRoots?: QaapWorkHubProjectSkillRoots;
    activeTasks: MobileProjectsActiveTasks;
    conversations: MobileProjectsConversations;
    backgroundContext: QaapBackgroundContextProvider;
    inboxStream: MobileWorkHubInboxStream;
    conversationFlags: MobileProjectsConversationFlags;
}

export interface MobileProjectsPanelFactoryOptions {
    deps: MobileProjectsPanelFactoryDeps;
    delegate: MobileProjectsPanelFactoryDelegate;
    panelOptions?: Pick<MobileProjectsPanelOptions, 'headerOverflowMenuGroups' | 'sessionsSidebarContainer' | 'mobileIdeViewPicker' | 'whenFrontendReady' | 'agentFinishedToast'>;
    createPanel?: (
        projectsService: MobileProjectsService,
        commands: CommandRegistry,
        delegate: MobileProjectsPanelDelegate,
        options: MobileProjectsPanelOptions,
    ) => MobileProjectsPanel;
}

/** DI wiring for {@link MobileProjectsPanel} — kept out of the shell contribution orchestrator. */
export class MobileProjectsPanelFactory {

    protected readonly deps: MobileProjectsPanelFactoryDeps;
    protected readonly delegate: MobileProjectsPanelFactoryDelegate;
    protected readonly panelOptions: MobileProjectsPanelFactoryOptions['panelOptions'];
    protected readonly createPanelInstance: NonNullable<MobileProjectsPanelFactoryOptions['createPanel']>;

    constructor(options: MobileProjectsPanelFactoryOptions) {
        this.deps = options.deps;
        this.delegate = options.delegate;
        this.panelOptions = options.panelOptions;
        this.createPanelInstance = options.createPanel ?? ((projectsService, commands, delegate, panelOptions) => {
            // Keep the heavy panel graph out of lightweight unit tests until a real panel is needed.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const module = require('./mobile-projects-panel') as typeof import('./mobile-projects-panel');
            return new module.MobileProjectsPanel(projectsService, commands, delegate, panelOptions);
        });
    }

    create(homeMode: boolean): MobileProjectsPanel {
        const deps = this.deps;
        const delegate = this.delegate;
        return this.createPanelInstance(
            deps.projectsService,
            deps.commands,
            {
                onProjectOpen: project => delegate.onProjectOpen(project),
                onProjectOpenInIde: project => delegate.onProjectOpenInIde(project),
                onDismiss: () => delegate.onDismiss(),
                onWorkspaceOpened: () => delegate.onWorkspaceOpened(),
                onProjectsChanged: () => delegate.onProjectsChanged(),
                onCurrentProjectActivated: () => delegate.onCurrentProjectActivated(),
                onResumePreview: project => delegate.onResumePreview(project),
                onOpenAgentOnTask: project => delegate.onOpenAgentOnTask(project),
                onOpenPullRequest: pullRequest => delegate.onOpenPullRequest(pullRequest),
                onShowAgentsHub: () => delegate.onShowAgentsHub(),
                onHubLandingViewChanged: () => delegate.onHubLandingViewChanged(),
                onEnterActiveTranscript: () => delegate.onEnterActiveTranscript(),
                onEnterWorkHubConversation: () => delegate.onEnterWorkHubConversation(),
                onExitActiveTranscript: () => delegate.onExitActiveTranscript(),
            },
            {
                homeMode,
                activeTasks: deps.activeTasks,
                conversations: deps.conversations,
                backgroundContext: deps.backgroundContext,
                inboxStream: deps.inboxStream,
                conversationFlags: deps.conversationFlags,
                // Fresh widget id per panel: avoids duplicate ai-chat:/input.aichatviewlanguage registration.
                createChatInputWidget: id => deps.widgetManager.getOrCreateWidget<AIChatInputWidget>(
                    'mobile-projects-chat-input',
                    { source: 'mobile-projects', id },
                ),
                createChatViewWidget: id => Promise.resolve(
                    deps.mobileProjectChatViewWidgetFactory(id),
                ),
                chatService: deps.chatService,
                chatAgentService: deps.chatAgentService,
                messageService: deps.messageService,
                pickContextVariable: (anchor, handlers) => pickMobileContextVariable(
                    anchor,
                    deps.variableService,
                    deps.quickInputService,
                    {
                        fileUploadService: deps.fileUploadService,
                        fileService: deps.fileService,
                        workspaceService: deps.workspaceService,
                    },
                    handlers,
                    deps.skillService,
                    {
                        preferenceService: deps.preferenceService,
                        mcpFrontendService: deps.mcpFrontendService,
                        openMcpSettings: () => delegate.openWorkHubAiConfigurationSheet(
                            QAAP_WORK_HUB_AI_CONFIGURATION_MCP_TAB,
                        ),
                    },
                    deps.composerEditorContextService.shouldOfferManualEditorContextAttach(),
                ),
                dropComposerFiles: (files, handlers) => attachDeviceFilesOptimistic(
                    files,
                    {
                        fileUploadService: deps.fileUploadService,
                        fileService: deps.fileService,
                        workspaceService: deps.workspaceService,
                    },
                    handlers,
                ),
                formatContextChip: item => resolveStickyComposerContextChip(item, deps.labelProvider),
                resolveAttachmentPreview: item => resolveStickyComposerAttachmentPreview(
                    item,
                    deps.fileService,
                    deps.workspaceService,
                ),
                uploadComposerFeedbackImages: (images, targetDir) => uploadInlineComposerImagesToWorkspace(
                    images,
                    targetDir,
                    deps.fileService,
                    deps.workspaceService,
                ),
                getComposerVariables: () => deps.variableService.getVariables(),
                getComposerSkills: () => deps.skillService.getSkills(),
                getComposerSlashCommands: agentId => deps.promptService.getCommands(agentId),
                expandComposerDraftForSubmit: draft => expandComposerSkillSlashCommands(draft, {
                    skillService: deps.skillService,
                    fileService: deps.fileService,
                }),
                applyComposerAttachmentsToDraft: (draft, variables) => applyComposerAttachmentsToPrompt(
                    draft,
                    variables,
                    deps.variableService,
                    undefined,
                    {
                        resolvePinnedRequest: async request => {
                            const preview = resolvePreviewFeedbackVariable(request);
                            if (preview) {
                                return preview;
                            }
                            return resolvePinnedEditorContextVariable(
                                request,
                                deps.workspaceService,
                                deps.fileService,
                            );
                        },
                    },
                ),
                createDiffReviewWidget: () => deps.widgetManager.getOrCreateWidget(QaapDiffReviewWidget.ID),
                resolveVerifyChecks: cwd => resolveAgentVerifyChecksForCwd(cwd, deps.fileService),
                openTranscriptFile: filePath => openTranscriptWorkspaceFile(
                    filePath,
                    deps.workspaceService,
                    deps.editorManager,
                ),
                openTranscriptChanges: () => openTranscriptWorkspaceChanges(
                    deps.applicationShell,
                    deps.widgetManager,
                ),
                openTranscriptReviewFile: filePath => openTranscriptWorkspaceChange(
                    filePath,
                    deps.workspaceService,
                    deps.editorManager,
                    deps.scmService,
                ),
                createTranscriptFilesViewServices: () => createTranscriptFilesViewServices(
                    deps.workspaceService,
                    deps.fileService,
                    deps.editorManager,
                    deps.commands,
                    deps.monacoEditorProvider,
                    deps.labelProvider,
                    deps.markdownPreviewHandler,
                    deps.decorationsService,
                    deps.colorRegistry,
                ),
                createTranscriptTerminalViewServices: () => createTranscriptTerminalViewServices(
                    deps.terminalService,
                    deps.workspaceService,
                    deps.storageService,
                ),
                previewSurfaceRegistry: deps.previewSurfaceRegistry,
                previewInspectorDeps: {
                    service: deps.elementInspectorService,
                    commands: deps.commands,
                },
                clipboard: deps.clipboardService,
                readPreference: key => deps.preferenceService.get(key),
                preferenceService: deps.preferenceService,
                appearanceModeService: deps.appearanceModeService,
                getRegisteredLanguageModels: deps.languageModelRegistry
                    ? () => deps.languageModelRegistry!.getLanguageModels()
                    : undefined,
                quickInputService: deps.quickInputService,
                commitMessageAi: deps.commitMessageAi,
                composerPromptImprover: deps.composerPromptImprover,
                openPreferencesSheet: query => delegate.openWorkHubPreferencesSheet(query),
                openBillingSheet: () => delegate.openWorkHubBillingSheet(),
                openAiConfigurationSheet: tabId => delegate.openWorkHubAiConfigurationSheet(tabId),
                projectBootstrap: deps.projectBootstrap,
                agUiFrontendTools: deps.agUiFrontendTools,
                composerEditorContextService: deps.composerEditorContextService,
                workHubProjectSkillRoots: deps.workHubProjectSkillRoots,
                headerOverflowMenuGroups: this.panelOptions?.headerOverflowMenuGroups,
                sessionsSidebarContainer: this.panelOptions?.sessionsSidebarContainer,
                mobileIdeViewPicker: this.panelOptions?.mobileIdeViewPicker,
                whenFrontendReady: this.panelOptions?.whenFrontendReady,
                agentFinishedToast: this.panelOptions?.agentFinishedToast,
            },
        );
    }
}
