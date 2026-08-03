// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Phase 12 extractions from QaapAgentConversationStore.
// Each function receives its dependencies explicitly — no instance state access.

import { randomUUID } from 'crypto';
import {
    toConversationSummary,
    type QaapAgentConversation,
    type QaapAgentConversationEvent,
    type QaapAgentConversationStatus,
    type QaapAgentMessage,
    type QaapCreateAgentConversationRequest,
} from '../common/qaap-agent-conversation';
import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { agentSupportsModelPicker } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    createComposerGitActionDisplayMarker,
    type ComposerGitActionDisplayMetadata,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display';

// ─── Pure: markTurnFailed (0 this. refs) ─────────────────────────────────────

export function markTurnFailed(
    conv: QaapAgentConversation,
    options: {
        readonly userMessageId: string;
        readonly agentMessageId?: string;
        readonly reason: string;
        readonly failureBody?: string;
        readonly status?: QaapAgentConversationStatus;
    },
): { readonly conv: QaapAgentConversation; readonly agentMessageId?: string } {
    let agentMessageId = options.agentMessageId;
    let messages = conv.messages.map(message => message.id === options.userMessageId
        ? { ...message, error: undefined }
        : message
    );
    if (agentMessageId) {
        messages = messages.map(message => message.id === agentMessageId && message.role === 'agent'
            ? {
                ...message,
                error: options.reason,
                content: message.content?.trim()
                    ? message.content
                    : (options.failureBody?.trim() ?? message.content),
            }
            : message
        );
    } else {
        const failureMessage: QaapAgentMessage = {
            id: randomUUID(),
            role: 'agent',
            content: options.failureBody?.trim() ?? '',
            error: options.reason,
            createdAt: Date.now(),
            // A run that died before streaming anything still appends at the end of the
            // array, so the failed turn needs the same explicit link as a streamed one.
            runUserMessageId: options.userMessageId,
        };
        agentMessageId = failureMessage.id;
        messages = [...messages, failureMessage];
    }
    return {
        conv: {
            ...conv,
            status: options.status ?? 'failed',
            updatedAt: Date.now(),
            messages,
        },
        agentMessageId,
    };
}

// ─── DI-extracted: buildTaskCreateRequest (3 this. method calls) ─────────────

export interface BuildTaskCreateRequestDeps {
    stripLeadingAgentMention(content: string): string;
    buildPrompt(conv: QaapAgentConversation, agentId: string): string;
}

export function buildTaskCreateRequest(
    conv: QaapAgentConversation,
    turnAgentId: string,
    latencyMarks: QaapCreateAgentConversationRequest['latencyMarks'] | undefined,
    turnUserMessageId: string | undefined,
    deps: BuildTaskCreateRequestDeps,
): QaapCreateAgentTaskRequest {
    const turnUserMessage = turnUserMessageId
        ? conv.messages.find(message => message.id === turnUserMessageId && message.role === 'user')
        : undefined;
    // A fallback may be spawned after peer runs appended messages. Build a request-shaped
    // transcript with this run's user turn at the tail; never let an interleaved peer message
    // become the command/latest prompt simply because it is last in the shared array.
    const requestConv = turnUserMessage && conv.messages[conv.messages.length - 1]?.id !== turnUserMessage.id
        ? {
            ...conv,
            messages: [
                ...conv.messages.filter(message => message.id !== turnUserMessage.id),
                turnUserMessage,
            ],
        }
        : conv;
    const lastUser = requestConv.messages[requestConv.messages.length - 1];
    if (turnAgentId === 'shell') {
        return {
            command: deps.stripLeadingAgentMention(lastUser.content),
            cwd: requestConv.cwd,
            title: requestConv.title,
        };
    }
    return {
        prompt: deps.buildPrompt(requestConv, turnAgentId),
        agent: turnAgentId,
        cwd: requestConv.cwd,
        title: requestConv.title,
        // Clean latest user message (mention-stripped) for opt-in relevance retrieval.
        ...(lastUser?.content ? { userQuery: deps.stripLeadingAgentMention(lastUser.content) } : {}),
        ...(requestConv.autoApprove === false ? { autoApprove: false } : {}),
        ...(requestConv.contextPreamble ? { contextPreamble: requestConv.contextPreamble } : {}),
        ...(requestConv.interactionModeId ? { interactionModeId: requestConv.interactionModeId } : {}),
        ...(requestConv.approvalPolicyId ? { approvalPolicyId: requestConv.approvalPolicyId } : {}),
        ...(requestConv.toolApprovalRules ? { toolApprovalRules: requestConv.toolApprovalRules } : {}),
        ...(latencyMarks ? { latencyMarks } : {}),
        ...(() => {
            const agentModel = lastUser?.turnAgentId === turnAgentId
                ? lastUser.turnAgentModel ?? requestConv.agentModel ?? requestConv.qaiqModel
                : requestConv.agentModel ?? requestConv.qaiqModel;
            return agentSupportsModelPicker(turnAgentId) && agentModel
                ? { agentModel, qaiqModel: agentModel }
                : {};
        })(),
    };
}

// ─── DI-extracted: recordGitAction (4 this. method calls) ───────────────────

export interface RecordGitActionDeps {
    getConversation(conversationId: string): QaapAgentConversation | undefined;
    setConversation(conversationId: string, conv: QaapAgentConversation): void;
    fire(event: QaapAgentConversationEvent): void;
    persist(): Promise<void>;
}

export function recordGitAction(
    conversationId: string,
    metadata: ComposerGitActionDisplayMetadata,
    options: {
        readonly messageId?: string;
        readonly replaceMessageId?: string;
    },
    deps: RecordGitActionDeps,
): QaapAgentConversation | undefined {
    const conv = deps.getConversation(conversationId);
    if (!conv || !metadata.label.trim()) {
        return undefined;
    }
    const content = createComposerGitActionDisplayMarker(metadata);
    const replaceMessageId = options.replaceMessageId?.trim();
    if (replaceMessageId) {
        const replaceIndex = conv.messages.findIndex(message => message.id === replaceMessageId);
        if (replaceIndex < 0) {
            return undefined;
        }
        const replaced: QaapAgentMessage = {
            ...conv.messages[replaceIndex],
            content,
            createdAt: Date.now(),
        };
        const messages = conv.messages.slice();
        messages[replaceIndex] = replaced;
        const next: QaapAgentConversation = {
            ...conv,
            updatedAt: Date.now(),
            messages,
        };
        deps.setConversation(conversationId, next);
        deps.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void deps.persist();
        return next;
    }
    const userMessage: QaapAgentMessage = {
        id: options.messageId?.trim() || randomUUID(),
        role: 'user',
        content,
        createdAt: Date.now(),
    };
    const next: QaapAgentConversation = {
        ...conv,
        updatedAt: Date.now(),
        messages: [...conv.messages, userMessage],
    };
    deps.setConversation(conversationId, next);
    deps.fire({ type: 'message', conversationId, cwd: next.cwd, message: userMessage });
    deps.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void deps.persist();
    return next;
}
