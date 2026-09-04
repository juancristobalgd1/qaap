// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapLinkedPullRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapCreateAgentTaskQaiqModel } from './qaap-agent-task-client';
import { buildConversationListMetrics, type QaapSidebarGitActionKind } from './qaap-agent-conversation-list-metrics';
import {
    estimateConversationTokensFromMessages,
    type QaapAgentContextUsage,
} from './qaap-agent-context-usage';
import { resolveMessagePreviewText } from './qaap-agent-message-content';
import type { QaapAgentToolApprovalRules } from './qaap-agent-tool-approval-rules';
import type { QaapAgentWireCompressionEncoding } from './qaap-agent-wire-encoding';
import { Disposable } from '@theia/core/lib/common/disposable';
import { resolveTranscriptEffectiveStatus } from './qaap-transcript-turn-status';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';
import type { QaapTranscriptUserImagePreview } from './qaap-transcript-user-image-preview';
import type { QaapTurnLatencyMark } from './qaap-agent-stream-metrics';
import { normalizeQaapVisualPreviewUrl, type QaapPreviewVisualValidationResult } from './qaap-visual-verification';
import type { ComposerGitActionDisplayMetadata } from './qaap-composer-git-action-display';

/**
 * HTTP helpers for the persistent VPS agent-conversation API.
 * Keep {@link QAAP_AGENT_CONVERSATION_API_PATH} in sync with `@theia/qaap-cloud-workspace`.
 */
export const QAAP_AGENT_CONVERSATION_API_PATH = '/qaap/api/agent-conversations';

// ─── Delivery modes ──────────────────────────────────────────────────────────

/**
 * How a user message is delivered when the conversation already has an agent running.
 * Mirrors `QaapMessageDeliveryMode` from `@theia/qaap-cloud-workspace`.
 *
 * - `'queue'` (default): enqueue and process when the agent finishes.
 * - `'parallel'`: spawn a new conversation in an isolated git worktree.
 * - `'interrupt'`: cancel the running agent and process immediately.
 */
export type QaapMessageDeliveryMode = 'queue' | 'parallel' | 'interrupt';

/** Default delivery mode when the client does not specify one. */
export const QAAP_DEFAULT_DELIVERY_MODE: QaapMessageDeliveryMode = 'queue';
/** Keep in sync with `@theia/qaap-cloud-workspace` {@link QAAP_AGENT_CONVERSATION_WS_PATH}. */
export const QAAP_AGENT_CONVERSATION_WS_PATH = `${QAAP_AGENT_CONVERSATION_API_PATH}/ws`;

let conversationLiveCancel: ((id: string) => Promise<void>) | undefined;

/** Registers a WebSocket-first cancel handler from {@link MobileProjectsConversations}. */
export function registerConversationLiveCancel(handler: (id: string) => Promise<void>): Disposable {
    conversationLiveCancel = handler;
    return Disposable.create(() => {
        if (conversationLiveCancel === handler) {
            conversationLiveCancel = undefined;
        }
    });
}

