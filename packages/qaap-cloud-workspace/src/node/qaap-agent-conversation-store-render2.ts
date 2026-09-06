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
    QAAP_DEFAULT_DELIVERY_MODE,
    QaapAgentConversation,
    QaapAgentConversationCwdGroup,
    QaapAgentConversationEvent,
    QaapAgentConversationStatus,
    QaapAgentConversationSummary,
    QaapAgentMessage,
    QaapConversationCheckpoint,
    QaapCreateAgentConversationRequest,
    QaapLinkConversationsByBranchRequest,
    QaapMessageDeliveryMode,
    QaapPendingUserMessage,
    QaapRenameAgentConversationRequest,
    QaapUpdateAgentConversationRequest,
    toConversationSummary,
} from '../common/qaap-agent-conversation';
import {
    agentSupportsModelPicker,
    resolveQaapAgentMentionToken,
    SHELL_AGENT_ID,
    usesAgUiCliTranscriptStream,
    usesStructuredAgentTranscript,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import {
    DEFAULT_QAAP_CONTEXT_WINDOW,
    totalTokensFromContextUsage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-context-usage';
import { localizeAgentFailureMessage, localizeMissingCodingAgentMessage, resolveAgentTurnFailureMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import { assertAgentAllowedOnHostedRuntime } from '@theia/qaap-mobile-shell/lib/common/qaap-hosted-agent-auth-policy';
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
    QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION,
    QAAP_MAX_BATCH_SIZE,
    QAAP_COALESCE_WINDOW_MS,
    TURN_WATCHDOG_SWEEP_MS,
    QAAP_AUTO_RESUME_TURNS_ENABLED,
    MAX_RESTART_RESUMES,
    MAX_LOOP_SPAWNS_PER_USER_MESSAGE,
    MAX_VISUAL_REPAIR_ATTEMPTS,
    QaapMaxConcurrentRunsError,
    type PostUserMessageInternalOptions,
    type QaapConversationTaskRef,
} from './qaap-agent-conversation-store-constants';

export function mutatingGitSyncExtracted(ctx: any, cwd: string, args: string[], env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
    const wrapped = ctx.tenantSpawn.wrapShellForTenant(cwd, 'git', args);
    const runEnv = { ...(env ?? process.env), ...ctx.tenantSpawn.tenantHomeEnvOverlay(cwd) };
    return spawnSync(wrapped.file, wrapped.args, { cwd, env: runEnv, encoding: 'utf8' });
}

export function initExtracted(ctx: any): void {
    ctx.sseBatcher = new QaapAgentConversationSseBatcher(event => {
        ctx.recordStreamMetrics(event);
        ctx.onDidChangeEmitter.fire(event);
    });
    ctx.restoreReady = ctx.restoreFromDisk();
    ctx.taskRunner.onDidChangeTask(event => ctx.onTaskChanged(event));
    // Let completion pushes deep-link into the conversation session that spawned the task.
    ctx.taskRunner.conversationIdForTask = (taskId: string) => ctx.taskToConversation.get(taskId)?.conversationId;
    ctx.startTurnWatchdog();
}

export function listExtracted(ctx: any, cwd: string | undefined): QaapAgentConversationSummary[] {
    const all = [...ctx.conversations.values()];
    const filtered = cwd ? all.filter(c => c.cwd === path.resolve(cwd)) : all;
    return filtered
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(toConversationSummary);
}

/**
 * How many isolated parallel children of {@link parentId} are still streaming (or visually
 * settled with a live backend task). Used to cap delivery-mode `'parallel'` spawns.
 */
export function countStreamingForksExtracted(ctx: any, parentId: string): number {
    let count = 0;
    for (const conv of ctx.conversations.values() as Iterable<QaapAgentConversation>) {
        if (conv.forkedFromId === parentId && (conv.status === 'streaming' || conv.status === 'settled')) {
            count++;
        }
    }
    return count;
}

export function getExtracted(ctx: any, id: string): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(id);
    if (!conv) {
        return undefined;
    }
    const { conversation, changed } = backfillConversationTraceEvents(conv);
    const materialized = materializeConversationForApiWithChanges(conversation);
    if (changed || materialized.changed) {
        ctx.conversations.set(id, materialized.conversation);
        ctx.schedulePersist();
    }
    return materialized.conversation;
}

export function getActiveTaskIdForConversationExtracted(ctx: any, conversationId: string): string | undefined {
    for (const [taskId, ref] of ctx.taskToConversation) {
        if (ref.conversationId === conversationId) {
            return taskId;
        }
    }
    return undefined;
}

export function getActiveTaskIdsForConversationExtracted(ctx: any, conversationId: string): string[] {
    const taskIds: string[] = [];
    for (const [taskId, ref] of ctx.taskToConversation) {
        if (ref.conversationId === conversationId) {
            taskIds.push(taskId);
        }
    }
    return taskIds;
}

export function hasOtherActiveTaskForConversationExtracted(ctx: any, conversationId: string, exceptTaskId: string): boolean {
    for (const [taskId, ref] of ctx.taskToConversation) {
        if (ref.conversationId === conversationId && taskId !== exceptTaskId) {
            return true;
        }
    }
    return false;
}

export function hasActiveTaskForUserMessageExtracted(ctx: any, conversationId: string,
    userMessageId: string,
    exceptTaskId: string,): boolean {
    return hasActiveTaskForUserMessageHelper(ctx.taskToConversation, conversationId, userMessageId, exceptTaskId);
}

export function settleStatusForRunExtracted(ctx: any, conversationId: string,
    finishedTaskId: string,
    settled: QaapAgentConversationStatus,): QaapAgentConversationStatus {
    return ctx.hasOtherActiveTaskForConversation(conversationId, finishedTaskId) ? 'streaming' : settled;
}

export function createExtracted(ctx: any, request: QaapCreateAgentConversationRequest, ownerLogin?: string): QaapAgentConversation {
    const cwd = path.resolve(request.cwd ?? '');
    if (!path.isAbsolute(cwd) || !ctx.isDirectory(cwd)) {
        throw new Error('A valid absolute "cwd" directory is required.');
    }
    // See QaapAgentTaskRunner.create: a container cwd feeds every repository to the agent.
    if (isQaapWorkspaceContainerPath(cwd)) {
        throw new Error(QAAP_CONTAINER_CWD_ERROR);
    }
    const requestedAgent = (request.agent ?? '').trim();
    const seedAgent = requestedAgent || ctx.taskRunner.defaultAgent();
    const firstMessage = (request.message ?? '').trim();
    const agentId = firstMessage
        ? ctx.resolveTurnAgent({ id: '', cwd, agentId: seedAgent, title: '', status: 'idle', createdAt: 0, updatedAt: 0, messages: [] }, firstMessage, request.agent)
        : seedAgent;
    if (agentId === SHELL_AGENT_ID) {
        const explicitShell = ctx.taskRunner.normalizeAgentId(requestedAgent) === SHELL_AGENT_ID
            || (firstMessage ? ctx.extractAgentMentionFromUserMessage(firstMessage) === SHELL_AGENT_ID : false);
        if (!explicitShell) {
            throw new Error(localizeMissingCodingAgentMessage());
        }
    }
    assertAgentAllowedOnHostedRuntime(agentId);
    const now = Date.now();
    const id = randomUUID();
    const titleSeed = (request.title ?? request.message ?? '').trim();
    const conversation: QaapAgentConversation = {
        id,
        cwd,
        agentId,
        title: ctx.deriveTitle(titleSeed) || 'New conversation',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        messages: [],
        ...(ownerLogin ? { ownerLogin } : {}),
        ...(request.parallelRunId ? { parallelRunId: request.parallelRunId } : {}),
        ...(request.parallelBaseCwd ? { parallelBaseCwd: request.parallelBaseCwd } : {}),
        ...(request.worktreeBranch ? { worktreeBranch: request.worktreeBranch } : {}),
        ...(request.forkedFromId ? { forkedFromId: request.forkedFromId } : {}),
        ...(request.autoApprove === false ? { autoApprove: false } : {}),
        ...(request.contextPreamble ? { contextPreamble: request.contextPreamble } : {}),
        ...(request.interactionModeId ? { interactionModeId: request.interactionModeId } : {}),
        ...(request.approvalPolicyId ? { approvalPolicyId: request.approvalPolicyId } : {}),
        ...(request.toolApprovalRules ? { toolApprovalRules: request.toolApprovalRules } : {}),
        ...(() => {
            const agentModel = request.agentModel ?? request.qaiqModel;
            return agentModel && agentSupportsModelPicker(agentId)
                ? { agentModel, qaiqModel: agentModel }
                : {};
        })(),
        contextWindowSize: DEFAULT_QAAP_CONTEXT_WINDOW,
    };
    ctx.conversations.set(id, conversation);
    ctx.fire({ type: 'created', conversation: toConversationSummary(conversation) });
    void ctx.persist();
    if (request.message?.trim()) {
        ctx.postUserMessage(
            id,
            request.message.trim(),
            undefined,
            undefined,
            request.autoApprove === false ? false : request.autoApprove === true ? true : undefined,
            request.interactionModeId,
            request.approvalPolicyId,
            request.toolApprovalRules,
            request.latencyMarks,
        );
    }
    return ctx.conversations.get(id)!;

    // NOTE: enqueuePendingMessageExtracted and drainPendingMessagesExtracted are defined below
    // and attached to ctx via the store class wrappers.
}

// ─── Delivery mode helpers ────────────────────────────────────────────────────

/**
 * Enqueue a user message into the conversation's `pendingUserMessages` queue (delivery mode
 * `'queue'`). The message is accepted immediately (202) and will be drained when the running
 * agent finishes its turn. Multiple queued messages may be batched into a single agent turn.
 *
 * Inspired by Cursor "Send after current message" and Claude Code `pendingMessages`.
 */
export function enqueuePendingMessageExtracted(
    ctx: any,
    conv: QaapAgentConversation,
    userMessage: QaapAgentMessage,
    turnAgentId?: string,
    sealedTurnModel?: QaapCreateAgentTaskRequest['agentModel'],
    clientMessageId?: string,
): QaapAgentConversation {
    const pending: QaapPendingUserMessage = {
        id: userMessage.id,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
        ...(turnAgentId ? { turnAgentId } : {}),
        ...(sealedTurnModel ? { turnAgentModel: sealedTurnModel } : {}),
        ...(clientMessageId ? { clientMessageId } : {}),
    };
    const next: QaapAgentConversation = {
        ...conv,
        pendingUserMessages: [...(conv.pendingUserMessages ?? []), pending],
        updatedAt: Date.now(),
    };
    ctx.conversations.set(conv.id, next);
    ctx.fire({ type: 'pending-queued', conversationId: conv.id, cwd: conv.cwd, message: pending });
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
    return next;
}

/**
 * Drain pending user messages from a conversation's queue when an agent turn finishes.
 * If multiple messages are queued, they are batched into a single agent turn (optimization B)
 * to save tokens: one LLM call with the merged content instead of N calls with the full
 * conversation history each.
 *
 * Called from `applyTaskOutcome` after the conversation status settles to `'idle'`.
 * Mid-turn steering uses {@link maybeDrainAtToolRoundBoundaryExtracted} (stdin inject)
 * because this helper refuses to spawn while status is `'streaming'`.
 *
 * If {@link QAAP_COALESCE_WINDOW_MS} > 0, the drain is deferred by that many milliseconds
 * so that messages arriving in quick succession are batched together (optimization C).
 * The timer is per-conversation and cancelable — a new drain request cancels the previous
 * pending one and resets the window.
 */
export function drainPendingMessagesExtracted(ctx: any, conversationId: string): void {
    const conv = ctx.conversations.get(conversationId) as QaapAgentConversation | undefined;
    if (!conv?.pendingUserMessages?.length) {
        return;
    }
    // Only drain when the conversation can accept a new turn — 'idle' or 'failed'. If another
    // peer run is still streaming, the queue waits for that run to finish too.
    if (conv.status !== 'idle' && conv.status !== 'failed') {
        return;
    }
    // Optimization C: coalesce window. Defer the drain so messages arriving in quick
    // succession are batched together. The timer is per-conversation and cancelable.
    if (QAAP_COALESCE_WINDOW_MS > 0) {
        // Cancel any pending drain timer for this conversation.
        const existingTimer = ctx.drainTimers?.get(conversationId);
        if (existingTimer !== undefined) {
            clearTimeout(existingTimer);
        }
        if (!ctx.drainTimers) {
            ctx.drainTimers = new Map();
        }
        ctx.drainTimers.set(conversationId, setTimeout(() => {
            ctx.drainTimers?.delete(conversationId);
            drainPendingMessagesNow(ctx, conversationId);
        }, QAAP_COALESCE_WINDOW_MS));
        return;
    }
    drainPendingMessagesNow(ctx, conversationId);
}

/** Immediate drain — bypasses the coalesce window. Used after the timer fires. */
function drainPendingMessagesNow(ctx: any, conversationId: string): void {
    const conv = ctx.conversations.get(conversationId) as QaapAgentConversation | undefined;
    if (!conv?.pendingUserMessages?.length) {
        return;
    }
    if (conv.status !== 'idle' && conv.status !== 'failed') {
        return;
    }
    const batch = conv.pendingUserMessages.slice(0, QAAP_MAX_BATCH_SIZE);
    const remaining = conv.pendingUserMessages.slice(QAAP_MAX_BATCH_SIZE);
    // Clear the queue (or leave the overflow) before re-entering postUserMessage, which will
    // set status back to 'streaming' and could otherwise re-enqueue.
    const cleared: QaapAgentConversation = {
        ...conv,
        pendingUserMessages: remaining.length > 0 ? remaining : undefined,
    };
    ctx.conversations.set(conversationId, cleared);
    ctx.fire({
        type: 'pending-drained',
        conversationId,
        cwd: conv.cwd,
        drainedCount: batch.length,
    });
    ctx.fire({ type: 'updated', conversation: toConversationSummary(cleared) });

    if (batch.length === 1) {
        // Single message: process as a normal turn (no batch metadata needed).
        const msg = batch[0];
        ctx.postUserMessage(
            conversationId,
            msg.content,
            msg.turnAgentId,
            msg.turnAgentModel,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            msg.clientMessageId ? { clientMessageId: msg.clientMessageId } : undefined,
        );
    } else {
        // Multiple messages: batch into a single turn to save tokens.
        // Join with a visual separator so the agent sees them as distinct inputs.
        const mergedContent = batch.map(m => m.content).join('\n\n---\n\n');
        const batchedIds = batch.map(m => m.id);
        const first = batch[0];
        ctx.postUserMessage(
            conversationId,
            mergedContent,
            first.turnAgentId,
            first.turnAgentModel,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
                clientMessageId: first.clientMessageId,
                batchedFromMessageIds: batchedIds,
            },
        );
    }
}

