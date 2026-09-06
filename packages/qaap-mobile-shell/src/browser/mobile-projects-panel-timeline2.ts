// @ts-nocheck
// Extracted from mobile-projects-panel.ts

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
    isAgentsHubExecutionSurfacePainted,
    isAgentsHubIdleConversationSummary,
} from '../common/qaap-agents-hub-landing';
import { normalizeQaapPreviewConversationId } from '../common/qaap-preview-identity';
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
    QaapAgentConversationDTO,
    QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { formatConversationForClipboard } from '../common/qaap-conversation-clipboard-text';
import {
    agentHasCliOAuthLogin,
    QAAP_AI_FEATURES_SETTINGS_QUERY,
    localizeAgentSettingsApiKeyLoginMessage,
} from '../common/qaap-agent-auth-login';
import {
    isAgentHiddenOnHostedRuntime,
    localizeHostedLocalhostOAuthAgentMessage,
} from '../common/qaap-hosted-agent-auth-policy';
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
import { MobileProjectsHubRoutineEditorUi, type MobileProjectsHubRoutineEditorHost } from './mobile-projects-hub-routine-editor-ui';
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
import type { TranscriptFilesViewServices } from './qaap-transcript-files-view';
import type { TranscriptTerminalViewServices } from './qaap-transcript-terminal-view';
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
    renderHeaderOverflowMenuItems as renderHeaderOverflowMenuItemsHelper,
    sendExternalComposerContext as sendExternalComposerContextHelper,
} from './mobile-projects-panel-helpers';

export function removeExternalPreviewFeedbackChipExtracted(ctx: any, dedupeKey: string): void {
    const useTranscript = ctx.resolveActiveComposerContextTarget() === 'transcript';
    const entries = useTranscript
        ? ctx.transcriptController.state.transcriptComposerContext
        : ctx.stickyComposerContext;
    const existingIndex = findPreviewFeedbackEntryIndex(entries, dedupeKey);
    if (existingIndex < 0) {
        return;
    }
    const [removed] = entries.splice(existingIndex, 1);
    revokeComposerContextPreview(removed);
    if (useTranscript) {
        ctx.transcriptStickyComposerUi.remountTranscriptStickyComposer();
    } else {
        ctx.stickyComposerRenderUi.renderStickyComposer();
    }
}

export async function submitExternalComposerPromptExtracted(ctx: any, draft: string,
    options: {
        readonly agentId?: string;
        readonly agentModel?: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
    } = {},): Promise<boolean> {
    const text = draft.trim();
    if (!text) {
        return false;
    }
    const project = ctx.resolveExternalComposerProject();
    if (!project) {
        return false;
    }
    const selectedAgentId = options.agentId
        ?? ctx.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project);
    const agentModel = options.agentModel
        ?? ctx.stickyComposerAgentsUi.resolveStickyComposerAgentModel(selectedAgentId, project);
    await ctx.submitBackgroundAgentTask(project, text, {
        forceVps: true,
        openConversation: true,
        selectedAgentId,
        ...(agentModel ? { agentModel } : {}),
    });
    return true;
}

export function pickAgentAndSubmitExternalPromptExtracted(ctx: any, draft: string,
    options: {
        readonly title?: string;
        readonly intro?: string;
        readonly anchor?: HTMLElement;
    } = {},): boolean {
    const text = draft.trim();
    if (!text) {
        return false;
    }
    const project = ctx.resolveExternalComposerProject();
    if (!project) {
        return false;
    }
    ctx.stickyComposerSheetsUi.openExternalAgentPickerForSubmit(project, text, options);
    return true;
}

export function openExternalParallelRunsSheetExtracted(ctx: any, prompt: string): boolean {
    const text = prompt.trim();
    if (!text) {
        return false;
    }
    const project = ctx.resolveExternalComposerProject();
    if (!project) {
        return false;
    }
    const cwd = ctx.projectsService.getProjectCwd(project)
        ?? ctx.preparedCwdByProjectId.get(project.id);
    if (!cwd) {
        return false;
    }
    ctx.ensureOverlayUi().parallel.openParallelRunsSheetForPrompt(project, cwd, text);
    return true;
}

export function resolveExternalComposerProjectExtracted(ctx: any): MobileProjectEntry | undefined {
    return ctx.transcriptController.state.transcriptOpenProject
        ?? ctx.transcriptController.state.transcriptComposerProject
        ?? ctx.resolveAgentsHubShellProject()
        ?? ctx.projects.find(entry => ctx.projectsService.getProjectCwd(entry))
        ?? ctx.projects[0];
}

export async function createProjectChatSessionExtracted(ctx: any, project: MobileProjectEntry,
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
    },): Promise<import('./mobile-projects-background-task-ui').QaapProjectChatSessionCreated> {
    return ctx.backgroundTaskUi.createProjectChatSession(project, cwd, draft, options);
}

export function seedTranscriptOptimisticSubmitExtracted(ctx: any, summary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO,
    outbound: string,
    agentId?: string,
    imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],): void {
    ctx.agentsHubInlineUi.seedTranscriptOptimisticSubmit(summary, outbound, agentId, imagePreviews);
}

