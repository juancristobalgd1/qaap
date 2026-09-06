// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { buildConversationListMetrics } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-conversation-list-metrics';
import { resolveMessagePreviewText } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-content';
import {
    agentMessageHasVisualVerificationMarker,
    conversationLikelyNeedsVisualVerification,
} from '@theia/qaap-mobile-shell/lib/common/qaap-visual-verification';
import {
    DEFAULT_QAAP_CONTEXT_WINDOW,
    estimateConversationContextBreakdown,
    type QaapAgentContextUsage,
} from '@theia/qaap-mobile-shell/lib/common/qaap-agent-context-usage';
import type { QaapLinkedPullRequest } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapAgentMessageWireDelta } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-message-wire-delta';
import type { QaapCreateAgentTaskQaiqModel } from './qaap-agent-task';
import type { QaapTurnLatencyMark } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-stream-metrics';
import type { QaapParallelRunVariantStats } from './qaap-parallel-run';

/** HTTP base path for the persistent agent-conversation endpoints. */
export const QAAP_AGENT_CONVERSATION_API_PATH = '/qaap/api/agent-conversations';

// ─── Delivery modes ──────────────────────────────────────────────────────────

/**
 * How a user message is delivered when the conversation already has an agent running.
 *
 * Inspired by the patterns used by Cursor ("Send after current message" / "Stop & send" /
 * Multitask), Claude Code (`pendingMessages` drained at tool-round boundaries), and Codex
 * (`delivery: "queued"` vs `steer`). See `PLAN_MULTITASK_DELIVERY_MODES.md` for the full
 * design rationale.
 *
 * - `'queue'` (default): the message is enqueued in `pendingUserMessages` and processed
 *   when the running agent finishes its turn. Multiple queued messages may be batched into
 *   a single agent turn (optimization B).
 * - `'parallel'`: spawn a **new conversation** in an isolated git worktree (never a
 *   second agent on the same tree). No write conflicts; the original turn keeps going.
 * - `'interrupt'`: the running agent is cancelled and the new message is processed
 *   immediately. Equivalent to Cursor "Stop & send" / Codex "Steer".
 */
export type QaapMessageDeliveryMode = 'queue' | 'parallel' | 'interrupt';

/** Default delivery mode when the client does not specify one. */
export const QAAP_DEFAULT_DELIVERY_MODE: QaapMessageDeliveryMode = 'queue';

/**
 * A user message enqueued while an agent was already running. Drained when the agent
 * finishes its turn (mode `'queue'`). Multiple pending messages may be batched into a
 * single agent turn.
 */
export interface QaapPendingUserMessage {
    readonly id: string;
    readonly content: string;
    readonly createdAt: number;
    readonly turnAgentId?: string;
    readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel;
    readonly clientMessageId?: string;
}

/** Optional auto-approve scopes under the {@code approve-for-me} preset. File edits are always included. */
export interface QaapAgentToolApprovalRules {
    readonly shell?: boolean;
    readonly network?: boolean;
}

export type QaapAgentConversationStatus =
    /** No turn is in flight; ready to accept the next user message. */
    | 'idle'
    /** A user message is being processed by the agent. */
    | 'streaming'
    /** The agent turn is visually settled (tools done, answer shown) but the backend VPS task is still attached. */
    | 'settled'
    /** Last agent turn failed (the conversation can still accept a follow-up message). */
    | 'failed';

export type QaapAgentMessageRole = 'user' | 'agent';

/** Structured blocks parsed from QAIQ {@code stream-json} output (thinking, tools, text). */
export type QaapAgentMessageSegment =
    | { readonly type: 'text'; readonly content: string }
    | { readonly type: 'thinking'; readonly content: string }
    | {
        readonly type: 'tool';
        readonly toolUseId: string;
        readonly name: string;
        readonly args: string;
        readonly finished: boolean;
        readonly result?: string;
        readonly parentToolUseId?: string;
    };

