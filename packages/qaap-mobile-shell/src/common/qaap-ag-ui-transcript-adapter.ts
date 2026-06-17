// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import {
    computeAgentMessageWireDelta,
    type QaapAgentMessageWireDelta,
    type QaapAgentMessageWireSnapshot,
} from './qaap-agent-message-wire-delta';
import { applyQaapJsonPatch, type QaapJsonPatchOperation } from './qaap-ag-ui-json-patch';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';

/** activityType for Cursor-style execution traces in AG-UI ActivitySnapshot/Delta. */
export const QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE = 'qaap-agent-trace';

export interface QaapAgUiRunContext {
    readonly threadId?: string;
    readonly runId?: string;
    readonly parentRunId?: string;
}

/** Loose AG-UI event envelope (camelCase or SCREAMING_SNAKE). */
export type QaapAgUiEvent = Readonly<Record<string, unknown>> & {
    readonly type: string;
};

export interface QaapAgUiTraceReducerState {
    readonly agentMessageId: string;
    readonly run: QaapAgUiRunContext;
    readonly traceEvents: readonly QaapTranscriptTraceEventDTO[];
    readonly activities: Readonly<Record<string, { readonly activityType: string; readonly content: unknown }>>;
    readonly toolArgsById: Readonly<Record<string, string>>;
}

export interface QaapAgUiAgentTraceActivityContent {
    readonly events?: readonly QaapTranscriptTraceEventDTO[];
}

export function createQaapAgUiTraceReducer(
    agentMessageId: string,
    run: QaapAgUiRunContext = {},
): QaapAgUiTraceReducerState {
    return {
        agentMessageId,
        run,
        traceEvents: [],
        activities: {},
        toolArgsById: {},
    };
}

export function toQaapAgUiWireSnapshot(
    reducer: QaapAgUiTraceReducerState,
    createdAt: number,
): QaapAgentMessageWireSnapshot {
    return {
        id: reducer.agentMessageId,
        role: 'agent',
        content: '',
        createdAt,
        traceEvents: [...reducer.traceEvents],
    };
}

export function buildAgentMessageFromQaapAgUiReducer(
    reducer: QaapAgUiTraceReducerState,
    createdAt: number,
): QaapAgentMessageDTO {
    return {
        id: reducer.agentMessageId,
        role: 'agent',
        content: '',
        createdAt,
        traceEvents: [...reducer.traceEvents],
    };
}

/** Map one AG-UI event into trace state and the smallest wire delta vs the previous snapshot. */
export function reduceQaapAgUiTranscriptEvent(
    previous: QaapAgUiTraceReducerState | undefined,
    event: QaapAgUiEvent,
    options: {
        readonly agentMessageId: string;
        readonly createdAt: number;
        readonly agentId: string;
    },
): { readonly next: QaapAgUiTraceReducerState; readonly delta: QaapAgentMessageWireDelta } {
    const base = previous ?? createQaapAgUiTraceReducer(options.agentMessageId);
    const next = applyQaapAgUiEventToReducer(base, event);
    const prevSnapshot = previous ? toQaapAgUiWireSnapshot(previous, options.createdAt) : undefined;
    const nextSnapshot = toQaapAgUiWireSnapshot(next, options.createdAt);
    const delta = computeAgentMessageWireDelta(prevSnapshot, nextSnapshot, options.agentId);
    return { next, delta };
}

