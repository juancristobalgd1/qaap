// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
import { Emitter, Event } from '@theia/core/lib/common/event';
import {
    inject,
    injectable,
    optional,
    postConstruct,
} from '@theia/core/shared/inversify';
import { SpawnSyncReturns } from 'child_process';
import {
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
} from '../common/qaap-agent-conversation';
import { type QaapAgentStreamAccumulator } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { type QaapCliAgUiStreamEmitter, } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-ag-ui-stream';
import {
    QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT,
    resolveChatTurnOutcome,
} from '../common/qaap-chat-turn-workflow';
import type { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import { QaapPersistedWorkflowRun, QaapWorkflowRunStore } from './qaap-workflow-run-store';
import { appendTeamDelegationToPrompt } from '../common/qaap-team-delegation';
import { deriveConversationTitle } from '../common/qaap-conversation-title';
import type { QaapParallelRunVariantStats } from '../common/qaap-parallel-run';
import type { QaapAgentTask, QaapAgentTaskEvent, QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import { QaapAgentConversationSseBatcher } from '../common/qaap-agent-conversation-sse-batcher';
import { QaapConversationStreamMetricsCollector } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import { type QaapAgentMessageWireSnapshot, } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-wire-delta';
import {
    type QaapAgUiEvent,
    type QaapAgUiTraceReducerState,
} from '@theia/qaap-mobile-shell/lib/common/qaap-ag-ui-transcript-adapter';
import { type QaapPreviewVisualValidationResult } from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import { type ComposerGitActionDisplayMetadata, } from '@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display';
import { QAAP_MAX_TURN_MINUTES_ENV, resolveQaapMaxTurnMinutes, } from '../common/qaap-agent-turn-watchdog';
import {
    visualEvidenceDirectory as visualEvidenceDirectoryHelper,
    countVisualRepairAttempts as countVisualRepairAttemptsHelper,
    buildVisualRepairPrompt as buildVisualRepairPromptHelper,
    saveVisualEvidenceImage as saveVisualEvidenceImageHelper,
    saveVisualEvidenceVideo as saveVisualEvidenceVideoHelper,
    resolveVisualVerificationFile as resolveVisualVerificationFileHelper,
    sweepUnreferencedVisualEvidence as sweepUnreferencedVisualEvidenceHelper,
} from './qaap-agent-conversation-store-visual';
import { parseGithubRepoFromCwd as parseGithubRepoFromCwdHelper, readGitBranch as readGitBranchHelper, captureGitSha as captureGitShaHelper, computeGitDiffStats as computeGitDiffStatsHelper, checkpointLabel as checkpointLabelHelper, isDirectory as isDirectoryHelper, } from './qaap-agent-conversation-store-git';
import {
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
    resolveCompletedTurnAuthFailureReason as resolveCompletedTurnAuthFailureReasonHelper,
    listAllGroupedByCwd as listAllGroupedByCwdHelper,
    finalizeTurnContextUsage as finalizeTurnContextUsageHelper,
    ensureAgentStream as ensureAgentStreamHelper,
    ensureAgUiStream as ensureAgUiStreamHelper,
    buildContextCompactionSummary as buildContextCompactionSummaryHelper,
} from './qaap-agent-conversation-store-helpers';
import {
    MAX_LOOP_SPAWNS_PER_USER_MESSAGE,
    type PostUserMessageInternalOptions,
    type QaapConversationTaskRef,
} from './qaap-agent-conversation-store-constants';
// Re-export constants and error class for external consumers
export {
    MAX_CONCURRENT_CONVERSATION_RUNS,
    QAAP_MAX_CONCURRENT_RUNS_CODE,
    QaapMaxConcurrentRunsError,
    parseGitNumstat,
} from './qaap-agent-conversation-store-constants';
import { cancelExtracted, cancelQueuedMessageExtracted, countStreamingForksExtracted, createExtracted, dispatchQueuedMessageExtracted, drainPendingMessagesExtracted, enqueuePendingMessageExtracted, getActiveTaskIdForConversationExtracted, getActiveTaskIdsForConversationExtracted, getExtracted, hasActiveTaskForUserMessageExtracted, hasOtherActiveTaskForConversationExtracted, initExtracted, interruptConversationRunsExtracted, linkConversationsToPullRequestExtracted, listExtracted, maybeDrainAtToolRoundBoundaryExtracted, mutatingGitSyncExtracted, postUserMessageExtracted, retryExtracted, settleStatusForRunExtracted } from './qaap-agent-conversation-store-render2';
import { attachVisualVerificationBlockExtracted, cancelRunExtracted, continueVisualRepairLoopExtracted, deleteExtracted, failVisualRepairLoopExtracted, forkExtracted, recordVisualVerificationExtracted, recordVisualVerificationVideoExtracted, resolveVisualEvidenceTargetExtracted, resolveVisualRepairSourceUserMessageExtracted, updateExtracted } from './qaap-agent-conversation-store-streaming2';
import { applyAgUiTaskOutputExtracted, applyTaskOutputExtracted, deliverSubtaskMailboxExtracted, findConversationIdForLeaderTaskExtracted, finishLeaderTurnAndMaybeSynthesizeExtracted, maybeTriggerTeamSynthesisExtracted, onTaskChangedExtracted, parseStructuredLogExtracted, readVisualVerificationExtracted, recordGitActionExtracted, recordSubmitLatencyMarksExtracted, recordTaskLatencyMarksExtracted, recordVisualVerificationFailureExtracted, recordVisualVerificationFlowExtracted, resolveLeaderTaskIdExtracted } from './qaap-agent-conversation-store-timeline2';
import { applyAccumulatorStructuredOutputExtracted, applyTaskOutcomeExtracted, backfillAgentMessageFromStructuredLogExtracted, maybeRetryTurnWithFallbackExtracted, resolveStructuredParsedTraceEventsExtracted } from './qaap-agent-conversation-store-activity2';
import { appendAgentReplyExtracted, appendBlockedTraceExtracted, appendCheckpointTraceExtracted, appendReviewTraceExtracted, appendRunCancelledTraceExtracted, appendVerificationWarningTraceExtracted, buildTaskCreateRequestExtracted, clearRunActiveExtracted, detectAgentBlockedNeedExtracted, extractAgentMentionFromUserMessageExtracted, failTurnBeforeSpawnExtracted, finalizeStreamingAgentMessageExtracted, markTurnFailedExtracted, maybeAutoContinueIncompleteTurnExtracted, maybeRetryTurnWithFallbackModelExtracted, postAutoContinueMessageExtracted, prepareContextCompactionForTurnExtracted, publishFinalizedAgentMessageExtracted, reportPreviewBootstrapFailureExtracted, resolveTurnAgentExtracted, stripLeadingAgentMentionExtracted } from './qaap-agent-conversation-store-tool-pills2';
import { applyAgUiTranscriptEventExtracted, buildPromptExtracted, clearAgUiReducerExtracted, cwdMatchesGithubRepoExtracted, fireAgentMessageWireUpdateExtracted, flushPersistExtracted, forceStopZombieTurnExtracted, maybeAutoResumeInterruptedTurnExtracted, recordStreamMetricsExtracted, resolveRunAgentMessageIdExtracted, restoreFromDiskExtracted, schedulePersistExtracted, stageWireMetricsBaselineExtracted, startTurnWatchdogExtracted, sweepZombieStreamingTurnsExtracted, tryAutoLinkConversationToGitBranchExtracted } from './qaap-agent-conversation-store-live-status2';
import { captureCheckpointExtracted, countDurableLoopSpawnsExtracted, findLiveChatTurnRunExtracted, interruptStreamingTurnForRestartExtracted, maybeRetryTurnWithFallbackModelViaGraphExtracted, persistExtracted, reapOrphanedChatTurnRunsExtracted, resumeInterruptedTurnViaGraphExtracted, settleChatTurnRunExtracted } from './qaap-agent-conversation-store-thought-brief2';
import { restoreCheckpointExtracted, rewindToMessageExtracted } from './qaap-agent-conversation-store-diff2';

/**
 * Persistent multi-turn conversations with the coding agent. Each user message spawns a one-shot
 * task on {@link QaapAgentTaskRunner} with the full transcript embedded in the prompt; when the
 * task finishes, its stdout is appended as the next agent message. The store survives backend
 * restarts and workspace switches: state lives entirely on the VPS.
 */
@injectable()
export class QaapAgentConversationStore {

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner!: QaapAgentTaskRunner;
    @inject(QaapBillingStore) @optional()
    protected readonly billingStore: QaapBillingStore | undefined;

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn!: QaapTenantSpawnService;

    protected mutatingGitSync(cwd: string, args: string[], env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
        return mutatingGitSyncExtracted(this, cwd, args, env);
    }

    /**
     * Durable ledger for graph-governed turns (ADR-002). Optional: unit-test harnesses construct
     * the store without DI, and the imperative path never touches it. With `QAAP_TURN_GRAPH` off
     * (the default) it stays completely unused.
     */
    @inject(QaapWorkflowRunStore) @optional()
    protected readonly workflowRuns: QaapWorkflowRunStore | undefined;

    protected readonly conversations = new Map<string, QaapAgentConversation>();
    /** Task id → the chat-turn run it is executing, so its terminal settles the run's edge. */
    protected readonly chatTurnRunByTask = new Map<string, { runId: string; ownerLogin?: string; nodeId: string }>();
    /** Serializes screenshot attachment per conversation across multiple open frontend tabs. */
    protected readonly visualVerificationInFlight = new Set<string>();
    /** Reverse index: task id → conversation turn metadata so we can route output/completion. */
    protected readonly taskToConversation = new Map<string, QaapConversationTaskRef>();
    /** Subtask ids whose completion was already appended to a leader conversation (passive mailbox). */
    protected readonly subtaskMailboxDelivered = new Set<string>();
    /** Leader turn task ids for which an auto-synthesis user message was already posted. */
    protected readonly teamSynthesisTriggeredForLeader = new Set<string>();
    /** Leader turns waiting for the in-flight agent reply before auto-synthesis can run. */
    protected readonly pendingTeamSynthesisForLeader = new Set<string>();
    /** Per user turn: model keys already attempted before a fallback retry. */
    protected readonly modelFallbackTriedByUserMessage = new Map<string, Set<string>>();
    /**
     * Per user turn: total agent re-spawns triggered by the auto-continue and model-fallback loops
     * combined. A shared ceiling so a pathological turn cannot fan out into many CLI invocations
     * (auto-continue × fallback multiply otherwise). See {@link MAX_LOOP_SPAWNS_PER_USER_MESSAGE}.
     */
    protected readonly loopSpawnCountByUserMessage = new Map<string, number>();
    /** Per-task structured stdout parsers (QAIQ, Claude, Codex JSON, OpenCode, Antigravity). */
    protected readonly agentStreamByTaskId = new Map<string, QaapAgentStreamAccumulator>();
    /** Per-task CLI stdout → native AG-UI event emitters (QAIQ, Claude, Codex, OpenCode). */
    protected readonly agUiStreamByTaskId = new Map<string, QaapCliAgUiStreamEmitter>();
    /** Last wire snapshot per agent message — drives incremental SSE deltas during streaming. */
    protected readonly lastWireMessageById = new Map<string, QaapAgentMessageWireSnapshot>();
    protected readonly agUiReducerByAgentMessageId = new Map<string, QaapAgUiTraceReducerState>();
    protected sseBatcher!: QaapAgentConversationSseBatcher;
    protected persistTimer: ReturnType<typeof setTimeout> | undefined;
    /** Periodic sweep that force-stops turns stuck 'streaming' past {@link QAAP_MAX_TURN_MINUTES_ENV}. */
    protected turnWatchdogTimer: ReturnType<typeof setInterval> | undefined;
    protected readonly streamMetrics = new QaapConversationStreamMetricsCollector('server');
    /** Uncompressed wire payloads keyed by `conversationId:messageId` for compression savings. */
    protected readonly wireMetricsBaselines = new Map<string, QaapAgentConversationEvent>();

    protected readonly onDidChangeEmitter = new Emitter<QaapAgentConversationEvent>();
    readonly onDidChange: Event<QaapAgentConversationEvent> = this.onDidChangeEmitter.event;
    /** Resolves once {@link restoreFromDisk} finishes — consumers that reconcile against conversations should await this. */
    protected restoreReady!: Promise<void>;

    @postConstruct()
    protected init(): void {
        initExtracted(this);
    }

    whenReady(): Promise<void> {
        return this.restoreReady;
    }

    list(cwd: string | undefined): QaapAgentConversationSummary[] {
        return listExtracted(this, cwd);
    }

    listAllGroupedByCwd(): QaapAgentConversationCwdGroup[] {
        return listAllGroupedByCwdHelper(this.conversations);
    }

    get(id: string): QaapAgentConversation | undefined {
        return getExtracted(this, id);
    }

    getActiveTaskIdForConversation(conversationId: string): string | undefined {
        return getActiveTaskIdForConversationExtracted(this, conversationId);
    }

    getActiveTaskIdsForConversation(conversationId: string): string[] {
        return getActiveTaskIdsForConversationExtracted(this, conversationId);
    }

    countStreamingForks(parentId: string): number {
        return countStreamingForksExtracted(this, parentId);
    }

    protected hasOtherActiveTaskForConversation(conversationId: string, exceptTaskId: string): boolean {
        return hasOtherActiveTaskForConversationExtracted(this, conversationId, exceptTaskId);
    }

    protected hasActiveTaskForUserMessage(conversationId: string, userMessageId: string, exceptTaskId: string,): boolean {
        return hasActiveTaskForUserMessageExtracted(this, conversationId, userMessageId, exceptTaskId);
    }

    protected settleStatusForRun(conversationId: string, finishedTaskId: string, settled: QaapAgentConversationStatus,): QaapAgentConversationStatus {
        return settleStatusForRunExtracted(this, conversationId, finishedTaskId, settled);
    }

    create(request: QaapCreateAgentConversationRequest, ownerLogin?: string): QaapAgentConversation {
        return createExtracted(this, request, ownerLogin);
    }

    postUserMessage(id: string, content: string, agentOverride?: string, agentModelOverride?: QaapCreateAgentTaskRequest['agentModel'], autoApproveOverride?: boolean, interactionModeId?: string, approvalPolicyId?: string, toolApprovalRules?: QaapCreateAgentConversationRequest['toolApprovalRules'], latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'], internal?: PostUserMessageInternalOptions, deliveryMode?: import('../common/qaap-agent-conversation').QaapMessageDeliveryMode,): QaapAgentConversation {
        return postUserMessageExtracted(this, id, content, agentOverride, agentModelOverride, autoApproveOverride, interactionModeId, approvalPolicyId, toolApprovalRules, latencyMarks, internal, deliveryMode);
    }

    enqueuePendingMessage(conv: import('../common/qaap-agent-conversation').QaapAgentConversation, userMessage: import('../common/qaap-agent-conversation').QaapAgentMessage, turnAgentId?: string, sealedTurnModel?: QaapCreateAgentTaskRequest['agentModel'], clientMessageId?: string): import('../common/qaap-agent-conversation').QaapAgentConversation {
        return enqueuePendingMessageExtracted(this, conv, userMessage, turnAgentId, sealedTurnModel, clientMessageId);
    }

    drainPendingMessages(conversationId: string): void {
        return drainPendingMessagesExtracted(this, conversationId);
    }

    /** Per-conversation coalesce timers for the drain (optimization C). */
    protected drainTimers = new Map<string, ReturnType<typeof setTimeout>>();

    maybeDrainAtToolRoundBoundary(conversationId: string): void {
        return maybeDrainAtToolRoundBoundaryExtracted(this, conversationId);
    }

    interruptConversationRuns(conversationId: string): void {
        return interruptConversationRunsExtracted(this, conversationId);
    }

    cancelQueuedMessage(conversationId: string, queuedMessageId: string): import('../common/qaap-agent-conversation').QaapAgentConversation | undefined {
        return cancelQueuedMessageExtracted(this, conversationId, queuedMessageId);
    }

    dispatchQueuedMessage(conversationId: string, queuedMessageId: string, deliveryMode: import('../common/qaap-agent-conversation').QaapMessageDeliveryMode): import('../common/qaap-agent-conversation').QaapAgentConversation | undefined {
        return dispatchQueuedMessageExtracted(this, conversationId, queuedMessageId, deliveryMode);
    }

    linkConversationsToPullRequest(input: QaapLinkConversationsByBranchRequest): number {
        return linkConversationsToPullRequestExtracted(this, input);
    }

    retry(id: string): QaapAgentConversation {
        return retryExtracted(this, id);
    }

    cancel(id: string): QaapAgentConversation | undefined {
        return cancelExtracted(this, id);
    }

    cancelRun(id: string, userMessageId: string): QaapAgentConversation | undefined {
        return cancelRunExtracted(this, id, userMessageId);
    }

    rename(id: string, request: QaapRenameAgentConversationRequest): QaapAgentConversation | undefined {
        return this.update(id, { title: request.title });
    }

    update(id: string, request: QaapUpdateAgentConversationRequest): QaapAgentConversation | undefined {
        return updateExtracted(this, id, request);
    }

    fork(id: string): QaapAgentConversation | undefined {
        return forkExtracted(this, id);
    }

    delete(id: string): boolean {
        return deleteExtracted(this, id);
    }

    protected visualEvidenceDirectory(conversationId: string): string {
        return visualEvidenceDirectoryHelper(conversationId);
    }

    protected resolveVisualEvidenceTarget(conv: QaapAgentConversation, targetAgentMessageId: string | undefined,): QaapAgentMessage | undefined {
        return resolveVisualEvidenceTargetExtracted(this, conv, targetAgentMessageId);
    }

    protected attachVisualVerificationBlock(conv: QaapAgentConversation, target: QaapAgentMessage, markdown: string,): QaapAgentConversation {
        return attachVisualVerificationBlockExtracted(this, conv, target, markdown);
    }

    protected resolveVisualRepairSourceUserMessage(conv: QaapAgentConversation, target: QaapAgentMessage,): QaapAgentMessage | undefined {
        return resolveVisualRepairSourceUserMessageExtracted(this, conv, target);
    }

    protected countVisualRepairAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number {
        return countVisualRepairAttemptsHelper(conv, rootUserMessageId);
    }

    protected buildVisualRepairPrompt(target: QaapAgentMessage, attempt: number): string {
        return buildVisualRepairPromptHelper(target, attempt);
    }

    protected async failVisualRepairLoop(conv: QaapAgentConversation, sourceUserMessage: QaapAgentMessage, target: QaapAgentMessage, reason: string,): Promise<QaapAgentConversation> {
        return failVisualRepairLoopExtracted(this, conv, sourceUserMessage, target, reason);
    }

    protected async continueVisualRepairLoop(conversationId: string, sourceAgentMessageId: string,): Promise<QaapAgentConversation | undefined> {
        return continueVisualRepairLoopExtracted(this, conversationId, sourceAgentMessageId);
    }

    async recordVisualVerification(conversationId: string, result: QaapPreviewVisualValidationResult, png: Buffer, targetAgentMessageId?: string, previewUrl?: string,): Promise<QaapAgentConversation | undefined> {
        return recordVisualVerificationExtracted(this, conversationId, result, png, targetAgentMessageId, previewUrl);
    }

    /**
     * Stores one walked-step screenshot ahead of the flow finalize. The PNG lands on disk
     * immediately (so a dying tab cannot hold conversation state hostage) and is referenced —
     * or swept as an orphan — when {@link recordVisualVerificationFlow} runs.
     */
    async saveVisualEvidenceImage(conversationId: string, png: Buffer): Promise<string | undefined> {
        return saveVisualEvidenceImageHelper(this.conversations, conversationId, png, this.visualEvidenceDirectory(conversationId));
    }

    /**
     * Moves a recorded tour (Playwright writes the webm to a temp path) into the evidence dir.
     * Videos are capped separately from screenshots — a few seconds of webm dwarfs any PNG.
     */
    async saveVisualEvidenceVideo(conversationId: string, sourcePath: string): Promise<string | undefined> {
        return saveVisualEvidenceVideoHelper(this.conversations, conversationId, sourcePath, this.visualEvidenceDirectory(conversationId));
    }

    async recordVisualVerificationVideo(conversationId: string, videoEvidenceId: string, steps: readonly { label: string; result: QaapPreviewVisualValidationResult }[], targetAgentMessageId: string, previewUrl?: string,): Promise<QaapAgentConversation | undefined> {
        return recordVisualVerificationVideoExtracted(this, conversationId, videoEvidenceId, steps, targetAgentMessageId, previewUrl);
    }

    /**
     * Resolves a served evidence file (`<uuid>` PNG or `<uuid>.webm` video) to its on-disk path.
     * The strict ref validation keeps the route traversal-proof.
     */
    resolveVisualVerificationFile(conversationId: string, evidenceRef: string): { path: string; contentType: string } | undefined {
        return resolveVisualVerificationFileHelper(this.conversations, conversationId, evidenceRef, this.visualEvidenceDirectory(conversationId));
    }

    async recordVisualVerificationFlow(conversationId: string, steps: readonly { label: string; evidenceId: string; result: QaapPreviewVisualValidationResult }[], targetAgentMessageId: string, previewUrl?: string,): Promise<QaapAgentConversation | undefined> {
        return recordVisualVerificationFlowExtracted(this, conversationId, steps, targetAgentMessageId, previewUrl);
    }

    /**
     * Deletes stored PNGs that no message references and that are older than an hour —
     * leftovers of flows whose finalize never arrived (tab closed mid-walk, budget exhausted).
     * The age guard protects a concurrent tab that is still mid-upload.
     */
    protected async sweepUnreferencedVisualEvidence(conversationId: string): Promise<void> {
        return sweepUnreferencedVisualEvidenceHelper(this.conversations, conversationId, this.visualEvidenceDirectory(conversationId));
    }

    async recordVisualVerificationFailure(conversationId: string, reason: string, targetAgentMessageId: string,): Promise<QaapAgentConversation | undefined> {
        return recordVisualVerificationFailureExtracted(this, conversationId, reason, targetAgentMessageId);
    }

    recordGitAction(conversationId: string, metadata: ComposerGitActionDisplayMetadata, options: { readonly messageId?: string; readonly replaceMessageId?: string; } = {},): QaapAgentConversation | undefined {
        return recordGitActionExtracted(this, conversationId, metadata, options);
    }

    readVisualVerification(conversationId: string, evidenceId: string): Buffer | undefined {
        return readVisualVerificationExtracted(this, conversationId, evidenceId);
    }

    protected onTaskChanged(event: QaapAgentTaskEvent): void {
        onTaskChangedExtracted(this, event);
    }

    protected recordTaskLatencyMarks(conversationId: string, task: QaapAgentTask): void {
        recordTaskLatencyMarksExtracted(this, conversationId, task);
    }

    protected recordSubmitLatencyMarks(conversationId: string, latencyMarks: QaapCreateAgentConversationRequest['latencyMarks'] | undefined,): void {
        recordSubmitLatencyMarksExtracted(this, conversationId, latencyMarks);
    }

    protected async deliverSubtaskMailbox(task: QaapAgentTask): Promise<void> {
        return deliverSubtaskMailboxExtracted(this, task);
    }

    protected resolveLeaderTaskId(task: QaapAgentTask): string | undefined {
        return resolveLeaderTaskIdExtracted(this, task);
    }

    protected findConversationIdForLeaderTask(leaderTaskId: string): string | undefined {
        return findConversationIdForLeaderTaskExtracted(this, leaderTaskId);
    }

    protected findTaskById(id: string): QaapAgentTask | undefined {
        return this.taskRunner.list().find(candidate => candidate.id === id);
    }

    protected maybeTriggerTeamSynthesis(leaderTaskId: string, conversationId: string): void {
        maybeTriggerTeamSynthesisExtracted(this, leaderTaskId, conversationId);
    }

    protected finishLeaderTurnAndMaybeSynthesize(conversationId: string, leaderTaskId: string, next: QaapAgentConversation,): void {
        finishLeaderTurnAndMaybeSynthesizeExtracted(this, conversationId, leaderTaskId, next);
    }

    protected applyTaskOutput(taskId: string, ref: QaapConversationTaskRef, chunk: string,): void {
        applyTaskOutputExtracted(this, taskId, ref, chunk);
    }

    protected applyAgUiTaskOutput(taskId: string, ref: QaapConversationTaskRef, chunk: string, agentId: string,): void {
        applyAgUiTaskOutputExtracted(this, taskId, ref, chunk, agentId);
    }

    protected finalizeTurnContextUsage(conv: QaapAgentConversation, taskId: string, agentId: string): QaapAgentConversation {
        return finalizeTurnContextUsageHelper(conv, taskId, this.agentStreamByTaskId);
    }

    protected ensureAgentStream(taskId: string, agentId: string): QaapAgentStreamAccumulator | undefined {
        return ensureAgentStreamHelper(taskId, agentId, this.agentStreamByTaskId);
    }

    protected ensureAgUiStream(taskId: string, agentId: string): QaapCliAgUiStreamEmitter {
        return ensureAgUiStreamHelper(taskId, agentId, this.agUiStreamByTaskId);
    }

    protected parseStructuredLog(agentId: string, log: string,): {
        content: string;
        segments: QaapAgentMessage['segments'];
        traceEvents: QaapAgentMessage['traceEvents'];
    } | undefined {
        return parseStructuredLogExtracted(this, agentId, log);
    }

    protected applyAccumulatorStructuredOutput(taskId: string, ref: QaapConversationTaskRef, agentId: string,): void {
        applyAccumulatorStructuredOutputExtracted(this, taskId, ref, agentId);
    }

    protected backfillAgentMessageFromStructuredLog(message: QaapAgentMessage, agentId: string, log: string,): QaapAgentMessage {
        return backfillAgentMessageFromStructuredLogExtracted(this, message, agentId, log);
    }

    protected resolveStructuredParsedTraceEvents(message: QaapAgentMessage, parsed: { segments?: QaapAgentMessage['segments']; traceEvents?: QaapAgentMessage['traceEvents']; },): QaapAgentMessage['traceEvents'] {
        return resolveStructuredParsedTraceEventsExtracted(this, message, parsed);
    }

    protected async applyTaskOutcome(ref: QaapConversationTaskRef, task: QaapAgentTask,): Promise<QaapWorkflowNodeOutcome> {
        return applyTaskOutcomeExtracted(this, ref, task);
    }

    /**
     * When a model-backed agent exits before producing a real answer, retry the same user turn
     * with the next curated fallback model so the thread keeps moving without user intervention.
     */
    /** Shared re-spawn budget across the auto-continue and model-fallback loops for one user turn. */
    protected hasLoopSpawnBudget(userMessageId: string): boolean {
        return (this.loopSpawnCountByUserMessage.get(userMessageId) ?? 0) < MAX_LOOP_SPAWNS_PER_USER_MESSAGE;
    }

    protected recordLoopSpawn(userMessageId: string): void {
        this.loopSpawnCountByUserMessage.set(userMessageId, (this.loopSpawnCountByUserMessage.get(userMessageId) ?? 0) + 1);
    }

    /** Resolve every generated continuation in a chain back to the human-authored root turn. */
    protected resolveLoopBudgetKey(conv: QaapAgentConversation, userMessageId: string): string {
        return resolveLoopBudgetKeyHelper(conv, userMessageId);
    }

    /** Persisted count so a backend restart cannot reset the per-chain auto-continue ceiling. */
    protected countAutoContinueAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number {
        return countAutoContinueAttemptsHelper(conv, rootUserMessageId);
    }

    protected async maybeRetryTurnWithFallback(conversationId: string, userMessageId: string, agentMessageId: string | undefined, task: QaapAgentTask, conv: QaapAgentConversation, agentMessage: QaapAgentMessage | undefined, turnAgentId: string, startSha?: string,): Promise<boolean> {
        return maybeRetryTurnWithFallbackExtracted(this, conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha);
    }

    protected maybeRetryTurnWithFallbackModel(conversationId: string, userMessageId: string, agentMessageId: string | undefined, task: QaapAgentTask, conv: QaapAgentConversation, agentMessage: QaapAgentMessage | undefined, turnAgentId: string, startSha?: string,): boolean {
        return maybeRetryTurnWithFallbackModelExtracted(this, conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha);
    }

    protected postAutoContinueMessage(conversationId: string, content: string, conv: QaapAgentConversation, rootUserMessageId: string, turnAgentId: string, turnAgentModel: QaapAgentMessage['turnAgentModel'],): QaapAgentConversation {
        return postAutoContinueMessageExtracted(this, conversationId, content, conv, rootUserMessageId, turnAgentId, turnAgentModel);
    }

    protected maybeAutoContinueIncompleteTurn(conversationId: string, conv: QaapAgentConversation, userMessageId: string, agentMessageId?: string, turnAgentId?: string,): void {
        maybeAutoContinueIncompleteTurnExtracted(this, conversationId, conv, userMessageId, agentMessageId, turnAgentId);
    }

    reportPreviewBootstrapFailure(conversationId: string, reason: string): QaapAgentConversation | undefined {
        return reportPreviewBootstrapFailureExtracted(this, conversationId, reason);
    }

    protected appendAgentReply(conv: QaapAgentConversation, content: string, runUserMessageId?: string,): QaapAgentConversation {
        return appendAgentReplyExtracted(this, conv, content, runUserMessageId);
    }

    protected failTurnBeforeSpawn(id: string, conv: QaapAgentConversation, userMessageId: string, reason: string,): QaapAgentConversation {
        return failTurnBeforeSpawnExtracted(this, id, conv, userMessageId, reason);
    }

    /**
     * Detect CLI blocking failures that exit 0 but must still open an interactive
     * failure dialog in Work Hub chat (Sign-in for auth; Task failed for quota /
     * rate limits). Covers stream-json `is_error:true` and plain-text Antigravity
     * quota lines ("Individual quota reached…").
     */
    protected resolveCompletedTurnAuthFailureReason(log: string | undefined): string | undefined {
        return resolveCompletedTurnAuthFailureReasonHelper(log);
    }

    protected markTurnFailed(conv: QaapAgentConversation, options: { readonly userMessageId: string; readonly agentMessageId?: string; readonly reason: string; readonly failureBody?: string; readonly status?: QaapAgentConversationStatus; },): { readonly conv: QaapAgentConversation; readonly agentMessageId?: string } {
        return markTurnFailedExtracted(this, conv, options);
    }

    protected finalizeStreamingAgentMessage(conv: QaapAgentConversation, agentMessageId: string | undefined, interruptionReason: string,): QaapAgentConversation {
        return finalizeStreamingAgentMessageExtracted(this, conv, agentMessageId, interruptionReason);
    }

    protected clearRunActive(conv: QaapAgentConversation, agentMessageId: string | undefined,): QaapAgentConversation {
        return clearRunActiveExtracted(this, conv, agentMessageId);
    }

    protected appendRunCancelledTrace(conv: QaapAgentConversation, agentMessageId: string | undefined, reason: string,): QaapAgentConversation {
        return appendRunCancelledTraceExtracted(this, conv, agentMessageId, reason);
    }

    protected detectAgentBlockedNeed(conv: QaapAgentConversation, agentMessageId: string | undefined,): string | undefined {
        return detectAgentBlockedNeedExtracted(this, conv, agentMessageId);
    }

    protected appendReviewTrace(conv: QaapAgentConversation, agentMessageId: string | undefined, note: string,): QaapAgentConversation {
        return appendReviewTraceExtracted(this, conv, agentMessageId, note);
    }

    protected appendBlockedTrace(conv: QaapAgentConversation, agentMessageId: string | undefined, need: string,): QaapAgentConversation {
        return appendBlockedTraceExtracted(this, conv, agentMessageId, need);
    }

    protected appendVerificationWarningTrace(conv: QaapAgentConversation, agentMessageId: string | undefined, task: QaapAgentTask,): QaapAgentConversation {
        return appendVerificationWarningTraceExtracted(this, conv, agentMessageId, task);
    }

    protected appendCheckpointTrace(conv: QaapAgentConversation, agentMessageId: string | undefined, checkpoint: QaapConversationCheckpoint,): QaapAgentConversation {
        return appendCheckpointTraceExtracted(this, conv, agentMessageId, checkpoint);
    }

    protected publishFinalizedAgentMessage(conversationId: string, conv: QaapAgentConversation, agentMessageId: string | undefined, turnAgentId?: string,): void {
        publishFinalizedAgentMessageExtracted(this, conversationId, conv, agentMessageId, turnAgentId);
    }

    protected resolveAgentIdForAgentMessage(conv: QaapAgentConversation, agentMessage: QaapAgentMessage): string {
        return resolveAgentIdForAgentMessageHelper(conv, agentMessage);
    }

    protected resolveTurnAgent(conv: QaapAgentConversation, userContent: string, explicit?: string): string {
        return resolveTurnAgentExtracted(this, conv, userContent, explicit);
    }

    protected isKnownAgentId(agentId: string): boolean {
        return !!this.taskRunner.normalizeAgentId(agentId);
    }

    protected extractAgentMentionFromUserMessage(content: string): string | undefined {
        return extractAgentMentionFromUserMessageExtracted(this, content);
    }

    protected prepareContextCompactionForTurn(conv: QaapAgentConversation): QaapAgentConversation {
        return prepareContextCompactionForTurnExtracted(this, conv);
    }

    protected buildContextCompactionSummary(messages: readonly QaapAgentMessage[]): string {
        return buildContextCompactionSummaryHelper(messages);
    }

    protected contextCompactionMessageText(message: QaapAgentMessage): string {
        return contextCompactionMessageTextHelper(message);
    }

    protected buildTaskCreateRequest(conv: QaapAgentConversation, turnAgentId: string, latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'], turnUserMessageId?: string,): QaapCreateAgentTaskRequest {
        return buildTaskCreateRequestExtracted(this, conv, turnAgentId, latencyMarks, turnUserMessageId);
    }

    protected stripLeadingAgentMention(content: string): string {
        return stripLeadingAgentMentionExtracted(this, content);
    }

    protected buildPrompt(conv: QaapAgentConversation, turnAgentId = conv.agentId): string {
        return buildPromptExtracted(this, conv, turnAgentId = conv.agentId);
    }

    protected contextPreambleWithCompaction(contextPreamble: string | undefined, summary: string): string {
        return contextPreambleWithCompactionHelper(contextPreamble, summary);
    }

    /** Inject lightweight team-delegation instructions so the leader can spawn sub-tasks via `qaap-task`. */
    protected appendTeamDelegation(prompt: string, turnAgentId: string): string {
        const agentIds = this.taskRunner.listAgents().map(agent => agent.id);
        return appendTeamDelegationToPrompt(prompt, turnAgentId, agentIds);
    }

    /** Drop repetitive QAIQ/OpenClaude metadata noise from chat transcripts (still kept in task logs). */
    protected filterAgentLogChunk(chunk: string): string {
        return filterAgentLogChunkHelper(chunk);
    }

    /**
     * Derive the auto-summarized title for a conversation from its first user prompt.
     *
     * Delegates to the pure {@link deriveConversationTitle} heuristic (shared with the frontend
     * fallback). This is the single chokepoint used both when a conversation is created and when
     * the first user turn is posted, so an explicit rename ({@link rename}/{@link update}) is never
     * touched. See {@link deriveConversationTitle}'s doc for the documented LLM-title upgrade seam.
     */
    protected deriveTitle(seed: string): string {
        return deriveTitleHelper(seed);
    }

    protected fire(event: QaapAgentConversationEvent): void {
        this.sseBatcher.enqueue(event);
    }

    protected resolveRunAgentMessageId(conv: QaapAgentConversation, run: { readonly userMessageId: string; readonly agentMessageId?: string },): string | undefined {
        return resolveRunAgentMessageIdExtracted(this, conv, run);
    }

    applyAgUiTranscriptEvent(conversationId: string, event: QaapAgUiEvent, run?: { readonly userMessageId: string; readonly turnAgentId?: string; agentMessageId?: string },): QaapAgentConversation | undefined {
        return applyAgUiTranscriptEventExtracted(this, conversationId, event, run);
    }

    protected clearAgUiReducer(agentMessageId: string | undefined): void {
        clearAgUiReducerExtracted(this, agentMessageId);
    }

    protected stageWireMetricsBaseline(conversationId: string, messageId: string, baseline: QaapAgentConversationEvent,): void {
        stageWireMetricsBaselineExtracted(this, conversationId, messageId, baseline);
    }

    protected recordStreamMetrics(event: QaapAgentConversationEvent): void {
        recordStreamMetricsExtracted(this, event);
    }

    protected fireAgentMessageWireUpdate(conversationId: string, cwd: string, agentId: string, message: QaapAgentMessage, options?: { forceFullMessage?: boolean },): void {
        fireAgentMessageWireUpdateExtracted(this, conversationId, cwd, agentId, message, options);
    }

    protected schedulePersist(): void {
        schedulePersistExtracted(this);
    }

    protected flushPersist(): void {
        flushPersistExtracted(this);
    }

    /** Push live parallel-run diff stats to the run owner's connected conversation SSE clients. */
    emitParallelRunStats(runId: string, cwd: string, variants: readonly QaapParallelRunVariantStats[]): void {
        this.fire({ type: 'parallel-run', runId, cwd, variants });
    }

    protected tryAutoLinkConversationToGitBranch(conv: QaapAgentConversation): QaapAgentConversation | undefined {
        return tryAutoLinkConversationToGitBranchExtracted(this, conv);
    }

    protected cwdMatchesGithubRepo(cwd: string, owner: string, repo: string): boolean {
        return cwdMatchesGithubRepoExtracted(this, cwd, owner, repo);
    }

    protected parseGithubRepoFromCwd(cwd: string): { owner: string; name: string } | undefined {
        return parseGithubRepoFromCwdHelper(cwd);
    }

    protected readGitBranch(cwd: string): string | undefined {
        return readGitBranchHelper(cwd);
    }

    protected async restoreFromDisk(): Promise<void> {
        return restoreFromDiskExtracted(this);
    }

    protected startTurnWatchdog(): void {
        startTurnWatchdogExtracted(this);
    }

    /**
     * Force-stop every 'streaming' conversation whose turn has run at least
     * {@link resolveQaapMaxTurnMinutes}. Returns whether anything changed, so callers can decide
     * whether to persist.
     *
     * @param resetSurvivorsToIdle Also reset still-within-budget 'streaming' conversations to
     * 'idle' (used only at startup: after a restart the live task handle is gone either way, so a
     * turn under budget can never complete normally — same fallback the store always applied).
     */
    /** True when the conversation's current turn is paused waiting on a user approval (REL-5). */
    protected turnHasPendingApproval(conv: QaapAgentConversation): boolean {
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId);
        return !!lastUser?.taskId && this.taskRunner.listPendingQaiqControlRequests(lastUser.taskId).length > 0;
    }

    protected sweepZombieStreamingTurns(nowMs: number, options?: { readonly resetSurvivorsToIdle?: boolean }): boolean {
        return sweepZombieStreamingTurnsExtracted(this, nowMs, options);
    }

    protected forceStopZombieTurn(conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean {
        return forceStopZombieTurnExtracted(this, conversationId, elapsedMs, maxTurnMinutes);
    }

    protected async maybeAutoResumeInterruptedTurn(conversationId: string, nowMs: number): Promise<boolean> {
        return maybeAutoResumeInterruptedTurnExtracted(this, conversationId, nowMs);
    }

    /** ADR-002 turnstile: whether restart-resume is governed by the chat-turn workflow graph. */
    protected isTurnGraphEnabled(): boolean {
        return isTurnGraphEnabledHelper();
    }

    protected async resumeInterruptedTurnViaGraph(conv: QaapAgentConversation, turnUserMessage: QaapAgentMessage, rootUserMessage: QaapAgentMessage, turnAgentId: string, nowMs: number,): Promise<boolean> {
        return resumeInterruptedTurnViaGraphExtracted(this, conv, turnUserMessage, rootUserMessage, turnAgentId, nowMs);
    }

    protected settleChatTurnRun(task: QaapAgentTask, outcome: QaapWorkflowNodeOutcome = resolveChatTurnOutcome(task.state)): void {
        settleChatTurnRunExtracted(this, task, outcome);
    }

    protected findLiveChatTurnRun(conv: QaapAgentConversation, rootUserMessageId: string): QaapPersistedWorkflowRun | undefined {
        return findLiveChatTurnRunExtracted(this, conv, rootUserMessageId);
    }

    /** The durable tried-model keys of a run's fallback ladder ({@link QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT}). */
    protected readTriedFallbackModels(record: QaapPersistedWorkflowRun | undefined): readonly string[] {
        return readTriedFallbackModelsHelper(record);
    }

    protected countDurableLoopSpawns(conv: QaapAgentConversation, rootUserMessageId: string, record: QaapPersistedWorkflowRun | undefined,): number {
        return countDurableLoopSpawnsExtracted(this, conv, rootUserMessageId, record);
    }

    protected async maybeRetryTurnWithFallbackModelViaGraph(conversationId: string, userMessageId: string, agentMessageId: string | undefined, task: QaapAgentTask, conv: QaapAgentConversation, agentMessage: QaapAgentMessage | undefined, turnAgentId: string, startSha?: string,): Promise<boolean> {
        return maybeRetryTurnWithFallbackModelViaGraphExtracted(this, conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha);
    }

    protected async reapOrphanedChatTurnRuns(): Promise<void> {
        return reapOrphanedChatTurnRunsExtracted(this);
    }

    protected interruptStreamingTurnForRestart(conversationId: string, nowMs: number): boolean {
        return interruptStreamingTurnForRestartExtracted(this, conversationId, nowMs);
    }

    /** Throttle persist-failure warnings so a sustained disk error can't spam the log every 500ms. */
    protected persistFailureLoggedAtMs = 0;

    protected async persist(): Promise<void> {
        return persistExtracted(this);
    }

    protected captureGitSha(cwd: string): string | undefined {
        return captureGitShaHelper(cwd);
    }

    protected computeGitDiffStats(cwd: string, startSha?: string): { added: number; removed: number } | undefined {
        return computeGitDiffStatsHelper(cwd, startSha);
    }

    protected captureCheckpoint(cwd: string, conversationId: string, messageId: string, label: string, stats?: { added: number; removed: number },): QaapConversationCheckpoint | undefined {
        return captureCheckpointExtracted(this, cwd, conversationId, messageId, label, stats);
    }

    protected checkpointLabel(content: string): string {
        return checkpointLabelHelper(content);
    }

    async rewindToMessage(conversationId: string, messageId: string): Promise<QaapAgentConversation | undefined> {
        return rewindToMessageExtracted(this, conversationId, messageId);
    }

    async restoreCheckpoint(conversationId: string, checkpointId: string): Promise<QaapAgentConversation | undefined> {
        return restoreCheckpointExtracted(this, conversationId, checkpointId);
    }

    protected isDirectory(target: string): boolean {
        return isDirectoryHelper(target);
    }
}