/**
 * Cancel all active tasks for a conversation (delivery mode `'interrupt'`). The running agent
 * is stopped, in-flight tool segments are finalized, and the conversation status is set to
 * `'idle'` so the new message can be processed immediately.
 *
 * Inspired by Cursor "Stop & send" and Codex "Steer".
 */
export function interruptConversationRunsExtracted(ctx: any, conversationId: string): void {
    const conv = ctx.conversations.get(conversationId) as QaapAgentConversation | undefined;
    if (!conv) {
        return;
    }
    // Cancel every active task linked to this conversation.
    const activeTaskIds = ctx.getActiveTaskIdsForConversation(conversationId);
    for (const taskId of activeTaskIds) {
        try {
            ctx.taskRunner.cancel(taskId);
        } catch {
            // Task may have already exited — ignore.
        }
    }
    // Finalize any in-flight agent message segments so the transcript shows a clean stop.
    const messages = conv.messages.map(m => {
        if (m.role === 'agent' && m.runActive && m.segments) {
            return {
                ...m,
                runActive: false,
                segments: finalizeUnfinishedAgentToolSegments(m.segments, 'Interrupted by user.'),
            };
        }
        if (m.role === 'agent' && m.runActive) {
            return { ...m, runActive: false };
        }
        return m;
    });
    const next: QaapAgentConversation = {
        ...conv,
        messages,
        status: 'idle',
        updatedAt: Date.now(),
    };
    ctx.conversations.set(conversationId, next);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
}

