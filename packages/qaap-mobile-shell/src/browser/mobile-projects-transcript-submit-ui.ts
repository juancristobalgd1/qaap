// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AIVariableResolutionRequest, GenericCapabilitySelections } from '@theia/ai-core';
import type { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import {
    cancelConversation,
    conversationToSummary,
    getConversation,
    postConversationMessage,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    resolveAgentModelForSubmit,
    resolveExplicitAgentForSubmit,
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
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';

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

    constructor(protected readonly host: MobileProjectsTranscriptSubmitHost) { }

    protected resolveTranscriptSubmitAgentModel(
        agent: string | undefined,
        summary: QaapAgentConversationSummaryDTO,
    ): QaapCreateAgentTaskQaiqModel | undefined {
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
        this.host.transcriptLastStreamProgressAt = Date.now();
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
    ): void {
        const cached = this.host.transcriptLastConv;
        const chatHost = this.host.resolveActiveTranscriptChatHost();
        if (!chatHost) {
            return;
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
        }, summary);
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
        } = {},
    ): Promise<void> {
        if (this.submitInFlightByConversationId.has(summary.id)) {
            return;
        }
        this.submitInFlightByConversationId.add(summary.id);
        try {
            await this.submitTranscriptViaBackendConversationInner(project, summary, content, options);
        } finally {
            this.submitInFlightByConversationId.delete(summary.id);
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
        } = {},
    ): Promise<void> {
        if (this.host.transcriptHeaderUi.isPendingNewChatSummary(summary)) {
            const pendingAgent = resolveExplicitAgentForSubmit(content, {
                pinnedChatAgentId: options.selectedAgentId ?? options.widget?.pinnedAgent?.id ?? summary.agentId,
            }) ?? options.selectedAgentId ?? summary.agentId;
            this.renderInstantSubmitOptimistic(summary, {
                id: `pending-user-${Date.now()}`,
                role: 'user',
                content,
                createdAt: Date.now(),
            }, options.imagePreviews);
            const { summary: created, outbound } = await this.host.createProjectChatSession(project, summary.cwd, content, {
                selectedAgentId: options.selectedAgentId,
                modeId: options.modeId,
                autoApprove: options.autoApprove,
                approvalPolicyId: options.approvalPolicyId,
                variables: options.variables,
                agentModel: options.agentModel ?? this.resolveTranscriptSubmitAgentModel(pendingAgent, summary),
            });
            this.host.seedTranscriptOptimisticSubmit(created, outbound, pendingAgent, options.imagePreviews);
            this.host.transcriptOpenSummaryId = created.id;
            this.host.transcriptOpenSummary = created;
            this.host.transcriptComposerSummary = created;
            const activeChatHost = this.host.resolveActiveTranscriptChatHost();
            const full = await getConversation(created.id);
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
        let base = await getConversation(summary.id);
        if (base.status === 'streaming' && isConversationTurnVisuallySettled(base)) {
            await cancelConversation(summary.id);
            base = await getConversation(summary.id);
        }
        const optimistic: QaapAgentConversationDTO = {
            ...base,
            status: 'streaming',
            messages: appendOptimisticPendingUserMessage(base.messages, pendingUserMessage),
        };
        const activeChatHost = this.host.resolveActiveTranscriptChatHost();
        if (activeChatHost) {
            this.renderTranscriptSubmitMessages(activeChatHost, optimistic, summary);
        }
        try {
            const agentModel = options.agentModel ?? this.resolveTranscriptSubmitAgentModel(agent, summary);
            const updated = await postConversationMessage(summary.id, outbound, {
                agent,
                agentModel,
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
            });
            const nextSummary = conversationToSummary(updated);
            this.host.conversations?.recordSnapshot(nextSummary);
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
}
