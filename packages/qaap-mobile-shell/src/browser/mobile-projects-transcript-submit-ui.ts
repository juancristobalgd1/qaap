// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import type { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import {
    conversationToSummary,
    getConversation,
    postConversationMessage,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapMessageDeliveryMode,
} from '../common/qaap-agent-conversation-client';
import {
    resolveAgentModelForSubmit,
    resolveExplicitAgentForSubmit,
    resolveStoredAgentModelForSubmit,
    type QaapCreateAgentTaskQaiqModel,
} from '../common/qaap-agent-task-client';
import { applyBackendInteractionModeToPrompt } from '../common/qaap-sticky-composer-mode';
import {
    reconcileAgentApprovalPolicyId,
    type QaapAgentApprovalPolicyId,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
    type QaapAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import { appendOptimisticPendingUserMessage } from '../common/qaap-transcript-sse-delta';
import type { QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';
import { isConversationTurnVisuallySettled } from '../common/qaap-transcript-turn-status';
import { messageRequestsDevPreview } from '../common/qaap-transcript-preview-offer';
import {
    estimateConversationTokensFromMessages,
    resolveConversationContextWindowSize,
} from '../common/qaap-agent-context-usage';
import { QaapTurnSettleNotifier } from './qaap-turn-settle-notifier';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';

const OPTIMISTIC_CONTEXT_COMPACTION_THRESHOLD_RATIO = 0.35;
const OPTIMISTIC_CONTEXT_COMPACTION_ABSOLUTE_TOKENS = 25_000;

/** Panel surface for VPS/backend transcript message submit and optimistic render. */
export interface MobileProjectsTranscriptSubmitHost {
    transcriptOpenSummaryId: string | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptLastFingerprint: string | undefined;
    transcriptLastStreamProgressAt: number | undefined;
    transcriptComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    transcriptComposerToolApprovalRules: QaapAgentToolApprovalRules | undefined;
    transcriptComposerAgentModel: QaapCreateAgentTaskQaiqModel | undefined;
    conversations: MobileProjectsConversations | undefined;
    transcriptMessagesUi: MobileProjectsTranscriptMessagesUi;
    transcriptLiveUi: MobileProjectsTranscriptLiveUi;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;

    isPendingNewChatSummary(summary: QaapAgentConversationSummaryDTO): boolean;
    createProjectChatSession(
        project: MobileProjectEntry,
        cwd: string,
        draft: string,
        options: {
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            variables?: AIVariableResolutionRequest[];
            agentModel?: QaapCreateAgentTaskQaiqModel;
            latencyMarks?: import('../common/qaap-agent-conversation-client').QaapPostConversationMessageOptions['latencyMarks'];
        },
    ): Promise<import('./mobile-projects-background-task-ui').QaapProjectChatSessionCreated>;
    resolveActiveTranscriptChatHost(): HTMLElement | undefined;
    applyTaskStartedToProject(cwd: string, title: string, taskId: string): void;
    seedTranscriptOptimisticSubmit(
        summary: QaapAgentConversationSummaryDTO,
        outbound: string,
        agentId?: string,
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
    ): void;
    expandComposerDraftForSubmit?: (draft: string) => Promise<string>;
    applyComposerAttachmentsToDraft?: (
        draft: string,
        variables?: AIVariableResolutionRequest[],
    ) => Promise<string>;
}

/** Backend conversation submit with optimistic transcript rows and rollback on failure. */
export class MobileProjectsTranscriptSubmitUi {

    protected readonly submitInFlightByConversationId = new Set<string>();
    /** A user submitting a task is the natural consent moment for the notification permission prompt. */
    protected readonly turnSettleNotifier = new QaapTurnSettleNotifier();

    constructor(protected readonly host: MobileProjectsTranscriptSubmitHost) { }

    protected resolveTranscriptSubmitAgentModel(
        agent: string | undefined,
        summary: QaapAgentConversationSummaryDTO,
    ): QaapCreateAgentTaskQaiqModel | undefined {
        const requestedAgent = agent?.trim();
        const currentAgent = summary.agentId?.trim();
        const agentChanged = !!requestedAgent && !!currentAgent
            && requestedAgent.toLowerCase() !== currentAgent.toLowerCase();
        // A conversation's model belongs to its current agent. When the composer switches from
        // QAIQ to OpenClaude (or back), never reuse the previous conversation/in-memory model;
        // resolve only the new agent's own project-scoped selection.
        if (agentChanged) {
            return resolveStoredAgentModelForSubmit(requestedAgent, summary.cwd);
        }
        const composerActive = this.host.transcriptComposerSummary?.id === summary.id;
        const explicitModel = composerActive
            ? (this.host.transcriptComposerAgentModel ?? summary.agentModel ?? summary.qaiqModel)
            : (summary.agentModel ?? summary.qaiqModel);
        return resolveAgentModelForSubmit(agent, summary.cwd, explicitModel);
    }

    protected shouldRenderTranscriptSubmit(summary: QaapAgentConversationSummaryDTO): boolean {
        if (this.host.transcriptOpenSummaryId === summary.id) {
            return true;
        }
        return this.host.transcriptComposerSummary?.id === summary.id;
    }

    protected renderTranscriptSubmitMessages(
        chatHost: HTMLElement,
        conv: QaapAgentConversationDTO,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        if (!this.shouldRenderTranscriptSubmit(summary)) {
            return;
        }
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLiveUi.seedTranscriptSemanticProgressClock();
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
    }

    /**
     * Paint the outbound user bubble (and the streaming activity skeleton) synchronously from the
     * cached conversation, before any network round-trip, so perceived send latency is zero.
     */
    protected renderInstantSubmitOptimistic(
        summary: QaapAgentConversationSummaryDTO,
        pendingUserMessage: QaapAgentConversationDTO['messages'][number],
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
    ): number | undefined {
        const cached = this.host.transcriptLastConv;
        const chatHost = this.host.resolveActiveTranscriptChatHost();
        if (!chatHost) {
            return undefined;
        }
        const baseConv: QaapAgentConversationDTO = cached?.id === summary.id ? cached : {
            id: summary.id,
            cwd: summary.cwd,
            agentId: summary.agentId,
            title: summary.title,
            status: summary.status,
            createdAt: summary.createdAt,
            updatedAt: Date.now(),
            messages: [],
        };
        const pending = imagePreviews?.length
            ? { ...pendingUserMessage, optimisticImagePreviews: imagePreviews }
            : pendingUserMessage;
        this.renderTranscriptSubmitMessages(chatHost, {
            ...baseConv,
            status: 'streaming',
            messages: appendOptimisticPendingUserMessage(baseConv.messages, pending),
            contextCompaction: this.shouldShowOptimisticContextCompaction(baseConv, pending)
                ? {
                    status: 'running',
                    startedAt: Date.now(),
                    compactedMessageCount: Math.max(0, baseConv.messages.length - 4),
                    sourceMessageCount: baseConv.messages.length + 1,
                }
                : baseConv.contextCompaction,
        }, summary);
        const renderedAt = Date.now();
        this.host.conversations?.recordSubmitLatencyMark(summary.id, 'optimistic_render_done', renderedAt);
        return renderedAt;
    }

    async submitTranscriptViaBackendConversation(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        content: string,
        options: {
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: AIVariableResolutionRequest[];
            widget?: AIChatInputWidget;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly QaapTranscriptUserImagePreview[];
            /**
             * Opt into isolated-worktree parallel (a new conversation). Prefer
             * Alt+Enter or an explicit `deliveryMode: 'parallel'`.
             */
            parallel?: boolean;
            /**
             * Delivery mode when an agent is already running. Maps to the backend
             * `QaapMessageDeliveryMode`: 'queue' (default), 'parallel', or 'interrupt'.
             * When `parallel` is true, this is set to 'parallel' for backward compatibility.
             */
            deliveryMode?: QaapMessageDeliveryMode;
        } = {},
    ): Promise<boolean> {
        // Reports whether the message was actually submitted. A concurrent send that lands while
        // another POST for this conversation is still open is skipped here — the caller must be
        // able to tell that apart from a completed send, or the message is silently lost (it was
        // already cleared from the composer draft by then). Parallel (peer-run) sends bypass this
        // gate because they are intentionally concurrent with the in-flight POST.
        const parallel = !!options.parallel;
        if (!parallel && this.submitInFlightByConversationId.has(summary.id)) {
            return false;
        }
        const submitAt = Date.now();
        this.host.conversations?.recordSubmitLatencyMark(summary.id, 'ui_submit_clicked', submitAt);
        if (!parallel) {
            this.submitInFlightByConversationId.add(summary.id);
        }
        // Fire-and-forget: a user starting a task is the natural consent moment to ask whether
        // they want a notification when it settles — browsers require a user gesture for this.
        void this.turnSettleNotifier.maybeRequestPermission();
        try {
            await this.submitTranscriptViaBackendConversationInner(project, summary, content, options, submitAt);
            return true;
        } finally {
            if (!parallel) {
                this.submitInFlightByConversationId.delete(summary.id);
            }
        }
    }

    protected async submitTranscriptViaBackendConversationInner(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
        content: string,
        options: {
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: AIVariableResolutionRequest[];
            widget?: AIChatInputWidget;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly QaapTranscriptUserImagePreview[];
            /** See {@link submitTranscriptViaBackendConversation}. */
            parallel?: boolean;
            /** Delivery mode: 'queue', 'parallel', or 'interrupt'. */
            deliveryMode?: QaapMessageDeliveryMode;
        } = {},
        submitAt = Date.now(),
    ): Promise<void> {
        if (this.host.transcriptHeaderUi.isPendingNewChatSummary(summary)) {
            const pendingAgent = resolveExplicitAgentForSubmit(content, {
                pinnedChatAgentId: options.selectedAgentId ?? options.widget?.pinnedAgent?.id ?? summary.agentId,
            }) ?? options.selectedAgentId ?? summary.agentId;
            // Resolve attachments for the optimistic paint so context cards (e.g. preview
            // feedback) render immediately; the create call below resolves its own outbound.
            let optimisticContent = content;
            if (options.variables?.length && this.host.applyComposerAttachmentsToDraft) {
                try {
                    optimisticContent = await this.host.applyComposerAttachmentsToDraft(content, options.variables);
                } catch {
                    // Bare draft is still correct; the server render reconciles.
                }
            }
            const optimisticAt = this.renderInstantSubmitOptimistic(summary, {
                id: `pending-user-${Date.now()}`,
                role: 'user',
                content: optimisticContent,
                createdAt: Date.now(),
            }, options.imagePreviews);
            const postStartAt = Date.now();
            this.host.conversations?.recordSubmitLatencyMark(summary.id, 'post_message_start', postStartAt);
            const { summary: created, outbound } = await this.host.createProjectChatSession(project, summary.cwd, content, {
                selectedAgentId: options.selectedAgentId,
                modeId: options.modeId,
                autoApprove: options.autoApprove,
                approvalPolicyId: options.approvalPolicyId,
                variables: options.variables,
                agentModel: options.agentModel ?? this.resolveTranscriptSubmitAgentModel(pendingAgent, summary),
                latencyMarks: this.host.conversations?.getSubmitLatencyMarks(summary.id),
            });
            this.host.conversations?.recordSubmitLatencyMark(created.id, 'ui_submit_clicked', submitAt);
            if (optimisticAt !== undefined) {
                this.host.conversations?.recordSubmitLatencyMark(created.id, 'optimistic_render_done', optimisticAt);
            }
            this.host.conversations?.recordSubmitLatencyMark(created.id, 'post_message_start', postStartAt);
            this.host.conversations?.recordSubmitLatencyMark(created.id, 'post_message_end');
            this.host.seedTranscriptOptimisticSubmit(created, outbound, pendingAgent, options.imagePreviews);
            this.host.transcriptOpenSummaryId = created.id;
            this.host.transcriptOpenSummary = created;
            this.host.transcriptComposerSummary = created;
            const activeChatHost = this.host.resolveActiveTranscriptChatHost();
            this.host.conversations?.recordSubmitLatencyMark(created.id, 'pre_post_get_start');
            const full = await getConversation(created.id);
            this.host.conversations?.recordSubmitLatencyMark(created.id, 'pre_post_get_end');
            if (activeChatHost) {
                this.host.transcriptLastFingerprint = undefined;
                this.host.transcriptMessagesUi.renderTranscriptMessages(activeChatHost, full);
                this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
            }
            this.host.applyTaskStartedToProject(created.cwd, content, created.id);
            if (messageRequestsDevPreview(content)) {
                this.host.transcriptLiveUi.onTranscriptUserMessageSubmitted(content, full);
            }
            return;
        }
        if (this.host.transcriptComposerSummary?.id === summary.id) {
            if (!this.host.transcriptOpenSummaryId) {
                this.host.transcriptOpenSummaryId = summary.id;
                this.host.transcriptOpenSummary = summary;
            }
        }
        const agent = resolveExplicitAgentForSubmit(content, {
            pinnedChatAgentId: options.selectedAgentId ?? options.widget?.pinnedAgent?.id ?? summary.agentId,
        }) ?? options.selectedAgentId ?? summary.agentId;
        const expandedContent = await this.host.expandComposerDraftForSubmit?.(content) ?? content;
        const withAttachments = await this.host.applyComposerAttachmentsToDraft?.(
            expandedContent,
            options.variables,
        ) ?? expandedContent;
        const outbound = applyBackendInteractionModeToPrompt(withAttachments, options.modeId);
        const pendingUserMessage = {
            id: `pending-user-${Date.now()}`,
            role: 'user' as const,
            content: outbound,
            createdAt: Date.now(),
            ...(options.imagePreviews?.length ? { optimisticImagePreviews: options.imagePreviews } : {}),
        };
        // Zero perceived latency: paint the user bubble + activity skeleton from the cached
        // conversation before the GET/POST round-trips; the server render below reconciles.
        this.renderInstantSubmitOptimistic(summary, pendingUserMessage, options.imagePreviews);
        this.host.conversations?.recordSubmitLatencyMark(summary.id, 'pre_post_get_start');
        let base = await getConversation(summary.id);
        this.host.conversations?.recordSubmitLatencyMark(summary.id, 'pre_post_get_end');
        // A follow-up on a still-streaming conversation must not cancel the live turn.
        // Delivery defaults to `'queue'` (backend pendingUserMessages). Explicit parallel
        // isolation is opted into via Alt+Enter or `deliveryMode: 'parallel'`.
        if (base.status === 'streaming' && isConversationTurnVisuallySettled(base) && !options.parallel && !options.deliveryMode) {
            options.deliveryMode = 'queue';
        }
        // Skip the second optimistic render if the pending is already in transcriptLastConv
        // from renderInstantSubmitOptimistic — avoids double-painting the pending bubble when
        // an SSE tick from the first agent updated transcriptLastConv between the two renders.
        const pendingAlreadyRendered = this.host.transcriptLastConv?.id === summary.id
            && this.host.transcriptLastConv.messages.some(m => m.id === pendingUserMessage.id);
        if (!pendingAlreadyRendered) {
            const optimistic: QaapAgentConversationDTO = {
                ...base,
                status: 'streaming',
                messages: appendOptimisticPendingUserMessage(base.messages, pendingUserMessage),
            };
            const activeChatHost = this.host.resolveActiveTranscriptChatHost();
            if (activeChatHost) {
                this.renderTranscriptSubmitMessages(activeChatHost, optimistic, summary);
            }
        }
        try {
            const agentModel = options.agentModel ?? this.resolveTranscriptSubmitAgentModel(agent, summary);
            this.host.conversations?.recordSubmitLatencyMark(summary.id, 'post_message_start');
            const updated = await postConversationMessage(summary.id, outbound, {
                agent,
                agentModel,
                clientMessageId: pendingUserMessage.id,
                autoApprove: options.autoApprove,
                interactionModeId: options.modeId,
                approvalPolicyId: options.approvalPolicyId
                    ?? reconcileAgentApprovalPolicyId(this.host.transcriptComposerApprovalPolicyId, summary.cwd),
                toolApprovalRules: reconcileAgentToolApprovalRules(
                    (options.approvalPolicyId as QaapAgentApprovalPolicyId | undefined)
                    ?? reconcileAgentApprovalPolicyId(this.host.transcriptComposerApprovalPolicyId, summary.cwd),
                    summary.cwd,
                    this.host.transcriptComposerToolApprovalRules,
                ),
                latencyMarks: this.host.conversations?.getSubmitLatencyMarks(summary.id),
                deliveryMode: options.deliveryMode ?? (options.parallel ? 'parallel' : undefined),
            });
            this.host.conversations?.recordSubmitLatencyMark(summary.id, 'post_message_end');
            const nextSummary = conversationToSummary(updated);
            this.host.conversations?.recordSnapshot(nextSummary);
            if (updated.id !== summary.id) {
                // Isolated parallel: the backend spawned a new worktree conversation. Switch
                // the open transcript to that thread instead of painting it onto the parent.
                this.host.seedTranscriptOptimisticSubmit?.(nextSummary, outbound, options.selectedAgentId, options.imagePreviews);
                this.host.transcriptOpenSummaryId = updated.id;
                this.host.transcriptOpenSummary = nextSummary;
                this.host.transcriptComposerSummary = nextSummary;
                const spawnedHost = this.host.resolveActiveTranscriptChatHost();
                if (spawnedHost) {
                    this.host.transcriptLastFingerprint = undefined;
                    this.host.transcriptMessagesUi.renderTranscriptMessages(spawnedHost, updated);
                }
                this.host.applyTaskStartedToProject(nextSummary.cwd, content, updated.id);
                this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
                return;
            }
            const refreshedChatHost = this.host.resolveActiveTranscriptChatHost();
            if (refreshedChatHost) {
                this.renderTranscriptSubmitMessages(refreshedChatHost, updated, summary);
            }
            this.host.applyTaskStartedToProject(summary.cwd, content, summary.id);
            if (messageRequestsDevPreview(content)) {
                this.host.transcriptLiveUi.onTranscriptUserMessageSubmitted(content, updated);
            }
            this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
        } catch (error) {
            const rollbackChatHost = this.host.resolveActiveTranscriptChatHost();
            if (rollbackChatHost) {
                this.renderTranscriptSubmitMessages(rollbackChatHost, base, summary);
            }
            throw error;
        }
    }

    protected shouldShowOptimisticContextCompaction(
        conv: QaapAgentConversationDTO,
        pendingUserMessage: QaapAgentConversationDTO['messages'][number],
    ): boolean {
        if (conv.contextCompaction?.status === 'complete') {
            return false;
        }
        const messages = appendOptimisticPendingUserMessage(conv.messages, pendingUserMessage);
        const estimated = estimateConversationTokensFromMessages(messages, conv.contextPreamble);
        const contextWindow = resolveConversationContextWindowSize(conv.contextWindowSize);
        const budget = Math.min(
            Math.floor(contextWindow * OPTIMISTIC_CONTEXT_COMPACTION_THRESHOLD_RATIO),
            OPTIMISTIC_CONTEXT_COMPACTION_ABSOLUTE_TOKENS,
        );
        return estimated > budget;
    }
}