export function applyQaapAgUiEventToReducer(
    state: QaapAgUiTraceReducerState,
    event: QaapAgUiEvent,
): QaapAgUiTraceReducerState {
    const type = normalizeQaapAgUiEventType(event.type);
    switch (type) {
        case 'RUN_STARTED':
            return {
                ...state,
                run: {
                    threadId: readString(event, 'threadId', 'thread_id') ?? state.run.threadId,
                    runId: readString(event, 'runId', 'run_id') ?? state.run.runId,
                    parentRunId: readString(event, 'parentRunId', 'parent_run_id') ?? state.run.parentRunId,
                },
            };
        case 'TOOL_CALL_START':
            return appendTraceToolCall(state, {
                type: 'tool_call',
                id: readString(event, 'toolCallId', 'tool_call_id') ?? readString(event, 'messageId', 'message_id') ?? `tool-${state.traceEvents.length}`,
                name: readString(event, 'toolCallName', 'tool_call_name', 'name') ?? 'tool',
                args: '',
                status: 'running',
            });
        case 'TOOL_CALL_ARGS': {
            const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
            const delta = readString(event, 'delta', 'args');
            if (!toolCallId || delta === undefined) {
                return state;
            }
            const mergedArgs = `${state.toolArgsById[toolCallId] ?? ''}${delta}`;
            return patchTraceToolCall(state, toolCallId, { args: mergedArgs, argsAppend: delta });
        }
        case 'TOOL_CALL_RESULT': {
            const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
            const result = readString(event, 'result', 'content');
            if (!toolCallId) {
                return state;
            }
            return patchTraceToolCall(state, toolCallId, {
                result,
                status: 'completed',
            });
        }
        case 'TOOL_CALL_END': {
            const toolCallId = readString(event, 'toolCallId', 'tool_call_id');
            if (!toolCallId) {
                return state;
            }
            return patchTraceToolCall(state, toolCallId, { status: 'completed' });
        }
        case 'TEXT_MESSAGE_START':
            return appendTraceAssistantText(state, {
                type: 'assistant_text',
                id: readString(event, 'messageId', 'message_id') ?? `text-${state.traceEvents.length}`,
                content: '',
                status: 'streaming',
            });
        case 'TEXT_MESSAGE_CONTENT': {
            const messageId = readString(event, 'messageId', 'message_id');
            const delta = readString(event, 'delta', 'content');
            if (!messageId || delta === undefined) {
                return state;
            }
            return patchTraceAssistantText(state, messageId, { contentAppend: delta });
        }
        case 'TEXT_MESSAGE_END': {
            const messageId = readString(event, 'messageId', 'message_id');
            if (!messageId) {
                return state;
            }
            return patchTraceAssistantText(state, messageId, { status: 'completed' });
        }
        case 'REASONING_MESSAGE_START':
        case 'REASONING_START':
            return appendTraceThought(state, {
                type: 'thought',
                id: readString(event, 'messageId', 'message_id') ?? `thought-${state.traceEvents.length}`,
                content: '',
                status: 'running',
            });
        case 'REASONING_MESSAGE_CONTENT':
        case 'REASONING_MESSAGE_CHUNK': {
            const messageId = readString(event, 'messageId', 'message_id');
            const delta = readString(event, 'delta', 'content');
            if (!messageId || delta === undefined) {
                return state;
            }
            return patchTraceThought(state, messageId, { contentAppend: delta });
        }
        case 'REASONING_MESSAGE_END':
        case 'REASONING_END': {
            const messageId = readString(event, 'messageId', 'message_id');
            if (!messageId) {
                return state;
            }
            return patchTraceThought(state, messageId, { status: 'completed' });
        }
        case 'ACTIVITY_SNAPSHOT':
            return applyActivitySnapshot(state, event);
        case 'ACTIVITY_DELTA':
            return applyActivityDelta(state, event);
        case 'RUN_ERROR':
            return appendTraceError(state, readString(event, 'message', 'error') ?? 'Agent run failed');
        default:
            return state;
    }
}

export function normalizeQaapAgUiEventType(type: string): string {
    if (type.includes('_')) {
        return type.toUpperCase();
    }
    return type.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function readString(event: QaapAgUiEvent, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = event[key];
        if (typeof value === 'string') {
            return value;
        }
    }
    return undefined;
}

function readPatch(event: QaapAgUiEvent): readonly QaapJsonPatchOperation[] {
    const patch = event.patch ?? event.delta;
    if (!Array.isArray(patch)) {
        return [];
    }
    return patch.filter((entry): entry is QaapJsonPatchOperation => (
        !!entry
        && typeof entry === 'object'
        && (entry.op === 'add' || entry.op === 'replace' || entry.op === 'remove')
        && typeof entry.path === 'string'
    ));
}

function appendTraceToolCall(
    state: QaapAgUiTraceReducerState,
    event: Extract<QaapTranscriptTraceEventDTO, { type: 'tool_call' }>,
): QaapAgUiTraceReducerState {
    return {
        ...state,
        traceEvents: [...state.traceEvents, event],
        toolArgsById: { ...state.toolArgsById, [event.id]: event.args },
    };
}

function patchTraceToolCall(
    state: QaapAgUiTraceReducerState,
    toolCallId: string,
    patch: {
        readonly args?: string;
        readonly argsAppend?: string;
        readonly result?: string;
        readonly status?: Extract<QaapTranscriptTraceEventDTO, { type: 'tool_call' }>['status'];
    },
): QaapAgUiTraceReducerState {
    const toolArgsById = patch.args !== undefined
        ? { ...state.toolArgsById, [toolCallId]: patch.args }
        : patch.argsAppend !== undefined
            ? { ...state.toolArgsById, [toolCallId]: `${state.toolArgsById[toolCallId] ?? ''}${patch.argsAppend}` }
            : state.toolArgsById;
    const traceEvents = state.traceEvents.map(event => {
        if (event.type !== 'tool_call' || event.id !== toolCallId) {
            return event;
        }
        return {
            ...event,
            ...(patch.args !== undefined ? { args: patch.args } : {}),
            ...(patch.argsAppend !== undefined ? { args: `${event.args ?? ''}${patch.argsAppend}` } : {}),
            ...(patch.result !== undefined ? { result: patch.result } : {}),
            ...(patch.status ? { status: patch.status } : {}),
        };
    });
    return { ...state, traceEvents, toolArgsById };
}