export interface QaapAgentConversationSummaryDTO {
    readonly id: string;
    readonly source?: 'qaap-agent' | 'theia-chat';
    readonly cwd: string;
    readonly agentId: string;
    readonly title: string;
    readonly status: 'idle' | 'streaming' | 'settled' | 'failed';
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly messageCount: number;
    readonly lastMessagePreview?: string;
    readonly lastMessageRole?: 'user' | 'agent';
    readonly workspacePath?: string;
    readonly sessionId?: string;
    /** User-flagged "high priority" — sorts at the top of the project list. */
    readonly priority?: boolean;
    /** User-flagged "paused" — sinks to the bottom and renders dimmed. */
    readonly paused?: boolean;
    /** User-flagged "archived" — hidden from the main task list. */
    readonly archived?: boolean;
    /** When `false`, tool calls need manual CLI approval on the VPS. */
    readonly autoApprove?: boolean;
    /** Last explicit model picked in the composer for this thread. */
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    /** Last composer interaction mode (`agent`, `plan`, `ask`). */
    readonly interactionModeId?: string;
    /** Last composer approval preset id. */
    readonly approvalPolicyId?: string;
    /** Id of the parent conversation when this one was created via fork. */
    readonly forkedFromId?: string;
    /** Set on parallel-run variant conversations — groups them under {@link parallelBaseCwd}. */
    readonly parallelRunId?: string;
    readonly parallelBaseCwd?: string;
    /** Branch of the dedicated git worktree this conversation runs in (composer "New Worktree"). */
    readonly worktreeBranch?: string;
    readonly activityLabel?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly turnStartedAt?: number;
    readonly turnProgressCurrent?: number;
    readonly turnProgressTotal?: number;
    readonly lastTurnDurationMs?: number;
    readonly linkedPullRequest?: QaapLinkedPullRequest;
    /** Set when the thread ran `git` or is tied to a PR — used by the Work Hub inbox filter. */
    readonly hasGitOperation?: boolean;
    /**
     * Coarse last git workflow / CLI kind for sidebar glyphs
     * (branch / commit / push / changes — PR lifecycle uses {@link linkedPullRequest}).
     */
    readonly lastGitActionKind?: QaapSidebarGitActionKind;
    readonly contextUsage?: QaapAgentContextUsage;
    readonly contextWindowSize?: number;
    readonly contextUsageEstimated?: boolean;
    readonly estimatedContextTokens?: number;
    readonly contextCompaction?: QaapContextCompactionDTO;
    /** Server-authoritative: the last settled turn still needs visual evidence (see autopilot). */
    readonly visualVerificationPending?: boolean;
    /** Number of user messages queued for the next agent turn (delivery mode 'queue'). */
    readonly pendingUserMessageCount?: number;
}

export type QaapAgentMessageSegmentDTO =
    | { readonly type: 'text'; readonly content: string }
    | { readonly type: 'thinking'; readonly content: string }
    | {
        readonly type: 'tool';
        readonly toolUseId: string;
        readonly name: string;
        readonly args: string;
        readonly argsEncoding?: QaapAgentWireCompressionEncoding;
        readonly finished: boolean;
        readonly result?: string;
        readonly resultEncoding?: QaapAgentWireCompressionEncoding;
        /** Optional VPS timestamps for per-step duration in the execution timeline. */
        readonly startedAt?: number;
        readonly finishedAt?: number;
        /** Parent Agent/Task toolUseId when this step ran inside a subagent (stream-json). */
        readonly parentToolUseId?: string;
    };

export interface QaapAgentMessageDTO {
    readonly id: string;
    readonly role: 'user' | 'agent';
    readonly content: string;
    /** Correlates a persisted user row with the client-only optimistic row it confirms. */
    readonly clientMessageId?: string;
    /** Structured Codex/Cursor-style execution trace. Preferred over parsing content. */
    readonly traceEvents?: QaapTranscriptTraceEventDTO[];
    /** Legacy transport shape retained for existing VPS agents. Prefer traceEvents for new providers. */
    readonly segments?: QaapAgentMessageSegmentDTO[];
    readonly createdAt: number;
    readonly taskId?: string;
    /**
     * Set on the user message that triggered a turn: which agent actually drove it. See the
     * backend {@code QaapAgentMessage.turnAgentId} doc — per-message, unlike the per-conversation
     * (last-write-wins) {@link QaapAgentConversationDTO.agentId}.
     */
    readonly turnAgentId?: string;
    /** Set alongside {@link turnAgentId}: the model that drove this turn. */
    readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel;
    readonly error?: string;
    /**
     * Set on an agent message: the user message whose run produced it. See the backend
     * {@code QaapAgentMessage.runUserMessageId} doc — array order cannot pair the two once
     * several runs share a session. Read via {@link resolveRunUserMessageId}.
     */
    readonly runUserMessageId?: string;
    /** True while THIS agent message's run is still streaming (in-session multitasking). */
    readonly runActive?: boolean;
    /** Client-only attachment previews for optimistic pending-user rows (never sent to VPS). */
    readonly optimisticImagePreviews?: readonly QaapTranscriptUserImagePreview[];
}

