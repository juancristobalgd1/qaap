// @ts-nocheck
// Types and interfaces extracted from mobile-projects-panel.ts

import type { ExecutionSurfaceTabId } from './mobile-projects-types';
import { QuickPickItem } from '@theia/core/lib/browser';

export interface MobileProjectsPanelDelegate {
    onProjectOpen(project: MobileProjectEntry): void;
    /** Leave the Agents shell and show the classic IDE for this project. */
    onProjectOpenInIde?(project: MobileProjectEntry): void | Promise<void>;
    onDismiss(): void;
    /** Work Hub inbox: open the mobile PR review sheet for this pull request. */
    onOpenPullRequest?(pullRequest: QaapGithubPullRequestSummary): void;
    /** Clone/create/open from the projects UI finished and switched the IDE workspace. */
    onWorkspaceOpened?(): void;
    onProjectsChanged?(): void;
    /**
     * Invoked when the user taps the project that already matches the active workspace.
     * The shell uses it to surface the README in the editor instead of triggering a no-op reload.
     */
    onCurrentProjectActivated?(project: MobileProjectEntry): void | Promise<void>;
    onResumePreview?(project: MobileProjectEntry): void | Promise<void>;
    onOpenAgentOnTask?(project: MobileProjectEntry): void | Promise<void>;
    /** Show Work Hub (Agents landing) when sidebar actions need the projects panel visible. */
    onShowAgentsHub?(): void | Promise<void>;
    /** Shell bottom bar active state after in-panel hub tab changes. */
    onHubLandingViewChanged?(): void;
    /** Transcript sheet on body: leave Work Hub landing overlay while chat is active. */
    onEnterActiveTranscript?(): void;
    /** Work Hub conversation became active; keep IDE-only panels out of the Work Hub surface. */
    onEnterWorkHubConversation?(): void;
    /** Transcript closed: restore Agents hub if the user had opened chat from the landing. */
    onExitActiveTranscript?(): void;
}

