import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
// Extracted from mobile-projects-panel.ts

import { nls } from '@theia/core/lib/common/nls';
import { AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import { ChatSession } from '@theia/ai-chat';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import {
    MobileProjectEntry,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    isAgentsHubIdleConversationSummary,
} from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import {
    QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import {
    QAAP_AI_FEATURES_SETTINGS_QUERY,
    localizeAgentSettingsApiKeyLoginMessage,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-auth-login';
import {
    isAgentHiddenOnHostedRuntime,
    localizeHostedLocalhostOAuthAgentMessage,
} from '@theia/qaap-shared-core/lib/common/qaap-hosted-agent-auth-policy';
import { resolveAgentDisplayLabel } from '@theia/qaap-agents-ui/lib/browser/qaap-agent-ui';
import { openAgentLoginDialogInBackground } from './qaap-agent-login-background';
import { isConversationError } from './mobile-projects-transcript-messages-artifacts-helpers';
import {
    revokeComposerContextPreview,
} from '@theia/qaap-shared-core/lib/common/qaap-composer-context-entry';
import {
    findPreviewFeedbackEntryIndex,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-feedback-context';
import {
    type MobileWorkHubInboxItem,
} from './mobile-work-hub-inbox';

export function removeExternalPreviewFeedbackChipExtracted(ctx: MobileProjectsPanelContext, dedupeKey: string): void {
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

export async function submitExternalComposerPromptExtracted(ctx: MobileProjectsPanelContext, draft: string,
    options: {
        readonly agentId?: string;
        readonly agentModel?: import('@theia/qaap-shared-core/lib/common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
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

export function pickAgentAndSubmitExternalPromptExtracted(ctx: MobileProjectsPanelContext, draft: string,
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

export function openExternalParallelRunsSheetExtracted(ctx: MobileProjectsPanelContext, prompt: string): boolean {
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

export function resolveExternalComposerProjectExtracted(ctx: MobileProjectsPanelContext): MobileProjectEntry | undefined {
    return ctx.transcriptController.state.transcriptOpenProject
        ?? ctx.transcriptController.state.transcriptComposerProject
        ?? ctx.resolveAgentsHubShellProject()
        ?? ctx.projects.find(entry => ctx.projectsService.getProjectCwd(entry))
        ?? ctx.projects[0];
}

export async function createProjectChatSessionExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    cwd: string,
    draft: string,
    options: {
        forceVps?: boolean;
        selectedAgentId?: string;
        modeId?: string;
        autoApprove?: boolean;
        approvalPolicyId?: string;
        toolApprovalRules?: import('@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
        capabilityOverrides?: Record<string, boolean>;
        genericCapabilitySelections?: GenericCapabilitySelections;
        variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
        agentModel?: import('@theia/qaap-shared-core/lib/common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
        latencyMarks?: import('@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client').QaapPostConversationMessageOptions['latencyMarks'];
    },): Promise<import('./qaap-transcript-host-contracts').QaapProjectChatSessionCreated> {
    return ctx.backgroundTaskUi.createProjectChatSession(project, cwd, draft, options);
}

export function seedTranscriptOptimisticSubmitExtracted(ctx: MobileProjectsPanelContext, summary: import('@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO,
    outbound: string,
    agentId?: string,
    imagePreviews?: readonly import('@theia/qaap-shared-core/lib/common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],): void {
    ctx.agentsHubInlineUi.seedTranscriptOptimisticSubmit(summary, outbound, agentId, imagePreviews);
}

export function shouldUseTheiaCoderExtracted(ctx: MobileProjectsPanelContext, content: string,
    selectedAgentId?: string,
    options: { forceVps?: boolean; isLegacyTheiaChat?: boolean } = {},): boolean {
    return ctx.backgroundTaskUi.shouldUseTheiaCoder(content, selectedAgentId, options);
}

export async function selectBackendConversationAgentExtracted(ctx: MobileProjectsPanelContext, cwd: string,
    prompt: string,
    selectedAgentId?: string,
    conversationAgentId?: string,): Promise<string> {
    return ctx.backgroundTaskUi.selectBackendConversationAgent(cwd, prompt, selectedAgentId, conversationAgentId);
}

export async function submitTranscriptViaBackendConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    content: string,
    options: {
        selectedAgentId?: string;
        modeId?: string;
        autoApprove?: boolean;
        approvalPolicyId?: string;
        toolApprovalRules?: import('@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
        capabilityOverrides?: Record<string, boolean>;
        genericCapabilitySelections?: GenericCapabilitySelections;
        variables?: AIVariableResolutionRequest[];
        widget?: AIChatInputWidget;
        agentModel?: import('@theia/qaap-shared-core/lib/common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel;
        imagePreviews?: readonly import('@theia/qaap-shared-core/lib/common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[];
        /** Run beside the open turn instead of taking the conversation over. */
        parallel?: boolean;
    } = {},): Promise<boolean> {
    return ctx.transcriptSubmitUi.submitTranscriptViaBackendConversation(project, summary, content, options);
}

export function collectAgentsHubRecentItemsExtracted(ctx: MobileProjectsPanelContext, projects: MobileProjectEntry[],
    limit?: number,
    scopeProject?: MobileProjectEntry,): Array<{ project: MobileProjectEntry; summary: QaapAgentConversationSummaryDTO }> {
    return ctx.tasksHubUi.collectAgentsHubRecentItems(projects, limit, scopeProject);
}

export async function refreshInboxPullRequestsExtracted(ctx: MobileProjectsPanelContext, projects: MobileProjectEntry[] | undefined = undefined,
    force = false,): Promise<void> {
    return ctx.inboxPrUi.refreshInboxPullRequests(
        projects ?? ctx.hubQueryUi.projectsForCurrentHubList(),
        force,
    );
}

export async function onForkConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onForkConversation(project, summary);
}

export async function onRenameConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onRenameConversation(project, summary);
}

export async function onSetConversationPriorityExtracted(ctx: MobileProjectsPanelContext, summary: QaapAgentConversationSummaryDTO,
    priority: boolean,): Promise<void> {
    return ctx.conversationActionsUi.onSetConversationPriority(summary, priority);
}

export async function onSetConversationPausedExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    paused: boolean,): Promise<void> {
    return ctx.conversationActionsUi.onSetConversationPaused(project, summary, paused);
}

export async function onSetConversationAutoApproveExtracted(ctx: MobileProjectsPanelContext, summary: QaapAgentConversationSummaryDTO,
    autoApprove: boolean,): Promise<void> {
    return ctx.conversationActionsUi.onSetConversationAutoApprove(summary, autoApprove);
}

export function onCancelConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): void {
    ctx.conversationActionsUi.onCancelConversation(project, summary);
}

export async function onRetryConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onRetryConversation(project, summary);
}

export function cancelOpenTranscriptStreamExtracted(ctx: MobileProjectsPanelContext): void {
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

export function retryOpenTranscriptConversationExtracted(ctx: MobileProjectsPanelContext): void {
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

export function retryOpenTranscriptStreamExtracted(ctx: MobileProjectsPanelContext): void {
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

export function retryOpenFailedConversationTaskExtracted(ctx: MobileProjectsPanelContext): void {
    const project = ctx.transcriptController.state.transcriptOpenProject;
    const summary = ctx.transcriptController.state.transcriptOpenSummary;
    const conversation = ctx.transcriptController.state.transcriptLastConv;
    if (!project || !summary || (!isConversationError(conversation) && summary.status !== 'failed')) {
        return;
    }
    void ctx.onRetryConversation(project, summary);
}

export function openAgentSignInTerminalExtracted(ctx: MobileProjectsPanelContext, agentId?: string, requestedProject?: MobileProjectEntry): void {
    const state = ctx.transcriptController.state;
    const stateProject = state.transcriptOpenProject ?? state.transcriptComposerProject;
    const project = requestedProject ?? stateProject;
    let summary = requestedProject && stateProject?.id !== requestedProject.id
        ? undefined
        : state.transcriptOpenSummary ?? state.transcriptComposerSummary;
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
    // QAIQ is the only BYOK / Settings-catalog harness. Every other harness connects
    // through its own CLI flow in the transcript terminal, even when it has no dedicated
    // `login` subcommand (the interactive CLI owns that onboarding flow).
    if (resolvedAgentId.toLowerCase() === 'qaiq') {
        ctx.notifyAgentUsesSettingsApiKey(resolvedAgentId);
        return;
    }
    if (!project) {
        return;
    }
    if (!summary) {
        const cwd = ctx.projectsService.getProjectCwd(project) ?? ctx.preparedCwdByProjectId.get(project.id);
        if (!cwd) {
            return;
        }
        const now = Date.now();
        summary = {
            id: `qaap-agent-login:${project.id}:${resolvedAgentId}`,
            source: 'qaap-agent',
            cwd,
            agentId: resolvedAgentId,
            title: nls.localize(
                'qaap/agentLogin/connectTitle',
                'Connect {0}',
                resolveAgentDisplayLabel(resolvedAgentId),
            ),
            status: 'idle',
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
        } satisfies QaapAgentConversationSummaryDTO;
    }
    void openAgentLoginDialogInBackground(
        ctx,
        project,
        summary,
        resolvedAgentId,
        async () => {
            const refreshed = await ctx.stickyComposerAgentsUi?.refreshStickyComposerAgents?.(project, { forceRefresh: true });
            ctx.stickyComposerRenderUi?.renderStickyComposer?.();
            return refreshed === true && ctx.stickyComposerAgentsUi?.isAgentConnected?.(resolvedAgentId) === true;
        },
    );
}

export function notifyAgentUsesSettingsApiKeyExtracted(ctx: MobileProjectsPanelContext, agentId: string): void {
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

export async function onDeleteConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onDeleteConversation(project, summary);
}

export async function onArchiveConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    return ctx.conversationActionsUi.onArchiveConversation(project, summary);
}

export function collectChatHubGroupsExtracted(ctx: MobileProjectsPanelContext, projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; summaries: QaapAgentConversationSummaryDTO[] }> {
    return ctx.workHubInboxUi.collectChatHubGroups(projects);
}

export function collectTasksInboxGroupsExtracted(ctx: MobileProjectsPanelContext, projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
    return ctx.workHubInboxUi.collectTasksInboxGroups(projects);
}

export function collectReviewGroupsExtracted(ctx: MobileProjectsPanelContext, projects: MobileProjectEntry[],): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }> {
    return ctx.workHubInboxUi.collectReviewGroups(projects);
}

export function createInboxProjectGroupExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    items: MobileWorkHubInboxItem[],): HTMLElement {
    return ctx.workHubInboxUi.createInboxProjectGroup(project, items);
}

export async function getOrRestoreProjectChatSessionExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<ChatSession | undefined> {
    return ctx.theiaChatSessionUi.getOrRestoreProjectChatSession(project, summary);
}

export async function forkTheiaConversationExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<ChatSession | undefined> {
    return ctx.theiaChatSessionUi.forkTheiaConversation(project, summary);
}

export async function mountTranscriptChatInputExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    host: HTMLElement,
    submit: (content: string, modeId?: string, capabilityOverrides?: Record<string, boolean>,
        genericCapabilitySelections?: GenericCapabilitySelections, widget?: AIChatInputWidget) => Promise<void>,): Promise<void> {
    return ctx.theiaChatSessionUi.mountTranscriptChatInput(project, summary, host, submit);
}

export async function openInlineTranscriptExtracted(ctx: MobileProjectsPanelContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): Promise<void> {
    await ctx.openAgentsHubInlineTranscript(project, summary);
}

export function refreshHubChromeExtracted(ctx: MobileProjectsPanelContext): void {
    ctx.renderHeader();
    ctx.renderSubtitle();
    ctx.renderList();
}

export function renderIdleSubmitOptimisticExtracted(ctx: MobileProjectsPanelContext, chatHost: HTMLElement,
    summary: QaapAgentConversationSummaryDTO,
    draft: string,
    selectedAgentId: string,
    imagePreviews?: readonly import('@theia/qaap-shared-core/lib/common/qaap-transcript-user-image-preview').QaapTranscriptUserImagePreview[],
    contentOverride?: string,): void {
    ctx.renderAgentsHubIdleSubmitOptimistic(chatHost, summary, draft, selectedAgentId, imagePreviews, contentOverride);
}

export function patchWorkHubConversationRowInPlaceExtracted(ctx: MobileProjectsPanelContext, conversationId: string): void {
    const summary = ctx.conversations?.threadStore.getSummary(conversationId);
    if (summary) {
        ctx.hubIncrementalUi.patchConversationRowInPlace(summary);
    }
}