export interface QaapContextCompactionDTO {
    readonly status: 'running' | 'complete';
    readonly summary?: string;
    readonly startedAt: number;
    readonly completedAt?: number;
    readonly compactedMessageCount: number;
    readonly sourceMessageCount: number;
}

/** A per-turn working-tree snapshot (Timeline / rollback). Mirrors the backend checkpoint. */
export interface QaapConversationCheckpointDTO {
    readonly id: string;
    readonly messageId: string;
    readonly label: string;
    readonly commit: string;
    readonly ref: string;
    readonly capturedAt: number;
    readonly added?: number;
    readonly removed?: number;
}

/**
 * Full conversation document as returned by the GET/POST detail endpoints. It carries the live
 * message list but not the summary's denormalized preview/messageCount — call
 * {@link conversationToSummary} to get a {@link QaapAgentConversationSummaryDTO}.
 */
export interface QaapAgentConversationDTO {
    readonly id: string;
    readonly cwd: string;
    readonly agentId: string;
    readonly title: string;
    readonly status: 'idle' | 'streaming' | 'settled' | 'failed';
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly messages: QaapAgentMessageDTO[];
    readonly priority?: boolean;
    readonly paused?: boolean;
    readonly archived?: boolean;
    readonly autoApprove?: boolean;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: QaapAgentToolApprovalRules;
    readonly forkedFromId?: string;
    readonly parallelRunId?: string;
    readonly parallelBaseCwd?: string;
    readonly worktreeBranch?: string;
    readonly checkpoints?: QaapConversationCheckpointDTO[];
    readonly linkedPullRequest?: QaapLinkedPullRequest;
    readonly contextPreamble?: string;
    readonly contextUsage?: QaapAgentContextUsage;
    readonly contextWindowSize?: number;
    readonly contextUsageEstimated?: boolean;
    readonly contextCompaction?: QaapContextCompactionDTO;
    /** User messages queued for the next agent turn (delivery mode 'queue'). */
    readonly pendingUserMessages?: QaapPendingUserMessageDTO[];
}

/** A user message waiting in the queue (delivery mode 'queue'), not yet in the transcript. */
export interface QaapPendingUserMessageDTO {
    readonly id: string;
    readonly content: string;
    readonly createdAt: number;
    readonly turnAgentId?: string;
    readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel;
    readonly clientMessageId?: string;
}

function resolveEffectiveConversationStatus(conv: QaapAgentConversationDTO): QaapAgentConversationSummaryDTO['status'] {
    const effective = resolveTranscriptEffectiveStatus(conv);
    if (effective === 'failed' || conv.messages.some(message => !!message.error)) {
        return 'failed';
    }
    if (effective === 'settled') {
        return 'settled';
    }
    return effective;
}

/**
 * Text prefix some agent CLIs use to self-report giving up mid-turn (e.g. after repeated tool
 * failures) while still exiting cleanly. The backend task state is `completed` in that case, so
 * `conv.status` never flips to `failed` and no message carries `.error` — the only trace of the
 * failure is this wording in the agent's own final message. Distinct from cancellation: a cancelled
 * turn's last text is whatever partial content had streamed before the stop (the "Turn cancelled."
 * marker is carried on a separate `run_cancelled` trace event, never written into message content),
 * so it never matches this pattern.
 */
const SELF_REPORTED_AGENT_STOP_FAILURE_PATTERN = /^stopped\s*[:.]/i;

/** True when an agent's last message reads like a self-reported stop/failure (see above). */
export function looksLikeSelfReportedAgentStopFailure(text: string | undefined): boolean {
    return !!text && SELF_REPORTED_AGENT_STOP_FAILURE_PATTERN.test(text.trim());
}