/**
 * Remove a single queued message from the conversation's pending queue. Called when the user
 * clicks "Cancel" on a queued message row in the transcript.
 */
export function cancelQueuedMessageExtracted(ctx: any, conversationId: string, queuedMessageId: string): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(conversationId) as QaapAgentConversation | undefined;
    if (!conv?.pendingUserMessages?.length) {
        return conv;
    }
    const filtered = conv.pendingUserMessages.filter(m => m.id !== queuedMessageId);
    const next: QaapAgentConversation = {
        ...conv,
        pendingUserMessages: filtered.length > 0 ? filtered : undefined,
        updatedAt: Date.now(),
    };
    ctx.conversations.set(conversationId, next);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
    return next;
}

/**
 * Optimization A: inject queued follow-ups at tool-round boundaries (between tool
 * calls), not just at end of turn. Inspired by Claude Code's `drainPendingMessages()`.
 *
 * Called from `applyAgUiTranscriptEventExtracted` when a `TOOL_CALL_END` or
 * `TOOL_CALL_RESULT` event arrives. The follow-up is written to the live agent's
 * stream-json stdin so the next LLM round sees it. If stdin injection is unavailable
 * (Codex argv prompt, closed pipe, pending approval), the queue stays until the
 * end-of-turn drain.
 *
 * No coalesce delay here: the window is the gap between tools. Waiting
 * {@link QAAP_COALESCE_WINDOW_MS} would miss that round.
 */
