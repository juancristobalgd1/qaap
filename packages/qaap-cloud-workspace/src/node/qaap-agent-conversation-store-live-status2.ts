// @ts-nocheck
// Extracted from qaap-agent-conversation-store.ts

import { Emitter, Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { randomUUID } from 'crypto';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { sweepOrphanedTempFiles, writeJsonAtomic } from './qaap-write-json-atomic';
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

export function buildPromptExtracted(ctx: any, conv: QaapAgentConversation, turnAgentId = conv.agentId): string {
    const lastUser = conv.messages[conv.messages.length - 1];
    const skipDelegation = isTeamSynthesisUserMessage(lastUser.content);
    const compaction = conv.contextCompaction?.status === 'complete' && conv.contextCompaction.summary?.trim()
        ? conv.contextCompaction
        : undefined;
    const historyStart = compaction?.compactedMessageCount ?? 0;
    const history = conv.messages.slice(historyStart, -1);
    const latestUser = ctx.stripLeadingAgentMention(lastUser.content);
    if (history.length === 0) {
        const prompt = compaction
            ? `${ctx.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)}\n\nNow respond to the latest user message:\n\nUSER: ${latestUser}`
            : latestUser;
        return skipDelegation ? prompt : ctx.appendTeamDelegation(prompt, turnAgentId);
    }
    const transcript = buildConversationAgentPrompt({
        history,
        latestUserContent: latestUser,
        contextPreamble: compaction
            ? ctx.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)
            : conv.contextPreamble,
        contextWindowSize: conv.contextWindowSize,
    });
    return skipDelegation ? transcript : ctx.appendTeamDelegation(transcript, turnAgentId);
}

export function resolveRunAgentMessageIdExtracted(ctx: any, conv: QaapAgentConversation,
    run: { readonly userMessageId: string; readonly agentMessageId?: string },): string | undefined {
    return resolveRunAgentMessageIdHelper(conv, run);
}

export function applyAgUiTranscriptEventExtracted(ctx: any, conversationId: string,
    event: QaapAgUiEvent,
    /** Mutated in place: an agent message created here is written back onto the run's ref. */
    run?: { readonly userMessageId: string; readonly turnAgentId?: string; agentMessageId?: string },): QaapAgentConversation | undefined {
    const conv = ctx.conversations.get(conversationId);
    if (!conv) {
        return undefined;
    }
    const now = Date.now();
    let agentMessageId = run
        ? ctx.resolveRunAgentMessageId(conv, run)
        : conv.messages[conv.messages.length - 1]?.role === 'agent'
            ? conv.messages[conv.messages.length - 1].id
            : undefined;
    let messages = conv.messages;
    if (!agentMessageId) {
        agentMessageId = randomUUID();
        const seed: QaapAgentMessage = {
            id: agentMessageId,
            role: 'agent',
            content: '',
            traceEvents: [],
            createdAt: now,
            ...(run ? { runUserMessageId: run.userMessageId } : {}),
        };
        messages = [...conv.messages, seed];
        if (run) {
            run.agentMessageId = agentMessageId;
        }
        ctx.agUiReducerByAgentMessageId.delete(agentMessageId);
    }
    const previousReducer = ctx.agUiReducerByAgentMessageId.get(agentMessageId);
    const previousMessage = messages.find(message => message.id === agentMessageId);
    const agentId = run?.turnAgentId
        ?? (previousMessage ? ctx.resolveAgentIdForAgentMessage(conv, previousMessage) : conv.agentId);
    const { next: reducer } = reduceQaapAgUiTranscriptEvent(previousReducer, event, {
        agentMessageId,
        createdAt: previousMessage?.createdAt ?? now,
        agentId,
    });
    ctx.agUiReducerByAgentMessageId.set(agentMessageId, reducer);
    const rebuilt = buildAgentMessageFromQaapAgUiReducer(
        reducer,
        previousMessage?.createdAt ?? now,
    );
    // The reducer only knows the trace, so it rebuilds the message from scratch every tick.
    // Which run owns the message, and whether that run is still live, are not part of that
    // trace — carry both across, or they would survive exactly until the next event arrived.
    // `runActive` is carried, never re-asserted: once the turn settles and clears it, a late
    // event must not resurrect the marker.
    const runOwner = previousMessage?.runUserMessageId ?? run?.userMessageId;
    const agentMessage: QaapAgentMessage = {
        ...rebuilt,
        ...(runOwner ? { runUserMessageId: runOwner } : {}),
        ...(previousMessage?.runActive ? { runActive: true } : {}),
        ...(previousMessage?.runFinishedAt !== undefined ? { runFinishedAt: previousMessage.runFinishedAt } : {}),
    };
    messages = messages.map(message => message.id === agentMessageId ? agentMessage : message);
    const next: QaapAgentConversation = {
        ...conv,
        status: 'streaming',
        updatedAt: now,
        messages,
        ...(totalTokensFromContextUsage(conv.contextUsage) === 0 ? { contextUsageEstimated: true } : {}),
        contextWindowSize: conv.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
    };
    ctx.conversations.set(conversationId, next);
    ctx.fireAgentMessageWireUpdate(conversationId, next.cwd, agentId, agentMessage);
    ctx.fire({ type: 'updated', conversation: toConversationSummary(next) });
    ctx.schedulePersist();
    // Optimization A: drain queued messages at tool-round boundaries. When a tool
    // call completes (TOOL_CALL_END or TOOL_CALL_RESULT), inject pending follow-ups
    // into the live stream-json agent so the next LLM round sees them.
    if (event.type === 'TOOL_CALL_END' || event.type === 'TOOL_CALL_RESULT') {
        ctx.maybeDrainAtToolRoundBoundary(conversationId);
    }
    return next;
}

