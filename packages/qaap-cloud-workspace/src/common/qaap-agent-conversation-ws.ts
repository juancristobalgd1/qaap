// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_AGENT_CONVERSATION_API_PATH } from './qaap-agent-conversation';

/** WebSocket upgrade path for the live conversation feed. */
export const QAAP_AGENT_CONVERSATION_WS_PATH = `${QAAP_AGENT_CONVERSATION_API_PATH}/ws`;

/** Client → server control frames. */
export type QaapAgentConversationWsClientMessage =
    | { readonly op: 'cancel'; readonly conversationId: string }
    | { readonly op: 'ping' }
    /** Protocol v2 (`?v=2`): first frame; resume from `{epoch, lastSeq}` and declare the focused threads. */
    | { readonly op: 'hello'; readonly epoch?: string; readonly lastSeq?: number; readonly focus: readonly string[] }
    /** Protocol v2: start receiving `message` / `message_delta` for a thread, replaying from `sinceSeq` when known. */
    | { readonly op: 'focus'; readonly id: string; readonly sinceSeq?: number; readonly epoch?: string }
    | { readonly op: 'unfocus'; readonly id: string };

/** Query parameter value selecting live protocol v2 on the WebSocket (and SSE) path. */
export const QAAP_AGENT_CONVERSATION_LIVE_PROTOCOL_V2 = '2';

/** Server → client v2 frame types that are not plain conversation events. */
export type QaapAgentConversationWsV2ControlFrame =
    | { readonly type: 'resync'; readonly epoch: string; readonly seq: number; readonly groups: readonly unknown[] }
    | { readonly type: 'resumed'; readonly epoch: string; readonly seq: number }
    | { readonly type: 'thread_resync'; readonly id: string; readonly seq: number }
    | { readonly type: 'heartbeat'; readonly seq: number }
    | { readonly type: 'pong'; readonly seq: number };

function parseSeq(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function parseQaapAgentConversationWsClientMessage(
    raw: unknown,
): QaapAgentConversationWsClientMessage | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const message = raw as { op?: unknown; conversationId?: unknown; epoch?: unknown; lastSeq?: unknown; focus?: unknown; id?: unknown; sinceSeq?: unknown };
    if (message.op === 'ping') {
        return { op: 'ping' };
    }
    if (message.op === 'cancel' && typeof message.conversationId === 'string' && message.conversationId.trim()) {
        return { op: 'cancel', conversationId: message.conversationId.trim() };
    }
    if (message.op === 'hello') {
        const focus = Array.isArray(message.focus)
            ? message.focus.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())
            : [];
        return {
            op: 'hello',
            epoch: typeof message.epoch === 'string' ? message.epoch : undefined,
            lastSeq: parseSeq(message.lastSeq),
            focus,
        };
    }
    if ((message.op === 'focus' || message.op === 'unfocus') && typeof message.id === 'string' && message.id.trim()) {
        const id = message.id.trim();
        if (message.op === 'unfocus') {
            return { op: 'unfocus', id };
        }
        return {
            op: 'focus',
            id,
            sinceSeq: parseSeq(message.sinceSeq),
            epoch: typeof message.epoch === 'string' ? message.epoch : undefined,
        };
    }
    return undefined;
}