export interface QaapAgentMessage {
    readonly id: string;
    readonly role: QaapAgentMessageRole;
    readonly content: string;
    /** Correlates this persisted user row with the client-only optimistic row it confirms. */
    readonly clientMessageId?: string;
    /** Structured execution trace for AG-UI style providers. */
    readonly traceEvents?: import('@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-model').QaapTranscriptTraceEventDTO[];
    /** Present for agent turns driven by QAIQ stream-json. */
    readonly segments?: QaapAgentMessageSegment[];
    /** Epoch milliseconds. */
    readonly createdAt: number;
    /** When set on a user message, points at the agent-task spawned for that turn. */
    readonly taskId?: string;
    /**
     * Set on the user message that triggered a turn: which agent (`'qaiq'`, `'claude'`, `'codex'`, …)
     * actually drove it. Unlike {@link QaapAgentConversation.agentId} — which is per-conversation and
     * gets overwritten by every subsequent turn — this is per-message, so historical turns can still
     * be attributed correctly after the conversation's active agent has since changed.
     */
    readonly turnAgentId?: string;
    /**
     * Set alongside {@link turnAgentId}: the model (provider + vendor + modelId) that drove this
     * turn, including after a mid-turn fallback-model retry picked a different one than the
     * conversation's current default.
     */
    readonly turnAgentModel?: QaapCreateAgentTaskQaiqModel;
    /** Original user turn that owns this backend-generated auto-continuation chain. */
    readonly autoContinueRootMessageId?: string;
    /**
     * Human-authored root turn whose visual result this backend-generated repair belongs to.
     * Persisted separately from {@link autoContinueRootMessageId} so the visual loop keeps its own
     * strict attempt budget while still sharing the global re-spawn ceiling with every other loop.
     */
    readonly visualRepairRootMessageId?: string;
    /** 1-based visual repair attempt. Backend-generated user messages only. */
    readonly visualRepairAttempt?: number;
    /** Agent evidence message whose failed render caused this repair turn. */
    readonly visualRepairSourceAgentMessageId?: string;
    /**
     * How many times this turn has been auto-resumed after a backend restart (OOM/redeploy). Held
     * on the root user message and persisted so the ceiling survives further restarts: a turn whose
     * own work is what saturated memory cannot loop restart→resume→OOM forever. See
     * {@code maybeAutoResumeInterruptedTurn}.
     */
    readonly restartResumeCount?: number;
    /**
     * Set on an agent message: the user message whose run produced it. An agent message is
     * created lazily on its run's first output and appended at the end of the array, so with
     * several runs sharing one session the array order alone (`[userA, userB, agentA, agentB]`)
     * no longer identifies the driving turn — walking back to the nearest user message pairs
     * `agentA` with `userB`. Anything that must address a specific run (the per-run stop, the
     * provenance badge) reads this instead; see {@code resolveRunUserMessageId}.
     */
    readonly runUserMessageId?: string;
    /** When the user message's task ended unsuccessfully — short reason for the UI. */
    readonly error?: string;
    /**
     * Set on an agent message while ITS run is still streaming. With several agents sharing one
     * session the conversation status cannot say which turns are live, so the per-run stop (and
     * anything else that must address one run) keys off this instead.
     */
    readonly runActive?: boolean;
    /** Immutable end time for this agent turn, independent of later conversation updates. */
    readonly runFinishedAt?: number;
    /**
     * When this user message was produced by batching multiple queued messages into a single
     * agent turn (delivery mode `'queue'` + optimization B), this holds the IDs of the original
     * pending messages that were merged. Enables the UI to show "3 messages combined" and
     * preserves traceability.
     */
    readonly batchedFromMessageIds?: ReadonlyArray<string>;
}

export interface QaapContextCompaction {
    readonly status: 'running' | 'complete';
    readonly summary?: string;
    readonly startedAt: number;
    readonly completedAt?: number;
    readonly compactedMessageCount: number;
    readonly sourceMessageCount: number;
}

/** A working-tree snapshot anchored to a conversation turn (Timeline / rollback). */
export interface QaapConversationCheckpoint {
    readonly id: string;
    /** The user message id whose turn produced this snapshot. */
    readonly messageId: string;
    readonly label: string;
    /** Git commit object that captures the full working tree at capture time. */
    readonly commit: string;
    /** Ref keeping {@link commit} alive against GC (`refs/qaap/checkpoints/...`). */
    readonly ref: string;
    readonly capturedAt: number;
    readonly added?: number;
    readonly removed?: number;
}