export function maybeDrainAtToolRoundBoundaryExtracted(ctx: any, conversationId: string): void {
    const conv = ctx.conversations.get(conversationId) as QaapAgentConversation | undefined;
    if (!conv?.pendingUserMessages?.length) {
        return;
    }
    if (conv.status !== 'streaming') {
        return;
    }
    const activeTaskIds = ctx.getActiveTaskIdsForConversation(conversationId) as string[];
    if (activeTaskIds.length !== 1) {
        return;
    }
    const taskId = activeTaskIds[0];
    const batch = conv.pendingUserMessages.slice(0, QAAP_MAX_BATCH_SIZE);
    const remaining = conv.pendingUserMessages.slice(QAAP_MAX_BATCH_SIZE);
    const mergedContent = batch.length === 1
        ? batch[0].content
        : batch.map((message: QaapPendingUserMessage) => message.content).join('\n\n---\n\n');
    if (!ctx.taskRunner.injectStdioUserMessage(taskId, mergedContent)) {
        return;
    }
    const existingTimer = ctx.drainTimers?.get(conversationId);
    if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        ctx.drainTimers.delete(conversationId);
    }
    const first = batch[0];
    const userMessage: QaapAgentMessage = {
        id: batch.length === 1 ? first.id : randomUUID(),
        role: 'user',
        content: mergedContent,
        createdAt: Date.now(),
        taskId,
        ...(first.clientMessageId ? { clientMessageId: first.clientMessageId } : {}),
        ...(first.turnAgentId ? { turnAgentId: first.turnAgentId } : {}),
        ...(first.turnAgentModel ? { turnAgentModel: first.turnAgentModel } : {}),
        ...(batch.length > 1 ? { batchedFromMessageIds: batch.map((message: QaapPendingUserMessage) => message.id) } : {}),
    };
    const next: QaapAgentConversation = {
        ...conv,
        messages: [...conv.messages, userMessage],
        pendingUserMessages: remaining.length > 0 ? remaining : undefined,
        updatedAt: Date.now(),
    };
    ctx.conversations.set(conversationId, next);
    ctx.fire({
        type: 'pending-drained',
        conversationId,
        cwd: conv.cwd,
        drainedCount: batch.length,
    });
    ctx.fire({ type: 'message', conversationId, cwd: next.cwd, message: userMessage });
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
}