/**
 * Single source of truth for "this is a failed run" — shared by the failed-tasks badge/menu count
 * ({@link countFailedTasks} equivalents), the "Clear failed runs" delete filter, and the per-row
 * warning glyph, so they can never diverge.
 *
 * Combines the structured `status` signal with a text-based approximation for turns the agent
 * self-reported as stopped/failed while still exiting cleanly. The approximation is necessary
 * because {@link QaapAgentConversationSummaryDTO} does not carry a dedicated error/failure field —
 * only the full conversation's per-message `error` field does, and recomputing that would require an
 * extra backend call per row.
 *
 * Deliberately excludes clean user-cancellations: a cancelled turn's `lastMessagePreview` is
 * whatever the agent had streamed so far, not a self-reported-stop phrase, and the `run_cancelled`
 * marker itself is only available as a trace event on the full conversation — not on the summary —
 * so it cannot be checked here.
 */
export function isFailedRunSummary(
    summary: Pick<QaapAgentConversationSummaryDTO, 'status' | 'lastMessageRole' | 'lastMessagePreview'>,
): boolean {
    if (summary.status === 'failed') {
        return true;
    }
    return summary.lastMessageRole === 'agent' && looksLikeSelfReportedAgentStopFailure(summary.lastMessagePreview);
}

/**
 * Merge a fresh conversation summary into a cached row without allowing a completed server turn
 * to remain visually streaming. Server terminal states are authoritative when their timestamps
 * tie with the final stream delta, which is common when both writes land in the same millisecond.
 */
export function preferQaapConversationSummary(
    current: QaapAgentConversationSummaryDTO,
    next: QaapAgentConversationSummaryDTO,
): QaapAgentConversationSummaryDTO {
    const currentStreaming = current.status === 'streaming';
    const nextTerminal = next.status === 'idle' || next.status === 'settled' || next.status === 'failed';
    if (currentStreaming && nextTerminal) {
        return next.updatedAt >= current.updatedAt ? next : current;
    }
    if ((current.status === 'idle' || current.status === 'settled')
        && next.status === 'streaming'
        && current.updatedAt >= next.updatedAt) {
        return current;
    }
    if (current.status === 'failed' && next.status === 'streaming') {
        const startsNewTurn = next.updatedAt > current.updatedAt
            && next.messageCount > current.messageCount;
        return startsNewTurn ? next : current;
    }
    if (current.status !== 'streaming' && next.status === 'streaming') {
        return { ...next, id: current.id };
    }
    if (current.id.startsWith('theia-chat-service:')) {
        return {
            ...current,
            title: current.title || next.title,
            messageCount: Math.max(current.messageCount, next.messageCount),
            updatedAt: Math.max(current.updatedAt, next.updatedAt),
            lastMessagePreview: current.lastMessagePreview ?? next.lastMessagePreview,
        };
    }
    // Normal summary updates may legitimately share a timestamp (for example a title and status
    // update in one response), so retain their fresh fields. A same-tick non-failed event must not
    // erase an already-observed failure, however.
    if (current.status === 'failed' && next.status !== 'failed' && next.updatedAt <= current.updatedAt) {
        return current;
    }
    return next.updatedAt >= current.updatedAt ? next : current;
}

/** Move legacy user-turn errors onto the following agent row for transcript rendering. */
export function normalizeAgentConversationFailures(conv: QaapAgentConversationDTO): QaapAgentConversationDTO {
    if (!conv.messages.some(message => message.role === 'user' && message.error?.trim())) {
        return conv;
    }
    const messages = conv.messages.map(message => ({ ...message }));
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.role !== 'user' || !message.error?.trim()) {
            continue;
        }
        const failureReason = message.error;
        messages[index] = { ...message, error: undefined };
        const next = messages[index + 1];
        if (next?.role === 'agent') {
            if (!next.error?.trim()) {
                messages[index + 1] = { ...next, error: failureReason };
            }
            continue;
        }
        messages.splice(index + 1, 0, {
            id: `${message.id}:turn-failure`,
            role: 'agent',
            content: '',
            error: failureReason,
            createdAt: message.createdAt + 1,
        });
    }
    return { ...conv, messages };
}