/** A persistent multi-turn thread with an agent, tied to a working directory. */
export interface QaapAgentConversation {
    readonly id: string;
    /** Absolute working directory the agent is invoked in. */
    readonly cwd: string;
    /** Agent id (e.g. `'claude'`, `'codex'`, `'shell'`). */
    readonly agentId: string;
    /** Explicit model for this thread (user picker), not the global Settings alias. */
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    /** Best-effort title, derived from the first user message. */
    readonly title: string;
    readonly status: QaapAgentConversationStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly messages: QaapAgentMessage[];
    /** User-flagged "high priority" — surfaces at the top of project lists. */
    readonly priority?: boolean;
    /** User-flagged "paused" — sinks to the bottom; active turn is cancelled when paused. */
    readonly paused?: boolean;
    /** User-flagged "archived" — hidden from the main task list, accessible via filter. */
    readonly archived?: boolean;
    /**
     * When `false`, agent turns require manual CLI approval (will hang unattended).
     * Omitted/`true` enables YOLO / auto-approve for background runs.
     */
    readonly autoApprove?: boolean;
    /** Resolved cross-project context (frontend PromptService), prepended to each agent turn's prompt. */
    readonly contextPreamble?: string;
    /** Last composer interaction mode (`agent`, `plan`, `ask`) — drives QAIQ CLI flags. */
    readonly interactionModeId?: string;
    /** Last composer approval preset — drives QAIQ permission mode when auto-approve is on. */
    readonly approvalPolicyId?: string;
    /** Optional scopes under {@code approve-for-me} (shell / network). Edits are always included. */
    readonly toolApprovalRules?: QaapAgentToolApprovalRules;
    /** Set on conversations created via {@link fork} — points at the parent's id. */
    readonly forkedFromId?: string;
    /** Set on variant conversations of a parallel run — groups them in the Chats inbox. */
    readonly parallelRunId?: string;
    /** Base repository root a parallel-run variant was derived from (its own cwd is a worktree). */
    readonly parallelBaseCwd?: string;
    /** Branch of the dedicated git worktree this conversation runs in (composer "New Worktree"). */
    readonly worktreeBranch?: string;
    /** Working-tree snapshots captured per turn — the Timeline / rollback feature. */
    readonly checkpoints?: QaapConversationCheckpoint[];
    /**
     * Ground-truth git diff stats computed via `git diff --numstat` at turn completion.
     * These take priority over the text-parsed estimates in {@link buildConversationListMetrics}.
     */
    readonly gitDiffAdded?: number;
    readonly gitDiffRemoved?: number;
    /** When set, this thread is tied to a GitHub pull request (Work Hub inbox). */
    readonly linkedPullRequest?: QaapLinkedPullRequest;
    /** Latest context snapshot when the agent CLI reports stream-json usage. */
    readonly contextUsage?: QaapAgentContextUsage;
    /** Denominator for the context meter (defaults to {@link DEFAULT_QAAP_CONTEXT_WINDOW}). */
    readonly contextWindowSize?: number;
    /** When true, {@link contextUsage} is absent and the UI may show a transcript-based estimate. */
    readonly contextUsageEstimated?: boolean;
    /** Internal long-context summary used for future turns and rendered as a transcript system marker. */
    readonly contextCompaction?: QaapContextCompaction;
    /** Login of the user who owns this conversation — used for multi-tenant isolation. */
    readonly ownerLogin?: string;
    /**
     * User messages enqueued while an agent was running (delivery mode `'queue'`). Drained
     * when the running agent finishes its turn. Multiple pending messages may be batched into
     * a single agent turn to save tokens. See {@link QaapPendingUserMessage}.
     */
    readonly pendingUserMessages?: ReadonlyArray<QaapPendingUserMessage>;
}