export interface MobileProjectsPanelOptions {
    /**
     * Render as the workbench home view instead of a transient sheet: no drag-to-dismiss, no
     * outside-tap dismiss, no `dialog` ARIA role. The user lives here when there is no workspace
     * open, so the panel must not be dismissable.
     */
    homeMode?: boolean;
    /**
     * Resolves when the frontend application reached the 'ready' state
     * (FrontendApplicationStateService). Used to defer composer autofocus
     * until the boot sequence has finished fighting over focus.
     */
    whenFrontendReady?: () => Promise<void>;
    /** Live cross-project task tracker. When provided the panel updates cards from SSE events. */
    activeTasks?: MobileProjectsActiveTasks;
    /**
     * Cross-project tracker of persistent agent conversations. When provided, each project card
     * lists its VPS-backed conversations and the inline composer creates / continues them instead
     * of firing fire-and-forget background tasks.
     */
    conversations?: MobileProjectsConversations;
    /** Resolves the editable global background-agent context for VPS conversations. */
    backgroundContext?: QaapBackgroundContextProvider;
    /** GitHub webhook inbox SSE — refreshes the Work Hub inbox without polling. */
    inboxStream?: MobileWorkHubInboxStream;
    /**
     * Browser-local store of per-conversation priority/pause overrides for Theia-chat sessions
     * (the VPS conversation store handles its own flags). Optional — when omitted the menu items
     * fall back to no-op.
     */
    conversationFlags?: MobileProjectsConversationFlags;
    /** Creates the same chat input widget used by the Agent view. */
    createChatInputWidget?: (id: string) => Promise<AIChatInputWidget>;
    /** Creates a full Agent chat view for opening real workspace chat sessions from Projects. */
    createChatViewWidget?: (id: string) => Promise<ChatViewWidget>;
    /** Embeds the diff-review React surface inside the Work Hub. */
    createDiffReviewWidget?: () => Promise<QaapDiffReviewWidget>;
    /** Context attach picker; anchor is the sticky composer attach button. */
    pickContextVariable?: (
        anchor: HTMLElement,
        handlers: MobileComposerAttachHandlers,
    ) => Promise<AIVariableResolutionRequest[]>;
    /**
     * Attaches device files dragged onto the composer (drag-and-drop). Receives the optimistic
     * attach handlers so chips appear instantly with the same lifecycle as picker-attached files.
     */
    dropComposerFiles?: (
        files: File[],
        handlers: MobileComposerAttachHandlers,
    ) => void;
    /** Labels/icons for attached context chips (Agent chat label provider). */
    formatContextChip?: (item: AIVariableResolutionRequest) => StickyComposerContextChipView;
    /** Loads image attachment previews (inline base64 or workspace files). */
    resolveAttachmentPreview?: (item: AIVariableResolutionRequest) => Promise<string | undefined>;
    /** Variables offered for `#` completion in the sticky composer (same pool as Agent chat). */
    getComposerVariables?: () => readonly AIVariable[];
    getComposerSkills?: () => readonly { readonly name: string; readonly description?: string }[];
    getComposerSlashCommands?: (agentId?: string) => readonly import('@theia/ai-core').PromptFragment[];
    chatService?: ChatService;
    chatAgentService?: ChatAgentService;
    messageService?: MessageService;
    /** Picks compile/build/test verification commands from the conversation workspace. */
    resolveVerifyChecks?: (cwd: string) => Promise<Array<{ readonly label: string; readonly command: string }>>;
    /** Sync Work Hub project cwds into {@link QaapProjectSkillRoots} for skill discovery without IDE workspace. */
    workHubProjectSkillRoots?: QaapWorkHubProjectSkillRoots;
    /** Opens a workspace file when the user taps a transcript read chip. */
    openTranscriptFile?: (filePath: string) => void | Promise<void>;
    /** Opens the IDE's native Source Control view for aggregate transcript changes. */
    openTranscriptChanges?: () => void | Promise<void>;
    /** Uploads inline preview-feedback screenshots into the workspace as imageContext requests. */
    uploadComposerFeedbackImages?: (
        images: readonly QaapAttachComposerImageAttachment[],
        targetDir: URI | undefined,
    ) => Promise<AIVariableResolutionRequest[]>;
    openTranscriptReviewFile?: (filePath: string) => void | Promise<void>;
    /** Codex-style workspace browser for the transcript Files tab. */
    createTranscriptFilesViewServices?: () => TranscriptFilesViewServices | undefined;
    /** Integrated terminal for the transcript Terminal tab (same {@link TerminalService} as the workbench). */
    createTranscriptTerminalViewServices?: () => TranscriptTerminalViewServices | undefined;
    /** Shared preview surfaces (element picker + inspector) for the transcript Preview tab. */
    previewSurfaceRegistry?: QaapPreviewSurfaceRegistry;
    /** Element Inspector service + commands for inline Design/CSS editing in Preview. */
    previewInspectorDeps?: QaapPreviewInspectorDeps;
    /** Clipboard for preview overflow actions (screenshot, copy URL). */
    clipboard?: ClipboardService;
    /** Reads AI provider settings (API keys + model lists) for the QAIQ model submenu. */
    readPreference?: (key: string) => unknown;
    /** User preferences — MCP plugin install/remove from the composer slash menu. */
    preferenceService?: PreferenceService;
    /** Light / Dark / System mode for the sessions sidebar foot switch. */
    appearanceModeService?: import('./qaap-appearance-mode-service').QaapAppearanceModeService;
    /** Registered BYOK language models from AI Configuration (same source as the agents UI). */
    getRegisteredLanguageModels?: () => Promise<ReadonlyArray<{ readonly id: string; readonly name?: string }>>;
    /** Monaco quick input — Work Hub search opens as a top overlay instead of an inline field. */
    quickInputService?: QuickInputService;
    /** Generates commit messages automatically from the diff for the commit split-button. */
    commitMessageAi?: import('./qaap-commit-message-ai').QaapCommitMessageAi;
    /** Rewrites composer drafts via the selected language model. */
    composerPromptImprover?: import('./qaap-composer-prompt-improver').QaapComposerPromptImprover;
    /** Opens AI / Settings preferences inside the Work Hub instead of the IDE main area. */
    openPreferencesSheet?: (query?: string) => Promise<void>;
    /** Opens Billing (plan, runtime, Codex credits) inside the Work Hub overlay. */
    openBillingSheet?: () => Promise<void>;
    /** Opens AI Configuration (agents, MCP, prompts) inside the Work Hub overlay. */
    openAiConfigurationSheet?: (tabId?: string) => Promise<void>;
    /** Extra header overflow menu groups for embedding surfaces such as the IDE AI Chat slot. */
    headerOverflowMenuGroups?: () => MobileProjectsHeaderOverflowMenuItem[][];
    /** Container used by the sessions sidebar; defaults to document.body for the full WorkHub shell. */
    sessionsSidebarContainer?: () => HTMLElement | undefined;
    /** IDE mobile view selector mounted in the WorkHub header. */
    mobileIdeViewPicker?: {
        isVisible(): boolean;
        getOptions(): Array<{ id: string; label: string; icon: string }>;
        getActiveId(): string;
        onSelect(id: string): void | Promise<void>;
    };
    /** Agent-finished toast contribution — the panel registers navigation callbacks on it. */
    agentFinishedToast?: import('./qaap-agent-finished-toast-contribution').QaapAgentFinishedToastContribution;
    /** Persistent dev-server orchestration for transcript Preview tab. */
    projectBootstrap?: QaapProjectBootstrapService;
    /** AG-UI frontend tool registry for live transcript tool execution. */
    agUiFrontendTools?: import('./qaap-ag-ui-frontend-tool-service').QaapAgUiFrontendToolService;
    /** Expands `/skill-name` slash tokens into inline skill instructions before VPS submit. */
    expandComposerDraftForSubmit?: (draft: string) => Promise<string>;
    /** Resolves attached files/images/context chips into the outbound VPS prompt. */
    applyComposerAttachmentsToDraft?: (
        draft: string,
        variables?: import('@theia/ai-core').AIVariableResolutionRequest[],
    ) => Promise<string>;
    /** Bridges Monaco editor selection into sticky/transcript composer context chips. */
    composerEditorContextService?: import('./qaap-composer-editor-context-service').QaapComposerEditorContextService;
}

