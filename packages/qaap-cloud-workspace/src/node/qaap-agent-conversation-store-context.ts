// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `QaapAgentConversationStore` and the `*Extracted` free functions in
// the `qaap-agent-conversation-store-{diff2,live-status2,render2,activity2,streaming2,timeline2,
// tool-pills2,thought-brief2}.ts` cluster. Each extracted function receives `this` (the store) typed
// as `QaapAgentConversationStoreContext` instead of `any`. Only members actually referenced through
// `ctx.` across that cluster are listed here — see `qaap-agent-conversation-store.ts`, which
// `implements` this interface, for the real implementation and documentation of each member.
//
// `import type` throughout to avoid a runtime import cycle with the extracted modules (several of
// which are imported back into `qaap-agent-conversation-store.ts`).

import type { Emitter } from '@theia/core/lib/common/event';
import type { SpawnSyncReturns } from 'child_process';
import type { QaapSqliteStore } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import type {
    QaapAgentConversation,
    QaapAgentConversationEvent,
    QaapAgentConversationStatus,
    QaapAgentMessage,
    QaapConversationCheckpoint,
    QaapCreateAgentConversationRequest,
} from '../common/qaap-agent-conversation';
import type { QaapAgentStreamAccumulator } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import type { QaapCliAgUiStreamEmitter } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-ag-ui-stream';
import type { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import type { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';
import type { QaapAgentTask, QaapAgentTaskEvent, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapBillingStore } from './qaap-billing-store';
import type { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import type { QaapObservability } from './qaap-observability';
import type { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import type { QaapConversationStreamMetricsCollector } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import type { QaapAgentMessageWireSnapshot } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-wire-delta';
import type {
    QaapAgUiEvent,
    QaapAgUiTraceReducerState,
} from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';
import type { QaapConversationTaskRef } from './qaap-agent-conversation-store-constants';

/**
 * Members of {@link QaapAgentConversationStore} that the `*Extracted` helper functions access via
 * `ctx.`. This interface is the seam between the class and the free functions it delegates to —
 * see `doc/coding-guidelines.md` for why the store prefers property injection / delegated helper
 * functions over one monolithic class body.
 */
export interface QaapAgentConversationStoreContext {

    // ─── Injected services ──────────────────────────────────────────────────
    readonly taskRunner: QaapAgentTaskRunner;
    readonly billingStore: QaapBillingStore | undefined;
    readonly observability: QaapObservability | undefined;
    readonly tenantSpawn: QaapTenantSpawnService;
    readonly workflowRuns: QaapWorkflowRunStore | undefined;

    // ─── State maps / sets ──────────────────────────────────────────────────
    readonly conversations: Map<string, QaapAgentConversation>;
    readonly chatTurnRunByTask: Map<string, { runId: string; ownerLogin?: string; nodeId: string }>;
    readonly visualVerificationInFlight: Set<string>;
    readonly taskToConversation: Map<string, QaapConversationTaskRef>;
    readonly subtaskMailboxDelivered: Set<string>;
    readonly teamSynthesisTriggeredForLeader: Set<string>;
    readonly pendingTeamSynthesisForLeader: Set<string>;
    readonly modelFallbackTriedByUserMessage: Map<string, Set<string>>;
    readonly loopSpawnCountByUserMessage: Map<string, number>;
    readonly agentStreamByTaskId: Map<string, QaapAgentStreamAccumulator>;
    readonly agUiStreamByTaskId: Map<string, QaapCliAgUiStreamEmitter>;
    readonly lastWireMessageById: Map<string, QaapAgentMessageWireSnapshot>;
    readonly agUiReducerByAgentMessageId: Map<string, QaapAgUiTraceReducerState>;
    readonly wireMetricsBaselines: Map<string, QaapAgentConversationEvent>;
    readonly streamMetrics: QaapConversationStreamMetricsCollector;
    readonly onDidChangeEmitter: Emitter<QaapAgentConversationEvent>;

    drainTimers: Map<string, ReturnType<typeof setTimeout>>;
    restoreReady: Promise<void>;
    sseBatcher: QaapAgentConversationSseBatcher;
    persistTimer: ReturnType<typeof setTimeout> | undefined;
    sqliteStore: QaapSqliteStore | undefined;
    turnWatchdogTimer: ReturnType<typeof setInterval> | undefined;
    persistFailureLoggedAtMs: number;
    persistChain: Promise<void>;

    // ─── Persistence / lifecycle ────────────────────────────────────────────
    persist(): Promise<void>;
    getSqliteStore(): QaapSqliteStore;
    schedulePersist(): void;
    flushPersist(): void;
    restoreFromDisk(): Promise<void>;
    startTurnWatchdog(): void;
    reapOrphanedChatTurnRuns(): Promise<void>;

    // ─── Conversation lookups / mutation ────────────────────────────────────
    drainPendingMessages(conversationId: string): void;
    enqueuePendingMessage(
        conv: QaapAgentConversation,
        userMessage: QaapAgentMessage,
        turnAgentId?: string,
        sealedTurnModel?: QaapCreateAgentTaskRequest['agentModel'],
        clientMessageId?: string,
    ): QaapAgentConversation;
    maybeDrainAtToolRoundBoundary(conversationId: string): void;
    interruptConversationRuns(conversationId: string): void;
    getActiveTaskIdsForConversation(conversationId: string): string[];
    hasOtherActiveTaskForConversation(conversationId: string, exceptTaskId: string): boolean;
    hasActiveTaskForUserMessage(conversationId: string, userMessageId: string, exceptTaskId: string): boolean;
    settleStatusForRun(
        conversationId: string,
        finishedTaskId: string,
        settled: QaapAgentConversationStatus,
    ): QaapAgentConversationStatus;
    postUserMessage(
        id: string,
        content: string,
        agentOverride?: string,
        agentModelOverride?: QaapCreateAgentTaskRequest['agentModel'],
        autoApproveOverride?: boolean,
        interactionModeId?: string,
        approvalPolicyId?: string,
        toolApprovalRules?: QaapCreateAgentConversationRequest['toolApprovalRules'],
        latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'],
        internal?: import('./qaap-agent-conversation-store-constants').PostUserMessageInternalOptions,
        deliveryMode?: import('../common/qaap-agent-conversation').QaapMessageDeliveryMode,
    ): QaapAgentConversation;
    applyAgUiTranscriptEvent(
        conversationId: string,
        event: QaapAgUiEvent,
        run?: { readonly userMessageId: string; readonly turnAgentId?: string; agentMessageId?: string },
    ): QaapAgentConversation | undefined;
    reportPreviewBootstrapFailure(conversationId: string, reason: string): QaapAgentConversation | undefined;

    // ─── Visual verification / repair loop ──────────────────────────────────
    visualEvidenceDirectory(conversationId: string): string;
    resolveVisualEvidenceTarget(
        conv: QaapAgentConversation,
        targetAgentMessageId: string | undefined,
    ): QaapAgentMessage | undefined;
    attachVisualVerificationBlock(
        conv: QaapAgentConversation,
        target: QaapAgentMessage,
        markdown: string,
    ): QaapAgentConversation;
    resolveVisualRepairSourceUserMessage(
        conv: QaapAgentConversation,
        target: QaapAgentMessage,
    ): QaapAgentMessage | undefined;
    countVisualRepairAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number;
    buildVisualRepairPrompt(target: QaapAgentMessage, attempt: number): string;
    failVisualRepairLoop(
        conv: QaapAgentConversation,
        sourceUserMessage: QaapAgentMessage,
        target: QaapAgentMessage,
        reason: string,
    ): Promise<QaapAgentConversation>;
    continueVisualRepairLoop(
        conversationId: string,
        sourceAgentMessageId: string,
    ): Promise<QaapAgentConversation | undefined>;
    sweepUnreferencedVisualEvidence(conversationId: string): Promise<void>;

    // ─── Task lifecycle / structured output ─────────────────────────────────
    onTaskChanged(event: QaapAgentTaskEvent): void;
    recordTaskLatencyMarks(conversationId: string, task: QaapAgentTask): void;
    recordSubmitLatencyMarks(
        conversationId: string,
        latencyMarks: QaapCreateAgentConversationRequest['latencyMarks'] | undefined,
    ): void;
    deliverSubtaskMailbox(task: QaapAgentTask): Promise<void>;
    resolveLeaderTaskId(task: QaapAgentTask): string | undefined;
    findConversationIdForLeaderTask(leaderTaskId: string): string | undefined;
    findTaskById(id: string): QaapAgentTask | undefined;
    maybeTriggerTeamSynthesis(leaderTaskId: string, conversationId: string): void;
    finishLeaderTurnAndMaybeSynthesize(conversationId: string, leaderTaskId: string, next: QaapAgentConversation): void;
    applyTaskOutput(taskId: string, ref: QaapConversationTaskRef, chunk: string): void;
    applyAgUiTaskOutput(taskId: string, ref: QaapConversationTaskRef, chunk: string, agentId: string): void;
    finalizeTurnContextUsage(conv: QaapAgentConversation, taskId: string, agentId: string): QaapAgentConversation;
    ensureAgentStream(taskId: string, agentId: string): QaapAgentStreamAccumulator | undefined;
    ensureAgUiStream(taskId: string, agentId: string): QaapCliAgUiStreamEmitter;
    parseStructuredLog(agentId: string, log: string): {
        content: string;
        segments: QaapAgentMessage['segments'];
        traceEvents: QaapAgentMessage['traceEvents'];
    } | undefined;
    applyAccumulatorStructuredOutput(taskId: string, ref: QaapConversationTaskRef, agentId: string): void;
    backfillAgentMessageFromStructuredLog(message: QaapAgentMessage, agentId: string, log: string): QaapAgentMessage;
    resolveStructuredParsedTraceEvents(
        message: QaapAgentMessage,
        parsed: { segments?: QaapAgentMessage['segments']; traceEvents?: QaapAgentMessage['traceEvents'] },
    ): QaapAgentMessage['traceEvents'];
    applyTaskOutcome(ref: QaapConversationTaskRef, task: QaapAgentTask): Promise<QaapWorkflowNodeOutcome>;

    // ─── Auto-continue / model-fallback loop budget ─────────────────────────
    hasLoopSpawnBudget(userMessageId: string): boolean;
    recordLoopSpawn(userMessageId: string): void;
    resolveLoopBudgetKey(conv: QaapAgentConversation, userMessageId: string): string;
    countAutoContinueAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number;
    maybeRetryTurnWithFallback(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,
    ): Promise<boolean>;
    maybeRetryTurnWithFallbackModel(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,
    ): boolean;
    postAutoContinueMessage(
        conversationId: string,
        content: string,
        conv: QaapAgentConversation,
        rootUserMessageId: string,
        turnAgentId: string,
        turnAgentModel: QaapAgentMessage['turnAgentModel'],
    ): QaapAgentConversation;
    maybeAutoContinueIncompleteTurn(
        conversationId: string,
        conv: QaapAgentConversation,
        userMessageId: string,
        agentMessageId?: string,
        turnAgentId?: string,
    ): void;

    // ─── Turn finalization / failure handling ───────────────────────────────
    appendAgentReply(conv: QaapAgentConversation, content: string, runUserMessageId?: string): QaapAgentConversation;
    failTurnBeforeSpawn(
        id: string,
        conv: QaapAgentConversation,
        userMessageId: string,
        reason: string,
    ): QaapAgentConversation;
    resolveCompletedTurnAuthFailureReason(log: string | undefined): string | undefined;
    markTurnFailed(
        conv: QaapAgentConversation,
        options: {
            readonly userMessageId: string;
            readonly agentMessageId?: string;
            readonly reason: string;
            readonly failureBody?: string;
            readonly status?: QaapAgentConversationStatus;
        },
    ): { readonly conv: QaapAgentConversation; readonly agentMessageId?: string };
    finalizeStreamingAgentMessage(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        interruptionReason: string,
    ): QaapAgentConversation;
    clearRunActive(conv: QaapAgentConversation, agentMessageId: string | undefined): QaapAgentConversation;
    appendRunCancelledTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        reason: string,
    ): QaapAgentConversation;
    detectAgentBlockedNeed(conv: QaapAgentConversation, agentMessageId: string | undefined): string | undefined;
    appendReviewTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        note: string,
    ): QaapAgentConversation;
    appendBlockedTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        need: string,
    ): QaapAgentConversation;
    appendVerificationWarningTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
    ): QaapAgentConversation;
    appendCheckpointTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        checkpoint: QaapConversationCheckpoint,
    ): QaapAgentConversation;
    publishFinalizedAgentMessage(
        conversationId: string,
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        turnAgentId?: string,
    ): void;

    // ─── Prompt / agent routing ──────────────────────────────────────────────
    resolveAgentIdForAgentMessage(conv: QaapAgentConversation, agentMessage: QaapAgentMessage): string;
    resolveTurnAgent(conv: QaapAgentConversation, userContent: string, explicit?: string): string;
    isKnownAgentId(agentId: string): boolean;
    extractAgentMentionFromUserMessage(content: string): string | undefined;
    prepareContextCompactionForTurn(conv: QaapAgentConversation): QaapAgentConversation;
    buildContextCompactionSummary(messages: readonly QaapAgentMessage[]): string;
    buildTaskCreateRequest(
        conv: QaapAgentConversation,
        turnAgentId: string,
        latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'],
        turnUserMessageId?: string,
    ): QaapCreateAgentTaskRequest;
    stripLeadingAgentMention(content: string): string;
    buildPrompt(conv: QaapAgentConversation, turnAgentId: string): string;
    contextPreambleWithCompaction(contextPreamble: string | undefined, summary: string): string;
    appendTeamDelegation(prompt: string, turnAgentId: string): string;
    filterAgentLogChunk(chunk: string): string;
    deriveTitle(seed: string): string;

    // ─── Events / streaming wire protocol ───────────────────────────────────
    fire(event: QaapAgentConversationEvent): void;
    resolveRunAgentMessageId(
        conv: QaapAgentConversation,
        run: { readonly userMessageId: string; readonly agentMessageId?: string },
    ): string | undefined;
    clearAgUiReducer(agentMessageId: string | undefined): void;
    stageWireMetricsBaseline(conversationId: string, messageId: string, baseline: QaapAgentConversationEvent): void;
    recordStreamMetrics(event: QaapAgentConversationEvent): void;
    fireAgentMessageWireUpdate(
        conversationId: string,
        cwd: string,
        agentId: string,
        message: QaapAgentMessage,
        options?: { forceFullMessage?: boolean },
    ): void;

    // ─── Git integration ─────────────────────────────────────────────────────
    tryAutoLinkConversationToGitBranch(conv: QaapAgentConversation): QaapAgentConversation | undefined;
    cwdMatchesGithubRepo(cwd: string, owner: string, repo: string): boolean;
    parseGithubRepoFromCwd(cwd: string): { owner: string; name: string } | undefined;
    readGitBranch(cwd: string): string | undefined;
    mutatingGitSync(cwd: string, args: string[], env?: NodeJS.ProcessEnv): SpawnSyncReturns<string>;
    captureGitSha(cwd: string): string | undefined;
    computeGitDiffStats(cwd: string, startSha?: string): { added: number; removed: number } | undefined;
    captureCheckpoint(
        cwd: string,
        conversationId: string,
        messageId: string,
        label: string,
        stats?: { added: number; removed: number },
    ): QaapConversationCheckpoint | undefined;
    checkpointLabel(content: string): string;
    isDirectory(target: string): boolean;

    // ─── Watchdog / restart-resume (ADR-002 turn graph) ─────────────────────
    turnHasPendingApproval(conv: QaapAgentConversation): boolean;
    sweepZombieStreamingTurns(nowMs: number, options?: { readonly resetSurvivorsToIdle?: boolean }): boolean;
    forceStopZombieTurn(conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean;
    maybeAutoResumeInterruptedTurn(conversationId: string, nowMs: number): Promise<boolean>;
    isTurnGraphEnabled(): boolean;
    resumeInterruptedTurnViaGraph(
        conv: QaapAgentConversation,
        turnUserMessage: QaapAgentMessage,
        rootUserMessage: QaapAgentMessage,
        turnAgentId: string,
        nowMs: number,
    ): Promise<boolean>;
    settleChatTurnRun(task: QaapAgentTask, outcome?: QaapWorkflowNodeOutcome): void;
    findLiveChatTurnRun(conv: QaapAgentConversation, rootUserMessageId: string): QaapPersistedWorkflowRun | undefined;
    readTriedFallbackModels(record: QaapPersistedWorkflowRun | undefined): readonly string[];
    countDurableLoopSpawns(
        conv: QaapAgentConversation,
        rootUserMessageId: string,
        record: QaapPersistedWorkflowRun | undefined,
    ): number;
    maybeRetryTurnWithFallbackModelViaGraph(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,
    ): Promise<boolean>;
    interruptStreamingTurnForRestart(conversationId: string, nowMs: number): boolean;
}
