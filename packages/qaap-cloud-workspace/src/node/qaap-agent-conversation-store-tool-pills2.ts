// Extracted from qaap-agent-conversation-store.ts
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

import { assertAgentAllowedOnHostedRuntime } from '@theia/qaap-shared-core/lib/common/qaap-hosted-agent-auth-policy';

import { QaapAgentConversation, QaapAgentConversationStatus, QaapAgentMessage, QaapConversationCheckpoint, QaapCreateAgentConversationRequest, toConversationSummary } from '../common/qaap-agent-conversation';

import { agentSupportsModelPicker, resolveQaapAgentMentionToken } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

import { isConversationTurnVisuallySettled } from '@theia/qaap-shared-core/lib/common/qaap-transcript-turn-status';
import type { QaapAgentConversationDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';

import type { QaapAgentTask, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';

import { resolveTaskAgentModel } from '../common/qaap-agent-task';

import { agentModelKey, agentTurnHasRetryableEmptyOutput, agentTurnHasRetryableModelFailure, agentTurnHasRetryableToolSupportFailure, resolveNextFallbackAgentModel } from '../common/qaap-agent-model-fallback';

import { appendTracePreviewFailureEvent, syncSettledTraceEventsOnMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';

import { finalizeUnfinishedAgentToolSegments } from '../common/qaap-agent-transcript-segment-finalize';

import { clearRunActive as clearRunActiveHelper, appendRunCancelledTrace as appendRunCancelledTraceHelper, detectAgentBlockedNeed as detectAgentBlockedNeedHelper, appendReviewTrace as appendReviewTraceHelper, appendBlockedTrace as appendBlockedTraceHelper, appendVerificationWarningTrace as appendVerificationWarningTraceHelper, appendCheckpointTrace as appendCheckpointTraceHelper, appendAgentReply as appendAgentReplyHelper, maybeAutoContinueIncompleteTurn as maybeAutoContinueIncompleteTurnHelper, prepareContextCompactionForTurn as prepareContextCompactionForTurnHelper } from './qaap-agent-conversation-store-helpers';

import { markTurnFailed as markTurnFailedHelper, buildTaskCreateRequest as buildTaskCreateRequestHelper } from './qaap-agent-conversation-store-helpers2';

export function maybeRetryTurnWithFallbackModelExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string, ): boolean {
        if (!agentSupportsModelPicker(turnAgentId)) {
            return false;
        }
        // Tool-support failures also arrive on clean exits (state 'completed'): the model
        // emitted its tool call as text and the CLI finished "successfully" with exit 0.
        const toolSupportFailure = agentTurnHasRetryableToolSupportFailure(agentMessage);
        // Quota is NOT auto-retried: Antigravity models encode effort in the label
        // ("Gemini 3.5 Flash (High)" → "(Low)"), so silent fallback looks like the
        // product changed effort without the user asking. Surface the quota dialog
        // and let them pick another model/effort in the composer.
        const retryableFailedState = task.state === 'failed'
            && (agentTurnHasRetryableEmptyOutput(agentMessage)
                || agentTurnHasRetryableModelFailure(agentMessage));
        if (!toolSupportFailure && !retryableFailedState) {
            return false;
        }
        const loopBudgetKey = ctx.resolveLoopBudgetKey(conv, userMessageId);
        if (!ctx.hasLoopSpawnBudget(loopBudgetKey)) {
            ctx.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        const turnUserMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
        const currentModel = turnUserMessage?.turnAgentModel
            ?? resolveTaskAgentModel(task)
            ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined);
        const tried = ctx.modelFallbackTriedByUserMessage.get(loopBudgetKey) ?? new Set<string>();
        const currentKey = agentModelKey(currentModel);
        if (currentKey) {
            tried.add(currentKey);
        }
        const nextModel = resolveNextFallbackAgentModel(turnAgentId, currentModel, tried);
        if (!nextModel) {
            ctx.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        const messages = conv.messages
            .filter(message => message.id !== agentMessageId)
            .map(message => message.id === userMessageId
                ? {
                    ...message,
                    error: undefined,
                    taskId: undefined,
                    turnAgentId,
                    turnAgentModel: nextModel,
                }
                : message);
        const retryConv: QaapAgentConversation = {
            ...conv,
            status: 'streaming',
            updatedAt: Date.now(),
            messages,
            ...(conv.agentId === turnAgentId ? { agentModel: nextModel, qaiqModel: nextModel } : {}),
        };
        let spawned: QaapAgentTask;
        try {
            spawned = ctx.taskRunner.create(
                ctx.buildTaskCreateRequest(retryConv, turnAgentId, undefined, userMessageId),
                retryConv.ownerLogin,
            );
        } catch {
            return false;
        }
        ctx.recordLoopSpawn(loopBudgetKey);
        const nextKey = agentModelKey(nextModel);
        if (nextKey) {
            tried.add(nextKey);
        }
        ctx.modelFallbackTriedByUserMessage.set(loopBudgetKey, tried);
        const messagesWithTask = retryConv.messages.map(message => message.id === userMessageId
            ? {
                ...message,
                taskId: spawned.id,
                // Same fallback rationale as the initial-spawn site: task.agentId is not resolved
                // synchronously by taskRunner.create().
                turnAgentId: spawned.agentId ?? turnAgentId,
                turnAgentModel: nextModel,
            }
            : message);
        const nextConv = { ...retryConv, messages: messagesWithTask };
        ctx.conversations.set(conversationId, nextConv);
        // The re-attributed user message is the only carrier of the new provenance: the `updated`
        // summary below has no `messages` (see toConversationSummary), so without this frame every
        // tab except the one that polls keeps badging the turn with the model that just failed.
        const resealedUserMessage = messagesWithTask.find(message => message.id === userMessageId);
        if (resealedUserMessage) {
            ctx.fire({ type: 'message', conversationId, cwd: nextConv.cwd, message: resealedUserMessage });
        }
        ctx.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        ctx.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
            startSha,
        });
        void ctx.persist();
        return true;
}

export function postAutoContinueMessageExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        content: string,
        conv: QaapAgentConversation,
        rootUserMessageId: string,
        turnAgentId: string,
        turnAgentModel: QaapAgentMessage['turnAgentModel'], ): QaapAgentConversation {
        return ctx.postUserMessage(
            conversationId,
            content,
            turnAgentId,
            turnAgentModel ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined),
            conv.autoApprove,
            conv.interactionModeId,
            conv.approvalPolicyId,
            conv.toolApprovalRules,
            undefined,
            { autoContinueRootMessageId: rootUserMessageId },
        );
}

export function maybeAutoContinueIncompleteTurnExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        conv: QaapAgentConversation,
        userMessageId: string,
        agentMessageId?: string,
        turnAgentId?: string, ): void {
        maybeAutoContinueIncompleteTurnHelper(conversationId, conv, userMessageId, agentMessageId, turnAgentId, {
            resolveLoopBudgetKey: (c, u) => ctx.resolveLoopBudgetKey(c, u),
            countAutoContinueAttempts: (c, u) => ctx.countAutoContinueAttempts(c, u),
            hasLoopSpawnBudget: u => ctx.hasLoopSpawnBudget(u),
            recordLoopSpawn: u => ctx.recordLoopSpawn(u),
            postAutoContinueMessage: (cid, p, c, r, t, m) => ctx.postAutoContinueMessage(cid, p, c, r, t, m),
            reportPreviewBootstrapFailure: (cid, r) => ctx.reportPreviewBootstrapFailure(cid, r),
        });
}

export function reportPreviewBootstrapFailureExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string, reason: string): QaapAgentConversation | undefined {
        const trimmed = reason.trim();
        if (!trimmed) {
            return undefined;
        }
        const conv = ctx.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        if (conv.status === 'failed') {
            return conv;
        }
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user');
        if (!lastAgent || !lastUser) {
            return undefined;
        }
        // See the cast/comment in qaap-agent-conversation-store-render2.ts#getExtracted: this
        // transcript-status helper reads only fields shared structurally with QaapAgentConversation.
        if (conv.status === 'streaming' && !isConversationTurnVisuallySettled(conv as unknown as QaapAgentConversationDTO)) {
            return undefined;
        }
        const failed = ctx.markTurnFailed(conv, {
            userMessageId: lastUser.id,
            agentMessageId: lastAgent.id,
            reason: trimmed,
            failureBody: lastAgent.content,
        });
        let next = ctx.finalizeStreamingAgentMessage(failed.conv, lastAgent.id, trimmed);
        next = {
            ...next,
            messages: next.messages.map(message => message.id === lastAgent.id && message.role === 'agent'
                ? appendTracePreviewFailureEvent(message, trimmed)
                : message),
        };
        ctx.conversations.set(conversationId, next);
        ctx.publishFinalizedAgentMessage(conversationId, next, lastAgent.id);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export function appendAgentReplyExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        content: string,
        /** The run this reply answers — see {@link QaapAgentMessage.runUserMessageId}. */
        runUserMessageId?: string, ): QaapAgentConversation {
        return appendAgentReplyHelper(conv, content, runUserMessageId);
}

