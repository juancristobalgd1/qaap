// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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

// ─── Constants, types, and error class (extracted) ────────────────────────────
export {
    MAX_CONCURRENT_CONVERSATION_RUNS,
    QAAP_MAX_CONCURRENT_RUNS_CODE,
    QaapMaxConcurrentRunsError,
    parseGitNumstat,
} from './qaap-agent-conversation-store-constants';
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

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn!: QaapTenantSpawnService;

    /**
     * SEC-1/C-3: run a MUTATING git command (checkout/restore/add/write-tree/…) over a tenant repo
     * under the tenant uid, not root. Git applies tenant-controlled hooks (`.git/hooks/*`) and
     * clean/smudge filters (`.git/config` filter commands) during these operations; run as root that
     * is a root-RCE vector, and it also leaves root-owned files that break the tenant's later git. The
     * `setpriv` wrap makes any such hook/filter run as the tenant uid (no escalation) and keeps the
     * tree tenant-owned. No-op (plain root git) in local dev / non-tenant cwd. Read-only git (rev-parse,
     * diff, remote get-url) stays as-is: it executes no tenant code and writes nothing.
     */
    protected mutatingGitSync(cwd: string, args: string[], env?: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
        const wrapped = this.tenantSpawn.wrapShellForTenant(cwd, 'git', args);
        const runEnv = { ...(env ?? process.env), ...this.tenantSpawn.tenantHomeEnvOverlay(cwd) };
        return spawnSync(wrapped.file, wrapped.args, { cwd, env: runEnv, encoding: 'utf8' });
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
        this.sseBatcher = new QaapAgentConversationSseBatcher(event => {
            this.recordStreamMetrics(event);
            this.onDidChangeEmitter.fire(event);
        });
        this.restoreReady = this.restoreFromDisk();
        this.taskRunner.onDidChangeTask(event => this.onTaskChanged(event));
        this.startTurnWatchdog();
    }

    whenReady(): Promise<void> {
        return this.restoreReady;
    }

    list(cwd: string | undefined): QaapAgentConversationSummary[] {
        const all = [...this.conversations.values()];
        const filtered = cwd ? all.filter(c => c.cwd === path.resolve(cwd)) : all;
        return filtered
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(toConversationSummary);
    }

    listAllGroupedByCwd(): QaapAgentConversationCwdGroup[] {
        return listAllGroupedByCwdHelper(this.conversations);
    }

    get(id: string): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const { conversation, changed } = backfillConversationTraceEvents(conv);
        const materialized = materializeConversationForApiWithChanges(conversation);
        if (changed || materialized.changed) {
            this.conversations.set(id, materialized.conversation);
            this.schedulePersist();
        }
        return materialized.conversation;
    }

    /** Running turn task id for a conversation, if any. */
    getActiveTaskIdForConversation(conversationId: string): string | undefined {
        for (const [taskId, ref] of this.taskToConversation) {
            if (ref.conversationId === conversationId) {
                return taskId;
            }
        }
        return undefined;
    }

    /**
     * Every run currently streaming into this conversation. A conversation used to hold at most
     * one, but in-session multitasking lets the user start a second agent while the first still
     * works, so anything that reasons about "the turn" has to reason about a set instead.
     */
    getActiveTaskIdsForConversation(conversationId: string): string[] {
        const taskIds: string[] = [];
        for (const [taskId, ref] of this.taskToConversation) {
            if (ref.conversationId === conversationId) {
                taskIds.push(taskId);
            }
        }
        return taskIds;
    }

    /** True while another run of the same conversation is still streaming. */
    protected hasOtherActiveTaskForConversation(conversationId: string, exceptTaskId: string): boolean {
        for (const [taskId, ref] of this.taskToConversation) {
            if (ref.conversationId === conversationId && taskId !== exceptTaskId) {
                return true;
            }
        }
        return false;
    }

    /**
     * True when another live task owns the same user turn — the model-fallback retry replaces a
     * task for one user message, and only in that case is the old task's outcome stale. A peer
     * run started by the user (different user message) is NOT superseding anything.
     */
    protected hasActiveTaskForUserMessage(
        conversationId: string,
        userMessageId: string,
        exceptTaskId: string,
    ): boolean {
        return hasActiveTaskForUserMessageHelper(this.taskToConversation, conversationId, userMessageId, exceptTaskId);
    }

    /**
     * The status a conversation takes when one run settles: while peers are still working the
     * conversation stays `streaming`, so a finished run never switches off the whole session.
     */
    protected settleStatusForRun(
        conversationId: string,
        finishedTaskId: string,
        settled: QaapAgentConversationStatus,
    ): QaapAgentConversationStatus {
        return this.hasOtherActiveTaskForConversation(conversationId, finishedTaskId) ? 'streaming' : settled;
    }

    create(request: QaapCreateAgentConversationRequest, ownerLogin?: string): QaapAgentConversation {
        const cwd = path.resolve(request.cwd ?? '');
        if (!path.isAbsolute(cwd) || !this.isDirectory(cwd)) {
            throw new Error('A valid absolute "cwd" directory is required.');
        }
        // See QaapAgentTaskRunner.create: a container cwd feeds every repository to the agent.
        if (isQaapWorkspaceContainerPath(cwd)) {
            throw new Error(QAAP_CONTAINER_CWD_ERROR);
        }
        const seedAgent = (request.agent ?? '').trim() || this.taskRunner.defaultAgent();
        const firstMessage = (request.message ?? '').trim();
        const agentId = firstMessage
            ? this.resolveTurnAgent({ id: '', cwd, agentId: seedAgent, title: '', status: 'idle', createdAt: 0, updatedAt: 0, messages: [] }, firstMessage, request.agent)
            : seedAgent;
        const now = Date.now();
        const id = randomUUID();
        const titleSeed = (request.title ?? request.message ?? '').trim();
        const conversation: QaapAgentConversation = {
            id,
            cwd,
            agentId,
            title: this.deriveTitle(titleSeed) || 'New conversation',
            status: 'idle',
            createdAt: now,
            updatedAt: now,
            messages: [],
            ...(ownerLogin ? { ownerLogin } : {}),
            ...(request.parallelRunId ? { parallelRunId: request.parallelRunId } : {}),
            ...(request.parallelBaseCwd ? { parallelBaseCwd: request.parallelBaseCwd } : {}),
            ...(request.worktreeBranch ? { worktreeBranch: request.worktreeBranch } : {}),
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
        this.conversations.set(id, conversation);
        this.fire({ type: 'created', conversation: toConversationSummary(conversation) });
        void this.persist();
        if (request.message?.trim()) {
            this.postUserMessage(
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
        return this.conversations.get(id)!;
    }

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
        internal?: PostUserMessageInternalOptions,
    ): QaapAgentConversation {
        let conv = this.conversations.get(id);
        if (!conv) {
            throw new Error('Conversation not found.');
        }
        if (internal?.clientMessageId) {
            const alreadyAccepted = conv.messages.some(message =>
                message.role === 'user' && message.clientMessageId === internal.clientMessageId
            );
            if (alreadyAccepted) {
                return conv;
            }
        }
        if (conv.status === 'streaming') {
            // In-session multitasking: a new user message no longer waits for (or cancels) the
            // turn in flight — it spawns a peer run that streams into its own agent message
            // alongside the others. The cap is what keeps one conversation from fanning out
            // into an unbounded number of agents over the same working tree.
            const activeTaskIds = this.getActiveTaskIdsForConversation(id);
            if (activeTaskIds.length === 0) {
                // 'streaming' with no live run is a stale turn (backend restart, lost task):
                // recover to idle instead of refusing the message forever.
                conv = { ...conv, status: 'idle', updatedAt: Date.now() };
                this.conversations.set(id, conv);
                this.fire({ type: 'updated', conversation: toConversationSummary(conv) });
            } else if (activeTaskIds.length >= MAX_CONCURRENT_CONVERSATION_RUNS) {
                throw new QaapMaxConcurrentRunsError(
                    `This conversation already has ${activeTaskIds.length} agent runs in progress `
                    + `(max ${MAX_CONCURRENT_CONVERSATION_RUNS}).`,
                );
            }
        }
        const turnAgentId = this.resolveTurnAgent(conv, content, agentOverride);
        const modelPatch = agentModelOverride && agentSupportsModelPicker(turnAgentId)
            ? { agentModel: agentModelOverride, qaiqModel: agentModelOverride }
            : {};
        // The model that will actually drive this turn. Resolved BEFORE the user message is built
        // so the very first SSE frame already carries the provenance the badge renders from:
        // sealing it after `taskRunner.create()` would ship an unsealed frame that the client's
        // replace-by-id merge (`QaapThreadStore.appendLiveMessage`) can never repair on its own.
        const turnModel = modelPatch.agentModel ?? conv.agentModel ?? conv.qaiqModel;
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
        };
        const messages = [...conv.messages, userMessage];
        let next: QaapAgentConversation = {
            ...conv,
            ...patchConversationAutoApprove(conv, autoApproveOverride),
            agentId: turnAgentId,
            title: conv.messages.length === 0 ? this.deriveTitle(content) : conv.title,
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
        this.conversations.set(id, next);
        this.fire({ type: 'message', conversationId: id, cwd: next.cwd, message: userMessage });
        this.recordSubmitLatencyMarks(id, latencyMarks);
        this.streamMetrics.recordLatencyMark(id, 'backend_user_message_persisted');
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        next = this.prepareContextCompactionForTurn(next);
        if (this.conversations.get(id) !== next) {
            this.conversations.set(id, next);
            this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        }

        // Pre-spawn gate: models confirmed to lack function calling cannot drive the coding
        // agent — fail the turn typed instead of burning a doomed CLI run.
        if (agentSupportsModelPicker(turnAgentId) && qaiqModelSupportsToolCalls(turnModel?.modelId) === false) {
            return this.failTurnBeforeSpawn(id, next, userMessage.id, localizeAgentFailureMessage('tool_unsupported'));
        }
        let task: QaapAgentTask | undefined;
        try {
            task = this.taskRunner.create(
                this.buildTaskCreateRequest(next, turnAgentId, latencyMarks, userMessage.id),
                next.ownerLogin,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.failTurnBeforeSpawn(id, next, userMessage.id, message);
        }
        this.streamMetrics.recordLatencyMark(id, 'task_created');

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
        const autoLinked = this.tryAutoLinkConversationToGitBranch(next);
        if (autoLinked) {
            next = autoLinked;
        }
        this.conversations.set(id, next);
        // Provenance already went out with the first frame; only a task runner that resolved its
        // own agent id synchronously (none does today) can make that frame stale. Re-emit then,
        // and only then, so the common path keeps its single user-message frame.
        const sealedUserMessage = messagesWithTask.find(m => m.id === userMessage.id);
        if (sealedUserMessage && sealedUserMessage.turnAgentId !== userMessage.turnAgentId) {
            this.fire({ type: 'message', conversationId: id, cwd: next.cwd, message: sealedUserMessage });
        }
        const startSha = this.captureGitSha(conv.cwd);
        this.taskToConversation.set(task.id, {
            conversationId: id,
            userMessageId: userMessage.id,
            turnAgentId: task.agentId ?? turnAgentId,
            startSha,
        });
        void this.persist();
        return next;
    }

    /**
     * Attach open PR metadata to every conversation in the repo whose checked-out branch matches
     * the PR head (used by the GitHub webhook → Work Hub inbox pipeline).
     */
    linkConversationsToPullRequest(input: QaapLinkConversationsByBranchRequest): number {
        const link: QaapLinkedPullRequest = {
            owner: input.owner,
            repo: input.repo,
            number: input.number,
            branch: input.branch,
            title: input.title,
        };
        let linked = 0;
        for (const [conversationId, conv] of this.conversations) {
            const existing = conv.linkedPullRequest;
            if (existing
                && existing.number === link.number
                && existing.owner.toLowerCase() === link.owner.toLowerCase()
                && existing.repo.toLowerCase() === link.repo.toLowerCase()) {
                continue;
            }
            if (!this.cwdMatchesGithubRepo(conv.cwd, link.owner, link.repo)) {
                continue;
            }
            const head = this.readGitBranch(conv.cwd);
            if (head && head !== link.branch) {
                continue;
            }
            const next: QaapAgentConversation = {
                ...conv,
                linkedPullRequest: link,
                updatedAt: Date.now(),
            };
            this.conversations.set(conversationId, next);
            this.fire({ type: 'updated', conversation: toConversationSummary(next) });
            linked++;
        }
        if (linked > 0) {
            void this.persist();
        }
        return linked;
    }

    retry(id: string): QaapAgentConversation {
        const conv = this.conversations.get(id);
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
        this.conversations.set(id, trimmed);
        this.fire({ type: 'updated', conversation: toConversationSummary(trimmed) });
        return this.postUserMessage(id, failedMessage.content);
    }

    cancel(id: string): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        // Stop is session-wide: with in-session multitasking there can be several runs streaming
        // at once, and cancelling only the newest would leave the others working behind a UI that
        // says the session is idle. Every live run is cancelled and every open agent message
        // finalized; the last-user-message fallback keeps pre-multitasking conversations working.
        const activeRefs = this.getActiveTaskIdsForConversation(id)
            .map(taskId => ({ taskId, ref: this.taskToConversation.get(taskId) }));
        const lastUser = [...conv.messages].reverse().find(m => m.role === 'user' && m.taskId);
        const cancelTaskIds = activeRefs.length > 0
            ? activeRefs.map(entry => entry.taskId)
            : (lastUser?.taskId ? [lastUser.taskId] : []);
        for (const taskId of cancelTaskIds) {
            this.taskRunner.cancel(taskId);
            for (const subtask of collectSubtasksForLeader(taskId, this.taskRunner.list())) {
                // Queued children must die with Stop All too — otherwise they start
                // after the leader was cancelled and the Working pill comes back.
                if (subtask.state === 'running' || subtask.state === 'queued') {
                    this.taskRunner.cancel(subtask.id);
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
            next = this.appendRunCancelledTrace(next, messageId, 'Turn cancelled.');
            next = this.finalizeStreamingAgentMessage(next, messageId, 'Turn cancelled.');
        }
        next = { ...next, status: 'idle', updatedAt: Date.now() };
        this.conversations.set(id, next);
        for (const messageId of agentMessageIds) {
            this.publishFinalizedAgentMessage(id, next, messageId);
        }
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
    }

    /**
     * Stops ONE run of a multitasking session, leaving its peers working. The run is identified
     * by its user message (the turn the user asked for); its agent message is finalized as
     * cancelled and the conversation only leaves `streaming` when no peer is left.
     */
    cancelRun(id: string, userMessageId: string): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const userMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
        const taskId = userMessage?.taskId;
        if (!taskId) {
            return conv;
        }
        const ref = this.taskToConversation.get(taskId);
        this.taskRunner.cancel(taskId);
        for (const subtask of collectSubtasksForLeader(taskId, this.taskRunner.list())) {
            if (subtask.state === 'running') {
                this.taskRunner.cancel(subtask.id);
            }
        }
        const agentMessageId = ref?.agentMessageId;
        let next = this.appendRunCancelledTrace(conv, agentMessageId, 'Turn cancelled.');
        next = this.finalizeStreamingAgentMessage(next, agentMessageId, 'Turn cancelled.');
        next = {
            ...next,
            // Excludes this run itself, so the session stays streaming while peers work on.
            status: this.settleStatusForRun(id, taskId, 'idle'),
            updatedAt: Date.now(),
        };
        this.taskToConversation.delete(taskId);
        this.conversations.set(id, next);
        this.publishFinalizedAgentMessage(id, next, agentMessageId);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
    }

    rename(id: string, request: QaapRenameAgentConversationRequest): QaapAgentConversation | undefined {
        return this.update(id, { title: request.title });
    }

    /**
     * Patch a conversation's mutable flags (title, priority, paused). Pausing a streaming
     * conversation also cancels the in-flight task so it doesn't keep burning compute.
     */
    update(id: string, request: QaapUpdateAgentConversationRequest): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const patch: { -readonly [K in keyof QaapAgentConversation]?: QaapAgentConversation[K] } = {};
        if (request.title !== undefined) {
            const title = request.title.trim();
            if (!title) {
                return undefined;
            }
            patch.title = title;
        }
        if (request.priority !== undefined) {
            patch.priority = request.priority || undefined;
        }
        if (request.paused !== undefined) {
            patch.paused = request.paused || undefined;
            if (request.paused && conv.status === 'streaming') {
                const lastUser = [...conv.messages].reverse().find(m => m.role === 'user' && m.taskId);
                if (lastUser?.taskId) {
                    this.taskRunner.cancel(lastUser.taskId);
                }
                patch.status = 'idle';
            }
        }
        if (request.archived !== undefined) {
            patch.archived = request.archived || undefined;
        }
        if (request.autoApprove !== undefined) {
            patch.autoApprove = request.autoApprove ? undefined : false;
        }
        if (request.linkedPullRequest !== undefined) {
            patch.linkedPullRequest = request.linkedPullRequest ?? undefined;
        }
        if (request.agent !== undefined) {
            const normalized = this.taskRunner.normalizeAgentId(request.agent);
            if (!normalized) {
                return undefined;
            }
            patch.agentId = normalized;
            if (normalized !== conv.agentId && request.agentModel === undefined) {
                patch.agentModel = undefined;
                patch.qaiqModel = undefined;
            }
        }
        if (request.agentModel !== undefined) {
            const turnAgentId = patch.agentId ?? conv.agentId;
            if (agentSupportsModelPicker(turnAgentId)) {
                patch.agentModel = request.agentModel;
                patch.qaiqModel = request.agentModel;
            }
        }
        if (request.interactionModeId !== undefined) {
            const modeId = request.interactionModeId.trim();
            patch.interactionModeId = modeId || undefined;
        }
        if (request.approvalPolicyId !== undefined) {
            const policyId = request.approvalPolicyId.trim();
            patch.approvalPolicyId = policyId || undefined;
        }
        if (request.toolApprovalRules !== undefined) {
            patch.toolApprovalRules = {
                shell: request.toolApprovalRules.shell === true,
                network: request.toolApprovalRules.network === true,
            };
        }
        if (Object.keys(patch).length === 0) {
            return conv;
        }
        const next: QaapAgentConversation = { ...conv, ...patch, updatedAt: Date.now() };
        this.conversations.set(id, next);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
    }

    fork(id: string): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const now = Date.now();
        const forked: QaapAgentConversation = {
            ...conv,
            id: randomUUID(),
            title: `${conv.title} fork`,
            status: 'idle',
            createdAt: now,
            updatedAt: now,
            forkedFromId: conv.id,
            messages: conv.messages.map(message => ({
                ...message,
                id: randomUUID(),
                taskId: undefined,
                error: undefined,
            })),
        };
        this.conversations.set(forked.id, forked);
        this.fire({ type: 'created', conversation: toConversationSummary(forked) });
        void this.persist();
        return forked;
    }

    delete(id: string): boolean {
        const conv = this.conversations.get(id);
        if (!conv) {
            return false;
        }
        this.conversations.delete(id);
        for (const [taskId, ref] of this.taskToConversation) {
            if (ref.conversationId === id) {
                this.taskToConversation.delete(taskId);
            }
        }
        this.fire({ type: 'deleted', conversationId: id, cwd: conv.cwd });
        void fsp.rm(this.visualEvidenceDirectory(id), { recursive: true, force: true }).catch(() => undefined);
        void this.persist();
        return true;
    }

    protected visualEvidenceDirectory(conversationId: string): string {
        return visualEvidenceDirectoryHelper(conversationId);
    }

    /**
     * The agent message evidence may attach to. With an explicit target (the message the capturing
     * frontend saw when the turn settled) the conversation status is irrelevant — auto-continue or
     * a follow-up user turn may have flipped it back to `streaming` while the dev server was still
     * booting, and rejecting on status was silently dropping every slow capture. The target must
     * still be the newest agent reply: when a newer turn already replaced it, the stale screenshot
     * is dropped and the newer turn's own settlement re-triggers a fresh capture.
     */
    protected resolveVisualEvidenceTarget(
        conv: QaapAgentConversation,
        targetAgentMessageId: string | undefined,
    ): QaapAgentMessage | undefined {
        return resolveVisualEvidenceTargetHelper(conv, targetAgentMessageId);
    }

    protected attachVisualVerificationBlock(
        conv: QaapAgentConversation,
        target: QaapAgentMessage,
        markdown: string,
    ): QaapAgentConversation {
        const evidenceBlock = `---\n\n${markdown}`;
        const next: QaapAgentConversation = {
            ...conv,
            updatedAt: Date.now(),
            messages: conv.messages.map(message => message.id === target.id
                ? {
                    ...message,
                    content: `${message.content.trimEnd()}\n\n${evidenceBlock}`,
                    segments: message.segments?.length
                        ? [...message.segments, { type: 'text', content: evidenceBlock }]
                        : message.segments,
                }
                : message),
        };
        this.conversations.set(conv.id, next);
        this.publishFinalizedAgentMessage(conv.id, next, target.id);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
    }

    /** User turn whose agent reply owns the evidence target (array adjacency is only a legacy fallback). */
    protected resolveVisualRepairSourceUserMessage(
        conv: QaapAgentConversation,
        target: QaapAgentMessage,
    ): QaapAgentMessage | undefined {
        return resolveVisualRepairSourceUserMessageHelper(conv, target);
    }

    protected countVisualRepairAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number {
        return countVisualRepairAttemptsHelper(conv, rootUserMessageId);
    }

    protected buildVisualRepairPrompt(target: QaapAgentMessage, attempt: number): string {
        return buildVisualRepairPromptHelper(target, attempt);
    }

    /**
     * Fail closed after the durable repair budget is spent (or the shared turn budget refuses a
     * respawn). The failed screenshot remains attached to the reply and the same reply receives a
     * structured preview-failure trace, so evidence and terminal state cannot disagree.
     */
    protected async failVisualRepairLoop(
        conv: QaapAgentConversation,
        sourceUserMessage: QaapAgentMessage,
        target: QaapAgentMessage,
        reason: string,
    ): Promise<QaapAgentConversation> {
        const failed = this.markTurnFailed(conv, {
            userMessageId: sourceUserMessage.id,
            agentMessageId: target.id,
            reason,
            failureBody: target.content,
        });
        const next: QaapAgentConversation = {
            ...failed.conv,
            status: 'failed',
            updatedAt: Date.now(),
            messages: failed.conv.messages.map(message => message.id === target.id && message.role === 'agent'
                ? appendTracePreviewFailureEvent(message, reason)
                : message),
        };
        this.conversations.set(conv.id, next);
        this.publishFinalizedAgentMessage(conv.id, next, target.id, sourceUserMessage.turnAgentId);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        await this.persist();
        return next;
    }

    /**
     * Re-enter the same conversation/task runtime after a failed REAL render. Identity lives on the
     * generated user message, not in memory: `${sourceAgentMessageId}, attempt` is therefore durable
     * across backend restarts and makes duplicate browser/headless reports idempotent.
     */
    protected async continueVisualRepairLoop(
        conversationId: string,
        sourceAgentMessageId: string,
    ): Promise<QaapAgentConversation | undefined> {
        let conv = this.conversations.get(conversationId);
        if (!conv || conv.status === 'failed' || conv.paused) {
            return conv;
        }
        const target = conv.messages.find(message => message.id === sourceAgentMessageId && message.role === 'agent');
        if (!target?.content.includes(QAAP_VISUAL_REPAIR_REQUIRED_MARKER)) {
            return conv;
        }
        // One failure report can arrive from the frontend and headless runner at nearly the same
        // time. A persisted child turns every replay into a read-only return.
        if (conv.messages.some(message =>
            message.role === 'user' && message.visualRepairSourceAgentMessageId === sourceAgentMessageId
        )) {
            return conv;
        }
        const sourceUserMessage = this.resolveVisualRepairSourceUserMessage(conv, target);
        if (!sourceUserMessage) {
            return conv;
        }
        const rootUserMessageId = sourceUserMessage.visualRepairRootMessageId
            ?? sourceUserMessage.autoContinueRootMessageId
            ?? sourceUserMessage.id;
        const attempts = this.countVisualRepairAttempts(conv, rootUserMessageId);
        if (attempts >= MAX_VISUAL_REPAIR_ATTEMPTS) {
            return this.failVisualRepairLoop(conv, sourceUserMessage, target, nls.localize(
                'qaap/visualRepair/exhausted',
                'Visual verification is still failing after {0} automatic repair attempts. The app is not render-ready.',
                MAX_VISUAL_REPAIR_ATTEMPTS,
            ));
        }
        if (!this.hasLoopSpawnBudget(rootUserMessageId)) {
            return this.failVisualRepairLoop(conv, sourceUserMessage, target, nls.localize(
                'qaap/visualRepair/sharedBudgetExhausted',
                'Visual verification failed and the turn has exhausted its safe automatic retry budget. The app is not render-ready.',
            ));
        }
        // Persist evidence BEFORE any new process. If the backend dies here, restoreFromDisk finds
        // this marker again and resumes exactly one repair; if it dies after the child is persisted,
        // the source-message dedupe above prevents a second one.
        await this.persist();
        conv = this.conversations.get(conversationId);
        const latestTarget = conv?.messages.find(message => message.id === sourceAgentMessageId && message.role === 'agent');
        if (!conv || conv.status !== 'idle' || conv.paused || !latestTarget
            || conv.messages[conv.messages.length - 1]?.id !== sourceAgentMessageId
            || conv.messages.some(message =>
                message.role === 'user' && message.visualRepairSourceAgentMessageId === sourceAgentMessageId
            )) {
            // A user follow-up/cancel/pause won the race while evidence flushed. Never layer an
            // autonomous repair over their newer intent.
            return conv;
        }
        const attempt = attempts + 1;
        const turnAgentId = sourceUserMessage.turnAgentId ?? conv.agentId;
        this.recordLoopSpawn(rootUserMessageId);
        const next = this.postUserMessage(
            conversationId,
            this.buildVisualRepairPrompt(latestTarget, attempt),
            turnAgentId,
            sourceUserMessage.turnAgentModel
            ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined),
            conv.autoApprove,
            conv.interactionModeId,
            conv.approvalPolicyId,
            conv.toolApprovalRules,
            undefined,
            {
                autoContinueRootMessageId: rootUserMessageId,
                clientMessageId: `visual-repair:${sourceAgentMessageId}:${attempt}`,
                visualRepair: { rootUserMessageId, attempt, sourceAgentMessageId },
            },
        );
        await this.persist();
        return next;
    }

    /** Persist a same-origin preview screenshot and attach the authenticated image to the last reply. */
    async recordVisualVerification(
        conversationId: string,
        result: QaapPreviewVisualValidationResult,
        png: Buffer,
        targetAgentMessageId?: string,
    ): Promise<QaapAgentConversation | undefined> {
        const conv = this.conversations.get(conversationId);
        if (!conv || png.length === 0) {
            return undefined;
        }
        const target = this.resolveVisualEvidenceTarget(conv, targetAgentMessageId);
        if (!target) {
            return undefined;
        }
        if (agentMessageHasVisualVerificationMarker(target)) {
            return conv;
        }
        if (this.visualVerificationInFlight.has(conversationId)) {
            return conv;
        }
        this.visualVerificationInFlight.add(conversationId);
        try {
            const evidenceId = randomUUID();
            const directory = this.visualEvidenceDirectory(conversationId);
            await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
            await fsp.writeFile(path.join(directory, `${evidenceId}.png`), png, { mode: 0o600 });
            const imageUrl = `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}`
                + `/visual-verifications/${encodeURIComponent(evidenceId)}`;
            const next = this.attachVisualVerificationBlock(conv, target, buildQaapVisualVerificationMarkdown(imageUrl, result));
            return result.status === 'failed'
                ? await this.continueVisualRepairLoop(conversationId, target.id)
                : next;
        } finally {
            this.visualVerificationInFlight.delete(conversationId);
        }
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

    /** Attaches a recorded-tour evidence block referencing a stored webm. */
    async recordVisualVerificationVideo(
        conversationId: string,
        videoEvidenceId: string,
        steps: readonly { label: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
    ): Promise<QaapAgentConversation | undefined> {
        const conv = this.conversations.get(conversationId);
        if (!conv || !/^[a-f\d-]{36}$/i.test(videoEvidenceId)) {
            return undefined;
        }
        if (!fs.existsSync(path.join(this.visualEvidenceDirectory(conversationId), `${videoEvidenceId}.webm`))) {
            return undefined;
        }
        const target = this.resolveVisualEvidenceTarget(conv, targetAgentMessageId);
        if (!target) {
            return undefined;
        }
        if (agentMessageHasVisualVerificationMarker(target) || this.visualVerificationInFlight.has(conversationId)) {
            return conv;
        }
        this.visualVerificationInFlight.add(conversationId);
        try {
            const videoUrl = `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}`
                + `/visual-verifications/${encodeURIComponent(videoEvidenceId)}.webm`;
            const next = this.attachVisualVerificationBlock(conv, target, buildQaapVisualVideoMarkdown(videoUrl, steps));
            void this.sweepUnreferencedVisualEvidence(conversationId).catch(() => undefined);
            return steps.some(step => step.result.status === 'failed')
                ? await this.continueVisualRepairLoop(conversationId, target.id)
                : next;
        } finally {
            this.visualVerificationInFlight.delete(conversationId);
        }
    }

    /**
     * Resolves a served evidence file (`<uuid>` PNG or `<uuid>.webm` video) to its on-disk path.
     * The strict ref validation keeps the route traversal-proof.
     */
    resolveVisualVerificationFile(conversationId: string, evidenceRef: string): { path: string; contentType: string } | undefined {
        return resolveVisualVerificationFileHelper(this.conversations, conversationId, evidenceRef, this.visualEvidenceDirectory(conversationId));
    }

    /**
     * Attaches a walked-flow evidence block (one screenshot per route) to the settled reply.
     * Every step must reference a PNG previously stored via {@link saveVisualEvidenceImage}.
     */
    async recordVisualVerificationFlow(
        conversationId: string,
        steps: readonly { label: string; evidenceId: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
    ): Promise<QaapAgentConversation | undefined> {
        const conv = this.conversations.get(conversationId);
        if (!conv || steps.length === 0) {
            return undefined;
        }
        const target = this.resolveVisualEvidenceTarget(conv, targetAgentMessageId);
        if (!target) {
            return undefined;
        }
        if (agentMessageHasVisualVerificationMarker(target)) {
            return conv;
        }
        if (this.visualVerificationInFlight.has(conversationId)) {
            return conv;
        }
        this.visualVerificationInFlight.add(conversationId);
        try {
            const directory = this.visualEvidenceDirectory(conversationId);
            const evidenceSteps: QaapVisualFlowStepEvidence[] = [];
            for (const step of steps) {
                if (!/^[a-f\d-]{36}$/i.test(step.evidenceId)
                    || !fs.existsSync(path.join(directory, `${step.evidenceId}.png`))) {
                    return undefined;
                }
                evidenceSteps.push({
                    label: step.label,
                    imageUrl: `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}`
                        + `/visual-verifications/${encodeURIComponent(step.evidenceId)}`,
                    result: step.result,
                });
            }
            const next = this.attachVisualVerificationBlock(conv, target, buildQaapVisualFlowMarkdown(evidenceSteps));
            void this.sweepUnreferencedVisualEvidence(conversationId).catch(() => undefined);
            return evidenceSteps.some(step => step.result.status === 'failed')
                ? await this.continueVisualRepairLoop(conversationId, target.id)
                : next;
        } finally {
            this.visualVerificationInFlight.delete(conversationId);
        }
    }

    /**
     * Deletes stored PNGs that no message references and that are older than an hour —
     * leftovers of flows whose finalize never arrived (tab closed mid-walk, budget exhausted).
     * The age guard protects a concurrent tab that is still mid-upload.
     */
    protected async sweepUnreferencedVisualEvidence(conversationId: string): Promise<void> {
        return sweepUnreferencedVisualEvidenceHelper(this.conversations, conversationId, this.visualEvidenceDirectory(conversationId));
    }

    /**
     * Fail a turn's visual gate when no PNG/video could be produced. The note is durable evidence
     * in its own right: it clears the stale pending slot, carries `[QAAP repair required]`, and
     * re-enters the same bounded repair loop as a screenshot that proved the render was broken.
     */
    async recordVisualVerificationFailure(
        conversationId: string,
        reason: string,
        targetAgentMessageId: string,
    ): Promise<QaapAgentConversation | undefined> {
        const trimmed = reason.trim().slice(0, 500);
        const conv = this.conversations.get(conversationId);
        if (!conv || !trimmed) {
            return undefined;
        }
        const target = this.resolveVisualEvidenceTarget(conv, targetAgentMessageId);
        if (!target) {
            return undefined;
        }
        if (agentMessageHasVisualVerificationMarker(target) || this.visualVerificationInFlight.has(conversationId)) {
            return conv;
        }
        this.visualVerificationInFlight.add(conversationId);
        try {
            this.attachVisualVerificationBlock(conv, target, buildQaapVisualVerificationFailureMarkdown(trimmed));
            return await this.continueVisualRepairLoop(conversationId, target.id);
        } finally {
            this.visualVerificationInFlight.delete(conversationId);
        }
    }

    /**
     * Append a display-only user row for a git workflow (Commit & Push, etc.) without spawning
     * another agent turn. The marker is rendered as the amber git-action pill in the transcript.
     */
    recordGitAction(
        conversationId: string,
        metadata: ComposerGitActionDisplayMetadata,
        options: {
            readonly messageId?: string;
            readonly replaceMessageId?: string;
        } = {},
    ): QaapAgentConversation | undefined {
        return recordGitActionHelper(conversationId, metadata, options, {
            getConversation: id => this.conversations.get(id),
            setConversation: (id, c) => this.conversations.set(id, c),
            fire: e => this.fire(e),
            persist: () => this.persist(),
        });
    }

    readVisualVerification(conversationId: string, evidenceId: string): Buffer | undefined {
        if (!this.conversations.has(conversationId) || !/^[a-f\d-]{36}$/i.test(evidenceId)) {
            return undefined;
        }
        try {
            return fs.readFileSync(path.join(this.visualEvidenceDirectory(conversationId), `${evidenceId}.png`));
        } catch {
            return undefined;
        }
    }

    /**
     * Wire the spawned task's lifecycle to its conversation: on completion we read the task log
     * and append it as the agent reply; on failure/cancel we mark the turn as failed.
     */
    protected onTaskChanged(event: QaapAgentTaskEvent): void {
        const ref = this.taskToConversation.get(event.task.id);
        if (ref) {
            this.recordTaskLatencyMarks(ref.conversationId, event.task);
            if (event.type === 'output') {
                this.applyTaskOutput(event.task.id, ref, event.chunk);
                return;
            }
            const task = event.task;
            if (task.state === 'running') {
                return; // only react when the turn settles
            }
            this.taskToConversation.delete(task.id);
            // The graph settle is DEFERRED until the outcome flow finishes: a retriable failure
            // must become the run's `retry:model` edge (which steals the claim below), never a
            // premature terminal report racing the decision.
            void this.applyTaskOutcome(ref, task).then(
                outcome => this.settleChatTurnRun(task, outcome),
                error => {
                    // Materialization must not strand the control-plane run. Fall back to the raw
                    // task state when an unexpected projection error prevents finer classification.
                    this.settleChatTurnRun(task);
                    console.warn('[qaap-agent-conversation-store] failed to apply a task outcome:', error);
                },
            );
            return;
        }
        if (event.type === 'output' || event.type === 'created') {
            return;
        }
        const task = event.task;
        if (!task.parentId || task.state === 'running') {
            return;
        }
        void this.deliverSubtaskMailbox(task);
    }

    protected recordTaskLatencyMarks(conversationId: string, task: QaapAgentTask): void {
        for (const [mark, at] of Object.entries(task.latencyMarks ?? {})) {
            this.streamMetrics.recordLatencyMark(
                conversationId,
                mark as Parameters<QaapConversationStreamMetricsCollector['recordLatencyMark']>[1],
                at,
            );
        }
    }

    protected recordSubmitLatencyMarks(
        conversationId: string,
        latencyMarks: QaapCreateAgentConversationRequest['latencyMarks'] | undefined,
    ): void {
        for (const [mark, at] of Object.entries(latencyMarks ?? {})) {
            if (typeof at !== 'number' || !Number.isFinite(at)) {
                continue;
            }
            this.streamMetrics.recordLatencyMark(
                conversationId,
                mark as Parameters<QaapConversationStreamMetricsCollector['recordLatencyMark']>[1],
                at,
            );
        }
    }

    /**
     * When a delegated subtask (qaap-task with parentId) finishes, append its log to the leader
     * conversation so the next turn can synthesize results without polling task ids manually.
     */
    protected async deliverSubtaskMailbox(task: QaapAgentTask): Promise<void> {
        if (this.subtaskMailboxDelivered.has(task.id)) {
            return;
        }
        const leaderTaskId = this.resolveLeaderTaskId(task);
        const conversationId = leaderTaskId ? this.findConversationIdForLeaderTask(leaderTaskId) : undefined;
        if (!conversationId) {
            return;
        }
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return;
        }
        this.subtaskMailboxDelivered.add(task.id);
        const detail = await this.taskRunner.detail(task.id);
        const log = this.filterAgentLogChunk((detail?.log ?? '').trim());
        const leaderUserMessageId = leaderTaskId ? this.taskToConversation.get(leaderTaskId)?.userMessageId : undefined;
        const message: QaapAgentMessage = {
            id: randomUUID(),
            role: 'agent',
            content: formatSubtaskMailboxMessage(task, log),
            createdAt: Date.now(),
            // Belongs to the leader's run, which is not necessarily the last user message once a
            // peer run has posted one in the meantime.
            ...(leaderUserMessageId ? { runUserMessageId: leaderUserMessageId } : {}),
        };
        const next: QaapAgentConversation = {
            ...conv,
            messages: [...conv.messages, message],
            updatedAt: Date.now(),
        };
        this.conversations.set(conversationId, next);
        this.fire({ type: 'message', conversationId, cwd: next.cwd, message });
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        if (leaderTaskId) {
            this.maybeTriggerTeamSynthesis(leaderTaskId, conversationId);
        }
    }

    /** Walk parentId links until the leader turn task spawned for a user message. */
    protected resolveLeaderTaskId(task: QaapAgentTask): string | undefined {
        let leaderId = task.parentId;
        if (!leaderId) {
            return undefined;
        }
        const visited = new Set<string>();
        while (leaderId && !visited.has(leaderId)) {
            visited.add(leaderId);
            const parent = this.findTaskById(leaderId);
            if (parent?.parentId) {
                leaderId = parent.parentId;
            } else {
                return leaderId;
            }
        }
        return undefined;
    }

    protected findConversationIdForLeaderTask(leaderTaskId: string): string | undefined {
        const active = this.taskToConversation.get(leaderTaskId);
        if (active) {
            return active.conversationId;
        }
        for (const conv of this.conversations.values()) {
            if (conv.messages.some(message => message.role === 'user' && message.taskId === leaderTaskId)) {
                return conv.id;
            }
        }
        return undefined;
    }

    protected findTaskById(id: string): QaapAgentTask | undefined {
        return this.taskRunner.list().find(candidate => candidate.id === id);
    }

    /**
     * When every delegated subtask for a leader turn has settled (and mailbox entries were
     * appended), post an auto-synthesis user turn so the leader integrates results.
     */
    protected maybeTriggerTeamSynthesis(leaderTaskId: string, conversationId: string): void {
        if (this.teamSynthesisTriggeredForLeader.has(leaderTaskId)) {
            return;
        }
        const conv = this.conversations.get(conversationId);
        if (!conv || conv.paused) {
            return;
        }
        const subtasks = collectSubtasksForLeader(leaderTaskId, this.taskRunner.list());
        if (!areAllSubtasksSettled(subtasks)) {
            return;
        }
        if (!subtasks.every(subtask => this.subtaskMailboxDelivered.has(subtask.id))) {
            return;
        }
        if (conv.status === 'streaming') {
            this.pendingTeamSynthesisForLeader.add(leaderTaskId);
            return;
        }
        this.pendingTeamSynthesisForLeader.delete(leaderTaskId);
        this.teamSynthesisTriggeredForLeader.add(leaderTaskId);
        const synthesisMessage = buildTeamSynthesisUserMessage(subtasks.length, countFailedSubtasks(subtasks));
        try {
            this.postUserMessage(conversationId, synthesisMessage);
        } catch {
            this.teamSynthesisTriggeredForLeader.delete(leaderTaskId);
        }
    }

    protected finishLeaderTurnAndMaybeSynthesize(
        conversationId: string,
        leaderTaskId: string,
        next: QaapAgentConversation,
    ): void {
        this.conversations.set(conversationId, next);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        this.flushPersist();
        this.pendingTeamSynthesisForLeader.delete(leaderTaskId);
        this.maybeTriggerTeamSynthesis(leaderTaskId, conversationId);
    }

    protected applyTaskOutput(
        taskId: string,
        ref: QaapConversationTaskRef,
        chunk: string,
    ): void {
        const conv = this.conversations.get(ref.conversationId);
        const filtered = this.filterAgentLogChunk(chunk);
        if (!conv || !filtered) {
            return;
        }
        const agentId = ref.turnAgentId;
        if (usesAgUiCliTranscriptStream(agentId)) {
            this.applyAgUiTaskOutput(taskId, ref, filtered, agentId);
            return;
        }
        const now = Date.now();
        const usesSegmentStream = usesStructuredAgentTranscript(agentId);
        let content: string;
        let segments: QaapAgentMessage['segments'];
        const stream = this.ensureAgentStream(taskId, agentId);
        if (stream) {
            stream.push(filtered);
            segments = [...stream.getSegments()];
            content = stream.getDisplayText();
        } else {
            content = filtered;
            segments = undefined;
        }
        if (!content && (!segments || segments.length === 0)) {
            return;
        }
        const existingAgentMessage = ref.agentMessageId
            ? conv.messages.find(message => message.id === ref.agentMessageId)
            : undefined;
        const traceEvents = usesSegmentStream && stream
            ? mergeAccumulatorTraceEvents(existingAgentMessage?.traceEvents, stream)
            : usesSegmentStream && segments?.length
                ? mergeSegmentTraceEvents(existingAgentMessage?.traceEvents, segments)
                : undefined;
        let agentMessageId = ref.agentMessageId;
        let messages: QaapAgentMessage[];
        if (!agentMessageId) {
            agentMessageId = randomUUID();
            ref.agentMessageId = agentMessageId;
            this.taskToConversation.set(taskId, ref);
            const message: QaapAgentMessage = preferTraceFirstAgentMessageStorage({
                id: agentMessageId,
                role: 'agent',
                content: content || '…',
                segments,
                ...(traceEvents ? { traceEvents } : {}),
                createdAt: now,
                // The run that owns this message. Sealed here, at creation, because the append
                // position stops identifying the turn as soon as a peer run interleaves.
                runUserMessageId: ref.userMessageId,
                // Marks the message as the live end of a run. With several agents in one session
                // the conversation status can no longer say which turns are still working, and the
                // per-run stop must only appear on the ones that are.
                runActive: true,
            });
            messages = [...conv.messages, message];
            this.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, message);
        } else {
            messages = conv.messages.map(message => message.id === agentMessageId
                ? preferTraceFirstAgentMessageStorage({
                    ...message,
                    content: usesSegmentStream ? (content || message.content) : `${message.content}${filtered}`,
                    segments: usesSegmentStream ? (segments ?? message.segments) : undefined,
                    ...(usesSegmentStream && traceEvents ? { traceEvents } : {}),
                })
                : message
            );
            const updated = messages.find(message => message.id === agentMessageId);
            if (updated) {
                this.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, updated);
            }
        }
        const next: QaapAgentConversation = {
            ...conv,
            status: 'streaming',
            updatedAt: now,
            messages,
            ...(totalTokensFromContextUsage(conv.contextUsage) === 0 ? { contextUsageEstimated: true } : {}),
            contextWindowSize: conv.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
        };
        this.conversations.set(conv.id, next);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        this.schedulePersist();
    }

    /** Structured CLI stdout → AG-UI reducer (traceEvents-only wire path). */
    protected applyAgUiTaskOutput(
        taskId: string,
        ref: QaapConversationTaskRef,
        chunk: string,
        agentId: string,
    ): void {
        const usageStream = this.ensureAgentStream(taskId, agentId);
        usageStream?.push(chunk);
        const emitter = this.ensureAgUiStream(taskId, agentId);
        const events = emitter.push(chunk);
        if (events.length === 0) {
            this.applyAccumulatorStructuredOutput(taskId, ref, agentId);
            return;
        }
        let conv = this.conversations.get(ref.conversationId);
        if (!conv) {
            return;
        }
        const previousAgentMessageId = ref.agentMessageId;
        for (const event of events) {
            // `ref` is passed (not just its ids) so the event lands on THIS run's agent message
            // and so a message created here is written back onto the ref. Resolving the target
            // from the array tail instead would make every concurrent run of the session
            // converge on whichever agent message happens to be last, merging their output.
            const next = this.applyAgUiTranscriptEvent(ref.conversationId, event, ref);
            if (next) {
                conv = next;
            }
        }
        if (ref.agentMessageId !== previousAgentMessageId) {
            this.taskToConversation.set(taskId, ref);
        }
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

    protected parseStructuredLog(
        agentId: string,
        log: string,
    ): {
        content: string;
        segments: QaapAgentMessage['segments'];
        traceEvents: QaapAgentMessage['traceEvents'];
    } | undefined {
        return parseStructuredLogHelper(agentId, log);
    }

    /** When AG-UI event mapping is empty but the segment accumulator parsed NDJSON, persist that snapshot. */
    protected applyAccumulatorStructuredOutput(
        taskId: string,
        ref: QaapConversationTaskRef,
        agentId: string,
    ): void {
        applyAccumulatorStructuredOutputHelper(taskId, ref, agentId, {
            conversations: this.conversations,
            agentStreamByTaskId: this.agentStreamByTaskId,
            taskToConversation: this.taskToConversation,
            fireAgentMessageWireUpdate: (cid, cwd, aid, msg) => this.fireAgentMessageWireUpdate(cid, cwd, aid, msg),
            fire: e => this.fire(e),
            schedulePersist: () => this.schedulePersist(),
        });
    }

    protected backfillAgentMessageFromStructuredLog(
        message: QaapAgentMessage,
        agentId: string,
        log: string,
    ): QaapAgentMessage {
        if (message.role !== 'agent' || agentMessageHasStructuredTrace(message) || message.content?.trim()) {
            return message;
        }
        const parsed = this.parseStructuredLog(agentId, log);
        if (parsed?.segments?.length || parsed?.traceEvents?.length) {
            return materializeAgentMessageForApi({
                ...message,
                content: parsed.content || message.content,
                segments: parsed.segments,
                traceEvents: this.resolveStructuredParsedTraceEvents(message, parsed),
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

    protected resolveStructuredParsedTraceEvents(
        message: QaapAgentMessage,
        parsed: {
            segments?: QaapAgentMessage['segments'];
            traceEvents?: QaapAgentMessage['traceEvents'];
        },
    ): QaapAgentMessage['traceEvents'] {
        return resolveStructuredParsedTraceEventsHelper(message, parsed);
    }

    protected async applyTaskOutcome(
        ref: QaapConversationTaskRef,
        task: QaapAgentTask,
    ): Promise<QaapWorkflowNodeOutcome> {
        const { conversationId, userMessageId, agentMessageId, turnAgentId, startSha } = ref;
        const convSnapshot = this.conversations.get(conversationId);
        if (!convSnapshot) {
            return resolveChatTurnOutcome(task.state);
        }
        // Defense-in-depth: a newer task may have superseded this one — but only when it took
        // over the SAME user turn (that is what the model-fallback retry does). Peer runs started
        // by the user carry a different user message and are not superseding anything, so with
        // in-session multitasking "some other task is active" can no longer mean "stale".
        if (this.hasActiveTaskForUserMessage(conversationId, userMessageId, task.id)) {
            this.agentStreamByTaskId.delete(task.id);
            this.agUiStreamByTaskId.delete(task.id);
            return resolveChatTurnOutcome(task.state);
        }
        const usageFinalized = this.finalizeTurnContextUsage(convSnapshot, task.id, turnAgentId);
        this.agentStreamByTaskId.delete(task.id);
        this.agUiStreamByTaskId.delete(task.id);
        const conv = this.conversations.get(conversationId);
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
            const withCancelledTrace = this.appendRunCancelledTrace(withUsageBaseline, agentMessageId, cancelledReason);
            const finalized = this.finalizeStreamingAgentMessage(withCancelledTrace, agentMessageId, cancelledReason);
            const next: QaapAgentConversation = {
                ...finalized,
                status: this.settleStatusForRun(conversationId, task.id, 'idle'),
                updatedAt: Date.now(),
            };
            this.publishFinalizedAgentMessage(conversationId, next, agentMessageId, turnAgentId);
            // Do not auto-synthesize after a cancelled leader — that would spawn a new turn
            // right after the user hit Stop (and feels like cancel "did nothing").
            this.conversations.set(conversationId, next);
            this.fire({ type: 'updated', conversation: toConversationSummary(next) });
            this.flushPersist();
            this.pendingTeamSynthesisForLeader.delete(task.id);
            return 'blocked';
        }
        const detail = await this.taskRunner.detail(task.id);
        // Re-read across the await: with in-session multitasking a PEER run can stream into this
        // same conversation while we wait for the task detail, and everything below derives what
        // it writes back from this baseline. Keeping the pre-await snapshot would silently drop
        // the other agent's output (read-modify-write over one shared conversation record).
        const latest = this.conversations.get(conversationId);
        if (!latest) {
            return resolveChatTurnOutcome(task.state);
        }
        withUsageBaseline = {
            ...latest,
            contextUsage: usageFinalized.contextUsage,
            contextUsageEstimated: usageFinalized.contextUsageEstimated,
            contextWindowSize: usageFinalized.contextWindowSize,
        };
        const log = this.filterAgentLogChunk((detail?.log ?? '').trim());
        const streamingAgent = agentMessageId
            ? withUsageBaseline.messages.find(message => message.id === agentMessageId)
            : undefined;
        const skipLogReparse = agentMessageHasStructuredTrace(streamingAgent)
            || (usesStructuredAgentTranscript(turnAgentId) && (
                (streamingAgent?.segments?.length ?? 0) > 0
                || (streamingAgent?.traceEvents?.length ?? 0) > 0
            ));
        const structuredParsed = log && !skipLogReparse ? this.parseStructuredLog(turnAgentId, log) : undefined;
        // 'completed_with_warnings' (clean exit, verification still red) is a delivered turn:
        // it takes the success path below — with a warning trace instead of the failure flow.
        // Exception: CLI blocking failures that still exit 0 — auth/session (Sign-in card),
        // and quota/rate-limit (Task failed dialog). Antigravity often prints a plain
        // "Individual quota reached…" line and exits 0; never treat that as success.
        const completedAuthFailureReason = (task.state === 'completed' || task.state === 'completed_with_warnings')
            ? this.resolveCompletedTurnAuthFailureReason(log)
            : undefined;
        if ((task.state !== 'completed' && task.state !== 'completed_with_warnings') || completedAuthFailureReason) {
            let convForFailure = withUsageBaseline;
            let agentMessageForFailure = streamingAgent;
            if (agentMessageId && log && streamingAgent?.role === 'agent' && !agentMessageHasStructuredTrace(streamingAgent)) {
                const backfilled = materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(
                    this.backfillAgentMessageFromStructuredLog(streamingAgent, turnAgentId, log),
                ));
                agentMessageForFailure = backfilled;
                convForFailure = {
                    ...withUsageBaseline,
                    messages: withUsageBaseline.messages.map(message => message.id === agentMessageId
                        ? backfilled
                        : message),
                };
            }
            if (await this.maybeRetryTurnWithFallback(
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
            const failed = this.markTurnFailed(convForFailure, {
                userMessageId,
                agentMessageId,
                reason,
                failureBody,
                status: this.settleStatusForRun(conversationId, task.id, 'failed'),
            });
            const resolvedAgentMessageId = failed.agentMessageId ?? agentMessageId;
            const finalized = this.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
            this.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId, turnAgentId);
            this.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
            return 'fail';
        }
        let withReply: QaapAgentConversation;
        if (agentMessageId && structuredParsed) {
            const messages = withUsageBaseline.messages.map(message => message.id === agentMessageId
                ? syncSettledTraceEventsOnMessage({
                    ...message,
                    content: structuredParsed.content || message.content,
                    segments: structuredParsed.segments,
                    traceEvents: this.resolveStructuredParsedTraceEvents(message, structuredParsed),
                })
                : message
            );
            withReply = {
                ...withUsageBaseline,
                status: this.settleStatusForRun(conversationId, task.id, 'idle'),
                updatedAt: Date.now(),
                messages,
            };
        } else if (agentMessageId) {
            const messages = withUsageBaseline.messages.map(message => {
                if (message.id !== agentMessageId || message.role !== 'agent') {
                    return message;
                }
                const backfilled = log
                    ? this.backfillAgentMessageFromStructuredLog(message, turnAgentId, log)
                    : message;
                return materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(backfilled));
            });
            withReply = {
                ...withUsageBaseline,
                status: this.settleStatusForRun(conversationId, task.id, 'idle'),
                updatedAt: Date.now(),
                messages,
            };
        } else {
            const displayText = log ? resolveAgentLogDisplayText(turnAgentId, log) : '';
            const body = structuredParsed?.content?.trim() || displayText || '(agent produced no output)';
            const reply = this.appendAgentReply(
                { ...withUsageBaseline, status: this.settleStatusForRun(conversationId, task.id, 'idle') },
                body,
                userMessageId,
            );
            if (structuredParsed?.segments?.length) {
                const messages = reply.messages.map((message, index, all) => {
                    if (index === all.length - 1 && message.role === 'agent') {
                        return syncSettledTraceEventsOnMessage({
                            ...message,
                            segments: structuredParsed.segments,
                            traceEvents: this.resolveStructuredParsedTraceEvents(message, structuredParsed),
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
            if (await this.maybeRetryTurnWithFallback(
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
            const failed = this.markTurnFailed(withReply, {
                userMessageId,
                agentMessageId: settledAgentMessage.id,
                reason,
                status: this.settleStatusForRun(conversationId, task.id, 'failed'),
            });
            const resolvedAgentMessageId = failed.agentMessageId ?? settledAgentMessage.id;
            const finalized = this.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
            this.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId, turnAgentId);
            this.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
            return 'fail';
        }
        const gitStats = this.computeGitDiffStats(conv.cwd, startSha);
        if (gitStats) {
            withReply = { ...withReply, gitDiffAdded: gitStats.added, gitDiffRemoved: gitStats.removed };
        }
        const userMessage = withReply.messages.find(m => m.id === userMessageId);
        const checkpoint = this.captureCheckpoint(
            withReply.cwd,
            conversationId,
            userMessageId,
            userMessage ? this.checkpointLabel(userMessage.content ?? '') : 'Turn',
            gitStats,
        );
        if (checkpoint) {
            withReply = { ...withReply, checkpoints: [...(withReply.checkpoints ?? []), checkpoint] };
            withReply = this.appendCheckpointTrace(withReply, agentMessageId, checkpoint);
        }
        if (task.verification?.status === 'failed') {
            withReply = this.appendVerificationWarningTrace(withReply, agentMessageId, task);
        }
        if (task.review?.status === 'failed') {
            withReply = this.appendReviewTrace(withReply, agentMessageId,
                `Independent review rejected the change: ${task.review.reason || 'no reason given'}`);
        } else if (task.review?.status === 'inconclusive') {
            withReply = this.appendReviewTrace(withReply, agentMessageId,
                'Independent review ran but produced no verdict — the result was not double-checked.');
        }
        // Blocked wins over the verification warning (more urgent for the user), but any warning
        // trace appended above is preserved — both facts stay visible in the transcript.
        const blockedNeed = this.detectAgentBlockedNeed(withReply, agentMessageId);
        if (blockedNeed !== undefined) {
            withReply = this.appendBlockedTrace(withReply, agentMessageId, blockedNeed);
        }
        const finalizedAgentMessageId = settledAgentMessage?.id ?? agentMessageId;
        withReply = this.clearRunActive(withReply, finalizedAgentMessageId);
        this.conversations.set(conversationId, withReply);
        this.publishFinalizedAgentMessage(conversationId, withReply, finalizedAgentMessageId, turnAgentId);
        this.modelFallbackTriedByUserMessage.delete(this.resolveLoopBudgetKey(withReply, userMessageId));
        this.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, withReply);
        if (blockedNeed !== undefined) {
            // The agent explicitly asked for the user — reclassify the task and never auto-continue
            // on top of a question only the user can answer.
            this.taskRunner.markTaskBlocked(task.id);
            return 'blocked';
        }
        if (task.state === 'completed_with_warnings') {
            // The backend verification loop already spent its fix-turn budget on this turn; the
            // text-heuristic auto-continue is blind to that verdict and would just re-prompt
            // "keep going" on top of a known-red build. Leave the decision to the user.
            return 'success:warned';
        }
        this.maybeAutoContinueIncompleteTurn(
            conversationId,
            withReply,
            userMessageId,
            finalizedAgentMessageId,
            turnAgentId,
        );
        return 'success';
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

    /**
     * Route a failed / tool-broken turn to the next curated model. With the ADR-002 turnstile on
     * the decision ledger is the chat-turn run ({@link maybeRetryTurnWithFallbackModelViaGraph});
     * otherwise the imperative branch below runs untouched.
     */
    protected async maybeRetryTurnWithFallback(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,
    ): Promise<boolean> {
        if (this.isTurnGraphEnabled() && this.workflowRuns) {
            return this.maybeRetryTurnWithFallbackModelViaGraph(
                conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
            );
        }
        return this.maybeRetryTurnWithFallbackModel(
            conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
        );
    }

    protected maybeRetryTurnWithFallbackModel(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,
    ): boolean {
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
        const loopBudgetKey = this.resolveLoopBudgetKey(conv, userMessageId);
        if (!this.hasLoopSpawnBudget(loopBudgetKey)) {
            this.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        const turnUserMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
        const currentModel = turnUserMessage?.turnAgentModel
            ?? resolveTaskAgentModel(task)
            ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined);
        const tried = this.modelFallbackTriedByUserMessage.get(loopBudgetKey) ?? new Set<string>();
        const currentKey = agentModelKey(currentModel);
        if (currentKey) {
            tried.add(currentKey);
        }
        const nextModel = resolveNextFallbackAgentModel(turnAgentId, currentModel, tried);
        if (!nextModel) {
            this.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
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
            spawned = this.taskRunner.create(
                this.buildTaskCreateRequest(retryConv, turnAgentId, undefined, userMessageId),
                retryConv.ownerLogin,
            );
        } catch {
            return false;
        }
        this.recordLoopSpawn(loopBudgetKey);
        const nextKey = agentModelKey(nextModel);
        if (nextKey) {
            tried.add(nextKey);
        }
        this.modelFallbackTriedByUserMessage.set(loopBudgetKey, tried);
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
        this.conversations.set(conversationId, nextConv);
        // The re-attributed user message is the only carrier of the new provenance: the `updated`
        // summary below has no `messages` (see toConversationSummary), so without this frame every
        // tab except the one that polls keeps badging the turn with the model that just failed.
        const resealedUserMessage = messagesWithTask.find(message => message.id === userMessageId);
        if (resealedUserMessage) {
            this.fire({ type: 'message', conversationId, cwd: nextConv.cwd, message: resealedUserMessage });
        }
        this.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        this.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
            startSha,
        });
        void this.persist();
        return true;
    }

    protected postAutoContinueMessage(
        conversationId: string,
        content: string,
        conv: QaapAgentConversation,
        rootUserMessageId: string,
        turnAgentId: string,
        turnAgentModel: QaapAgentMessage['turnAgentModel'],
    ): QaapAgentConversation {
        return this.postUserMessage(
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

    protected maybeAutoContinueIncompleteTurn(
        conversationId: string,
        conv: QaapAgentConversation,
        userMessageId: string,
        agentMessageId?: string,
        turnAgentId?: string,
    ): void {
        maybeAutoContinueIncompleteTurnHelper(conversationId, conv, userMessageId, agentMessageId, turnAgentId, {
            resolveLoopBudgetKey: (c, u) => this.resolveLoopBudgetKey(c, u),
            countAutoContinueAttempts: (c, u) => this.countAutoContinueAttempts(c, u),
            hasLoopSpawnBudget: u => this.hasLoopSpawnBudget(u),
            recordLoopSpawn: u => this.recordLoopSpawn(u),
            postAutoContinueMessage: (cid, p, c, r, t, m) => this.postAutoContinueMessage(cid, p, c, r, t, m),
            reportPreviewBootstrapFailure: (cid, r) => this.reportPreviewBootstrapFailure(cid, r),
        });
    }

    /**
     * Terminal state when Qaap bootstrap cannot attach a dev preview after the agent turn finished.
     * Idempotent while the conversation is already failed with the same tail error.
     */
    reportPreviewBootstrapFailure(conversationId: string, reason: string): QaapAgentConversation | undefined {
        const trimmed = reason.trim();
        if (!trimmed) {
            return undefined;
        }
        const conv = this.conversations.get(conversationId);
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
        if (conv.status === 'streaming' && !isConversationTurnVisuallySettled(conv)) {
            return undefined;
        }
        const failed = this.markTurnFailed(conv, {
            userMessageId: lastUser.id,
            agentMessageId: lastAgent.id,
            reason: trimmed,
            failureBody: lastAgent.content,
        });
        let next = this.finalizeStreamingAgentMessage(failed.conv, lastAgent.id, trimmed);
        next = {
            ...next,
            messages: next.messages.map(message => message.id === lastAgent.id && message.role === 'agent'
                ? appendTracePreviewFailureEvent(message, trimmed)
                : message),
        };
        this.conversations.set(conversationId, next);
        this.publishFinalizedAgentMessage(conversationId, next, lastAgent.id);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
    }

    protected appendAgentReply(
        conv: QaapAgentConversation,
        content: string,
        /** The run this reply answers — see {@link QaapAgentMessage.runUserMessageId}. */
        runUserMessageId?: string,
    ): QaapAgentConversation {
        return appendAgentReplyHelper(conv, content, runUserMessageId);
    }

    /** Fail a just-posted turn synchronously (no task spawned) and publish the failed message. */
    protected failTurnBeforeSpawn(
        id: string,
        conv: QaapAgentConversation,
        userMessageId: string,
        reason: string,
    ): QaapAgentConversation {
        const failed = this.markTurnFailed(conv, {
            userMessageId,
            reason,
        });
        const next = failed.conv;
        this.conversations.set(id, next);
        const agentMessage = failed.agentMessageId
            ? next.messages.find(entry => entry.id === failed.agentMessageId)
            : undefined;
        if (agentMessage) {
            this.fire({ type: 'message', conversationId: id, cwd: next.cwd, message: agentMessage });
        }
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
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

    protected markTurnFailed(
        conv: QaapAgentConversation,
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
        },
    ): { readonly conv: QaapAgentConversation; readonly agentMessageId?: string } {
        return markTurnFailedHelper(conv, options);
    }

    protected finalizeStreamingAgentMessage(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        interruptionReason: string,
    ): QaapAgentConversation {
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
            if (next.runActive) {
                next = { ...next, runActive: undefined };
            }
            return next;
        });
        return { ...conv, messages };
    }

    /** Drops the live-run marker once a run's message is settled (success path). */
    protected clearRunActive(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
    ): QaapAgentConversation {
        return clearRunActiveHelper(conv, agentMessageId);
    }

    protected appendRunCancelledTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        reason: string,
    ): QaapAgentConversation {
        return appendRunCancelledTraceHelper(conv, agentMessageId, reason);
    }

    /**
     * Returns what the agent said it needs when its final message ends with the blocked-signal
     * sentinel (see {@code buildAgentBlockedSignalPromptBlock}), or {@code undefined} otherwise.
     * Checks the streaming agent message when its id is known, else the last agent message; for
     * segment-first agents whose {@code content} is empty, the last text segment is checked.
     */
    protected detectAgentBlockedNeed(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
    ): string | undefined {
        return detectAgentBlockedNeedHelper(conv, agentMessageId);
    }

    protected appendReviewTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        note: string,
    ): QaapAgentConversation {
        return appendReviewTraceHelper(conv, agentMessageId, note);
    }

    protected appendBlockedTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        need: string,
    ): QaapAgentConversation {
        return appendBlockedTraceHelper(conv, agentMessageId, need);
    }

    /**
     * Timeline note for a turn delivered with the backend verification still red
     * ({@code task.state === 'completed_with_warnings'}). Falls back to the last message when the
     * streaming agent message id is gone (e.g. the turn was backfilled from the log).
     */
    protected appendVerificationWarningTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
    ): QaapAgentConversation {
        return appendVerificationWarningTraceHelper(conv, agentMessageId, task);
    }

    protected appendCheckpointTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        checkpoint: QaapConversationCheckpoint,
    ): QaapAgentConversation {
        return appendCheckpointTraceHelper(conv, agentMessageId, checkpoint);
    }

    protected publishFinalizedAgentMessage(
        conversationId: string,
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        turnAgentId?: string,
    ): void {
        if (!agentMessageId) {
            return;
        }
        const agentMessage = conv.messages.find(message => message.id === agentMessageId);
        if (agentMessage) {
            this.fireAgentMessageWireUpdate(
                conversationId,
                conv.cwd,
                turnAgentId ?? this.resolveAgentIdForAgentMessage(conv, agentMessage),
                agentMessage,
                { forceFullMessage: true },
            );
            this.lastWireMessageById.delete(agentMessage.id);
            this.clearAgUiReducer(agentMessage.id);
        }
    }

    protected resolveAgentIdForAgentMessage(conv: QaapAgentConversation, agentMessage: QaapAgentMessage): string {
        return resolveAgentIdForAgentMessageHelper(conv, agentMessage);
    }

    /** Agent for the current user turn: `@mention` in this message beats the picker, then stored agent. */
    protected resolveTurnAgent(conv: QaapAgentConversation, userContent: string, explicit?: string): string {
        const fromMention = this.extractAgentMentionFromUserMessage(userContent);
        if (fromMention) {
            return fromMention;
        }
        const explicitId = explicit?.trim();
        if (explicitId && this.isKnownAgentId(explicitId)) {
            return explicitId;
        }
        if (this.isKnownAgentId(conv.agentId)) {
            return conv.agentId;
        }
        return this.taskRunner.defaultAgent();
    }

    protected isKnownAgentId(agentId: string): boolean {
        return !!this.taskRunner.normalizeAgentId(agentId);
    }

    protected extractAgentMentionFromUserMessage(content: string): string | undefined {
        const regex = /@([a-z][\w-]*)/gi;
        let last: string | undefined;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            const token = this.taskRunner.normalizeAgentId(match[1]);
            if (token) {
                last = token;
            }
        }
        return last;
    }

    protected prepareContextCompactionForTurn(conv: QaapAgentConversation): QaapAgentConversation {
        return prepareContextCompactionForTurnHelper(conv, {
            conversations: this.conversations,
            fire: e => this.fire(e),
            buildContextCompactionSummary: m => this.buildContextCompactionSummary(m),
        });
    }

    protected buildContextCompactionSummary(messages: readonly QaapAgentMessage[]): string {
        return buildContextCompactionSummaryHelper(messages);
    }

    protected contextCompactionMessageText(message: QaapAgentMessage): string {
        return contextCompactionMessageTextHelper(message);
    }

    protected buildTaskCreateRequest(
        conv: QaapAgentConversation,
        turnAgentId: string,
        latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'],
        turnUserMessageId?: string,
    ): QaapCreateAgentTaskRequest {
        return buildTaskCreateRequestHelper(conv, turnAgentId, latencyMarks, turnUserMessageId, {
            stripLeadingAgentMention: c => this.stripLeadingAgentMention(c),
            buildPrompt: (c, a) => this.buildPrompt(c, a),
        });
    }

    protected stripLeadingAgentMention(content: string): string {
        const match = /^@([a-z][\w-]*)\b\s*/i.exec(content);
        if (match && this.taskRunner.normalizeAgentId(resolveQaapAgentMentionToken(match[1]))) {
            return content.slice(match[0].length).trim() || content.trim();
        }
        return content.trim();
    }

    /**
     * Build the agent prompt for the upcoming turn. The chosen format is a plain transcript with
     * role-tagged blocks: every coding-agent CLI we support (`claude -p`, `codex exec`, `grok -p`)
     * accepts free-form text as a single shell-quoted argument, so an explicit transcript is the
     * most robust way to carry multi-turn context without depending on agent-specific resume APIs.
     */
    protected buildPrompt(conv: QaapAgentConversation, turnAgentId = conv.agentId): string {
        const lastUser = conv.messages[conv.messages.length - 1];
        const skipDelegation = isTeamSynthesisUserMessage(lastUser.content);
        const compaction = conv.contextCompaction?.status === 'complete' && conv.contextCompaction.summary?.trim()
            ? conv.contextCompaction
            : undefined;
        const historyStart = compaction?.compactedMessageCount ?? 0;
        const history = conv.messages.slice(historyStart, -1);
        const latestUser = this.stripLeadingAgentMention(lastUser.content);
        if (history.length === 0) {
            const prompt = compaction
                ? `${this.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)}\n\nNow respond to the latest user message:\n\nUSER: ${latestUser}`
                : latestUser;
            return skipDelegation ? prompt : this.appendTeamDelegation(prompt, turnAgentId);
        }
        const transcript = buildConversationAgentPrompt({
            history,
            latestUserContent: latestUser,
            contextPreamble: compaction
                ? this.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)
                : conv.contextPreamble,
            contextWindowSize: conv.contextWindowSize,
        });
        return skipDelegation ? transcript : this.appendTeamDelegation(transcript, turnAgentId);
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

    /**
     * The agent message an AG-UI event belongs to, for a known run: the one the run already owns,
     * else the one sealed to its user turn (a backend restart loses `ref.agentMessageId` but not
     * the sealed link), else none — the caller creates one.
     *
     * Deliberately never falls back to "the last message if it is an agent message": that is what
     * made two runs of the same session write into one message.
     */
    protected resolveRunAgentMessageId(
        conv: QaapAgentConversation,
        run: { readonly userMessageId: string; readonly agentMessageId?: string },
    ): string | undefined {
        return resolveRunAgentMessageIdHelper(conv, run);
    }

    /**
     * Apply one AG-UI event onto a streaming agent message — emits incremental wire deltas
     * (append/patch_trace_event) instead of full message replacements when possible.
     *
     * `run` identifies which of the session's concurrent runs the event came from; without it
     * (the external `POST .../ag-ui/events` route, which has no run context) the event falls back
     * to the tail agent message, as before.
     */
    applyAgUiTranscriptEvent(
        conversationId: string,
        event: QaapAgUiEvent,
        /** Mutated in place: an agent message created here is written back onto the run's ref. */
        run?: { readonly userMessageId: string; readonly turnAgentId?: string; agentMessageId?: string },
    ): QaapAgentConversation | undefined {
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const now = Date.now();
        let agentMessageId = run
            ? this.resolveRunAgentMessageId(conv, run)
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
            this.agUiReducerByAgentMessageId.delete(agentMessageId);
        }
        const previousReducer = this.agUiReducerByAgentMessageId.get(agentMessageId);
        const previousMessage = messages.find(message => message.id === agentMessageId);
        const agentId = run?.turnAgentId
            ?? (previousMessage ? this.resolveAgentIdForAgentMessage(conv, previousMessage) : conv.agentId);
        const { next: reducer } = reduceQaapAgUiTranscriptEvent(previousReducer, event, {
            agentMessageId,
            createdAt: previousMessage?.createdAt ?? now,
            agentId,
        });
        this.agUiReducerByAgentMessageId.set(agentMessageId, reducer);
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
        this.conversations.set(conversationId, next);
        this.fireAgentMessageWireUpdate(conversationId, next.cwd, agentId, agentMessage);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        this.schedulePersist();
        return next;
    }

    protected clearAgUiReducer(agentMessageId: string | undefined): void {
        if (agentMessageId) {
            this.agUiReducerByAgentMessageId.delete(agentMessageId);
        }
    }

    protected stageWireMetricsBaseline(
        conversationId: string,
        messageId: string,
        baseline: QaapAgentConversationEvent,
    ): void {
        this.wireMetricsBaselines.set(`${conversationId}:${messageId}`, baseline);
    }

    protected recordStreamMetrics(event: QaapAgentConversationEvent): void {
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
        const baseline = baselineKey ? this.wireMetricsBaselines.get(baselineKey) : undefined;
        if (baselineKey) {
            this.wireMetricsBaselines.delete(baselineKey);
        }
        this.streamMetrics.recordWireEvent(conversationId, event.type, event, {
            uncompressedPayload: baseline,
            compressedFieldCount: countCompressedWireFields(event),
        });
        if (event.type === 'updated' && event.conversation.status !== 'streaming') {
            logQaapStreamMetrics(this.streamMetrics.finishTurn(conversationId));
        }
    }

    protected fireAgentMessageWireUpdate(
        conversationId: string,
        cwd: string,
        agentId: string,
        message: QaapAgentMessage,
        options?: { forceFullMessage?: boolean },
    ): void {
        fireAgentMessageWireUpdateHelper(conversationId, cwd, agentId, message, options, {
            lastWireMessageById: this.lastWireMessageById,
            stageWireMetricsBaseline: (cid, mid, evt) => this.stageWireMetricsBaseline(cid, mid, evt),
            fire: e => this.fire(e),
        });
    }

    protected schedulePersist(): void {
        if (this.persistTimer !== undefined) {
            return;
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            void this.persist();
        }, STREAMING_PERSIST_DEBOUNCE_MS);
    }

    protected flushPersist(): void {
        if (this.persistTimer !== undefined) {
            clearTimeout(this.persistTimer);
            this.persistTimer = undefined;
        }
        void this.persist();
    }

    /** Push live parallel-run diff stats to the run owner's connected conversation SSE clients. */
    emitParallelRunStats(runId: string, cwd: string, variants: readonly QaapParallelRunVariantStats[]): void {
        this.fire({ type: 'parallel-run', runId, cwd, variants });
    }

    protected tryAutoLinkConversationToGitBranch(conv: QaapAgentConversation): QaapAgentConversation | undefined {
        if (conv.linkedPullRequest?.number) {
            return undefined;
        }
        const repo = this.parseGithubRepoFromCwd(conv.cwd);
        const branch = this.readGitBranch(conv.cwd);
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

    protected cwdMatchesGithubRepo(cwd: string, owner: string, repo: string): boolean {
        const parsed = this.parseGithubRepoFromCwd(cwd);
        if (!parsed) {
            return false;
        }
        return parsed.owner.toLowerCase() === owner.toLowerCase()
            && parsed.name.toLowerCase() === repo.toLowerCase();
    }

    protected parseGithubRepoFromCwd(cwd: string): { owner: string; name: string } | undefined {
        return parseGithubRepoFromCwdHelper(cwd);
    }

    protected readGitBranch(cwd: string): string | undefined {
        return readGitBranchHelper(cwd);
    }

    protected async restoreFromDisk(): Promise<void> {
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
                this.conversations.set(conversation.id, conversation);
                if (changed) {
                    anyChanged = true;
                }
            }
            const now = Date.now();
            // First try to auto-resume turns the restart interrupted (bounded, persisted counter).
            // A turn that resumes gets a live task, so the sweep below skips it (getActiveTaskIds guard).
            let resumedAny = false;
            for (const conv of [...this.conversations.values()]) {
                if (conv.status === 'streaming' && await this.maybeAutoResumeInterruptedTurn(conv.id, now)) {
                    resumedAny = true;
                }
            }
            const sweptAny = this.sweepZombieStreamingTurns(now, { resetSurvivorsToIdle: true });
            // Evidence is persisted before its repair process is spawned. A hard kill in that
            // narrow gap therefore leaves an idle tail with `[QAAP repair required]`; resume it
            // here through the same idempotent loop instead of silently abandoning the result.
            let visualRepairResumedAny = false;
            for (const conv of [...this.conversations.values()]) {
                const last = conv.messages[conv.messages.length - 1];
                if (conv.status === 'idle' && last?.role === 'agent'
                    && last.content.includes(QAAP_VISUAL_REPAIR_REQUIRED_MARKER)) {
                    const before = this.conversations.get(conv.id);
                    const after = await this.continueVisualRepairLoop(conv.id, last.id);
                    if (after !== before) {
                        visualRepairResumedAny = true;
                    }
                }
            }
            if (this.isTurnGraphEnabled()) {
                // After resume and sweep have settled every conversation's fate, close graph runs
                // whose turn is no longer live (lost terminal report, deleted conversation).
                await this.reapOrphanedChatTurnRuns();
            }
            if (anyChanged || resumedAny || sweptAny || visualRepairResumedAny) {
                await this.persist();
            }
        } catch {
            /* no prior conversations */
        }
    }

    /**
     * Turn watchdog: kills any conversation stuck continuously 'streaming' for longer than
     * {@link QAAP_MAX_TURN_MINUTES_ENV} (default {@link resolveQaapMaxTurnMinutes}), so a hung agent
     * CLI or a lost child process cannot hold a conversation in 'streaming' forever — this is what
     * let a real turn run for 50 hours in production. Runs once at startup (from
     * {@link restoreFromDisk}, covering zombies that were already streaming before a restart) and
     * then on a {@link TURN_WATCHDOG_SWEEP_MS} interval for the lifetime of the process.
     */
    protected startTurnWatchdog(): void {
        if (this.turnWatchdogTimer !== undefined) {
            return;
        }
        this.turnWatchdogTimer = setInterval(() => {
            this.sweepZombieStreamingTurns(Date.now());
        }, TURN_WATCHDOG_SWEEP_MS);
        this.turnWatchdogTimer.unref?.();
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
        return sweepZombieStreamingTurnsHelper(nowMs, options, {
            conversations: this.conversations,
            turnHasPendingApproval: c => this.turnHasPendingApproval(c),
            forceStopZombieTurn: (id, elapsed, max) => this.forceStopZombieTurn(id, elapsed, max),
            getActiveTaskIdsForConversation: id => this.getActiveTaskIdsForConversation(id),
            interruptStreamingTurnForRestart: (id, t) => this.interruptStreamingTurnForRestart(id, t),
            flushPersist: () => this.flushPersist(),
        });
    }

    /**
     * Force-settle one zombie turn: kill the underlying agent process (and any delegated
     * subtasks) via the same kill path {@link cancel} uses, mark the turn failed with a
     * watchdog-specific message, and publish the change over SSE.
     */
    protected forceStopZombieTurn(conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean {
        return forceStopZombieTurnHelper(conversationId, elapsedMs, maxTurnMinutes, {
            conversations: this.conversations,
            taskToConversation: this.taskToConversation,
            taskRunner: this.taskRunner,
            appendRunCancelledTrace: (c, aid, r) => this.appendRunCancelledTrace(c, aid, r),
            finalizeStreamingAgentMessage: (c, aid, r) => this.finalizeStreamingAgentMessage(c, aid, r),
            markTurnFailed: (c, info) => this.markTurnFailed(c, info),
            publishFinalizedAgentMessage: (id, c, aid) => this.publishFinalizedAgentMessage(id, c, aid),
            fire: e => this.fire(e),
        });
    }

    /**
     * Finalize a turn that was still 'streaming' when the backend restarted. The live task
     * handle never survives a restart, so the turn can never settle on its own; rather than
     * silently resetting it to 'idle' — which the UI renders as a phantom completion with the
     * user's message and no agent reply — mark it failed with a visible interrupted trace so
     * the turn is clearly ended and can be retried.
     */
    /**
     * A turn that a backend restart (OOM-kill / redeploy) interrupted cannot settle on its own — the
     * child agent died with the container's cgroup and no PID is persisted to reattach. Rather than
     * forcing the user to press "Retry", re-run the same turn automatically by reconstructing its
     * request (same agent + model) exactly like {@link maybeRetryTurnWithFallbackModel}, letting the
     * task-runner's concurrency queue pace the re-spawns. Bounded by a PERSISTED per-turn counter so
     * a turn whose own work saturates memory cannot loop restart→resume→OOM forever.
     *
     * Returns `true` when it handled the turn (resumed, or degraded to interrupted on a spawn error);
     * `false` leaves the turn for {@link interruptStreamingTurnForRestart}.
     */
    protected async maybeAutoResumeInterruptedTurn(conversationId: string, nowMs: number): Promise<boolean> {
        if (!QAAP_AUTO_RESUME_TURNS_ENABLED || MAX_RESTART_RESUMES <= 0) {
            return false;
        }
        const conv = this.conversations.get(conversationId);
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
        const rootUserMessageId = this.resolveLoopBudgetKey(conv, userMessageId);
        const rootUserMessage = conv.messages.find(message => message.id === rootUserMessageId && message.role === 'user')
            ?? turnUserMessage;
        if ((rootUserMessage.restartResumeCount ?? 0) >= MAX_RESTART_RESUMES) {
            return false;
        }
        if (this.isTurnGraphEnabled() && this.workflowRuns) {
            return this.resumeInterruptedTurnViaGraph(conv, turnUserMessage, rootUserMessage, turnAgentId, nowMs);
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
        this.conversations.set(conversationId, resumeConv);
        await this.persist();
        let spawned: QaapAgentTask;
        try {
            spawned = this.taskRunner.create(
                this.buildTaskCreateRequest(resumeConv, turnAgentId, undefined, userMessageId),
                resumeConv.ownerLogin,
            );
        } catch {
            // cwd gone / runner refused: degrade to the manual "Retry to continue" flow. The counter
            // is already persisted, so this turn will not be retried automatically again.
            this.interruptStreamingTurnForRestart(conversationId, nowMs);
            return true;
        }
        const messagesWithTask = resumeConv.messages.map(message => message.id === userMessageId
            ? { ...message, taskId: spawned.id, turnAgentId: spawned.agentId ?? turnAgentId }
            : message);
        const nextConv = { ...resumeConv, messages: messagesWithTask };
        this.conversations.set(conversationId, nextConv);
        this.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
        });
        this.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        void this.persist();
        console.warn(
            `[qaap-agent-conversation-resume] auto-resumed conversation ${conversationId} after restart `
            + `(attempt ${nextResumeCount}/${MAX_RESTART_RESUMES}).`,
        );
        return true;
    }

    /** ADR-002 turnstile: whether restart-resume is governed by the chat-turn workflow graph. */
    protected isTurnGraphEnabled(): boolean {
        return isTurnGraphEnabledHelper();
    }

    /**
     * The graph-governed twin of the imperative resume branch (ADR-002 piece 1). The decision and
     * its durable ledger are the run's: the turn is adopted into (or re-found in) a
     * `qaap.chat-turn` run, and the resume is `report('resume:restart')` — persisted visits/trace
     * BEFORE the process spawns, which is the same monotonic-progress invariant the imperative
     * branch implements with `await persist()`. The conversation-side effects (orphan cleanup,
     * counter projection, task re-link, SSE) deliberately mirror that branch line by line: the
     * store stays the data plane, the run store becomes the control plane.
     */
    protected async resumeInterruptedTurnViaGraph(
        conv: QaapAgentConversation,
        turnUserMessage: QaapAgentMessage,
        rootUserMessage: QaapAgentMessage,
        turnAgentId: string,
        nowMs: number,
    ): Promise<boolean> {
        const runs = this.workflowRuns!;
        const conversationId = conv.id;
        const userMessageId = turnUserMessage.id;
        const rootUserMessageId = rootUserMessage.id;
        const nextResumeCount = (rootUserMessage.restartResumeCount ?? 0) + 1;
        let record = this.findLiveChatTurnRun(conv, rootUserMessageId);
        if (!record) {
            record = await runs.adoptRun(buildChatTurnWorkflow(), {
                cwd: conv.cwd,
                ownerLogin: conv.ownerLogin,
                inputs: { conversationId, rootUserMessageId },
                seedNodeId: QAAP_CHAT_TURN_NODE,
                // The run's ledger carries the ceiling across governance changes: visits = 1 + the
                // resumes the projection already recorded before this run existed.
                seedVisits: 1 + (rootUserMessage.restartResumeCount ?? 0),
                deadExternalId: turnUserMessage.taskId,
                budget: resolveChatTurnRunBudget(MAX_RESTART_RESUMES),
            });
        }
        const nodeId = record.run.active[0] ?? QAAP_CHAT_TURN_NODE;
        // Belt and braces with the projection guard the caller already applied: if the RUN's own
        // ledger says the ceiling is spent, settle its failure edge and hand the conversation to
        // the sweep — never spawn on a counter that disagrees.
        if (Math.max(0, (record.run.visits[nodeId] ?? 1) - 1) >= MAX_RESTART_RESUMES) {
            await runs.report(conv.ownerLogin, record.run.id, nodeId, 'fail').catch(() => undefined);
            return false;
        }
        // THE transition: `turn --resume:restart--> turn`. report() persists the incremented visit
        // and the trace entry before resolving, so the spawn below can never outrun the ledger.
        const advanced = await runs.report(conv.ownerLogin, record.run.id, nodeId, 'resume:restart');
        if (!advanced.dispatch.includes(nodeId)) {
            // The visit backstop refused the re-visit (budget-exhausted): the run is terminal.
            return false;
        }
        // Data plane, mirroring the imperative branch: drop the orphaned partial agent output,
        // clear the dead task link, stamp the projected counter, persist BEFORE spawning.
        const lastMessage = conv.messages[conv.messages.length - 1];
        const agentMessageId = lastMessage?.role === 'agent' ? lastMessage.id : undefined;
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
        this.conversations.set(conversationId, resumeConv);
        await this.persist();
        let spawned: QaapAgentTask;
        try {
            spawned = this.taskRunner.create(
                this.buildTaskCreateRequest(resumeConv, turnAgentId, undefined, userMessageId),
                resumeConv.ownerLogin,
            );
        } catch {
            // cwd gone / runner refused: settle the run's failure edge and degrade to the manual
            // "Retry to continue" flow. Ledger and projection both already persisted, so this
            // turn will not be retried automatically again.
            await runs.report(conv.ownerLogin, record.run.id, nodeId, 'fail').catch(() => undefined);
            this.interruptStreamingTurnForRestart(conversationId, nowMs);
            return true;
        }
        await runs.attachDispatch(conv.ownerLogin, record.run.id, nodeId, 'agent', spawned.id).catch(() => undefined);
        this.chatTurnRunByTask.set(spawned.id, { runId: record.run.id, ownerLogin: conv.ownerLogin, nodeId });
        const messagesWithTask = resumeConv.messages.map(message => message.id === userMessageId
            ? { ...message, taskId: spawned.id, turnAgentId: spawned.agentId ?? turnAgentId }
            : message);
        const nextConv = { ...resumeConv, messages: messagesWithTask };
        this.conversations.set(conversationId, nextConv);
        this.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
        });
        this.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        void this.persist();
        console.warn(
            `[qaap-agent-conversation-resume] auto-resumed conversation ${conversationId} after restart `
            + `via chat-turn run ${record.run.id} (attempt ${nextResumeCount}/${MAX_RESTART_RESUMES}).`,
        );
        return true;
    }

    /**
     * Settle the graph edge of a graph-governed turn when its task reaches a terminal state.
     * Bookkeeping only in piece 1: the run records the outcome (`success` / `success:warned` /
     * `fail` / `blocked`) and ends on its settle emit, while {@code applyTaskOutcome} keeps
     * materializing the transcript and deciding follow-ups imperatively. One decider per
     * transition — the template dispatcher is fenced off these runs by its `governs` predicate.
     */
    protected settleChatTurnRun(task: QaapAgentTask, outcome: QaapWorkflowNodeOutcome = resolveChatTurnOutcome(task.state)): void {
        const governed = this.chatTurnRunByTask.get(task.id);
        if (!governed) {
            return;
        }
        this.chatTurnRunByTask.delete(task.id);
        void this.workflowRuns?.report(governed.ownerLogin, governed.runId, governed.nodeId, outcome)
            .catch(error => console.warn('[qaap-agent-conversation-store] failed to settle a chat-turn run:', error));
    }

    /** The live chat-turn run governing one root turn, if any. */
    protected findLiveChatTurnRun(conv: QaapAgentConversation, rootUserMessageId: string): QaapPersistedWorkflowRun | undefined {
        return this.workflowRuns?.listUnfinished(conv.ownerLogin).find(candidate =>
            candidate.def.id === QAAP_CHAT_TURN_WORKFLOW_ID
            && candidate.inputs.conversationId === conv.id
            && candidate.inputs.rootUserMessageId === rootUserMessageId);
    }

    /** The durable tried-model keys of a run's fallback ladder ({@link QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT}). */
    protected readTriedFallbackModels(record: QaapPersistedWorkflowRun | undefined): readonly string[] {
        return readTriedFallbackModelsHelper(record);
    }

    /**
     * Reconstruct the shared fallback/auto-continue ceiling from every durable projection. During
     * incremental migration a run may be adopted after imperative continuations or fallbacks have
     * already happened, so its trace alone is insufficient after the in-memory counter disappears.
     */
    protected countDurableLoopSpawns(
        conv: QaapAgentConversation,
        rootUserMessageId: string,
        record: QaapPersistedWorkflowRun | undefined,
    ): number {
        return countDurableLoopSpawnsHelper(conv, rootUserMessageId, record);
    }

    /**
     * Graph-governed twin of {@link maybeRetryTurnWithFallbackModel} (ADR-002 piece 2). Same
     * guards, same curated chain, same shared re-spawn ceiling — but the decision is the run's
     * `retry:model` edge into the `turn-fallback` node, and the tried-model set persists as the
     * run's artifact, so a restart no longer forgets which models already failed. The in-memory
     * maps are kept updated as a projection for the transitions that are still imperative
     * (auto-continue shares the spawn ceiling until its own piece).
     */
    protected async maybeRetryTurnWithFallbackModelViaGraph(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        turnAgentId: string,
        startSha?: string,
    ): Promise<boolean> {
        if (!agentSupportsModelPicker(turnAgentId)) {
            return false;
        }
        // Same retriability contract as the imperative branch — including the quota exclusion,
        // which is neither of these classifications.
        const toolSupportFailure = agentTurnHasRetryableToolSupportFailure(agentMessage);
        const retryableFailedState = task.state === 'failed'
            && (agentTurnHasRetryableEmptyOutput(agentMessage)
                || agentTurnHasRetryableModelFailure(agentMessage));
        if (!toolSupportFailure && !retryableFailedState) {
            return false;
        }
        const runs = this.workflowRuns!;
        const loopBudgetKey = this.resolveLoopBudgetKey(conv, userMessageId);
        let record = this.findLiveChatTurnRun(conv, loopBudgetKey);
        // Shared-ceiling parity: the stricter of the run's own trace and the in-memory counter
        // (a turn may have spent spawns imperatively before the flag flip, or via auto-continue).
        const spent = Math.max(
            this.countDurableLoopSpawns(conv, loopBudgetKey, record),
            this.loopSpawnCountByUserMessage.get(loopBudgetKey) ?? 0,
        );
        if (spent >= MAX_LOOP_SPAWNS_PER_USER_MESSAGE) {
            this.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        const turnUserMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
        const currentModel = turnUserMessage?.turnAgentModel
            ?? resolveTaskAgentModel(task)
            ?? (conv.agentId === turnAgentId ? conv.agentModel ?? conv.qaiqModel : undefined);
        // Durable tried-set first; the in-memory map only adds what this process learned before
        // the run existed.
        const tried = new Set<string>([
            ...this.readTriedFallbackModels(record),
            ...(this.modelFallbackTriedByUserMessage.get(loopBudgetKey) ?? []),
        ]);
        const currentKey = agentModelKey(currentModel);
        if (currentKey) {
            tried.add(currentKey);
        }
        const nextModel = resolveNextFallbackAgentModel(turnAgentId, currentModel, tried);
        if (!nextModel) {
            this.modelFallbackTriedByUserMessage.delete(loopBudgetKey);
            return false;
        }
        if (!record) {
            const rootUserMessage = conv.messages.find(message => message.id === loopBudgetKey && message.role === 'user');
            try {
                record = await runs.adoptRun(buildChatTurnWorkflow(), {
                    cwd: conv.cwd,
                    ownerLogin: conv.ownerLogin,
                    inputs: { conversationId, rootUserMessageId: loopBudgetKey },
                    seedNodeId: QAAP_CHAT_TURN_NODE,
                    seedVisits: 1 + (rootUserMessage?.restartResumeCount ?? 0),
                    deadExternalId: task.id,
                    budget: resolveChatTurnRunBudget(MAX_RESTART_RESUMES),
                });
            } catch (error) {
                // Ledger unavailable (owner at the run cap with nothing reapable): the retry is
                // still owed to the user — degrade to the imperative branch rather than dropping it.
                console.warn('[qaap-agent-conversation-fallback] could not adopt a chat-turn run; using the imperative retry:', error);
                return this.maybeRetryTurnWithFallbackModel(
                    conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
                );
            }
        }
        const nodeId = record.run.active[0] ?? QAAP_CHAT_TURN_NODE;
        const nextKey = agentModelKey(nextModel);
        const triedWithNext = [...tried, ...(nextKey && !tried.has(nextKey) ? [nextKey] : [])];
        let advanced;
        try {
            advanced = await runs.report(
                conv.ownerLogin, record.run.id, nodeId, 'retry:model', undefined,
                { key: QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT, value: JSON.stringify(triedWithNext) },
                nls.localize('qaap/chatTurn/retryingModel', 'Retrying with the next curated model.'),
            );
        } catch (error) {
            // Preserve the old task's claim so the deferred settle can close this run. A transient
            // ledger failure must not also deny the user the established imperative fallback.
            console.warn('[qaap-agent-conversation-fallback] could not persist the graph retry; using the imperative retry:', error);
            return this.maybeRetryTurnWithFallbackModel(
                conversationId, userMessageId, agentMessageId, task, conv, agentMessage, turnAgentId, startSha,
            );
        }
        // The decision is durably the graph's: steal the deferred terminal settle only AFTER the
        // retry edge reached disk, never while a failed report could still need the old claim.
        this.chatTurnRunByTask.delete(task.id);
        const fallbackNodeId = advanced.dispatch[0];
        if (!fallbackNodeId) {
            // The visit backstop refused the re-entry; the run is settled and the turn fails normally.
            return false;
        }
        // Data plane, mirroring the imperative branch: drop the partial agent message, re-seal
        // the user message with the next model, spawn, re-link, publish.
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
            spawned = this.taskRunner.create(
                this.buildTaskCreateRequest(retryConv, turnAgentId, undefined, userMessageId),
                retryConv.ownerLogin,
            );
        } catch {
            // Same degradation as the imperative branch (return false → the failure flow marks the
            // turn). Settle the run's failure edge so the ledger never waits on an unstarted node.
            await runs.report(conv.ownerLogin, record.run.id, fallbackNodeId, 'fail').catch(() => undefined);
            return false;
        }
        this.recordLoopSpawn(loopBudgetKey);
        this.modelFallbackTriedByUserMessage.set(loopBudgetKey, new Set(triedWithNext));
        await runs.attachDispatch(conv.ownerLogin, record.run.id, fallbackNodeId, 'agent', spawned.id).catch(() => undefined);
        this.chatTurnRunByTask.set(spawned.id, { runId: record.run.id, ownerLogin: conv.ownerLogin, nodeId: fallbackNodeId });
        const messagesWithTask = retryConv.messages.map(message => message.id === userMessageId
            ? {
                ...message,
                taskId: spawned.id,
                turnAgentId: spawned.agentId ?? turnAgentId,
                turnAgentModel: nextModel,
            }
            : message);
        const nextConv = { ...retryConv, messages: messagesWithTask };
        this.conversations.set(conversationId, nextConv);
        // Same SSE contract as the imperative branch: the re-attributed user message is the only
        // carrier of the new provenance for tabs that do not poll.
        const resealedUserMessage = messagesWithTask.find(message => message.id === userMessageId);
        if (resealedUserMessage) {
            this.fire({ type: 'message', conversationId, cwd: nextConv.cwd, message: resealedUserMessage });
        }
        this.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        this.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            turnAgentId: spawned.agentId ?? turnAgentId,
            startSha,
        });
        void this.persist();
        console.warn(
            `[qaap-agent-conversation-fallback] retrying turn ${userMessageId} of ${conversationId} `
            + `with the next curated model via chat-turn run ${record.run.id}.`,
        );
        return true;
    }

    /**
     * Close chat-turn runs whose conversation is no longer streaming — the terminal report lives
     * in process memory ({@link chatTurnRunByTask}) and dies with a crash, and the template
     * dispatcher is told to ignore these runs, so without this sweep the shared run index would
     * accumulate zombies that stay "running" forever.
     */
    protected async reapOrphanedChatTurnRuns(): Promise<void> {
        const runs = this.workflowRuns;
        if (!runs) {
            return;
        }
        for (const record of runs.listAllUnfinished()) {
            if (record.def.id !== QAAP_CHAT_TURN_WORKFLOW_ID) {
                continue;
            }
            const conversationId = record.inputs.conversationId;
            const conv = conversationId ? this.conversations.get(conversationId) : undefined;
            if (conv?.status === 'streaming') {
                continue; // still governed — the resume path owns it
            }
            for (const nodeId of record.run.active) {
                await runs.report(
                    record.ownerLogin, record.run.id, nodeId, 'fail', undefined, undefined,
                    'Conversation settled while the backend was down.',
                ).catch(() => undefined);
            }
        }
    }

    protected interruptStreamingTurnForRestart(conversationId: string, nowMs: number): boolean {
        const conv = this.conversations.get(conversationId);
        if (!conv || conv.status !== 'streaming') {
            return false;
        }
        const reason = 'The backend restarted while this turn was in progress, so it was interrupted. Retry to continue.';
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user');
        const lastMessage = conv.messages[conv.messages.length - 1];
        const agentMessageId = lastMessage?.role === 'agent' ? lastMessage.id : undefined;
        const withTrace = this.appendRunCancelledTrace(conv, agentMessageId, reason);
        const finalized = this.finalizeStreamingAgentMessage(withTrace, agentMessageId, reason);
        const failed = this.markTurnFailed(finalized, {
            userMessageId: lastUser?.id ?? lastMessage?.id ?? '',
            agentMessageId,
            reason,
        });
        this.conversations.set(conversationId, { ...failed.conv, updatedAt: nowMs });
        return true;
    }

    /** Throttle persist-failure warnings so a sustained disk error can't spam the log every 500ms. */
    protected persistFailureLoggedAtMs = 0;

    protected async persist(): Promise<void> {
        try {
            await fsp.mkdir(STORE_DIR, { recursive: true });
            await writeJsonAtomic(INDEX_PATH, [...this.conversations.values()]);
            this.persistFailureLoggedAtMs = 0;
        } catch (error) {
            // Best-effort persistence, but a swallowed error hides disk-full/corruption; surface it
            // at most once a minute so the failure is visible without flooding the log.
            const now = Date.now();
            if (now - this.persistFailureLoggedAtMs > 60_000) {
                this.persistFailureLoggedAtMs = now;
                console.warn('[qaap-agent-conversation-store] failed to persist conversations:', error);
            }
        }
    }

    protected captureGitSha(cwd: string): string | undefined {
        return captureGitShaHelper(cwd);
    }

    protected computeGitDiffStats(cwd: string, startSha?: string): { added: number; removed: number } | undefined {
        return computeGitDiffStatsHelper(cwd, startSha);
    }

    /**
     * Capture a snapshot of the full working tree as a git commit object, kept alive by a ref under
     * `refs/qaap/checkpoints/*`. Uses a throwaway `GIT_INDEX_FILE` so the user's index/branch/HEAD
     * are never touched. Returns undefined when not a git repo or git plumbing fails.
     */
    protected captureCheckpoint(
        cwd: string,
        conversationId: string,
        messageId: string,
        label: string,
        stats?: { added: number; removed: number },
    ): QaapConversationCheckpoint | undefined {
        const tmpIndex = path.join(os.tmpdir(), `qaap-ckpt-${randomUUID()}.index`);
        const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
        try {
            // Seed the throwaway index from HEAD when a commit exists (best-effort; empty repo is fine).
            this.mutatingGitSync(cwd, ['read-tree', 'HEAD'], env);
            if (this.mutatingGitSync(cwd, ['add', '-A'], env).status !== 0) {
                return undefined;
            }
            const tree = this.mutatingGitSync(cwd, ['write-tree'], env);
            const treeId = tree.status === 0 ? tree.stdout.trim() : '';
            if (!treeId) {
                return undefined;
            }
            const commitRes = this.mutatingGitSync(
                cwd,
                ['-c', 'user.email=qaap@local', '-c', 'user.name=qaap', 'commit-tree', treeId, '-m', `qaap checkpoint: ${label}`],
                env,
            );
            const commit = commitRes.status === 0 ? commitRes.stdout.trim() : '';
            if (!commit) {
                return undefined;
            }
            const ref = `refs/qaap/checkpoints/${conversationId}/${messageId}-${Date.now()}`;
            this.mutatingGitSync(cwd, ['update-ref', ref, commit]);
            return { id: randomUUID(), messageId, label, commit, ref, capturedAt: Date.now(), added: stats?.added, removed: stats?.removed };
        } catch {
            return undefined;
        } finally {
            try {
                fs.rmSync(tmpIndex, { force: true });
            } catch { /* ignore */ }
        }
    }

    protected checkpointLabel(content: string): string {
        return checkpointLabelHelper(content);
    }

    /**
     * Drop a user message and every turn after it. Optionally restores tracked files to the
     * checkpoint captured after the previous user turn (when one exists).
     */
    async rewindToMessage(conversationId: string, messageId: string): Promise<QaapAgentConversation | undefined> {
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const plan = planConversationRewind(conv, messageId);
        for (const taskId of plan.taskIdsToCancel) {
            this.taskRunner.cancel(taskId);
            this.agentStreamByTaskId.delete(taskId);
            this.agUiStreamByTaskId.delete(taskId);
            this.taskToConversation.delete(taskId);
        }
        let next: QaapAgentConversation = {
            ...conv,
            status: 'idle',
            messages: plan.trimmedMessages,
            checkpoints: plan.trimmedCheckpoints,
            updatedAt: Date.now(),
            gitDiffAdded: undefined,
            gitDiffRemoved: undefined,
        };
        if (plan.restoreCheckpoint) {
            if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: conv.cwd, encoding: 'utf8' }).status !== 0) {
                throw new Error('The conversation workspace is not a git repository.');
            }
            const undo = this.captureCheckpoint(conv.cwd, conversationId, messageId, 'Before rewind');
            const restore = this.mutatingGitSync(
                conv.cwd,
                ['restore', '--source', plan.restoreCheckpoint.commit, '--worktree', '--', '.'],
            );
            if (restore.status !== 0) {
                throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
            }
            if (undo) {
                next = { ...next, checkpoints: [...(next.checkpoints ?? []), undo] };
            }
        }
        this.conversations.set(conversationId, next);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
    }

    /**
     * Restore the working tree to a checkpoint's snapshot. Captures an "undo" checkpoint of the
     * current state first, so the restore is reversible. Only touches the working tree (never the
     * index, branch or commit history). Files created AFTER the checkpoint are left as-is.
     */
    async restoreCheckpoint(conversationId: string, checkpointId: string): Promise<QaapAgentConversation | undefined> {
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const checkpoint = conv.checkpoints?.find(c => c.id === checkpointId);
        if (!checkpoint) {
            throw new Error('Checkpoint not found.');
        }
        if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: conv.cwd, encoding: 'utf8' }).status !== 0) {
            throw new Error('The conversation workspace is not a git repository.');
        }
        const undo = this.captureCheckpoint(conv.cwd, conversationId, checkpoint.messageId, 'Before restore');
        const restore = this.mutatingGitSync(conv.cwd, ['restore', '--source', checkpoint.commit, '--worktree', '--', '.']);
        if (restore.status !== 0) {
            throw new Error(`Restore failed: ${(restore.stderr || '').trim() || 'git restore error'}`);
        }
        let next = conv;
        if (undo) {
            next = { ...conv, checkpoints: [...(conv.checkpoints ?? []), undo], updatedAt: Date.now() };
            this.conversations.set(conversationId, next);
            this.fire({ type: 'updated', conversation: toConversationSummary(next) });
            void this.persist();
        }
        return next;
    }

    protected isDirectory(target: string): boolean {
        return isDirectoryHelper(target);
    }
}