export function conversationToSummary(conv: QaapAgentConversationDTO): QaapAgentConversationSummaryDTO {
    const last = conv.messages[conv.messages.length - 1];
    const status = resolveEffectiveConversationStatus(conv);
    const clean = last
        ? resolveMessagePreviewText(last).replace(/\s+/g, ' ').trim()
        : undefined;
    const preview = clean === undefined
        ? undefined
        : clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
    const metrics = buildConversationListMetrics({ status, messages: conv.messages });
    const hasGitOperation = metrics.hasGitOperation || conv.linkedPullRequest
        ? true
        : undefined;
    return {
        id: conv.id,
        cwd: conv.cwd,
        agentId: conv.agentId,
        title: conv.title,
        status,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
        lastMessagePreview: preview,
        lastMessageRole: last?.role,
        priority: conv.priority,
        paused: conv.paused,
        archived: conv.archived,
        autoApprove: conv.autoApprove === false ? false : undefined,
        ...(conv.agentModel ?? conv.qaiqModel
            ? { agentModel: conv.agentModel ?? conv.qaiqModel }
            : {}),
        ...(conv.interactionModeId ? { interactionModeId: conv.interactionModeId } : {}),
        ...(conv.approvalPolicyId ? { approvalPolicyId: conv.approvalPolicyId } : {}),
        forkedFromId: conv.forkedFromId,
        parallelRunId: conv.parallelRunId,
        parallelBaseCwd: conv.parallelBaseCwd,
        worktreeBranch: conv.worktreeBranch,
        linkedPullRequest: conv.linkedPullRequest,
        ...metrics,
        hasGitOperation,
        ...(conv.contextUsage ? { contextUsage: conv.contextUsage } : {}),
        ...(conv.contextWindowSize ? { contextWindowSize: conv.contextWindowSize } : {}),
        ...(conv.contextUsageEstimated ? { contextUsageEstimated: true } : {}),
        ...(conv.contextUsageEstimated
            ? { estimatedContextTokens: estimateConversationTokensFromMessages(conv.messages, conv.contextPreamble) }
            : {}),
        ...(conv.contextCompaction ? { contextCompaction: conv.contextCompaction } : {}),
    };
}

export interface QaapAgentConversationGroupDTO {
    readonly cwd: string;
    readonly projectName: string;
    readonly streamingCount: number;
    readonly conversations: QaapAgentConversationSummaryDTO[];
}

