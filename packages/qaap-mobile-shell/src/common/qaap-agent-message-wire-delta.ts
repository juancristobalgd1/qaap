// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO, QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { usesStructuredAgentTranscript } from './qaap-agent-task-client';
import type { QaapAgentWireCompressionEncoding } from './qaap-agent-wire-encoding';
import {
    fingerprintQaapTraceEvent,
    fingerprintQaapTraceEvents,
    type QaapTranscriptTraceEventDTO,
} from './qaap-transcript-trace-model';

/** Incremental wire ops for live agent transcript streaming (shared server + browser). */
export type QaapAgentMessageWireDelta =
    | { readonly kind: 'noop' }
    | { readonly kind: 'message_start'; readonly message: QaapAgentMessageDTO }
    | { readonly kind: 'replace'; readonly message: QaapAgentMessageDTO }
    | {
        readonly kind: 'append_content';
        readonly messageId: string;
        readonly text: string;
        readonly textEncoding?: QaapAgentWireCompressionEncoding;
        /**
         * Length the producer assumed the target already held. Appends carry no sequence
         * number, so without this a dropped or reordered delta is concatenated onto a
         * shorter base and silently loses that chunk for the rest of the turn (visible as
         * text with fragments missing until the settle poll repairs it). Optional for wire
         * compatibility: when absent the append is applied unchecked, as before.
         */
        readonly baseLength?: number;
    }
    | {
        readonly kind: 'append_segment_text';
        readonly messageId: string;
        readonly segmentIndex: number;
        readonly text: string;
        readonly textEncoding?: QaapAgentWireCompressionEncoding;
        /** @see the `append_content` counterpart. */
        readonly baseLength?: number;
    }
    | {
        readonly kind: 'patch_tool';
        readonly messageId: string;
        readonly toolUseId: string;
        readonly argsAppend?: string;
        readonly argsAppendEncoding?: QaapAgentWireCompressionEncoding;
        readonly resultAppend?: string;
        readonly resultAppendEncoding?: QaapAgentWireCompressionEncoding;
        readonly finished?: boolean;
    }
    | {
        readonly kind: 'append_segment';
        readonly messageId: string;
        readonly segment: QaapAgentMessageSegmentDTO;
    }
    | {
        readonly kind: 'append_trace_event';
        readonly messageId: string;
        readonly event: QaapTranscriptTraceEventDTO;
    }
    | {
        readonly kind: 'patch_trace_event';
        readonly messageId: string;
        readonly eventId: string;
        readonly contentAppend?: string;
        readonly contentAppendEncoding?: QaapAgentWireCompressionEncoding;
        readonly argsAppend?: string;
        readonly argsAppendEncoding?: QaapAgentWireCompressionEncoding;
        readonly resultAppend?: string;
        readonly resultAppendEncoding?: QaapAgentWireCompressionEncoding;
        /**
         * Lengths the producer assumed each target field already held. This is the path that
         * carries structured-agent assistant text, so a lost delta here is what shows up as
         * streamed prose with fragments missing. @see the `append_content` counterpart.
         */
        readonly contentBaseLength?: number;
        readonly argsBaseLength?: number;
        readonly resultBaseLength?: number;
        readonly status?: QaapTranscriptTraceEventDTO extends infer Event
            ? Event extends { readonly status: infer Status } ? Status : never
            : never;
    };

export interface QaapAgentMessageWireSnapshot {
    readonly id: string;
    readonly role: 'user' | 'agent';
    readonly content: string;
    readonly traceEvents?: QaapTranscriptTraceEventDTO[];
    readonly segments?: QaapAgentMessageSegmentDTO[];
    readonly createdAt: number;
    /** @see QaapAgentMessageDTO.turnAgentId */
    readonly turnAgentId?: string;
    /** @see QaapAgentMessageDTO.turnAgentModel */
    readonly turnAgentModel?: QaapAgentMessageDTO['turnAgentModel'];
    /** @see QaapAgentMessageDTO.runUserMessageId */
    readonly runUserMessageId?: string;
    readonly runActive?: boolean;
    readonly runFinishedAt?: number;
}

function toWireMessage(message: QaapAgentMessageWireSnapshot): QaapAgentMessageDTO {
    return toAgentMessageWirePayload({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        traceEvents: message.traceEvents,
        segments: message.segments,
        turnAgentId: message.turnAgentId,
        turnAgentModel: message.turnAgentModel,
        runUserMessageId: message.runUserMessageId,
        runActive: message.runActive,
        runFinishedAt: message.runFinishedAt,
    });
}