export function clearAgUiReducerExtracted(ctx: any, agentMessageId: string | undefined): void {
    if (agentMessageId) {
        ctx.agUiReducerByAgentMessageId.delete(agentMessageId);
    }
}

export function stageWireMetricsBaselineExtracted(ctx: any, conversationId: string,
    messageId: string,
    baseline: QaapAgentConversationEvent,): void {
    ctx.wireMetricsBaselines.set(`${conversationId}:${messageId}`, baseline);
}

export function recordStreamMetricsExtracted(ctx: any, event: QaapAgentConversationEvent): void {
    const conversationId = event.type === 'message' || event.type === 'message_delta'
        ? event.conversationId
        : event.type === 'updated' || event.type === 'created'
            ? event.conversation.id
            : undefined;
    if (!conversationId) {
        return;
    }
    const baselineKey = event.type === 'message_delta'
        ? `${event.conversationId}:${event.messageId}`
        : event.type === 'message'
            ? `${event.conversationId}:${event.message.id}`
            : undefined;
    const baseline = baselineKey ? ctx.wireMetricsBaselines.get(baselineKey) : undefined;
    if (baselineKey) {
        ctx.wireMetricsBaselines.delete(baselineKey);
    }
    ctx.streamMetrics.recordWireEvent(conversationId, event.type, event, {
        uncompressedPayload: baseline,
        compressedFieldCount: countCompressedWireFields(event),
    });
    if (event.type === 'updated' && event.conversation.status !== 'streaming') {
        logQaapStreamMetrics(ctx.streamMetrics.finishTurn(conversationId));
    }
}

export function fireAgentMessageWireUpdateExtracted(ctx: any, conversationId: string,
    cwd: string,
    agentId: string,
    message: QaapAgentMessage,
    options?: { forceFullMessage?: boolean },): void {
    fireAgentMessageWireUpdateHelper(conversationId, cwd, agentId, message, options, {
        lastWireMessageById: ctx.lastWireMessageById,
        stageWireMetricsBaseline: (cid, mid, evt) => ctx.stageWireMetricsBaseline(cid, mid, evt),
        fire: e => ctx.fire(e),
    });
}