export function failTurnBeforeSpawnExtracted(ctx: QaapAgentConversationStoreContext, id: string,
        conv: QaapAgentConversation,
        userMessageId: string,
        reason: string, ): QaapAgentConversation {
        const failed = ctx.markTurnFailed(conv, {
            userMessageId,
            reason,
        });
        const next = failed.conv;
        ctx.conversations.set(id, next);
        const agentMessage = failed.agentMessageId
            ? next.messages.find(entry => entry.id === failed.agentMessageId)
            : undefined;
        if (agentMessage) {
            ctx.fire({ type: 'message', conversationId: id, cwd: next.cwd, message: agentMessage });
        }
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void ctx.persist();
        return next;
}

export function markTurnFailedExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        options: {
            readonly userMessageId: string;
            readonly agentMessageId?: string;
            readonly reason: string;
            readonly failureBody?: string;
            /**
             * Conversation status to land on. Defaults to `failed`; a run that dies while peer
             * runs of the same conversation keep working passes `streaming` so the failure stays
             * scoped to its own message instead of switching off the whole session.
             */
            readonly status?: QaapAgentConversationStatus;
        }, ): { readonly conv: QaapAgentConversation; readonly agentMessageId?: string } {
        return markTurnFailedHelper(conv, options);
}

export function finalizeStreamingAgentMessageExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        interruptionReason: string, ): QaapAgentConversation {
        if (!agentMessageId) {
            return conv;
        }
        const messages = conv.messages.map(message => {
            if (message.id !== agentMessageId || message.role !== 'agent') {
                return message;
            }
            let next = message;
            const hadUnfinishedTool = message.traceEvents?.some(event =>
                event.type === 'tool_call'
                && event.status !== 'completed'
                && event.status !== 'failed'
                && event.status !== 'cancelled',
            ) || message.segments?.some(
                segment => segment.type === 'tool' && !segment.finished,
            );
            if (hadUnfinishedTool) {
                const finalizedSegments = message.segments?.length
                    ? finalizeUnfinishedAgentToolSegments(message.segments, interruptionReason)
                    : undefined;
                next = syncSettledTraceEventsOnMessage({
                    ...next,
                    ...(finalizedSegments ? { segments: finalizedSegments } : {}),
                });
            } else if (next.traceEvents?.length || next.segments?.length) {
                next = syncSettledTraceEventsOnMessage(next);
            }
            if (next.runActive || next.runFinishedAt === undefined) {
                next = { ...next, runActive: undefined, runFinishedAt: next.runFinishedAt ?? Date.now() };
            }
            return next;
        });
        return { ...conv, messages };
}

export function clearRunActiveExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined, ): QaapAgentConversation {
        return clearRunActiveHelper(conv, agentMessageId);
}