/** Drop legacy segments from live wire payloads when structured traceEvents are present. */
export function toAgentMessageWirePayload(
    message: Pick<
        QaapAgentMessageDTO,
        'id' | 'role' | 'content' | 'createdAt' | 'traceEvents' | 'segments' | 'turnAgentId' | 'turnAgentModel' | 'runUserMessageId' | 'runActive' | 'runFinishedAt'
    >,
): QaapAgentMessageDTO {
    const base: QaapAgentMessageDTO = {
        ...(message.runActive !== undefined ? { runActive: message.runActive } : {}),
        ...(message.runFinishedAt !== undefined ? { runFinishedAt: message.runFinishedAt } : {}),
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...(message.turnAgentId ? { turnAgentId: message.turnAgentId } : {}),
        ...(message.turnAgentModel ? { turnAgentModel: message.turnAgentModel } : {}),
        ...(message.runUserMessageId ? { runUserMessageId: message.runUserMessageId } : {}),
    };
    if (message.traceEvents?.length) {
        return { ...base, traceEvents: [...message.traceEvents] };
    }
    if (message.segments?.length) {
        return { ...base, segments: [...message.segments] };
    }
    return base;
}

/** Snapshot for delta computation — traceEvents-only when structured trace is available. */
export function toAgentMessageWireSnapshot(
    message: Pick<
        QaapAgentMessageDTO,
        'id' | 'role' | 'content' | 'createdAt' | 'traceEvents' | 'segments' | 'turnAgentId' | 'turnAgentModel' | 'runUserMessageId' | 'runActive' | 'runFinishedAt'
    >,
): QaapAgentMessageWireSnapshot {
    const snapshot: QaapAgentMessageWireSnapshot = {
        ...(message.runActive !== undefined ? { runActive: message.runActive } : {}),
        ...(message.runFinishedAt !== undefined ? { runFinishedAt: message.runFinishedAt } : {}),
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        ...(message.turnAgentId ? { turnAgentId: message.turnAgentId } : {}),
        ...(message.turnAgentModel ? { turnAgentModel: message.turnAgentModel } : {}),
        ...(message.runUserMessageId ? { runUserMessageId: message.runUserMessageId } : {}),
    };
    if (message.traceEvents?.length) {
        return { ...snapshot, traceEvents: [...message.traceEvents] };
    }
    if (message.segments?.length) {
        return { ...snapshot, segments: [...message.segments] };
    }
    return snapshot;
}

/**
 * Turn provenance (which agent/model actually drove the turn) is sealed onto the USER message and
 * has no representation in any incremental delta kind — a change to it can only travel as a full
 * message. Fingerprinting it here is what keeps `computeAgentMessageWireDelta` from collapsing a
 * re-seal (fallback-model retry) into `noop`, which `fireAgentMessageWireUpdate` drops outright.
 */
function turnProvenanceFingerprint(
    message: Pick<QaapAgentMessageDTO, 'turnAgentId' | 'turnAgentModel' | 'runActive' | 'runFinishedAt'>,
): string {
    const model = message.turnAgentModel;
    return `${message.runActive ?? false}|${message.runFinishedAt ?? ''}|${message.turnAgentId ?? ''}|${model ? `${model.provider}:${model.vendor}:${model.modelId}` : ''}`;
}

function segmentFingerprint(segment: QaapAgentMessageSegmentDTO): string {
    if (segment.type === 'tool') {
        return `t:${segment.toolUseId}:${segment.finished ? '1' : '0'}:${segment.args?.length ?? 0}:${segment.result?.length ?? 0}:${segment.name}`;
    }
    return `${segment.type}:${segment.content ?? ''}`;
}

function segmentsEqual(
    left: QaapAgentMessageSegmentDTO,
    right: QaapAgentMessageSegmentDTO,
): boolean {
    return segmentFingerprint(left) === segmentFingerprint(right);
}

function traceEventsEqual(
    left: QaapTranscriptTraceEventDTO,
    right: QaapTranscriptTraceEventDTO,
): boolean {
    return fingerprintQaapTraceEvent(left) === fingerprintQaapTraceEvent(right);
}