/**
 * Dispatch a queued message immediately instead of waiting for the agent to finish. The message
 * is removed from the queue and re-posted with the specified delivery mode (typically 'parallel'
 * to spawn a peer run, or 'interrupt' to stop the current agent). Called when the user clicks
 * "Send now" on a queued message row in the transcript.
 */
export function dispatchQueuedMessageExtracted(ctx: any, conversationId: string, queuedMessageId: string, deliveryMode: QaapMessageDeliveryMode): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(conversationId) as QaapAgentConversation | undefined;
    if (!conv?.pendingUserMessages?.length) {
        return conv;
    }
    const pending = conv.pendingUserMessages.find(m => m.id === queuedMessageId);
    if (!pending) {
        return conv;
    }
    // Remove from queue first so drainPendingMessages doesn't re-process it.
    const filtered = conv.pendingUserMessages.filter(m => m.id !== queuedMessageId);
    const cleared: QaapAgentConversation = {
        ...conv,
        pendingUserMessages: filtered.length > 0 ? filtered : undefined,
        updatedAt: Date.now(),
    };
    ctx.conversations.set(conversationId, cleared);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(cleared) });
    void ctx.persist();
    // Re-post the message with the requested delivery mode.
    return ctx.postUserMessage(
        conversationId,
        pending.content,
        pending.turnAgentId,
        pending.turnAgentModel,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        pending.clientMessageId ? { clientMessageId: pending.clientMessageId } : undefined,
        deliveryMode,
    );
}