/** Summary row used by list endpoints — omits messages to keep payloads small. */
export interface QaapAgentConversationSummary {
    readonly id: string;
    readonly cwd: string;
    readonly agentId: string;
    readonly title: string;
    readonly status: QaapAgentConversationStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly messageCount: number;
    /** Excerpt of the most recent message — handy for list-view previews. */
    readonly lastMessagePreview?: string;
    /** Role of the most recent message, so the UI can render "you said…" vs. "agent replied…". */
    readonly lastMessageRole?: QaapAgentMessageRole;
    readonly priority?: boolean;
    readonly paused?: boolean;
    /** User-flagged "archived" — hidden from the main task list. */
    readonly archived?: boolean;
    /** Present and `false` when the user disabled YOLO for this thread. */
    readonly autoApprove?: boolean;
    /** Last explicit model picked in the composer for this thread. */
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    /** Last composer interaction mode (`agent`, `plan`, `ask`). */
    readonly interactionModeId?: string;
    /** Last composer approval preset id. */
    readonly approvalPolicyId?: string;
    readonly forkedFromId?: string;
    /** Set on variant conversations of a parallel run — groups them in the Chats inbox. */
    readonly parallelRunId?: string;
    /** Base repository root a parallel-run variant was derived from. */
    readonly parallelBaseCwd?: string;
    /** Branch of the dedicated git worktree this conversation runs in (composer "New Worktree"). */
    readonly worktreeBranch?: string;
    /** In-flight tool/status label while {@link status} is `'streaming'`. */
    readonly activityLabel?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    /** Epoch ms when the current turn started (last user message). */
    readonly turnStartedAt?: number;
    readonly turnProgressCurrent?: number;
    readonly turnProgressTotal?: number;
    /** Duration of the last completed agent turn. */
    readonly lastTurnDurationMs?: number;
    readonly linkedPullRequest?: QaapLinkedPullRequest;
    /** Set when the thread ran `git` or is tied to a PR — used by the Work Hub inbox filter. */
    readonly hasGitOperation?: boolean;
    readonly contextUsage?: QaapAgentContextUsage;
    readonly contextWindowSize?: number;
    readonly contextUsageEstimated?: boolean;
    /** Cached estimate for list rows when {@link contextUsageEstimated} is set. */
    readonly estimatedContextTokens?: number;
    readonly contextCompaction?: QaapContextCompaction;
    /**
     * Server-authoritative signal that the last settled turn still needs visual evidence.
     * Lets a frontend that never witnessed the streaming→idle transition (reload, backgrounded
     * mobile tab, dropped SSE) still run the capture. Cleared once evidence or a capture-failure
     * note carrying the marker lands on the last agent message.
     */
    readonly visualVerificationPending?: boolean;
    /** Number of user messages queued for the next agent turn (delivery mode `'queue'`). */
    readonly pendingUserMessageCount?: number;
}

/** Conversations bucketed by project working directory. */
export interface QaapAgentConversationCwdGroup {
    readonly cwd: string;
    readonly projectName: string;
    readonly streamingCount: number;
    readonly conversations: QaapAgentConversationSummary[];
}

export interface QaapAgentConversationListResponse {
    readonly conversations: QaapAgentConversationSummary[];
}

export interface QaapAgentConversationAllResponse {
    readonly groups: QaapAgentConversationCwdGroup[];
}

export interface QaapCreateAgentConversationRequest {
    readonly cwd: string;
    readonly agent?: string;
    readonly title?: string;
    /** Optional first user message; when present, the agent turn fires right after creation. */
    readonly message?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    /** Marks this conversation as a parallel-run variant (grouped under {@link parallelBaseCwd}). */
    readonly parallelRunId?: string;
    readonly parallelBaseCwd?: string;
    /**
     * When `true`, the server creates an isolated git worktree (new branch off HEAD of {@link cwd})
     * and the conversation runs there instead of the repository's main working tree.
     */
    readonly worktree?: boolean;
    /**
     * Set when this conversation was spawned as an isolated parallel follow-up of another
     * thread (delivery mode `'parallel'`). Points at the parent conversation id.
     */
    readonly forkedFromId?: string;
    /** Set by the server on worktree conversations — the branch backing the worktree. */
    readonly worktreeBranch?: string;
    /** When `false`, tool calls need manual CLI approval on the VPS. */
    readonly autoApprove?: boolean;
    /** Resolved cross-project context (frontend PromptService), stored on the conversation. */
    readonly contextPreamble?: string;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: QaapAgentToolApprovalRules;
    /** Optional submit diagnostics forwarded by the browser for end-to-end latency logs. */
    readonly latencyMarks?: Partial<Record<QaapTurnLatencyMark, number>>;
}

