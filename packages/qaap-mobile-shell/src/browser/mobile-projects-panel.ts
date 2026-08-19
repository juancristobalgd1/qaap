// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Event as TheiaEvent } from '@theia/core/lib/common/event';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import { } from '@theia/core/lib/common/';
import * as markdownit from '@theia/core/shared/markdown-it';
import * as markdownitemoji from '@theia/core/shared/markdown-it-emoji';
import type { QuickPick } from '@theia/core/lib/common/quick-pick-service';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatAgent, ChatService, ChatSession } from '@theia/ai-chat';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { MobileProjectChatViewWidget } from './mobile-project-ai-chat-input-widget';
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
import { confirmRemoveProjectDialog } from './mobile-projects-remove-confirm';
import {
    isAgentsHubExecutionSurfacePainted,
} from '../common/qaap-agents-hub-landing';
import { } from '../common/qaap-preview-identity';
import { QaapChatViewStreamUpdateScheduler } from '../common/qaap-chat-view-stream-update-scheduler';
import { } from './qaap-work-hub-perf-probe';
import type { } from '../common/qaap-work-hub-perf-probe';
import { QaapBoundedLruMap } from './qaap-bounded-lru-map';
import {
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { } from '../common/qaap-conversation-clipboard-text';
import { } from './qaap-agent-ui';
import { } from './mobile-snackbar';
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
    type StickyComposerContextEntry,
} from '../common/qaap-composer-context-entry';
import {
    type QaapAttachComposerImageAttachment,
} from '../common/qaap-preview-feedback-context';
import { URI } from '@theia/core/lib/common/uri';
import { type QaapSegmentedFieldController } from './qaap-mobile-form-ui';
import {
    buildQaapAccountMenuEntries,
    qaapAccountMenuAppearanceFromService,
    toggleQaapAccountMenu,
    type MobileViewToggleId,
} from './qaap-workbench-account-menu';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { AnnotationComposerSessionControls } from '@theia/qaap-adapters/lib/browser/qaap-preview-annotation-popover';
import { } from './qaap-preview-annotation-composer-session';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
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
    type MobileWorkHubInboxItem,
} from './mobile-work-hub-inbox';
import { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import type { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT } from './qaap-mobile-app-tester-contribution';
import { QAAP_NAVIGATE_TO_CONVERSATION_EVENT } from './qaap-turn-settle-notifier';
import {
    type TranscriptWorkspaceSurfaceKey,
} from './qaap-transcript-workspace-surfaces-cache';
import {
    createHeaderIdeViewIcon as createHeaderIdeViewIconHelper,
    createHeaderIdeViewChevron as createHeaderIdeViewChevronHelper,
    appendHeaderOverflowSeparator as appendHeaderOverflowSeparatorHelper,
    positionHeaderIdeViewPickerMenu as positionHeaderIdeViewPickerMenuHelper,
    positionHeaderOverflowMenu as positionHeaderOverflowMenuHelper,
} from './mobile-projects-panel-dom-helpers';
import {
    projectOwnsActiveBootstrap as projectOwnsActiveBootstrapHelper,
    isCopyConversationEnabled as isCopyConversationEnabledHelper,
    resolveActiveConversationForCopy as resolveActiveConversationForCopyHelper,
} from './mobile-projects-panel-helpers';
import { activateAgentsHubProjectExtracted, appendSessionsSidebarConversationItemsExtracted, bindAgentFinishedToastCallbacksExtracted, collectSessionsSidebarPinnedGroupsExtracted, createSessionsSidebarPinnedProjectGroupExtracted, createSessionsSidebarPinnedSectionExtracted, createSessionsSidebarProjectGroupExtracted, createSessionsSidebarProjectRowHeadExtracted, createSessionsSidebarShowMoreControlExtracted, disposeExtracted, ensureAgentsHubExecutionShellRenderedExtracted, getFilteredTeamHubStateExtracted, getSessionsSidebarConversationDisplayLimitExtracted, hideExtracted, installAgentsHubEmptySurfaceGuardExtracted, maybeInstallWorkHubPerfProbeExtracted, onHeaderProjectClickExtracted, onNavigateToConversationHandler, openDesktopIdeFromAgentsHubExtracted, resolveSessionsSidebarVisibleConversationsExtracted, selectHubLandingViewExtracted, syncCurrentProjectsScrollHostExtracted, syncHeaderIdeViewPickerExtracted, syncWorkHubProjectSkillRootsExtracted, touchProjectActivityByConversationIdExtracted, tryPatchHubListBeforeRebuildExtracted } from './mobile-projects-panel-render2';
import { activateMessagesSurfaceForExternalSubmitExtracted, attachExternalComposerContextExtracted, attachExternalFeedbackImageEntriesExtracted, closeHeaderIdeViewPickerMenuExtracted, closeHeaderOverflowMenuExtracted, copyActiveConversationToClipboardExtracted, ensureExternalSubmitConversationRenderedExtracted, ensureHeaderIdeViewPickerMenuExtracted, ensureHeaderOverflowMenuExtracted, isHeaderOverflowMenuItemEnabledExtracted, isHeaderOverflowMenuItemVisibleExtracted, onHeaderIdeViewPickerClickExtracted, onHeaderOverflowMenuClickExtracted, openConversationSummaryExtracted, openHeaderIdeViewPickerMenuExtracted, openHeaderOverflowMenuExtracted, renderHeaderOverflowMenuItemsExtracted, resolveAnnotationComposerSessionExtracted, resolveExternalComposerUploadDirExtracted, sendExternalComposerContextExtracted, shouldEmbedSessionsSidebarInPanelExtracted, submitBackgroundAgentTaskExtracted } from './mobile-projects-panel-streaming2';
import { cancelOpenTranscriptStreamExtracted, collectAgentsHubRecentItemsExtracted, collectChatHubGroupsExtracted, collectReviewGroupsExtracted, collectTasksInboxGroupsExtracted, createInboxProjectGroupExtracted, createProjectChatSessionExtracted, forkTheiaConversationExtracted, getOrRestoreProjectChatSessionExtracted, mountTranscriptChatInputExtracted, notifyAgentUsesSettingsApiKeyExtracted, onArchiveConversationExtracted, onCancelConversationExtracted, onDeleteConversationExtracted, onForkConversationExtracted, onRenameConversationExtracted, onRetryConversationExtracted, onSetConversationAutoApproveExtracted, onSetConversationPausedExtracted, onSetConversationPriorityExtracted, openAgentSignInTerminalExtracted, openExternalParallelRunsSheetExtracted, openInlineTranscriptExtracted, patchWorkHubConversationRowInPlaceExtracted, pickAgentAndSubmitExternalPromptExtracted, refreshHubChromeExtracted, refreshInboxPullRequestsExtracted, removeExternalPreviewFeedbackChipExtracted, renderIdleSubmitOptimisticExtracted, resolveExternalComposerProjectExtracted, retryOpenFailedConversationTaskExtracted, retryOpenTranscriptConversationExtracted, retryOpenTranscriptStreamExtracted, seedTranscriptOptimisticSubmitExtracted, selectBackendConversationAgentExtracted, shouldUseTheiaCoderExtracted, submitExternalComposerPromptExtracted, submitTranscriptViaBackendConversationExtracted } from './mobile-projects-panel-timeline2';
import { attachTranscriptChatViewWidgetExtracted, beginTranscriptDevPreviewRequestExtracted, createComposerEditorContextPanelDelegateExtracted, ensureOverlayUiExtracted, handleTranscriptStatusForAutoVerifyExtracted, openAgentsHubInlineTranscriptExtracted, refreshOpenTranscriptConversationExtracted, refreshTranscriptChecksViewsExtracted, releasePreviewForConversationExtracted, renderAgentsHubIdleSubmitOptimisticExtracted, renderChecksSectionExtracted, resolveActiveComposerContextTargetExtracted, stageTranscriptPreviewReadyUrlExtracted, syncTranscriptPreviewFromConversationExtracted } from './mobile-projects-panel-activity2';


import {
    type MobileProjectsPanelDelegate,
    type MobileProjectsPanelOptions,
    type MobileProjectsHeaderOverflowMenuItem,
    type WorkHubSearchPickItem,
    type QaapDiffProjectTab,
    type TranscriptTab,
    type WorkHubSearchTarget,
    type ExecutionSurfaceTabId,
    TRANSCRIPT_CONVERSATION_CACHE_LIMIT,
} from './mobile-projects-panel-types';

// Re-export types for external consumers
export {
    type MobileProjectsPanelDelegate,
    type MobileProjectsPanelOptions,
    type MobileProjectsHeaderOverflowMenuItem,
    type WorkHubSearchPickItem,
    type QaapDiffProjectTab,
    type TranscriptTab,
    type WorkHubSearchTarget,
    TRANSCRIPT_CONVERSATION_CACHE_LIMIT,
} from './mobile-projects-panel-types';

import {
    applyPanelOptions,
    wireTranscriptFileOpeners,
    createPanelRoot,
    onBootstrapPreviewOpenedHandler,
    onAuthSessionChangedHandler,
} from './mobile-projects-panel-init';

export class MobileProjectsPanel implements WorkHubTranscriptBridge {

    /** Max conversation rows per repo card before "More" expands the list. */
    protected static readonly CONVERSATIONS_COLLAPSED_LIMIT = MOBILE_PROJECTS_CONVERSATIONS_COLLAPSED_LIMIT;

    /** Max automatic verify→fix loops before the closed loop gives up (avoids runaway turns/cost). */
    protected readonly transcriptMarkdownIt = markdownit({ linkify: true }).use(markdownitemoji.full);

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
    protected readonly headerProjectCluster: HTMLElement;
    protected readonly headerProjectBtn: HTMLButtonElement;
    protected readonly headerProjectLabelEl: HTMLSpanElement;
    protected readonly headerConversationsBtn: HTMLButtonElement;
    protected readonly headerNewChatBtn: HTMLButtonElement;
    protected readonly headerOverflowMenuBtn: HTMLButtonElement;
    protected readonly newFabBtn: HTMLButtonElement;
    protected readonly headerIdeViewPickerHost: HTMLElement;
    protected readonly headerSurfacePickerHost: HTMLElement;
    protected readonly headerExecutionCluster: HTMLElement;
    protected readonly headerPreviewRunHost: HTMLElement;
    protected readonly headerFilesMoreHost: HTMLElement;
    protected readonly headerViewModeSwitchHost: HTMLElement;
    protected readonly headerIdeAgentsSwitchHost: HTMLElement;
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
    protected readonly inboxPrUi = new MobileProjectsInboxPrUi(this as unknown as MobileProjectsInboxPrHost);
    protected readonly cardMenuUi = new MobileProjectsCardMenuUi(this as unknown as MobileProjectsCardMenuHost);
    protected readonly projectRowsUi = new MobileProjectsProjectRowsUi(this as unknown as MobileProjectsProjectRowsHost);
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
    protected readonly dropComposerFiles: MobileProjectsPanelOptions['dropComposerFiles'];
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
    protected readonly agentFinishedToast: MobileProjectsPanelOptions['agentFinishedToast'];
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
        onAuthSessionChangedHandler(this);
    };

    protected readonly onAccountClick = (): void => {
        toggleQaapAccountMenu(
            this.accountBtn,
            this.commands,
            buildQaapAccountMenuEntries(readQaapSignedIn()),
            {
                section: QAAP_WORK_HUB_GETTING_STARTED,
                onCatalogAction: action => { void this.runCatalogAction(action); },
            },
            {
                appearance: qaapAccountMenuAppearanceFromService(this.appearanceModeService),
            },
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
        applyPanelOptions(this, options);
        wireTranscriptFileOpeners(this, options);
        createPanelRoot(this);

        const grabber = this.panelChromeUi.constructPanelShell();
        this.panelChromeUi.wirePanelInteractions(grabber, this.onAuthSessionChanged);
        this.installAgentsHubEmptySurfaceGuard();
        window.addEventListener(QAAP_BOOTSTRAP_PREVIEW_OPENED_EVENT, this.onBootstrapPreviewOpened);
        window.addEventListener(QAAP_NAVIGATE_TO_CONVERSATION_EVENT, this.onNavigateToConversation);
        this.bindAgentFinishedToastCallbacks();
    }

    protected bindAgentFinishedToastCallbacks(): void {
        bindAgentFinishedToastCallbacksExtracted(this);
    }

    protected readonly onBootstrapPreviewOpened = (event: Event): void => {
        onBootstrapPreviewOpenedHandler(this, event);
    };

    protected readonly onNavigateToConversation = (event: Event): void => {
        onNavigateToConversationHandler(this, event);
    };

    /** True when `project`'s clone directory is the workspace the bootstrap service operates on. */
    protected projectOwnsActiveBootstrap(project: MobileProjectEntry): boolean {
        return projectOwnsActiveBootstrapHelper(project, this.projectBootstrap, this.projectsService, this.preparedCwdByProjectId);
    }

    protected handleHeaderBackClick(): void {
        this.hubHeaderUi.handleHeaderBackClick();
    }

    protected selectTranscriptTab(tab: ExecutionSurfaceTabId, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): void {
        this.executionSurfaceTabsUi.selectTranscriptTab(tab, project, summary);
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

    ensureAgentsHubExecutionShellRendered(): void {
        ensureAgentsHubExecutionShellRenderedExtracted(this);
    }

    /**
     * Re-evaluate sticky composer visibility after the panel's host widget is attached to the DOM.
     * The panel creates its execution shell in @postConstruct init(), before the widget is attached —
     * at that point chatHost?.isConnected is false, so renderStickyComposer() hides the composer.
     * This call corrects the visibility once the elements are live in the DOM.
     */
    refreshStickyComposerAfterAttach(): void {
        if (this.visible) {
            this.stickyComposerRenderUi.renderStickyComposer();
        }
    }

    protected currentProjectsScrollHost(): HTMLElement {
        return this.root.querySelector<HTMLElement>(':scope > .theia-mobile-projects-scroll') ?? this.scroll;
    }

    protected syncCurrentProjectsScrollHost(): void {
        syncCurrentProjectsScrollHostExtracted(this);
    }

    protected installAgentsHubEmptySurfaceGuard(): void {
        installAgentsHubEmptySurfaceGuardExtracted(this);
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

    selectHubLandingView(view: MobileProjectsHubView, preferredDiffProjectId?: string, options?: { force?: boolean },): void {
        selectHubLandingViewExtracted(this, view, preferredDiffProjectId, options);
    }

    navigateHubTab(view: MobileProjectsHubView): void {
        this.hubLandingUi.navigateHubTab(view);
    }

    async openProjectDiffView(preferredProjectId?: string): Promise<void> {
        await this.hubLandingUi.openProjectDiffView(preferredProjectId);
    }

    closeProjectDiffView(): void {
        this.hubLandingUi.closeProjectDiffView();
    }

    dispose(): void {
        disposeExtracted(this);
    }

    async show(options?: { preferredHubView?: MobileProjectsHubView }): Promise<void> {
        await this.panelLifecycleUi.show(options);
        this.composerEditorContextService?.registerPanelDelegate(this.createComposerEditorContextPanelDelegate());
    }

    hide(): void {
        hideExtracted(this);
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
        this.panelChromeUi.syncHeaderIdeAgentsSwitch();
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

    protected async activateAgentsHubProject(project: MobileProjectEntry): Promise<void> {
        return activateAgentsHubProjectExtracted(this, project);
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

    touchProjectActivityByConversationId(conversationId: string): void {
        touchProjectActivityByConversationIdExtracted(this, conversationId);
    }

    syncWorkHubProjectSkillRoots(): void {
        syncWorkHubProjectSkillRootsExtracted(this);
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
        return tryPatchHubListBeforeRebuildExtracted(this);
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
        maybeInstallWorkHubPerfProbeExtracted(this);
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
        return getFilteredTeamHubStateExtracted(this);
    }

    openWorkHubSessionsSidebar(): void {
        this.sessionsSidebarUi.openWorkHubSessionsSidebar();
    }

    async openDesktopIdeFromAgentsHub(): Promise<void> {
        return openDesktopIdeFromAgentsHubExtracted(this);
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

    protected collectSessionsSidebarPinnedGroups(projects: MobileProjectEntry[], query: string,): Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }> {
        return collectSessionsSidebarPinnedGroupsExtracted(this, projects, query);
    }

    protected createSessionsSidebarPinnedSection(groups: Array<{ project: MobileProjectEntry; conversations: QaapAgentConversationSummaryDTO[] }>, onActivate: () => void, bypassConversationLimit = false,): HTMLElement {
        return createSessionsSidebarPinnedSectionExtracted(this, groups, onActivate, bypassConversationLimit);
    }

    protected getSessionsSidebarConversationDisplayLimit(project: MobileProjectEntry, totalCount: number, bypassLimit: boolean,): number {
        return getSessionsSidebarConversationDisplayLimitExtracted(this, project, totalCount, bypassLimit);
    }

    protected resolveSessionsSidebarVisibleConversations(project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], bypassLimit: boolean,): { visible: QaapAgentConversationSummaryDTO[]; hiddenCount: number; showLess: boolean } {
        return resolveSessionsSidebarVisibleConversationsExtracted(this, project, conversations, bypassLimit);
    }

    protected appendSessionsSidebarConversationItems(listHost: HTMLElement, project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], onActivate: () => void, bypassLimit: boolean,): void {
        appendSessionsSidebarConversationItemsExtracted(this, listHost, project, conversations, onActivate, bypassLimit);
    }

    protected createSessionsSidebarShowMoreControl(project: MobileProjectEntry, hiddenCount: number, totalCount: number,): HTMLButtonElement {
        return createSessionsSidebarShowMoreControlExtracted(this, project, hiddenCount, totalCount);
    }

    protected createSessionsSidebarShowLessControl(project: MobileProjectEntry): HTMLButtonElement {
        return this.sessionsSidebarUi.createSessionsSidebarShowLessControl(project);
    }

    protected createSessionsSidebarPinnedProjectGroup(project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], onActivate: () => void, bypassConversationLimit = false,): HTMLElement {
        return createSessionsSidebarPinnedProjectGroupExtracted(this, project, conversations, onActivate, bypassConversationLimit);
    }

    /** Expand current workspace (+ running) by default; user toggles persist for the session. */
    protected seedSessionsSidebarAccordionDefaults(projects: MobileProjectEntry[]): void {
        this.sessionsSidebarUi.seedSessionsSidebarAccordionDefaults(projects);
    }

    protected createSessionsSidebarProjectGroup(project: MobileProjectEntry, conversations: readonly QaapAgentConversationSummaryDTO[], onActivate: () => void, bypassConversationLimit = false,): HTMLElement {
        return createSessionsSidebarProjectGroupExtracted(this, project, conversations, onActivate, bypassConversationLimit);
    }

    protected createSessionsSidebarProjectRowHead(project: MobileProjectEntry, expanded: boolean, onToggleExpand: () => void,): HTMLElement {
        return createSessionsSidebarProjectRowHeadExtracted(this, project, expanded, onToggleExpand);
    }

    protected async selectSessionsSidebarProject(project: MobileProjectEntry): Promise<void> {
        const context = this.resolveAgentsHubShellProject()
            ?? this.transcriptController.state.transcriptOpenProject
            ?? this.projects.find(entry => entry.isCurrent)
            ?? this.projects[0];
        if (!context) {
            await this.activateAgentsHubProject(project);
            return;
        }
        await this.stickyComposerWorkspaceUi.selectComposerWorkspaceProject(project, context);
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
        onHeaderProjectClickExtracted(this, anchor);
    }

    protected onHeaderConversationsClick(anchor: HTMLButtonElement): void {
        this.hubHeaderUi.openHeaderConversationMenu(anchor);
    }

    protected syncHeaderIdeViewPicker(): void {
        syncHeaderIdeViewPickerExtracted(this);
    }

    protected onHeaderViewModeChange(id: MobileViewToggleId): void {
        this.sessionsSidebarUi.onSessionsSidebarViewModeChange(id);
    }

    protected createHeaderIdeViewIcon(icon: string): HTMLElement {
        return createHeaderIdeViewIconHelper(icon);
    }

    protected createHeaderIdeViewChevron(): HTMLElement {
        return createHeaderIdeViewChevronHelper();
    }

    protected onHeaderIdeViewPickerClick(event: MouseEvent): void {
        onHeaderIdeViewPickerClickExtracted(this, event);
    }

    protected openHeaderIdeViewPickerMenu(): void {
        openHeaderIdeViewPickerMenuExtracted(this);
    }

    protected ensureHeaderIdeViewPickerMenu(): HTMLElement {
        return ensureHeaderIdeViewPickerMenuExtracted(this);
    }

    protected closeHeaderIdeViewPickerMenu(): void {
        closeHeaderIdeViewPickerMenuExtracted(this);
    }

    protected positionHeaderIdeViewPickerMenu(): void {
        positionHeaderIdeViewPickerMenuHelper(this.headerIdeViewPickerMenu, this.headerIdeViewPickerBtn);
    }

    protected onHeaderOverflowMenuClick(event: MouseEvent): void {
        onHeaderOverflowMenuClickExtracted(this, event);
    }

    protected openHeaderOverflowMenu(): void {
        openHeaderOverflowMenuExtracted(this);
    }

    protected ensureHeaderOverflowMenu(): HTMLElement {
        return ensureHeaderOverflowMenuExtracted(this);
    }

    protected closeHeaderOverflowMenu(): void {
        closeHeaderOverflowMenuExtracted(this);
    }

    protected positionHeaderOverflowMenu(): void {
        positionHeaderOverflowMenuHelper(this.headerOverflowMenu, this.headerOverflowMenuBtn);
    }

    protected renderHeaderOverflowMenuItems(menu: HTMLElement): void {
        renderHeaderOverflowMenuItemsExtracted(this, menu);
    }

    protected isHeaderOverflowMenuItemVisible(item: MobileProjectsHeaderOverflowMenuItem): boolean {
        return isHeaderOverflowMenuItemVisibleExtracted(this, item);
    }

    protected isHeaderOverflowMenuItemEnabled(item: MobileProjectsHeaderOverflowMenuItem): boolean {
        return isHeaderOverflowMenuItemEnabledExtracted(this, item);
    }

    protected appendHeaderOverflowSeparator(menu: HTMLElement): void {
        appendHeaderOverflowSeparatorHelper(menu);
    }

    protected isCopyConversationEnabled(): boolean {
        return isCopyConversationEnabledHelper(this.transcriptController, this.transcriptConversationCache);
    }

    protected async resolveActiveConversationForCopy(): Promise<QaapAgentConversationDTO | undefined> {
        return resolveActiveConversationForCopyHelper(this.transcriptController, this.transcriptConversationCache, this.conversations);
    }

    protected async copyActiveConversationToClipboard(): Promise<void> {
        return copyActiveConversationToClipboardExtracted(this);
    }

    async openHeaderNewChat(): Promise<void> {
        await this.onHeaderNewChatClick();
    }

    isHeaderNewChatVisible(): boolean {
        return this.hubHeaderUi.resolveHeaderNewChatVisible();
    }

    protected shouldEmbedSessionsSidebarInPanel(): boolean {
        return shouldEmbedSessionsSidebarInPanelExtracted(this);
    }

    /** Mockup `newChat()`: misma vista vacía que Agents (idle), no una sesión paralela. */
    protected async openEmptyMobileChatSheet(project: MobileProjectEntry): Promise<void> {
        await this.sessionsSidebarUi.openEmptyMobileChatSheet(project);
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

    protected async openConversationSummary(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return openConversationSummaryExtracted(this, project, summary);
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

    protected async submitBackgroundAgentTask(project: MobileProjectEntry, draft: string, options: { openConversation?: boolean; forceVps?: boolean; selectedAgentId?: string; modeId?: string; autoApprove?: boolean; approvalPolicyId?: string; toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules; capabilityOverrides?: Record<string, boolean>; genericCapabilitySelections?: GenericCapabilitySelections; variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>; worktree?: boolean; agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel; } = {},): Promise<QaapAgentConversationSummaryDTO | undefined> {
        return submitBackgroundAgentTaskExtracted(this, project, draft, options);
    }

    resolveAnnotationComposerSession(): AnnotationComposerSessionControls | undefined {
        return resolveAnnotationComposerSessionExtracted(this);
    }

    attachExternalComposerContext(args: { readonly chipTitle: string; readonly contextBody: string; readonly dedupeKey: string; readonly images?: readonly QaapAttachComposerImageAttachment[]; }): boolean {
        return attachExternalComposerContextExtracted(this, args);
    }

    async sendExternalComposerContext(args: { readonly chipTitle: string; readonly contextBody: string; readonly dedupeKey: string; readonly images?: readonly QaapAttachComposerImageAttachment[]; }): Promise<boolean> {
        return sendExternalComposerContextExtracted(this, args);
    }

    protected resolveExternalComposerUploadDir(project: MobileProjectEntry): URI | undefined {
        return resolveExternalComposerUploadDirExtracted(this, project);
    }

    protected attachExternalFeedbackImageEntries(requests: readonly AIVariableResolutionRequest[]): void {
        attachExternalFeedbackImageEntriesExtracted(this, requests);
    }

    protected activateMessagesSurfaceForExternalSubmit(project: MobileProjectEntry): void {
        activateMessagesSurfaceForExternalSubmitExtracted(this, project);
    }

    protected ensureExternalSubmitConversationRendered(): void {
        ensureExternalSubmitConversationRenderedExtracted(this);
    }

    protected removeExternalPreviewFeedbackChip(dedupeKey: string): void {
        removeExternalPreviewFeedbackChipExtracted(this, dedupeKey);
    }

    async submitExternalComposerPrompt(draft: string, options: { readonly agentId?: string; readonly agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel; } = {},): Promise<boolean> {
        return submitExternalComposerPromptExtracted(this, draft, options);
    }

    pickAgentAndSubmitExternalPrompt(draft: string, options: { readonly title?: string; readonly intro?: string; readonly anchor?: HTMLElement; } = {},): boolean {
        return pickAgentAndSubmitExternalPromptExtracted(this, draft, options);
    }

    openExternalParallelRunsSheet(prompt: string): boolean {
        return openExternalParallelRunsSheetExtracted(this, prompt);
    }

    protected resolveExternalComposerProject(): MobileProjectEntry | undefined {
        return resolveExternalComposerProjectExtracted(this);
    }

    protected async createProjectChatSession(project: MobileProjectEntry, cwd: string, draft: string, options: { forceVps?: boolean; selectedAgentId?: string; modeId?: string; autoApprove?: boolean; approvalPolicyId?: string; toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules; capabilityOverrides?: Record<string, boolean>; genericCapabilitySelections?: GenericCapabilitySelections; variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>; agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel; latencyMarks?: import('../common/qaap-agent-conversation-client').QaapPostConversationMessageOptions['latencyMarks']; },): Promise<import('./mobile-projects-background-task-ui').QaapProjectChatSessionCreated> {
        return createProjectChatSessionExtracted(this, project, cwd, draft, options);
    }

    seedTranscriptOptimisticSubmit(summary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO, outbound: string, agentId?: string, imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],): void {
        seedTranscriptOptimisticSubmitExtracted(this, summary, outbound, agentId, imagePreviews);
    }

    /** Roll back the pre-create idle optimistic paint after the server rejected the create. */
    rollbackTranscriptOptimisticSubmit(): void {
        this.agentsHubInlineUi.rollbackAgentsHubIdleSubmitOptimistic();
    }

    protected shouldUseTheiaCoder(content: string, selectedAgentId?: string, options: { forceVps?: boolean; isLegacyTheiaChat?: boolean } = {},): boolean {
        return shouldUseTheiaCoderExtracted(this, content, selectedAgentId, options);
    }

    protected async loadBackendAgentSnapshot(): Promise<QaapAgentTaskListSnapshot> {
        return this.backgroundTaskUi.loadBackendAgentSnapshot();
    }

    protected async selectBackendConversationAgent(cwd: string, prompt: string, selectedAgentId?: string, conversationAgentId?: string,): Promise<string> {
        return selectBackendConversationAgentExtracted(this, cwd, prompt, selectedAgentId, conversationAgentId);
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

    protected async submitTranscriptViaBackendConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, content: string, options: { selectedAgentId?: string; modeId?: string; autoApprove?: boolean; approvalPolicyId?: string; toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules; capabilityOverrides?: Record<string, boolean>; genericCapabilitySelections?: GenericCapabilitySelections; variables?: AIVariableResolutionRequest[]; widget?: AIChatInputWidget; agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel; imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[]; parallel?: boolean; deliveryMode?: import('../common/qaap-agent-conversation-client').QaapMessageDeliveryMode; } = {},): Promise<boolean> {
        return submitTranscriptViaBackendConversationExtracted(this, project, summary, content, options);
    }

    protected collectAgentsHubRecentItems(projects: MobileProjectEntry[], limit?: number, scopeProject?: MobileProjectEntry,): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
        return collectAgentsHubRecentItemsExtracted(this, projects, limit, scopeProject);
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

    protected resetInboxPullRequestState(): void {
        this.inboxPrUi.resetInboxPullRequestState();
    }

    protected mergeInboxPullRequests(polled: QaapGithubPullRequestSummary[]): QaapGithubPullRequestSummary[] {
        return this.inboxPrUi.mergeInboxPullRequests(polled);
    }

    protected async refreshInboxPullRequests(projects: MobileProjectEntry[] | undefined = undefined, force = false,): Promise<void> {
        return refreshInboxPullRequestsExtracted(this, projects, force);
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

    protected async onForkConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return onForkConversationExtracted(this, project, summary);
    }

    protected async onRenameConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return onRenameConversationExtracted(this, project, summary);
    }

    protected async onSetConversationPriority(summary: QaapAgentConversationSummaryDTO, priority: boolean,): Promise<void> {
        return onSetConversationPriorityExtracted(this, summary, priority);
    }

    protected async onSetConversationPaused(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, paused: boolean,): Promise<void> {
        return onSetConversationPausedExtracted(this, project, summary, paused);
    }

    protected async toggleConversationAutoApproveById(conversationId: string): Promise<void> {
        return this.conversationActionsUi.toggleConversationAutoApproveById(conversationId);
    }

    protected async onSetConversationAutoApprove(summary: QaapAgentConversationSummaryDTO, autoApprove: boolean,): Promise<void> {
        return onSetConversationAutoApproveExtracted(this, summary, autoApprove);
    }

    protected onCancelConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        onCancelConversationExtracted(this, project, summary);
    }

    isAgentWorking(): boolean {
        return this.transcriptStickyComposerUi.isTranscriptStickyComposerAgentWorking();
    }

    protected async onRetryConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return onRetryConversationExtracted(this, project, summary);
    }

    cancelOpenTranscriptStream(): void {
        cancelOpenTranscriptStreamExtracted(this);
    }

    retryOpenTranscriptConversation(): void {
        retryOpenTranscriptConversationExtracted(this);
    }

    retryOpenTranscriptStream(): void {
        retryOpenTranscriptStreamExtracted(this);
    }

    retryOpenFailedConversationTask(): void {
        retryOpenFailedConversationTaskExtracted(this);
    }

    openAgentSignInTerminal(agentId?: string): void {
        openAgentSignInTerminalExtracted(this, agentId);
    }

    protected notifyAgentUsesSettingsApiKey(agentId: string): void {
        notifyAgentUsesSettingsApiKeyExtracted(this, agentId);
    }

    protected async onDeleteConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return onDeleteConversationExtracted(this, project, summary);
    }

    protected async onArchiveConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return onArchiveConversationExtracted(this, project, summary);
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

    protected async onClearFailedTasks(project: MobileProjectEntry, ids?: readonly string[]): Promise<boolean> {
        if (!ids || ids.length === 0) {
            this.sessionsSidebar?.hideForMobileOverlay();
        }
        return this.projectActionsUi.onClearFailedTasks(project, ids);
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

    protected collectChatHubGroups(projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; summaries: QaapAgentConversationSummaryDTO[] }> {
        return collectChatHubGroupsExtracted(this, projects);
    }

    protected projectsForCurrentHubList(): MobileProjectEntry[] {
        return this.hubQueryUi.projectsForCurrentHubList();
    }

    protected collectTasksInboxGroups(projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
        return collectTasksInboxGroupsExtracted(this, projects);
    }

    protected collectReviewGroups(projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
        return collectReviewGroupsExtracted(this, projects);
    }

    protected compareChatInboxProjectOrder(a: MobileProjectEntry, b: MobileProjectEntry): number {
        return this.workHubInboxUi.compareChatInboxProjectOrder(a, b);
    }

    protected createInboxProjectGroup(project: MobileProjectEntry, items: MobileWorkHubInboxItem[],): HTMLElement {
        return createInboxProjectGroupExtracted(this, project, items);
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

    protected async getOrRestoreProjectChatSession(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<ChatSession | undefined> {
        return getOrRestoreProjectChatSessionExtracted(this, project, summary);
    }

    protected async forkTheiaConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<ChatSession | undefined> {
        return forkTheiaConversationExtracted(this, project, summary);
    }

    protected async getChatServiceConversation(summary: QaapAgentConversationSummaryDTO): Promise<QaapAgentConversationDTO | undefined> {
        return this.theiaChatSessionUi.getChatServiceConversation(summary);
    }

    protected async mountTranscriptChatInput(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, host: HTMLElement, submit: (content: string, modeId?: string, capabilityOverrides?: Record<string, boolean>, genericCapabilitySelections?: GenericCapabilitySelections, widget?: AIChatInputWidget) => Promise<void>,): Promise<void> {
        return mountTranscriptChatInputExtracted(this, project, summary, host, submit);
    }

    // ========================================================================
    // WorkHubTranscriptBridge — explicit hub surface for transcript overlay
    // ========================================================================

    isAgentsHubLanding(): boolean {
        return this.shouldUseAgentsHubLanding();
    }

    getAgentsHubSelectedProjectId(): string | undefined {
        return this.agentsHubSelectedProjectId;
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

    async openInlineTranscript(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return openInlineTranscriptExtracted(this, project, summary);
    }

    refreshHubChrome(): void {
        refreshHubChromeExtracted(this);
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

    renderIdleSubmitOptimistic(chatHost: HTMLElement, summary: QaapAgentConversationSummaryDTO, draft: string, selectedAgentId: string, imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[], contentOverride?: string,): void {
        renderIdleSubmitOptimisticExtracted(this, chatHost, summary, draft, selectedAgentId, imagePreviews, contentOverride);
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

    protected syncDesktopWorkHubLayout(): void {
        this.sessionsSidebar?.syncDesktopLayout();
        this.panelChromeUi.syncHeaderIdeAgentsSwitch();
    }

    /** Reconcile the open sessions sidebar when the window crosses the mobile breakpoint. */
    syncSessionsSidebarLayout(): void {
        this.sessionsSidebarUi.syncWorkHubSessionsSidebarLayout();
    }

    protected patchWorkHubConversationRowInPlace(conversationId: string): void {
        patchWorkHubConversationRowInPlaceExtracted(this, conversationId);
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

    protected renderAgentsHubIdleSubmitOptimistic(chatHost: HTMLElement, summary: QaapAgentConversationSummaryDTO, draft: string, agentId: string, imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[], contentOverride?: string,): void {
        renderAgentsHubIdleSubmitOptimisticExtracted(this, chatHost, summary, draft, agentId, imagePreviews, contentOverride);
    }

    protected teardownAgentsHubExecutionShell(): void {
        this.agentsHubInlineUi.teardownAgentsHubExecutionShell();
    }

    protected async openAgentsHubInlineTranscript(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): Promise<void> {
        return openAgentsHubInlineTranscriptExtracted(this, project, summary);
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

    protected async refreshOpenTranscriptConversation(options?: QaapTranscriptLiveRefreshOptions,): Promise<void> {
        return refreshOpenTranscriptConversationExtracted(this, options);
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

    protected refreshTranscriptChecksViews(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        refreshTranscriptChecksViewsExtracted(this, project, summary);
    }

    protected onResumePreview(project: MobileProjectEntry): void | Promise<void> | undefined {
        return this.delegate.onResumePreview?.(project);
    }

    protected renderChecksSection(host: HTMLElement | undefined, project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, options: { readonly embedded?: boolean } = {},): void {
        renderChecksSectionExtracted(this, host, project, summary, options);
    }

    protected handleTranscriptStatusForAutoVerify(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, status: QaapAgentConversationSummaryDTO['status'],): void {
        handleTranscriptStatusForAutoVerifyExtracted(this, project, summary, status);
    }

    protected async syncTranscriptPreviewFromConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO, conv: QaapAgentConversationDTO,): Promise<void> {
        return syncTranscriptPreviewFromConversationExtracted(this, project, summary, conv);
    }

    protected beginTranscriptDevPreviewRequest(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        beginTranscriptDevPreviewRequestExtracted(this, project, summary);
    }

    protected async requestTranscriptPreview(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        options?: { readonly revealPreviewTab?: boolean; readonly allowAgentFallback?: boolean },
    ): Promise<void> {
        return this.transcriptSurfacesUi.requestTranscriptPreview(project, summary, options);
    }

    protected stageTranscriptPreviewReadyUrl(readyUrl: string): void {
        stageTranscriptPreviewReadyUrlExtracted(this, readyUrl);
    }

    protected ensureOverlayUi(): {
        parallel: MobileProjectsParallelUi;
        team: MobileProjectsTeamUi;
        teamHub: MobileProjectsTeamHubUi;
        home: MobileProjectsHomeUi;
    } {
        return ensureOverlayUiExtracted(this);
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

    releasePreviewForConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO,): void {
        releasePreviewForConversationExtracted(this, project, summary);
    }

    protected confirmRemoveProject(project: MobileProjectEntry): Promise<boolean | undefined> {
        return confirmRemoveProjectDialog(project);
    }

    protected detachTranscriptWorkspaceSurfacesFromSheet(): void {
        this.transcriptSurfacesUi.detachTranscriptWorkspaceSurfacesFromSheet();
    }

    protected attachTranscriptChatViewWidget(widget: MobileProjectChatViewWidget, chatHost: HTMLElement, session: ChatSession,): boolean {
        return attachTranscriptChatViewWidgetExtracted(this, widget, chatHost, session);
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
        return createComposerEditorContextPanelDelegateExtracted(this);
    }

    protected resolveActiveComposerContextTarget(): import('./qaap-composer-editor-context-service').ComposerEditorContextTarget {
        return resolveActiveComposerContextTargetExtracted(this);
    }
}
