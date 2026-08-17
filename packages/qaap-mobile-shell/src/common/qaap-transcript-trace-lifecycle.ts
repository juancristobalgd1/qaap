// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import type { QaapConversationCheckpointDTO } from './qaap-agent-conversation-client';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';
import { backfillAgentMessageTraceEvents } from './qaap-transcript-trace-backfill';

export function appendTraceRunCancelledEvent(
    message: QaapAgentMessageDTO,
    options: { readonly id?: string; readonly reason?: string; readonly at?: number } = {},
): QaapAgentMessageDTO {
    const at = options.at ?? Date.now();
    const cancelledTools = (message.traceEvents ?? []).map(event => {
        if (event.type !== 'tool_call') {
            return event;
        }
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
            return event;
        }
        return { ...event, status: 'cancelled' as const, finishedAt: at };
    });
    const runCancelled: QaapTranscriptTraceEventDTO = {
        type: 'run_cancelled',
        id: options.id ?? `run-cancelled-${at}`,
        message: options.reason ?? 'Turn cancelled.',
        startedAt: at,
    };
    const alreadyRecorded = cancelledTools.some(event => event.type === 'run_cancelled');
    return {
        ...message,
        traceEvents: alreadyRecorded ? cancelledTools : [...cancelledTools, runCancelled],
    };
}

export function appendTracePreviewFailureEvent(
    message: QaapAgentMessageDTO,
    reason: string,
    options: { readonly at?: number } = {},
): QaapAgentMessageDTO {
    const at = options.at ?? Date.now();
    const event: QaapTranscriptTraceEventDTO = {
        type: 'error',
        id: `preview-failure-${at}`,
        message: reason,
        startedAt: at,
    };
    return {
        ...message,
        error: reason,
        traceEvents: [...(message.traceEvents ?? []), event],
    };
}

/**
 * Timeline note for a turn that finished but whose backend self-verification stayed red.
 * Unlike {@link appendTracePreviewFailureEvent} it does NOT set {@code message.error}: the
 * turn itself succeeded, so the transcript must not render it as a failed run.
 */
export function appendTraceVerificationWarningEvent(
    message: QaapAgentMessageDTO,
    reason: string,
    options: { readonly at?: number } = {},
): QaapAgentMessageDTO {
    const at = options.at ?? Date.now();
    const event: QaapTranscriptTraceEventDTO = {
        type: 'error',
        id: `verification-warning-${at}`,
        message: reason,
        startedAt: at,
    };
    return {
        ...message,
        traceEvents: [...(message.traceEvents ?? []), event],
    };
}

/**
 * Timeline note for a turn whose agent declared itself blocked on user input (blocked-signal
 * sentinel). Like {@link appendTraceVerificationWarningEvent}, it must not set
 * {@code message.error} — the turn ended deliberately, not in failure.
 */
export function appendTraceBlockedEvent(
    message: QaapAgentMessageDTO,
    need: string,
    options: { readonly at?: number } = {},
): QaapAgentMessageDTO {
    const at = options.at ?? Date.now();
    const event: QaapTranscriptTraceEventDTO = {
        type: 'error',
        id: `blocked-${at}`,
        message: need,
        startedAt: at,
    };
    return {
        ...message,
        traceEvents: [...(message.traceEvents ?? []), event],
    };
}

/**
 * Timeline note from the independent adversarial review pass (rejected change or no verdict).
 * Must not set {@code message.error}: the turn itself was delivered.
 */
export function appendTraceReviewEvent(
    message: QaapAgentMessageDTO,
    note: string,
    options: { readonly at?: number } = {},
): QaapAgentMessageDTO {
    const at = options.at ?? Date.now();
    const event: QaapTranscriptTraceEventDTO = {
        type: 'error',
        id: `review-${at}`,
        message: note,
        startedAt: at,
    };
    return {
        ...message,
        traceEvents: [...(message.traceEvents ?? []), event],
    };
}

export function appendTraceCheckpointEvent(
    message: QaapAgentMessageDTO,
    checkpoint: QaapConversationCheckpointDTO,
): QaapAgentMessageDTO {
    const event: QaapTranscriptTraceEventDTO = {
        type: 'checkpoint',
        id: checkpoint.id,
        label: checkpoint.label,
        commit: checkpoint.commit,
        capturedAt: checkpoint.capturedAt,
        ...(checkpoint.added !== undefined ? { added: checkpoint.added } : {}),
        ...(checkpoint.removed !== undefined ? { removed: checkpoint.removed } : {}),
    };
    const existing = message.traceEvents ?? [];
    if (existing.some(entry => entry.type === 'checkpoint' && entry.id === checkpoint.id)) {
        return message;
    }
    return {
        ...message,
        traceEvents: [...existing, event],
    };
}

export function agentMessageHasStructuredTrace(message: QaapAgentMessageDTO | undefined): boolean {
    if (!message) {
        return false;
    }
    return (message.traceEvents?.length ?? 0) > 0;
}

/** Streaming placeholder used when an agent row exists but has no display text yet. */
export const PLACEHOLDER_AGENT_CONTENT = '…';

/** True when agent `content` is empty or the streaming placeholder — safe to replay the turn log. */
export function isPlaceholderAgentContent(content: string | undefined): boolean {
    const trimmed = content?.trim();
    return !trimmed || trimmed === PLACEHOLDER_AGENT_CONTENT;
}

/** Mark segment-derived trace rows as settled (completed) after a turn finishes or is interrupted. */
export function syncSettledTraceEventsOnMessage(message: QaapAgentMessageDTO): QaapAgentMessageDTO {
    return backfillAgentMessageTraceEvents(message).message;
}