export function appendRunCancelledTraceExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        reason: string, ): QaapAgentConversation {
        return appendRunCancelledTraceHelper(conv, agentMessageId, reason);
}

export function detectAgentBlockedNeedExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined, ): string | undefined {
        return detectAgentBlockedNeedHelper(conv, agentMessageId);
}

export function appendReviewTraceExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        note: string, ): QaapAgentConversation {
        return appendReviewTraceHelper(conv, agentMessageId, note);
}

export function appendBlockedTraceExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        need: string, ): QaapAgentConversation {
        return appendBlockedTraceHelper(conv, agentMessageId, need);
}

export function appendVerificationWarningTraceExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        task: QaapAgentTask, ): QaapAgentConversation {
        return appendVerificationWarningTraceHelper(conv, agentMessageId, task);
}

export function appendCheckpointTraceExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        checkpoint: QaapConversationCheckpoint, ): QaapAgentConversation {
        return appendCheckpointTraceHelper(conv, agentMessageId, checkpoint);
}

export function publishFinalizedAgentMessageExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        turnAgentId?: string, ): void {
        if (!agentMessageId) {
            return;
        }
        const agentMessage = conv.messages.find(message => message.id === agentMessageId);
        if (agentMessage) {
            ctx.fireAgentMessageWireUpdate(
                conversationId,
                conv.cwd,
                turnAgentId ?? ctx.resolveAgentIdForAgentMessage(conv, agentMessage),
                agentMessage,
                { forceFullMessage: true },
            );
            ctx.lastWireMessageById.delete(agentMessage.id);
            ctx.clearAgUiReducer(agentMessage.id);
        }
}

export function resolveTurnAgentExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation, userContent: string, explicit?: string): string {
        const fromMention = ctx.extractAgentMentionFromUserMessage(userContent);
        if (fromMention) {
            assertAgentAllowedOnHostedRuntime(fromMention);
            return fromMention;
        }
        const explicitId = explicit?.trim();
        if (explicitId && ctx.isKnownAgentId(explicitId)) {
            assertAgentAllowedOnHostedRuntime(explicitId);
            return explicitId;
        }
        if (ctx.isKnownAgentId(conv.agentId)) {
            assertAgentAllowedOnHostedRuntime(conv.agentId);
            return conv.agentId;
        }
        const fallback = ctx.taskRunner.defaultAgent();
        assertAgentAllowedOnHostedRuntime(fallback);
        return fallback;
}

export function extractAgentMentionFromUserMessageExtracted(ctx: QaapAgentConversationStoreContext, content: string): string | undefined {
        const regex = /@([a-z][\w-]*)/gi;
        let last: string | undefined;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            const token = ctx.taskRunner.normalizeAgentId(match[1]);
            if (token) {
                last = token;
            }
        }
        return last;
}

export function prepareContextCompactionForTurnExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation): QaapAgentConversation {
        return prepareContextCompactionForTurnHelper(conv, {
            conversations: ctx.conversations,
            fire: e => ctx.fire(e),
            buildContextCompactionSummary: m => ctx.buildContextCompactionSummary(m),
        });
}

export function buildTaskCreateRequestExtracted(ctx: QaapAgentConversationStoreContext, conv: QaapAgentConversation,
        turnAgentId: string,
        latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'],
        turnUserMessageId?: string, ): QaapCreateAgentTaskRequest {
        return buildTaskCreateRequestHelper(conv, turnAgentId, latencyMarks, turnUserMessageId, {
            stripLeadingAgentMention: c => ctx.stripLeadingAgentMention(c),
            buildPrompt: (c, a) => ctx.buildPrompt(c, a),
        });
}

export function stripLeadingAgentMentionExtracted(ctx: QaapAgentConversationStoreContext, content: string): string {
        const match = /^@([a-z][\w-]*)\b\s*/i.exec(content);
        if (match && ctx.taskRunner.normalizeAgentId(resolveQaapAgentMentionToken(match[1]))) {
            return content.slice(match[0].length).trim() || content.trim();
        }
        return content.trim();
}