type TraceEventPatch = Extract<QaapAgentMessageWireDelta, { kind: 'patch_trace_event' }>;

function computeTraceEventPatch(
    previous: QaapTranscriptTraceEventDTO,
    incoming: QaapTranscriptTraceEventDTO,
    messageId: string,
): TraceEventPatch | undefined {
    if (previous.type !== incoming.type || previous.id !== incoming.id) {
        return undefined;
    }
    if (previous.type === 'error' || incoming.type === 'error'
        || previous.type === 'run_cancelled' || incoming.type === 'run_cancelled'
        || previous.type === 'checkpoint' || incoming.type === 'checkpoint') {
        return undefined;
    }
    if (previous.type === 'tool_call' && incoming.type === 'tool_call') {
        if (previous.name !== incoming.name) {
            return undefined;
        }
        const previousArgs = previous.args ?? '';
        const incomingArgs = incoming.args ?? '';
        const previousResult = previous.result ?? '';
        const incomingResult = incoming.result ?? '';
        const argsAppend = incomingArgs.startsWith(previousArgs) && incomingArgs.length > previousArgs.length
            ? incomingArgs.slice(previousArgs.length)
            : undefined;
        const resultAppend = incomingResult.startsWith(previousResult) && incomingResult.length > previousResult.length
            ? incomingResult.slice(previousResult.length)
            : undefined;
        const status = previous.status !== incoming.status ? incoming.status : undefined;
        if (!argsAppend && !resultAppend && status === undefined) {
            return undefined;
        }
        return {
            kind: 'patch_trace_event',
            messageId,
            eventId: incoming.id,
            ...(argsAppend ? { argsAppend, argsBaseLength: previousArgs.length } : {}),
            ...(resultAppend ? { resultAppend, resultBaseLength: previousResult.length } : {}),
            ...(status ? { status } : {}),
        };
    }
    if ((previous.type === 'thought' || previous.type === 'assistant_text')
        && (incoming.type === 'thought' || incoming.type === 'assistant_text')) {
        const previousContent = previous.content ?? '';
        const incomingContent = incoming.content ?? '';
        const contentAppend = incomingContent.startsWith(previousContent) && incomingContent.length > previousContent.length
            ? incomingContent.slice(previousContent.length)
            : undefined;
        const status = previous.status !== incoming.status ? incoming.status : undefined;
        if (!contentAppend && status === undefined) {
            return undefined;
        }
        return {
            kind: 'patch_trace_event',
            messageId,
            eventId: incoming.id,
            ...(contentAppend ? { contentAppend, contentBaseLength: previousContent.length } : {}),
            ...(status ? { status } : {}),
        };
    }
    return undefined;
}

function computeTraceEventsWireDelta(
    previous: QaapAgentMessageWireSnapshot,
    next: QaapAgentMessageWireSnapshot,
): QaapAgentMessageWireDelta | undefined {
    const prevEvents = previous.traceEvents ?? [];
    const nextEvents = next.traceEvents ?? [];
    if (fingerprintQaapTraceEvents(prevEvents) === fingerprintQaapTraceEvents(nextEvents)) {
        return { kind: 'noop' };
    }
    if (prevEvents.length === 0 && nextEvents.length === 1) {
        return {
            kind: 'append_trace_event',
            messageId: next.id,
            event: nextEvents[0],
        };
    }
    if (nextEvents.length === prevEvents.length + 1) {
        for (let index = 0; index < prevEvents.length; index++) {
            if (!traceEventsEqual(prevEvents[index], nextEvents[index])) {
                return undefined;
            }
        }
        return {
            kind: 'append_trace_event',
            messageId: next.id,
            event: nextEvents[nextEvents.length - 1],
        };
    }
    if (prevEvents.length !== nextEvents.length) {
        return undefined;
    }

    let tracePatch: TraceEventPatch | undefined;
    for (let index = 0; index < prevEvents.length; index++) {
        const prev = prevEvents[index];
        const incoming = nextEvents[index];
        if (traceEventsEqual(prev, incoming)) {
            continue;
        }
        const candidate = computeTraceEventPatch(prev, incoming, next.id);
        if (!candidate) {
            return undefined;
        }
        if (tracePatch) {
            return undefined;
        }
        tracePatch = candidate;
    }
    return tracePatch;
}