export function postUserMessageExtracted(ctx: any, id: string,
    content: string,
    agentOverride?: string,
    agentModelOverride?: QaapCreateAgentTaskRequest['agentModel'],
    autoApproveOverride?: boolean,
    interactionModeId?: string,
    approvalPolicyId?: string,
    toolApprovalRules?: QaapCreateAgentConversationRequest['toolApprovalRules'],
    latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'],
    internal?: PostUserMessageInternalOptions,
    deliveryMode: QaapMessageDeliveryMode = QAAP_DEFAULT_DELIVERY_MODE,): QaapAgentConversation {
    let conv = ctx.conversations.get(id);
    if (!conv) {
        throw new Error('Conversation not found.');
    }
    if (internal?.clientMessageId) {
        // A queued submission is accepted before it becomes a transcript message. Include the
        // pending queue in the idempotency check so a retry cannot enqueue the same follow-up twice.
        const alreadyAccepted = conv.messages.some(message =>
            message.role === 'user' && message.clientMessageId === internal.clientMessageId
        ) || (conv.pendingUserMessages ?? []).some(message =>
            message.clientMessageId === internal.clientMessageId
        );
        if (alreadyAccepted) {
            return conv;
        }
    }
    if (conv.status === 'streaming') {
        const activeTaskIds = ctx.getActiveTaskIdsForConversation(id);
        if (activeTaskIds.length === 0) {
            // 'streaming' with no live run is a stale turn (backend restart, lost task):
            // recover to idle instead of refusing the message forever.
            conv = { ...conv, status: 'idle', updatedAt: Date.now() };
            ctx.conversations.set(id, conv);
            ctx.fire({ type: 'updated', conversation: toConversationSummary(conv) });
        } else {
            // An agent is running. Route based on the delivery mode:
            //
            // - 'queue' (default): enqueue the message. It will be drained when the agent
            //   finishes. Multiple queued messages may be batched into a single turn.
            //   Inspired by Cursor "Send after current message" and Claude Code
            //   `pendingMessages` (drained at tool-round boundaries).
            //
            // - 'parallel': the HTTP layer spawns a NEW conversation in an isolated
            //   worktree. If that isolation is not available, the store queues instead of
            //   writing a second agent into this working tree.
            //
            // - 'interrupt': cancel the running agent and process the new message
            //   immediately. Inspired by Cursor "Stop & send" and Codex "Steer".
            if (deliveryMode === 'interrupt') {
                ctx.interruptConversationRuns(id);
                conv = ctx.conversations.get(id);
                if (!conv || conv.status !== 'idle') {
                    // Interrupt didn't take effect (edge case) — fall back to queueing.
                    return ctx.enqueuePendingMessage(
                        conv ?? ctx.conversations.get(id)!,
                        {
                            id: randomUUID(),
                            role: 'user',
                            content,
                            createdAt: Date.now(),
                            ...(internal?.clientMessageId ? { clientMessageId: internal.clientMessageId } : {}),
                        },
                        ctx.resolveTurnAgent(conv!, content, agentOverride),
                        agentModelOverride && agentSupportsModelPicker(ctx.resolveTurnAgent(conv!, content, agentOverride))
                            ? agentModelOverride
                            : undefined,
                        internal?.clientMessageId,
                    );
                }
                // Status is now idle — fall through to normal processing below.
            } else if (deliveryMode === 'parallel') {
                // Isolated parallel is created by the HTTP layer (new conversation + worktree).
                // Reaching the store with `'parallel'` while a run is live means isolation was
                // unavailable (not a git repo, cap hit, tests) — queue instead of a same-tree
                // peer run. No IAD writes two agents into one working tree.
                return ctx.enqueuePendingMessage(
                    conv,
                    {
                        id: randomUUID(),
                        role: 'user',
                        content,
                        createdAt: Date.now(),
                        ...(internal?.clientMessageId ? { clientMessageId: internal.clientMessageId } : {}),
                    },
                    ctx.resolveTurnAgent(conv, content, agentOverride),
                    agentModelOverride && agentSupportsModelPicker(ctx.resolveTurnAgent(conv, content, agentOverride))
                        ? agentModelOverride
                        : undefined,
                    internal?.clientMessageId,
                );
            } else {
                // Default: 'queue' — enqueue the message, don't spawn a peer run.
                const turnAgentId = ctx.resolveTurnAgent(conv, content, agentOverride);
                const sealedTurnModel = agentModelOverride && agentSupportsModelPicker(turnAgentId)
                    ? agentModelOverride
                    : undefined;
                return ctx.enqueuePendingMessage(
                    conv,
                    {
                        id: randomUUID(),
                        role: 'user',
                        content,
                        createdAt: Date.now(),
                        ...(internal?.clientMessageId ? { clientMessageId: internal.clientMessageId } : {}),
                    },
                    turnAgentId,
                    sealedTurnModel,
                    internal?.clientMessageId,
                );
            }
        }
    }
    const turnAgentId = ctx.resolveTurnAgent(conv, content, agentOverride);
    const normalizedTurnAgentId = turnAgentId.trim().toLowerCase();
    const lastModelTurn = [...conv.messages].reverse().find(message =>
        message.role === 'user' && message.turnAgentModel && message.turnAgentId,
    );
    const conversationModelOwner = lastModelTurn?.turnAgentId?.trim().toLowerCase()
        ?? ((conv.agentModel ?? conv.qaiqModel) ? conv.agentId?.trim().toLowerCase() : undefined);
    const conversationModel = conv.agentModel ?? conv.qaiqModel;
    const shouldDropConversationModel = agentSupportsModelPicker(turnAgentId)
        && !!conversationModelOwner
        && conversationModelOwner !== normalizedTurnAgentId;
    const selectedModelPatch = agentModelOverride && agentSupportsModelPicker(turnAgentId)
        ? { agentModel: agentModelOverride, qaiqModel: agentModelOverride }
        : {};
    const modelPatch = Object.keys(selectedModelPatch).length > 0
        ? selectedModelPatch
        : shouldDropConversationModel
            ? { agentModel: undefined, qaiqModel: undefined }
            : {};
    // The model that will actually drive this turn. Resolved BEFORE the user message is built
    // so the very first SSE frame already carries the provenance the badge renders from:
    // sealing it after `taskRunner.create()` would ship an unsealed frame that the client's
    // replace-by-id merge (`QaapThreadStore.appendLiveMessage`) can never repair on its own.
    const turnModel = modelPatch.agentModel ?? (shouldDropConversationModel ? undefined : conversationModel);
    // Agents without a model picker (shell, native CLIs) run no model of ours — sealing one
    // would badge the turn with a model that never executed. Same guard as buildTaskCreateRequest.
    const sealedTurnModel = agentSupportsModelPicker(turnAgentId) ? turnModel : undefined;
    const userMessage: QaapAgentMessage = {
        id: randomUUID(),
        role: 'user',
        content,
        createdAt: Date.now(),
        ...(internal?.clientMessageId ? { clientMessageId: internal.clientMessageId } : {}),
        turnAgentId,
        ...(sealedTurnModel ? { turnAgentModel: sealedTurnModel } : {}),
        ...(internal?.autoContinueRootMessageId
            ? { autoContinueRootMessageId: internal.autoContinueRootMessageId }
            : {}),
        ...(internal?.visualRepair ? {
            visualRepairRootMessageId: internal.visualRepair.rootUserMessageId,
            visualRepairAttempt: internal.visualRepair.attempt,
            visualRepairSourceAgentMessageId: internal.visualRepair.sourceAgentMessageId,
        } : {}),
        ...(internal?.batchedFromMessageIds ? { batchedFromMessageIds: internal.batchedFromMessageIds } : {}),
    };
    const messages = [...conv.messages, userMessage];
    let next: QaapAgentConversation = {
        ...conv,
        ...patchConversationAutoApprove(conv, autoApproveOverride),
        agentId: turnAgentId,
        title: conv.messages.length === 0 ? ctx.deriveTitle(content) : conv.title,
        status: 'streaming',
        updatedAt: Date.now(),
        messages,
        // Posting a new turn implicitly resumes a paused chat.
        paused: undefined,
        ...modelPatch,
        ...(interactionModeId ? { interactionModeId } : {}),
        ...(approvalPolicyId ? { approvalPolicyId } : {}),
        ...(toolApprovalRules ? { toolApprovalRules } : {}),
    };
    ctx.conversations.set(id, next);
    ctx.fire({ type: 'message', conversationId: id, cwd: next.cwd, message: userMessage });
    ctx.recordSubmitLatencyMarks(id, latencyMarks);
    ctx.streamMetrics.recordLatencyMark(id, 'backend_user_message_persisted');
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    next = ctx.prepareContextCompactionForTurn(next);
    if (ctx.conversations.get(id) !== next) {
        ctx.conversations.set(id, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    }

    // Pre-spawn gate: models confirmed to lack function calling cannot drive the coding
    // agent — fail the turn typed instead of burning a doomed CLI run.
    if (agentSupportsModelPicker(turnAgentId) && qaiqModelSupportsToolCalls(turnModel?.modelId) === false) {
        return ctx.failTurnBeforeSpawn(id, next, userMessage.id, localizeAgentFailureMessage('tool_unsupported'));
    }
    let task: QaapAgentTask | undefined;
    try {
        if (next.ownerLogin && ctx.billingStore?.getOrCreateAccount) {
            void ctx.billingStore.getOrCreateAccount(next.ownerLogin).catch(() => undefined);
        }
        task = ctx.taskRunner.create(
            ctx.buildTaskCreateRequest(next, turnAgentId, latencyMarks, userMessage.id),
            next.ownerLogin,
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return ctx.failTurnBeforeSpawn(id, next, userMessage.id, message);
    }
    ctx.streamMetrics.recordLatencyMark(id, 'task_created');

    const messagesWithTask = next.messages.map(m => m.id === userMessage.id
        ? {
            ...m,
            taskId: task!.id,
            // `task.agentId` is only resolved asynchronously (spawnProcessWhenReady →
            // buildAgentCommand), so it is always undefined at this synchronous point today;
            // fall back to the id the store itself already resolved for this turn.
            turnAgentId: task!.agentId ?? turnAgentId,
            ...(sealedTurnModel ? { turnAgentModel: sealedTurnModel } : {}),
        }
        : m);
    next = { ...next, messages: messagesWithTask };
    const autoLinked = ctx.tryAutoLinkConversationToGitBranch(next);
    if (autoLinked) {
        next = autoLinked;
    }
    ctx.conversations.set(id, next);
    // Provenance already went out with the first frame; only a task runner that resolved its
    // own agent id synchronously (none does today) can make that frame stale. Re-emit then,
    // and only then, so the common path keeps its single user-message frame.
    const sealedUserMessage = messagesWithTask.find(m => m.id === userMessage.id);
    if (sealedUserMessage && sealedUserMessage.turnAgentId !== userMessage.turnAgentId) {
        ctx.fire({ type: 'message', conversationId: id, cwd: next.cwd, message: sealedUserMessage });
    }
    const startSha = ctx.captureGitSha(conv.cwd);
    ctx.taskToConversation.set(task.id, {
        conversationId: id,
        userMessageId: userMessage.id,
        turnAgentId: task.agentId ?? turnAgentId,
        startSha,
    });
    void ctx.persist();
    return next;
}

export function linkConversationsToPullRequestExtracted(ctx: any, input: QaapLinkConversationsByBranchRequest): number {
    const link: QaapLinkedPullRequest = {
        owner: input.owner,
        repo: input.repo,
        number: input.number,
        branch: input.branch,
        title: input.title,
    };
    let linked = 0;
    for (const [conversationId, conv] of ctx.conversations) {
        const existing = conv.linkedPullRequest;
        if (existing
            && existing.number === link.number
            && existing.owner.toLowerCase() === link.owner.toLowerCase()
            && existing.repo.toLowerCase() === link.repo.toLowerCase()) {
            continue;
        }
        if (!ctx.cwdMatchesGithubRepo(conv.cwd, link.owner, link.repo)) {
            continue;
        }
        const head = ctx.readGitBranch(conv.cwd);
        if (head && head !== link.branch) {
            continue;
        }
        const next: QaapAgentConversation = {
            ...conv,
            linkedPullRequest: link,
            updatedAt: Date.now(),
        };
        ctx.conversations.set(conversationId, next);
        ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
        linked++;
    }
    if (linked > 0) {
        void ctx.persist();
    }
    return linked;
}

export function retryExtracted(ctx: any, id: string): QaapAgentConversation {
    const conv = ctx.conversations.get(id);
    if (!conv) {
        throw new Error('Conversation not found.');
    }
    if (conv.status === 'streaming') {
        throw new Error('A turn is already in progress for this conversation.');
    }
    // Prefer the last user message explicitly marked as failed. Older persisted conversations
    // can have status `failed` without the per-message error annotation, so fall back to the
    // last user turn when the conversation itself is failed.
    let failedIndex = conv.messages.reduce<number>((last, m, i) => m.role === 'user' && m.error ? i : last, -1);
    if (failedIndex < 0 && conv.status === 'failed') {
        failedIndex = conv.messages.reduce<number>((last, m, i) => m.role === 'user' ? i : last, -1);
    }
    if (failedIndex < 0) {
        throw new Error('No failed message to retry.');
    }
    const failedMessage = conv.messages[failedIndex];
    // Trim back to just before the failed turn (also removes any partial agent reply that followed)
    const trimmed: QaapAgentConversation = {
        ...conv,
        status: 'idle',
        messages: conv.messages.slice(0, failedIndex),
        updatedAt: Date.now(),
    };
    ctx.conversations.set(id, trimmed);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(trimmed) });
    return ctx.postUserMessage(id, failedMessage.content);
}

