// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import {
    isTranscriptTodoTool,
    parseTranscriptTodoChecklist,
    type QaapTranscriptTodoItem,
} from './qaap-agent-transcript-segments';
import { resolveAgentMessageSegments } from './qaap-transcript-trace-model';

/** 1-based step progress for the sticky composer "Step X/Y" pill. */
export interface QaapTodoStepProgress {
    readonly current: number;
    readonly total: number;
    readonly items: readonly QaapTranscriptTodoItem[];
}

/**
 * Resolve the step counter from a TodoWrite checklist:
 * - `current` = 1-based index of the first `in_progress` item
 * - else completed+1 (next pending)
 * - else `total` when every item is completed
 */
export function resolveTodoStepProgress(
    items: readonly QaapTranscriptTodoItem[],
): QaapTodoStepProgress | undefined {
    if (!items.length) {
        return undefined;
    }
    const total = items.length;
    const inProgressIndex = items.findIndex(item => item.status === 'in_progress');
    if (inProgressIndex >= 0) {
        return { current: inProgressIndex + 1, total, items };
    }
    const completed = items.reduce((count, item) => count + (item.status === 'completed' ? 1 : 0), 0);
    if (completed >= total) {
        return { current: total, total, items };
    }
    return { current: Math.min(completed + 1, total), total, items };
}

/** Latest parseable TodoWrite checklist from a segment list (streaming args allowed). */
export function resolveLatestTranscriptTodosFromSegments(
    segments: readonly QaapAgentMessageSegmentDTO[],
): QaapTranscriptTodoItem[] | undefined {
    let latest: QaapTranscriptTodoItem[] | undefined;
    for (const segment of segments) {
        if (segment.type !== 'tool' || !isTranscriptTodoTool(segment.name) || !segment.args) {
            continue;
        }
        const items = parseTranscriptTodoChecklist(segment.args);
        if (items) {
            latest = items;
        }
    }
    return latest;
}

/** Latest parseable TodoWrite checklist across conversation messages (agent turns in order). */
export function resolveLatestTranscriptTodosFromMessages(
    messages: readonly QaapAgentMessageDTO[],
): QaapTranscriptTodoItem[] | undefined {
    let latest: QaapTranscriptTodoItem[] | undefined;
    for (const message of messages) {
        if (message.role !== 'agent') {
            continue;
        }
        const fromMessage = resolveLatestTranscriptTodosFromSegments(resolveAgentMessageSegments(message));
        if (fromMessage) {
            latest = fromMessage;
        }
    }
    return latest;
}

/**
 * Convenience entry: accept either conversation messages or a single turn's segments.
 * Empty arrays return undefined.
 */
export function resolveLatestTranscriptTodos(
    source: readonly QaapAgentMessageDTO[] | readonly QaapAgentMessageSegmentDTO[],
): QaapTranscriptTodoItem[] | undefined {
    if (!source.length) {
        return undefined;
    }
    const first = source[0];
    if (isAgentMessage(first)) {
        return resolveLatestTranscriptTodosFromMessages(source as readonly QaapAgentMessageDTO[]);
    }
    return resolveLatestTranscriptTodosFromSegments(source as readonly QaapAgentMessageSegmentDTO[]);
}

function isAgentMessage(value: unknown): value is QaapAgentMessageDTO {
    return typeof value === 'object'
        && value !== null
        && 'role' in value
        && ((value as { role?: unknown }).role === 'user' || (value as { role?: unknown }).role === 'agent');
}
