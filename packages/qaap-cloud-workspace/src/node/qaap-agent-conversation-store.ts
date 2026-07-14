// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core/lib/common/event';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
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
    QaapAgentConversationSummary,
    QaapAgentMessage,
    QaapContextCompaction,
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
    estimateConversationTokensFromMessages,
    totalTokensFromContextUsage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-context-usage';
import { resolveAgentTurnFailureMessage } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-failure-message';
import {
    createAgentStreamAccumulator,
    parseAgentLogForTranscript,
    resolveAgentLogDisplayText,
    type QaapAgentStreamAccumulator,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import {
    createAgUiCliStreamEmitter,
    type QaapCliAgUiStreamEmitter,
} from '@theia/qaap-mobile-shell/lib/common/qaap-cli-ag-ui-stream';
import { isConversationTurnVisuallySettled } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-turn-status';
import {
    autoContinueAllowedForInteraction,
    buildAgentAutoContinuePrompt,
    buildDevPreviewAutoContinueExhaustedReason,
    isIncompleteAgentTurn,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-turn-completion';
import { messageRequestsDevPreview } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-preview-offer';
import { patchConversationAutoApprove } from '../common/qaap-agent-conversation-auto-approve';
import { filterAgentProcessLogChunk } from '../common/qaap-agent-log-filter';
import { appendTeamDelegationToPrompt } from '../common/qaap-team-delegation';
import {
    buildConversationAgentPrompt,
    partitionConversationHistory,
    shouldCompressConversationPrompt,
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
    compressAgentMessageForWire,
    compressAgentMessageWireDeltaForWire,
} from './qaap-agent-message-wire-compress';
import {
    QaapConversationStreamMetricsCollector,
    countCompressedWireFields,
    logQaapStreamMetrics,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import {
    computeAgentMessageWireDelta,
    toAgentMessageWirePayload,
    toAgentMessageWireSnapshot,
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
    agentTurnHasRetryableQuotaFailure,
    resolveNextFallbackAgentModel,
} from '../common/qaap-agent-model-fallback';
import {
    appendTraceCheckpointEvent,
    appendTracePreviewFailureEvent,
    appendTraceRunCancelledEvent,
    agentMessageHasStructuredTrace,
    syncSettledTraceEventsOnMessage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-lifecycle';
import { backfillConversationTraceEvents, materializeConversationForApiWithChanges, materializeAgentMessageForApi, preferTraceFirstAgentMessageStorage } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-backfill';
import { mergeAccumulatorTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-cli-transcript-stream';
import { mergeSegmentTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-model';
import { finalizeUnfinishedAgentToolSegments } from '../common/qaap-agent-transcript-segment-finalize';
import {
    agentMessageHasVisualVerificationMarker,
    buildQaapVisualFlowMarkdown,
    buildQaapVisualVerificationFailureMarkdown,
    buildQaapVisualVerificationMarkdown,
    buildQaapVisualVideoMarkdown,
    type QaapPreviewVisualValidationResult,
    type QaapVisualFlowStepEvidence,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import {
    createComposerGitActionDisplayMarker,
    type ComposerGitActionDisplayMetadata,
} from '@theia/qaap-mobile-shell/lib/common/qaap-composer-git-action-display';
import {
    QAAP_MAX_TURN_MINUTES_ENV,
    buildQaapTurnWatchdogMessage,
    findExpiredStreamingTurns,
    resolveQaapMaxTurnMinutes,
    resolveStreamingSinceMs,
    type QaapStreamingTurnSnapshot,
} from '../common/qaap-agent-turn-watchdog';

const STORE_DIR = path.join(os.homedir(), '.qaap', 'agent-conversations');
const STREAMING_PERSIST_DEBOUNCE_MS = 500;
const INDEX_PATH = path.join(STORE_DIR, 'index.json');
const VISUAL_EVIDENCE_DIR = path.join(STORE_DIR, 'visual-evidence');
/** Hard cap of stored PNGs per conversation — bounds disk use across multi-step flows and retries. */
const VISUAL_EVIDENCE_MAX_FILES_PER_CONVERSATION = 40;
/** Recorded tours are short (seconds), but webm still dwarfs PNGs — cap them separately. */
const VISUAL_EVIDENCE_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
/** How often the turn watchdog scans for conversations stuck 'streaming' past the max duration. */
const TURN_WATCHDOG_SWEEP_MS = 60 * 1000;

/**
 * Strict mode. Set `QAAP_AGENT_AUTO_CONTINUE=0` (or `false`/`off`) to stop the backend from
 * auto-re-prompting the agent to "keep going" after a turn — the agent then does only what the
 * user asked and stops. Default on (preserves the auto-continue / scaffold-to-preview behavior).
 */
const QAAP_AGENT_AUTO_CONTINUE_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_AUTO_CONTINUE?.trim() ?? '');

/**
 * Hard ceiling on agent re-spawns triggered by ALL loops (auto-continue + model-fallback) for a
 * single user message. Each loop has its own smaller cap, but without a shared budget they multiply
 * (2 auto-continues × N fallback models), so one turn could fan out into many CLI invocations. 4
 * bounds the worst case while leaving room for a couple of continues plus one or two fallbacks.
 */
const MAX_LOOP_SPAWNS_PER_USER_MESSAGE = 4;

/**
 * Persistent multi-turn conversations with the coding agent. Each user message spawns a one-shot
 * task on {@link QaapAgentTaskRunner} with the full transcript embedded in the prompt; when the
 * task finishes, its stdout is appended as the next agent message. The store survives backend
 * restarts and workspace switches: state lives entirely on the VPS.
 */
@injectable()
export class QaapAgentConversationStore {

    @inject(QaapAgentTaskRunner)
    protected readonly taskRunner: QaapAgentTaskRunner;

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

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

    protected readonly conversations = new Map<string, QaapAgentConversation>();
    /** Serializes screenshot attachment per conversation across multiple open frontend tabs. */
    protected readonly visualVerificationInFlight = new Set<string>();
    /** Reverse index: task id → conversation turn metadata so we can route output/completion. */
    protected readonly taskToConversation = new Map<string, { conversationId: string; userMessageId: string; agentMessageId?: string; startSha?: string }>();
    /** Subtask ids whose completion was already appended to a leader conversation (passive mailbox). */
    protected readonly subtaskMailboxDelivered = new Set<string>();
    /** Leader turn task ids for which an auto-synthesis user message was already posted. */
    protected readonly teamSynthesisTriggeredForLeader = new Set<string>();
    /** Leader turns waiting for the in-flight agent reply before auto-synthesis can run. */
    protected readonly pendingTeamSynthesisForLeader = new Set<string>();
    /** Per user turn: how many auto-continue nudges were sent after a thinking-only stop. */
    protected readonly autoContinueCountByUserMessage = new Map<string, number>();
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
        const buckets = new Map<string, QaapAgentConversation[]>();
        for (const conv of this.conversations.values()) {
            const list = buckets.get(conv.cwd);
            if (list) {
                list.push(conv);
            } else {
                buckets.set(conv.cwd, [conv]);
            }
        }
        const groups: QaapAgentConversationCwdGroup[] = [];
        for (const [cwd, list] of buckets) {
            list.sort((a, b) => b.updatedAt - a.updatedAt);
            groups.push({
                cwd,
                projectName: path.basename(cwd) || cwd,
                streamingCount: list.reduce((n, c) => n + (c.status === 'streaming' ? 1 : 0), 0),
                conversations: list.map(toConversationSummary),
            });
        }
        groups.sort((a, b) => (b.conversations[0]?.updatedAt ?? 0) - (a.conversations[0]?.updatedAt ?? 0));
        return groups;
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
    ): QaapAgentConversation {
        let conv = this.conversations.get(id);
        if (!conv) {
            throw new Error('Conversation not found.');
        }
        if (conv.status === 'streaming') {
            if (!isConversationTurnVisuallySettled(conv)) {
                throw new Error('A turn is already in progress for this conversation.');
            }
            const lastUser = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId);
            if (lastUser?.taskId) {
                this.taskRunner.cancel(lastUser.taskId);
            }
            conv = { ...conv, status: 'idle', updatedAt: Date.now() };
            this.conversations.set(id, conv);
            this.fire({ type: 'updated', conversation: toConversationSummary(conv) });
        }
        const turnAgentId = this.resolveTurnAgent(conv, content, agentOverride);
        const userMessage: QaapAgentMessage = {
            id: randomUUID(),
            role: 'user',
            content,
            createdAt: Date.now(),
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
            ...(agentModelOverride && agentSupportsModelPicker(turnAgentId)
                ? { agentModel: agentModelOverride, qaiqModel: agentModelOverride }
                : {}),
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

        let task: QaapAgentTask | undefined;
        try {
            task = this.taskRunner.create(this.buildTaskCreateRequest(next, turnAgentId, latencyMarks));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failed = this.markTurnFailed(next, {
                userMessageId: userMessage.id,
                reason: message,
            });
            next = failed.conv;
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
        this.streamMetrics.recordLatencyMark(id, 'task_created');

        const messagesWithTask = next.messages.map(m => m.id === userMessage.id ? { ...m, taskId: task!.id } : m);
        next = { ...next, messages: messagesWithTask };
        const autoLinked = this.tryAutoLinkConversationToGitBranch(next);
        if (autoLinked) {
            next = autoLinked;
        }
        this.conversations.set(id, next);
        const startSha = this.captureGitSha(conv.cwd);
        this.taskToConversation.set(task.id, { conversationId: id, userMessageId: userMessage.id, startSha });
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
        const lastUser = [...conv.messages].reverse().find(m => m.role === 'user' && m.taskId);
        const turnRef = lastUser?.taskId ? this.taskToConversation.get(lastUser.taskId) : undefined;
        if (lastUser?.taskId) {
            this.taskRunner.cancel(lastUser.taskId);
            for (const subtask of collectSubtasksForLeader(lastUser.taskId, this.taskRunner.list())) {
                if (subtask.state === 'running') {
                    this.taskRunner.cancel(subtask.id);
                }
            }
        }
        const agentMessageId = turnRef?.agentMessageId
            ?? (conv.messages[conv.messages.length - 1]?.role === 'agent'
                ? conv.messages[conv.messages.length - 1].id
                : undefined);
        let next = this.appendRunCancelledTrace(conv, agentMessageId, 'Turn cancelled.');
        next = this.finalizeStreamingAgentMessage(next, agentMessageId, 'Turn cancelled.');
        next = { ...next, status: 'idle', updatedAt: Date.now() };
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
        return path.join(VISUAL_EVIDENCE_DIR, conversationId);
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
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        if (!lastAgent) {
            return undefined;
        }
        if (targetAgentMessageId !== undefined) {
            return lastAgent.id === targetAgentMessageId ? lastAgent : undefined;
        }
        // Legacy reports (no target): only trust them while the backend turn is truly idle.
        return conv.status === 'idle' ? lastAgent : undefined;
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
            return this.attachVisualVerificationBlock(conv, target, buildQaapVisualVerificationMarkdown(imageUrl, result));
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
        const conv = this.conversations.get(conversationId);
        if (!conv || png.length === 0) {
            return undefined;
        }
        const directory = this.visualEvidenceDirectory(conversationId);
        await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
        const existing = await fsp.readdir(directory).catch(() => [] as string[]);
        if (existing.length >= VISUAL_EVIDENCE_MAX_FILES_PER_CONVERSATION) {
            return undefined;
        }
        const evidenceId = randomUUID();
        await fsp.writeFile(path.join(directory, `${evidenceId}.png`), png, { mode: 0o600 });
        return evidenceId;
    }

    /**
     * Moves a recorded tour (Playwright writes the webm to a temp path) into the evidence dir.
     * Videos are capped separately from screenshots — a few seconds of webm dwarfs any PNG.
     */
    async saveVisualEvidenceVideo(conversationId: string, sourcePath: string): Promise<string | undefined> {
        const conv = this.conversations.get(conversationId);
        const stat = await fsp.stat(sourcePath).catch(() => undefined);
        if (!conv || !stat || stat.size === 0 || stat.size > VISUAL_EVIDENCE_MAX_VIDEO_BYTES) {
            return undefined;
        }
        const directory = this.visualEvidenceDirectory(conversationId);
        await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
        const existing = await fsp.readdir(directory).catch(() => [] as string[]);
        if (existing.length >= VISUAL_EVIDENCE_MAX_FILES_PER_CONVERSATION) {
            return undefined;
        }
        const evidenceId = randomUUID();
        const targetPath = path.join(directory, `${evidenceId}.webm`);
        try {
            await fsp.rename(sourcePath, targetPath);
        } catch {
            await fsp.copyFile(sourcePath, targetPath);
            await fsp.rm(sourcePath, { force: true }).catch(() => undefined);
        }
        await fsp.chmod(targetPath, 0o600).catch(() => undefined);
        return evidenceId;
    }

    /** Attaches a recorded-tour evidence block referencing a stored webm. */
    recordVisualVerificationVideo(
        conversationId: string,
        videoEvidenceId: string,
        steps: readonly { label: string; result: QaapPreviewVisualValidationResult }[],
        targetAgentMessageId: string,
    ): QaapAgentConversation | undefined {
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
            return next;
        } finally {
            this.visualVerificationInFlight.delete(conversationId);
        }
    }

    /**
     * Resolves a served evidence file (`<uuid>` PNG or `<uuid>.webm` video) to its on-disk path.
     * The strict ref validation keeps the route traversal-proof.
     */
    resolveVisualVerificationFile(conversationId: string, evidenceRef: string): { path: string; contentType: string } | undefined {
        if (!this.conversations.has(conversationId)) {
            return undefined;
        }
        const match = /^([a-f\d-]{36})(\.webm)?$/i.exec(evidenceRef);
        if (!match) {
            return undefined;
        }
        const fileName = match[2] ? `${match[1]}.webm` : `${match[1]}.png`;
        const filePath = path.join(this.visualEvidenceDirectory(conversationId), fileName);
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        return { path: filePath, contentType: match[2] ? 'video/webm' : 'image/png' };
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
            return next;
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
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return;
        }
        const referenced = new Set<string>();
        for (const message of conv.messages) {
            for (const match of message.content.matchAll(/visual-verifications\/([a-f\d-]{36})/gi)) {
                referenced.add(match[1].toLowerCase());
            }
        }
        const directory = this.visualEvidenceDirectory(conversationId);
        const files = await fsp.readdir(directory).catch(() => [] as string[]);
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const file of files) {
            const evidenceId = file.replace(/\.(?:png|webm)$/i, '').toLowerCase();
            if (referenced.has(evidenceId)) {
                continue;
            }
            const filePath = path.join(directory, file);
            const stat = await fsp.stat(filePath).catch(() => undefined);
            if (stat && stat.mtimeMs < cutoff) {
                await fsp.rm(filePath, { force: true }).catch(() => undefined);
            }
        }
    }

    /**
     * Settle a turn's evidence slot when the frontend exhausted its capture attempts. The note
     * carries the verification marker, so `visualVerificationPending` clears everywhere and the
     * user can finally see *why* no screenshot arrived instead of an eternally silent gap.
     */
    recordVisualVerificationFailure(
        conversationId: string,
        reason: string,
        targetAgentMessageId: string,
    ): QaapAgentConversation | undefined {
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
        return this.attachVisualVerificationBlock(conv, target, buildQaapVisualVerificationFailureMarkdown(trimmed));
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
        const conv = this.conversations.get(conversationId);
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
            this.conversations.set(conversationId, next);
            this.fire({ type: 'updated', conversation: toConversationSummary(next) });
            void this.persist();
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
        this.conversations.set(conversationId, next);
        this.fire({ type: 'message', conversationId, cwd: next.cwd, message: userMessage });
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        void this.persist();
        return next;
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
            void this.applyTaskOutcome(ref.conversationId, ref.userMessageId, ref.agentMessageId, task, ref.startSha);
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
        const message: QaapAgentMessage = {
            id: randomUUID(),
            role: 'agent',
            content: formatSubtaskMailboxMessage(task, log),
            createdAt: Date.now(),
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
        ref: { conversationId: string; userMessageId: string; agentMessageId?: string },
        chunk: string,
    ): void {
        const conv = this.conversations.get(ref.conversationId);
        const filtered = this.filterAgentLogChunk(chunk);
        if (!conv || !filtered) {
            return;
        }
        const agentId = conv.agentId;
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
        ref: { conversationId: string; userMessageId: string; agentMessageId?: string },
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
        for (const event of events) {
            const next = this.applyAgUiTranscriptEvent(ref.conversationId, event);
            if (next) {
                conv = next;
            }
        }
        const agentMessage = ref.agentMessageId
            ? conv.messages.find(message => message.id === ref.agentMessageId)
            : conv.messages[conv.messages.length - 1]?.role === 'agent'
                ? conv.messages[conv.messages.length - 1]
                : undefined;
        if (agentMessage?.role === 'agent') {
            ref.agentMessageId = agentMessage.id;
            this.taskToConversation.set(taskId, ref);
        }
    }

    protected finalizeTurnContextUsage(conv: QaapAgentConversation, taskId: string, agentId: string): QaapAgentConversation {
        let next = conv;
        const stream = this.agentStreamByTaskId.get(taskId);
        const turnUsage = stream?.getTurnUsage?.();
        if (turnUsage) {
            next = {
                ...next,
                // Provider turn usage is the latest context snapshot, not a billing accumulator.
                // Summing snapshots across turns overstates context fullness.
                contextUsage: turnUsage,
                contextUsageEstimated: undefined,
            };
        }
        if (totalTokensFromContextUsage(next.contextUsage) === 0) {
            const estimated = estimateConversationTokensFromMessages(next.messages, next.contextPreamble);
            if (estimated > 0) {
                next = { ...next, contextUsageEstimated: true };
            }
        }
        return {
            ...next,
            contextWindowSize: next.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
        };
    }

    protected ensureAgentStream(taskId: string, agentId: string): QaapAgentStreamAccumulator | undefined {
        let stream = this.agentStreamByTaskId.get(taskId);
        if (!stream) {
            stream = createAgentStreamAccumulator(agentId);
            if (stream) {
                this.agentStreamByTaskId.set(taskId, stream);
            }
        }
        return stream;
    }

    protected ensureAgUiStream(taskId: string, agentId: string): QaapCliAgUiStreamEmitter {
        let emitter = this.agUiStreamByTaskId.get(taskId);
        if (!emitter) {
            const created = createAgUiCliStreamEmitter(agentId);
            if (!created) {
                throw new Error(`No AG-UI CLI stream emitter for agent: ${agentId}`);
            }
            emitter = created;
            this.agUiStreamByTaskId.set(taskId, emitter);
        }
        return emitter;
    }

    protected parseStructuredLog(
        agentId: string,
        log: string,
    ): {
        content: string;
        segments: QaapAgentMessage['segments'];
        traceEvents: QaapAgentMessage['traceEvents'];
    } | undefined {
        const parsed = parseAgentLogForTranscript(agentId, log);
        if (!parsed.segments?.length && !parsed.traceEvents?.length && !parsed.content?.trim()) {
            return undefined;
        }
        return parsed;
    }

    /** When AG-UI event mapping is empty but the segment accumulator parsed NDJSON, persist that snapshot. */
    protected applyAccumulatorStructuredOutput(
        taskId: string,
        ref: { conversationId: string; userMessageId: string; agentMessageId?: string },
        agentId: string,
    ): void {
        const conv = this.conversations.get(ref.conversationId);
        const stream = this.agentStreamByTaskId.get(taskId);
        if (!conv || !stream) {
            return;
        }
        const segments = [...stream.getSegments()];
        const content = stream.getDisplayText();
        if (!content && segments.length === 0) {
            return;
        }
        const now = Date.now();
        const existingAgentMessage = ref.agentMessageId
            ? conv.messages.find(message => message.id === ref.agentMessageId)
            : undefined;
        const traceEvents = mergeAccumulatorTraceEvents(existingAgentMessage?.traceEvents, stream);
        let agentMessageId = ref.agentMessageId;
        let messages: QaapAgentMessage[];
        if (!agentMessageId) {
            agentMessageId = randomUUID();
            ref.agentMessageId = agentMessageId;
            this.taskToConversation.set(taskId, ref);
            const message: QaapAgentMessage = preferTraceFirstAgentMessageStorage(materializeAgentMessageForApi({
                id: agentMessageId,
                role: 'agent',
                content: content || '…',
                segments,
                ...(traceEvents ? { traceEvents } : {}),
                createdAt: now,
            }));
            messages = [...conv.messages, message];
            this.fireAgentMessageWireUpdate(conv.id, conv.cwd, agentId, message);
        } else {
            messages = conv.messages.map(message => message.id === agentMessageId
                ? preferTraceFirstAgentMessageStorage(materializeAgentMessageForApi({
                    ...message,
                    content: content || message.content,
                    segments: segments.length > 0 ? segments : message.segments,
                    ...(traceEvents ? { traceEvents } : {}),
                }))
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
        if (parsed.traceEvents?.length) {
            return parsed.traceEvents;
        }
        if (parsed.segments?.length) {
            return mergeSegmentTraceEvents(message.traceEvents, parsed.segments);
        }
        return message.traceEvents;
    }

    protected async applyTaskOutcome(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        startSha?: string,
    ): Promise<void> {
        const convSnapshot = this.conversations.get(conversationId);
        if (!convSnapshot) {
            return;
        }
        // Defense-in-depth: a newer turn may have superseded this task (e.g. the user sent a new
        // message that cancelled this one). This task's taskToConversation entry is already removed
        // by the time we get here, so a *different* active task id means this outcome is stale —
        // drop it rather than clobber the live turn's status/message.
        const supersedingTaskId = this.getActiveTaskIdForConversation(conversationId);
        if (supersedingTaskId && supersedingTaskId !== task.id) {
            this.agentStreamByTaskId.delete(task.id);
            this.agUiStreamByTaskId.delete(task.id);
            return;
        }
        const usageFinalized = this.finalizeTurnContextUsage(convSnapshot, task.id, convSnapshot.agentId);
        this.agentStreamByTaskId.delete(task.id);
        this.agUiStreamByTaskId.delete(task.id);
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return;
        }
        const withUsageBaseline: QaapAgentConversation = {
            ...conv,
            contextUsage: usageFinalized.contextUsage,
            contextUsageEstimated: usageFinalized.contextUsageEstimated,
            contextWindowSize: usageFinalized.contextWindowSize,
        };
        if (task.state === 'cancelled') {
            const cancelledReason = 'Turn cancelled.';
            const withCancelledTrace = this.appendRunCancelledTrace(withUsageBaseline, agentMessageId, cancelledReason);
            const finalized = this.finalizeStreamingAgentMessage(withCancelledTrace, agentMessageId, cancelledReason);
            const next: QaapAgentConversation = { ...finalized, status: 'idle', updatedAt: Date.now() };
            this.publishFinalizedAgentMessage(conversationId, next, agentMessageId);
            this.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, next);
            return;
        }
        const detail = await this.taskRunner.detail(task.id);
        const log = this.filterAgentLogChunk((detail?.log ?? '').trim());
        const streamingAgent = agentMessageId
            ? withUsageBaseline.messages.find(message => message.id === agentMessageId)
            : undefined;
        const skipLogReparse = agentMessageHasStructuredTrace(streamingAgent)
            || (usesStructuredAgentTranscript(conv.agentId) && (
                (streamingAgent?.segments?.length ?? 0) > 0
                || (streamingAgent?.traceEvents?.length ?? 0) > 0
            ));
        const structuredParsed = log && !skipLogReparse ? this.parseStructuredLog(conv.agentId, log) : undefined;
        if (task.state !== 'completed') {
            let convForFailure = withUsageBaseline;
            let agentMessageForFailure = streamingAgent;
            if (agentMessageId && log && streamingAgent?.role === 'agent' && !agentMessageHasStructuredTrace(streamingAgent)) {
                const backfilled = materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(
                    this.backfillAgentMessageFromStructuredLog(streamingAgent, conv.agentId, log),
                ));
                agentMessageForFailure = backfilled;
                convForFailure = {
                    ...withUsageBaseline,
                    messages: withUsageBaseline.messages.map(message => message.id === agentMessageId
                        ? backfilled
                        : message),
                };
            }
            if (this.maybeRetryTurnWithFallbackModel(
                conversationId,
                userMessageId,
                agentMessageId,
                task,
                convForFailure,
                agentMessageForFailure,
                startSha,
            )) {
                return;
            }
            const reason = resolveAgentTurnFailureMessage(log, {
                state: task.state === 'interrupted' ? 'interrupted' : 'failed',
                exitCode: task.exitCode,
                agentMessage: agentMessageForFailure,
            });
            const failureBody = log ? resolveAgentLogDisplayText(conv.agentId, log) : '';
            const failed = this.markTurnFailed(convForFailure, {
                userMessageId,
                agentMessageId,
                reason,
                failureBody,
            });
            const resolvedAgentMessageId = failed.agentMessageId ?? agentMessageId;
            const finalized = this.finalizeStreamingAgentMessage(failed.conv, resolvedAgentMessageId, reason);
            this.publishFinalizedAgentMessage(conversationId, finalized, resolvedAgentMessageId);
            this.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, finalized);
            return;
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
            withReply = { ...withUsageBaseline, status: 'idle', updatedAt: Date.now(), messages };
        } else if (agentMessageId) {
            const messages = withUsageBaseline.messages.map(message => {
                if (message.id !== agentMessageId || message.role !== 'agent') {
                    return message;
                }
                const backfilled = log
                    ? this.backfillAgentMessageFromStructuredLog(message, conv.agentId, log)
                    : message;
                return materializeAgentMessageForApi(syncSettledTraceEventsOnMessage(backfilled));
            });
            withReply = { ...withUsageBaseline, status: 'idle', updatedAt: Date.now(), messages };
        } else {
            const displayText = log ? resolveAgentLogDisplayText(conv.agentId, log) : '';
            const body = structuredParsed?.content?.trim() || displayText || '(agent produced no output)';
            const reply = this.appendAgentReply({ ...withUsageBaseline, status: 'idle' }, body);
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
        this.conversations.set(conversationId, withReply);
        const agentMessage = withReply.messages[withReply.messages.length - 1];
        if (agentMessage) {
            this.fireAgentMessageWireUpdate(conversationId, withReply.cwd, withReply.agentId, agentMessage, { forceFullMessage: true });
            this.lastWireMessageById.delete(agentMessage.id);
            this.clearAgUiReducer(agentMessage.id);
        }
        this.modelFallbackTriedByUserMessage.delete(userMessageId);
        this.finishLeaderTurnAndMaybeSynthesize(conversationId, task.id, withReply);
        this.maybeAutoContinueIncompleteTurn(conversationId, withReply, userMessageId);
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

    protected maybeRetryTurnWithFallbackModel(
        conversationId: string,
        userMessageId: string,
        agentMessageId: string | undefined,
        task: QaapAgentTask,
        conv: QaapAgentConversation,
        agentMessage: QaapAgentMessage | undefined,
        startSha?: string,
    ): boolean {
        if (task.state !== 'failed' || !agentSupportsModelPicker(conv.agentId)) {
            return false;
        }
        if (!agentTurnHasRetryableEmptyOutput(agentMessage)
            && !agentTurnHasRetryableQuotaFailure(agentMessage)
            && !agentTurnHasRetryableModelFailure(agentMessage)) {
            return false;
        }
        if (!this.hasLoopSpawnBudget(userMessageId)) {
            this.modelFallbackTriedByUserMessage.delete(userMessageId);
            return false;
        }
        const currentModel = conv.agentModel
            ?? conv.qaiqModel
            ?? resolveTaskAgentModel(task);
        const tried = this.modelFallbackTriedByUserMessage.get(userMessageId) ?? new Set<string>();
        const currentKey = agentModelKey(currentModel);
        if (currentKey) {
            tried.add(currentKey);
        }
        const nextModel = resolveNextFallbackAgentModel(conv.agentId, currentModel, tried);
        if (!nextModel) {
            this.modelFallbackTriedByUserMessage.delete(userMessageId);
            return false;
        }
        const messages = conv.messages
            .filter(message => message.id !== agentMessageId)
            .map(message => message.id === userMessageId
                ? { ...message, error: undefined, taskId: undefined }
                : message);
        const retryConv: QaapAgentConversation = {
            ...conv,
            status: 'streaming',
            updatedAt: Date.now(),
            messages,
            agentModel: nextModel,
            qaiqModel: nextModel,
        };
        let spawned: QaapAgentTask;
        try {
            spawned = this.taskRunner.create(this.buildTaskCreateRequest(retryConv, conv.agentId));
        } catch {
            return false;
        }
        this.recordLoopSpawn(userMessageId);
        const nextKey = agentModelKey(nextModel);
        if (nextKey) {
            tried.add(nextKey);
        }
        this.modelFallbackTriedByUserMessage.set(userMessageId, tried);
        const messagesWithTask = retryConv.messages.map(message => message.id === userMessageId
            ? { ...message, taskId: spawned.id }
            : message);
        const nextConv = { ...retryConv, messages: messagesWithTask };
        this.conversations.set(conversationId, nextConv);
        this.fire({ type: 'updated', conversation: toConversationSummary(nextConv) });
        this.taskToConversation.set(spawned.id, {
            conversationId,
            userMessageId,
            startSha,
        });
        void this.persist();
        return true;
    }

    protected maybeAutoContinueIncompleteTurn(
        conversationId: string,
        conv: QaapAgentConversation,
        userMessageId: string,
    ): void {
        if (!QAAP_AGENT_AUTO_CONTINUE_ENABLED) {
            return;
        }
        const userMessage = conv.messages.find(message => message.id === userMessageId);
        const agentMessage = conv.messages[conv.messages.length - 1];
        if (!userMessage || !agentMessage || agentMessage.role !== 'agent' || conv.status !== 'idle') {
            return;
        }
        // Only auto-continue in the fully-autonomous agent contract. plan/ask modes and
        // request-approval / manual-approve turns are deliberate stops the user opted into —
        // re-posting a "keep working" prompt there contradicts the chosen interaction mode.
        if (!autoContinueAllowedForInteraction(conv)) {
            return;
        }
        if (!isIncompleteAgentTurn(userMessage.content, agentMessage)) {
            return;
        }
        const attempts = this.autoContinueCountByUserMessage.get(userMessageId) ?? 0;
        if (attempts >= 2 || !this.hasLoopSpawnBudget(userMessageId)) {
            if (attempts >= 2 && messageRequestsDevPreview(userMessage.content)) {
                this.reportPreviewBootstrapFailure(conversationId, buildDevPreviewAutoContinueExhaustedReason());
            }
            return;
        }
        this.autoContinueCountByUserMessage.set(userMessageId, attempts + 1);
        this.recordLoopSpawn(userMessageId);
        try {
            this.postUserMessage(
                conversationId,
                buildAgentAutoContinuePrompt(userMessage.content),
                conv.agentId,
                conv.agentModel ?? conv.qaiqModel,
                conv.autoApprove,
                conv.interactionModeId,
                conv.approvalPolicyId,
                conv.toolApprovalRules,
            );
        } catch {
            /* turn already replaced or cancelled */
        }
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

    protected appendAgentReply(conv: QaapAgentConversation, content: string): QaapAgentConversation {
        const message: QaapAgentMessage = {
            id: randomUUID(),
            role: 'agent',
            content,
            createdAt: Date.now(),
        };
        return {
            ...conv,
            status: conv.status === 'failed' ? 'failed' : 'idle',
            updatedAt: message.createdAt,
            messages: [...conv.messages, message],
        };
    }

    protected markTurnFailed(
        conv: QaapAgentConversation,
        options: {
            readonly userMessageId: string;
            readonly agentMessageId?: string;
            readonly reason: string;
            readonly failureBody?: string;
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
            };
            agentMessageId = failureMessage.id;
            messages = [...messages, failureMessage];
        }
        return {
            conv: {
                ...conv,
                status: 'failed',
                updatedAt: Date.now(),
                messages,
            },
            agentMessageId,
        };
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
            return next;
        });
        return { ...conv, messages };
    }

    protected appendRunCancelledTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        reason: string,
    ): QaapAgentConversation {
        if (!agentMessageId) {
            return conv;
        }
        return {
            ...conv,
            messages: conv.messages.map(message => message.id === agentMessageId && message.role === 'agent'
                ? appendTraceRunCancelledEvent(message, { reason })
                : message),
        };
    }

    protected appendCheckpointTrace(
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
        checkpoint: QaapConversationCheckpoint,
    ): QaapAgentConversation {
        const targetId = agentMessageId ?? conv.messages[conv.messages.length - 1]?.id;
        if (!targetId) {
            return conv;
        }
        return {
            ...conv,
            messages: conv.messages.map(message => message.id === targetId && message.role === 'agent'
                ? appendTraceCheckpointEvent(message, checkpoint)
                : message),
        };
    }

    protected publishFinalizedAgentMessage(
        conversationId: string,
        conv: QaapAgentConversation,
        agentMessageId: string | undefined,
    ): void {
        if (!agentMessageId) {
            return;
        }
        const agentMessage = conv.messages.find(message => message.id === agentMessageId);
        if (agentMessage) {
            this.fireAgentMessageWireUpdate(conversationId, conv.cwd, conv.agentId, agentMessage, { forceFullMessage: true });
            this.lastWireMessageById.delete(agentMessage.id);
            this.clearAgUiReducer(agentMessage.id);
        }
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
        if (conv.messages.length < 6 || !shouldCompressConversationPrompt(conv.messages, conv.contextPreamble, conv.contextWindowSize)) {
            return conv;
        }
        const lastUser = conv.messages[conv.messages.length - 1];
        if (lastUser?.role !== 'user') {
            return conv;
        }
        const history = conv.messages.slice(0, -1);
        const { compressed } = partitionConversationHistory(history);
        if (compressed.length === 0) {
            return conv;
        }
        const existing = conv.contextCompaction;
        if (existing?.status === 'complete' && existing.compactedMessageCount >= compressed.length && existing.summary?.trim()) {
            return conv;
        }
        const now = Date.now();
        const running: QaapContextCompaction = {
            status: 'running',
            startedAt: now,
            compactedMessageCount: compressed.length,
            sourceMessageCount: conv.messages.length,
        };
        const withRunning: QaapAgentConversation = {
            ...conv,
            contextCompaction: running,
            updatedAt: now,
        };
        this.conversations.set(conv.id, withRunning);
        this.fire({ type: 'updated', conversation: toConversationSummary(withRunning) });

        return {
            ...withRunning,
            contextCompaction: {
                ...running,
                status: 'complete',
                summary: this.buildContextCompactionSummary(compressed),
                completedAt: Date.now(),
            },
            contextUsageEstimated: true,
            contextWindowSize: conv.contextWindowSize ?? DEFAULT_QAAP_CONTEXT_WINDOW,
            updatedAt: Date.now(),
        };
    }

    protected buildContextCompactionSummary(messages: readonly QaapAgentMessage[]): string {
        const lines: string[] = [
            'Automatic context compaction summary. Use this as the authoritative memory for earlier turns.',
        ];
        let lastRole: 'User' | 'Assistant' | undefined;
        for (const message of messages) {
            const body = this.contextCompactionMessageText(message);
            if (!body) {
                continue;
            }
            const role = message.role === 'user' ? 'User' : 'Assistant';
            const prefix = role === lastRole ? '-' : `${role}:`;
            lines.push(`${prefix} ${body}`);
            lastRole = role;
            if (lines.join('\n').length > 5_500) {
                lines.push('…');
                break;
            }
        }
        return lines.join('\n');
    }

    protected contextCompactionMessageText(message: QaapAgentMessage): string {
        const parts: string[] = [];
        const content = message.content.replace(/\s+/g, ' ').trim();
        if (content) {
            parts.push(content);
        }
        for (const segment of message.segments ?? []) {
            if (segment.type === 'text' && segment.content.trim()) {
                parts.push(segment.content.replace(/\s+/g, ' ').trim());
            } else if (segment.type === 'tool') {
                const result = segment.result?.replace(/\s+/g, ' ').trim();
                parts.push(result ? `[tool ${segment.name}] ${result}` : `[tool ${segment.name}]`);
            }
        }
        const text = parts.join(' ').trim();
        return text.length > 520 ? `${text.slice(0, 519).trimEnd()}…` : text;
    }

    protected buildTaskCreateRequest(
        conv: QaapAgentConversation,
        turnAgentId: string,
        latencyMarks?: QaapCreateAgentConversationRequest['latencyMarks'],
    ): QaapCreateAgentTaskRequest {
        const lastUser = conv.messages[conv.messages.length - 1];
        if (turnAgentId === 'shell') {
            return {
                command: this.stripLeadingAgentMention(lastUser.content),
                cwd: conv.cwd,
                title: conv.title,
            };
        }
        return {
            prompt: this.buildPrompt(conv),
            agent: turnAgentId,
            cwd: conv.cwd,
            title: conv.title,
            // Clean latest user message (mention-stripped) for opt-in relevance retrieval.
            ...(lastUser?.content ? { userQuery: this.stripLeadingAgentMention(lastUser.content) } : {}),
            ...(conv.autoApprove === false ? { autoApprove: false } : {}),
            ...(conv.contextPreamble ? { contextPreamble: conv.contextPreamble } : {}),
            ...(conv.interactionModeId ? { interactionModeId: conv.interactionModeId } : {}),
            ...(conv.approvalPolicyId ? { approvalPolicyId: conv.approvalPolicyId } : {}),
            ...(conv.toolApprovalRules ? { toolApprovalRules: conv.toolApprovalRules } : {}),
            ...(latencyMarks ? { latencyMarks } : {}),
            ...(() => {
                const agentModel = conv.agentModel ?? conv.qaiqModel;
                return agentSupportsModelPicker(turnAgentId) && agentModel
                    ? { agentModel, qaiqModel: agentModel }
                    : {};
            })(),
        };
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
     * role-tagged blocks: every coding-agent CLI we support (`claude -p`, `codex exec`, `aider`)
     * accepts free-form text as a single shell-quoted argument, so an explicit transcript is the
     * most robust way to carry multi-turn context without depending on agent-specific resume APIs.
     */
    protected buildPrompt(conv: QaapAgentConversation): string {
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
            return skipDelegation ? prompt : this.appendTeamDelegation(prompt, conv.agentId);
        }
        const transcript = buildConversationAgentPrompt({
            history,
            latestUserContent: latestUser,
            contextPreamble: compaction
                ? this.contextPreambleWithCompaction(conv.contextPreamble, compaction.summary!)
                : conv.contextPreamble,
            contextWindowSize: conv.contextWindowSize,
        });
        return skipDelegation ? transcript : this.appendTeamDelegation(transcript, conv.agentId);
    }

    protected contextPreambleWithCompaction(contextPreamble: string | undefined, summary: string): string {
        const parts = [contextPreamble?.trim(), `Earlier conversation context has been compacted:\n${summary.trim()}`]
            .filter((part): part is string => !!part);
        return parts.join('\n\n');
    }

    /** Inject lightweight team-delegation instructions so the leader can spawn sub-tasks via `qaap-task`. */
    protected appendTeamDelegation(prompt: string, turnAgentId: string): string {
        const agentIds = this.taskRunner.listAgents().map(agent => agent.id);
        return appendTeamDelegationToPrompt(prompt, turnAgentId, agentIds);
    }

    /** Drop repetitive QAIQ/OpenClaude metadata noise from chat transcripts (still kept in task logs). */
    protected filterAgentLogChunk(chunk: string): string {
        return filterAgentProcessLogChunk(chunk);
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
        return deriveConversationTitle(seed);
    }

    protected fire(event: QaapAgentConversationEvent): void {
        this.sseBatcher.enqueue(event);
    }

    /**
     * Apply one AG-UI event onto the streaming tail agent message — emits incremental wire deltas
     * (append/patch_trace_event) instead of full message replacements when possible.
     */
    applyAgUiTranscriptEvent(conversationId: string, event: QaapAgUiEvent): QaapAgentConversation | undefined {
        const conv = this.conversations.get(conversationId);
        if (!conv) {
            return undefined;
        }
        const now = Date.now();
        let agentMessageId = conv.messages[conv.messages.length - 1]?.role === 'agent'
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
            };
            messages = [...conv.messages, seed];
            this.agUiReducerByAgentMessageId.delete(agentMessageId);
        }
        const previousReducer = this.agUiReducerByAgentMessageId.get(agentMessageId);
        const { next: reducer } = reduceQaapAgUiTranscriptEvent(previousReducer, event, {
            agentMessageId,
            createdAt: messages.find(message => message.id === agentMessageId)?.createdAt ?? now,
            agentId: conv.agentId,
        });
        this.agUiReducerByAgentMessageId.set(agentMessageId, reducer);
        const agentMessage = buildAgentMessageFromQaapAgUiReducer(
            reducer,
            messages.find(message => message.id === agentMessageId)?.createdAt ?? now,
        );
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
        this.fireAgentMessageWireUpdate(conversationId, next.cwd, next.agentId, agentMessage);
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
        const snapshot = toAgentMessageWireSnapshot(message);
        if (options?.forceFullMessage) {
            this.lastWireMessageById.set(message.id, snapshot);
            const wireMessage = {
                type: 'message' as const,
                conversationId,
                cwd,
                message,
            };
            this.stageWireMetricsBaseline(conversationId, message.id, wireMessage);
            this.fire({
                ...wireMessage,
                message: compressAgentMessageForWire(toAgentMessageWirePayload(message)),
            });
            return;
        }
        const previous = this.lastWireMessageById.get(message.id);
        const delta = computeAgentMessageWireDelta(previous, snapshot, agentId);
        if (delta.kind === 'noop') {
            return;
        }
        this.lastWireMessageById.set(message.id, snapshot);
        if (delta.kind === 'message_start' || delta.kind === 'replace') {
            const wireMessage = {
                type: 'message' as const,
                conversationId,
                cwd,
                message: delta.message,
            };
            this.stageWireMetricsBaseline(conversationId, message.id, wireMessage);
            this.fire({
                ...wireMessage,
                message: compressAgentMessageForWire(delta.message),
            });
            return;
        }
        const wireDelta = {
            type: 'message_delta' as const,
            conversationId,
            cwd,
            messageId: message.id,
            delta,
        };
        this.stageWireMetricsBaseline(conversationId, message.id, wireDelta);
        this.fire({
            ...wireDelta,
            delta: compressAgentMessageWireDeltaForWire(delta),
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
        try {
            const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
            if (result.status !== 0) {
                return undefined;
            }
            const url = result.stdout.trim();
            const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(url);
            if (ssh) {
                return { owner: ssh[1], name: ssh[2].replace(/\.git$/, '') };
            }
            const https = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?/i.exec(url);
            if (https) {
                return { owner: https[1], name: https[2].replace(/\.git$/, '') };
            }
        } catch { /* not a git repo */ }
        return undefined;
    }

    protected readGitBranch(cwd: string): string | undefined {
        try {
            const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
            if (result.status === 0) {
                const branch = result.stdout.trim();
                return branch && branch !== 'HEAD' ? branch : undefined;
            }
        } catch { /* not a git repo */ }
        return undefined;
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
            const sweptAny = this.sweepZombieStreamingTurns(Date.now(), { resetSurvivorsToIdle: true });
            if (anyChanged || sweptAny) {
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
        const maxTurnMinutes = resolveQaapMaxTurnMinutes(process.env[QAAP_MAX_TURN_MINUTES_ENV]);
        const streaming: QaapStreamingTurnSnapshot[] = [];
        for (const conv of this.conversations.values()) {
            if (conv.status !== 'streaming') {
                continue;
            }
            // A turn paused on a pending approval is NOT a zombie — the user is being asked to
            // approve a tool. Force-failing it at the watchdog with a misleading "exceeded max time"
            // message punishes a present user who simply took a while to decide; the task idle-timer
            // already makes the same exception. Pending requests only exist while the runner is up,
            // so a stale post-restart turn (runner empty) is still reset/finalized normally. (REL-5)
            if (this.turnHasPendingApproval(conv)) {
                continue;
            }
            const streamingSinceMs = resolveStreamingSinceMs(conv);
            if (streamingSinceMs !== undefined) {
                streaming.push({ conversationId: conv.id, streamingSinceMs });
            }
        }
        const expiredIds = new Set(findExpiredStreamingTurns(streaming, nowMs, maxTurnMinutes));
        let changed = false;
        for (const turn of streaming) {
            if (expiredIds.has(turn.conversationId)) {
                if (this.forceStopZombieTurn(turn.conversationId, nowMs - turn.streamingSinceMs, maxTurnMinutes)) {
                    changed = true;
                }
            } else if (options?.resetSurvivorsToIdle) {
                if (this.interruptStreamingTurnForRestart(turn.conversationId, nowMs)) {
                    changed = true;
                }
            }
        }
        if (changed) {
            this.flushPersist();
        }
        return changed;
    }

    /**
     * Force-settle one zombie turn: kill the underlying agent process (and any delegated
     * subtasks) via the same kill path {@link cancel} uses, mark the turn failed with a
     * watchdog-specific message, and publish the change over SSE.
     */
    protected forceStopZombieTurn(conversationId: string, elapsedMs: number, maxTurnMinutes: number): boolean {
        const conv = this.conversations.get(conversationId);
        if (!conv || conv.status !== 'streaming') {
            return false;
        }
        const reason = buildQaapTurnWatchdogMessage(elapsedMs);
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId);
        const turnRef = lastUser?.taskId ? this.taskToConversation.get(lastUser.taskId) : undefined;
        if (lastUser?.taskId) {
            this.taskRunner.cancel(lastUser.taskId);
            for (const subtask of collectSubtasksForLeader(lastUser.taskId, this.taskRunner.list())) {
                if (subtask.state === 'running') {
                    this.taskRunner.cancel(subtask.id);
                }
            }
        }
        // Re-read: cancelling the task above can synchronously settle it through the normal
        // task-outcome path first (generic "Turn cancelled." reason) — our watchdog message
        // below is the one that should stick, so it must be layered on top of the latest state.
        const latest = this.conversations.get(conversationId) ?? conv;
        const agentMessageId = turnRef?.agentMessageId
            ?? (latest.messages[latest.messages.length - 1]?.role === 'agent'
                ? latest.messages[latest.messages.length - 1].id
                : undefined);
        const withTrace = this.appendRunCancelledTrace(latest, agentMessageId, reason);
        const finalized = this.finalizeStreamingAgentMessage(withTrace, agentMessageId, reason);
        const failed = this.markTurnFailed(finalized, {
            userMessageId: lastUser?.id ?? latest.messages[latest.messages.length - 1]?.id ?? '',
            agentMessageId,
            reason,
        });
        const resolvedAgentMessageId = failed.agentMessageId ?? agentMessageId;
        const next: QaapAgentConversation = { ...failed.conv, updatedAt: Date.now() };
        this.conversations.set(conversationId, next);
        this.publishFinalizedAgentMessage(conversationId, next, resolvedAgentMessageId);
        this.fire({ type: 'updated', conversation: toConversationSummary(next) });
        console.warn(
            `[qaap-agent-conversation-watchdog] auto-stopped conversation ${conversationId} `
            + `after ${elapsedMs}ms streaming (max ${maxTurnMinutes}m).`,
        );
        return true;
    }

    /**
     * Finalize a turn that was still 'streaming' when the backend restarted. The live task
     * handle never survives a restart, so the turn can never settle on its own; rather than
     * silently resetting it to 'idle' — which the UI renders as a phantom completion with the
     * user's message and no agent reply — mark it failed with a visible interrupted trace so
     * the turn is clearly ended and can be retried.
     */
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
        try {
            const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
            if (result.status === 0) {
                return result.stdout.trim();
            }
        } catch { /* not a git repo */ }
        return undefined;
    }

    protected computeGitDiffStats(cwd: string, startSha?: string): { added: number; removed: number } | undefined {
        try {
            let added = 0;
            let removed = 0;
            if (startSha) {
                const committed = spawnSync('git', ['diff', '--numstat', `${startSha}..HEAD`], { cwd, encoding: 'utf8' });
                if (committed.status === 0 && committed.stdout) {
                    const stats = parseGitNumstat(committed.stdout);
                    added += stats.added;
                    removed += stats.removed;
                }
            }
            const uncommitted = spawnSync('git', ['diff', '--numstat', 'HEAD'], { cwd, encoding: 'utf8' });
            if (uncommitted.status === 0 && uncommitted.stdout) {
                const stats = parseGitNumstat(uncommitted.stdout);
                added += stats.added;
                removed += stats.removed;
            }
            if (added === 0 && removed === 0) {
                return undefined;
            }
            return { added, removed };
        } catch {
            return undefined;
        }
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
        const clean = content.replace(/\s+/g, ' ').trim();
        return clean.length > 60 ? `${clean.slice(0, 57)}…` : (clean || 'Turn');
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
        try {
            return fs.statSync(target).isDirectory();
        } catch {
            return false;
        }
    }
}

function parseGitNumstat(output: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const line of output.split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length >= 2) {
            const a = parseInt(parts[0], 10);
            const r = parseInt(parts[1], 10);
            if (!isNaN(a)) { added += a; }
            if (!isNaN(r)) { removed += r; }
        }
    }
    return { added, removed };
}