export interface QaapPostAgentMessageRequest {
    readonly content: string;
    /** ID of the optimistic user row that this request confirms. */
    readonly clientMessageId?: string;
    /** When set, overrides the conversation's stored agent for this turn (and updates it). */
    readonly agent?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    /**
     * When set, applies the composer approval policy for this turn (`true` → YOLO / auto-approve CLI flags).
     */
    readonly autoApprove?: boolean;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: QaapAgentToolApprovalRules;
    /** Optional submit diagnostics forwarded by the browser for end-to-end latency logs. */
    readonly latencyMarks?: Partial<Record<QaapTurnLatencyMark, number>>;
    /**
     * How to deliver this message if the conversation already has an agent running.
     * Default: `'queue'` (enqueue and process when the agent finishes).
     * See {@link QaapMessageDeliveryMode}.
     */
    readonly deliveryMode?: QaapMessageDeliveryMode;
}

export interface QaapRenameAgentConversationRequest {
    readonly title: string;
}

/** PATCH body — any subset of these mutable flags can be updated in one call. */
export interface QaapUpdateAgentConversationRequest {
    readonly title?: string;
    readonly priority?: boolean;
    readonly paused?: boolean;
    /** `true` archives the conversation (hides it from the main list). */
    readonly archived?: boolean;
    /** `true` clears an explicit opt-out; `false` requires manual tool approval on future turns. */
    readonly autoApprove?: boolean;
    readonly linkedPullRequest?: QaapLinkedPullRequest | null;
    /** Composer agent picker — overrides the thread default for future turns. */
    readonly agent?: string;
    readonly agentModel?: QaapCreateAgentTaskQaiqModel;
    /** @deprecated Use {@link agentModel}. */
    readonly qaiqModel?: QaapCreateAgentTaskQaiqModel;
    readonly interactionModeId?: string;
    readonly approvalPolicyId?: string;
    readonly toolApprovalRules?: QaapAgentToolApprovalRules;
}

export interface QaapLinkConversationsByBranchRequest {
    readonly owner: string;
    readonly repo: string;
    readonly number: number;
    readonly branch: string;
    readonly title?: string;
}

/** POST body for `/agent-conversations/:id/ag-ui/events`. */
export interface QaapPostAgUiTranscriptEventRequest {
    readonly event: Readonly<Record<string, unknown>>;
}

/**
 * What to do with an isolated Parallel worktree (`forkedFromId` + `worktreeBranch`,
 * no `parallelRunId`) when the user chooses Keep / Merge / Discard.
 * Mirrors {@link import('./qaap-parallel-run').QaapParallelChooseAction}.
 */
export type QaapWorktreeApplyAction = 'keep-branch' | 'merge' | 'none';

/** POST body for `/agent-conversations/:id/worktree/apply`. */
export interface QaapApplyConversationWorktreeRequest {
    readonly action: QaapWorktreeApplyAction;
}

export interface QaapApplyConversationWorktreeResponse {
    readonly ok: boolean;
    /** Branch kept or merged when {@link ok} is true. */
    readonly branch?: string;
    /** Populated when a `merge` action could not complete cleanly (aborted, tree untouched). */
    readonly error?: string;
}

/** POST body for `/agent-conversations/:id/preview-bootstrap-failure`. */
export interface QaapPostPreviewBootstrapFailureRequest {
    readonly reason?: string;
}

