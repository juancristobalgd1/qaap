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
import { createAgUiCliStreamEmitter } from './qaap-cli-ag-ui-stream';
import { filterQaiqStreamProcessLogLines } from './qaap-qaiq-stream';
import { resolveAgentMessageDisplayContent } from './qaap-transcript-trace-model';
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
    const message: QaapAgentMessageDTO = {
        id: reducer.agentMessageId,
        role: 'agent',
        content: '',
        createdAt,
        traceEvents: [...reducer.traceEvents],
    };
    const content = resolveAgentMessageDisplayContent(message);
    return content ? { ...message, content } : message;
}

/** Replay a settled QAIQ/Claude NDJSON log through the AG-UI reducer (store backfill when live stream missed rows). */
export function buildAgentMessageFromAgUiStructuredLog(
    agentId: string,
    agentMessageId: string,
    createdAt: number,
    log: string,
): QaapAgentMessageDTO | undefined {
    const emitter = createAgUiCliStreamEmitter(agentId);
    if (!emitter || !log.trim()) {
        return undefined;
    }
    let state: QaapAgUiTraceReducerState | undefined;
    const filtered = filterQaiqStreamProcessLogLines(log);
    for (const line of filtered.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        for (const event of emitter.push(`${trimmed}\n`)) {
            ({ next: state } = reduceQaapAgUiTranscriptEvent(state, event, {
                agentMessageId,
                createdAt,
                agentId,
            }));
        }
    }
    if (!state || state.traceEvents.length === 0) {
        return undefined;
    }
    return buildAgentMessageFromQaapAgUiReducer(state, createdAt);
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
            if (!toolCallId || delta === undefined || delta.length === 0) {
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

function patchTraceEvents(
    events: readonly QaapTranscriptTraceEventDTO[],
    match: (event: QaapTranscriptTraceEventDTO) => boolean,
    patcher: (event: QaapTranscriptTraceEventDTO) => QaapTranscriptTraceEventDTO,
): readonly QaapTranscriptTraceEventDTO[] {
    let next: QaapTranscriptTraceEventDTO[] | undefined;
    for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (!match(event)) {
            if (next) {
                next.push(event);
            }
            continue;
        }
        const patched = patcher(event);
        if (patched === event) {
            if (next) {
                next.push(event);
            }
            continue;
        }
        if (!next) {
            next = events.slice(0, index);
        }
        next.push(patched);
    }
    return next ?? events;
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
    let toolArgsById = state.toolArgsById;
    if (patch.args !== undefined) {
        toolArgsById = { ...toolArgsById, [toolCallId]: patch.args };
    } else if (patch.argsAppend !== undefined) {
        toolArgsById = { ...toolArgsById, [toolCallId]: `${toolArgsById[toolCallId] ?? ''}${patch.argsAppend}` };
    }
    const traceEvents = patchTraceEvents(
        state.traceEvents,
        event => event.type === 'tool_call' && event.id === toolCallId,
        event => {
            if (event.type !== 'tool_call') {
                return event;
            }
            const nextArgs = patch.args !== undefined
                ? patch.args
                : patch.argsAppend !== undefined
                    ? `${event.args ?? ''}${patch.argsAppend}`
                    : event.args;
            const nextResult = patch.result !== undefined ? patch.result : event.result;
            const nextStatus = patch.status ?? event.status;
            if (nextArgs === event.args && nextResult === event.result && nextStatus === event.status) {
                return event;
            }
            return {
                ...event,
                ...(patch.args !== undefined || patch.argsAppend !== undefined ? { args: nextArgs } : {}),
                ...(patch.result !== undefined ? { result: nextResult } : {}),
                ...(patch.status ? { status: nextStatus } : {}),
            };
        },
    );
    if (traceEvents === state.traceEvents && toolArgsById === state.toolArgsById) {
        return state;
    }
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
    const traceEvents = patchTraceEvents(
        state.traceEvents,
        event => event.type === 'assistant_text' && event.id === messageId,
        event => {
            if (event.type !== 'assistant_text') {
                return event;
            }
            const nextContent = patch.contentAppend !== undefined
                ? `${event.content ?? ''}${patch.contentAppend}`
                : event.content;
            const nextStatus = patch.status ?? event.status;
            if (nextContent === event.content && nextStatus === event.status) {
                return event;
            }
            return {
                ...event,
                ...(patch.contentAppend !== undefined ? { content: nextContent } : {}),
                ...(patch.status ? { status: nextStatus } : {}),
            };
        },
    );
    return traceEvents === state.traceEvents ? state : { ...state, traceEvents };
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
    const traceEvents = patchTraceEvents(
        state.traceEvents,
        event => event.type === 'thought' && event.id === messageId,
        event => {
            if (event.type !== 'thought') {
                return event;
            }
            const nextContent = patch.contentAppend !== undefined
                ? `${event.content ?? ''}${patch.contentAppend}`
                : event.content;
            const nextStatus = patch.status ?? event.status;
            if (nextContent === event.content && nextStatus === event.status) {
                return event;
            }
            return {
                ...event,
                ...(patch.contentAppend !== undefined ? { content: nextContent } : {}),
                ...(patch.status ? { status: nextStatus } : {}),
            };
        },
    );
    return traceEvents === state.traceEvents ? state : { ...state, traceEvents };
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
        || type === 'error'
        || type === 'run_cancelled'
        || type === 'checkpoint';
}