export function shouldUseTheiaCoderExtracted(ctx: any, content: string,
    selectedAgentId?: string,
    options: { forceVps?: boolean; isLegacyTheiaChat?: boolean } = {},): boolean {
    return ctx.backgroundTaskUi.shouldUseTheiaCoder(content, selectedAgentId, options);
}

export async function selectBackendConversationAgentExtracted(ctx: any, cwd: string,
    prompt: string,
    selectedAgentId?: string,
    conversationAgentId?: string,): Promise<string> {
    return ctx.backgroundTaskUi.selectBackendConversationAgent(cwd, prompt, selectedAgentId, conversationAgentId);
}

export async function submitTranscriptViaBackendConversationExtracted(ctx: any, project: MobileProjectEntry,
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
    } = {},): Promise<boolean> {
    return ctx.transcriptSubmitUi.submitTranscriptViaBackendConversation(project, summary, content, options);
}

export function collectAgentsHubRecentItemsExtracted(ctx: any, projects: MobileProjectEntry[],
    limit?: number,
    scopeProject?: MobileProjectEntry,): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
    return ctx.tasksHubUi.collectAgentsHubRecentItems(projects, limit, scopeProject);
}

export async function refreshInboxPullRequestsExtracted(ctx: any, projects: MobileProjectEntry[] | undefined = undefined,
    force = false,): Promise<void> {
    return ctx.inboxPrUi.refreshInboxPullRequests(
        projects ?? ctx.hubQueryUi.projectsForCurrentHubList(),
        force,
    );
}

export function patchRoutineLocallyExtracted(ctx: any, id: string,
    patch: Partial<Pick<QaapWorkHubRoutine, 'enabled' | 'lastRunState'>>,): void {
    ctx.hubRoutinesUi.patchRoutineLocally(id, patch);
}

export async function onForkConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onForkConversation(project, summary);
}

export async function onRenameConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onRenameConversation(project, summary);
}

export async function onSetConversationPriorityExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    priority: boolean,): Promise<void> {
    return ctx.conversationActionsUi.onSetConversationPriority(summary, priority);
}

export async function onSetConversationPausedExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    paused: boolean,): Promise<void> {
    return ctx.conversationActionsUi.onSetConversationPaused(project, summary, paused);
}

export async function onSetConversationAutoApproveExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
    autoApprove: boolean,): Promise<void> {
    return ctx.conversationActionsUi.onSetConversationAutoApprove(summary, autoApprove);
}

export function onCancelConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    ctx.conversationActionsUi.onCancelConversation(project, summary);
}

export async function onRetryConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onRetryConversation(project, summary);
}

export function cancelOpenTranscriptStreamExtracted(ctx: any): void {
    let project = ctx.transcriptController.state.transcriptOpenProject;
    let summary = ctx.transcriptController.state.transcriptOpenSummary;
    if (!project || !summary) {
        // No transcript sheet is open — the conversation is showing in the
        // Agents Hub inline shell instead (the default surface). Cancel
        // that one; a bare sheet-state check silently no-ops there.
        project = ctx.resolveAgentsHubShellProject();
        summary = project ? ctx.resolveAgentsHubShellSummary(project) : undefined;
    }
    if (project && summary) {
        ctx.onCancelConversation(project, summary);
    }
}

export function retryOpenTranscriptConversationExtracted(ctx: any): void {
    let project = ctx.transcriptController.state.transcriptOpenProject;
    let summary = ctx.transcriptController.state.transcriptOpenSummary;
    if (!project || !summary) {
        project = ctx.resolveAgentsHubShellProject();
        summary = project ? ctx.resolveAgentsHubShellSummary(project) : undefined;
    }
    if (project && summary) {
        void ctx.onRetryConversation(project, summary);
    }
}

export function retryOpenTranscriptStreamExtracted(ctx: any): void {
    let project = ctx.transcriptController.state.transcriptOpenProject;
    let summary = ctx.transcriptController.state.transcriptOpenSummary;
    if (!project || !summary) {
        // Mirror cancelOpenTranscriptStream: no transcript sheet is open means the
        // conversation is showing in the Agents Hub inline shell (the default surface).
        // A bare sheet-state check silently no-ops there — which left the timeout card's
        // "Retry" dead in the inline shell.
        project = ctx.resolveAgentsHubShellProject();
        summary = project ? ctx.resolveAgentsHubShellSummary(project) : undefined;
    }
    if (!project || !summary || isAgentsHubIdleConversationSummary(summary)) {
        // Nothing real to retry (no live conversation yet, or it ended between the
        // watchdog and the click) — never seed a phantom {...idle, streaming} snapshot.
        return;
    }
    ctx.transcriptLiveUi.applyOptimisticStreamTimeoutRetry(summary);
    ctx.conversations?.recordSnapshot({ ...summary, status: 'streaming', updatedAt: Date.now() });
    ctx.renderList();
    void ctx.transcriptLiveUi.resyncOpenTranscriptStreamAfterTimeout(project, summary);
}