/** Payload pushed over SSE when a conversation changes. */
export type QaapAgentConversationEvent =
    | { readonly type: 'created'; readonly conversation: QaapAgentConversationSummary }
    | { readonly type: 'updated'; readonly conversation: QaapAgentConversationSummary }
    | { readonly type: 'message'; readonly conversationId: string; readonly cwd: string; readonly message: QaapAgentMessage }
    | {
        readonly type: 'message_delta';
        readonly conversationId: string;
        readonly cwd: string;
        readonly messageId: string;
        readonly delta: QaapAgentMessageWireDelta;
    }
    | { readonly type: 'deleted'; readonly conversationId: string; readonly cwd: string }
    | { readonly type: 'parallel-run'; readonly runId: string; readonly cwd: string; readonly variants: readonly QaapParallelRunVariantStats[] }
    | { readonly type: 'pending-queued'; readonly conversationId: string; readonly cwd: string; readonly message: QaapPendingUserMessage }
    | { readonly type: 'pending-drained'; readonly conversationId: string; readonly cwd: string; readonly drainedCount: number };

/** Status exposed to list rows — keeps `failed` when a user turn still carries an error. */
export function resolveEffectiveConversationStatus(conv: QaapAgentConversation): QaapAgentConversationStatus {
    if (conv.status === 'streaming') {
        return 'streaming';
    }
    if (conv.status === 'failed' || conv.messages.some(message => !!message.error)) {
        return 'failed';
    }
    return conv.status;
}

/**
 * Server-side twin of the autopilot trigger: the turn is settled (raw status — a historical
 * message error keeps the *effective* status `failed` forever and must not veto evidence),
 * the last reply carries no evidence marker yet, and the agent invoked the capture (or the
 * turn mechanically edited renderable files). No natural-language guessing here.
 */
export function conversationNeedsVisualVerificationEvidence(conv: QaapAgentConversation): boolean {
    if (conv.status !== 'idle') {
        return false;
    }
    const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
    if (!lastAgent || lastAgent.error || agentMessageHasVisualVerificationMarker(lastAgent)) {
        return false;
    }
    return conversationLikelyNeedsVisualVerification(conv);
}

export function toConversationSummary(conv: QaapAgentConversation): QaapAgentConversationSummary {
    const last = conv.messages[conv.messages.length - 1];
    const status = resolveEffectiveConversationStatus(conv);
    const base: QaapAgentConversationSummary = {
        id: conv.id,
        cwd: conv.cwd,
        agentId: conv.agentId,
        title: conv.title,
        status,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
        lastMessagePreview: last ? excerpt(resolveMessagePreviewText(last)) : undefined,
        lastMessageRole: last?.role,
        priority: conv.priority || undefined,
        paused: conv.paused || undefined,
        archived: conv.archived || undefined,
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
        contextCompaction: conv.contextCompaction,
        pendingUserMessageCount: conv.pendingUserMessages?.length || undefined,
    };
    const metrics = buildConversationListMetrics({ status, messages: conv.messages });
    const hasGitOperation = metrics.hasGitOperation || conv.linkedPullRequest
        ? true
        : undefined;
    return {
        ...base,
        ...metrics,
        hasGitOperation,
        ...(conv.gitDiffAdded !== undefined ? { linesAdded: conv.gitDiffAdded } : {}),
        ...(conv.gitDiffRemoved !== undefined ? { linesRemoved: conv.gitDiffRemoved } : {}),
        ...(conv.contextUsage ? { contextUsage: conv.contextUsage } : {}),
        ...(conv.contextWindowSize ? { contextWindowSize: conv.contextWindowSize } : {}),
        ...(conv.contextUsageEstimated ? { contextUsageEstimated: true } : {}),
        ...(conv.contextUsageEstimated
            ? {
                estimatedContextTokens: estimateConversationContextBreakdown(
                    conv.messages,
                    conv.contextPreamble,
                    conv.contextCompaction,
                ).totalTokens,
            }
            : {}),
        ...(conversationNeedsVisualVerificationEvidence(conv) ? { visualVerificationPending: true } : {}),
    };
}

export { DEFAULT_QAAP_CONTEXT_WINDOW };
export type { QaapAgentContextUsage };

function excerpt(text: string): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}