export function schedulePersistExtracted(ctx: any): void {
    if (ctx.persistTimer !== undefined) {
        return;
    }
    ctx.persistTimer = setTimeout(() => {
        ctx.persistTimer = undefined;
        void ctx.persist();
    }, STREAMING_PERSIST_DEBOUNCE_MS);
}

export function flushPersistExtracted(ctx: any): void {
    if (ctx.persistTimer !== undefined) {
        clearTimeout(ctx.persistTimer);
        ctx.persistTimer = undefined;
    }
    void ctx.persist();
}

export function tryAutoLinkConversationToGitBranchExtracted(ctx: any, conv: QaapAgentConversation): QaapAgentConversation | undefined {
    if (conv.linkedPullRequest?.number) {
        return undefined;
    }
    const repo = ctx.parseGithubRepoFromCwd(conv.cwd);
    const branch = ctx.readGitBranch(conv.cwd);
    if (!repo || !branch) {
        return undefined;
    }
    const link: QaapLinkedPullRequest = {
        ...conv.linkedPullRequest,
        owner: repo.owner,
        repo: repo.name,
        branch,
    };
    if (conv.linkedPullRequest
        && conv.linkedPullRequest.owner === link.owner
        && conv.linkedPullRequest.repo === link.repo
        && conv.linkedPullRequest.branch === link.branch) {
        return undefined;
    }
    return { ...conv, linkedPullRequest: link, updatedAt: Date.now() };
}

export function cwdMatchesGithubRepoExtracted(ctx: any, cwd: string, owner: string, repo: string): boolean {
    const parsed = ctx.parseGithubRepoFromCwd(cwd);
    if (!parsed) {
        return false;
    }
    return parsed.owner.toLowerCase() === owner.toLowerCase()
        && parsed.name.toLowerCase() === repo.toLowerCase();
}

/** Runs one restore phase without allowing a corrupt conversation to abort the remaining set. */
export async function runQaapConversationRestoreStep<T extends { readonly id: string }>(
    conversations: Iterable<T>,
    phase: string,
    step: (conversation: T) => Promise<boolean>,
): Promise<boolean> {
    let changedAny = false;
    for (const conversation of conversations) {
        try {
            changedAny = await step(conversation) || changedAny;
        } catch (error) {
            console.warn(`[qaap-conversation-store] ${phase} failed for ${conversation.id}:`, error);
        }
    }
    return changedAny;
}

