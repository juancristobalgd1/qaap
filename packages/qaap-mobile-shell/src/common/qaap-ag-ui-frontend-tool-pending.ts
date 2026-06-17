// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';

export interface QaapPendingFrontendToolCall {
    readonly toolCallId: string;
    readonly name: string;
    readonly args: string;
}

export function collectQaapFrontendToolNames(
    definitions: ReadonlyArray<{ readonly function: { readonly name: string } }>,
): ReadonlySet<string> {
    return new Set(definitions.map(definition => definition.function.name));
}

/** Agent tail rows with AG-UI / trace tool calls that must run in the browser. */
export function findPendingQaapFrontendToolCalls(
    message: QaapAgentMessageDTO,
    frontendToolNames: ReadonlySet<string>,
): readonly QaapPendingFrontendToolCall[] {
    if (message.role !== 'agent' || frontendToolNames.size === 0) {
        return [];
    }
    const pending: QaapPendingFrontendToolCall[] = [];
    for (const event of message.traceEvents ?? []) {
        if (event.type !== 'tool_call' || !frontendToolNames.has(event.name)) {
            continue;
        }
        if (event.status !== 'running' && event.status !== 'pending') {
            continue;
        }
        if (event.result !== undefined && event.result.length > 0) {
            continue;
        }
        const args = event.args ?? '';
        if (!isCompleteJsonObjectArgs(args)) {
            continue;
        }
        pending.push({ toolCallId: event.id, name: event.name, args });
    }
    for (const segment of message.segments ?? []) {
        if (segment.type !== 'tool' || !frontendToolNames.has(segment.name)) {
            continue;
        }
        if (segment.finished || (segment.result !== undefined && segment.result.length > 0)) {
            continue;
        }
        const args = segment.args ?? '';
        if (!isCompleteJsonObjectArgs(args)) {
            continue;
        }
        pending.push({ toolCallId: segment.toolUseId, name: segment.name, args });
    }
    return pending;
}

function isCompleteJsonObjectArgs(args: string): boolean {
    const trimmed = args.trim();
    if (!trimmed) {
        return true;
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    } catch {
        return false;
    }
}