export interface MobileProjectsHeaderOverflowMenuItem {
    label: string;
    icon: string;
    command?: string;
    isVisible?: () => boolean;
    isEnabled?: () => boolean;
    run?: () => void | Promise<void>;
}

export type WorkHubSearchTarget =
    | { readonly kind: 'project'; readonly projectId: string }
    | { readonly kind: 'conversation'; readonly projectId: string; readonly conversationId: string }
    | { readonly kind: 'pullRequest'; readonly pullRequest: QaapGithubPullRequestSummary }
    | { readonly kind: 'catalog'; readonly action: WorkHubCatalogAction };

export interface WorkHubSearchPickItem extends QuickPickItem {
    readonly target: WorkHubSearchTarget;
}

export interface QaapDiffProjectTab {
    projectId: string;
    label: string;
    rootUri: string;
    rootFsPath: string;
    isActiveWorkspace: boolean;
    fileCount: number;
}

/** Tabs of the transcript sheet (execution view). 'messages' is the chat tab. */
export type { ExecutionSurfaceTabId };
export type TranscriptTab = ExecutionSurfaceTabId;

/** Max cached full conversation DTOs kept in memory for a long-lived Work Hub tab (LRU-evicted). */
export const TRANSCRIPT_CONVERSATION_CACHE_LIMIT = 50;
