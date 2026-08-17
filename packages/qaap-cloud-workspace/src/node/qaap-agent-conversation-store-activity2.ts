// @ts-nocheck
// Extracted from qaap-agent-conversation-store.ts

import { Emitter, Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { writeJsonAtomic } from './qaap-write-json-atomic';
import * as os from 'os';
import * as path from 'path';
import type { QaapLinkedPullRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import { isQaapWorkspaceContainerPath, QAAP_CONTAINER_CWD_ERROR } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import {
    QAAP_AGENT_CONVERSATION_API_PATH,
    QaapAgentConversation,
    QaapAgentConversationCwdGroup,
    QaapAgentConversationEvent,
    QaapAgentConversationStatus,
    QaapAgentConversationSummary,
    QaapAgentMessage,
    QaapConversationCheckpoint,
    QaapCreateAgentConversationRequest,
    QaapLinkConversationsByBranchRequest,
    QaapRenameAgentConversationRequest,
    QaapUpdateAgentConversationRequest,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import {
    agentSupportsModelPicker,
    resolveQaapAgentMentionToken,
    usesAgUiCliTranscriptStream,
    usesStructuredAgentTranscript,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    DEFAULT_QAAP_CONTEXT_WINDOW,
    totalTokensFromContextUsage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-context-usage';
import { localizeAgentFailureMessage, resolveAgentTurnFailureMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import { qaiqModelSupportsToolCalls } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-tool-support';
import {
    resolveAgentLogDisplayText,
    type QaapAgentStreamAccumulator,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import {
    type QaapCliAgUiStreamEmitter,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-ag-ui-stream';
import { isConversationTurnVisuallySettled } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-turn-status';
import {
    autoContinueAllowedForInteraction,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-turn-completion';
import { patchConversationAutoApprove } from '../common/qaap-agent-conversation-auto-approve';
import {
    QAAP_CHAT_TURN_NODE,
    QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
    QAAP_CHAT_TURN_WORKFLOW_ID,
    buildChatTurnWorkflow,
    resolveChatTurnOutcome,
    resolveChatTurnRunBudget,
} from '../common/qaap-chat-turn-workflow';
import type { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';
import { appendTeamDelegationToPrompt } from '../common/qaap-team-delegation';
import {
    buildConversationAgentPrompt,
} from '../common/qaap-agent-conversation-prompt';
import { deriveConversationTitle } from '../common/qaap-conversation-title';
import {
    areAllSubtasksSettled,
    buildTeamSynthesisUserMessage,
    collectSubtasksForLeader,
    countFailedSubtasks,
    formatSubtaskMailboxMessage,
    isTeamSynthesisUserMessage,
} from '../common/qaap-team-mailbox';
import { planConversationRewind } from '../common/qaap-agent-conversation-rewind';
import type { QaapParallelRunVariantStats } from '../common/qaap-parallel-run';
import type { QaapAgentTask, QaapAgentTaskEvent, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { resolveTaskAgentModel } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import {
    QaapConversationStreamMetricsCollector,
    countCompressedWireFields,
    logQaapStreamMetrics,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import {
    type QaapAgentMessageWireSnapshot,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-wire-delta';
import {
    buildAgentMessageFromAgUiStructuredLog,
    buildAgentMessageFromQaapAgUiReducer,
    reduceQaapAgUiTranscriptEvent,
    type QaapAgUiEvent,
    type QaapAgUiTraceReducerState,
} from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';
import {
    agentModelKey,
    agentTurnHasRetryableEmptyOutput,
    agentTurnHasRetryableModelFailure,
    agentTurnHasRetryableToolSupportFailure,
    resolveNextFallbackAgentModel,
} from '../common/qaap-agent-model-fallback';
import {
    appendTracePreviewFailureEvent,
    agentMessageHasStructuredTrace,
    isPlaceholderAgentContent,
    syncSettledTraceEventsOnMessage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';
import { backfillConversationTraceEvents, materializeConversationForApiWithChanges, materializeAgentMessageForApi, preferTraceFirstAgentMessageStorage } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-backfill';
import { mergeAccumulatorTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { mergeSegmentTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-model';
import { finalizeUnfinishedAgentToolSegments } from '../common/qaap-agent-transcript-segment-finalize';
import {
    QAAP_VISUAL_REPAIR_REQUIRED_MARKER,
    agentMessageHasVisualVerificationMarker,
    buildQaapVisualFlowMarkdown,
    buildQaapVisualVerificationFailureMarkdown,
    buildQaapVisualVerificationMarkdown,
    buildQaapVisualVideoMarkdown,
    type QaapPreviewVisualValidationResult,
    type QaapVisualFlowStepEvidence,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import {
    type ComposerGitActionDisplayMetadata,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display';
import {
    QAAP_MAX_TURN_MINUTES_ENV,
    resolveQaapMaxTurnMinutes,
} from '../common/qaap-agent-turn-watchdog';
import {
    visualEvidenceDirectory as visualEvidenceDirectoryHelper,
    resolveVisualEvidenceTarget as resolveVisualEvidenceTargetHelper,
    resolveVisualRepairSourceUserMessage as resolveVisualRepairSourceUserMessageHelper,
    countVisualRepairAttempts as countVisualRepairAttemptsHelper,
    buildVisualRepairPrompt as buildVisualRepairPromptHelper,
    saveVisualEvidenceImage as saveVisualEvidenceImageHelper,
    saveVisualEvidenceVideo as saveVisualEvidenceVideoHelper,
    resolveVisualVerificationFile as resolveVisualVerificationFileHelper,
    sweepUnreferencedVisualEvidence as sweepUnreferencedVisualEvidenceHelper,
} from './qaap-agent-conversation-store-visual';
import {
    parseGithubRepoFromCwd as parseGithubRepoFromCwdHelper,
    readGitBranch as readGitBranchHelper,
    captureGitSha as captureGitShaHelper,
    computeGitDiffStats as computeGitDiffStatsHelper,
    checkpointLabel as checkpointLabelHelper,
    isDirectory as isDirectoryHelper,
} from './qaap-agent-conversation-store-git';
import {
    resolveStructuredParsedTraceEvents as resolveStructuredParsedTraceEventsHelper,
    resolveLoopBudgetKey as resolveLoopBudgetKeyHelper,
    countAutoContinueAttempts as countAutoContinueAttemptsHelper,
    resolveAgentIdForAgentMessage as resolveAgentIdForAgentMessageHelper,
    contextCompactionMessageText as contextCompactionMessageTextHelper,
    contextPreambleWithCompaction as contextPreambleWithCompactionHelper,
    filterAgentLogChunk as filterAgentLogChunkHelper,
    deriveTitle as deriveTitleHelper,
    isTurnGraphEnabled as isTurnGraphEnabledHelper,
    readTriedFallbackModels as readTriedFallbackModelsHelper,
} from './qaap-agent-conversation-store-utils';
import {
    clearRunActive as clearRunActiveHelper,
    appendRunCancelledTrace as appendRunCancelledTraceHelper,
    detectAgentBlockedNeed as detectAgentBlockedNeedHelper,
    appendReviewTrace as appendReviewTraceHelper,
    appendBlockedTrace as appendBlockedTraceHelper,
    appendVerificationWarningTrace as appendVerificationWarningTraceHelper,
    appendCheckpointTrace as appendCheckpointTraceHelper,
    appendAgentReply as appendAgentReplyHelper,
    resolveCompletedTurnAuthFailureReason as resolveCompletedTurnAuthFailureReasonHelper,
    parseStructuredLog as parseStructuredLogHelper,
    resolveRunAgentMessageId as resolveRunAgentMessageIdHelper,
    listAllGroupedByCwd as listAllGroupedByCwdHelper,
    hasActiveTaskForUserMessage as hasActiveTaskForUserMessageHelper,
    finalizeTurnContextUsage as finalizeTurnContextUsageHelper,
    ensureAgentStream as ensureAgentStreamHelper,
    ensureAgUiStream as ensureAgUiStreamHelper,
    buildContextCompactionSummary as buildContextCompactionSummaryHelper,
    countDurableLoopSpawns as countDurableLoopSpawnsHelper,
    maybeAutoContinueIncompleteTurn as maybeAutoContinueIncompleteTurnHelper,
    prepareContextCompactionForTurn as prepareContextCompactionForTurnHelper,
    sweepZombieStreamingTurns as sweepZombieStreamingTurnsHelper,
    forceStopZombieTurn as forceStopZombieTurnHelper,
    applyAccumulatorStructuredOutput as applyAccumulatorStructuredOutputHelper,
    fireAgentMessageWireUpdate as fireAgentMessageWireUpdateHelper,
} from './qaap-agent-conversation-store-helpers';
import {
    markTurnFailed as markTurnFailedHelper,
    buildTaskCreateRequest as buildTaskCreateRequestHelper,
    recordGitAction as recordGitActionHelper,
} from './qaap-agent-conversation-store-helpers2';
import {
    STORE_DIR,
    STREAMING_PERSIST_DEBOUNCE_MS,
    INDEX_PATH,
    MAX_CONCURRENT_CONVERSATION_RUNS,
    TURN_WATCHDOG_SWEEP_MS,
    QAAP_AUTO_RESUME_TURNS_ENABLED,
    MAX_RESTART_RESUMES,
    MAX_LOOP_SPAWNS_PER_USER_MESSAGE,
    MAX_VISUAL_REPAIR_ATTEMPTS,
    QaapMaxConcurrentRunsError,
    type PostUserMessageInternalOptions,
    type QaapConversationTaskRef,
} from './qaap-agent-conversation-store-constants';

export function applyAccumulatorStructuredOutputExtracted(ctx: any, taskId: string,
    ref: QaapConversationTaskRef,
    agentId: string,): void {
    applyAccumulatorStructuredOutputHelper(taskId, ref, agentId, {
        conversations: ctx.conversations,
        agentStreamByTaskId: ctx.agentStreamByTaskId,
        taskToConversation: ctx.taskToConversation,
        fireAgentMessageWireUpdate: (cid, cwd, aid, msg) => ctx.fireAgentMessageWireUpdate(cid, cwd, aid, msg),
        fire: e => ctx.fire(e),
        schedulePersist: () => ctx.schedulePersist(),
    });
}

export function backfillAgentMessageFromStructuredLogExtracted(ctx: any, message: QaapAgentMessage,
    agentId: string,
    log: string,): QaapAgentMessage {
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

export function resolveStructuredParsedTraceEventsExtracted(ctx: any, message: QaapAgentMessage,
    parsed: {
        segments?: QaapAgentMessage['segments'];
        traceEvents?: QaapAgentMessage['traceEvents'];
    },): QaapAgentMessage['traceEvents'] {
    return resolveStructuredParsedTraceEventsHelper(message, parsed);
}

export async function applyTaskOutcomeExtracted(ctx: any, ref: QaapConversationTaskRef,
    task: QaapAgentTask,): Promise<QaapWorkflowNodeOutcome> {
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

export async function maybeRetryTurnWithFallbackExtracted(ctx: any, conversationId: string,
    userMessageId: string,
    agentMessageId: string | undefined,
    task: QaapAgentTask,
    conv: QaapAgentConversation,
    agentMessage: QaapAgentMessage | undefined,
    turnAgentId: string,
    startSha?: string,): Promise<boolean> {
    if (ctx.isTurnGraphEnabled() && ctx.workflowRuns) {
        return ctx.maybeRetryTurnWithFallbackModelViaGraph(
            conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
        );
    }
    return ctx.maybeRetryTurnWithFallbackModel(
        conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
    );
}