export interface QaapCreateConversationBody {
    readonly cwd: string;
    /**
     * Client-generated idempotency key for this submit. The server returns the already-created
     * conversation if a request with the same key already succeeded, so a retry after a slow/timed-out
     * create does not spawn a duplicate conversation + task. Reused across retries of the same submit.
     */
    readonly clientRequestId?: string;
    readonly agent?: string;
    readonly title?: string;
    readonly message?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    /** When `false`, tool calls need manual CLI approval on the VPS. */
    readonly autoApprove?: boolean;
    /** Resolved cross-project context, stored on the conversation and prepended to each agent turn. */
    readonly contextPreamble?: string;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: import('./qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
    readonly latencyMarks?: Partial<Record<QaapTurnLatencyMark, number>>;
    /**
     * When `true`, the server provisions an isolated git worktree (new branch off HEAD of
     * {@link cwd}) and the conversation runs there instead of the main working tree.
     */
    readonly worktree?: boolean;
}

export async function listConversationsForCwd(cwd: string): Promise<QaapAgentConversationSummaryDTO[]> {
    const url = `${QAAP_AGENT_CONVERSATION_API_PATH}?cwd=${encodeURIComponent(cwd)}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    const body = await response.json() as { conversations?: QaapAgentConversationSummaryDTO[] };
    return body.conversations ?? [];
}

export async function listAllConversationGroups(): Promise<QaapAgentConversationGroupDTO[]> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/all`, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    const body = await response.json() as { groups?: QaapAgentConversationGroupDTO[] };
    return body.groups ?? [];
}

export async function getConversation(id: string): Promise<QaapAgentConversationDTO> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export async function restoreConversationCheckpoint(id: string, checkpointId: string): Promise<QaapAgentConversationDTO> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
        { method: 'POST', credentials: 'include' },
    );
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export async function rewindConversationToMessage(id: string, messageId: string): Promise<QaapAgentConversationDTO> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/rewind`,
        { method: 'POST', credentials: 'include' },
    );
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export async function createConversation(
    body: QaapCreateConversationBody,
    signal?: AbortSignal,
): Promise<QaapAgentConversationDTO> {
    const response = await fetch(QAAP_AGENT_CONVERSATION_API_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export interface QaapPostConversationMessageOptions {
    readonly agent?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    readonly autoApprove?: boolean;
    /** ID of the optimistic user row that this request confirms. */
    readonly clientMessageId?: string;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: import('./qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
    readonly latencyMarks?: Partial<Record<QaapTurnLatencyMark, number>>;
    /**
     * How to deliver this message if the conversation already has an agent running.
     * Default: `'queue'` (enqueue and process when the agent finishes).
     * See {@link QaapMessageDeliveryMode}.
     */
    readonly deliveryMode?: QaapMessageDeliveryMode;
}

export async function postConversationMessage(
    id: string,
    content: string,
    options: QaapPostConversationMessageOptions = {},
): Promise<QaapAgentConversationDTO> {
    const agent = options.agent;
    const agentModel = options.agentModel;
    const autoApprove = options.autoApprove;
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content,
            agent,
            agentModel,
            qaiqModel: agentModel,
            clientMessageId: options.clientMessageId,
            interactionModeId: options.interactionModeId,
            approvalPolicyId: options.approvalPolicyId,
            toolApprovalRules: options.toolApprovalRules,
            latencyMarks: options.latencyMarks,
            deliveryMode: options.deliveryMode ?? QAAP_DEFAULT_DELIVERY_MODE,
            ...(autoApprove === false ? { autoApprove: false } : autoApprove === true ? { autoApprove: true } : {}),
        }),
    });
    if (!response.ok) {
        throw await buildPostMessageError(response);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

/**
 * Cancel (remove) a queued user message from the conversation's pending queue.
 * The message is discarded and will not be processed.
 */
export async function cancelQueuedConversationMessage(
    id: string,
    queuedMessageId: string,
): Promise<QaapAgentConversationDTO> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/queued-messages/${encodeURIComponent(queuedMessageId)}`,
        { method: 'DELETE', credentials: 'include' },
    );
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

/**
 * Dispatch a queued user message immediately instead of waiting for the agent to finish.
 * The message is removed from the queue and re-posted with the specified delivery mode.
 */
export async function dispatchQueuedConversationMessage(
    id: string,
    queuedMessageId: string,
    deliveryMode: QaapMessageDeliveryMode = 'parallel',
): Promise<QaapAgentConversationDTO> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/queued-messages/${encodeURIComponent(queuedMessageId)}/dispatch`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deliveryMode }),
        },
    );
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

/**
 * Wire code answered with 429 when a conversation already runs the maximum number of concurrent
 * agents (see `QaapMaxConcurrentRunsError` in the cloud-workspace store). The composer treats it
 * as "queue this message", not as a failed send, so the two ends share this literal by contract.
 */
export const QAAP_MAX_CONCURRENT_RUNS_CODE = 'max-concurrent-runs';

/** Error carrying the HTTP status/code so callers can branch on the max-concurrent-runs answer. */
export class QaapConversationMessageError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {
        super(message);
    }
}

async function buildPostMessageError(response: Response): Promise<Error> {
    const text = await response.text();
    let message = text || response.statusText;
    let code: string | undefined;
    try {
        const body = JSON.parse(text) as { error?: string; code?: string };
        message = body.error || message;
        code = body.code;
    } catch {
        // Non-JSON error body — keep the raw text.
    }
    return new QaapConversationMessageError(message, response.status, code);
}

/** True when the send failed only because the session already runs the maximum agents. */
export function isMaxConcurrentRunsError(error: unknown): boolean {
    return error instanceof QaapConversationMessageError
        && (error.code === QAAP_MAX_CONCURRENT_RUNS_CODE || error.status === 429);
}

export async function renameConversation(id: string, title: string): Promise<QaapAgentConversationDTO> {
    return updateConversation(id, { title });
}

export interface QaapUpdateConversationBody {
    readonly title?: string;
    readonly priority?: boolean;
    readonly paused?: boolean;
    readonly archived?: boolean;
    readonly autoApprove?: boolean;
    readonly linkedPullRequest?: QaapLinkedPullRequest | null;
    /** Composer agent picker — persisted on the conversation thread. */
    readonly agent?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: import('./qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
}

/** True when YOLO / auto-approve is enabled for a VPS agent conversation. */
export function isConversationAutoApproveEnabled(summary: { readonly autoApprove?: boolean }): boolean {
    return summary.autoApprove !== false;
}

export async function updateConversation(id: string, patch: QaapUpdateConversationBody): Promise<QaapAgentConversationDTO> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export async function forkConversation(id: string): Promise<QaapAgentConversationDTO> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/fork`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export async function cancelConversationHttp(id: string): Promise<void> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
}

