// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Miscellaneous pure utility helpers extracted from QaapAgentConversationStore.
// These functions operate only on their parameters and do not access instance state.

import type {
    QaapAgentConversation,
    QaapAgentMessage,
} from '../common/qaap-agent-conversation';
import { mergeSegmentTraceEvents } from '@theia/qaap-mobile-shell/lib/common/qaap-transcript-trace-model';
import { filterAgentProcessLogChunk } from '../common/qaap-agent-log-filter';
import { deriveConversationTitle } from '../common/qaap-conversation-title';
import { QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT } from '../common/qaap-chat-turn-workflow';
import type { QaapPersistedWorkflowRun } from './qaap-workflow-run-store';

export function resolveStructuredParsedTraceEvents(
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

export function resolveLoopBudgetKey(conv: QaapAgentConversation, userMessageId: string): string {
    const userMessage = conv.messages.find(message => message.id === userMessageId && message.role === 'user');
    return userMessage?.autoContinueRootMessageId ?? userMessageId;
}

/** Persisted count so a backend restart cannot reset the per-chain auto-continue ceiling. */
export function countAutoContinueAttempts(conv: QaapAgentConversation, rootUserMessageId: string): number {
    return conv.messages.filter(message =>
        message.role === 'user'
        && message.autoContinueRootMessageId === rootUserMessageId
        && message.visualRepairAttempt === undefined
    ).length;
}

export function resolveAgentIdForAgentMessage(conv: QaapAgentConversation, agentMessage: QaapAgentMessage): string {
    const runUserMessage = agentMessage.runUserMessageId
        ? conv.messages.find(message => message.id === agentMessage.runUserMessageId && message.role === 'user')
        : undefined;
    return runUserMessage?.turnAgentId ?? conv.agentId;
}

export function contextCompactionMessageText(message: QaapAgentMessage): string {
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

export function contextPreambleWithCompaction(contextPreamble: string | undefined, summary: string): string {
    const parts = [contextPreamble?.trim(), `Earlier conversation context has been compacted:\n${summary.trim()}`]
        .filter((part): part is string => !!part);
    return parts.join('\n\n');
}

/** Drop repetitive QAIQ/OpenClaude metadata noise from chat transcripts (still kept in task logs). */
export function filterAgentLogChunk(chunk: string): string {
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
export function deriveTitle(seed: string): string {
    return deriveConversationTitle(seed);
}

export function isTurnGraphEnabled(): boolean {
    return /^(1|true|on)$/i.test(process.env.QAAP_TURN_GRAPH?.trim() ?? '');
}

export function readTriedFallbackModels(record: QaapPersistedWorkflowRun | undefined): readonly string[] {
    const raw = record?.artifacts[QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT];
    if (!raw) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
        return [];
    }
}