export async function restoreFromDiskExtracted(ctx: any): Promise<void> {
    // Sweep orphaned .tmp files left by previous (crashed/killed) backend processes before
    // reading the index. Without this, temp files from dead PIDs accumulate unboundedly
    // (observed: 90 GB across 1600+ files). See sweepOrphanedTempFiles in qaap-write-json-atomic.
    await sweepOrphanedTempFiles(INDEX_PATH).catch(() => undefined);
    try {
        const raw = await fsp.readFile(INDEX_PATH, 'utf8');
        const stored = JSON.parse(raw) as QaapAgentConversation[];
        let anyChanged = false;
        for (const conv of stored) {
            // Leave a persisted 'streaming' status as-is here — sweepZombieStreamingTurns below
            // (run once every restart, after every conversation is loaded) force-stops any turn
            // that already exceeded the max duration with a proper failed/error trace. A restart
            // always drops the live task handle, so a turn still within budget can never complete
            // on its own either; that case is finalized as interrupted (also with a visible trace)
            // via interruptStreamingTurnForRestart rather than silently reset to 'idle'.
            const { conversation, changed } = backfillConversationTraceEvents(conv);
            ctx.conversations.set(conversation.id, conversation);
            if (changed) {
                anyChanged = true;
            }
        }
        const now = Date.now();
        // First try to auto-resume turns the restart interrupted (bounded, persisted counter).
        // A turn that resumes gets a live task, so the sweep below skips it (getActiveTaskIds guard).
        const resumedAny = await runQaapConversationRestoreStep(
            [...ctx.conversations.values()] as QaapAgentConversation[],
            'restart resume',
            async conv => conv.status === 'streaming' && ctx.maybeAutoResumeInterruptedTurn(conv.id, now),
        );
        const sweptAny = ctx.sweepZombieStreamingTurns(now, { resetSurvivorsToIdle: true });
        // Evidence is persisted before its repair process is spawned. A hard kill in that
        // narrow gap therefore leaves an idle tail with `[QAAP repair required]`; resume it
        // here through the same idempotent loop instead of silently abandoning the result.
        const visualRepairResumedAny = await runQaapConversationRestoreStep(
            [...ctx.conversations.values()] as QaapAgentConversation[],
            'visual repair resume',
            async conv => {
                const last = conv.messages[conv.messages.length - 1];
                if (conv.status !== 'idle' || last?.role !== 'agent'
                    || !last.content.includes(QAAP_VISUAL_REPAIR_REQUIRED_MARKER)) {
                    return false;
                }
                const before = ctx.conversations.get(conv.id);
                const after = await ctx.continueVisualRepairLoop(conv.id, last.id);
                return after !== before;
            },
        );
        if (ctx.isTurnGraphEnabled()) {
            // After resume and sweep have settled every conversation's fate, close graph runs
            // whose turn is no longer live (lost terminal report, deleted conversation).
            await ctx.reapOrphanedChatTurnRuns().catch((error: unknown) => {
                console.warn('[qaap-conversation-store] orphaned graph-run reap failed:', error);
            });
        }
        if (anyChanged || resumedAny || sweptAny || visualRepairResumedAny) {
            await ctx.persist();
        }
    } catch {
        /* no prior conversations */
    }
}

export function startTurnWatchdogExtracted(ctx: any): void {
    if (ctx.turnWatchdogTimer !== undefined) {
        return;
    }
    ctx.turnWatchdogTimer = setInterval(() => {
        ctx.sweepZombieStreamingTurns(Date.now());
    }, TURN_WATCHDOG_SWEEP_MS);
    ctx.turnWatchdogTimer.unref?.();
}

export function sweepZombieStreamingTurnsExtracted(ctx: any, nowMs: number, options?: { readonly resetSurvivorsToIdle?: boolean }): boolean {
    return sweepZombieStreamingTurnsHelper(nowMs, options, {
        conversations: ctx.conversations,
        turnHasPendingApproval: c => ctx.turnHasPendingApproval(c),
        forceStopZombieTurn: (id, elapsed, max) => ctx.forceStopZombieTurn(id, elapsed, max),
        getActiveTaskIdsForConversation: id => ctx.getActiveTaskIdsForConversation(id),
        interruptStreamingTurnForRestart: (id, t) => ctx.interruptStreamingTurnForRestart(id, t),
        flushPersist: () => ctx.flushPersist(),
    });
}