/** Gap-checked append for one trace-event field; `''` when there is nothing left to add. */
function resolveTraceAppend(
    current: string | undefined,
    baseLength: number | undefined,
    append: string | undefined,
): string | undefined {
    if (append === undefined) {
        return '';
    }
    return resolveAppendSuffix((current ?? '').length, baseLength, append);
}

/** `undefined` signals a detected gap — the caller must resync instead of applying. */
function patchTraceEventInPlace(
    event: QaapTranscriptTraceEventDTO,
    delta: TraceEventPatch,
): QaapTranscriptTraceEventDTO | undefined {
    if (event.id !== delta.eventId) {
        return event;
    }
    switch (event.type) {
        case 'tool_call': {
            const status = delta.status;
            const nextStatus = status === 'pending'
                || status === 'running'
                || status === 'completed'
                || status === 'failed'
                || status === 'cancelled'
                ? status
                : event.status;
            const args = resolveTraceAppend(event.args, delta.argsBaseLength, delta.argsAppend);
            const result = resolveTraceAppend(event.result, delta.resultBaseLength, delta.resultAppend);
            if (args === undefined || result === undefined) {
                return undefined;
            }
            return {
                ...event,
                status: nextStatus,
                ...(args.length ? { args: `${event.args ?? ''}${args}` } : {}),
                ...(result.length ? { result: `${event.result ?? ''}${result}` } : {}),
            };
        }
        case 'thought': {
            const status = delta.status;
            const nextStatus = status === 'running' || status === 'completed' ? status : event.status;
            const content = resolveTraceAppend(event.content, delta.contentBaseLength, delta.contentAppend);
            if (content === undefined) {
                return undefined;
            }
            return {
                ...event,
                status: nextStatus,
                ...(content.length ? { content: `${event.content ?? ''}${content}` } : {}),
            };
        }
        case 'assistant_text': {
            const status = delta.status;
            const nextStatus = status === 'streaming' || status === 'completed' ? status : event.status;
            const content = resolveTraceAppend(event.content, delta.contentBaseLength, delta.contentAppend);
            if (content === undefined) {
                return undefined;
            }
            return {
                ...event,
                status: nextStatus,
                ...(content.length ? { content: `${event.content ?? ''}${content}` } : {}),
            };
        }
        case 'error':
        case 'run_cancelled':
        case 'checkpoint':
            return event;
        default: {
            const exhaustive: never = event;
            return exhaustive;
        }
    }
}

