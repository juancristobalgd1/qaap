// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import * as markdownit from '@theia/core/shared/markdown-it';
import * as markdownitemoji from '@theia/core/shared/markdown-it-emoji';
import type { QuickPick } from '@theia/core/lib/common/quick-pick-service';
import { QuickInputService, QuickPickItem } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { AIVariable, AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatAgent, ChatService, ChatSession } from '@theia/ai-chat';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { MobileProjectChatViewWidget } from './mobile-project-ai-chat-input-widget';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import {
    MobileProjectEntry,
    MobileProjectFilter,
    MobileProjectsHubView,
} from './mobile-projects-types';
import { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileProjectsConversationFlags } from './mobile-projects-conversation-flags';
import { MobileProjectsParallelUi } from './mobile-projects-parallel-ui';
import { MobileProjectsTeamUi } from './mobile-projects-team-ui';
import { MobileProjectsTeamHubUi, type WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import type { QaapWorkHubProjectSkillRoots } from './qaap-work-hub-project-skill-roots';
import {
    type WorkHubTeamMember,
} from '../common/qaap-work-hub-team';
import { MobileProjectsHomeUi, type WorkHubHomeNavigateTarget, type WorkHubHomeQuickActionId } from './mobile-projects-home-ui';
import { MobileProjectsService } from './mobile-projects-service';
import {
    buildAgentsHubIdleConversationSummary,
    isAgentsHubExecutionSurfacePainted,
    isAgentsHubIdleConversationSummary,
} from '../common/qaap-agents-hub-landing';
import { normalizeQaapPreviewConversationId } from '../common/qaap-preview-identity';
import { resolvePreviewFeedbackSubmitTarget } from '../common/qaap-preview-feedback-submit-target';
import { QaapChatViewStreamUpdateScheduler } from '../common/qaap-chat-view-stream-update-scheduler';
import {
    buildProbeStreamingSummaries,
    ensureProbeWorkspaceProject,
    QAAP_PROBE_WORKSPACE_PROJECT_ID,
} from './qaap-work-hub-perf-probe-host';
import { installQaapWorkHubPerfProbe } from './qaap-work-hub-perf-probe';
import type { WorkHubPerfProbeDiagnostics } from '../common/qaap-work-hub-perf-probe';
import { QaapBoundedLruMap } from './qaap-bounded-lru-map';
import {
    getConversation,
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { formatConversationForClipboard } from '../common/qaap-conversation-clipboard-text';
import {
    agentHasCliOAuthLogin,
    localizeAgentSettingsApiKeyLoginMessage,
} from '../common/qaap-agent-auth-login';
import { resolveAgentDisplayLabel } from './qaap-agent-ui';
import { MobileSnackbar } from './mobile-snackbar';
import { MobileOpenRepositoryDialog } from './mobile-open-repository-dialog';
import {
    type QaapAgentTaskAgentOption,
    type QaapQaiqModelOption,
    type QaapAgentTaskListSnapshot,
} from '../common/qaap-agent-task-client';
import {
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    type StickyComposerContextChipView,
} from './qaap-sticky-composer-context-ui';
import {
    createComposerContextEntry,
    revokeComposerContextPreview,
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    buildPreviewFeedbackAttachmentRequest,
    findPreviewFeedbackEntryIndex,
    normalizeAttachComposerImages,
    type QaapAttachComposerImageAttachment,
} from '../common/qaap-preview-feedback-context';
import { URI } from '@theia/core/lib/common/uri';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import { type QaapSegmentedFieldController } from './qaap-mobile-form-ui';
import {
    buildQaapAccountMenuEntries,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
    toggleQaapAccountMenu,
    type MobileViewToggleId,
} from './qaap-workbench-account-menu';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { QaapPreviewSurfaceRegistry } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import type { QaapPreviewInspectorDeps } from '@theia/qaap-adapters/lib/browser/qaap-preview-inline-inspector';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import { createAnnotationComposerSessionControls } from './qaap-preview-annotation-composer-session';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import {
    type ExecutionSurfaceTabId,
} from '../common/qaap-execution-surface-tabs';
import { MobileProjectsExecutionSurfaceTabsUi, type MobileProjectsExecutionSurfaceTabsHost } from './mobile-projects-execution-surface-tabs-ui';
import { type MobileProjectsTranscriptOverlayHost } from './mobile-projects-transcript-overlay-host';
import { TranscriptOverlayController } from './mobile-projects-transcript-overlay-controller';
import { bindTranscriptOverlayStateAccessors } from './mobile-projects-transcript-overlay-state';
import type { WorkHubTranscriptBridge } from './work-hub-transcript-bridge';
import type { MobileBottomButtonId } from './mobile-shell-bottom-bar-widget';
import { MobileProjectsTasksHubUi, type MobileProjectsTasksHubHost } from './mobile-projects-tasks-hub-ui';
import { MobileProjectsWorkHubInboxUi, type MobileProjectsWorkHubInboxHost } from './mobile-projects-work-hub-inbox-ui';
import { MobileProjectsTheiaChatSessionUi, type MobileProjectsTheiaChatSessionHost } from './mobile-projects-theia-chat-session-ui';
import { MobileProjectsHubCatalogUi, type MobileProjectsHubCatalogHost } from './mobile-projects-hub-catalog-ui';
import { MobileProjectsHubRoutinesUi, type MobileProjectsHubRoutinesHost } from './mobile-projects-hub-routines-ui';
import { MobileProjectsHubResearchUi, type MobileProjectsHubResearchHost } from './mobile-projects-hub-research-ui';
import { MobileProjectsHubResearchEditorUi, type MobileProjectsHubResearchEditorHost } from './mobile-projects-hub-research-editor-ui';
import { MobileProjectsHubRoutineEditorUi, type MobileProjectsHubRoutineEditorHost } from './mobile-projects-hub-routine-editor-ui';
import { MobileProjectsReposHubUi, type MobileProjectsReposHubHost } from './mobile-projects-repos-hub-ui';
import { MobileProjectsProjectActionsUi, type MobileProjectsProjectActionsHost } from './mobile-projects-project-actions-ui';
import { MobileProjectsInboxPrUi, type MobileProjectsInboxPrHost } from './mobile-projects-inbox-pr-ui';
import { MobileProjectsCardMenuUi, type MobileProjectsCardMenuHost } from './mobile-projects-card-menu-ui';
import {
    MobileProjectsProjectRowsUi,
    MOBILE_PROJECTS_CONVERSATIONS_COLLAPSED_LIMIT,
    type MobileProjectsProjectRowsHost,
} from './mobile-projects-project-rows-ui';
import { MobileProjectsHubTeamDataUi, type MobileProjectsHubTeamDataHost } from './mobile-projects-hub-team-data-ui';
import { MobileProjectsConversationActionsUi, type MobileProjectsConversationActionsHost } from './mobile-projects-conversation-actions-ui';
import { MobileProjectsAgentsHubInlineUi, type MobileProjectsAgentsHubInlineHost } from './mobile-projects-agents-hub-inline-ui';
import {
    MobileProjectsBackgroundTaskUi,
    type MobileProjectsBackgroundTaskHost,
} from './mobile-projects-background-task-ui';
import {
    MobileProjectsChatServiceSummariesUi,
    type MobileProjectsChatServiceSummariesHost,
} from './mobile-projects-chat-service-summaries-ui';
import {
    MobileProjectsComposerHeaderUi,
    type MobileProjectsComposerHeaderHost,
} from './mobile-projects-composer-header-ui';
import {
    MobileProjectsConversationIndexUi,
    type MobileProjectsConversationIndexHost,
} from './mobile-projects-conversation-index-ui';
import {
    MobileProjectsConversationOpenUi,
    type MobileProjectsConversationOpenHost,
} from './mobile-projects-conversation-open-ui';
import {
    MobileProjectsDiffHubUi,
    type MobileProjectsDiffHubHost,
} from './mobile-projects-diff-hub-ui';
import {
    MobileProjectsHomeHubUi,
    type MobileProjectsHomeHubHost,
} from './mobile-projects-home-hub-ui';
import {
    MobileProjectsMissionControlHubUi,
} from './mobile-projects-mission-control-hub-ui';
import type {
    MissionControlLaneFilter,
    MissionControlSurfaceFilter,
} from './mobile-work-mission-control';
import {
    MobileProjectsHubHeaderUi,
    type MobileProjectsHubHeaderHost,
} from './mobile-projects-hub-header-ui';
import {
    MobileProjectsHubLandingUi,
    type MobileProjectsHubLandingHost,
} from './mobile-projects-hub-landing-ui';
import {
    MobileProjectsHubListChromeUi,
    type MobileProjectsHubListChromeHost,
} from './mobile-projects-hub-list-chrome-ui';
import {
    MobileProjectsHubQueryUi,
    type MobileProjectsHubQueryHost,
} from './mobile-projects-hub-query-ui';
import {
    MobileProjectsHubRenderUi,
    type MobileProjectsHubRenderHost,
} from './mobile-projects-hub-render-ui';
import {
    MobileProjectsOverlayFactoryUi,
    type MobileProjectsOverlayFactoryHost,
} from './mobile-projects-overlay-factory-ui';
import {
    MobileProjectsProjectDetailUi,
    type MobileProjectsProjectDetailHost,
} from './mobile-projects-project-detail-ui';
import {
    MobileProjectsProjectNavigationUi,
    type MobileProjectsProjectNavigationHost,
} from './mobile-projects-project-navigation-ui';
import {
    MobileProjectsHubIncrementalUi,
    type MobileProjectsHubIncrementalPatchHost,
} from './mobile-projects-hub-incremental-ui';
import {
    MobileProjectsRenderListUi,
    type MobileProjectsRenderListHost,
} from './mobile-projects-render-list-ui';
import {
    MobileProjectsRepoFiltersUi,
    type MobileProjectsRepoFiltersHost,
} from './mobile-projects-repo-filters-ui';
import {
    MobileProjectsRepoLifecycleUi,
    type MobileProjectsRepoLifecycleHost,
} from './mobile-projects-repo-lifecycle-ui';
import {
    MobileProjectsSubtitleUi,
    type MobileProjectsSubtitleHost,
} from './mobile-projects-subtitle-ui';
import {
    MobileProjectsTasksHubAttentionUi,
    type MobileProjectsTasksHubAttentionHost,
} from './mobile-projects-tasks-hub-attention-ui';
import {
    MobileProjectsPanelLifecycleUi,
    type MobileProjectsPanelLifecycleHost,
} from './mobile-projects-panel-lifecycle-ui';
import {
    MobileProjectsPanelChromeUi,
    type MobileProjectsPanelChromeHost,
} from './mobile-projects-panel-chrome-ui';
import {
    MobileProjectsActiveTaskActionsUi,
    type MobileProjectsActiveTaskActionsHost,
} from './mobile-projects-active-task-actions-ui';
import {
    MobileProjectsWorkHubSearchUi,
    type MobileProjectsWorkHubSearchHost,
} from './mobile-projects-work-hub-search-ui';
import {
    MobileProjectsStickyComposerContextUi,
    type MobileProjectsStickyComposerContextHost,
} from './mobile-projects-sticky-composer-context-ui';
import {
    MobileProjectsStickyComposerAgentsUi,
    type MobileProjectsStickyComposerAgentsHost,
} from './mobile-projects-sticky-composer-agents-ui';
import {
    MobileProjectsStickyComposerSheetsUi,
    type MobileProjectsStickyComposerSheetsHost,
} from './mobile-projects-sticky-composer-sheets-ui';
import {
    MobileProjectsStickyComposerWorkspaceUi,
    type MobileProjectsStickyComposerWorkspaceHost,
} from './mobile-projects-sticky-composer-workspace-ui';
import {
    MobileProjectsStickyComposerColumnUi,
    type MobileProjectsStickyComposerColumnHost,
} from './mobile-projects-sticky-composer-column-ui';
import {
    MobileProjectsStickyComposerRenderUi,
    type MobileProjectsStickyComposerRenderHost,
} from './mobile-projects-sticky-composer-render-ui';
import {
    type QaapTranscriptLiveRefreshOptions,
} from './qaap-transcript-live-controller';
import {
    MobileProjectsSessionsSidebarUi,
    type MobileProjectsSessionsSidebarHost,
} from './mobile-projects-sessions-sidebar-ui';
import { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import {
    type WorkHubHomeAttentionItem,
    type WorkHubHomeRecentItem,
    type WorkHubHomeSnapshot,
} from '../common/qaap-work-hub-home';
import {
    type QaapComposerSurface,
} from '../common/qaap-composer-surface';
import {
    QAAP_WORK_HUB_GETTING_STARTED,
    type WorkHubCatalogAction,
} from '../common/mobile-work-hub-catalog';
import {
    type QaapWorkHubRoutine,
} from '../common/qaap-work-hub-routine';
import {
    type MobileWorkHubInboxItem,
} from './mobile-work-hub-inbox';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import { QaapDiffReviewWidget } from './qaap-diff-review-widget';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT } from './qaap-mobile-app-tester-contribution';
import { FileUri } from '@theia/core/lib/common/file-uri';
import type { TranscriptFilesViewServices } from './qaap-transcript-files-view';
import type { TranscriptTerminalViewServices } from './qaap-transcript-terminal-view';
import {
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';

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
    /** Show Work Hub Routines from the sessions sidebar. */
    onShowRoutinesHub?(): void | Promise<void>;
    /** Show Work Hub Research from the sessions sidebar. */
    onShowResearchHub?(): void | Promise<void>;
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

type WorkHubSearchTarget =
    | { readonly kind: 'project'; readonly projectId: string }
    | { readonly kind: 'conversation'; readonly projectId: string; readonly conversationId: string }
    | { readonly kind: 'pullRequest'; readonly pullRequest: QaapGithubPullRequestSummary }
    | { readonly kind: 'catalog'; readonly action: WorkHubCatalogAction }
    | { readonly kind: 'routine'; readonly routineId: string };

interface WorkHubSearchPickItem extends QuickPickItem {
    readonly target: WorkHubSearchTarget;
}

interface QaapDiffProjectTab {
    projectId: string;
    label: string;
    rootUri: string;
    rootFsPath: string;
    isActiveWorkspace: boolean;
    fileCount: number;
}

/** Tabs of the transcript sheet (execution view). 'messages' is the chat tab. */
type TranscriptTab = ExecutionSurfaceTabId;

const QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE = 'qaap.mobile.ideHeaderView.activate';

/** Max cached full conversation DTOs kept in memory for a long-lived Work Hub tab (LRU-evicted). */
const TRANSCRIPT_CONVERSATION_CACHE_LIMIT = 50;

export class MobileProjectsPanel implements WorkHubTranscriptBridge {

    /** Max conversation rows per repo card before "More" expands the list. */
    protected static readonly CONVERSATIONS_COLLAPSED_LIMIT = MOBILE_PROJECTS_CONVERSATIONS_COLLAPSED_LIMIT;

    /** Max automatic verify→fix loops before the closed loop gives up (avoids runaway turns/cost). */
    protected readonly transcriptMarkdownIt = markdownit({ linkify: false }).use(markdownitemoji.full);

    protected readonly root: HTMLElement;
    protected readonly scroll: HTMLElement;
    protected readonly stickyComposerHost: HTMLElement;
    protected readonly subtitleEl: HTMLElement;
    protected readonly filtersHost: HTMLElement;
    protected readonly searchToggleBtn: HTMLButtonElement;
    protected workHubSearchQuickPick: QuickPick<WorkHubSearchPickItem> | undefined;
    protected workHubSearchQuickPickDispose: Disposable = Disposable.NULL;
    protected readonly accountBtn: HTMLButtonElement;
    protected readonly accountAvatar: HTMLSpanElement;
    protected readonly titleBlock: HTMLElement;
    protected readonly titleRow: HTMLElement;
    protected readonly titleEl: HTMLHeadingElement;
    protected readonly titleAttentionEl: HTMLSpanElement;
    protected readonly headerBackBtn: HTMLButtonElement;
    protected readonly sessionsMenuBtn: HTMLButtonElement;
    protected readonly headerProjectBtn: HTMLButtonElement;
    protected readonly headerProjectLabelEl: HTMLSpanElement;
    protected readonly headerNewChatBtn: HTMLButtonElement;
    protected readonly headerOverflowMenuBtn: HTMLButtonElement;
    protected readonly newFabBtn: HTMLButtonElement;
    protected readonly headerIdeViewPickerHost: HTMLElement;
    protected readonly headerSurfacePickerHost: HTMLElement;
    protected readonly headerExecutionCluster: HTMLElement;
    protected readonly headerPreviewRunHost: HTMLElement;
    protected readonly headerFilesMoreHost: HTMLElement;
    protected readonly headerExecutionTabsHost: HTMLElement;
    protected headerSurfacePicker?: QaapSegmentedFieldController<MobileBottomButtonId>;
    protected headerIdeViewPickerBtn: HTMLButtonElement | undefined;
    protected headerIdeViewPickerMenu: HTMLElement | undefined;
    protected headerIdeViewPickerDismiss: Disposable = Disposable.NULL;
    protected headerExecutionTabsProjectId: string | undefined;
    protected filter: MobileProjectFilter = 'all';
    protected hubView: MobileProjectsHubView = 'tasks';
    protected query = '';
    protected missionControlExpanded = false;
    protected missionControlLaneFilter: MissionControlLaneFilter = 'all';
    protected missionControlSurfaceFilter: MissionControlSurfaceFilter = 'all';
    protected agentApprovalsFetchGeneration = 0;
    /** Project ids whose conversation list is fully expanded (not capped at {@link CONVERSATIONS_COLLAPSED_LIMIT}). */
    protected readonly expandedConversationProjectIds = new Set<string>();
    protected readonly diffProjectTabsHost: HTMLElement;
    protected readonly diffWidgetHost: HTMLElement;
    protected diffProjectTabs: QaapDiffProjectTab[] = [];
    protected diffActiveProjectId: string | undefined;
    protected diffScanning = false;
    protected diffPendingPreferredProjectId: string | undefined;
    /** When true, diff is scoped to one repo (workspace sheet) instead of cross-project hub tabs. */
    protected diffScopedToProject = false;
    /** Project row to restore when leaving a scoped diff via the header back control. */
    protected diffReturnProjectId: string | undefined;
    protected projects: MobileProjectEntry[] = [];
    protected visible = false;
    /** Id of the single project row currently expanded; undefined when all are collapsed. */
    protected expandedId: string | undefined;
    /**
     * True when the expansion was driven by the user (vs. the auto-expand of the current workspace
     * at render time). When true, renderList hides the other project rows so the user can focus
     * on the expanded project's chats without surrounding noise; collapsing restores the full list.
     */
    protected soloExpanded = false;
    /** Once the user collapses the current workspace row, do not auto-expand it again. */
    protected suppressCurrentAutoExpand = false;
    /** Last measured lift for the home FAB so it does not jump when the sticky composer hides. */
    protected stickyComposerFabLiftPx = 0;
    protected stickyComposerFabLiftObserver: ResizeObserver | undefined;
    protected stickyComposerDraft = '';
    protected stickyComposerContext: StickyComposerContextEntry[] = [];
    protected stickyComposerFilesExpanded = true;
    protected stickyComposerPinnedAgentId: string | undefined;
    protected stickyComposerBackendAgents: QaapAgentTaskAgentOption[] = [];
    protected stickyComposerQaiqModels: QaapQaiqModelOption[] = [];
    protected stickyComposerAgentSheet: HTMLElement | undefined;
    protected stickyComposerModeSheet: HTMLElement | undefined;
    protected stickyComposerApprovalSheet: HTMLElement | undefined;
    protected stickyComposerWorkspaceSheet: HTMLElement | undefined;
    protected stickyComposerContextUsageSheet: HTMLElement | undefined;
    protected stickyComposerCapabilitySheet: HTMLElement | undefined;
    protected agentsHubSelectedProjectId: string | undefined;
    protected readonly composerWorkspaceBranchByProjectId = new Map<string, string>();
    protected stickyComposerModeId: string | undefined;
    protected stickyComposerCapabilityLevel: import('../common/qaap-sticky-composer-model-capability').ModelCapabilityLevelValue | undefined;
    protected stickyComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    protected stickyComposerToolApprovalRules: QaapAgentToolApprovalRules | undefined;
    protected stickyComposerSurface: QaapComposerSurface = 'task';
    protected tasksHubSurface: QaapComposerSurface = 'task';
    /** When true, Agents tab shows the legacy full inbox instead of the new landing. */
    protected agentsHubLegacyInbox = false;
    protected sessionsSidebar: MobileWorkHubSessionsSidebar | undefined;
    /** Project session groups expanded in the sessions sidebar accordion. */
    protected readonly sessionsSidebarExpandedProjectIds = new Set<string>();
    /** Per-project visible session count in the sidebar (undefined → default collapsed limit). */
    protected readonly sessionsSidebarVisibleConversationCountByProjectId = new Map<string, number>();
    protected sessionsSidebarAccordionDefaultsApplied = false;
    protected agentChatInputSession: ChatSession | undefined;
    // Bounded so a long-lived tab that opens many conversations does not retain every full DTO for
    // the tab's lifetime (each can be tens of KB). LRU keeps the recently-viewed ones hot.
    protected readonly transcriptConversationCache: Map<string, QaapAgentConversationDTO> =
        new QaapBoundedLruMap<string, QaapAgentConversationDTO>(TRANSCRIPT_CONVERSATION_CACHE_LIMIT);

    /** Transcript overlay controller — state bag + `MobileProjectsTranscript*Ui` modules (Phase 3). */
    protected transcriptController!: TranscriptOverlayController;

    /** Single cast surface for all `MobileProjectsTranscript*Ui` host contracts. */
    protected get transcriptOverlayHost(): MobileProjectsTranscriptOverlayHost {
        return this as unknown as MobileProjectsTranscriptOverlayHost;
    }

    protected get transcriptUi() { return this.transcriptController.transcriptUi; }
    protected get transcriptHistoryUi() { return this.transcriptController.historyUi; }
    protected get transcriptComposerUi() { return this.transcriptController.composerUi; }
    protected get transcriptStickyComposerUi() { return this.transcriptController.stickyComposerUi; }
    protected get transcriptSheetUi() { return this.transcriptController.sheetUi; }
    protected get transcriptSurfacesUi() { return this.transcriptController.surfacesUi; }
    protected get transcriptHeaderUi() { return this.transcriptController.headerUi; }
    protected get transcriptSubmitUi() { return this.transcriptController.submitUi; }
    protected get transcriptMessagesUi() { return this.transcriptController.messagesUi; }
    protected get transcriptLiveUi() { return this.transcriptController.liveUi; }
    protected get transcriptVerifyUi() { return this.transcriptController.verifyUi; }
    protected readonly backgroundTaskUi = new MobileProjectsBackgroundTaskUi(this as unknown as MobileProjectsBackgroundTaskHost);
    protected readonly chatServiceSummariesUi = new MobileProjectsChatServiceSummariesUi(this as unknown as MobileProjectsChatServiceSummariesHost);
    protected readonly composerHeaderUi = new MobileProjectsComposerHeaderUi(this as unknown as MobileProjectsComposerHeaderHost);
    protected readonly sessionsSidebarUi = new MobileProjectsSessionsSidebarUi(this as unknown as MobileProjectsSessionsSidebarHost);
    protected readonly conversationIndexUi = new MobileProjectsConversationIndexUi(this as unknown as MobileProjectsConversationIndexHost);
    protected readonly conversationOpenUi = new MobileProjectsConversationOpenUi(this as unknown as MobileProjectsConversationOpenHost);
    protected readonly diffHubUi = new MobileProjectsDiffHubUi(this as unknown as MobileProjectsDiffHubHost);
    protected readonly homeHubUi = new MobileProjectsHomeHubUi(this as unknown as MobileProjectsHomeHubHost);
    protected readonly missionControlHubUi = new MobileProjectsMissionControlHubUi(this as unknown as import('./mobile-projects-mission-control-hub-ui').MobileProjectsMissionControlHubHost);
    protected readonly hubHeaderUi = new MobileProjectsHubHeaderUi(this as unknown as MobileProjectsHubHeaderHost);
    protected readonly hubLandingUi = new MobileProjectsHubLandingUi(this as unknown as MobileProjectsHubLandingHost);
    protected readonly hubListChromeUi = new MobileProjectsHubListChromeUi(this as unknown as MobileProjectsHubListChromeHost);
    protected readonly hubQueryUi = new MobileProjectsHubQueryUi(this as unknown as MobileProjectsHubQueryHost);
    protected readonly hubRenderUi = new MobileProjectsHubRenderUi(this as unknown as MobileProjectsHubRenderHost);
    protected readonly overlayFactoryUi = new MobileProjectsOverlayFactoryUi(this as unknown as MobileProjectsOverlayFactoryHost);
    protected readonly panelLifecycleUi = new MobileProjectsPanelLifecycleUi(this as unknown as MobileProjectsPanelLifecycleHost);
    protected readonly panelChromeUi = new MobileProjectsPanelChromeUi(this as unknown as MobileProjectsPanelChromeHost);
    protected readonly activeTaskActionsUi = new MobileProjectsActiveTaskActionsUi(this as unknown as MobileProjectsActiveTaskActionsHost);
    protected readonly projectDetailUi = new MobileProjectsProjectDetailUi(this as unknown as MobileProjectsProjectDetailHost);
    protected readonly projectNavigationUi = new MobileProjectsProjectNavigationUi(this as unknown as MobileProjectsProjectNavigationHost);
    protected readonly renderListUi = new MobileProjectsRenderListUi(this as unknown as MobileProjectsRenderListHost);
    protected readonly hubIncrementalUi = new MobileProjectsHubIncrementalUi(this as unknown as MobileProjectsHubIncrementalPatchHost);
    /** Coalesces bursty hub list rebuilds from WS/SSE into one paint per animation frame. */
    protected readonly hubListRenderScheduler = new QaapChatViewStreamUpdateScheduler(
        () => this.renderListUi.renderList(),
        () => 0,
    );
    protected readonly repoFiltersUi = new MobileProjectsRepoFiltersUi(this as unknown as MobileProjectsRepoFiltersHost);
    protected readonly repoLifecycleUi = new MobileProjectsRepoLifecycleUi(this as unknown as MobileProjectsRepoLifecycleHost);
    protected readonly subtitleUi = new MobileProjectsSubtitleUi(this as unknown as MobileProjectsSubtitleHost);
    protected readonly tasksHubAttentionUi = new MobileProjectsTasksHubAttentionUi(this as unknown as MobileProjectsTasksHubAttentionHost);
    protected readonly workHubSearchUi = new MobileProjectsWorkHubSearchUi(this as unknown as MobileProjectsWorkHubSearchHost);
    protected readonly stickyComposerContextUi = new MobileProjectsStickyComposerContextUi(this as unknown as MobileProjectsStickyComposerContextHost);
    protected readonly stickyComposerAgentsUi = new MobileProjectsStickyComposerAgentsUi(this as unknown as MobileProjectsStickyComposerAgentsHost);
    protected readonly stickyComposerSheetsUi = new MobileProjectsStickyComposerSheetsUi(this as unknown as MobileProjectsStickyComposerSheetsHost);
    protected readonly stickyComposerWorkspaceUi = new MobileProjectsStickyComposerWorkspaceUi(this as unknown as MobileProjectsStickyComposerWorkspaceHost);
    protected readonly stickyComposerColumnUi = new MobileProjectsStickyComposerColumnUi(this as unknown as MobileProjectsStickyComposerColumnHost);
    protected readonly stickyComposerRenderUi = new MobileProjectsStickyComposerRenderUi(this as unknown as MobileProjectsStickyComposerRenderHost);
    protected readonly executionSurfaceTabsUi = new MobileProjectsExecutionSurfaceTabsUi(this as unknown as MobileProjectsExecutionSurfaceTabsHost);
    protected readonly tasksHubUi = new MobileProjectsTasksHubUi(this as unknown as MobileProjectsTasksHubHost);
    protected readonly hubCatalogUi = new MobileProjectsHubCatalogUi(this as unknown as MobileProjectsHubCatalogHost);
    protected readonly reposHubUi = new MobileProjectsReposHubUi(this as unknown as MobileProjectsReposHubHost);
    protected readonly inboxPrUi = new MobileProjectsInboxPrUi(this as unknown as MobileProjectsInboxPrHost);
    protected readonly cardMenuUi = new MobileProjectsCardMenuUi(this as unknown as MobileProjectsCardMenuHost);
    protected readonly projectRowsUi = new MobileProjectsProjectRowsUi(this as unknown as MobileProjectsProjectRowsHost);
    protected readonly hubRoutineEditorUi = new MobileProjectsHubRoutineEditorUi(this as unknown as MobileProjectsHubRoutineEditorHost);
    protected readonly hubRoutinesUi = new MobileProjectsHubRoutinesUi(this as unknown as MobileProjectsHubRoutinesHost);
    protected readonly hubResearchUi = new MobileProjectsHubResearchUi(this as unknown as MobileProjectsHubResearchHost);
    protected readonly hubResearchEditorUi = new MobileProjectsHubResearchEditorUi(this as unknown as MobileProjectsHubResearchEditorHost);
    protected readonly hubTeamDataUi = new MobileProjectsHubTeamDataUi(this as unknown as MobileProjectsHubTeamDataHost);
    protected readonly conversationActionsUi = new MobileProjectsConversationActionsUi(this as unknown as MobileProjectsConversationActionsHost);
    protected readonly projectActionsUi = new MobileProjectsProjectActionsUi(this as unknown as MobileProjectsProjectActionsHost);
    protected readonly workHubInboxUi = new MobileProjectsWorkHubInboxUi(this as unknown as MobileProjectsWorkHubInboxHost);
    protected readonly theiaChatSessionUi = new MobileProjectsTheiaChatSessionUi(this as unknown as MobileProjectsTheiaChatSessionHost);
    protected readonly agentsHubInlineUi = new MobileProjectsAgentsHubInlineUi(this as unknown as MobileProjectsAgentsHubInlineHost);
    /** Shared Changes · Preview · Files · Terminal tab per project (task surface + transcript sheet). */
    protected readonly executionSurfaceTabByProjectId = new Map<string, TranscriptTab>();
    protected projectDetailExpandedId: string | undefined;
    protected projectDetailTabStrip: HTMLElement | undefined;
    protected overlayUi: {
        parallel: MobileProjectsParallelUi;
        team: MobileProjectsTeamUi;
        teamHub: MobileProjectsTeamHubUi;
        home: MobileProjectsHomeUi;
    } | undefined;
    /** Monotonic counter that disambiguates each AIChatInputWidget instance from the WidgetManager cache. */
    protected agentChatInputMountSeq = 0;
    /** Last-flashed task id — drives the highlight animation when a fresh task appears. */
    protected justAddedTaskId: string | undefined;
    /** cwd resolved after clone/prepare — keyed by project id when uri is not yet on the card. */
    protected readonly preparedCwdByProjectId = new Map<string, string>();
    protected inboxPullRequests: QaapGithubPullRequestSummary[] = [];
    protected inboxPullRequestsLoading = false;
    protected inboxPullRequestsLoaded = false;
    /** Server GitHub session for inbox PRs (undefined when no GitHub repos in the hub). */
    protected inboxGithubSignedIn: boolean | undefined;
    /** Bumps when the inbox tab is re-entered so stale PR fetches cannot repaint. */
    protected inboxLoadGeneration = 0;
    /** True until the first conversations prime resolves, so Tasks shows a skeleton instead of an empty flash. */
    protected tasksFirstLoadPending = true;
    /** Safety timer so a rejected initial prime can never strand the Tasks skeleton. */
    protected tasksFirstLoadFallback: number | undefined;
    protected inboxPullRequestsAbort: AbortController | undefined;
    protected workHubRoutines: QaapWorkHubRoutine[] = [];
    protected workHubRoutinesLoading = false;
    protected workHubRoutinesLoaded = false;
    protected workHubRoutinesDefaultAgent: string | undefined;
    protected routineSheet: HTMLElement | undefined;
    protected editingRoutineId: string | undefined;
    protected routinesRefreshTimer: number | undefined;
    protected routineInteractionLock = false;
    protected researchGoals: import('../common/qaap-research-goal').ResearchGoal[] = [];
    protected researchGoalDetails = new Map<string, import('./mobile-projects-hub-research-ui').ResearchGoalDetailCache>();
    protected researchGoalsLoading = false;
    protected researchGoalsLoaded = false;
    protected researchRefreshTimer: number | undefined;
    protected researchSheet: HTMLElement | undefined;
    protected researchInteractionLock = false;
    protected researchExpandedGoalIds = new Set<string>();
    protected readonly chatServiceSessionSummariesByProjectId = new Map<string, QaapAgentConversationSummaryDTO[]>();
    protected executionTabOverflowMenu: HTMLElement | undefined;
    protected executionTabOverflowAnchor: HTMLElement | undefined;
    protected executionTabOverflowDispose: Disposable = Disposable.NULL;
    protected headerOverflowMenu: HTMLElement | undefined;
    protected headerOverflowMenuDismiss: Disposable = Disposable.NULL;
    protected openRepoDialog: MobileOpenRepositoryDialog | undefined;
    protected dragDismissDispose: Disposable = Disposable.NULL;
    protected pullToRefreshDispose: Disposable = Disposable.NULL;
    protected lastTitleTap = 0;
    protected readonly homeMode: boolean;
    protected readonly whenFrontendReadyProvider: (() => Promise<void>) | undefined;
    protected readonly activeTasks: MobileProjectsActiveTasks | undefined;

    /** Resolves when the frontend app is 'ready'; immediately when no provider was wired. */
    whenFrontendReady(): Promise<void> {
        return this.whenFrontendReadyProvider?.() ?? Promise.resolve();
    }
    protected readonly conversations: MobileProjectsConversations | undefined;
    protected readonly backgroundContext: QaapBackgroundContextProvider | undefined;
    protected readonly inboxStream: MobileWorkHubInboxStream | undefined;
    protected readonly conversationFlags: MobileProjectsConversationFlags | undefined;
    protected readonly createChatInputWidget: MobileProjectsPanelOptions['createChatInputWidget'];
    protected readonly createChatViewWidget: MobileProjectsPanelOptions['createChatViewWidget'];
    protected readonly createDiffReviewWidget: MobileProjectsPanelOptions['createDiffReviewWidget'];
    protected readonly pickContextVariable: MobileProjectsPanelOptions['pickContextVariable'];
    protected readonly formatContextChip: MobileProjectsPanelOptions['formatContextChip'];
    protected readonly resolveAttachmentPreview: MobileProjectsPanelOptions['resolveAttachmentPreview'];
    protected readonly getComposerVariables: MobileProjectsPanelOptions['getComposerVariables'];
    protected readonly getComposerSkills: MobileProjectsPanelOptions['getComposerSkills'];
    protected readonly getComposerSlashCommands: MobileProjectsPanelOptions['getComposerSlashCommands'];
    protected readonly chatService: ChatService | undefined;
    protected readonly chatAgentService: ChatAgentService | undefined;
    protected readonly messageService: MessageService | undefined;
    protected readonly resolveVerifyChecks: MobileProjectsPanelOptions['resolveVerifyChecks'];
    protected readonly openTranscriptFile: MobileProjectsPanelOptions['openTranscriptFile'];
    protected readonly uploadComposerFeedbackImages: MobileProjectsPanelOptions['uploadComposerFeedbackImages'];
    protected readonly openTranscriptReviewFile: (filePath: string) => void | Promise<void>;
    protected readonly createTranscriptFilesViewServices: MobileProjectsPanelOptions['createTranscriptFilesViewServices'];
    protected readonly createTranscriptTerminalViewServices: MobileProjectsPanelOptions['createTranscriptTerminalViewServices'];
    protected readonly previewSurfaceRegistry: MobileProjectsPanelOptions['previewSurfaceRegistry'];
    protected readonly previewInspectorDeps: MobileProjectsPanelOptions['previewInspectorDeps'];
    protected readonly previewClipboard: MobileProjectsPanelOptions['clipboard'];
    protected readonly readPreference: MobileProjectsPanelOptions['readPreference'];
    protected readonly preferenceService: PreferenceService | undefined;
    readonly appearanceModeService: MobileProjectsPanelOptions['appearanceModeService'];
    protected readonly getRegisteredLanguageModels: MobileProjectsPanelOptions['getRegisteredLanguageModels'];
    protected readonly quickInputService: QuickInputService | undefined;
    protected readonly commitMessageAi: MobileProjectsPanelOptions['commitMessageAi'];
    protected readonly composerPromptImprover: MobileProjectsPanelOptions['composerPromptImprover'];
    protected readonly openPreferencesSheet: MobileProjectsPanelOptions['openPreferencesSheet'];
    protected readonly openAiConfigurationSheet: MobileProjectsPanelOptions['openAiConfigurationSheet'];
    protected readonly headerOverflowMenuGroups: MobileProjectsPanelOptions['headerOverflowMenuGroups'];
    protected readonly sessionsSidebarContainer: MobileProjectsPanelOptions['sessionsSidebarContainer'];
    protected readonly mobileIdeViewPicker: MobileProjectsPanelOptions['mobileIdeViewPicker'];
    readonly projectBootstrap: QaapProjectBootstrapService | undefined;
    readonly agUiFrontendTools: MobileProjectsPanelOptions['agUiFrontendTools'];
    protected readonly expandComposerDraftForSubmit: MobileProjectsPanelOptions['expandComposerDraftForSubmit'];
    protected readonly applyComposerAttachmentsToDraft: MobileProjectsPanelOptions['applyComposerAttachmentsToDraft'];
    protected readonly composerEditorContextService: MobileProjectsPanelOptions['composerEditorContextService'];
    protected readonly workHubProjectSkillRoots: QaapWorkHubProjectSkillRoots | undefined;
    protected activeTasksDispose: Disposable = Disposable.NULL;
    protected conversationsDispose: Disposable = Disposable.NULL;
    protected inboxStreamDispose: Disposable = Disposable.NULL;
    protected chatServiceDispose: Disposable = Disposable.NULL;
    protected agentsHubEmptySurfaceGuardDispose: Disposable = Disposable.NULL;
    protected readonly chatSessionModelDisposables = new Map<string, Disposable>();
    protected readonly chatSessionProjectIds = new Map<string, string>();
    protected chatServiceRefreshHandle: number | undefined;
    /** Agents tab: unified execution shell (tabs + surfaces) in-panel, no body overlay. */
    protected agentsHubShellActive = false;
    /** Agents tab: a real session is open in the shell (header back returns to idle shell). */
    protected agentsHubInlineActive = false;
    protected agentsHubInlineChatHost: HTMLElement | undefined;
    protected agentsHubInlineTranscriptRoot: HTMLElement | undefined;
    protected agentsHubInlineExecutionRoot: HTMLElement | undefined;
    protected agentsHubInlineTabStrip: HTMLElement | undefined;
    protected readonly onDocumentPointerDown = (ev: PointerEvent): void => {
        this.cardMenuUi.handleDocumentPointerDown(ev);
    };

    protected refreshProjectsInFlight: Promise<void> | undefined;

    protected readonly onAuthSessionChanged = (): void => {
        this.panelLifecycleUi.updateAccountAvatar();
        this.sessionsSidebar?.updateAccountAvatar();
        if (this.hubView === 'tasks') {
            this.resetInboxPullRequestState();
            void this.refreshInboxPullRequests(undefined, true);
        }
        if (this.refreshProjectsInFlight) {
            return;
        }
        this.refreshProjectsInFlight = this.refreshProjects().finally(() => {
            this.refreshProjectsInFlight = undefined;
        });
    };

    protected readonly onAccountClick = (): void => {
        const viewToggle = {
            activeId: this.composerHeaderUi.resolveActiveViewToggleId(),
            onSelect: (id: MobileViewToggleId) => {
                if (id === 'editor') {
                    void this.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
                    return;
                }
                void this.commands.executeCommand('qaap.mobile.ideHeaderView.activate', id);
            },
        };
        toggleQaapAccountMenu(
            this.accountBtn,
            this.commands,
            buildQaapAccountMenuEntries(readQaapSignedIn()),
            {
                section: QAAP_WORK_HUB_GETTING_STARTED,
                onCatalogAction: action => { void this.runCatalogAction(action); },
            },
            undefined,
            viewToggle,
        );
    };

    constructor(
        protected readonly projectsService: MobileProjectsService,
        protected readonly commands: CommandRegistry,
        protected readonly delegate: MobileProjectsPanelDelegate,
        options: MobileProjectsPanelOptions = {},
    ) {
        this.transcriptController = new TranscriptOverlayController(
            this as unknown as MobileProjectsTranscriptOverlayHost,
            this,
        );
        bindTranscriptOverlayStateAccessors(this, this.transcriptController.state);
        this.homeMode = !!options.homeMode;
        this.whenFrontendReadyProvider = options.whenFrontendReady;
        this.activeTasks = options.activeTasks;
        this.conversations = options.conversations;
        this.backgroundContext = options.backgroundContext;
        this.inboxStream = options.inboxStream;
        this.conversationFlags = options.conversationFlags;
        this.createChatInputWidget = options.createChatInputWidget;
        this.createChatViewWidget = options.createChatViewWidget;
        this.createDiffReviewWidget = options.createDiffReviewWidget;
        this.pickContextVariable = options.pickContextVariable;
        this.formatContextChip = options.formatContextChip;
        this.resolveAttachmentPreview = options.resolveAttachmentPreview;
        this.getComposerVariables = options.getComposerVariables;
        this.getComposerSkills = options.getComposerSkills;
        this.getComposerSlashCommands = options.getComposerSlashCommands;
        this.chatService = options.chatService;
        this.chatAgentService = options.chatAgentService;
        this.messageService = options.messageService;
        this.resolveVerifyChecks = options.resolveVerifyChecks;
        this.uploadComposerFeedbackImages = options.uploadComposerFeedbackImages;
        const editorOpenFallback = options.openTranscriptFile;
        this.openTranscriptFile = filePath => {
            const state = this.transcriptController.state;
            const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
            const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
            if (project && summary) {
                return this.transcriptSurfacesUi.revealTranscriptFile(project, summary, filePath);
            }
            if (editorOpenFallback) {
                return editorOpenFallback(filePath);
            }
        };
        this.openTranscriptReviewFile = filePath => {
            const state = this.transcriptController.state;
            const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
            const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
            if (project && summary) {
                return this.transcriptSurfacesUi.revealTranscriptReviewFile(project, summary, filePath);
            }
        };
        this.createTranscriptFilesViewServices = options.createTranscriptFilesViewServices;
        this.createTranscriptTerminalViewServices = options.createTranscriptTerminalViewServices;
        this.previewSurfaceRegistry = options.previewSurfaceRegistry;
        this.previewInspectorDeps = options.previewInspectorDeps;
        this.previewClipboard = options.clipboard;
        this.readPreference = options.readPreference;
        this.preferenceService = options.preferenceService;
        this.appearanceModeService = options.appearanceModeService;
        this.getRegisteredLanguageModels = options.getRegisteredLanguageModels;
        this.quickInputService = options.quickInputService;
        this.commitMessageAi = options.commitMessageAi;
        this.composerPromptImprover = options.composerPromptImprover;
        this.openPreferencesSheet = options.openPreferencesSheet;
        this.openAiConfigurationSheet = options.openAiConfigurationSheet;
        this.headerOverflowMenuGroups = options.headerOverflowMenuGroups;
        this.sessionsSidebarContainer = options.sessionsSidebarContainer ?? (() => this.shouldEmbedSessionsSidebarInPanel() ? this.root : undefined);
        this.mobileIdeViewPicker = options.mobileIdeViewPicker;
        this.projectBootstrap = options.projectBootstrap;
        this.agUiFrontendTools = options.agUiFrontendTools;
        this.expandComposerDraftForSubmit = options.expandComposerDraftForSubmit;
        this.applyComposerAttachmentsToDraft = options.applyComposerAttachmentsToDraft;
        this.composerEditorContextService = options.composerEditorContextService;
        this.workHubProjectSkillRoots = options.workHubProjectSkillRoots;
        this.root = document.createElement('div');
        this.root.className = this.homeMode ? 'theia-mobile-projects theia-mod-home' : 'theia-mobile-projects';
        if (!this.homeMode) {
            this.root.setAttribute('role', 'dialog');
            this.root.setAttribute('aria-modal', 'true');
        }
        this.root.setAttribute('aria-hidden', 'true');
        this.root.hidden = true;

        const grabber = this.panelChromeUi.constructPanelShell();
        this.panelChromeUi.wirePanelInteractions(grabber, this.onAuthSessionChanged);
        this.installAgentsHubEmptySurfaceGuard();
        window.addEventListener(QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT, this.onBootstrapPreviewOpened);
    }

    /**
     * The bootstrap just opened/navigated the IDE mini-browser preview widget. While the Work Hub
     * is the foreground surface that widget sits hidden behind the hub overlay and is suspended to
     * `about:blank`, so every "Open preview" affordance looked like a silent no-op. Mirror the
     * navigation into the hub's own Preview tab — but only for explicit user-initiated opens
     * (pill / link / manual). Agent/auto paths must not yank the transcript to Browser.
     */
    protected readonly onBootstrapPreviewOpened = (event: Event): void => {
        if (!this.visible || !this.agentsHubShellActive) {
            return;
        }
        const detail = (event as CustomEvent<{ userInitiated?: boolean }>).detail;
        // Explicit false = agent/auto path. Missing detail = legacy user focusPreview.
        if (detail?.userInitiated === false) {
            return;
        }
        const state = this.transcriptController.state;
        const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        if (!project || !summary) {
            return;
        }
        // The bootstrap is scoped to the ACTIVE workspace. If the open transcript belongs to a
        // different project, surfacing its Preview tab here would show (and let the surface
        // record) another app's preview — never mirror a foreign bootstrap navigation.
        if (!this.projectOwnsActiveBootstrap(project)) {
            return;
        }
        if (this.executionSurfaceTabsUi.activeExecutionTab(project) === 'preview') {
            return;
        }
        this.executionSurfaceTabsUi.selectTranscriptTab('preview', project, summary);
    };

    /** True when `project`'s clone directory is the workspace the bootstrap service operates on. */
    protected projectOwnsActiveBootstrap(project: MobileProjectEntry): boolean {
        const rootUri = this.projectBootstrap?.descriptor?.rootUri;
        if (!rootUri) {
            return false;
        }
        const cwd = this.projectsService.getProjectCwd(project) ?? this.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            return false;
        }
        const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        try {
            return normalize(FileUri.fsPath(rootUri.toString())) === normalize(cwd);
        } catch {
            return false;
        }
    }

    protected handleHeaderBackClick(): void {
        this.hubHeaderUi.handleHeaderBackClick();
    }

    /** Seam for {@link MobileProjectsStickyComposerSheetsUi.closeAllComposerSheets}. */
    closeTranscriptComposerSheets(): void {
        this.transcriptComposerUi.closeTranscriptComposerSheets();
    }

    protected onTitleTap(): void {
        this.hubHeaderUi.onTitleTap();
    }

    get node(): HTMLElement {
        return this.root;
    }

    isVisible(): boolean {
        return this.visible;
    }

    /** True when the panel is the workbench home (no active workspace), not a dismissable sheet. */
    isHomeMode(): boolean {
        return this.homeMode;
    }

    /** Agents hub inline execution shell (agentic chat) is mounted in this panel. */
    isAgentsHubShellActive(): boolean {
        return this.agentsHubShellActive;
    }

    /** True when the Agents tab scroll area contains the inline execution shell (or a painted placeholder). */
    isAgentsHubExecutionSurfaceReady(): boolean {
        return isAgentsHubExecutionSurfacePainted(this.agentsHubShellActive, this.currentProjectsScrollHost());
    }

    /** Re-mount the inline Agents shell when the panel is visible but the scroll area is still empty. */
    ensureAgentsHubExecutionShellRendered(): void {
        this.syncCurrentProjectsScrollHost();
        if (this.isAgentsHubExecutionSurfaceReady()) {
            return;
        }
        const visible = this.visible || (!this.root.hidden && this.root.classList.contains('theia-mod-visible'));
        const tasksHub = this.hubView === 'tasks' || this.root.classList.contains('theia-mod-hub-tasks');
        const agentsLanding = this.shouldUseAgentsHubLanding()
            || this.root.classList.contains('theia-mod-agents-hub-landing');
        if (visible && tasksHub && agentsLanding) {
            this.visible = true;
            this.hubView = 'tasks';
            this.agentsHubLegacyInbox = false;
            const workspaceCwd = this.projectsService.getCurrentWorkspaceCwd();
            if (workspaceCwd) {
                this.projects = ensureProbeWorkspaceProject(this.projects, this.projectsService, workspaceCwd);
                for (const project of this.projects) {
                    const cwd = project.id === QAAP_PROBE_WORKSPACE_PROJECT_ID
                        ? workspaceCwd
                        : this.projectsService.getProjectCwd(project) ?? this.preparedCwdByProjectId.get(project.id);
                    if (cwd) {
                        this.preparedCwdByProjectId.set(project.id, cwd);
                    }
                }
            }
            this.renderAgentsHubExecutionShell();
            this.stickyComposerRenderUi.renderStickyComposer();
            this.composerHeaderUi.syncHeaderComposerSurfacePicker();
        }
    }

    protected currentProjectsScrollHost(): HTMLElement {
        return this.root.querySelector<HTMLElement>(':scope > .theia-mobile-projects-scroll') ?? this.scroll;
    }

    protected syncCurrentProjectsScrollHost(): void {
        const current = this.currentProjectsScrollHost();
        if (current !== this.scroll) {
            (this as unknown as { scroll: HTMLElement }).scroll = current;
        }
    }

    protected installAgentsHubEmptySurfaceGuard(): void {
        if (!this.homeMode || typeof window === 'undefined') {
            return;
        }
        let frame: number | undefined;
        let interval: number | undefined;
        const schedule = (): void => {
            if (frame !== undefined) {
                return;
            }
            frame = window.requestAnimationFrame(() => {
                frame = undefined;
                this.ensureAgentsHubExecutionShellRendered();
            });
        };
        const observer = typeof MutationObserver !== 'undefined'
            ? new MutationObserver(schedule)
            : undefined;
        observer?.observe(this.root, { attributes: true, attributeFilter: ['class', 'hidden'] });
        observer?.observe(this.scroll, { childList: true });
        interval = window.setInterval(schedule, 500);
        this.agentsHubEmptySurfaceGuardDispose = Disposable.create(() => {
            observer?.disconnect();
            if (interval !== undefined) {
                window.clearInterval(interval);
                interval = undefined;
            }
            if (frame !== undefined) {
                window.cancelAnimationFrame(frame);
                frame = undefined;
            }
        });
        schedule();
    }

    getHubView(): MobileProjectsHubView {
        return this.hubView;
    }

    /** Apply the composer surface. The local Chat surface was removed, so this always resolves to Task. */
    preferComposerSurface(surface: QaapComposerSurface, projectCwd?: string): void {
        this.composerHeaderUi.preferComposerSurface(surface, projectCwd);
    }

    protected pinStickyComposerToQaiq(cwd: string | undefined): void {
        this.composerHeaderUi.pinStickyComposerToQaiq(cwd);
    }

    /** Work Hub home: user drilled into a single repository (tasks list + sticky composer). */
    isProjectDetailView(): boolean {
        return this.homeMode && this.hubView === 'repos' && this.expandedId !== undefined;
    }

    /** Diff review opened from the active workspace (sheet), not the cross-project Work Hub tab. */
    isProjectDiffView(): boolean {
        return this.hubView === 'diff' && this.diffScopedToProject;
    }

    closeProjectDetail(): void {
        this.projectNavigationUi.closeProjectDetail();
    }

    onHubExpandedProjectChanged(project: MobileProjectEntry): void {
        this.transcriptSurfacesUi.onHubProjectExpanded(project);
    }

    protected resetProjectDetailSurfaces(): void {
        this.projectNavigationUi.resetProjectDetailSurfaces();
    }

    /** Work Hub landing: repos list, chat, tasks, or diff review (collapses any expanded repo row). */
    selectHubLandingView(
        view: MobileProjectsHubView,
        preferredDiffProjectId?: string,
        options?: { force?: boolean },
    ): void {
        this.hubLandingUi.selectHubLandingView(view, preferredDiffProjectId, options);
    }

    navigateHubTab(view: MobileProjectsHubView): void {
        this.hubLandingUi.navigateHubTab(view);
    }

    async openDiffView(preferredProjectId?: string): Promise<void> {
        await this.hubLandingUi.openDiffView(preferredProjectId);
    }

    async openProjectDiffView(preferredProjectId?: string): Promise<void> {
        await this.hubLandingUi.openProjectDiffView(preferredProjectId);
    }

    closeProjectDiffView(): void {
        this.hubLandingUi.closeProjectDiffView();
    }

    dispose(): void {
        window.removeEventListener(QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT, this.onBootstrapPreviewOpened);
        this.closeHeaderOverflowMenu();
        this.closeHeaderIdeViewPickerMenu();
        this.headerOverflowMenu?.remove();
        this.headerOverflowMenu = undefined;
        this.headerIdeViewPickerMenu?.remove();
        this.headerIdeViewPickerMenu = undefined;
        document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
        this.composerEditorContextService?.registerPanelDelegate(undefined);
        this.hubListRenderScheduler.dispose();
        this.agentsHubEmptySurfaceGuardDispose.dispose();
        this.agentsHubEmptySurfaceGuardDispose = Disposable.NULL;
        this.panelLifecycleUi.dispose();
    }

    async show(options?: { preferredHubView?: MobileProjectsHubView }): Promise<void> {
        await this.panelLifecycleUi.show(options);
        this.composerEditorContextService?.registerPanelDelegate(this.createComposerEditorContextPanelDelegate());
    }

    hide(): void {
        document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
        this.closeHeaderIdeViewPickerMenu();
        this.panelLifecycleUi.hide();
    }

    protected updateAccountAvatar(): void {
        this.panelLifecycleUi.updateAccountAvatar();
    }

    protected subscribeToActiveTasks(): void {
        this.panelLifecycleUi.subscribeToActiveTasks();
    }

    protected subscribeToInboxStream(): void {
        this.panelLifecycleUi.subscribeToInboxStream();
    }

    protected subscribeToChatServiceSessions(): void {
        this.panelLifecycleUi.subscribeToChatServiceSessions();
    }

    protected trackChatServiceSessionModels(): void {
        this.panelLifecycleUi.trackChatServiceSessionModels();
    }

    protected disposeChatSessionModelListeners(): void {
        this.panelLifecycleUi.disposeChatSessionModelListeners();
    }

    protected scheduleChatServiceRefresh(): void {
        this.panelLifecycleUi.scheduleChatServiceRefresh();
    }

    protected scheduleChatHubListRefreshAfterSummaries(): void {
        this.panelLifecycleUi.scheduleChatHubListRefreshAfterSummaries();
    }

    protected async applyActiveTasksRefresh(): Promise<void> {
        await this.panelLifecycleUi.applyActiveTasksRefresh();
    }

    protected renderHeader(): void {
        this.hubHeaderUi.renderHeader();
        this.syncHeaderIdeViewPicker();
    }

    /** Agents hub: account lives in the sessions sidebar Settings control, not the header. */
    protected syncAgentsHubAccountChrome(): void {
        this.hubHeaderUi.syncAgentsHubAccountChrome();
    }

    protected renderSubtitle(): void {
        this.subtitleUi.renderSubtitle();
    }

    protected async onNewClick(): Promise<void> {
        await this.repoLifecycleUi.onNewClick();
    }

    protected async onStartNewProject(): Promise<void> {
        await this.stickyComposerWorkspaceUi.onCreateNewProjectFromSheet();
    }

    /** After creating a repo from Work Hub, land on Agents with that project selected (not repos drill-in). */
    protected async activateAgentsHubProject(project: MobileProjectEntry): Promise<void> {
        this.agentsHubSelectedProjectId = project.id;
        this.expandedId = undefined;
        this.soloExpanded = false;
        this.agentsHubLegacyInbox = false;
        this.projectNavigationUi.resetProjectDetailSurfaces();
        this.transcriptSheetUi.closeTranscriptSheet();
        const cwd = await this.projectsService.prepareProjectCwd(project);
        if (cwd) {
            this.preparedCwdByProjectId.set(project.id, cwd);
        }
        if (this.agentsHubInlineActive) {
            this.agentsHubInlineUi.closeAgentsHubSession();
        }
        if (!this.homeMode) {
            this.render();
            this.syncLandingHubListChrome();
            return;
        }
        if (this.hubView !== 'tasks') {
            this.selectHubLandingView('tasks', undefined, { force: true });
            return;
        }
        this.renderAgentsHubExecutionShell();
        this.stickyComposerRenderUi.renderStickyComposer();
        this.render();
        this.syncLandingHubListChrome();
        this.notifyWorkspaceHubBottomBarRefresh();
    }

    protected async onOpenLocalWorkspaceFolder(): Promise<void> {
        await this.projectNavigationUi.openLocalWorkspaceFolder();
    }

    protected async onCloneClick(): Promise<void> {
        await this.repoLifecycleUi.onCloneClick();
    }

    protected async refreshProjects(): Promise<void> {
        await this.repoLifecycleUi.refreshProjects();
    }

    /** Publish Work Hub project roots so SkillService scans repo `.agents/skills` without opening IDE. */
    syncWorkHubProjectSkillRoots(): void {
        if (!this.workHubProjectSkillRoots) {
            return;
        }
        const cwds: string[] = [];
        for (const project of this.projects) {
            const cwd = this.projectsService.getProjectCwd(project) ?? this.preparedCwdByProjectId.get(project.id);
            if (cwd?.trim()) {
                cwds.push(cwd.trim());
            }
        }
        this.workHubProjectSkillRoots.syncProjectCwds(cwds);
    }

    protected render(): void {
        this.hubRenderUi.render();
    }

    protected syncHubViewAvailability(): void {
        this.hubRenderUi.syncHubViewAvailability();
    }

    protected static readonly REPO_FILTER_ORDER: readonly MobileProjectFilter[] = ['all', 'active', 'pinned'];

    protected renderFilters(): void {
        this.repoFiltersUi.renderFilters();
    }

    protected async activateWorkHubSearchTarget(target: WorkHubSearchTarget): Promise<void> {
        await this.workHubSearchUi.activateWorkHubSearchTarget(target);
    }

    /**
     * SSE conversation ticks call {@link renderList} to refresh sidebar dots, but must not
     * `replaceChildren()` the inline transcript shell — that disconnects the chat host mid-stream
     * and aborts live refresh until the user reopens the conversation.
     */

    protected renderList(): void {
        this.renderListUi.renderList();
    }

    protected tryPatchHubListBeforeRebuild(): boolean {
        if (this.hubQueryUi.isHomeHubView() && this.missionControlHubUi.tryPatchBeforeRebuild()) {
            this.subtitleUi.renderSubtitle();
            return true;
        }
        return this.hubIncrementalUi.tryPatchBeforeRebuild();
    }

    protected resetHubIncrementalStructure(): void {
        this.hubIncrementalUi.resetStructureFingerprint();
    }

    protected setMissionControlExpanded(expanded: boolean): void {
        this.missionControlExpanded = expanded;
    }

    protected setMissionControlLaneFilter(filter: MissionControlLaneFilter): void {
        this.missionControlLaneFilter = filter;
    }

    protected setMissionControlSurfaceFilter(filter: MissionControlSurfaceFilter): void {
        this.missionControlSurfaceFilter = filter;
    }

    protected scheduleRenderList(): void {
        this.hubListRenderScheduler.schedule();
    }

    protected flushScheduledRenderList(): void {
        this.hubListRenderScheduler.flushNow();
    }

    protected maybeInstallWorkHubPerfProbe(): void {
        const panel = this as MobileProjectsPanel & {
            transcriptSheet?: HTMLElement;
            transcriptChatHost?: HTMLElement;
            transcriptOpenSummaryId?: string;
        };
        installQaapWorkHubPerfProbe({
            scroll: panel.scroll,
            conversations: panel.conversations,
            getSessionsSidebar: () => panel.sessionsSidebar,
            getTranscriptSheet: () => panel.transcriptSheet,
            setTranscriptSheet: value => { panel.transcriptSheet = value; },
            getTranscriptChatHost: () => panel.transcriptChatHost,
            setTranscriptChatHost: value => { panel.transcriptChatHost = value; },
            getTranscriptOpenSummaryId: () => panel.transcriptOpenSummaryId,
            setTranscriptOpenSummaryId: value => { panel.transcriptOpenSummaryId = value; },
            openWorkHubSessionsSidebar: () => panel.sessionsSidebarUi.openWorkHubSessionsSidebar(),
            navigateToHomeHubForProbe: () => panel.navigateHubTab('home'),
            expandMissionControlForProbe: () => {
                panel.setMissionControlExpanded(true);
                panel.renderList();
            },
            showTasksInboxWithTeamForProbe: () => {
                panel.navigateHubTab('tasks');
                panel.agentsHubLegacyInbox = true;
                panel.renderList();
            },
            seedMultiAgentProbeConversations: () => {
                if (!panel.conversations) {
                    return;
                }
                panel.conversations.start();
                panel.activeTasks?.start();
                const workspaceCwd = panel.projectsService.getCurrentWorkspaceCwd();
                if (workspaceCwd) {
                    panel.projects = ensureProbeWorkspaceProject(panel.projects, panel.projectsService, workspaceCwd);
                    for (const project of panel.projects) {
                        const cwd = project.id === QAAP_PROBE_WORKSPACE_PROJECT_ID
                            ? workspaceCwd
                            : panel.preparedCwdByProjectId.get(project.id)
                            ?? panel.projectsService.getProjectCwd(project);
                        if (cwd) {
                            panel.preparedCwdByProjectId.set(project.id, cwd);
                        }
                    }
                }
                const cwdSet = new Set<string>();
                for (const project of panel.projects) {
                    const cwd = panel.preparedCwdByProjectId.get(project.id)
                        ?? panel.projectsService.getProjectCwd(project);
                    if (cwd) {
                        cwdSet.add(cwd);
                    }
                }
                if (workspaceCwd) {
                    cwdSet.add(workspaceCwd);
                }
                if (cwdSet.size === 0) {
                    return;
                }
                for (const cwd of cwdSet) {
                    panel.conversations.perfProbeSeedSummaries(cwd, buildProbeStreamingSummaries(cwd));
                }
                panel.scheduleRenderList();
            },
            tickProbeStreamingConversations: () => {
                if (!panel.conversations) {
                    return;
                }
                const cwdSet = new Set<string>();
                for (const project of panel.projects) {
                    const cwd = panel.preparedCwdByProjectId.get(project.id)
                        ?? panel.projectsService.getProjectCwd(project);
                    if (cwd) {
                        cwdSet.add(cwd);
                    }
                }
                const workspaceCwd = panel.projectsService.getCurrentWorkspaceCwd();
                if (workspaceCwd) {
                    cwdSet.add(workspaceCwd);
                }
                for (const cwd of cwdSet) {
                    panel.conversations.perfProbeTickStreamingSummaries(cwd);
                }
            },
            hasProjectsForProbe: () => panel.projects.length > 0,
            hasWorkspaceForProbe: () => !!panel.projectsService.getCurrentWorkspaceCwd(),
            getProbeDiagnostics: (): WorkHubPerfProbeDiagnostics => ({
                projectCount: panel.projects.length,
                mcRowCount: panel.scroll.querySelectorAll('.theia-mobile-mission-control-row').length,
                teamRowCount: panel.scroll.querySelectorAll(
                    '.theia-mobile-hub-team-root.theia-mod-embedded-in-tasks .theia-mobile-hub-team-row',
                ).length,
                hubView: panel.hubView,
            }),
        });
    }

    /** FAB opens "new repository"; hide while a repo row is expanded (conversations + composer). */
    protected updateNewFabVisibility(): void {
        this.hubListChromeUi.updateNewFabVisibility();
    }

    /**
     * Landing hub list (no expanded project): show the global bottom nav. Hide it while a project
     * row is expanded so the user can focus on chats and the sticky composer.
     */
    protected syncLandingHubListChrome(): void {
        this.hubListChromeUi.syncLandingHubListChrome();
    }

    protected renderDiffHubView(): void {
        this.diffHubUi.renderDiffHubView();
    }

    protected renderDiffProjectTabs(): void {
        this.diffHubUi.renderDiffProjectTabs();
    }

    protected async refreshDiffHubView(): Promise<void> {
        await this.diffHubUi.refreshDiffHubView();
    }

    protected async scanSingleProjectWithChanges(preferredProjectId?: string): Promise<QaapDiffProjectTab | undefined> {
        return this.diffHubUi.scanSingleProjectWithChanges(preferredProjectId);
    }

    protected async scanProjectsWithChanges(): Promise<QaapDiffProjectTab[]> {
        return this.diffHubUi.scanProjectsWithChanges();
    }

    protected async mountDiffReviewWidget(): Promise<void> {
        await this.diffHubUi.mountDiffReviewWidget();
    }

    protected async applyDiffTabToWidget(tab: QaapDiffProjectTab): Promise<void> {
        await this.diffHubUi.applyDiffTabToWidget(tab);
    }

    protected detachDiffReviewWidget(): void {
        this.diffHubUi.detachDiffReviewWidget();
    }

    protected attachDiffReviewWidget(host: HTMLElement): void {
        this.diffHubUi.attachDiffReviewWidget(host);
    }

    protected detachDiffReviewWidgetFromHost(): void {
        this.diffHubUi.detachDiffReviewWidgetFromHost();
    }

    protected refreshHomeHubData(forceRender: boolean): void {
        this.homeHubUi.refreshHomeHubData(forceRender);
    }

    protected buildHomeSnapshot(): WorkHubHomeSnapshot {
        return this.homeHubUi.buildHomeSnapshot();
    }

    protected resolveHomeFavoriteModelLabel(): string | undefined {
        return this.homeHubUi.resolveHomeFavoriteModelLabel();
    }

    protected buildHomeGreeting(): string {
        return this.homeHubUi.buildHomeGreeting();
    }

    protected formatHomeRelativeTime(updatedAt: number): string {
        return this.homeHubUi.formatHomeRelativeTime(updatedAt);
    }

    protected buildHomeWorkspaceActivity(project: MobileProjectEntry): string {
        return this.homeHubUi.buildHomeWorkspaceActivity(project);
    }

    protected getHomeWorkspaceStatus(project: MobileProjectEntry): 'idle' | 'running' | 'open' {
        return this.homeHubUi.getHomeWorkspaceStatus(project);
    }

    protected buildHomeSubtitle(snapshot: WorkHubHomeSnapshot): string {
        return this.homeHubUi.buildHomeSubtitle(snapshot);
    }

    protected resolveHomeAgentLabel(agentId: string): string {
        return this.homeHubUi.resolveHomeAgentLabel(agentId);
    }

    protected renderHomeHubView(): void {
        this.homeHubUi.renderHomeHubView();
    }

    protected resolveHomePinnedProject(): MobileProjectEntry | undefined {
        return this.homeHubUi.resolveHomePinnedProject();
    }

    protected onHomeNavigate(target: WorkHubHomeNavigateTarget): void {
        this.homeHubUi.onHomeNavigate(target);
    }

    protected async onHomeOpenProject(project: MobileProjectEntry): Promise<void> {
        await this.homeHubUi.onHomeOpenProject(project);
    }

    protected async onHomeOpenRecent(item: WorkHubHomeRecentItem): Promise<void> {
        await this.homeHubUi.onHomeOpenRecent(item);
    }

    protected onHomeOpenAttention(item: WorkHubHomeAttentionItem): void {
        this.homeHubUi.onHomeOpenAttention(item);
    }

    protected async onHomeQuickAction(action: WorkHubHomeQuickActionId): Promise<void> {
        await this.homeHubUi.onHomeQuickAction(action);
    }

    protected countTasksAttention(): { needsYou: number; running: number } {
        return this.tasksHubAttentionUi.countTasksAttention();
    }

    protected refreshTasksHubApprovals(forceRender = true): void {
        this.tasksHubAttentionUi.refreshTasksHubApprovals(forceRender);
    }

    protected getFilteredTeamHubState(): {
        members: WorkHubTeamMember[];
        filteredApprovals: WorkHubApprovalItem[];
    } {
        return this.tasksHubAttentionUi.getFilteredTeamHubState();
    }

    openWorkHubSessionsSidebar(): void {
        this.sessionsSidebarUi.openWorkHubSessionsSidebar();
    }

    async openDesktopIdeFromAgentsHub(): Promise<void> {
        if (this.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)
            && this.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
            await this.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, 'editor');
            this.hide();
            return;
        }
        if (!this.commands.getCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
            || !this.commands.isEnabled(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)) {
            return;
        }
        await this.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
        this.hide();
    }

    toggleWorkHubSessionsSidebar(): void {
        this.sessionsSidebarUi.toggleWorkHubSessionsSidebar();
    }

    /** Carga proyectos + sesiones antes de pintar filas `createTaskItem` en el sidebar. */
    protected async prepareSessionsSidebarData(): Promise<void> {
        await this.sessionsSidebarUi.prepareSessionsSidebarData();
    }

    isWorkHubSessionsSidebarVisible(): boolean {
        return this.sessionsSidebarUi.isWorkHubSessionsSidebarVisible();
    }

    protected ensureWorkHubSessionsSidebar(): MobileWorkHubSessionsSidebar {
        return this.sessionsSidebarUi.ensureWorkHubSessionsSidebar();
    }

    protected resolveWorkHubSessionsSidebarProject(): MobileProjectEntry | undefined {
        return this.sessionsSidebarUi.resolveWorkHubSessionsSidebarProject();
    }

    protected renderWorkHubSessionsSidebarList(host: HTMLElement): void {
        this.sessionsSidebarUi.renderWorkHubSessionsSidebarList(host);
    }

    protected syncSessionsSidebarAnimatedListHeights(host: HTMLElement): void {
        this.sessionsSidebarUi.syncSessionsSidebarAnimatedListHeights(host);
    }

    protected isSessionsSidebarPinnedConversation(summary: QaapAgentConversationSummaryDTO): boolean {
        return this.sessionsSidebarUi.isSessionsSidebarPinnedConversation(summary);
    }

    protected collectSessionsSidebarPinnedGroups(
        projects: MobileProjectEntry[],
        query: string,
    ): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
        return this.sessionsSidebarUi.collectSessionsSidebarPinnedGroups(projects, query);
    }

    protected createSessionsSidebarPinnedSection(
        groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>,
        onActivate: () => void,
        bypassConversationLimit = false,
    ): HTMLElement {
        return this.sessionsSidebarUi.createSessionsSidebarPinnedSection(groups, onActivate, bypassConversationLimit);
    }

    protected getSessionsSidebarConversationDisplayLimit(
        project: MobileProjectEntry,
        totalCount: number,
        bypassLimit: boolean,
    ): number {
        return this.sessionsSidebarUi.getSessionsSidebarConversationDisplayLimit(project, totalCount, bypassLimit);
    }

    protected resolveSessionsSidebarVisibleConversations(
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        bypassLimit: boolean,
    ): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
        return this.sessionsSidebarUi.resolveSessionsSidebarVisibleConversations(project, conversations, bypassLimit);
    }

    protected appendSessionsSidebarConversationItems(
        listHost: HTMLElement,
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassLimit: boolean,
    ): void {
        this.sessionsSidebarUi.appendSessionsSidebarConversationItems(listHost, project, conversations, onActivate, bypassLimit);
    }

    protected createSessionsSidebarShowMoreControl(
        project: MobileProjectEntry,
        hiddenCount: number,
        totalCount: number,
    ): HTMLButtonElement {
        return this.sessionsSidebarUi.createSessionsSidebarShowMoreControl(project, hiddenCount, totalCount);
    }

    protected createSessionsSidebarShowLessControl(project: MobileProjectEntry): HTMLButtonElement {
        return this.sessionsSidebarUi.createSessionsSidebarShowLessControl(project);
    }

    protected createSessionsSidebarPinnedProjectGroup(
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassConversationLimit = false,
    ): HTMLElement {
        return this.sessionsSidebarUi.createSessionsSidebarPinnedProjectGroup(project, conversations, onActivate, bypassConversationLimit);
    }

    /** Expand current workspace (+ running) by default; user toggles persist for the session. */
    protected seedSessionsSidebarAccordionDefaults(projects: MobileProjectEntry[]): void {
        this.sessionsSidebarUi.seedSessionsSidebarAccordionDefaults(projects);
    }

    protected createSessionsSidebarProjectGroup(
        project: MobileProjectEntry,
        conversations: readonly QaapAgentConversationSummaryDTO[],
        onActivate: () => void,
        bypassConversationLimit = false,
    ): HTMLElement {
        return this.sessionsSidebarUi.createSessionsSidebarProjectGroup(project, conversations, onActivate, bypassConversationLimit);
    }

    protected createSessionsSidebarProjectRowHead(
        project: MobileProjectEntry,
        expanded: boolean,
        onToggleExpand: () => void,
    ): HTMLElement {
        return this.sessionsSidebarUi.createSessionsSidebarProjectRowHead(project, expanded, onToggleExpand);
    }

    protected createSessionsSidebarIdeOpenControl(project: MobileProjectEntry): HTMLButtonElement {
        return this.sessionsSidebarUi.createSessionsSidebarIdeOpenControl(project);
    }

    protected async onWorkHubSessionsSidebarNewChat(): Promise<void> {
        await this.sessionsSidebarUi.onWorkHubSessionsSidebarNewChat();
    }

    protected async onHeaderNewChatClick(): Promise<void> {
        await this.onWorkHubSessionsSidebarNewChat();
    }

    protected onHeaderProjectClick(anchor: HTMLButtonElement): void {
        const project = this.hubHeaderUi.resolveHeaderProject();
        if (!project) {
            return;
        }
        this.stickyComposerWorkspaceUi.openComposerWorkspaceProjectSheet(project, false, anchor);
    }

    protected syncHeaderIdeViewPicker(): void {
        this.headerIdeViewPickerHost.hidden = true;
        this.headerIdeViewPickerHost.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('theia-mobile-mod-ide-header-view-picker');
        this.headerIdeViewPickerHost.replaceChildren();
        this.headerIdeViewPickerBtn = undefined;
        this.closeHeaderIdeViewPickerMenu();
    }

    protected createHeaderIdeViewIcon(icon: string): HTMLElement {
        const span = document.createElement('span');
        span.className = `codicon ${icon} theia-mobile-projects-ide-view-picker-icon`;
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    protected createHeaderIdeViewChevron(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'codicon codicon-chevron-down theia-mobile-projects-ide-view-picker-chevron';
        span.setAttribute('aria-hidden', 'true');
        return span;
    }

    protected onHeaderIdeViewPickerClick(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.headerIdeViewPickerMenu?.classList.contains('theia-mod-open')) {
            this.closeHeaderIdeViewPickerMenu();
            return;
        }
        this.openHeaderIdeViewPickerMenu();
    }

    protected openHeaderIdeViewPickerMenu(): void {
        const picker = this.mobileIdeViewPicker;
        const btn = this.headerIdeViewPickerBtn;
        if (!picker || !btn) {
            return;
        }
        const menu = this.ensureHeaderIdeViewPickerMenu();
        menu.replaceChildren();
        const activeId = picker.getActiveId();
        for (const option of picker.getOptions()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'qaap-work-hub-toolbar-menu-item theia-mobile-projects-ide-view-picker-item';
            item.setAttribute('role', 'menuitem');
            item.setAttribute('aria-current', option.id === activeId ? 'true' : 'false');
            item.append(this.createHeaderIdeViewIcon(option.icon), document.createTextNode(option.label));
            item.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.closeHeaderIdeViewPickerMenu();
                void Promise.resolve(picker.onSelect(option.id)).then(() => this.syncHeaderIdeViewPicker());
            });
            menu.append(item);
        }
        btn.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        menu.classList.add('theia-mod-open');
        this.positionHeaderIdeViewPickerMenu();

        const onDismiss = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && (menu.contains(target) || btn.contains(target))) {
                return;
            }
            this.closeHeaderIdeViewPickerMenu();
        };
        const onReposition = (): void => this.positionHeaderIdeViewPickerMenu();
        window.setTimeout(() => window.addEventListener('pointerdown', onDismiss, true), 0);
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        this.headerIdeViewPickerDismiss.dispose();
        this.headerIdeViewPickerDismiss = Disposable.create(() => {
            window.removeEventListener('pointerdown', onDismiss, true);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        });
    }

    protected ensureHeaderIdeViewPickerMenu(): HTMLElement {
        if (this.headerIdeViewPickerMenu) {
            return this.headerIdeViewPickerMenu;
        }
        const menu = document.createElement('div');
        menu.className = 'qaap-work-hub-toolbar-menu theia-mobile-projects-ide-view-picker-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', nls.localize('qaap/mobileBottomBar/viewSelector', 'View'));
        document.body.append(menu);
        this.headerIdeViewPickerMenu = menu;
        return menu;
    }

    protected closeHeaderIdeViewPickerMenu(): void {
        this.headerIdeViewPickerBtn?.setAttribute('aria-expanded', 'false');
        if (this.headerIdeViewPickerMenu) {
            this.headerIdeViewPickerMenu.hidden = true;
            this.headerIdeViewPickerMenu.classList.remove('theia-mod-open');
            this.headerIdeViewPickerMenu.style.top = '';
            this.headerIdeViewPickerMenu.style.left = '';
        }
        this.headerIdeViewPickerDismiss.dispose();
        this.headerIdeViewPickerDismiss = Disposable.NULL;
    }

    protected positionHeaderIdeViewPickerMenu(): void {
        const menu = this.headerIdeViewPickerMenu;
        const btn = this.headerIdeViewPickerBtn;
        if (!menu || !btn || menu.hidden) {
            return;
        }
        const margin = 8;
        const gap = 6;
        const anchor = btn.getBoundingClientRect();
        const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 220);
        let left = anchor.right - menuWidth;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
        menu.style.top = `${Math.round(anchor.bottom + gap)}px`;
        menu.style.left = `${Math.round(left)}px`;
    }

    protected onHeaderOverflowMenuClick(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        if (this.headerOverflowMenu?.classList.contains('theia-mod-open')) {
            this.closeHeaderOverflowMenu();
            return;
        }
        this.openHeaderOverflowMenu();
    }

    protected openHeaderOverflowMenu(): void {
        const menu = this.ensureHeaderOverflowMenu();
        this.renderHeaderOverflowMenuItems(menu);
        if (!menu.childElementCount) {
            return;
        }
        this.headerOverflowMenuBtn.setAttribute('aria-expanded', 'true');
        menu.hidden = false;
        menu.classList.add('theia-mod-open');
        this.positionHeaderOverflowMenu();

        const onDismiss = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && (menu.contains(target) || this.headerOverflowMenuBtn.contains(target))) {
                return;
            }
            this.closeHeaderOverflowMenu();
        };
        const onReposition = (): void => this.positionHeaderOverflowMenu();
        window.setTimeout(() => window.addEventListener('pointerdown', onDismiss, true), 0);
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        this.headerOverflowMenuDismiss.dispose();
        this.headerOverflowMenuDismiss = Disposable.create(() => {
            window.removeEventListener('pointerdown', onDismiss, true);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        });
    }

    protected ensureHeaderOverflowMenu(): HTMLElement {
        if (this.headerOverflowMenu) {
            return this.headerOverflowMenu;
        }
        const menu = document.createElement('div');
        menu.className = 'qaap-work-hub-toolbar-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', this.headerOverflowMenuBtn.title);
        document.body.append(menu);
        this.headerOverflowMenu = menu;
        return menu;
    }

    protected closeHeaderOverflowMenu(): void {
        this.headerOverflowMenuBtn?.setAttribute('aria-expanded', 'false');
        if (this.headerOverflowMenu) {
            this.headerOverflowMenu.hidden = true;
            this.headerOverflowMenu.classList.remove('theia-mod-open');
            this.headerOverflowMenu.style.top = '';
            this.headerOverflowMenu.style.left = '';
        }
        this.headerOverflowMenuDismiss.dispose();
        this.headerOverflowMenuDismiss = Disposable.NULL;
    }

    protected positionHeaderOverflowMenu(): void {
        const menu = this.headerOverflowMenu;
        if (!menu || menu.hidden) {
            return;
        }
        const margin = 8;
        const gap = 6;
        const anchor = this.headerOverflowMenuBtn.getBoundingClientRect();
        const menuWidth = Math.max(menu.offsetWidth || menu.scrollWidth, 220);
        const menuHeight = menu.offsetHeight || menu.scrollHeight;
        let left = anchor.right - menuWidth;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
        const below = anchor.bottom + gap;
        const above = anchor.top - menuHeight - gap;
        const top = below + menuHeight <= window.innerHeight - margin ? below : Math.max(margin, above);
        menu.style.top = `${Math.round(top)}px`;
        menu.style.left = `${Math.round(left)}px`;
    }

    protected renderHeaderOverflowMenuItems(menu: HTMLElement): void {
        menu.replaceChildren();
        const appendItem = (label: string, icon: string, run: () => void | Promise<void>, enabled = true): void => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'qaap-work-hub-toolbar-menu-item';
            item.setAttribute('role', 'menuitem');
            item.disabled = !enabled;
            const iconEl = document.createElement('span');
            iconEl.className = `codicon ${icon}`;
            iconEl.setAttribute('aria-hidden', 'true');
            const labelEl = document.createElement('span');
            labelEl.textContent = label;
            item.append(iconEl, labelEl);
            item.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (item.disabled) {
                    return;
                }
                this.closeHeaderOverflowMenu();
                void Promise.resolve(run()).catch(() => undefined);
            });
            menu.append(item);
        };
        appendItem(
            nls.localize('qaap/workHubToolbar/newChat', 'New Chat'),
            'codicon-add',
            () => this.openHeaderNewChat(),
            this.isHeaderNewChatVisible(),
        );
        appendItem(
            nls.localize('qaap/workHubToolbar/showChats', 'Show Chats'),
            'codicon-history',
            () => this.openWorkHubSessionsSidebar(),
        );
        appendItem(
            nls.localize('qaap/workHubToolbar/copyConversation', 'Copy full conversation'),
            'codicon-copy',
            () => this.copyActiveConversationToClipboard(),
            this.isCopyConversationEnabled(),
        );
        if (this.openAiConfigurationSheet) {
            this.appendHeaderOverflowSeparator(menu);
            appendItem(
                nls.localize('qaap/workHubToolbar/aiSettings', 'AI Settings'),
                'codicon-settings-gear',
                () => this.openAiConfigurationSheet?.(),
            );
        }
        if (this.openPreferencesSheet) {
            appendItem(
                nls.localize('qaap/workHubToolbar/preferences', 'Preferences'),
                'codicon-tools',
                () => this.openPreferencesSheet?.(),
            );
        }
        for (const group of this.headerOverflowMenuGroups?.() ?? []) {
            const visibleItems = group.filter(item => this.isHeaderOverflowMenuItemVisible(item));
            if (!visibleItems.length) {
                continue;
            }
            this.appendHeaderOverflowSeparator(menu);
            for (const item of visibleItems) {
                appendItem(
                    item.label,
                    item.icon,
                    () => {
                        if (item.run) {
                            return item.run();
                        }
                        if (item.command) {
                            return this.commands.executeCommand(item.command);
                        }
                    },
                    this.isHeaderOverflowMenuItemEnabled(item),
                );
            }
        }
    }

    protected isHeaderOverflowMenuItemVisible(item: MobileProjectsHeaderOverflowMenuItem): boolean {
        if (item.isVisible) {
            return item.isVisible();
        }
        return item.command ? this.commands.isVisible(item.command) : true;
    }

    protected isHeaderOverflowMenuItemEnabled(item: MobileProjectsHeaderOverflowMenuItem): boolean {
        if (item.isEnabled) {
            return item.isEnabled();
        }
        return item.command ? this.commands.isEnabled(item.command) : true;
    }

    protected appendHeaderOverflowSeparator(menu: HTMLElement): void {
        if (!menu.childElementCount) {
            return;
        }
        const separator = document.createElement('div');
        separator.className = 'qaap-work-hub-toolbar-menu-separator';
        separator.setAttribute('role', 'separator');
        menu.append(separator);
    }

    protected isCopyConversationEnabled(): boolean {
        const state = this.transcriptController.state;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        if (!summary) {
            return false;
        }
        if (state.transcriptLastConv?.id === summary.id && state.transcriptLastConv.messages.length > 0) {
            return true;
        }
        const cached = this.transcriptConversationCache.get(summary.id);
        if ((cached?.messages.length ?? 0) > 0) {
            return true;
        }
        return (summary.messageCount ?? 0) > 0;
    }

    protected async resolveActiveConversationForCopy(): Promise<QaapAgentConversationDTO | undefined> {
        const state = this.transcriptController.state;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        if (!summary) {
            return undefined;
        }
        if (state.transcriptLastConv?.id === summary.id) {
            return state.transcriptLastConv;
        }
        const cached = this.transcriptConversationCache.get(summary.id);
        if (cached) {
            return cached;
        }
        if (summary.source === 'theia-chat') {
            return this.conversations?.getTheiaConversation(summary.id);
        }
        try {
            return await getConversation(summary.id);
        } catch {
            return undefined;
        }
    }

    protected async copyActiveConversationToClipboard(): Promise<void> {
        const conv = await this.resolveActiveConversationForCopy();
        const text = conv ? formatConversationForClipboard(conv) : '';
        if (!text.trim()) {
            MobileSnackbar.show(
                nls.localize('qaap/workHubToolbar/copyConversationEmpty', 'No messages to copy'),
                { kind: 'warning', duration: 1800 },
            );
            return;
        }
        try {
            if (this.previewClipboard) {
                await this.previewClipboard.writeText(text);
            } else {
                await navigator.clipboard.writeText(text);
            }
            MobileSnackbar.show(
                nls.localize('qaap/workHubToolbar/copyConversationCopied', 'Conversation copied'),
                { kind: 'success', duration: 1800 },
            );
        } catch {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/transcriptShellCopyFailed', 'Could not copy'),
                { kind: 'warning' },
            );
        }
    }

    async openHeaderNewChat(): Promise<void> {
        await this.onHeaderNewChatClick();
    }

    isHeaderNewChatVisible(): boolean {
        return this.hubHeaderUi.resolveHeaderNewChatVisible();
    }

    protected shouldEmbedSessionsSidebarInPanel(): boolean {
        if (!this.homeMode) {
            return false;
        }
        return window.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches === true
            || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome')
            || document.body.classList.contains('theia-mobile-mod-desktop-ide');
    }

    /** Mockup `newChat()`: misma vista vacía que Agents (idle), no una sesión paralela. */
    protected async openEmptyMobileChatSheet(project: MobileProjectEntry): Promise<void> {
        await this.sessionsSidebarUi.openEmptyMobileChatSheet(project);
    }

    protected async onWorkHubSessionsSidebarAutomations(): Promise<void> {
        await this.sessionsSidebarUi.onWorkHubSessionsSidebarAutomations();
    }

    protected onSessionsSidebarAccountClick(anchor: HTMLButtonElement): void {
        this.sessionsSidebarUi.onSessionsSidebarAccountClick(anchor);
    }

    protected async openSessionsSidebarSearch(): Promise<void> {
        await this.sessionsSidebarUi.openSessionsSidebarSearch();
    }

    protected notifyWorkspaceHubBottomBarRefresh(): void {
        this.repoLifecycleUi.notifyWorkspaceHubBottomBarRefresh();
    }

    protected async openProjectDetail(project: MobileProjectEntry): Promise<void> {
        await this.projectNavigationUi.openProjectDetail(project);
    }

    protected async toggleRowExpanded(project: MobileProjectEntry): Promise<void> {
        await this.projectNavigationUi.toggleRowExpanded(project);
    }

    protected async closeCurrentWorkspace(): Promise<void> {
        await this.projectNavigationUi.closeCurrentWorkspace();
    }

    protected async openTaskInAgent(project: MobileProjectEntry, task?: MobileProjectTaskView): Promise<void> {
        await this.conversationOpenUi.openTaskInAgent(project, task);
    }

    protected async openConversationSummary(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        await this.conversationOpenUi.openConversationSummary(project, summary);
    }

    protected async onTogglePin(project: MobileProjectEntry): Promise<void> {
        await this.repoLifecycleUi.onTogglePin(project);
    }

    protected async openAgentComposer(project: MobileProjectEntry, draft?: string): Promise<void> {
        await this.repoLifecycleUi.openAgentComposer(project, draft);
    }

    protected async ensureInlineComposerCwd(project: MobileProjectEntry): Promise<string | undefined> {
        return this.backgroundTaskUi.ensureInlineComposerCwd(project);
    }

    protected async submitBackgroundAgentTask(
        project: MobileProjectEntry,
        draft: string,
        options: {
            openConversation?: boolean;
            forceVps?: boolean;
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            worktree?: boolean;
            agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
        } = {},
    ): Promise<QaapAgentConversationSummaryDTO | undefined> {
        return this.backgroundTaskUi.submitBackgroundAgentTask(project, draft, options);
    }

    /**
     * Sticky-composer agent/model controls for the Cursor-style annotation popover footer.
     * Shares the same agent sheet + session preference as the Work Hub transcript composer.
     */
    resolveAnnotationComposerSession(): AnnotationComposerSessionControls | undefined {
        const state = this.transcriptController.state;
        // Same resolution as other Work Hub composer entry points — do not require
        // transcriptOpenProject alone (sticky / shell session may still be active).
        const project = this.resolveExternalComposerProject();
        const summary = state.transcriptOpenSummary
            ?? state.transcriptComposerSummary
            ?? (project ? this.resolveShellSummary(project) : undefined);
        if (!project || !summary) {
            return undefined;
        }
        return createAnnotationComposerSessionControls({
            agentLocked: summary.source === 'theia-chat',
            resolveAgentId: () => this.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(
                project,
                summary,
            ),
            resolveAgentLabel: () => this.transcriptComposerUi.resolveTranscriptComposerAgentLabel(),
            resolveAgentModel: () => {
                const cwd = this.projectsService.getProjectCwd(project) ?? summary.cwd;
                return this.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                    this.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(project, summary),
                    cwd,
                );
            },
            onOpenAgentSheet: (anchor, onSelectionApplied) => {
                this.transcriptComposerUi.openTranscriptComposerAgentSheet(
                    project,
                    summary,
                    anchor,
                    { onSelectionApplied },
                );
            },
        });
    }

    /**
     * Attach a context chip to the active composer (transcript if open, else sticky) without sending.
     */
    attachExternalComposerContext(args: {
        readonly chipTitle: string;
        readonly contextBody: string;
        readonly dedupeKey: string;
        readonly images?: readonly QaapAttachComposerImageAttachment[];
    }): boolean {
        const project = this.resolveExternalComposerProject();
        if (!project) {
            return false;
        }
        const attachImages = normalizeAttachComposerImages(args.images);
        if (attachImages.length && this.uploadComposerFeedbackImages) {
            void this.uploadComposerFeedbackImages(attachImages, this.resolveExternalComposerUploadDir(project))
                .then(requests => this.attachExternalFeedbackImageEntries(requests))
                .catch(() => undefined);
        }
        const useTranscript = this.resolveActiveComposerContextTarget() === 'transcript';
        const entries = useTranscript
            ? this.transcriptController.state.transcriptComposerContext
            : this.stickyComposerContext;
        const request = buildPreviewFeedbackAttachmentRequest(args);
        const existingIndex = findPreviewFeedbackEntryIndex(entries, args.dedupeKey);
        if (existingIndex >= 0) {
            entries[existingIndex]!.request = request;
            entries[existingIndex]!.displayName = args.chipTitle;
        } else {
            const entry = createComposerContextEntry(request);
            entry.displayName = args.chipTitle;
            entries.push(entry);
        }
        if (useTranscript) {
            this.transcriptStickyComposerUi.remountTranscriptStickyComposer();
        } else {
            this.stickyComposerRenderUi.renderStickyComposer();
        }
        const input = this.root.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input-editor');
        input?.focus();
        return true;
    }

    /**
     * Attach preview feedback to the current composer, then submit through the same path as
     * typing in the Work Hub sticky composer and pressing Send:
     * - idle Agents Hub → optimistic user turn + {@link submitBackgroundAgentTask}
     * - open session → {@link submitTranscriptViaBackendConversation}
     * Leaves unrelated composer draft text intact. On success, removes only the matching
     * preview-feedback chip (dedupe).
     */
    async sendExternalComposerContext(args: {
        readonly chipTitle: string;
        readonly contextBody: string;
        readonly dedupeKey: string;
        readonly images?: readonly QaapAttachComposerImageAttachment[];
    }): Promise<boolean> {
        // Images are handled below as submit variables — keep the retry chip image-free.
        if (!this.attachExternalComposerContext({
            chipTitle: args.chipTitle,
            contextBody: args.contextBody,
            dedupeKey: args.dedupeKey,
        })) {
            return false;
        }
        const project = this.resolveExternalComposerProject();
        if (!project) {
            return false;
        }
        const request = buildPreviewFeedbackAttachmentRequest(args);
        const feedbackImages = normalizeAttachComposerImages(args.images);
        let imageRequests: AIVariableResolutionRequest[] = [];
        if (feedbackImages.length && this.uploadComposerFeedbackImages) {
            try {
                imageRequests = await this.uploadComposerFeedbackImages(
                    feedbackImages,
                    this.resolveExternalComposerUploadDir(project),
                );
            } catch {
                // Send the annotations anyway; the screenshot stays on the user's clipboard.
                imageRequests = [];
            }
        }
        const prompt = nls.localize(
            'qaap/workHub/previewFeedbackSubmitPrompt',
            'Please address the attached preview feedback.',
        );
        // Annotate Send often fires from the Preview tab — land on Messages first so the
        // optimistic user bubble + sticky composer match a normal composer submit.
        this.activateMessagesSurfaceForExternalSubmit(project);
        const state = this.transcriptController.state;
        const target = resolvePreviewFeedbackSubmitTarget(
            state.transcriptOpenSummary,
            state.transcriptComposerSummary,
        );
        try {
            if (target.kind === 'active') {
                const summary = target.summary;
                if (state.transcriptOpenSummaryId !== summary.id || !this.agentsHubInlineActive) {
                    await this.openInlineTranscript(project, summary);
                    this.activateMessagesSurfaceForExternalSubmit(project);
                }
                const selectedAgentId = this.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(
                    project,
                    summary,
                );
                const agentModel = this.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                    selectedAgentId,
                    summary.cwd,
                );
                await this.submitTranscriptViaBackendConversation(project, summary, prompt, {
                    selectedAgentId,
                    variables: [request, ...imageRequests],
                    ...(agentModel ? { agentModel } : {}),
                });
            } else {
                const idleSummary = state.transcriptOpenSummary
                    && isAgentsHubIdleConversationSummary(state.transcriptOpenSummary)
                    ? state.transcriptOpenSummary
                    : state.transcriptComposerSummary
                        && isAgentsHubIdleConversationSummary(state.transcriptComposerSummary)
                        ? state.transcriptComposerSummary
                        : buildAgentsHubIdleConversationSummary(
                            this.projectsService.getProjectCwd(project)
                                ?? this.preparedCwdByProjectId.get(project.id)
                                ?? '',
                        );
                const selectedAgentId = this.transcriptComposerUi.resolveTranscriptComposerPinnedAgentId(
                    project,
                    idleSummary,
                );
                const agentModel = this.transcriptComposerUi.resolveTranscriptComposerAgentModel(
                    selectedAgentId,
                    idleSummary.cwd || this.projectsService.getProjectCwd(project),
                );
                // Send usually fires from the Preview tab, where the messages shell may be
                // unmounted — ensure it exists so the optimistic paint has a live host.
                this.ensureAgentsHubExecutionShellRendered();
                const chatHost = this.resolveActiveTranscriptChatHost();
                if (chatHost) {
                    // Paint the rich preview-feedback card immediately: resolve the attachment
                    // preamble for the optimistic row instead of waiting for the server render.
                    let optimisticContent = prompt;
                    if (this.applyComposerAttachmentsToDraft) {
                        try {
                            optimisticContent = await this.applyComposerAttachmentsToDraft(prompt, [request, ...imageRequests]);
                        } catch {
                            // Fall back to the bare prompt; the server render reconciles.
                        }
                    }
                    this.renderIdleSubmitOptimistic(chatHost, idleSummary, prompt, selectedAgentId, undefined, optimisticContent);
                }
                this.transcriptStickyComposerUi.refreshComposerActivityStack();
                await this.submitBackgroundAgentTask(project, prompt, {
                    forceVps: true,
                    openConversation: true,
                    selectedAgentId,
                    variables: [request, ...imageRequests],
                    ...(agentModel ? { agentModel } : {}),
                });
                // create→openInline may preserve Preview; force Messages again after open.
                this.activateMessagesSurfaceForExternalSubmit(project);
                this.ensureExternalSubmitConversationRendered();
            }
        } catch {
            // Keep the chip so the user can retry from the composer; already-uploaded screenshots
            // become composer image chips so a retry still includes them.
            this.attachExternalFeedbackImageEntries(imageRequests);
            return false;
        }
        this.removeExternalPreviewFeedbackChip(args.dedupeKey);
        return true;
    }

    /** Upload dir mirrors the sticky composer: project workspace, else the project cwd. */
    protected resolveExternalComposerUploadDir(project: MobileProjectEntry): URI | undefined {
        if (project.uri) {
            return project.uri;
        }
        const cwd = this.projectsService.getProjectCwd(project);
        return cwd ? new URI().withScheme('file').withPath(cwd) : undefined;
    }

    protected attachExternalFeedbackImageEntries(requests: readonly AIVariableResolutionRequest[]): void {
        if (!requests.length) {
            return;
        }
        const useTranscript = this.resolveActiveComposerContextTarget() === 'transcript';
        const entries = useTranscript
            ? this.transcriptController.state.transcriptComposerContext
            : this.stickyComposerContext;
        for (const request of requests) {
            entries.push(createComposerContextEntry(request));
        }
        if (useTranscript) {
            this.transcriptStickyComposerUi.remountTranscriptStickyComposer();
        } else {
            this.stickyComposerRenderUi.renderStickyComposer();
        }
    }

    /** Reveal Messages + remount the Agents Hub sticky composer (same surface as a manual Send). */
    protected activateMessagesSurfaceForExternalSubmit(project: MobileProjectEntry): void {
        this.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
        this.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab('messages');
        if (this.agentsHubShellActive) {
            this.stickyComposerRenderUi.renderStickyComposer();
        }
    }

    /**
     * After an external submit created/opened a conversation, the revealed messages host can
     * still hold the idle "Ready when you are." landing DOM if the surface switch raced the
     * open (Send fires from the Preview tab). Repaint the opened conversation explicitly.
     */
    protected ensureExternalSubmitConversationRendered(): void {
        this.ensureAgentsHubExecutionShellRendered();
        const state = this.transcriptController.state;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        if (!summary || isAgentsHubIdleConversationSummary(summary)) {
            return;
        }
        const conv = state.transcriptLastConv?.id === summary.id
            ? state.transcriptLastConv
            : this.transcriptConversationCache.get(summary.id);
        const chatHost = this.resolveActiveTranscriptChatHost();
        if (!conv || !chatHost) {
            return;
        }
        state.transcriptLastFingerprint = undefined;
        this.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
        this.transcriptLiveUi.ensureTranscriptConversationRefresh();
    }

    protected removeExternalPreviewFeedbackChip(dedupeKey: string): void {
        const useTranscript = this.resolveActiveComposerContextTarget() === 'transcript';
        const entries = useTranscript
            ? this.transcriptController.state.transcriptComposerContext
            : this.stickyComposerContext;
        const existingIndex = findPreviewFeedbackEntryIndex(entries, dedupeKey);
        if (existingIndex < 0) {
            return;
        }
        const [removed] = entries.splice(existingIndex, 1);
        revokeComposerContextPreview(removed);
        if (useTranscript) {
            this.transcriptStickyComposerUi.remountTranscriptStickyComposer();
        } else {
            this.stickyComposerRenderUi.renderStickyComposer();
        }
    }

    /**
     * External entry (Element Inspector, etc.): submit to the sticky-composer agent
     * for the active Work Hub project. Returns false when no project can be resolved.
     */
    async submitExternalComposerPrompt(
        draft: string,
        options: {
            readonly agentId?: string;
            readonly agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
        } = {},
    ): Promise<boolean> {
        const text = draft.trim();
        if (!text) {
            return false;
        }
        const project = this.resolveExternalComposerProject();
        if (!project) {
            return false;
        }
        const selectedAgentId = options.agentId
            ?? this.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project);
        const agentModel = options.agentModel
            ?? this.stickyComposerAgentsUi.resolveStickyComposerAgentModel(selectedAgentId, project);
        await this.submitBackgroundAgentTask(project, text, {
            forceVps: true,
            openConversation: true,
            selectedAgentId,
            ...(agentModel ? { agentModel } : {}),
        });
        return true;
    }

    /**
     * Open the agent/model picker, then submit {@link draft} with the chosen agent.
     * Returns false when no project can be resolved.
     */
    pickAgentAndSubmitExternalPrompt(
        draft: string,
        options: {
            readonly title?: string;
            readonly intro?: string;
            readonly anchor?: HTMLElement;
        } = {},
    ): boolean {
        const text = draft.trim();
        if (!text) {
            return false;
        }
        const project = this.resolveExternalComposerProject();
        if (!project) {
            return false;
        }
        this.stickyComposerSheetsUi.openExternalAgentPickerForSubmit(project, text, options);
        return true;
    }

    openExternalParallelRunsSheet(prompt: string): boolean {
        const text = prompt.trim();
        if (!text) {
            return false;
        }
        const project = this.resolveExternalComposerProject();
        if (!project) {
            return false;
        }
        const cwd = this.projectsService.getProjectCwd(project)
            ?? this.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            return false;
        }
        this.ensureOverlayUi().parallel.openParallelRunsSheetForPrompt(project, cwd, text);
        return true;
    }

    protected resolveExternalComposerProject(): MobileProjectEntry | undefined {
        return this.transcriptController.state.transcriptOpenProject
            ?? this.transcriptController.state.transcriptComposerProject
            ?? this.resolveAgentsHubShellProject()
            ?? this.projects.find(entry => this.projectsService.getProjectCwd(entry))
            ?? this.projects[0];
    }

    protected async createProjectChatSession(
        project: MobileProjectEntry,
        cwd: string,
        draft: string,
        options: {
            forceVps?: boolean;
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
            latencyMarks?: import('../common/qaap-agent-conversation-client').QaapPostConversationMessageOptions['latencyMarks'];
        },
    ): Promise<import('./mobile-projects-background-task-ui').QaapProjectChatSessionCreated> {
        return this.backgroundTaskUi.createProjectChatSession(project, cwd, draft, options);
    }

    seedTranscriptOptimisticSubmit(
        summary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO,
        outbound: string,
        agentId?: string,
        imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],
    ): void {
        this.agentsHubInlineUi.seedTranscriptOptimisticSubmit(summary, outbound, agentId, imagePreviews);
    }

    /** Roll back the pre-create idle optimistic paint after the server rejected the create. */
    rollbackTranscriptOptimisticSubmit(): void {
        this.agentsHubInlineUi.rollbackAgentsHubIdleSubmitOptimistic();
    }

    protected shouldUseTheiaCoder(
        content: string,
        selectedAgentId?: string,
        options: { forceVps?: boolean; isLegacyTheiaChat?: boolean } = {},
    ): boolean {
        return this.backgroundTaskUi.shouldUseTheiaCoder(content, selectedAgentId, options);
    }

    protected async loadBackendAgentSnapshot(): Promise<QaapAgentTaskListSnapshot> {
        return this.backgroundTaskUi.loadBackendAgentSnapshot();
    }

    protected async selectBackendConversationAgent(
        cwd: string,
        prompt: string,
        selectedAgentId?: string,
        conversationAgentId?: string,
    ): Promise<string> {
        return this.backgroundTaskUi.selectBackendConversationAgent(cwd, prompt, selectedAgentId, conversationAgentId);
    }

    protected applyTaskStartedToProject(cwd: string, title: string, taskId: string): void {
        this.backgroundTaskUi.applyTaskStartedToProject(cwd, title, taskId);
    }

    protected ensureAgentChatSession(cwd?: string): ChatSession {
        return this.theiaChatSessionUi.ensureAgentChatSession(cwd);
    }

    protected async cancelActiveTask(taskId: string): Promise<void> {
        await this.activeTaskActionsUi.cancelActiveTask(taskId);
    }

    protected async showTaskLog(project: MobileProjectEntry, taskId: string): Promise<void> {
        await this.activeTaskActionsUi.showTaskLog(project, taskId);
    }

    async showOpenRepositoryDialog(): Promise<void> {
        await this.onNewClick();
    }

    async openProject(project: MobileProjectEntry): Promise<void> {
        await this.projectNavigationUi.openProject(project);
    }

    /**
     * Show the transcript of a conversation in a modal sheet docked inside the projects panel.
     * The agent is still running server-side, so this works even when no workspace is open and
     * even when the user is in a different project's workspace — that is the whole point of the
     * persistent-conversations model.
     */

    protected async submitTranscriptViaBackendConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        content: string,
        options: {
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: AIVariableResolutionRequest[];
            widget?: AIChatInputWidget;
            agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[];
            /** Run beside the open turn instead of taking the conversation over. */
            parallel?: boolean;
        } = {},
    ): Promise<boolean> {
        return this.transcriptSubmitUi.submitTranscriptViaBackendConversation(project, summary, content, options);
    }

    protected collectAgentsHubRecentItems(
        projects: MobileProjectEntry[],
        limit?: number,
        scopeProject?: MobileProjectEntry,
    ): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
        return this.tasksHubUi.collectAgentsHubRecentItems(projects, limit, scopeProject);
    }

    protected updateTasksAttentionChrome(): void {
        this.tasksHubUi.updateTasksAttentionChrome();
    }

    protected updateWorkingPillChrome(): void {
        this.tasksHubUi.updateWorkingPillChrome();
    }

    protected appendTasksHubTeamSection(container: HTMLElement): boolean {
        return this.tasksHubUi.appendTasksHubTeamSection(container);
    }

    protected renderTasksHubView(projects: MobileProjectEntry[]): void {
        this.tasksHubUi.renderTasksHubView(projects);
    }

    protected markTasksFirstLoadComplete(render: boolean): void {
        this.tasksHubUi.markTasksFirstLoadComplete(render);
    }

    protected renderCatalogHubView(): void {
        this.hubCatalogUi.renderCatalogHubView();
    }

    protected async runCatalogAction(action: WorkHubCatalogAction): Promise<void> {
        return this.hubCatalogUi.runCatalogAction(action);
    }

    protected createEmptyState(): HTMLElement {
        return this.reposHubUi.createEmptyState();
    }

    protected createSectionLabel(text: string, withDot: boolean): HTMLElement {
        return this.reposHubUi.createSectionLabel(text, withDot);
    }

    protected resetInboxPullRequestState(): void {
        this.inboxPrUi.resetInboxPullRequestState();
    }

    protected mergeInboxPullRequests(polled: QaapGithubPullRequestSummary[]): QaapGithubPullRequestSummary[] {
        return this.inboxPrUi.mergeInboxPullRequests(polled);
    }

    protected async refreshInboxPullRequests(
        projects: MobileProjectEntry[] | undefined = undefined,
        force = false,
    ): Promise<void> {
        return this.inboxPrUi.refreshInboxPullRequests(
            projects ?? this.hubQueryUi.projectsForCurrentHubList(),
            force,
        );
    }

    protected async refreshWorkHubRoutines(force = false): Promise<void> {
        return this.hubRoutineEditorUi.refreshWorkHubRoutines(force);
    }

    protected async refreshResearchGoals(force = false): Promise<void> {
        return this.hubResearchUi.refreshResearchGoals(force);
    }

    protected openRoutineEditor(routine?: QaapWorkHubRoutine): void {
        this.hubRoutineEditorUi.openRoutineEditor(routine);
    }

    protected closeRoutineEditor(): void {
        this.hubRoutineEditorUi.closeRoutineEditor();
    }

    protected renderRoutinesHubView(): void {
        this.hubRoutinesUi.renderRoutinesHubView();
    }

    protected renderResearchHubView(): void {
        this.hubResearchUi.renderResearchHubView();
    }

    protected openResearchEditor(): void {
        this.hubResearchEditorUi.openResearchEditor();
    }

    protected closeResearchEditor(): void {
        this.hubResearchEditorUi.closeResearchEditor();
    }

    protected sortRoutinesForDisplay(routines: readonly QaapWorkHubRoutine[]): QaapWorkHubRoutine[] {
        return this.hubRoutinesUi.sortRoutinesForDisplay(routines);
    }

    protected patchRoutineLocally(
        id: string,
        patch: Partial<Pick<QaapWorkHubRoutine, 'enabled' | 'lastRunState'>>,
    ): void {
        this.hubRoutinesUi.patchRoutineLocally(id, patch);
    }

    protected async toggleRoutineEnabled(routine: QaapWorkHubRoutine): Promise<void> {
        return this.hubRoutinesUi.toggleRoutineEnabled(routine);
    }

    protected async runRoutineNow(routine: QaapWorkHubRoutine): Promise<void> {
        return this.hubRoutinesUi.runRoutineNow(routine);
    }

    protected collectTeamMembersForHub(): WorkHubTeamMember[] {
        return this.hubTeamDataUi.collectTeamMembersForHub();
    }

    protected collectTeamApprovalItems(members: readonly WorkHubTeamMember[]): WorkHubApprovalItem[] {
        return this.hubTeamDataUi.collectTeamApprovalItems(members);
    }

    protected onTeamMemberClick(member: WorkHubTeamMember): void {
        this.hubTeamDataUi.onTeamMemberClick(member);
    }

    protected async onForkConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        return this.conversationActionsUi.onForkConversation(project, summary);
    }

    protected async onRenameConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        return this.conversationActionsUi.onRenameConversation(project, summary);
    }

    protected async onSetConversationPriority(
        summary: QaapAgentConversationSummaryDTO,
        priority: boolean,
    ): Promise<void> {
        return this.conversationActionsUi.onSetConversationPriority(summary, priority);
    }

    protected async onSetConversationPaused(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        paused: boolean,
    ): Promise<void> {
        return this.conversationActionsUi.onSetConversationPaused(project, summary, paused);
    }

    protected async toggleConversationAutoApproveById(conversationId: string): Promise<void> {
        return this.conversationActionsUi.toggleConversationAutoApproveById(conversationId);
    }

    protected async onSetConversationAutoApprove(
        summary: QaapAgentConversationSummaryDTO,
        autoApprove: boolean,
    ): Promise<void> {
        return this.conversationActionsUi.onSetConversationAutoApprove(summary, autoApprove);
    }

    protected onCancelConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        this.conversationActionsUi.onCancelConversation(project, summary);
    }

    isAgentWorking(): boolean {
        return this.transcriptStickyComposerUi.isTranscriptStickyComposerAgentWorking();
    }

    protected async onRetryConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        return this.conversationActionsUi.onRetryConversation(project, summary);
    }

    cancelOpenTranscriptStream(): void {
        let project = this.transcriptController.state.transcriptOpenProject;
        let summary = this.transcriptController.state.transcriptOpenSummary;
        if (!project || !summary) {
            // No transcript sheet is open — the conversation is showing in the
            // Agents Hub inline shell instead (the default surface). Cancel
            // that one; a bare sheet-state check silently no-ops there.
            project = this.resolveAgentsHubShellProject();
            summary = project ? this.resolveAgentsHubShellSummary(project) : undefined;
        }
        if (project && summary) {
            this.onCancelConversation(project, summary);
        }
    }

    /**
     * Retries whichever conversation is currently open, wired to the closing
     * error card's "Retry" action (see
     * {@link MobileProjectsTranscriptMessagesHost.retryOpenTranscriptConversation}).
     * Mirrors {@link cancelOpenTranscriptStream}'s project/summary resolution:
     * the transcript sheet's open project/summary when a sheet is open,
     * falling back to the Agents Hub inline shell's conversation otherwise —
     * a plain sheet-state check would silently no-op there, which is the
     * default (non-sheet) surface.
     */
    retryOpenTranscriptConversation(): void {
        let project = this.transcriptController.state.transcriptOpenProject;
        let summary = this.transcriptController.state.transcriptOpenSummary;
        if (!project || !summary) {
            project = this.resolveAgentsHubShellProject();
            summary = project ? this.resolveAgentsHubShellSummary(project) : undefined;
        }
        if (project && summary) {
            void this.onRetryConversation(project, summary);
        }
    }

    retryOpenTranscriptStream(): void {
        let project = this.transcriptController.state.transcriptOpenProject;
        let summary = this.transcriptController.state.transcriptOpenSummary;
        if (!project || !summary) {
            // Mirror cancelOpenTranscriptStream: no transcript sheet is open means the
            // conversation is showing in the Agents Hub inline shell (the default surface).
            // A bare sheet-state check silently no-ops there — which left the timeout card's
            // "Retry" dead in the inline shell.
            project = this.resolveAgentsHubShellProject();
            summary = project ? this.resolveAgentsHubShellSummary(project) : undefined;
        }
        if (!project || !summary || isAgentsHubIdleConversationSummary(summary)) {
            // Nothing real to retry (no live conversation yet, or it ended between the
            // watchdog and the click) — never seed a phantom {...idle, streaming} snapshot.
            return;
        }
        this.transcriptLiveUi.applyOptimisticStreamTimeoutRetry(summary);
        this.conversations?.recordSnapshot({ ...summary, status: 'streaming', updatedAt: Date.now() });
        this.renderList();
        void this.transcriptLiveUi.resyncOpenTranscriptStreamAfterTimeout(project, summary);
    }

    retryOpenFailedConversationTask(): void {
        const project = this.transcriptController.state.transcriptOpenProject;
        const summary = this.transcriptController.state.transcriptOpenSummary;
        if (!project || !summary || summary.status !== 'failed') {
            return;
        }
        void this.onRetryConversation(project, summary);
    }

    /**
     * Opens the transcript terminal and starts the agent CLI login flow so the
     * chat can surface the same sign-in URL the agent TUI would print.
     */
    openAgentSignInTerminal(agentId?: string): void {
        const state = this.transcriptController.state;
        const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
        const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
        const resolvedAgentId = agentId?.trim()
            || summary?.agentId
            || state.transcriptLastConv?.agentId;
        if (!resolvedAgentId) {
            return;
        }
        // BYOK / Settings-catalog agents (qaiq, and any agent without a CLI login
        // subcommand) have no terminal sign-in — opening the TUI would sign no one
        // in. Point the user to the API key in Settings instead.
        if (!agentHasCliOAuthLogin(resolvedAgentId)) {
            this.notifyAgentUsesSettingsApiKey(resolvedAgentId);
            return;
        }
        if (!project || !summary) {
            return;
        }
        void this.transcriptSurfacesUi.launchAgentTuiInTranscriptTerminal(
            project,
            summary,
            resolvedAgentId,
            { login: true },
        );
    }

    /**
     * Tell the user that a BYOK / Settings-catalog agent authenticates via an API
     * key in Settings (no terminal sign-in), and offer to open the AI settings.
     */
    protected notifyAgentUsesSettingsApiKey(agentId: string): void {
        const message = localizeAgentSettingsApiKeyLoginMessage(resolveAgentDisplayLabel(agentId));
        const openSettings = nls.localize('qaap/agentLogin/openSettings', 'Open Settings');
        if (this.messageService) {
            void this.messageService.info(message, openSettings).then(action => {
                if (action === openSettings) {
                    void this.openAiConfigurationSheet?.();
                }
            });
            return;
        }
        void this.openAiConfigurationSheet?.();
    }

    protected async onDeleteConversation(summary: QaapAgentConversationSummaryDTO): Promise<void> {
        return this.conversationActionsUi.onDeleteConversation(summary);
    }

    protected async onRenameProject(project: MobileProjectEntry): Promise<void> {
        return this.projectActionsUi.onRenameProject(project);
    }

    protected async onDuplicateProject(project: MobileProjectEntry): Promise<void> {
        return this.projectActionsUi.onDuplicateProject(project);
    }

    protected async onClearProjectChats(project: MobileProjectEntry): Promise<void> {
        this.sessionsSidebar?.hideForMobileOverlay();
        return this.projectActionsUi.onClearProjectChats(project);
    }

    protected async onClearFailedTasks(project: MobileProjectEntry): Promise<void> {
        this.sessionsSidebar?.hideForMobileOverlay();
        return this.projectActionsUi.onClearFailedTasks(project);
    }

    protected async onRemoveProject(project: MobileProjectEntry): Promise<void> {
        return this.projectActionsUi.onRemoveProject(project);
    }

    protected renderReviewHubView(projects: MobileProjectEntry[]): void {
        this.workHubInboxUi.renderReviewHubView(projects);
    }

    protected renderChatHubView(projects: MobileProjectEntry[]): void {
        this.workHubInboxUi.renderChatHubView(projects);
    }

    protected collectChatHubGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; summaries: QaapAgentConversationSummaryDTO[] }> {
        return this.workHubInboxUi.collectChatHubGroups(projects);
    }

    protected projectsForCurrentHubList(): MobileProjectEntry[] {
        return this.hubQueryUi.projectsForCurrentHubList();
    }

    protected collectTasksInboxGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
        return this.workHubInboxUi.collectTasksInboxGroups(projects);
    }

    protected collectReviewGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
        return this.workHubInboxUi.collectReviewGroups(projects);
    }

    protected compareChatInboxProjectOrder(a: MobileProjectEntry, b: MobileProjectEntry): number {
        return this.workHubInboxUi.compareChatInboxProjectOrder(a, b);
    }

    protected createInboxProjectGroup(
        project: MobileProjectEntry,
        items: MobileWorkHubInboxItem[],
    ): HTMLElement {
        return this.workHubInboxUi.createInboxProjectGroup(project, items);
    }

    protected createInboxGithubSignInHint(): HTMLElement {
        return this.workHubInboxUi.createInboxGithubSignInHint();
    }

    protected createReviewEmptyState(): HTMLElement {
        return this.workHubInboxUi.createReviewEmptyState();
    }

    protected createReviewLoadingState(): HTMLElement {
        return this.workHubInboxUi.createReviewLoadingState();
    }

    protected createChatEmptyState(): HTMLElement {
        return this.workHubInboxUi.createChatEmptyState();
    }

    protected formatTheiaChatRequestText(content: string, pinnedAgentId?: string): string {
        return this.theiaChatSessionUi.formatTheiaChatRequestText(content, pinnedAgentId);
    }

    protected async getOrRestoreProjectChatSession(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<ChatSession | undefined> {
        return this.theiaChatSessionUi.getOrRestoreProjectChatSession(project, summary);
    }

    protected async forkTheiaConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<ChatSession | undefined> {
        return this.theiaChatSessionUi.forkTheiaConversation(project, summary);
    }

    protected async getChatServiceConversation(summary: QaapAgentConversationSummaryDTO): Promise<QaapAgentConversationDTO | undefined> {
        return this.theiaChatSessionUi.getChatServiceConversation(summary);
    }

    protected async mountTranscriptChatInput(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        host: HTMLElement,
        submit: (content: string, modeId?: string, capabilityOverrides?: Record<string, boolean>,
            genericCapabilitySelections?: GenericCapabilitySelections, widget?: AIChatInputWidget) => Promise<void>,
    ): Promise<void> {
        return this.theiaChatSessionUi.mountTranscriptChatInput(project, summary, host, submit);
    }

    // ========================================================================
    // WorkHubTranscriptBridge — explicit hub surface for transcript overlay
    // ========================================================================

    isAgentsHubLanding(): boolean {
        return this.shouldUseAgentsHubLanding();
    }

    resolveShellProject(): MobileProjectEntry | undefined {
        return this.resolveAgentsHubShellProject();
    }

    resolveShellSummary(project: MobileProjectEntry): QaapAgentConversationSummaryDTO | undefined {
        return this.resolveAgentsHubShellSummary(project);
    }

    shouldEmbedAgentsHubRecentsInWorkspaceTranscript(): boolean {
        return this.tasksHubUi.shouldEmbedAgentsHubRecentsInWorkspaceTranscript();
    }

    async openInlineTranscript(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        await this.openAgentsHubInlineTranscript(project, summary);
    }

    refreshHubChrome(): void {
        this.renderHeader();
        this.renderSubtitle();
        this.renderList();
    }

    refreshHubSubtitle(): void {
        this.renderSubtitle();
    }

    teardownAgentsHubShell(): void {
        this.teardownAgentsHubExecutionShell();
    }

    refreshHubBottomBar(): void {
        this.notifyWorkspaceHubBottomBarRefresh();
    }

    renderTeamSectionInTranscript(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.ensureOverlayUi().team.renderTeamSection(host, conv);
    }

    renderInlineApproval(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.renderTranscriptInlineApproval(host, conv);
    }

    createAgentsHubRecentsBlock(project: MobileProjectEntry): HTMLElement {
        return this.tasksHubUi.createAgentsHubRecentsBlock(project);
    }

    createAgentsHubLandingHeroBlock(): HTMLElement {
        return this.tasksHubUi.createAgentsHubLandingHeroBlock();
    }

    createAgentsHubQuickActionsBlock(): HTMLElement {
        return this.tasksHubUi.createAgentsHubQuickActionsBlock();
    }

    renderIdleSubmitOptimistic(
        chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
        draft: string,
        selectedAgentId: string,
        imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],
        contentOverride?: string,
    ): void {
        this.renderAgentsHubIdleSubmitOptimistic(chatHost, summary, draft, selectedAgentId, imagePreviews, contentOverride);
    }

    protected shouldUseAgentsHubLanding(): boolean {
        return this.agentsHubInlineUi.shouldUseAgentsHubLanding();
    }

    protected shouldPreserveAgentsHubInlineTranscriptShell(): boolean {
        return this.agentsHubInlineUi.shouldPreserveAgentsHubInlineTranscriptShell();
    }

    protected shouldPreserveAgentsHubExecutionShell(): boolean {
        return this.agentsHubInlineUi.shouldPreserveAgentsHubExecutionShell();
    }

    protected shouldPreserveAgentsHubToolSurface(): boolean {
        return this.agentsHubInlineUi.shouldPreserveAgentsHubToolSurface();
    }

    protected shouldSkipFullRenderListOnConversationTick(): boolean {
        return this.agentsHubInlineUi.shouldSkipFullRenderListOnConversationTick();
    }

    protected refreshWorkHubConversationChrome(): void {
        this.agentsHubInlineUi.refreshWorkHubConversationChrome();
    }

    /** Patch just the one inbox row for a preview-only tick, keeping its progress ring/activity live. */
    protected patchWorkHubConversationRowInPlace(conversationId: string): void {
        const summary = this.conversations?.threadStore.getSummary(conversationId);
        if (summary) {
            this.hubIncrementalUi.patchConversationRowInPlace(summary);
        }
    }

    protected resolveAgentsHubShellProject(): MobileProjectEntry | undefined {
        return this.agentsHubInlineUi.resolveAgentsHubShellProject();
    }

    protected resolveAgentsHubShellSummary(project: MobileProjectEntry): QaapAgentConversationSummaryDTO {
        return this.agentsHubInlineUi.resolveAgentsHubShellSummary(project);
    }

    protected conversationsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[] {
        return this.conversationIndexUi.conversationsForProject(project);
    }

    protected renderAgentsHubExecutionShell(): void {
        this.agentsHubInlineUi.renderAgentsHubExecutionShell();
    }

    protected renderAgentsHubIdleSubmitOptimistic(
        chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
        draft: string,
        agentId: string,
        imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],
        contentOverride?: string,
    ): void {
        this.agentsHubInlineUi.renderAgentsHubIdleSubmitOptimistic(chatHost, summary, draft, agentId, imagePreviews, contentOverride);
    }

    protected teardownAgentsHubExecutionShell(): void {
        this.agentsHubInlineUi.teardownAgentsHubExecutionShell();
    }

    protected async openAgentsHubInlineTranscript(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        await this.agentsHubInlineUi.openAgentsHubInlineTranscript(project, summary);
    }

    closeAgentsHubSession(): void {
        this.agentsHubInlineUi.closeAgentsHubSession();
    }

    resetAgentsHubIdleTranscriptShell(project: MobileProjectEntry): void {
        this.agentsHubInlineUi.resetAgentsHubIdleTranscriptShell(project);
    }

    findConversationSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined {
        return this.conversations?.findSummaryById(id);
    }

    get conversationsOnDidChange(): TheiaEvent<void> {
        return this.conversations?.onDidChange ?? TheiaEvent.None;
    }

    protected syncTranscriptConversationSettledChrome(): void {
        this.transcriptLiveUi.syncTranscriptConversationSettledChrome();
    }

    protected maybeSyncTranscriptVisuallySettledChrome(conv: QaapAgentConversationDTO): void {
        this.transcriptLiveUi.maybeSyncTranscriptVisuallySettledChrome(conv);
    }

    protected isActiveTranscriptConversation(summaryId: string): boolean {
        return this.transcriptLiveUi.isActiveTranscriptConversation(summaryId);
    }

    protected resolveActiveTranscriptChatHost(): HTMLElement | undefined {
        return this.transcriptLiveUi.resolveActiveTranscriptChatHost();
    }

    protected async refreshOpenTranscriptConversation(
        options?: QaapTranscriptLiveRefreshOptions,
    ): Promise<void> {
        await this.transcriptLiveUi.refreshOpenTranscriptConversation(options);
    }

    protected isWatchingOpenTranscript(conversationId: string): boolean {
        return this.transcriptLiveUi.isWatchingOpenTranscript(conversationId);
    }

    protected isAutoVerifyEnabled(cwd: string | undefined): boolean {
        return this.transcriptVerifyUi.isAutoVerifyEnabled(cwd);
    }

    protected setAutoVerifyEnabled(cwd: string | undefined, on: boolean): void {
        this.transcriptVerifyUi.setAutoVerifyEnabled(cwd, on);
    }

    protected refreshTranscriptChecksViews(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        this.transcriptVerifyUi.refreshTranscriptChecksViews(project, summary);
    }

    protected onResumePreview(project: MobileProjectEntry): void | Promise<void> | undefined {
        return this.delegate.onResumePreview?.(project);
    }

    protected renderChecksSection(
        host: HTMLElement | undefined,
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        options: { readonly embedded?: boolean } = {},
    ): void {
        this.transcriptVerifyUi.renderChecksSection(host, project, summary, options);
    }

    protected handleTranscriptStatusForAutoVerify(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        status: QaapAgentConversationSummaryDTO['status'],
    ): void {
        this.transcriptVerifyUi.handleTranscriptStatusForAutoVerify(project, summary, status);
    }

    protected async syncTranscriptPreviewFromConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        conv: QaapAgentConversationDTO,
    ): Promise<void> {
        await this.transcriptSurfacesUi.syncTranscriptPreviewFromConversation(project, summary, conv);
    }

    protected beginTranscriptDevPreviewRequest(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        this.transcriptSurfacesUi.beginTranscriptDevPreviewRequest(project, summary);
    }

    protected stageTranscriptPreviewReadyUrl(readyUrl: string): void {
        const conversationScopeId = normalizeQaapPreviewConversationId(
            this.transcriptController.state.transcriptOpenSummaryId,
        );
        this.transcriptSurfacesUi.stageTranscriptPreviewReadyUrl(conversationScopeId, readyUrl);
    }

    protected ensureOverlayUi(): {
        parallel: MobileProjectsParallelUi;
        team: MobileProjectsTeamUi;
        teamHub: MobileProjectsTeamHubUi;
        home: MobileProjectsHomeUi;
    } {
        return this.overlayFactoryUi.ensureOverlayUi();
    }

    protected appendTranscriptHeaderActions(header: HTMLElement, title: HTMLElement): HTMLButtonElement {
        return this.overlayFactoryUi.appendTranscriptHeaderActions(header, title);
    }

    protected createProjectDetailView(project: MobileProjectEntry): HTMLElement {
        return this.projectDetailUi.createProjectDetailView(project);
    }

    protected disposeTranscriptTerminalSlides(workspaceKey?: TranscriptWorkspaceSurfaceKey): void {
        this.transcriptSurfacesUi.disposeTranscriptTerminalSlides(workspaceKey);
    }

    prepareTranscriptTerminalsForPageUnload(): void {
        this.transcriptSurfacesUi.prepareTranscriptTerminalsForPageUnload();
    }

    protected syncSearchChrome(): void {
        this.repoFiltersUi.syncSearchChrome();
    }

    protected closeParallelSheet(): void {
        this.overlayFactoryUi.closeParallelSheet();
    }

    protected detachTranscriptReviewWidget(): void {
        this.transcriptSurfacesUi.detachTranscriptReviewWidget();
    }

    protected disposeTranscriptEmbeddedPreview(): void {
        this.transcriptSurfacesUi.disposeTranscriptEmbeddedPreview();
    }

    protected detachTranscriptWorkspaceSurfacesFromSheet(): void {
        this.transcriptSurfacesUi.detachTranscriptWorkspaceSurfacesFromSheet();
    }

    protected attachTranscriptChatViewWidget(
        widget: MobileProjectChatViewWidget,
        chatHost: HTMLElement,
        session: ChatSession,
    ): boolean {
        return this.theiaChatSessionUi.attachTranscriptChatViewWidget(widget, chatHost, session);
    }

    protected chatAgentForBackendId(agentId: string | undefined): ChatAgent | undefined {
        return this.theiaChatSessionUi.chatAgentForBackendId(agentId);
    }

    protected resolvePinnedAgentForCwd(cwd: string | undefined): ChatAgent | undefined {
        return this.theiaChatSessionUi.resolvePinnedAgentForCwd(cwd);
    }

    protected renderTranscriptInlineApproval(host: HTMLElement, conv: QaapAgentConversationDTO): void {
        this.transcriptLiveUi.renderTranscriptInlineApproval(host, conv);
    }

    protected dismissPanelIfSheet(): void {
        this.panelLifecycleUi.dismissPanelIfSheet();
    }

    handleComposerContextItemRemoved(entry: StickyComposerContextEntry): void {
        this.composerEditorContextService?.notifyEditorContextRemoved(entry);
    }

    protected createComposerEditorContextPanelDelegate(): import('./qaap-composer-editor-context-service').QaapComposerEditorContextPanelDelegate {
        return {
            resolveActiveComposerContextTarget: () => this.resolveActiveComposerContextTarget(),
            getComposerContextEntries: target => target === 'transcript'
                ? this.transcriptController.state.transcriptComposerContext
                : this.stickyComposerContext,
            upsertEditorContextEntry: (target, entry) => {
                const entries = target === 'transcript'
                    ? this.transcriptController.state.transcriptComposerContext
                    : this.stickyComposerContext;
                const existingIndex = entries.findIndex((item: StickyComposerContextEntry) => item.request.variable.name === entry.request.variable.name);
                if (existingIndex >= 0) {
                    revokeComposerContextPreview(entries[existingIndex]);
                    entries.splice(existingIndex, 1, entry);
                    return;
                }
                entries.push(entry);
            },
            notifyEditorContextRemoved: entry => {
                this.handleComposerContextItemRemoved(entry);
            },
            refreshComposerAfterContextPin: target => {
                if (target === 'transcript') {
                    this.transcriptStickyComposerUi.remountTranscriptStickyComposer();
                    return;
                }
                this.stickyComposerRenderUi.renderStickyComposer();
            },
            focusComposerInput: () => {
                const input = this.root.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input-editor');
                input?.focus();
            },
        };
    }

    protected resolveActiveComposerContextTarget(): import('./qaap-composer-editor-context-service').ComposerEditorContextTarget {
        const state = this.transcriptController.state;
        if (state.transcriptOpenSummary || state.transcriptComposerSummary) {
            return 'transcript';
        }
        return 'sticky';
    }
}