export function forceStopZombieTurnExtracted(ctx: any, conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean {
    return forceStopZombieTurnHelper(conversationId, elapsedMs, maxTurnMinutes, {
        conversations: ctx.conversations,
        taskToConversation: ctx.taskToConversation,
        taskRunner: ctx.taskRunner,
        appendRunCancelledTrace: (c, aid, r) => ctx.appendRunCancelledTrace(c, aid, r),
        finalizeStreamingAgentMessage: (c, aid, r) => ctx.finalizeStreamingAgentMessage(c, aid, r),
        markTurnFailed: (c, info) => ctx.markTurnFailed(c, info),
        publishFinalizedAgentMessage: (id, c, aid) => ctx.publishFinalizedAgentMessage(id, c, aid),
        fire: e => ctx.fire(e),
    });
}

export async function maybeAutoResumeInterruptedTurnExtracted(ctx: any, conversationId: string, nowMs: number): Promise<boolean> {
    if (!QAAP_AUTO_RESUME_TURNS_ENABLED || MAX_RESTART_RESUMES <= 0) {
        return false;
    }
    const conv = ctx.conversations.get(conversationId);
    if (!conv || conv.status !== 'streaming') {
        return false;
    }
    // A turn deliberately paused on a human decision (plan/ask mode, request-approval /
    // manual-approve) must NOT be relaunched as an autonomous run — that would execute the very
    // tool the user was about to approve or reject. Same guard as maybeAutoContinueIncompleteTurn.
    if (!autoContinueAllowedForInteraction(conv)) {
        return false;
    }
    const turnUserMessage = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId)
        ?? [...conv.messages].reverse().find(message => message.role === 'user');
    const turnAgentId = turnUserMessage?.turnAgentId ?? conv.agentId;
    if (!turnUserMessage || !turnAgentId) {
        return false;
    }
    const userMessageId = turnUserMessage.id;
    // Charge the counter to the human-authored root so an auto-continue chain shares one budget.
    const rootUserMessageId = ctx.resolveLoopBudgetKey(conv, userMessageId);
    const rootUserMessage = conv.messages.find(message => message.id === rootUserMessageId && message.role === 'user')
        ?? turnUserMessage;
    if ((rootUserMessage.restartResumeCount ?? 0) >= MAX_RESTART_RESUMES) {
        return false;
    }
    if (ctx.isTurnGraphEnabled() && ctx.workflowRuns) {
        return ctx.resumeInterruptedTurnViaGraph(conv, turnUserMessage, rootUserMessage, turnAgentId, nowMs);
    }
    const nextResumeCount = (rootUserMessage.restartResumeCount ?? 0) + 1;
    const lastMessage = conv.messages[conv.messages.length - 1];
    const agentMessageId = lastMessage?.role === 'agent' ? lastMessage.id : undefined;
    // Drop the orphaned partial agent output (the CLI is stateless; context is rebuilt from the
    // conversation), clear the dead task link, and stamp the incremented resume counter.
    const messages = conv.messages
        .filter(message => message.id !== agentMessageId)
        .map(message => {
            let next = message;
            if (message.id === userMessageId) {
                next = { ...next, error: undefined, taskId: undefined };
            }
            if (message.id === rootUserMessageId) {
                next = { ...next, restartResumeCount: nextResumeCount };
            }
            return next;
        });
    const resumeConv: QaapAgentConversation = { ...conv, status: 'streaming', updatedAt: nowMs, messages };
    // Persist the incremented counter BEFORE spawning. persist() is best-effort/async, so if we
    // spawned first and the container were OOM-killed again before the counter reached disk, the
    // next boot would read the stale lower count and resume forever. Awaiting the flush here makes
    // progress monotonic under a hard kill: each turn resumes at most MAX_RESTART_RESUMES times
    // across ALL restarts.
    ctx.conversations.set(conversationId, resumeConv);
    await ctx.persist();
    let spawned: QaapAgentTask;
    try {
        spawned = ctx.taskRunner.create(
            ctx.buildTaskCreateRequest(resumeConv, turnAgentId, undefined, userMessageId),
            resumeConv.ownerLogin,
        );
    } catch {
        // cwd gone / runner refused: degrade to the manual "Retry to continue" flow. The counter
        // is already persisted, so this turn will not be retried automatically again.
        ctx.interruptStreamingTurnForRestart(conversationId, nowMs);
        return true;
    }
    const messagesWithTask = resumeConv.messages.map(message => message.id === userMessageId
        ? { ...message, taskId: spawned.id, turnAgentId: spawned.agentId ?? turnAgentId }
        : message);
    const nextConv = { ...resumeConv, messages: messagesWithTask };
    ctx.conversations.set(conversationId, nextConv);
    ctx.taskToConversation.set(spawned.id, {
        conversationId,
        userMessageId,
        turnAgentId: spawned.agentId ?? turnAgentId,
    });
    ctx.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
    void ctx.persist();
    console.warn(
        `[qaap-agent-conversation-resume] auto-resumed conversation ${conversationId} after restart `
        + `(attempt ${nextResumeCount}/${MAX_RESTART_RESUMES}).`,
    );
    return true;
}