/** Smallest wire delta between two in-memory agent message snapshots. */
export function computeAgentMessageWireDelta(
    previous: QaapAgentMessageWireSnapshot | undefined,
    next: QaapAgentMessageWireSnapshot,
    agentId: string,
): QaapAgentMessageWireDelta {
    if (!previous) {
        return { kind: 'message_start', message: toWireMessage(next) };
    }
    if (previous.id !== next.id || previous.role !== next.role) {
        return { kind: 'replace', message: toWireMessage(next) };
    }
    if (turnProvenanceFingerprint(previous) !== turnProvenanceFingerprint(next)) {
        return { kind: 'replace', message: toWireMessage(next) };
    }

    const nextTraceEvents = next.traceEvents ?? [];
    if (nextTraceEvents.length > 0) {
        if ((previous.segments?.length ?? 0) > 0 && (previous.traceEvents?.length ?? 0) === 0) {
            return { kind: 'replace', message: toWireMessage(next) };
        }
        const traceDelta = computeTraceEventsWireDelta(previous, next);
        if (traceDelta) {
            return traceDelta;
        }
        return { kind: 'replace', message: toWireMessage(next) };
    }

    const structured = usesStructuredAgentTranscript(agentId);
    if (!structured) {
        const prevContent = previous.content ?? '';
        const nextContent = next.content ?? '';
        if (nextContent === prevContent) {
            return { kind: 'noop' };
        }
        if (nextContent.startsWith(prevContent) && nextContent.length > prevContent.length) {
            return {
                kind: 'append_content',
                messageId: next.id,
                text: nextContent.slice(prevContent.length),
                baseLength: prevContent.length,
            };
        }
        return { kind: 'replace', message: toWireMessage(next) };
    }

    const prevSegments = previous.segments ?? [];
    const nextSegments = next.segments ?? [];
    if (prevSegments.length === 0 && nextSegments.length > 0) {
        return { kind: 'replace', message: toWireMessage(next) };
    }

    if (nextSegments.length === prevSegments.length + 1) {
        for (let index = 0; index < prevSegments.length; index++) {
            if (!segmentsEqual(prevSegments[index], nextSegments[index])) {
                return { kind: 'replace', message: toWireMessage(next) };
            }
        }
        return {
            kind: 'append_segment',
            messageId: next.id,
            segment: nextSegments[nextSegments.length - 1],
        };
    }

    if (prevSegments.length !== nextSegments.length) {
        return { kind: 'replace', message: toWireMessage(next) };
    }

    let textGrowth: { segmentIndex: number; text: string; baseLength: number } | undefined;
    let toolPatch: Extract<QaapAgentMessageWireDelta, { kind: 'patch_tool' }> | undefined;

    for (let index = 0; index < prevSegments.length; index++) {
        const prev = prevSegments[index];
        const incoming = nextSegments[index];
        if (segmentsEqual(prev, incoming)) {
            continue;
        }
        if (prev.type === 'text' && incoming.type === 'text') {
            const previousText = prev.content ?? '';
            const incomingText = incoming.content ?? '';
            if (incomingText.startsWith(previousText) && incomingText.length > previousText.length) {
                const candidate = {
                    segmentIndex: index,
                    text: incomingText.slice(previousText.length),
                    baseLength: previousText.length,
                };
                if (textGrowth) {
                    return { kind: 'replace', message: toWireMessage(next) };
                }
                textGrowth = candidate;
                continue;
            }
            return { kind: 'replace', message: toWireMessage(next) };
        }
        if (prev.type === 'tool' && incoming.type === 'tool') {
            if (prev.toolUseId !== incoming.toolUseId || prev.name !== incoming.name) {
                return { kind: 'replace', message: toWireMessage(next) };
            }
            const previousArgs = prev.args ?? '';
            const incomingArgs = incoming.args ?? '';
            const previousResult = prev.result ?? '';
            const incomingResult = incoming.result ?? '';
            const argsAppend = incomingArgs.startsWith(previousArgs) && incomingArgs.length > previousArgs.length
                ? incomingArgs.slice(previousArgs.length)
                : undefined;
            const resultAppend = incomingResult.startsWith(previousResult) && incomingResult.length > previousResult.length
                ? incomingResult.slice(previousResult.length)
                : undefined;
            const finished = !prev.finished && incoming.finished ? true : undefined;
            if (!argsAppend && !resultAppend && finished === undefined) {
                return { kind: 'replace', message: toWireMessage(next) };
            }
            const candidate = {
                kind: 'patch_tool' as const,
                messageId: next.id,
                toolUseId: incoming.toolUseId,
                ...(argsAppend ? { argsAppend } : {}),
                ...(resultAppend ? { resultAppend } : {}),
                ...(finished ? { finished } : {}),
            };
            if (toolPatch) {
                return { kind: 'replace', message: toWireMessage(next) };
            }
            toolPatch = candidate;
            continue;
        }
        return { kind: 'replace', message: toWireMessage(next) };
    }

    if (textGrowth && toolPatch) {
        return { kind: 'replace', message: toWireMessage(next) };
    }
    if (textGrowth) {
        return {
            kind: 'append_segment_text',
            messageId: next.id,
            segmentIndex: textGrowth.segmentIndex,
            text: textGrowth.text,
            baseLength: textGrowth.baseLength,
        };
    }
    if (toolPatch) {
        return toolPatch;
    }

    const prevContent = previous.content ?? '';
    const nextContent = next.content ?? '';
    if (nextContent !== prevContent) {
        if (nextContent.startsWith(prevContent) && nextContent.length > prevContent.length) {
            return {
                kind: 'append_content',
                messageId: next.id,
                text: nextContent.slice(prevContent.length),
                baseLength: prevContent.length,
            };
        }
        return { kind: 'replace', message: toWireMessage(next) };
    }

    return { kind: 'noop' };
}

