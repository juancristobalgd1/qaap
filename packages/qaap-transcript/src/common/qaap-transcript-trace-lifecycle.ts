// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapConversationCheckpointDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { QaapTranscriptTraceEventDTO } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { backfillAgentMessageTraceEvents } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-backfill';

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
 * Timeline note carrying a finished task's closing report (verification, independent review,
 * blocked signal and diff, already rendered as text by the backend). Unlike
 * {@link appendTracePreviewFailureEvent} it does NOT set {@code message.error}: the turn itself
 * was delivered, so the transcript must not render it as a failed run.
 */
export function appendTraceClosingReportEvent(
    message: QaapAgentMessageDTO,
    report: string,
    options: { readonly at?: number } = {},
): QaapAgentMessageDTO {
    const at = options.at ?? Date.now();
    const event: QaapTranscriptTraceEventDTO = {
        type: 'error',
        id: `closing-report-${at}`,
        message: report,
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