export function cancelExtracted(ctx: any, id: string): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(id);
    if (!conv) {
        return undefined;
    }
    // Stop is session-wide: with in-session multitasking there can be several runs streaming
    // at once, and cancelling only the newest would leave the others working behind a UI that
    // says the session is idle. Every live run is cancelled and every open agent message
    // finalized; the last-user-message fallback keeps pre-multitasking conversations working.
    const activeRefs = ctx.getActiveTaskIdsForConversation(id)
        .map(taskId => ({ taskId, ref: ctx.taskToConversation.get(taskId) }));
    const lastUser = [...conv.messages].reverse().find(m => m.role === 'user' && m.taskId);
    const cancelTaskIds = activeRefs.length > 0
        ? activeRefs.map(entry => entry.taskId)
        : (lastUser?.taskId ? [lastUser.taskId] : []);
    for (const taskId of cancelTaskIds) {
        ctx.taskRunner.cancel(taskId);
        for (const subtask of collectSubtasksForLeader(taskId, ctx.taskRunner.list())) {
            // Queued children must die with Stop All too — otherwise they start
            // after the leader was cancelled and the Working pill comes back.
            if (subtask.state === 'running' || subtask.state === 'queued') {
                ctx.taskRunner.cancel(subtask.id);
            }
        }
    }
    const fallbackAgentMessageId = conv.messages[conv.messages.length - 1]?.role === 'agent'
        ? conv.messages[conv.messages.length - 1].id
        : undefined;
    const agentMessageIds = activeRefs.length > 0
        ? activeRefs.map(entry => entry.ref?.agentMessageId).filter((value): value is string => !!value)
        : [];
    if (agentMessageIds.length === 0 && fallbackAgentMessageId) {
        agentMessageIds.push(fallbackAgentMessageId);
    }
    let next = conv;
    for (const messageId of agentMessageIds) {
        next = ctx.appendRunCancelledTrace(next, messageId, 'Turn cancelled.');
        next = ctx.finalizeStreamingAgentMessage(next, messageId, 'Turn cancelled.');
    }
    next = { ...next, status: 'idle', updatedAt: Date.now() };
    ctx.conversations.set(id, next);
    for (const messageId of agentMessageIds) {
        ctx.publishFinalizedAgentMessage(id, next, messageId);
    }
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    void ctx.persist();
    return next;
}