/** Apply one wire delta onto an in-memory conversation snapshot. */
export function applyAgentMessageWireDelta(
    conv: { readonly messages: readonly QaapAgentMessageDTO[] },
    delta: QaapAgentMessageWireDelta,
): QaapAgentMessageDTO | undefined {
    switch (delta.kind) {
        case 'noop':
            return undefined;
        case 'message_start':
        case 'replace':
            return delta.message;
        case 'append_content': {
            // The producer tells us how long the target was when it sliced this append.
            // Behind that mark we lost a delta — concatenating anyway would silently drop the
            // missing chunk for the rest of the turn, so bail and let the caller resync.
            const current = findMessage(conv, delta.messageId)?.content ?? '';
            const text = resolveAppendSuffix(current.length, delta.baseLength, delta.text);
            if (text === undefined) {
                return undefined;
            }
            return patchMessage(conv, delta.messageId, message => ({
                ...message,
                content: `${message.content ?? ''}${text}`,
            }));
        }
        case 'append_segment_text': {
            const targetSegment = findMessage(conv, delta.messageId)?.segments?.[delta.segmentIndex];
            if (delta.baseLength !== undefined && targetSegment !== undefined && targetSegment.type !== 'text') {
                return undefined;
            }
            const text = resolveAppendSuffix(
                (targetSegment?.type === 'text' ? targetSegment.content ?? '' : '').length,
                delta.baseLength,
                delta.text,
            );
            if (text === undefined) {
                return undefined;
            }
            return patchMessage(conv, delta.messageId, message => ({
                ...message,
                segments: (message.segments ?? []).map((segment, index) => (
                    index === delta.segmentIndex && segment.type === 'text'
                        ? { ...segment, content: `${segment.content ?? ''}${text}` }
                        : segment
                )),
            }));
        }
        case 'patch_tool':
            return patchMessage(conv, delta.messageId, message => ({
                ...message,
                segments: (message.segments ?? []).map(segment => {
                    if (segment.type !== 'tool' || segment.toolUseId !== delta.toolUseId) {
                        return segment;
                    }
                    return {
                        ...segment,
                        ...(delta.argsAppend !== undefined
                            ? { args: `${segment.args ?? ''}${delta.argsAppend}` }
                            : {}),
                        ...(delta.resultAppend !== undefined
                            ? { result: `${segment.result ?? ''}${delta.resultAppend}` }
                            : {}),
                        ...(delta.finished ? { finished: true } : {}),
                    };
                }),
            }));
        case 'append_segment':
            return patchMessage(conv, delta.messageId, message => ({
                ...message,
                segments: [...(message.segments ?? []), delta.segment],
            }));
        case 'append_trace_event':
            return patchMessage(conv, delta.messageId, message => ({
                ...message,
                traceEvents: [...(message.traceEvents ?? []), delta.event],
            }));
        case 'patch_trace_event': {
            const target = findMessage(conv, delta.messageId);
            if (!target) {
                return undefined;
            }
            const patchedEvents: QaapTranscriptTraceEventDTO[] = [];
            for (const event of target.traceEvents ?? []) {
                const patchedEvent = patchTraceEventInPlace(event, delta);
                if (!patchedEvent) {
                    // Gap on the structured-text path — refetch rather than stream a string
                    // that is permanently missing a chunk.
                    return undefined;
                }
                patchedEvents.push(patchedEvent);
            }
            return { ...target, traceEvents: patchedEvents };
        }
        default: {
            const exhaustive: never = delta;
            return exhaustive;
        }
    }
}

/**
 * Reconcile an append against the producer's assumed base length.
 *
 * - No `baseLength` (older producer): apply as-is.
 * - Target shorter than the base: a delta was lost or reordered — return `undefined` so the
 *   caller refetches instead of concatenating into a permanently corrupted string.
 * - Target at or past the base: apply only the part we do not already hold, so a duplicate or
 *   late-arriving delta is idempotent rather than a resync loop.
 */
function resolveAppendSuffix(
    currentLength: number,
    baseLength: number | undefined,
    text: string,
): string | undefined {
    if (baseLength === undefined) {
        return text;
    }
    if (currentLength < baseLength) {
        return undefined;
    }
    return text.slice(Math.min(currentLength - baseLength, text.length));
}

function findMessage(
    conv: { readonly messages: readonly QaapAgentMessageDTO[] },
    messageId: string,
): QaapAgentMessageDTO | undefined {
    return conv.messages.find(message => message.id === messageId);
}

function patchMessage(
    conv: { readonly messages: readonly QaapAgentMessageDTO[] },
    messageId: string,
    patch: (message: QaapAgentMessageDTO) => QaapAgentMessageDTO,
): QaapAgentMessageDTO | undefined {
    const existing = conv.messages.find(message => message.id === messageId);
    if (!existing) {
        return undefined;
    }
    return patch(existing);
}
