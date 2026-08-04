// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Constants, types, and error class for the agent conversation store.
// Extracted from qaap-agent-conversation-store.ts.

import * as os from 'os';
import * as path from 'path';

// ─── Store paths ─────────────────────────────────────────────────────────────

export const STORE_DIR = path.join(os.homedir(), '.qaap', 'agent-conversations');
export const STREAMING_PERSIST_DEBOUNCE_MS = 500;
export const INDEX_PATH = path.join(STORE_DIR, 'index.json');
export const VISUAL_EVIDENCE_DIR = path.join(STORE_DIR, 'visual-evidence');

/** Hard cap of stored PNGs per conversation — bounds disk use across multi-step flows and retries. */
export const VISUAL_EVIDENCE_MAX_FILES_PER_CONVERSATION = 40;

/** Recorded tours are short (seconds), but webm still dwarfs PNGs — cap them separately. */
export const VISUAL_EVIDENCE_MAX_VIDEO_BYTES = 25 * 1024 * 1024;

// ─── Concurrency ─────────────────────────────────────────────────────────────

/**
 * How many parallel-run variants may stream at once inside a single conversation when the user
 * explicitly chooses delivery mode `'parallel'`. They run in isolated git worktrees, so this is
 * a capacity target, not just a fan-out guard. Override with `QAAP_MAX_PARALLEL_VARIANTS`.
 */
export const QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION = (() => {
    const parsed = Number.parseInt(process.env.QAAP_MAX_PARALLEL_VARIANTS?.trim() ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 3;
})();

/**
 * Legacy cap kept for backward compatibility — still used as the hard limit for parallel-run
 * variants. Renamed from `MAX_CONCURRENT_CONVERSATION_RUNS` to clarify it applies to explicit
 * parallel variants, not to queued messages (which are unbounded).
 * @deprecated Use {@link QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION}.
 */
export const MAX_CONCURRENT_CONVERSATION_RUNS = QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION;

/** Wire code for {@link QaapMaxConcurrentRunsError} — the client falls back to queueing on it. */
export const QAAP_MAX_CONCURRENT_RUNS_CODE = 'max-concurrent-runs';

/**
 * Raised when a conversation already holds {@link QAAP_MAX_PARALLEL_VARIANTS_PER_CONVERSATION}
 * live parallel-run variants. Typed (not a bare Error) so the endpoint can answer 429 + code and
 * the composer can queue the message instead of surfacing it as a failed send.
 */
export class QaapMaxConcurrentRunsError extends Error {
    readonly code = QAAP_MAX_CONCURRENT_RUNS_CODE;
}

// ─── Queue / batching ─────────────────────────────────────────────────────────

/**
 * Maximum number of queued user messages to batch into a single agent turn when draining the
 * pending queue. Batching saves tokens (one LLM call instead of N) but too many messages in one
 * turn can overwhelm the context window. Override with `QAAP_MAX_BATCH_SIZE`.
 */
export const QAAP_MAX_BATCH_SIZE = (() => {
    const parsed = Number.parseInt(process.env.QAAP_MAX_BATCH_SIZE?.trim() ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 5;
})();

/**
 * Coalescing window in milliseconds: after an agent finishes its turn, wait this long before
 * draining the pending queue, in case more messages arrive. Override with
 * `QAAP_COALESCE_WINDOW_MS`.
 */
export const QAAP_COALESCE_WINDOW_MS = (() => {
    const parsed = Number.parseInt(process.env.QAAP_COALESCE_WINDOW_MS?.trim() ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2000;
})();

// ─── Watchdog ────────────────────────────────────────────────────────────────

/** How often the turn watchdog scans for conversations stuck 'streaming' past the max duration. */
export const TURN_WATCHDOG_SWEEP_MS = 60 * 1000;

// ─── Feature flags ───────────────────────────────────────────────────────────

/**
 * Strict mode. Set `QAAP_AGENT_AUTO_CONTINUE=0` (or `false`/`off`) to stop the backend from
 * auto-re-prompting the agent to "keep going" after a turn — the agent then does only what the
 * user asked and stops. Default on (preserves the auto-continue / scaffold-to-preview behavior).
 */
export const QAAP_AGENT_AUTO_CONTINUE_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AGENT_AUTO_CONTINUE?.trim() ?? '');

/**
 * Auto-resume a turn that a backend restart (OOM-kill / redeploy) interrupted, instead of only
 * marking it failed with a manual "Retry to continue". Default ON; set QAAP_AUTO_RESUME_TURNS to
 * 0/false/off to disable during an incident without a redeploy.
 */
export const QAAP_AUTO_RESUME_TURNS_ENABLED = !/^(0|false|off)$/i.test(process.env.QAAP_AUTO_RESUME_TURNS?.trim() ?? '');

/**
 * Max auto-resumes per human-authored turn across ALL restarts. 1 bounds the worst case (a turn
 * whose own work is what OOMs the container) to a single extra restart cycle before it degrades to
 * the manual retry. Override with QAAP_MAX_RESTART_RESUMES.
 */
export const MAX_RESTART_RESUMES = (() => {
    const parsed = Number.parseInt(process.env.QAAP_MAX_RESTART_RESUMES?.trim() ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
})();

/**
 * Hard ceiling on agent re-spawns triggered by ALL loops (auto-continue + model-fallback) for a
 * single user message. Each loop has its own smaller cap, but without a shared budget they multiply
 * (2 auto-continues × N fallback models), so one turn could fan out into many CLI invocations. 4
 * bounds the worst case while leaving room for a couple of continues plus one or two fallbacks.
 */
export const MAX_LOOP_SPAWNS_PER_USER_MESSAGE = 4;

/** A real render failure may re-enter the same agent twice before the conversation fails closed. */
export const MAX_VISUAL_REPAIR_ATTEMPTS = 2;

// ─── Internal types ──────────────────────────────────────────────────────────

export interface PostUserMessageInternalOptions {
    /** Keeps every backend-generated continuation charged to the original human turn. */
    readonly autoContinueRootMessageId?: string;
    /** Correlates a browser optimistic row with the persisted user message. */
    readonly clientMessageId?: string;
    /** Durable visual repair identity; all three fields are written before its task id is sealed. */
    readonly visualRepair?: {
        readonly rootUserMessageId: string;
        readonly attempt: number;
        readonly sourceAgentMessageId: string;
    };
    /**
     * IDs of original pending messages that were batched into this single user message when
     * draining the queue. Preserved on the persisted {@link QaapAgentMessage.batchedFromMessageIds}
     * for traceability.
     */
    readonly batchedFromMessageIds?: ReadonlyArray<string>;
}

/** Immutable routing/provenance for one task-backed turn inside a multi-run conversation. */
export interface QaapConversationTaskRef {
    readonly conversationId: string;
    readonly userMessageId: string;
    readonly turnAgentId: string;
    agentMessageId?: string;
    readonly startSha?: string;
}

// ─── Git helpers ─────────────────────────────────────────────────────────────

export function parseGitNumstat(output: string): { added: number; removed: number } {
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