/** Cancels via WebSocket when the live feed is connected; falls back to HTTP POST /cancel. */
export async function cancelConversation(id: string): Promise<void> {
    if (conversationLiveCancel) {
        await conversationLiveCancel(id);
        return;
    }
    await cancelConversationHttp(id);
}

/**
 * Stops ONE run of a multitasking session (the turn started by `userMessageId`), leaving its
 * peers working. Always HTTP: the WebSocket cancel channel is session-wide by construction.
 */
export async function cancelConversationRun(id: string, userMessageId: string): Promise<void> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessageId }),
    });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
}

/**
 * The user turn whose run produced `agentMessageId` — the id a per-run stop is addressed to,
 * and the message the provenance badge reads its agent/model off.
 *
 * Prefers the explicit {@link QaapAgentMessageDTO.runUserMessageId} link the backend seals onto
 * the agent message when the run starts. The positional walk-back is only a fallback for turns
 * recorded before that field existed: an agent message is appended when its run first produces
 * output, so two runs sharing a session leave `[userA, userB, agentA, agentB]` and the walk-back
 * pairs `agentA` with `userB` — the wrong turn.
 */
export function resolveRunUserMessageId(
    messages: readonly QaapAgentMessageDTO[],
    agentMessageId: string | undefined,
): string | undefined {
    if (!agentMessageId) {
        return undefined;
    }
    const index = messages.findIndex(message => message.id === agentMessageId);
    if (index < 0) {
        return undefined;
    }
    const sealed = messages[index].runUserMessageId;
    if (sealed && messages.some(message => message.id === sealed && message.role === 'user')) {
        return sealed;
    }
    for (let i = index - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === 'user') {
            return message.id;
        }
    }
    return undefined;
}

export async function retryConversation(id: string): Promise<QaapAgentConversationDTO> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}/retry`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapAgentConversationDTO>;
}

export async function deleteConversation(id: string): Promise<void> {
    const response = await fetch(`${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(response.statusText);
    }
}

/** Keep / merge / discard an isolated Parallel worktree fork. */
export type QaapWorktreeApplyAction = 'keep-branch' | 'merge' | 'none';

export interface QaapApplyConversationWorktreeResultDTO {
    readonly ok: boolean;
    readonly branch?: string;
    readonly error?: string;
}

export async function applyConversationWorktree(
    conversationId: string,
    action: QaapWorktreeApplyAction,
): Promise<QaapApplyConversationWorktreeResultDTO> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/worktree/apply`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
        },
    );
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return response.json() as Promise<QaapApplyConversationWorktreeResultDTO>;
}

/** Push one AG-UI protocol event into a streaming conversation (traceEvents + wire deltas). */
export async function postAgUiTranscriptEvent(
    conversationId: string,
    event: Readonly<Record<string, unknown>>,
): Promise<void> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/ag-ui/events`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event }),
        },
    );
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
}

