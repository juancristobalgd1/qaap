// Extracted from qaap-agent-conversation-store.ts
import type { QaapAgentConversationStoreContext } from './qaap-agent-conversation-store-context';

import { QaapAgentConversation, QaapAgentMessage, toConversationSummary } from '../common/qaap-agent-conversation';

import { usesAgUiCliTranscriptStream, usesStructuredAgentTranscript } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';

import { isHostedCodexUsage } from '../common/qaap-billing-plans';

import { localizeAgentFailureMessage, resolveAgentTurnFailureMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';

import { resolveAgentLogDisplayText } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';

import { resolveChatTurnOutcome } from '../common/qaap-chat-turn-workflow';

import type { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';

import type { QaapAgentTask } from '../common/qaap-agent-task';

import { buildAgentMessageFromAgUiStructuredLog } from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';

import { agentTurnHasRetryableToolSupportFailure } from '../common/qaap-agent-model-fallback';

import { agentMessageHasStructuredTrace, isPlaceholderAgentContent, syncSettledTraceEventsOnMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';

import { materializeAgentMessageForApi } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-backfill';

import { resolveStructuredParsedTraceEvents as resolveStructuredParsedTraceEventsHelper } from './qaap-agent-conversation-store-utils';

import { applyAccumulatorStructuredOutput as applyAccumulatorStructuredOutputHelper } from './qaap-agent-conversation-store-helpers';

import { type QaapConversationTaskRef } from './qaap-agent-conversation-store-constants';

export function applyAccumulatorStructuredOutputExtracted(ctx: QaapAgentConversationStoreContext, taskId: string,
    ref: QaapConversationTaskRef,
    agentId: string, ): void {
    applyAccumulatorStructuredOutputHelper(taskId, ref, agentId, {
        conversations: ctx.conversations,
        agentStreamByTaskId: ctx.agentStreamByTaskId,
        taskToConversation: ctx.taskToConversation,
        fireAgentMessageWireUpdate: (cid, cwd, aid, msg) => ctx.fireAgentMessageWireUpdate(cid, cwd, aid, msg),
        fire: e => ctx.fire(e),
        schedulePersist: () => ctx.schedulePersist(),
    });
}

export function backfillAgentMessageFromStructuredLogExtracted(ctx: QaapAgentConversationStoreContext, message: QaapAgentMessage,
    agentId: string,
    log: string, ): QaapAgentMessage {
    if (message.role !== 'agent'
        || agentMessageHasStructuredTrace(message)
        || (message.segments?.length ?? 0) > 0
        || !isPlaceholderAgentContent(message.content)) {
        return message;
    }
    const parsed = ctx.parseStructuredLog(agentId, log);
    if (parsed?.segments?.length || parsed?.traceEvents?.length) {
        return materializeAgentMessageForApi({
            ...message,
            content: parsed.content || message.content,
            segments: parsed.segments,
            traceEvents: ctx.resolveStructuredParsedTraceEvents(message, parsed),
        });
    }
    const replayed = buildAgentMessageFromAgUiStructuredLog(agentId, message.id, message.createdAt, log);
    if (replayed?.traceEvents?.length) {
        return materializeAgentMessageForApi({
            ...message,
            content: replayed.content || message.content,
            traceEvents: replayed.traceEvents,
        });
    }
    if (parsed?.content?.trim()) {
        return { ...message, content: parsed.content };
    }
    return message;
}

export function resolveStructuredParsedTraceEventsExtracted(ctx: QaapAgentConversationStoreContext, message: QaapAgentMessage,
    parsed: {
        segments?: QaapAgentMessage['segments'];
        traceEvents?: QaapAgentMessage['traceEvents'];
    }, ): QaapAgentMessage['traceEvents'] {
    return resolveStructuredParsedTraceEventsHelper(message, parsed);
}

export async function applyTaskOutcomeExtracted(ctx: QaapAgentConversationStoreContext, ref: QaapConversationTaskRef,
    task: QaapAgentTask, ): Promise<QaapWorkflowNodeOutcome> {
    const { conversationId, userMessageId, agentMessageId, turnAgentId, startSha } = ref;
    const convSnapshot = ctx.conversations.get(conversationId);
    if (!convSnapshot) {
        return resolveChatTurnOutcome(task.state);
    }
    // Defense-in-depth: a newer task may have superseded this one — but only when it took
    // over the SAME user turn (that is what the model-fallback retry does). Peer runs started
    // by the user carry a different user message and are not superseding anything, so with
    // in-session multitasking "some other task is active" can no longer mean "stale".
    if (ctx.hasActiveTaskForUserMessage(conversationId, userMessageId, task.id)) {
        ctx.agentStreamByTaskId.delete(task.id);
        ctx.agUiStreamByTaskId.delete(task.id);
        return resolveChatTurnOutcome(task.state);
    }
    const usageFinalized = ctx.finalizeTurnContextUsage(convSnapshot, task.id, turnAgentId);
    ctx.agentStreamByTaskId.delete(task.id);
    ctx.agUiStreamByTaskId.delete(task.id);
    if (
        task.ownerLogin
        && ctx.billingStore
        && usageFinalized.contextUsage
        && !usageFinalized.contextUsageEstimated
    ) {
        const modelId = task.agentModel?.modelId ?? task.qaiqModel?.modelId;
        const usesUserCodexSession = ctx.taskRunner?.isAgentConnected?.(turnAgentId) === true;
        if (isHostedCodexUsage(turnAgentId, modelId) && !usesUserCodexSession) {
            void ctx.billingStore.debitHostedUsage(
                task.ownerLogin,
                modelId!,
                usageFinalized.contextUsage.inputTokens,
                usageFinalized.contextUsage.outputTokens,
            ).catch(() => undefined);
        }
    }
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return resolveChatTurnOutcome(task.state);
    }
    let withUsageBaseline: QaapAgentConversation = {
        ...conv,
        contextUsage: usageFinalized.contextUsage,
        contextUsageEstimated: usageFinalized.contextUsageEstimated,
        contextWindowSize: usageFinalized.contextWindowSize,
    };
    if (task.state === 'cancelled') {
        const cancelledReason = 'Turn cancelled.';
        const withCancelledTrace = ctx.appendRunCancelledTrace(withUsageBaseline, agentMessageId, cancelledReason);
        const finalized = ctx.finalizeStreamingAgentMessage(withCancelledTrace, agentMessageId, cancelledReason);
        const next: QaapAgentConversation = {
            ...finalized,
            status: ctx.settleStatusForRun(conversationId, task.id, 'idle'),
            updatedAt: Date.now(),
        };
        ctx.publishFinalizedAgentMessage(conversationId, next, agentMessageId, turnAgentId);
        // Do not auto-synthesize after a cancelled leader — that would spawn a new turn
        // right after the user hit Stop (and feels like cancel "did nothing").
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        ctx.flushPersist();
        ctx.pendingTeamSynthesisForLeader.delete(task.id);
        // Drain any user messages that were queued (delivery mode 'queue') while the agent
        // was running. The cancelled turn settled to 'idle', so the queue can now flush.
        if (next.status === 'idle') {
            ctx.drainPendingMessages(conversationId);
        }
        return 'blocked';
    }
    const detail = await ctx.taskRunner.detail(task.id);
    // Re-read across the await: with in-session multitasking a PEER run can stream into this
    // same conversation while we wait for the task detail, and everything below derives what
    // it writes back from this baseline. Keeping the pre-await snapshot would silently drop
    // the other agent's output (read-modify-write over one shared conversation record).
    const latest = ctx.conversations.get(conversationId);
    if (!latest) {
        return resolveChatTurnOutcome(task.state);
    }
    withUsageBaseline = {
        ...latest,
        contextUsage: usageFinalized.contextUsage,
        contextUsageEstimated: usageFinalized.contextUsageEstimated,
        contextWindowSize: usageFinalized.contextWindowSize,
    };
    const log = ctx.filterAgentLogChunk((detail?.log ?? '').trim());
    const streamingAgent = agentMessageId
        ? withUsageBaseline.messages.find(message => message.id === agentMessageId)
        : undefined;
    const skipLogReparse = agentMessageHasStructuredTrace(streamingAgent)
        || (usesStructuredAgentTranscript(turnAgentId) && (
            (streamingAgent?.segments?.length ?? 0) > 0
            || (streamingAgent?.traceEvents?.length ?? 0) > 0
        ));
    const structuredParsed = log && !skipLogReparse ? ctx.parseStructuredLog(turnAgentId, log) : undefined;
    // 'completed_with_warnings' (clean exit, verification still red) is a delivered turn:
    // it takes the success path below — with a warning trace instead of the failure flow.
    // Exception: CLI blocking failures that still exit 0 — auth/session (Sign-in card),
    // and quota/rate-limit (Task failed dialog). Antigravity often prints a plain
    // "Individual quota reached…" line and exits 0; never treat that as success.
    const completedAuthFailureReason = (task.state === 'completed' || task.state === 'completed_with_warnings')
        ? ctx.resolveCompletedTurnAuthFailureReason(log)
        : undefined;
    if ((task.state !== 'completed' && task.state !== 'completed_with_warnings') || completedAuthFailureReason) {
        let convForFailure = withUsageBaseline;
        let agentMessageForFailure = streamingAgent;
        if (agentMessageId && log && streamingAgent?.role === 'agent' && !agentMessageHasStructuredTrace(streamingAgent)) {
            const backfilled = materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(
                ctx.backfillAgentMessageFromStructuredLog(streamingAgent, turnAgentId, log),
            ));
            agentMessageForFailure = backfilled;
            convForFailure = {
                ...withUsageBaseline,
                messages: withUsageBaseline.messages.map(message => message.id === agentMessageId
                    ? backfilled
                    : message),
            };
        }
        if (await ctx.maybeRetryTurnWithFallback(
            conversationId,
            userMessageId,
            agentMessageId,
            task,
            convForFailure,
            agentMessageForFailure,
            turnAgentId,
            startSha,
        )) {
            // A successful graph retry stole the task claim; an imperative degradation leaves
            // the old run terminally failed. Either way, a remaining claim must not say success.
            return 'fail';
        }
        const reason = completedAuthFailureReason ?? resolveAgentTurnFailureMessage(log, {
            state: task.state === 'interrupted' ? 'interrupted' : 'failed',
            exitCode: task.exitCode,
            agentMessage: agentMessageForFailure,
        });
        const failureBody = log ? resolveAgentLogDisplayText(turnAgentId, log) : '';
        const failed = ctx.markTurnFailed(convForFailure, {
            userMessageId,
            agentMessageId,
            reason,
            failureBody,
            status: ctx.settleStatusForRun(conversationId, task.id, 'failed'),
        });
        const resolvedAgentMessageId = failed.agentMessageId ?? agentMessageId;
        const finalized = ctx.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
        ctx.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId, turnAgentId);
        ctx.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
        // Drain queued messages even on failure — the conversation is in 'failed' status which
        // can accept follow-ups, and the user may have queued a "try a different approach" message.
        if (finalized.status === 'failed' || finalized.status === 'idle') {
            ctx.drainPendingMessages(conversationId);
        }
        return 'fail';
    }
    let withReply: QaapAgentConversation;
    if (agentMessageId && structuredParsed) {
        const messages = withUsageBaseline.messages.map(message => message.id === agentMessageId
            ? syncSettledTraceEventsOnMessage({
                ...message,
                content: structuredParsed.content || message.content,
                segments: structuredParsed.segments,
                traceEvents: ctx.resolveStructuredParsedTraceEvents(message, structuredParsed),
            })
            : message
        );
        withReply = {
            ...withUsageBaseline,
            status: ctx.settleStatusForRun(conversationId, task.id, 'idle'),
            updatedAt: Date.now(),
            messages,
        };
    } else if (agentMessageId) {
        const messages = withUsageBaseline.messages.map(message => {
            if (message.id !== agentMessageId || message.role !== 'agent') {
                return message;
            }
            const backfilled = log
                ? ctx.backfillAgentMessageFromStructuredLog(message, turnAgentId, log)
                : message;
            let settled = backfilled;
            if (log && usesAgUiCliTranscriptStream(turnAgentId)
                && !agentMessageHasStructuredTrace(settled)
                && (settled.segments?.length ?? 0) === 0) {
                const replayed = buildAgentMessageFromAgUiStructuredLog(
                    turnAgentId, message.id, message.createdAt, log,
                );
                if (replayed?.traceEvents?.length) {
                    settled = materializeAgentMessageForApi({
                        ...settled,
                        content: replayed.content || settled.content,
                        traceEvents: replayed.traceEvents,
                    });
                }
            }
            return materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(settled));
        });
        withReply = {
            ...withUsageBaseline,
            status: ctx.settleStatusForRun(conversationId, task.id, 'idle'),
            updatedAt: Date.now(),
            messages,
        };
    } else {
        const displayText = log ? resolveAgentLogDisplayText(turnAgentId, log) : '';
        const body = structuredParsed?.content?.trim() || displayText || '(agent produced no output)';
        const reply = ctx.appendAgentReply(
            { ...withUsageBaseline, status: ctx.settleStatusForRun(conversationId, task.id, 'idle') },
            body,
            userMessageId,
        );
        if (structuredParsed?.segments?.length) {
            const messages = reply.messages.map((message, index, all) => {
                if (index === all.length - 1 && message.role === 'agent') {
                    return syncSettledTraceEventsOnMessage({
                        ...message,
                        segments: structuredParsed.segments,
                        traceEvents: ctx.resolveStructuredParsedTraceEvents(message, structuredParsed),
                    });
                }
                return message;
            });
            withReply = { ...reply, messages };
        } else {
            withReply = reply;
        }
    }
    // A "successful" turn that ran no tools but answered with tool-call-shaped JSON is the
    // silent signature of a model without native function calling: the CLI exits 0, so the
    // failure branch above never sees it. Reroute into the model fallback, or fail it typed.
    const settledAgentMessage = agentMessageId
        ? withReply.messages.find(message => message.id === agentMessageId && message.role === 'agent')
        : [...withReply.messages].reverse().find(message => message.role === 'agent');
    if (settledAgentMessage && agentTurnHasRetryableToolSupportFailure(settledAgentMessage)) {
        if (await ctx.maybeRetryTurnWithFallback(
            conversationId,
            userMessageId,
            settledAgentMessage.id,
            task,
            withReply,
            settledAgentMessage,
            turnAgentId,
            startSha,
        )) {
            return 'fail';
        }
        const reason = localizeAgentFailureMessage('tool_unsupported');
        const failed = ctx.markTurnFailed(withReply, {
            userMessageId,
            agentMessageId: settledAgentMessage.id,
            reason,
            status: ctx.settleStatusForRun(conversationId, task.id, 'failed'),
        });
        const resolvedAgentMessageId = failed.agentMessageId ?? settledAgentMessage.id;
        const finalized = ctx.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
        ctx.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId, turnAgentId);
        ctx.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
        return 'fail';
    }
    const gitStats = ctx.computeGitDiffStats(conv.cwd, startSha);
    if (gitStats) {
        withReply = { ...withReply, gitDiffAdded: gitStats.added, gitDiffRemoved: gitStats.removed };
    }
    const userMessage = withReply.messages.find(m => m.id === userMessageId);
    const checkpoint = ctx.captureCheckpoint(
        withReply.cwd,
        conversationId,
        userMessageId,
        userMessage ? ctx.checkpointLabel(userMessage.content ?? '') : 'Turn',
        gitStats,
    );
    if (checkpoint) {
        withReply = { ...withReply, checkpoints: [...(withReply.checkpoints ?? []), checkpoint] };
        withReply = ctx.appendCheckpointTrace(withReply, agentMessageId, checkpoint);
    }
    if (task.verification?.status === 'failed') {
        withReply = ctx.appendVerificationWarningTrace(withReply, agentMessageId, task);
    }
    if (task.review?.status === 'failed') {
        withReply = ctx.appendReviewTrace(withReply, agentMessageId,
            `Independent review rejected the change: ${task.review.reason || 'no reason given'}`);
    } else if (task.review?.status === 'inconclusive') {
        withReply = ctx.appendReviewTrace(withReply, agentMessageId,
            'Independent review ran but produced no verdict — the result was not double-checked.');
    }
    // Blocked wins over the verification warning (more urgent for the user), but any warning
    // trace appended above is preserved — both facts stay visible in the transcript.
    const blockedNeed = ctx.detectAgentBlockedNeed(withReply, agentMessageId);
    if (blockedNeed !== undefined) {
        withReply = ctx.appendBlockedTrace(withReply, agentMessageId, blockedNeed);
    }
    const finalizedAgentMessageId = settledAgentMessage?.id ?? agentMessageId;
    withReply = ctx.clearRunActive(withReply, finalizedAgentMessageId);
    ctx.conversations.set(conversationId, withReply);
    ctx.publishFinalizedAgentMessage(conversationId, withReply, finalizedAgentMessageId, turnAgentId);
    ctx.modelFallbackTriedByUserMessage.delete(ctx.resolveLoopBudgetKey(withReply, userMessageId));
    ctx.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, withReply);
    if (blockedNeed !== undefined) {
        // The agent explicitly asked for the user — reclassify the task and never auto-continue
        // on top of a question only the user can answer.
        ctx.taskRunner.markTaskBlocked(task.id);
        return 'blocked';
    }
    if (task.state === 'completed_with_warnings') {
        // The backend verification loop already spent its fix-turn budget on this turn; the
        // text-heuristic auto-continue is blind to that verdict and would just re-prompt
        // "keep going" on top of a known-red build. Leave the decision to the user.
        // Drain queued messages before returning — the turn settled to 'idle'.
        if (withReply.status === 'idle') {
            ctx.drainPendingMessages(conversationId);
        }
        return 'success:warned';
    }
    // Drain any user messages that were queued (delivery mode 'queue') while the agent was
    // running. The turn settled to 'idle', so the queue can now flush. If auto-continue
    // fires below, it will set status back to 'streaming' and the drain will be a no-op
    // (it only fires when status is 'idle').
    if (withReply.status === 'idle') {
        ctx.drainPendingMessages(conversationId);
    }
    ctx.maybeAutoContinueIncompleteTurn(
        conversationId,
        withReply,
        userMessageId,
        finalizedAgentMessageId,
        turnAgentId,
    );
    return 'success';
}

export async function maybeRetryTurnWithFallbackExtracted(ctx: QaapAgentConversationStoreContext, conversationId: string,
    userMessageId: string,
    agentMessageId: string | undefined,
    task: QaapAgentTask,
    conv: QaapAgentConversation,
    agentMessage: QaapAgentMessage | undefined,
    turnAgentId: string,
    startSha?: string, ): Promise<boolean> {
    if (ctx.isTurnGraphEnabled() && ctx.workflowRuns) {
        return ctx.maybeRetryTurnWithFallbackModelViaGraph(
            conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
        );
    }
    return ctx.maybeRetryTurnWithFallbackModel(
        conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
    );
}