export function retryOpenFailedConversationTaskExtracted(ctx: any): void {
    const project = ctx.transcriptController.state.transcriptOpenProject;
    const summary = ctx.transcriptController.state.transcriptOpenSummary;
    if (!project || !summary || summary.status !== 'failed') {
        return;
    }
    void ctx.onRetryConversation(project, summary);
}

export function openAgentSignInTerminalExtracted(ctx: any, agentId?: string): void {
    const state = ctx.transcriptController.state;
    const project = state.transcriptOpenProject ?? state.transcriptComposerProject;
    const summary = state.transcriptOpenSummary ?? state.transcriptComposerSummary;
    const resolvedAgentId = agentId?.trim()
        || summary?.agentId
        || state.transcriptLastConv?.agentId;
    if (!resolvedAgentId) {
        return;
    }
    if (isAgentHiddenOnHostedRuntime(resolvedAgentId)) {
        const message = localizeHostedLocalhostOAuthAgentMessage(resolvedAgentId);
        if (ctx.messageService) {
            void ctx.messageService.info(message);
        }
        return;
    }
    // BYOK / Settings-catalog agents (qaiq, and any agent without a CLI login
    // subcommand) have no terminal sign-in — opening the TUI would sign no one
    // in. Point the user to the API key in Settings instead.
    if (!agentHasCliOAuthLogin(resolvedAgentId)) {
        ctx.notifyAgentUsesSettingsApiKey(resolvedAgentId);
        return;
    }
    if (!project || !summary) {
        return;
    }
    void ctx.transcriptSurfacesUi.launchAgentTuiInTranscriptTerminal(
        project,
        summary,
        resolvedAgentId,
        { login: true },
    );
}

export function notifyAgentUsesSettingsApiKeyExtracted(ctx: any, agentId: string): void {
    const message = localizeAgentSettingsApiKeyLoginMessage(resolveAgentDisplayLabel(agentId));
    const openSettings = nls.localize('qaap/agentLogin/openSettings', 'Open Settings');
    const openAiFeatures = (): void => {
        void ctx.openPreferencesSheet?.(QAAP_AI_FEATURES_SETTINGS_QUERY);
    };
    if (ctx.messageService) {
        void ctx.messageService.info(message, openSettings).then(action => {
            if (action === openSettings) {
                openAiFeatures();
            }
        });
        return;
    }
    openAiFeatures();
}

export async function onDeleteConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onDeleteConversation(project, summary);
}

export async function onArchiveConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onArchiveConversation(project, summary);
}

export function collectChatHubGroupsExtracted(ctx: any, projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; summaries: QaapAgentConversationSummaryDTO[] }> {
    return ctx.workHubInboxUi.collectChatHubGroups(projects);
}

export function collectTasksInboxGroupsExtracted(ctx: any, projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
    return ctx.workHubInboxUi.collectTasksInboxGroups(projects);
}

export function collectReviewGroupsExtracted(ctx: any, projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
    return ctx.workHubInboxUi.collectReviewGroups(projects);
}

export function createInboxProjectGroupExtracted(ctx: any, project: MobileProjectEntry,
    items: MobileWorkHubInboxItem[],): HTMLElement {
    return ctx.workHubInboxUi.createInboxProjectGroup(project, items);
}

export async function getOrRestoreProjectChatSessionExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<ChatSession | undefined> {
    return ctx.theiaChatSessionUi.getOrRestoreProjectChatSession(project, summary);
}

export async function forkTheiaConversationExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<ChatSession | undefined> {
    return ctx.theiaChatSessionUi.forkTheiaConversation(project, summary);
}

export async function mountTranscriptChatInputExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    host: HTMLElement,
    submit: (content: string, modeId?: string, capabilityOverrides?: Record<string, boolean>,
        genericCapabilitySelections?: GenericCapabilitySelections, widget?: AIChatInputWidget) => Promise<void>,): Promise<void> {
    return ctx.theiaChatSessionUi.mountTranscriptChatInput(project, summary, host, submit);
}

export async function openInlineTranscriptExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    await ctx.openAgentsHubInlineTranscript(project, summary);
}

export function refreshHubChromeExtracted(ctx: any): void {
    ctx.renderHeader();
    ctx.renderSubtitle();
    ctx.renderList();
}

export function renderIdleSubmitOptimisticExtracted(ctx: any, chatHost: HTMLElement,
    summary: QaapAgentConversationSummaryDTO,
    draft: string,
    selectedAgentId: string,
    imagePreviews?: readonly import('../common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],
    contentOverride?: string,): void {
    ctx.renderAgentsHubIdleSubmitOptimistic(chatHost, summary, draft, selectedAgentId, imagePreviews, contentOverride);
}

export function patchWorkHubConversationRowInPlaceExtracted(ctx: any, conversationId: string): void {
    const summary = ctx.conversations?.threadStore.getSummary(conversationId);
    if (summary) {
        ctx.hubIncrementalUi.patchConversationRowInPlace(summary);
    }
}