function appendTraceAssistantText(
    state: QaapAgUiTraceReducerState,
    event: Extract<QaapTranscriptTraceEventDTO, { type: 'assistant_text' }>,
): QaapAgUiTraceReducerState {
    return { ...state, traceEvents: [...state.traceEvents, event] };
}

function patchTraceAssistantText(
    state: QaapAgUiTraceReducerState,
    messageId: string,
    patch: { readonly contentAppend?: string; readonly status?: 'streaming' | 'completed' },
): QaapAgUiTraceReducerState {
    const traceEvents = state.traceEvents.map(event => {
        if (event.type !== 'assistant_text' || event.id !== messageId) {
            return event;
        }
        return {
            ...event,
            ...(patch.contentAppend !== undefined
                ? { content: `${event.content ?? ''}${patch.contentAppend}` }
                : {}),
            ...(patch.status ? { status: patch.status } : {}),
        };
    });
    return { ...state, traceEvents };
}

function appendTraceThought(
    state: QaapAgUiTraceReducerState,
    event: Extract<QaapTranscriptTraceEventDTO, { type: 'thought' }>,
): QaapAgUiTraceReducerState {
    return { ...state, traceEvents: [...state.traceEvents, event] };
}

function patchTraceThought(
    state: QaapAgUiTraceReducerState,
    messageId: string,
    patch: { readonly contentAppend?: string; readonly status?: 'running' | 'completed' },
): QaapAgUiTraceReducerState {
    const traceEvents = state.traceEvents.map(event => {
        if (event.type !== 'thought' || event.id !== messageId) {
            return event;
        }
        return {
            ...event,
            ...(patch.contentAppend !== undefined
                ? { content: `${event.content ?? ''}${patch.contentAppend}` }
                : {}),
            ...(patch.status ? { status: patch.status } : {}),
        };
    });
    return { ...state, traceEvents };
}

function appendTraceError(state: QaapAgUiTraceReducerState, message: string): QaapAgUiTraceReducerState {
    const id = `error-${state.traceEvents.length}`;
    return {
        ...state,
        traceEvents: [...state.traceEvents, { type: 'error', id, message }],
    };
}

function applyActivitySnapshot(
    state: QaapAgUiTraceReducerState,
    event: QaapAgUiEvent,
): QaapAgUiTraceReducerState {
    const messageId = readString(event, 'messageId', 'message_id');
    const activityType = readString(event, 'activityType', 'activity_type');
    const content = event.content;
    if (!messageId || !activityType || content === undefined) {
        return state;
    }
    const activities = {
        ...state.activities,
        [messageId]: { activityType, content },
    };
    if (activityType !== QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE) {
        return { ...state, activities };
    }
    const events = parseAgentTraceActivityEvents(content);
    return events ? { ...state, activities, traceEvents: events } : { ...state, activities };
}

function applyActivityDelta(
    state: QaapAgUiTraceReducerState,
    event: QaapAgUiEvent,
): QaapAgUiTraceReducerState {
    const messageId = readString(event, 'messageId', 'message_id');
    const activityType = readString(event, 'activityType', 'activity_type');
    const patch = readPatch(event);
    if (!messageId || !activityType || patch.length === 0) {
        return state;
    }
    const existing = state.activities[messageId];
    const baseContent = existing?.content ?? (activityType === QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE ? { events: state.traceEvents } : {});
    const nextContent = applyQaapJsonPatch(baseContent, patch);
    const activities = {
        ...state.activities,
        [messageId]: { activityType, content: nextContent },
    };
    if (activityType !== QAAP_AG_UI_AGENT_TRACE_ACTIVITY_TYPE) {
        return { ...state, activities };
    }
    const events = parseAgentTraceActivityEvents(nextContent);
    return events ? { ...state, activities, traceEvents: events } : { ...state, activities };
}

function parseAgentTraceActivityEvents(content: unknown): QaapTranscriptTraceEventDTO[] | undefined {
    if (!content || typeof content !== 'object') {
        return undefined;
    }
    const events = (content as QaapAgUiAgentTraceActivityContent).events;
    if (!Array.isArray(events)) {
        return undefined;
    }
    return events.filter(isQaapTranscriptTraceEvent);
}

function isQaapTranscriptTraceEvent(value: unknown): value is QaapTranscriptTraceEventDTO {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const type = (value as { type?: unknown }).type;
    return type === 'thought'
        || type === 'tool_call'
        || type === 'assistant_text'
        || type === 'error';
}