/** Mark a conversation failed when Qaap bootstrap could not start dev preview after the agent turn. */
export async function reportPreviewBootstrapFailure(
    conversationId: string,
    reason: string,
): Promise<QaapAgentConversationDTO | undefined> {
    const trimmed = reason.trim();
    if (!trimmed) {
        return undefined;
    }
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/preview-bootstrap-failure`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: trimmed }),
        },
    );
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return await response.json() as QaapAgentConversationDTO;
}

/** Upload a PNG captured from the same-origin preview and attach it to the latest agent response. */
export async function reportPreviewVisualVerification(
    conversationId: string,
    png: Blob,
    result: QaapPreviewVisualValidationResult,
    targetAgentMessageId?: string,
    previewUrl?: string,
): Promise<QaapAgentConversationDTO | undefined> {
    const normalizedPreviewUrl = normalizeQaapVisualPreviewUrl(previewUrl);
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/visual-verifications`,
        {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'image/png',
                'X-Qaap-Visual-Result': encodeURIComponent(JSON.stringify(result)),
                ...(targetAgentMessageId ? { 'X-Qaap-Visual-Target': targetAgentMessageId } : {}),
                ...(normalizedPreviewUrl ? { 'X-Qaap-Visual-Preview': normalizedPreviewUrl } : {}),
            },
            body: png,
        },
    );
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return await response.json() as QaapAgentConversationDTO;
}

/** Uploads one walked-step screenshot; returns its evidence id for the flow finalize. */
export async function uploadVisualEvidenceImage(
    conversationId: string,
    png: Blob,
): Promise<string | undefined> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/visual-evidence-images`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'image/png' },
            body: png,
        },
    );
    if (!response.ok) {
        return undefined;
    }
    const body = await response.json() as { evidenceId?: string };
    return typeof body.evidenceId === 'string' ? body.evidenceId : undefined;
}

/** One captured step of the walked flow, referencing an uploaded evidence image. */
export interface QaapVisualFlowStepReport {
    readonly label: string;
    readonly evidenceId: string;
    readonly result: QaapPreviewVisualValidationResult;
}

/** Attaches the walked flow (all uploaded step images) to the settled agent reply. */
export async function finalizeVisualFlowVerification(
    conversationId: string,
    steps: readonly QaapVisualFlowStepReport[],
    targetAgentMessageId: string,
    previewUrl?: string,
): Promise<QaapAgentConversationDTO | undefined> {
    const normalizedPreviewUrl = normalizeQaapVisualPreviewUrl(previewUrl);
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/visual-verifications`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                steps,
                targetMessageId: targetAgentMessageId,
                ...(normalizedPreviewUrl ? { previewUrl: normalizedPreviewUrl } : {}),
            }),
        },
    );
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return await response.json() as QaapAgentConversationDTO;
}

/** Settles the turn's evidence slot with a visible "screenshot unavailable" note. */
export async function reportPreviewVisualVerificationFailure(
    conversationId: string,
    reason: string,
    targetAgentMessageId: string,
): Promise<QaapAgentConversationDTO | undefined> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/visual-verification-failures`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, targetMessageId: targetAgentMessageId }),
        },
    );
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return await response.json() as QaapAgentConversationDTO;
}

/** Records a user-initiated git workflow in the transcript without starting a new agent turn. */
export async function recordConversationGitAction(
    conversationId: string,
    metadata: ComposerGitActionDisplayMetadata,
    options: {
        readonly messageId?: string;
        readonly replaceMessageId?: string;
    } = {},
): Promise<QaapAgentConversationDTO | undefined> {
    const response = await fetch(
        `${QAAP_AGENT_CONVERSATION_API_PATH}/${encodeURIComponent(conversationId)}/git-actions`,
        {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...metadata, ...options }),
        },
    );
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error((await response.text()) || response.statusText);
    }
    return await response.json() as QaapAgentConversationDTO;
}
